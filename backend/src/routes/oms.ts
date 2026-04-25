import { Router, Request, Response, NextFunction } from 'express';
import { createLeadFromEvent } from '../services/leadEngine';
import { query, queryOne, queryAll, logWebhookReceived, updateWebhookEvent, logLeadEvent } from '../db/database';
import { notifyAgent } from '../sse';
import { OmsEventPayload } from '../types';

const router = Router();

// ─── API Key guard ────────────────────────────────────────────────────────────
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'];
  const expected = process.env.OMS_API_KEY;

  if (!expected) {
    // No key configured — allow in dev, block in production
    if (process.env.NODE_ENV === 'production') {
      res.status(500).json({ error: 'OMS_API_KEY not configured on server' });
      return;
    }
    return next();
  }

  if (!key || key !== expected) {
    res.status(401).json({ error: 'Invalid or missing X-API-Key header' });
    return;
  }

  next();
}

// ─── Validate a single OMS event payload ──────────────────────────────────────
function validateEvent(payload: OmsEventPayload): string | null {
  if (!payload.request_id) return 'Missing required field: request_id';
  if (!Array.isArray(payload.orders) || payload.orders.length === 0)
    return 'Missing required field: orders[] (must be a non-empty array)';
  for (const order of payload.orders) {
    if (!order.order_id)     return `Order missing: order_id`;
    if (!order.patient_name) return `Order ${order.order_id} missing: patient_name`;
    if (!order.patient_phone) return `Order ${order.order_id} missing: patient_phone`;
    if (!order.customer_name) return `Order ${order.order_id} missing: customer_name`;
  }
  return null;
}

// ─── POST /api/oms/event — single lead ───────────────────────────────────────
router.post('/event', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const payload = req.body as OmsEventPayload;

  const validationError = validateEvent(payload);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const webhookId = await logWebhookReceived(payload.request_id, payload);

  try {
    const result = await createLeadFromEvent(payload);
    await updateWebhookEvent(webhookId!, 'processed');
    res.status(201).json({
      message: 'Lead created and tasks assigned',
      lead_id: result.leadId,
      task_ids: result.taskIds,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('already exists')) {
      await updateWebhookEvent(webhookId!, 'failed', 'duplicate request_id');
      res.status(409).json({ error: message });
    } else {
      await updateWebhookEvent(webhookId!, 'failed', message);
      res.status(500).json({ error: message });
    }
  }
});

// ─── POST /api/oms/bulk — create multiple leads in one call ──────────────────
router.post('/bulk', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { events } = req.body as { events: OmsEventPayload[] };

  if (!Array.isArray(events) || events.length === 0) {
    res.status(400).json({ error: 'Body must be { events: OmsEventPayload[] } with at least one item' });
    return;
  }

  if (events.length > 500) {
    res.status(400).json({ error: 'Maximum 500 leads per bulk request' });
    return;
  }

  const results: {
    request_id: string;
    status: 'created' | 'duplicate' | 'error';
    lead_id?: number;
    task_ids?: number[];
    error?: string;
  }[] = [];

  for (const payload of events) {
    const validationError = validateEvent(payload);
    if (validationError) {
      results.push({ request_id: payload.request_id ?? '(missing)', status: 'error', error: validationError });
      continue;
    }

    const webhookId = await logWebhookReceived(payload.request_id, payload).catch(() => null);

    try {
      const result = await createLeadFromEvent(payload);
      if (webhookId) await updateWebhookEvent(webhookId, 'processed');
      results.push({ request_id: payload.request_id, status: 'created', lead_id: result.leadId, task_ids: result.taskIds });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const isDuplicate = message.includes('already exists');
      if (webhookId) await updateWebhookEvent(webhookId, 'failed', isDuplicate ? 'duplicate request_id' : message);
      results.push({
        request_id: payload.request_id,
        status: isDuplicate ? 'duplicate' : 'error',
        error: message,
      });
    }
  }

  const created   = results.filter(r => r.status === 'created').length;
  const duplicate = results.filter(r => r.status === 'duplicate').length;
  const failed    = results.filter(r => r.status === 'error').length;

  res.status(207).json({
    summary: { total: events.length, created, duplicate, failed },
    results,
  });
});

