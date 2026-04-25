import { Router, Request, Response, NextFunction } from 'express';
import { createLeadFromEvent } from '../services/leadEngine';
import { logWebhookReceived, updateWebhookEvent } from '../db/database';
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

export default router;
