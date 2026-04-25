import { query, queryOne, logLeadEvent } from '../db/database';
import { CallOutcome, LeadState, TaskType } from '../types';
import { assignTask } from './assignmentEngine';

const RETRY_DELAY_MINUTES = 15;
const FOLLOW_UP_DELAY_MINUTES = 30;
const PAYMENT_REMINDER_MINUTES = 120;

export async function processOutcome(
  taskId: number,
  leadId: number,
  agentId: number,
  outcome: CallOutcome,
  notes: string | null,
  callbackTime: string | null,
  cancellationReason: string | null
): Promise<void> {
  // Mark task as completed
  await query(`UPDATE tasks SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [taskId]);

  // Increment attempt count
  await query(
    `UPDATE leads SET attempt_count = attempt_count + 1, updated_at = NOW() WHERE id = $1`,
    [leadId]
  );

  const lead = await queryOne<{ attempt_count: number; max_attempts: number }>(
    `SELECT attempt_count, max_attempts FROM leads WHERE id = $1`,
    [leadId]
  );

  if (!lead) return;

  switch (outcome) {
    case 'CONNECTED_SCHEDULED':
      await updateLeadState(leadId, 'SCHEDULED', agentId, outcome);
      break;

    case 'CONNECTED_FOLLOW_UP':
      await updateLeadState(leadId, 'CONNECTED', agentId, outcome);
      await createNextTask(leadId, taskId, 'RETRY_CALL', minutesFromNow(FOLLOW_UP_DELAY_MINUTES));
      break;

    case 'NO_ANSWER':
    case 'BUSY':
    case 'SWITCHED_OFF':
      if (lead.attempt_count >= lead.max_attempts) {
        await updateLeadState(leadId, 'UNREACHABLE', agentId, outcome);
      } else {
        await updateLeadState(leadId, 'ATTEMPTING', agentId, outcome);
        await createNextTask(leadId, taskId, 'RETRY_CALL', minutesFromNow(RETRY_DELAY_MINUTES));
      }
      break;

    case 'CALL_LATER': {
      await updateLeadState(leadId, 'CALLBACK_SCHEDULED', agentId, outcome);
      const cbTime = callbackTime || minutesFromNow(60);
      await createNextTask(leadId, taskId, 'CALLBACK', cbTime);
      break;
    }

    case 'NOT_INTERESTED':
    case 'WRONG_NUMBER':
      await updateLeadState(leadId, 'CANCELLED', agentId, outcome);
      break;

    case 'CONNECTED_WILL_PAY':
      await updateLeadState(leadId, 'CONNECTED', agentId, outcome);
      await createNextTask(leadId, taskId, 'FUTURE_CALL', minutesFromNow(PAYMENT_REMINDER_MINUTES));
      break;
  }
}

async function updateLeadState(
  leadId: number,
  state: LeadState,
  actorId?: number,
  outcome?: string
): Promise<void> {
  const current = await queryOne<{ state: string }>(`SELECT state FROM leads WHERE id = $1`, [leadId]);
  await query(`UPDATE leads SET state = $1, updated_at = NOW() WHERE id = $2`, [state, leadId]);
  // Fire-and-forget audit log — never blocks the caller
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

  const newTaskId = result!.id;
  await assignTask(newTaskId);
  return newTaskId;
}

export async function createFirstCallTask(leadId: number, orderId: number): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO tasks (lead_id, order_id, type, status, created_at, updated_at)
     VALUES ($1, $2, 'FIRST_CALL', 'PENDING', NOW(), NOW()) RETURNING id`,
    [leadId, orderId]
  );

  const taskId = result!.id;
  await assignTask(taskId);
  return taskId;
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}
