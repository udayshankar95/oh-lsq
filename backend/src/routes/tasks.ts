import { Router, Request, Response } from 'express';
import { query, queryOne, queryAll } from '../db/database';
import { authenticate } from '../middleware/auth';
import { processOutcome } from '../services/taskEngine';
import { releaseExpiredLocks } from '../services/assignmentEngine';
import { config } from '../config';
import { CallOutcome, TaskRow } from '../types';

const router = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseId(value: string): number | null {
  const n = parseInt(value, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function formatTask(row: Record<string, unknown>) {
  return {
    ...row,
    tests:    safeJson(row.tests    as string | null, []),
    packages: safeJson(row.packages as string | null, []),
  };
}

function safeJson(val: string | null | undefined, fallback: unknown) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

const VALID_OUTCOMES: readonly CallOutcome[] = [
  'CONNECTED_SCHEDULED', 'CONNECTED_FOLLOW_UP', 'CONNECTED_WILL_PAY',
  'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'WRONG_NUMBER', 'CALL_LATER',
  'NOT_INTERESTED',
] as const;

// ─── GET /tasks/my-queue ───────────────────────────────────────────────────────
router.get('/my-queue', authenticate, async (req: Request, res: Response): Promise<void> => {
  const agentId = req.user!.id;

  // Piggyback expired-lock cleanup — fire-and-forget, never blocks response
  releaseExpiredLocks().catch(e => console.error('[my-queue] lock release error:', e));

  const tasks = await queryAll(`
    SELECT
      t.id, t.lead_id, t.order_id, t.type, t.status, t.due_at, t.created_at,
      l.request_id, l.doctor_name, l.partner_name, l.state AS lead_state,
      l.attempt_count, l.max_attempts, l.oh_notes,
      o.oms_order_id, o.patient_name, o.patient_phone, o.customer_name,
      o.patient_age, o.patient_gender, o.tests, o.packages,
      o.preferred_slot, o.order_value
    FROM tasks t
    JOIN  leads  l ON t.lead_id   = l.id
    LEFT JOIN orders o ON t.order_id = o.id
    WHERE t.assigned_to = $1 AND t.status IN ('ASSIGNED','IN_PROGRESS')
    ORDER BY
      CASE
        WHEN t.type = 'CALLBACK'   AND t.due_at <= NOW()                       THEN 1
        WHEN t.type = 'CALLBACK'                                                THEN 2
        WHEN t.type = 'RETRY_CALL' AND t.due_at <= NOW()                       THEN 3
        WHEN t.type = 'FUTURE_CALL'                                             THEN 4
        WHEN t.type = 'FIRST_CALL' AND l.created_at <= NOW() - INTERVAL '4 hours' THEN 5
        WHEN t.type = 'FIRST_CALL'                                              THEN 6
        ELSE 7
      END ASC,
      COALESCE(t.due_at, t.created_at) ASC
  `, [agentId]);

  res.json(tasks.map(formatTask));
});

// ─── GET /tasks/:id ────────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  const taskId = parseId(req.params.id);
  if (!taskId) { res.status(400).json({ error: 'Invalid task ID' }); return; }

  const task = await queryOne<TaskRow & Record<string, unknown>>(`
    SELECT
      t.id, t.lead_id, t.order_id, t.type, t.status, t.assigned_to,
      t.due_at, t.locked_at, t.lock_expires_at, t.created_at,
      l.request_id, l.doctor_name, l.partner_name, l.prescription_url,
      l.oh_notes, l.state AS lead_state, l.attempt_count, l.max_attempts,
      o.oms_order_id, o.patient_name, o.patient_phone, o.customer_name,
      o.patient_age, o.patient_gender, o.tests, o.packages,
      o.preferred_slot, o.order_value,
      u.name AS agent_name
    FROM tasks t
    JOIN  leads  l ON t.lead_id   = l.id
    LEFT JOIN orders o ON t.order_id = o.id
    LEFT JOIN users  u ON t.assigned_to = u.id
    WHERE t.id = $1
  `, [taskId]);

  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  // Authorisation: agents may only see their own tasks; managers see all
  if (req.user!.role !== 'manager' && task.assigned_to !== req.user!.id) {
    res.status(403).json({ error: 'Not authorised to view this task' }); return;
  }

  // Call history for this lead — shown as timeline in agent detail view
  const callHistory = await queryAll(`
    SELECT ca.*, u.name AS agent_name
    FROM call_attempts ca
    JOIN users u ON ca.agent_id = u.id
    WHERE ca.lead_id = $1
    ORDER BY ca.called_at DESC
  `, [(task as any).lead_id]);

  // Other leads for the same patient phone (system duplicates or other open
  // leads) — shown in the "Other Leads" panel so agents can cross-reference
  const patientPhone = (task as any).patient_phone as string | null;
  let otherLeads: unknown[] = [];

  if (patientPhone) {
    otherLeads = await queryAll(`
      SELECT
        l.id, l.request_id, l.state, l.attempt_count, l.lead_source,
        l.created_at, l.primary_lead_id,
        o.patient_name, o.oms_order_id
      FROM orders o
      JOIN leads l ON l.id = o.lead_id
      WHERE o.patient_phone = $1
        AND l.id != $2
      ORDER BY l.created_at DESC
      LIMIT 10
    `, [patientPhone, (task as any).lead_id]);
  }

  res.json({
    ...formatTask(task as Record<string, unknown>),
    call_history: callHistory,
    other_leads:  otherLeads,
  });
});

