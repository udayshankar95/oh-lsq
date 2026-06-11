import { Router, Request, Response } from 'express';
import { query, queryOne, queryAll } from '../db/database';
import { authenticate, requireManager } from '../middleware/auth';
import { assignTask } from '../services/assignmentEngine';

const router = Router();

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const [
    totalLeadsRow, activeLeadsRow, scheduledTodayRow, unreachableRow,
    callsTodayRow, connectionsTodayRow, conversionsTodayRow,
    overdueRow, waiting24hRow, pendingRow, activeAgentsRow, stateBreakdown
  ] = await Promise.all([
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM leads`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM leads WHERE state IN ('NEW','ATTEMPTING','CALLBACK_SCHEDULED','CONNECTED')`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM leads WHERE state = 'SCHEDULED' AND updated_at::date = CURRENT_DATE`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM leads WHERE state = 'UNREACHABLE'`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM call_attempts WHERE called_at::date = CURRENT_DATE`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM call_attempts WHERE called_at::date = CURRENT_DATE AND outcome LIKE 'CONNECTED%'`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM call_attempts WHERE called_at::date = CURRENT_DATE AND outcome = 'CONNECTED_SCHEDULED'`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM tasks WHERE type = 'CALLBACK' AND due_at < NOW() AND status IN ('PENDING','ASSIGNED')`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM leads WHERE state IN ('NEW','ATTEMPTING') AND created_at <= NOW() - INTERVAL '24 hours'`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM tasks WHERE status = 'PENDING'`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM users WHERE role = 'agent' AND is_punched_in = TRUE`),
    queryAll<{ state: string; count: string }>(`SELECT state, COUNT(*)::text AS count FROM leads GROUP BY state`),
  ]);

  res.json({
    leads: {
      total: parseInt(totalLeadsRow?.c || '0'),
      active: parseInt(activeLeadsRow?.c || '0'),
      scheduled_today: parseInt(scheduledTodayRow?.c || '0'),
      unreachable: parseInt(unreachableRow?.c || '0'),
    },
    calls: {
      today: parseInt(callsTodayRow?.c || '0'),
      connections: parseInt(connectionsTodayRow?.c || '0'),
      conversions: parseInt(conversionsTodayRow?.c || '0'),
    },
    queue: {
      pending: parseInt(pendingRow?.c || '0'),
      overdue_callbacks: parseInt(overdueRow?.c || '0'),
      waiting_over_24h: parseInt(waiting24hRow?.c || '0'),
    },
    agents: { active: parseInt(activeAgentsRow?.c || '0') },
    state_breakdown: stateBreakdown.map(r => ({ state: r.state, count: parseInt(r.count) })),
  });
});

// ── Agents list with stats ────────────────────────────────────────────────────
router.get('/agents', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const agents = await queryAll(`
    SELECT
      u.id, u.name, u.email, u.city, u.is_punched_in,
      s.punched_in_at AS current_session_start,
      ROUND(COALESCE(EXTRACT(EPOCH FROM (NOW() - s.punched_in_at))/60, 0)::numeric, 1) AS active_minutes_today,
      COALESCE(prev.total_today_minutes, 0) AS closed_minutes_today,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = u.id AND t.status IN ('ASSIGNED','IN_PROGRESS'))::int AS open_tasks,
      (SELECT COUNT(*) FROM call_attempts ca WHERE ca.agent_id = u.id AND ca.called_at::date = CURRENT_DATE)::int AS calls_today,
      (SELECT COUNT(*) FROM call_attempts ca WHERE ca.agent_id = u.id AND ca.called_at::date = CURRENT_DATE AND ca.outcome = 'CONNECTED_SCHEDULED')::int AS conversions_today,
      (SELECT COUNT(*) FROM call_attempts ca WHERE ca.agent_id = u.id AND ca.called_at::date = CURRENT_DATE AND ca.outcome LIKE 'CONNECTED%')::int AS connections_today
    FROM users u
    LEFT JOIN agent_sessions s ON s.agent_id = u.id AND s.punched_out_at IS NULL
    LEFT JOIN (
      SELECT agent_id, ROUND(SUM(duration_minutes)::numeric, 1) AS total_today_minutes
      FROM agent_sessions
      WHERE punched_in_at::date = CURRENT_DATE AND punched_out_at IS NOT NULL
      GROUP BY agent_id
    ) prev ON prev.agent_id = u.id
    WHERE u.role = 'agent'
    ORDER BY u.is_punched_in DESC, u.name ASC
  `);

  const formatted = (agents as any[]).map(a => ({
    ...a,
    total_minutes_today: Math.round(
        (parseFloat(a.closed_minutes_today || '0') + (a.is_punched_in ? parseFloat(a.active_minutes_today || '0') : 0))
        * 10) / 10,
  }));

  res.json(formatted);
});

// ── Agent sessions ────────────────────────────────────────────────────────────
router.get('/agents/:id/sessions', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const agentId = parseInt(req.params.id);
  const { date } = req.query as { date?: string };

  let q = `SELECT * FROM agent_sessions WHERE agent_id = $1`;
  const params: unknown[] = [agentId];
  if (date) { q += ` AND punched_in_at::date = $2`; params.push(date); }
  q += ` ORDER BY punched_in_at DESC LIMIT 50`;

  const sessions = await queryAll(q, params);
  res.json(sessions);
});

// ── Reassign lead ─────────────────────────────────────────────────────────────
router.post('/leads/:id/reassign', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const leadId = parseInt(req.params.id);
  const { agent_id } = req.body as { agent_id: number };
  if (!agent_id) { res.status(400).json({ error: 'agent_id is required' }); return; }

  const agent = await queryOne<any>(`SELECT id FROM users WHERE id = $1 AND role = 'agent'`, [agent_id]);
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  const result = await query(
    `UPDATE tasks SET assigned_to = $1, status = 'ASSIGNED', locked_at = NULL, lock_expires_at = NULL, updated_at = NOW()
     WHERE lead_id = $2 AND status IN ('PENDING','ASSIGNED','IN_PROGRESS')`,
    [agent_id, leadId]
  );

  res.json({ message: 'Lead tasks reassigned', affected_tasks: (result as any).rowCount });
});

// ── Missed followups ──────────────────────────────────────────────────────────
router.get('/missed-followups', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const overdue = await queryAll(`
    SELECT t.id AS task_id, t.type, t.due_at, t.status,
      l.id AS lead_id, l.request_id, l.state, l.doctor_name,
      o.patient_name, o.patient_phone, o.customer_name,
      u.name AS assigned_agent
    FROM tasks t
    JOIN leads l ON t.lead_id = l.id
    LEFT JOIN orders o ON t.order_id = o.id
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.due_at < NOW() AND t.status IN ('PENDING','ASSIGNED','IN_PROGRESS')
    ORDER BY t.due_at ASC
  `);
  res.json(overdue);
});

// ── Queue health ──────────────────────────────────────────────────────────────
router.get('/queue-health', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const [byType, waiting4h, overdueCb] = await Promise.all([
    queryAll(`SELECT type, status, COUNT(*)::int AS count FROM tasks WHERE status IN ('PENDING','ASSIGNED','IN_PROGRESS') GROUP BY type, status`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM tasks t JOIN leads l ON t.lead_id = l.id WHERE t.type = 'FIRST_CALL' AND t.status IN ('PENDING','ASSIGNED') AND t.created_at <= NOW() - INTERVAL '4 hours'`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM tasks WHERE type = 'CALLBACK' AND due_at < NOW() AND status IN ('PENDING','ASSIGNED')`),
  ]);

  res.json({
    by_type: byType,
    waiting_first_call_over_4h: parseInt(waiting4h?.c || '0'),
    overdue_callbacks: parseInt(overdueCb?.c || '0'),
  });
});

// ── Agent Groups ──────────────────────────────────────────────────────────────

router.get('/groups', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const groups = await queryAll(`
    SELECT g.*, COUNT(gm.agent_id)::int AS member_count,
      u.name AS created_by_name
    FROM agent_groups g
    LEFT JOIN agent_group_members gm ON gm.group_id = g.id
    LEFT JOIN users u ON g.created_by = u.id
    GROUP BY g.id, u.name
    ORDER BY g.created_at DESC
  `);
  res.json(groups);
});

router.get('/groups/:id', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const groupId = parseInt(req.params.id);
  const group = await queryOne<any>(`SELECT * FROM agent_groups WHERE id = $1`, [groupId]);
  if (!group) { res.status(404).json({ error: 'Group not found' }); return; }

  const members = await queryAll(`
    SELECT u.id, u.name, u.email, u.city, u.is_punched_in, gm.added_at
    FROM agent_group_members gm
    JOIN users u ON gm.agent_id = u.id
    WHERE gm.group_id = $1
    ORDER BY u.name ASC
  `, [groupId]);

  res.json({ ...group, members });
});

router.post('/groups', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }

  const group = await queryOne<any>(
    `INSERT INTO agent_groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [name, description || null, req.user!.id]
  );
  res.status(201).json({ ...group, member_count: 0 });
});

