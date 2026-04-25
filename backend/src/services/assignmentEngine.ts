import pool, { query, queryAll } from '../db/database';

// ─── assignTask ───────────────────────────────────────────────────────────────
// Assigns a PENDING task to the next available agent using round-robin
// (last_assigned_at ASC NULLS FIRST).
//
// Concurrency safety: the entire select-then-update runs inside a transaction
// with FOR UPDATE SKIP LOCKED on both the task row and the agent row.
// This guarantees that under concurrent calls (e.g. 8 agents all getting tasks
// at once), no two processes assign the same task or pick the same agent.
//
export async function assignTask(taskId: number): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the task row. SKIP LOCKED means if another transaction already
    // has it, we get zero rows back immediately (no waiting/deadlock).
    const taskLock = await client.query<{ id: number }>(
      `SELECT id FROM tasks
       WHERE id = $1 AND status = 'PENDING'
       FOR UPDATE SKIP LOCKED`,
      [taskId]
    );

    if (taskLock.rows.length === 0) {
      // Task was already picked up by a concurrent assignTask call
      await client.query('ROLLBACK');
      return null;
    }

    // Pick the least-recently-assigned punched-in agent.
    // FOR UPDATE SKIP LOCKED prevents two concurrent calls picking the same agent.
    const agentResult = await client.query<{ id: number }>(
      `SELECT id FROM users
       WHERE role = 'agent' AND is_punched_in = TRUE
       ORDER BY last_assigned_at ASC NULLS FIRST, id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    if (agentResult.rows.length === 0) {
      // No agents available right now — leave task PENDING
      await client.query('ROLLBACK');
      return null;
    }

    const agentId = agentResult.rows[0].id;

    await client.query(
      `UPDATE tasks
       SET status = 'ASSIGNED', assigned_to = $1, updated_at = NOW()
       WHERE id = $2`,
      [agentId, taskId]
    );

    await client.query(
      `UPDATE users SET last_assigned_at = NOW() WHERE id = $1`,
      [agentId]
    );

    await client.query('COMMIT');
    return agentId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── redistributePendingTasks ─────────────────────────────────────────────────
// Called when an agent punches in — assigns any PENDING tasks that are waiting.
//
export async function redistributePendingTasks(): Promise<void> {
  const pendingTasks = await queryAll<{ id: number }>(
    `SELECT id FROM tasks WHERE status = 'PENDING' ORDER BY created_at ASC`
  );
  // Sequential to avoid agent over-loading from burst parallel assigns
  for (const task of pendingTasks) {
    await assignTask(task.id);
  }
}

// ─── releaseAgentTasks ────────────────────────────────────────────────────────
// Called on punch-out — releases all of an agent's ASSIGNED tasks back to PENDING
// and redistributes them to remaining punched-in agents.
//
export async function releaseAgentTasks(agentId: number): Promise<void> {
  await query(
    `UPDATE tasks
     SET status = 'PENDING', assigned_to = NULL,
         locked_at = NULL, lock_expires_at = NULL, updated_at = NOW()
     WHERE assigned_to = $1 AND status IN ('ASSIGNED')`,
    [agentId]
  );
  await redistributePendingTasks();
}

// ─── releaseExpiredLocks ──────────────────────────────────────────────────────
// Background job (runs every 60s): revert IN_PROGRESS tasks whose 10-min lock
// has expired back to ASSIGNED so another agent can pick them up.
//
export async function releaseExpiredLocks(): Promise<void> {
  await query(
    `UPDATE tasks
     SET status = 'ASSIGNED', locked_at = NULL, lock_expires_at = NULL, updated_at = NOW()
     WHERE status = 'IN_PROGRESS' AND lock_expires_at < NOW()`
  );
}
