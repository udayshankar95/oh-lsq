import pool, { logLeadEvent } from '../db/database';
import { OmsEventPayload } from '../types';
import { getNumericSetting } from './settingsService';
import { createFirstCallTask } from './taskEngine';
import { config } from '../config';

// ─── createLeadFromEvent ───────────────────────────────────────────────────────
// Creates a lead + orders + first-call tasks from an OMS webhook payload.
//
// Idempotency: duplicate request_id is handled by ON CONFLICT DO NOTHING.
//
// Duplicate phone detection:
//   If an active lead (non-terminal state) already exists for any phone number
//   in this payload, the new lead is created as SYSTEM_DUPLICATE.  A duplicate
//   lead has no tasks created for it (it never enters the workable funnel) and
//   stores a reference to the original lead so agents can see it in the
//   "Other Leads" panel on the original lead's detail view.
//
// Transaction safety:
//   All inserts (lead + orders) run inside a single transaction so a partial
//   failure leaves no orphan rows.  Task creation (assignTask) runs its own
//   transaction internally — this is safe because task creation is idempotent
//   and isolated.
//
export async function createLeadFromEvent(
  payload: OmsEventPayload
): Promise<{ leadId: number; taskIds: number[]; isDuplicate: boolean }> {

  // ── Collect all phone numbers in this event ──────────────────────────────
  const phones = payload.orders
    .map(o => o.patient_phone?.trim())
    .filter(Boolean) as string[];

  // ── Check for an existing open lead with any of these phones ────────────
  // "Open" means not in a terminal state and not itself a duplicate.
  let primaryLeadId: number | null = null;

  if (phones.length > 0) {
    const phonePlaceholders = phones.map((_, i) => `$${i + 1}`).join(', ');
    const existing = await pool.query<{ lead_id: number }>(
      `SELECT o.lead_id
       FROM orders o
       JOIN leads l ON l.id = o.lead_id
       WHERE o.patient_phone IN (${phonePlaceholders})
         AND l.state NOT IN ('SCHEDULED','CANCELLED','UNREACHABLE','SYSTEM_DUPLICATE')
       LIMIT 1`,
      phones
    );
    if (existing.rows.length > 0) {
      primaryLeadId = existing.rows[0].lead_id;
    }
  }

  const isDuplicate = primaryLeadId !== null;
  const initialState = isDuplicate ? 'SYSTEM_DUPLICATE' : 'NEW';

  // Read max_attempts from live settings (configurable per manager)
  const maxAttempts = await getNumericSetting('max_attempts', 3);

  // ── Transaction: insert lead + orders ───────────────────────────────────
  const client = await pool.connect();
  let leadId: number;

  try {
    await client.query('BEGIN');

    // ON CONFLICT means duplicate request_id is silently ignored and we can
    // check the returned row to detect the case.
    const leadResult = await client.query<{ id: number }>(
      `INSERT INTO leads (request_id, doctor_name, partner_name, prescription_url,
         oh_notes, lead_source, state, max_attempts, primary_lead_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (request_id) DO NOTHING
       RETURNING id`,
      [
        payload.request_id,
        payload.doctor_name,
        payload.partner_name,
        payload.prescription_url ?? null,
        payload.oh_notes ?? null,
        (payload as any).lead_source ?? 'B2C_OMT',
        initialState,
        maxAttempts,
        primaryLeadId,
      ]
    );

    if (leadResult.rows.length === 0) {
      // request_id already exists — return the existing lead without creating tasks
      await client.query('ROLLBACK');
      const dup = await pool.query<{ id: number }>(
        `SELECT id FROM leads WHERE request_id = $1`, [payload.request_id]
      );
      return { leadId: dup.rows[0].id, taskIds: [], isDuplicate: true };
    }

    leadId = leadResult.rows[0].id;

    for (const order of payload.orders) {
      await client.query(
        `INSERT INTO orders (lead_id, oms_order_id, customer_name, patient_name,
           patient_phone, patient_age, patient_gender, tests, packages,
           preferred_slot, order_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          leadId,
          order.order_id,
          order.customer_name,
          order.patient_name,
          order.patient_phone,
          order.patient_age ?? null,
          order.patient_gender ?? null,
          JSON.stringify(order.tests ?? []),
          JSON.stringify(order.packages ?? []),
          order.preferred_slot ?? null,
          order.order_value ?? 0,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── Audit log (fire-and-forget — intentional, never blocks the caller) ──
  logLeadEvent({
    leadId,
    action: isDuplicate ? 'CREATED_AS_DUPLICATE' : 'CREATED',
    toState: initialState,
    metadata: {
      request_id: payload.request_id,
      orders_count: payload.orders.length,
      ...(isDuplicate && { primary_lead_id: primaryLeadId }),
    },
  });

  // ── Create tasks only for non-duplicate leads ────────────────────────────
  const taskIds: number[] = [];

  if (!isDuplicate) {
    // Task creation runs outside the main transaction — each assignTask call
    // is internally transactional and idempotent.
    for (const order of payload.orders) {
      // Re-fetch order id since we need it for task creation
      const orderRow = await pool.query<{ id: number }>(
        `SELECT id FROM orders WHERE lead_id = $1 AND oms_order_id = $2`,
        [leadId, order.order_id]
      );
      if (orderRow.rows.length > 0) {
        const taskId = await createFirstCallTask(leadId, orderRow.rows[0].id);
        taskIds.push(taskId);
      }
    }
  }

  return { leadId, taskIds, isDuplicate };
}
