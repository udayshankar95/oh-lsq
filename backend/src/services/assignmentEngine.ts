import pool, { query, queryAll } from '../db/database';

// ─── assignTask ───────────────────────────────────────────────────────────────
// Assigns a PENDING task to an agent, honouring sticky assignment:
//
//   1. Look up the lead's sticky_agent_id (set when the lead was first assigned).
//   2. If that agent is currently punched in → assign directly to them.
//   3. Otherwise fall back to round-robin (least-recently-assigned punched-in agent).
//   4. On the very first assignment for a lead, record that agent as sticky_agent_id.
//
// Concurrency safety: the entire select-then-update runs inside a transaction
// with FOR UPDATE SKIP LOCKED on both the task row and the chosen agent row.
// This guarantees that under concurrent calls (e.g. 20 agents all getting tasks
// at once), no two processes assign the same task or pick the same agent.
//
export async function assignTask(taskId: number): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the task row and fetch its lead_id in one shot.
    // SKIP LOCKED: if another transaction already holds it we bail immediately.
    const taskLock = await client.query<{ id: number; lead_id: number }>(
      `SELECT id, lead_id FROM tasks
       WHERE id = $1 AND status = 'PENDING'
       FOR UPDATE SKIP LOCKED`,
      [taskId]
    );

    if (taskLock.rows.length === 0) {
      // Task was already picked up by a concurrent assignTask call
      await client.query('ROLLBACK');
      return null;
    }

    const leadId = taskLock.rows[0].lead_id;

    // Fetch sticky agent for this lead (may be NULL on first assignment)
    const stickyRow = await client.query<{ sticky_agent_id: number | null }>(
      `SELECT sticky_agent_id FROM leads WHERE id = $1`,
      [leadId]
    );
    const stickyAgentId: number | null = stickyRow.rows[0]?.sticky_agent_id ?? null;

    let agentId: number | null = null;

    // ── Step 1: try the sticky agent ─────────────────────────────────────────
    if (stickyAgentId !== null) {
      const stickyCheck = await client.query<{ id: number }>(
        `SELECT id FROM users
         WHERE id = $1 AND role = 'agent' AND is_punched_in = TRUE
         FOR UPDATE SKIP LOCKED`,
        [stickyAgentId]
      );
      if (stickyCheck.rows.length > 0) {
        agentId = stickyAgentId;
      }
      // If SKIP LOCKED skipped the row (rare concurrent lock), fall through to
      // round-robin — this is safe; the sticky preference is best-effort under
      // extreme concurrency.
    }

    // ── Step 2: round-robin fallback ─────────────────────────────────────────
    if (agentId === null) {
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

      agentId = agentResult.rows[0].id;
    }

    // ── Assign the task ───────────────────────────────────────────────────────
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

    // ── Record sticky agent on first assignment ───────────────────────────────
    // Only writes when sticky_agent_id IS NULL (i.e. first time this lead is assigned).
    // Subsequent assignments (retries, callbacks) will already have a value here.
    if (stickyAgentId === null) {
      await client.query(
        `UPDATE leads SET sticky_agent_id = $1 WHERE id = $2 AND sticky_agent_id IS NULL`,
        [agentId, leadId]
      );
    }

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
