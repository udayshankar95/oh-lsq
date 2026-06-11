import { Router, Request, Response } from 'express';
import { query, queryOne, queryAll } from '../db/database';
import { authenticate } from '../middleware/auth';
import { releaseAgentTasks, redistributePendingTasks } from '../services/assignmentEngine';

const router = Router();

router.post('/punch-in', authenticate, async (req: Request, res: Response): Promise<void> => {
  const agentId = req.user!.id;
  const user = await queryOne<{ is_punched_in: boolean }>(`SELECT is_punched_in FROM users WHERE id = $1`, [agentId]);

  if (user?.is_punched_in) {
    res.status(400).json({ error: 'Already punched in' });
    return;
  }

  await query(`UPDATE users SET is_punched_in = TRUE WHERE id = $1`, [agentId]);
  await query(`INSERT INTO agent_sessions (agent_id, punched_in_at) VALUES ($1, NOW())`, [agentId]);
  await redistributePendingTasks();

  res.json({ message: 'Punched in successfully', is_punched_in: true });
});

router.post('/punch-out', authenticate, async (req: Request, res: Response): Promise<void> => {
  const agentId = req.user!.id;
  const user = await queryOne<{ is_punched_in: boolean }>(`SELECT is_punched_in FROM users WHERE id = $1`, [agentId]);

  if (!user?.is_punched_in) {
    res.status(400).json({ error: 'Not currently punched in' });
    return;
  }

  const session = await queryOne<{ id: number; punched_in_at: string }>(
    `SELECT id, punched_in_at FROM agent_sessions WHERE agent_id = $1 AND punched_out_at IS NULL ORDER BY punched_in_at DESC LIMIT 1`,
    [agentId]
  );

  if (session) {
    const durationMinutes = (Date.now() - new Date(session.punched_in_at).getTime()) / 60000;
    await query(
      `UPDATE agent_sessions SET punched_out_at = NOW(), duration_minutes = $1 WHERE id = $2`,
      [durationMinutes, session.id]
    );
  }

  await query(`UPDATE users SET is_punched_in = FALSE WHERE id = $1`, [agentId]);
  await releaseAgentTasks(agentId);

  res.json({ message: 'Punched out successfully', is_punched_in: false });
});

router.get('/sessions', authenticate, async (req: Request, res: Response): Promise<void> => {
  const sessions = await queryAll(
    `SELECT * FROM agent_sessions WHERE agent_id = $1 ORDER BY punched_in_at DESC LIMIT 30`,
    [req.user!.id]
  );
  res.json(sessions);
});

// GET /api/agents/summary — day-by-day call stats for the authenticated agent
router.get('/summary', authenticate, async (req: Request, res: Response): Promise<void> => {
  const agentId = req.user!.id;
  const to   = (req.query.to   as string) || new Date().toISOString().slice(0, 10);
  const from = (req.query.from as string) || new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const callStats = await queryAll<{
    date: string; total: string; scheduled: string;
    connected_other: string; unreachable: string; callbacks: string; closed: string;
  }>(
    `SELECT DATE(called_at AT TIME ZONE 'Asia/Kolkata')::text AS date,
      COUNT(*)::text AS total,
      COUNT(CASE WHEN outcome = 'CONNECTED_SCHEDULED' THEN 1 END)::text AS scheduled,
      COUNT(CASE WHEN outcome IN ('CONNECTED_FOLLOW_UP','CONNECTED_WILL_PAY') THEN 1 END)::text AS connected_other,
      COUNT(CASE WHEN outcome IN ('NO_ANSWER','BUSY','SWITCHED_OFF') THEN 1 END)::text AS unreachable,
      COUNT(CASE WHEN outcome = 'CALL_LATER' THEN 1 END)::text AS callbacks,
      COUNT(CASE WHEN outcome IN ('NOT_INTERESTED','WRONG_NUMBER') THEN 1 END)::text AS closed
     FROM call_attempts
     WHERE agent_id = $1 AND called_at >= $2::date AND called_at < ($3::date + INTERVAL '1 day')
     GROUP BY 1 ORDER BY 1 ASC`,
    [agentId, from, to]
  );

  const assignedStats = await queryAll<{ date: string; assigned: string }>(
    `SELECT DATE(created_at AT TIME ZONE 'Asia/Kolkata')::text AS date, COUNT(*)::text AS assigned
     FROM tasks WHERE assigned_to = $1 AND created_at >= $2::date AND created_at < ($3::date + INTERVAL '1 day')
     GROUP BY 1 ORDER BY 1 ASC`,
    [agentId, from, to]
  );

  const map: Record<string, { date: string; assigned: number; worked: number; scheduled: number; connected_other: number; unreachable: number; callbacks: number; closed: number; }> = {};
  assignedStats.forEach(r => { map[r.date] = { date: r.date, assigned: Number(r.assigned), worked: 0, scheduled: 0, connected_other: 0, unreachable: 0, callbacks: 0, closed: 0 }; });
  callStats.forEach(r => {
    if (!map[r.date]) map[r.date] = { date: r.date, assigned: 0, worked: 0, scheduled: 0, connected_other: 0, unreachable: 0, callbacks: 0, closed: 0 };
    Object.assign(map[r.date], { worked: Number(r.total), scheduled: Number(r.scheduled), connected_other: Number(r.connected_other), unreachable: Number(r.unreachable), callbacks: Number(r.callbacks), closed: Number(r.closed) });
  });

  res.json({ from, to, rows: Object.values(map).sort((a, b) => a.date.localeCompare(b.date)) });
});

export default router;