router.put('/groups/:id', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const groupId = parseInt(req.params.id);
  const { name, description } = req.body;
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
  if (sets.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
  params.push(groupId);
  const updated = await queryOne<any>(`UPDATE agent_groups SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  if (!updated) { res.status(404).json({ error: 'Group not found' }); return; }
  res.json(updated);
});

router.delete('/groups/:id', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const result = await query(`DELETE FROM agent_groups WHERE id = $1`, [parseInt(req.params.id)]);
  if ((result as any).rowCount === 0) { res.status(404).json({ error: 'Group not found' }); return; }
  res.json({ message: 'Group deleted' });
});

router.post('/groups/:id/members', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const groupId = parseInt(req.params.id);
  const { agent_id } = req.body;
  if (!agent_id) { res.status(400).json({ error: 'agent_id is required' }); return; }

  const agent = await queryOne<any>(`SELECT id, name FROM users WHERE id = $1 AND role = 'agent'`, [agent_id]);
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

  await query(
    `INSERT INTO agent_group_members (group_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [groupId, agent_id]
  );
  res.json({ message: `${agent.name} added to group` });
});

router.delete('/groups/:id/members/:agentId', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const groupId = parseInt(req.params.id);
  const agentId = parseInt(req.params.agentId);
  await query(`DELETE FROM agent_group_members WHERE group_id = $1 AND agent_id = $2`, [groupId, agentId]);
  res.json({ message: 'Member removed' });
});

