import { query, queryOne, logLeadEvent } from '../db/database';
import { OmsEventPayload } from '../types';
import { createFirstCallTask } from './taskEngine';

export async function createLeadFromEvent(
  payload: OmsEventPayload
): Promise<{ leadId: number; taskIds: number[] }> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM leads WHERE request_id = $1`,
    [payload.request_id]
  );
  if (existing) {
    throw new Error(`Lead already exists for request_id: ${payload.request_id}`);
  }

  const leadRow = await queryOne<{ id: number }>(
    `INSERT INTO leads (request_id, doctor_name, partner_name, prescription_url, oh_notes, state)
     VALUES ($1, $2, $3, $4, $5, 'NEW') RETURNING id`,
    [
      payload.request_id,
      payload.doctor_name,
      payload.partner_name,
      payload.prescription_url || null,
      payload.oh_notes || null,
    ]
  );

  const leadId = leadRow!.id;

  // Audit: lead created
  logLeadEvent({
    leadId,
    action: 'CREATED',
    toState: 'NEW',
    metadata: {
      request_id: payload.request_id,
      orders_count: payload.orders.length,
    },
  });

  const taskIds: number[] = [];

  for (const order of payload.orders) {
    const orderRow = await queryOne<{ id: number }>(
      `INSERT INTO orders (lead_id, oms_order_id, customer_name, patient_name, patient_phone,
        patient_age, patient_gender, tests, packages, preferred_slot, order_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        leadId,
        order.order_id,
        order.customer_name,
        order.patient_name,
        order.patient_phone,
        order.patient_age || null,
        order.patient_gender || null,
        JSON.stringify(order.tests || []),
        JSON.stringify(order.packages || []),
        order.preferred_slot || null,
        order.order_value || 0,
      ]
    );

    const orderId = orderRow!.id;
    const taskId = await createFirstCallTask(leadId, orderId);
    taskIds.push(taskId);
  }

  return { leadId, taskIds };
}
