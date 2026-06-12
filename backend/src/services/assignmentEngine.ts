import pool, { query, queryAll } from '../db/database';
import { config } from '../config';

// ─── assignTask ───────────────────────────────────────────────────────────────
// Assigns a PENDING task to an agent, honouring:
//
//   1. System-wide phone dedup — if ANY agent called a lead with this patient's
//      phone number within PHONE_DEDUP_WINDOW_MINUTES, the task stays PENDING
//      for the whole system (not just for that agent).  releaseExpiredLocks()
//      retries PENDING tasks periodically so the task is automatically assigned
//      once the window clears.
//   2. Sticky assignment — prefer the agent who first handled this lead.
//   3. Round-robin fallback — if no sticky agent is available, pick the
//      least-recently-assigned punched-in agent.
//   4. On first assignment for a lead, record that agent as sticky_agent_id.
//
// Concurrency: the entire select-then-update runs inside a single transaction
// with FOR UPDATE SKIP LOCKED on both the task row and the chosen agent row,
// guaranteeing no double-assignment under concurrent load.
//
export async function assignTask(taskId: number): Promise<number | null> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the task row and get lead context in one shot.
    const taskLock = await client.query<{ id: number; lead_id: number }>(
      `SELECT id, lead_id FROM tasks
       WHERE id = $1 AND status = 'PENDING'
       FOR UPDATE SKIP LOCKED`,
      [taskId]
    );

    if (taskLock.rows.length === 0) {
      await client.query('ROLLBACK');
      return null; // Already picked up by a concurrent call
    }

    const leadId = taskLock.rows[0].lead_id;

    // ── Fetch patient phone for this lead ───────────────────────────────────
    const phoneRow = await client.query<{ patient_phone: string }>(
      `SELECT o.patient_phone FROM orders o WHERE o.lead_id = $1 LIMIT 1`,
      [leadId]
    );
    const patientPhone = phoneRow.rows[0]?.patient_phone ?? null;

    // ── System-wide phone dedup check ───────────────────────────────────────
    // If ANY agent called a lead with this phone within the dedup window,
    // leave the task PENDING for the entire system — not just for that agent.
    // The task will be retried automatically by releaseExpiredLocks once the
    // window clears.
    if (patientPhone) {
      const recentCall = await client.query<{ called: boolean }>(
        `SELECT EXISTS(
           SELECT 1
           FROM call_attempts ca
           JOIN tasks t  ON ca.task_id  = t.id
           JOIN orders o ON o.lead_id   = t.lead_id
           WHERE o.patient_phone = $1
             AND ca.called_at > NOW() - ($2 || ' minutes')::INTERVAL
         ) AS called`,
        [patientPhone, config.PHONE_DEDUP_WINDOW_MINUTES]
      );
      if (recentCall.rows[0]?.called) {
        await client.query('ROLLBACK');
        return null; // Hold PENDING — patient was called too recently
      }
    }

    // ── Fetch sticky agent for this lead ────────────────────────────────────
    const stickyRow = await client.query<{ sticky_agent_id: number | null }>(
      `SELECT sticky_agent_id FROM leads WHERE id = $1`,
      [leadId]
    );
    const stickyAgentId = stickyRow.rows[0]?.sticky_agent_id ?? null;

    let agentId: number | null = null;

    // ── Step 1: try the sticky agent ────────────────────────────────────────
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
    }

    // ── Step 2: round-robin fallback ────────────────────────────────────────
    if (agentId === null) {
      const agentResult = await client.query<{ id: number }>(
        `SELECT id FROM users
         WHERE role = 'agent' AND is_punched_in = TRUE
         ORDER BY last_assigned_at ASC NULLS FIRST, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
      );
      if (agentResult.rows.length > 0) {
        agentId = agentResult.rows[0].id;
      }
    }

    if (agentId === null) {
      await client.query('ROLLBACK');
      return null; // No agents available — leave task PENDING
    }

    // ── Assign the task ──────────────────────────────────────────────────────
    await client.query(
      `UPDATE tasks SET status = 'ASSIGNED', assigned_to = $1, updated_at = NOW()
       WHERE id = $2`,
      [agentId, taskId]
    );

    await client.query(
      `UPDATE users SET last_assigned_at = NOW() WHERE id = $1`,
      [agentId]
    );

    // ── Record sticky agent on first assignment ──────────────────────────────
    if (stickyAgentId === null) {
      await client.query(
        `UPDATE leads SET sticky_agent_id = $1
         WHERE id = $2 AND sticky_agent_id IS NULL`,
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

// ─── redistributePendingTasks ──────────────────────────────────────────────────
// Called when an agent punches in.  Assigns PENDING tasks in batches to avoid
// exhausting the connection pool.  Runs fire-and-forget from the punch-in
// handler so the HTTP response is not held open.
//
export async function redistributePendingTasks(): Promise<void> {
  const pendingTasks = await queryAll<{ id: number }>(
    `SELECT id FROM tasks
     WHERE status = 'PENDING'
     ORDER BY created_at ASC
     LIMIT $1`,
    [config.MAX_REASSIGN_BATCH]
  );

  for (const task of pendingTasks) {
    await assignTask(task.id);
  }
}

// ─── releaseAgentTasks ─────────────────────────────────────────────────────────
// Called on punch-out.  Releases the agent's ASSIGNED tasks back to PENDING,
// then redistributes them.  Does not touch IN_PROGRESS tasks (the agent may
// still be mid-call; lock expiry handles those).
//
export async function releaseAgentTasks(agentId: number): Promise<void> {
  await query(
    `UPDATE tasks
     SET status = 'PENDING', assigned_to = NULL,
         locked_at = NULL, lock_expires_at = NULL, updated_at = NOW()
     WHERE assigned_to = $1 AND status = 'ASSIGNED'`,
    [agentId]
  );
  // Fire-and-forget — punch-out response should not wait for redistribution
  redistributePendingTasks().catch(e => console.error('[releaseAgentTasks] redistribute error:', e));
}

// ─── releaseExpiredLocks ───────────────────────────────────────────────────────
// Called fire-and-forget on every GET /tasks/my-queue.
//
// 1. Reverts IN_PROGRESS tasks whose lock has expired back to ASSIGNED.
// 2. Retries PENDING tasks — this picks up tasks that were held back by the
//    phone-dedup window once enough time has passed.
//
export async function releaseExpiredLocks(): Promise<void> {
  await query(
    `UPDATE tasks
     SET status = 'ASSIGNED', locked_at = NULL, lock_expires_at = NULL, updated_at = NOW()
     WHERE status = 'IN_PROGRESS' AND lock_expires_at < NOW()`
  );
  // Retry PENDING tasks — handles dedup-held tasks becoming assignable again
  redistributePendingTasks().catch(e =>
    console.error('[releaseExpiredLocks] redistribute error:', e)
  );
}
