import { query, queryOne, queryAll } from '../db/database';

export async function assignTask(taskId: number): Promise<number | null> {
  const agents = await queryAll<{ id: number; last_assigned_at: string | null }>(
    `SELECT id, last_assigned_at FROM users
     WHERE role = 'agent' AND is_punched_in = TRUE
     ORDER BY last_assigned_at ASC NULLS FIRST, id ASC`
  );

  if (agents.length === 0) return null;

  const agent = agents[0];

  await query(
    `UPDATE tasks SET status = 'ASSIGNED', assigned_to = $1, updated_at = NOW() WHERE id = $2`,
    [agent.id, taskId]
  );

  await query(
    `UPDATE users SET last_assigned_at = NOW() WHERE id = $1`,
    [agent.id]
  );

  return agent.id;
}

export async function redistributePendingTasks(): Promise<void> {
  const pendingTasks = await queryAll<{ id: number }>(
    `SELECT id FROM tasks WHERE status = 'PENDING' ORDER BY created_at ASC`
  );

  for (const task of pendingTasks) {
    await assignTask(task.id);
  }
}

export async function releaseAgentTasks(agentId: number): Promise<void> {
  await query(
    `UPDATE tasks
     SET status = 'PENDING', assigned_to = NULL, locked_at = NULL, lock_expires_at = NULL, updated_at = NOW()
     WHERE assigned_to = $1 AND status IN ('ASSIGNED')`,
    [agentId]
  );

  await redistributePendingTasks();
}

export async function releaseExpiredLocks(): Promise<void> {
  await query(
    `UPDATE tasks
     SET status = 'ASSIGNED', locked_at = NULL, lock_expires_at = NULL, updated_at = NOW()
     WHERE status = 'IN_PROGRESS' AND lock_expires_at < NOW()`
  );
}
