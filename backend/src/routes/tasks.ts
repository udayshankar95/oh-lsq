import { Router, Request, Response } from 'express';
import { query, queryOne, queryAll } from '../db/database';
import { authenticate } from '../middleware/auth';
import { processOutcome } from '../services/taskEngine';
import { CallOutcome } from '../types';

const router = Router();
const LOCK_DURATION_MINUTES = 10;

router.get('/my-queue', authenticate, async (req: Request, res: Response): Promise<void> => {
  const agentId = req.user!.id;

  const tasks = await queryAll(`
    SELECT
      t.id, t.lead_id, t.order_id, t.type, t.status, t.due_at, t.created_at,
      l.request_id, l.doctor_name, l.partner_name, l.state AS lead_state,
      l.attempt_count, l.max_attempts, l.oh_notes,
      o.oms_order_id, o.patient_name, o.patient_phone, o.customer_name,
      o.patient_age, o.patient_gender, o.tests, o.packages, o.preferred_slot, o.order_value
    FROM tasks t
    JOIN leads l ON t.lead_id = l.id
    LEFT JOIN orders o ON t.order_id = o.id
    WHERE t.assigned_to = $1 AND t.status IN ('ASSIGNED', 'IN_PROGRESS')
    ORDER BY
      CASE
        WHEN t.type = 'CALLBACK' AND t.due_at <= NOW() THEN 1
        WHEN t.type = 'CALLBACK' THEN 2
        WHEN t.type = 'RETRY_CALL' AND t.due_at <= NOW() THEN 3
        WHEN t.type = 'FIRST_CALL' AND l.created_at <= NOW() - INTERVAL '4 hours' THEN 4
        WHEN t.type = 'FIRST_CALL' THEN 5
        ELSE 6
      END ASC,
      COALESCE(t.due_at, t.created_at) ASC
  `, [agentId]);

  res.json(tasks.map(formatTask));
});

router.get('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  const taskId = parseInt(req.params.id);

  const task = await queryOne(`
    SELECT
      t.id, t.lead_id, t.order_id, t.type, t.status, t.assigned_to,
      t.due_at, t.locked_at, t.lock_expires_at, t.created_at,
      l.request_id, l.doctor_name, l.partner_name, l.prescription_url,
      l.oh_notes, l.state AS lead_state, l.attempt_count, l.max_attempts,
      o.oms_order_id, o.patient_name, o.patient_phone, o.customer_name,
      o.patient_age, o.patient_gender, o.tests, o.packages, o.preferred_slot, o.order_value,
      u.name AS agent_name
    FROM tasks t
    JOIN leads l ON t.lead_id = l.id
    LEFT JOIN orders o ON t.order_id = o.id
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.id = $1
  `, [taskId]);

  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const callHistory = await queryAll(`
    SELECT ca.*, u.name AS agent_name
    FROM call_attempts ca
    JOIN users u ON ca.agent_id = u.id
    WHERE ca.lead_id = $1
    ORDER BY ca.called_at DESC
  `, [(task as any).lead_id]);

  res.json({ ...formatTask(task as any), call_history: callHistory });
});

router.post('/:id/start', authenticate, async (req: Request, res: Response): Promise<void> => {
  const taskId = parseInt(req.params.id);
  const agentId = req.user!.id;

  const task = await queryOne<any>(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.assigned_to !== agentId) { res.status(403).json({ error: 'Task not assigned to you' }); return; }
  if (task.status === 'COMPLETED') { res.status(400).json({ error: 'Task already completed' }); return; }

  const lockExpires = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString();

  await query(
    `UPDATE tasks SET status = 'IN_PROGRESS', locked_at = NOW(), lock_expires_at = $1, updated_at = NOW() WHERE id = $2`,
    [lockExpires, taskId]
  );

  res.json({ message: 'Task locked', lock_expires_at: lockExpires });
});

router.post('/:id/outcome', authenticate, async (req: Request, res: Response): Promise<void> => {
  const taskId = parseInt(req.params.id);
  const agentId = req.user!.id;
  const { outcome, notes, callback_time, cancellation_reason } = req.body as {
    outcome: CallOutcome;
    notes?: string;
    callback_time?: string;
    cancellation_reason?: string;
  };

  const validOutcomes: CallOutcome[] = [
    'CONNECTED_SCHEDULED', 'CONNECTED_FOLLOW_UP', 'NO_ANSWER', 'BUSY',
    'SWITCHED_OFF', 'WRONG_NUMBER', 'CALL_LATER', 'NOT_INTERESTED', 'CONNECTED_WILL_PAY'
  ];

  if (!validOutcomes.includes(outcome)) {
    res.status(400).json({ error: `Invalid outcome. Must be one of: ${validOutcomes.join(', ')}` });
    return;
  }
  if (outcome === 'CALL_LATER' && !callback_time) {
    res.status(400).json({ error: 'callback_time is required for CALL_LATER outcome' });
    return;
  }

  const task = await queryOne<any>(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.assigned_to !== agentId) { res.status(403).json({ error: 'Task not assigned to you' }); return; }
  if (task.status === 'COMPLETED') { res.status(400).json({ error: 'Task already completed' }); return; }

  await query(
    `INSERT INTO call_attempts (task_id, lead_id, agent_id, outcome, notes, cancellation_reason, callback_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [taskId, task.lead_id, agentId, outcome, notes || null, cancellation_reason || null, callback_time || null]
  );

  await processOutcome(taskId, task.lead_id, agentId, outcome, notes || null, callback_time || null, cancellation_reason || null);

  res.json({ message: 'Outcome logged successfully' });
});

router.post('/:id/abandon', authenticate, async (req: Request, res: Response): Promise<void> => {
  const taskId = parseInt(req.params.id);
  const agentId = req.user!.id;

  const task = await queryOne<any>(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.assigned_to !== agentId) { res.status(403).json({ error: 'Task not assigned to you' }); return; }

  await query(
    `UPDATE tasks SET status = 'ASSIGNED', locked_at = NULL, lock_expires_at = NULL, updated_at = NOW() WHERE id = $1`,
    [taskId]
  );

  res.json({ message: 'Task released back to queue' });
});

function formatTask(row: any) {
  return {
    ...row,
    tests: safeJson(row.tests, []),
    packages: safeJson(row.packages, []),
  };
}

function safeJson(val: string | null, fallback: unknown) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

export default router;