// ── User Management ───────────────────────────────────────────────────────────

// List all users in the system
router.get('/users', authenticate, requireManager, async (_req: Request, res: Response): Promise<void> => {
  const users = await queryAll(
    `SELECT id, name, email, role, city, is_punched_in, created_at FROM users ORDER BY role, name`
  );
  const allowed = await queryAll(`SELECT * FROM allowed_users ORDER BY added_at DESC`);
  res.json({ users, allowed_users: allowed });
});

// Add to allowed_users list (pre-register access before Google SSO login)
router.post('/users/allowed', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const { email, name, role } = req.body as { email: string; name: string; role: string };
  if (!email || !name || !['agent','manager'].includes(role)) {
    res.status(400).json({ error: 'email, name, and role (agent|manager) are required' }); return;
  }
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO allowed_users (email, name, role, added_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [email.toLowerCase().trim(), name.trim(), role, req.user!.id]
    );
    res.status(201).json({ id: row!.id, email, name, role });
  } catch (e: any) {
    if (e.message?.includes('unique')) { res.status(409).json({ error: 'Email already in allowed list' }); return; }
    throw e;
  }
});

// Remove from allowed_users
router.delete('/users/allowed/:id', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  await query(`DELETE FROM allowed_users WHERE id = $1`, [parseInt(req.params.id)]);
  res.json({ message: 'Removed' });
});

// Change role of an existing user
router.put('/users/:id/role', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const { role } = req.body as { role: string };
  if (!['agent','manager'].includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
  const user = await queryOne<{ id: number }>(`SELECT id FROM users WHERE id = $1`, [parseInt(req.params.id)]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  await query(`UPDATE users SET role = $1 WHERE id = $2`, [role, user.id]);
  res.json({ message: 'Role updated' });
});

export default router;
