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

export default router;