// ─── PUT /api/oms/leads/:request_id — update mutable lead + order fields ──────
//
// Updatable lead-level fields:  doctor_name, partner_name, oh_notes, prescription_url
// Updatable order-level fields: patient_name, patient_phone, patient_age,
//                               patient_gender, preferred_slot, order_value,
//                               tests, packages
//
// Identified by request_id (OMS's own key). Order identified by order_id within
// the orders[] array. Fields omitted from the payload are left unchanged.
//
router.put('/leads/:request_id', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { request_id } = req.params;

  const lead = await queryOne<{ id: number; state: string }>(
    `SELECT id, state FROM leads WHERE request_id = $1`,
    [request_id]
  );
  if (!lead) {
    res.status(404).json({ error: `No lead found for request_id: ${request_id}` });
    return;
  }

  // Leads that are terminal cannot be updated
  if (['SCHEDULED', 'CANCELLED', 'UNREACHABLE'].includes(lead.state)) {
    res.status(409).json({
      error: `Lead is in terminal state '${lead.state}' and cannot be updated`,
    });
    return;
  }

  const {
    doctor_name, partner_name, oh_notes, prescription_url,
    orders: orderUpdates,
  } = req.body as {
    doctor_name?: string;
    partner_name?: string;
    oh_notes?: string;
    prescription_url?: string;
    orders?: {
      order_id: string;
      patient_name?: string;
      patient_phone?: string;
      patient_age?: number;
      patient_gender?: string;
      preferred_slot?: string;
      order_value?: number;
      tests?: string[];
      packages?: string[];
    }[];
  };

  // ── Update lead-level fields ─────────────────────────────────────────────────
  const leadSets: string[] = [];
  const leadParams: unknown[] = [];
  let idx = 1;

  if (doctor_name     !== undefined) { leadSets.push(`doctor_name = $${idx++}`);      leadParams.push(doctor_name); }
  if (partner_name    !== undefined) { leadSets.push(`partner_name = $${idx++}`);     leadParams.push(partner_name); }
  if (oh_notes        !== undefined) { leadSets.push(`oh_notes = $${idx++}`);         leadParams.push(oh_notes); }
  if (prescription_url !== undefined) { leadSets.push(`prescription_url = $${idx++}`); leadParams.push(prescription_url); }

  if (leadSets.length > 0) {
    leadSets.push(`updated_at = NOW()`);
    leadParams.push(lead.id);
    await query(
      `UPDATE leads SET ${leadSets.join(', ')} WHERE id = $${idx}`,
      leadParams
    );
  }

  // ── Update order-level fields ────────────────────────────────────────────────
  const orderResults: { order_id: string; status: 'updated' | 'not_found' | 'no_changes' }[] = [];

  if (Array.isArray(orderUpdates) && orderUpdates.length > 0) {
    for (const upd of orderUpdates) {
      const order = await queryOne<{ id: number }>(
        `SELECT id FROM orders WHERE oms_order_id = $1 AND lead_id = $2`,
        [upd.order_id, lead.id]
      );

      if (!order) {
        orderResults.push({ order_id: upd.order_id, status: 'not_found' });
        continue;
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let oidx = 1;

      if (upd.patient_name   !== undefined) { sets.push(`patient_name = $${oidx++}`);   params.push(upd.patient_name); }
      if (upd.patient_phone  !== undefined) { sets.push(`patient_phone = $${oidx++}`);  params.push(upd.patient_phone); }
      if (upd.patient_age    !== undefined) { sets.push(`patient_age = $${oidx++}`);    params.push(upd.patient_age); }
      if (upd.patient_gender !== undefined) { sets.push(`patient_gender = $${oidx++}`); params.push(upd.patient_gender); }
      if (upd.preferred_slot !== undefined) { sets.push(`preferred_slot = $${oidx++}`); params.push(upd.preferred_slot); }
      if (upd.order_value    !== undefined) { sets.push(`order_value = $${oidx++}`);    params.push(upd.order_value); }
      if (upd.tests          !== undefined) { sets.push(`tests = $${oidx++}`);          params.push(JSON.stringify(upd.tests)); }
      if (upd.packages       !== undefined) { sets.push(`packages = $${oidx++}`);       params.push(JSON.stringify(upd.packages)); }

      if (sets.length === 0) {
        orderResults.push({ order_id: upd.order_id, status: 'no_changes' });
        continue;
      }

      params.push(order.id);
      await query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $${oidx}`, params);
      orderResults.push({ order_id: upd.order_id, status: 'updated' });
    }
  }

  // ── Audit log ────────────────────────────────────────────────────────────────
  const changedFields = [
    ...leadSets.filter(s => !s.includes('updated_at')).map(s => s.split(' =')[0].trim()),
    ...orderResults.filter(r => r.status === 'updated').map(r => `order:${r.order_id}`),
  ];

  if (changedFields.length > 0) {
    logLeadEvent({
      leadId: lead.id,
      action: 'UPDATED_BY_OMS',
      metadata: { request_id, changed_fields: changedFields },
    });
  }

  // ── Notify any agent currently working this lead ──────────────────────────
  if (changedFields.length > 0) {
    await notifyActiveAgents(lead.id, 'lead_updated', {
      lead_id: lead.id,
      request_id,
      changed_fields: changedFields,
      message: 'This lead was updated by OMS. Please refresh to see the latest details.',
    });
  }

  res.json({
    message: 'Lead updated',
    lead_id: lead.id,
    lead_fields_updated: leadSets.filter(s => !s.includes('updated_at')).length,
    order_results: orderResults,
  });
});

// ─── POST /api/oms/leads/:request_id/cancel — close a lead from OMS side ──────
//
// Sets lead state → CANCELLED, abandons all open tasks, logs audit event.
// Body: { reason: string }  (required — must record why OMS is cancelling)
//
router.post('/leads/:request_id/cancel', requireApiKey, async (req: Request, res: Response): Promise<void> => {
  const { request_id } = req.params;
  const { reason } = req.body as { reason?: string };

  if (!reason || reason.trim() === '') {
    res.status(400).json({ error: 'reason is required in the request body' });
    return;
  }

  const lead = await queryOne<{ id: number; state: string }>(
    `SELECT id, state FROM leads WHERE request_id = $1`,
    [request_id]
  );
  if (!lead) {
    res.status(404).json({ error: `No lead found for request_id: ${request_id}` });
    return;
  }

  // Already terminal — idempotent: treat as success
  if (lead.state === 'CANCELLED') {
    res.json({ message: 'Lead was already cancelled', lead_id: lead.id });
    return;
  }

  if (['SCHEDULED', 'UNREACHABLE'].includes(lead.state)) {
    res.status(409).json({
      error: `Lead is in terminal state '${lead.state}' and cannot be cancelled`,
    });
    return;
  }

  const prevState = lead.state;

  // Abandon all open tasks
  const abandoned = await query(
    `UPDATE tasks
     SET status = 'ABANDONED', updated_at = NOW()
     WHERE lead_id = $1 AND status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS')`,
    [lead.id]
  );

  // Cancel the lead
  await query(
    `UPDATE leads SET state = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
    [lead.id]
  );

  // Audit log
  logLeadEvent({
    leadId: lead.id,
    action: 'CANCELLED_BY_OMS',
    fromState: prevState,
    toState: 'CANCELLED',
    metadata: { request_id, reason },
  });

  // ── Notify any agent currently working this lead ──────────────────────────
  await notifyActiveAgents(lead.id, 'lead_cancelled', {
    lead_id: lead.id,
    request_id,
    reason,
    message: 'This lead has been cancelled by OMS. Please stop the call and move to the next task.',
  });

  res.json({
    message: 'Lead cancelled',
    lead_id: lead.id,
    previous_state: prevState,
    tasks_abandoned: (abandoned as any).rowCount ?? 0,
  });
});

// ─── Helper: notify agents who have an IN_PROGRESS task for this lead ────────
async function notifyActiveAgents(
  leadId: number,
  eventType: string,
  payload: unknown
): Promise<void> {
  try {
    const activeAgents = await queryAll<{ assigned_to: number }>(
      `SELECT DISTINCT assigned_to FROM tasks
       WHERE lead_id = $1 AND status = 'IN_PROGRESS' AND assigned_to IS NOT NULL`,
      [leadId]
    );
    for (const { assigned_to } of activeAgents) {
      notifyAgent(assigned_to, eventType, payload);
    }
  } catch (e) {
    console.error('notifyActiveAgents error:', e);
  }
}

export default router;