// ─── POST /tasks/:id/start ─────────────────────────────────────────────────────
router.post('/:id/start', authenticate, async (req: Request, res: Response): Promise<void> => {
  const taskId = parseId(req.params.id);
  if (!taskId) { res.status(400).json({ error: 'Invalid task ID' }); return; }

  const agentId = req.user!.id;

  // Atomic gate: transition ASSIGNED → IN_PROGRESS only once
  const lockExpires = new Date(Date.now() + config.LOCK_DURATION_MINUTES * 60 * 1000).toISOString();

  const result = await query(
    `UPDATE tasks
     SET status = 'IN_PROGRESS', locked_at = NOW(), lock_expires_at = $1, updated_at = NOW()
     WHERE id = $2 AND assigned_to = $3 AND status = 'ASSIGNED'`,
    [lockExpires, taskId, agentId]
  );

  if ((result as any).rowCount === 0) {
    // Either task not found, not assigned to this agent, or already IN_PROGRESS
    const task = await queryOne<{ status: string; assigned_to: number }>(
      `SELECT status, assigned_to FROM tasks WHERE id = $1`, [taskId]
    );
    if (!task)                              { res.status(404).json({ error: 'Task not found' }); return; }
    if (task.assigned_to !== agentId)       { res.status(403).json({ error: 'Task not assigned to you' }); return; }
    if (task.status === 'IN_PROGRESS')      { res.json({ message: 'Task already in progress', lock_expires_at: lockExpires }); return; }
    if (task.status === 'COMPLETED')        { res.status(400).json({ error: 'Task already completed' }); return; }
    res.status(400).json({ error: `Cannot start task in status: ${task.status}` }); return;
  }

  res.json({ message: 'Task locked', lock_expires_at: lockExpires });
});

// ─── POST /tasks/:id/outcome ───────────────────────────────────────────────────
router.post('/:id/outcome', authenticate, async (req: Request, res: Response): Promise<void> => {
  const taskId = parseId(req.params.id);
  if (!taskId) { res.status(400).json({ error: 'Invalid task ID' }); return; }

  const agentId = req.user!.id;
  const { outcome, notes, callback_time, cancellation_reason } = req.body as {
    outcome: CallOutcome;
    notes?: string;
    callback_time?: string;
    cancellation_reason?: string;
  };

  if (!VALID_OUTCOMES.includes(outcome)) {
    res.status(400).json({ error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(', ')}` });
    return;
  }
  if (outcome === 'CALL_LATER' && !callback_time) {
    res.status(400).json({ error: 'callback_time is required for CALL_LATER outcome' }); return;
  }
  if ((outcome === 'NOT_INTERESTED' || outcome === 'WRONG_NUMBER') && !cancellation_reason) {
    res.status(400).json({ error: 'cancellation_reason is required for this outcome' }); return;
  }

  const task = await queryOne<{ lead_id: number; assigned_to: number; status: string }>(
    `SELECT lead_id, assigned_to, status FROM tasks WHERE id = $1`, [taskId]
  );
  if (!task)                              { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.assigned_to !== agentId)       { res.status(403).json({ error: 'Task not assigned to you' }); return; }
  if (task.status === 'COMPLETED')        { res.status(400).json({ error: 'Task already completed' }); return; }

  // Record the call attempt before driving the state machine.
  // processOutcome uses an atomic gate so it is safe from double-submission.
  await query(
    `INSERT INTO call_attempts
       (task_id, lead_id, agent_id, outcome, notes, cancellation_reason, callback_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [taskId, task.lead_id, agentId, outcome, notes ?? null,
     cancellation_reason ?? null, callback_time ?? null]
  );

  try {
    await processOutcome(
      taskId, task.lead_id, agentId, outcome,
      notes ?? null, callback_time ?? null, cancellation_reason ?? null
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.startsWith('LEAD_TERMINAL:')) {
      const state = msg.split(':')[1];
      res.status(409).json({
        error: `Lead was already closed (state: ${state}) — possibly cancelled by OMS while you were on the call. Your call has been recorded.`,
        lead_state: state,
        code: 'LEAD_TERMINAL',
      });
      return;
    }
    throw err;
  }

  res.json({ message: 'Outcome logged successfully' });
});

// ─── POST /tasks/:id/abandon ───────────────────────────────────────────────────
router.post('/:id/abandon', authenticate, async (req: Request, res: Response): Promise<void> => {
  const taskId = parseId(req.params.id);
  if (!taskId) { res.status(400).json({ error: 'Invalid task ID' }); return; }

  const result = await query(
    `UPDATE tasks
     SET status = 'ASSIGNED', locked_at = NULL, lock_expires_at = NULL, updated_at = NOW()
     WHERE id = $1 AND assigned_to = $2`,
    [taskId, req.user!.id]
  );

  if ((result as any).rowCount === 0) {
    res.status(404).json({ error: 'Task not found or not assigned to you' }); return;
  }

  res.json({ message: 'Task released back to queue' });
});

export default router;
