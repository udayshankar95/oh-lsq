import pool, { query, queryOne, logLeadEvent } from '../db/database';
import { config } from '../config';
import { getNumericSetting } from './settingsService';
import { CallOutcome, LeadState, TaskType } from '../types';
import { assignTask } from './assignmentEngine';

// ─── processOutcome ────────────────────────────────────────────────────────────
// Records a call attempt outcome and drives the lead state machine.
//
// Atomic gate: the task is updated from COMPLETED only if it is currently
// IN_PROGRESS (or ASSIGNED).  If another concurrent request already completed
// it, the gate returns 0 rows and we bail early — no double-processing.
//
export async function processOutcome(
  taskId: number,
  leadId: number,
  agentId: number,
  outcome: CallOutcome,
  notes: string | null,
  callbackTime: string | null,
  cancellationReason: string | null
): Promise<void> {

  // ── Atomic gate: mark task COMPLETED ───────────────────────────────────────
  // Uses UPDATE … WHERE status IN (…) RETURNING id so that only one concurrent
  // call wins.  The second concurrent call gets 0 rows back and exits.
  const gateResult = await pool.query<{ id: number }>(
    `UPDATE tasks
     SET status = 'COMPLETED', updated_at = NOW()
     WHERE id = $1 AND status IN ('IN_PROGRESS','ASSIGNED')
     RETURNING id`,
    [taskId]
  );

  if (gateResult.rows.length === 0) {
    // Already completed by a concurrent request — safe to silently ignore
    return;
  }

  // ── Guard: re-check lead state immediately before writing anything ─────────
  // Prevents writing against a lead that OMS cancelled while the agent was
  // mid-call.
  const leadCheck = await queryOne<{ state: string; attempt_count: number; max_attempts: number }>(
    `SELECT state, attempt_count, max_attempts FROM leads WHERE id = $1 FOR UPDATE`,
    [leadId]
  );

  if (!leadCheck) throw new Error(`Lead ${leadId} not found`);

  const TERMINAL_STATES = new Set(['SCHEDULED', 'CANCELLED', 'UNREACHABLE', 'SYSTEM_DUPLICATE']);

  if (TERMINAL_STATES.has(leadCheck.state)) {
    // Lead closed externally while agent was on the call.  Task is already
    // COMPLETED (the gate above).  Surface a clear error to the caller.
    throw new Error(`LEAD_TERMINAL:${leadCheck.state}`);
  }

  // ── Increment attempt count, get updated value in one round-trip ───────────
  const countResult = await pool.query<{ attempt_count: number; max_attempts: number }>(
    `UPDATE leads
     SET attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING attempt_count, max_attempts`,
    [leadId]
  );

  const { attempt_count, max_attempts } = countResult.rows[0];

  // ── Read live settings (cached, ~60s TTL) ───────────────────────────────────
  const [retryDelayHours, followUpMinutes, paymentReminderMinutes] = await Promise.all([
    getNumericSetting('retry_delay_hours',       config.RETRY_DELAY_HOURS),
    getNumericSetting('followup_delay_minutes',  config.FOLLOW_UP_DELAY_MINUTES),
    getNumericSetting('payment_reminder_minutes',config.PAYMENT_REMINDER_MINUTES),
  ]);

  // ── Drive state machine ────────────────────────────────────────────────────
  switch (outcome) {
    case 'CONNECTED_SCHEDULED':
      await updateLeadState(leadId, 'SCHEDULED', agentId, outcome);
      break;

    case 'CONNECTED_FOLLOW_UP':
      await updateLeadState(leadId, 'CONNECTED', agentId, outcome);
      await createNextTask(leadId, taskId, 'RETRY_CALL', minutesFromNow(followUpMinutes));
      break;

    case 'CONNECTED_WILL_PAY':
      // Patient confirmed they will pay — schedule a payment-reminder call
      await updateLeadState(leadId, 'CONNECTED', agentId, outcome);
      await createNextTask(leadId, taskId, 'FUTURE_CALL', minutesFromNow(paymentReminderMinutes));
      break;

    case 'NO_ANSWER':
    case 'BUSY':
    case 'SWITCHED_OFF':
      if (attempt_count >= max_attempts) {
        await updateLeadState(leadId, 'UNREACHABLE', agentId, outcome);
      } else {
        await updateLeadState(leadId, 'ATTEMPTING', agentId, outcome);
        await createNextTask(leadId, taskId, 'RETRY_CALL', hoursFromNow(retryDelayHours));
      }
      break;

    case 'CALL_LATER': {
      await updateLeadState(leadId, 'CALLBACK_SCHEDULED', agentId, outcome);
      const cbTime = callbackTime ?? minutesFromNow(60);
      await createNextTask(leadId, taskId, 'CALLBACK', cbTime);
      break;
    }

    case 'NOT_INTERESTED':
    case 'WRONG_NUMBER':
      await updateLeadState(leadId, 'CANCELLED', agentId, outcome);
      break;
  }
}

// ─── createFirstCallTask ───────────────────────────────────────────────────────
// Creates the initial FIRST_CALL task for a newly ingested lead.
//
export async function createFirstCallTask(leadId: number, orderId: number): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO tasks (lead_id, order_id, type, status, created_at, updated_at)
     VALUES ($1, $2, 'FIRST_CALL', 'PENDING', NOW(), NOW()) RETURNING id`,
    [leadId, orderId]
  );

  if (!result) throw new Error(`Failed to create FIRST_CALL task for lead ${leadId}`);

  const taskId = result.id;
  await assignTask(taskId);
  return taskId;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function updateLeadState(
  leadId: number,
  state: LeadState,
  actorId?: number,
  outcome?: string
): Promise<void> {
  const current = await queryOne<{ state: string }>(`SELECT state FROM leads WHERE id = $1`, [leadId]);
  await query(`UPDATE leads SET state = $1, updated_at = NOW() WHERE id = $2`, [state, leadId]);
  logLeadEvent({
    leadId,
    action: 'STATE_CHANGED',
    fromState: current?.state ?? null,
    toState: state,
    actorId: actorId ?? null,
    metadata: outcome ? { outcome } : {},
  });
}

async function createNextTask(
  leadId: number,
  prevTaskId: number,
  type: TaskType,
  dueAt: string
): Promise<number> {
  const prevTask = await queryOne<{ order_id: number | null }>(
    `SELECT order_id FROM tasks WHERE id = $1`,
    [prevTaskId]
  );

  const result = await queryOne<{ id: number }>(
    `INSERT INTO tasks (lead_id, order_id, type, status, due_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'PENDING', $4, NOW(), NOW()) RETURNING id`,
    [leadId, prevTask?.order_id ?? null, type, dueAt]
  );

  if (!result) throw new Error(`Failed to create ${type} task for lead ${leadId}`);

  const newTaskId = result.id;
  await assignTask(newTaskId);
  return newTaskId;
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function hoursFromNow(hours: number): string {
  return minutesFromNow(hours * 60);
}
