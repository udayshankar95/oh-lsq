import { Router, Request, Response } from 'express';
import { queryOne, queryAll } from '../db/database';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { q, state, doctor, page = '1', limit = '20' } = req.query as Record<string, string>;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions: string[] = [];
  const params: unknown[] = [];
  let pIdx = 1;

  if (q) {
    const like = `%${q}%`;
    conditions.push(`(l.request_id ILIKE $${pIdx} OR o.patient_name ILIKE $${pIdx+1} OR o.patient_phone ILIKE $${pIdx+2} OR o.customer_name ILIKE $${pIdx+3} OR l.doctor_name ILIKE $${pIdx+4})`);
    params.push(like, like, like, like, like);
    pIdx += 5;
  }
  if (state) { conditions.push(`l.state = $${pIdx++}`); params.push(state); }
  if (doctor) { conditions.push(`l.doctor_name ILIKE $${pIdx++}`); params.push(`%${doctor}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(DISTINCT l.id)::text AS count FROM leads l LEFT JOIN orders o ON o.lead_id = l.id ${where}`,
    params
  );
  const total = parseInt(countRow?.count || '0');

  const leads = await queryAll(
    `SELECT
      l.id, l.request_id, l.doctor_name, l.partner_name,
      l.state, l.attempt_count, l.max_attempts, l.created_at, l.updated_at,
      l.sticky_agent_id,
      o.oms_order_id, o.patient_name, o.patient_phone, o.customer_name,
      o.tests, o.packages, o.order_value, o.preferred_slot,
      (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id)::int AS task_count,
      (SELECT u.name FROM tasks t JOIN users u ON t.assigned_to = u.id
       WHERE t.lead_id = l.id AND t.status IN ('ASSIGNED','IN_PROGRESS')
       LIMIT 1) AS assigned_agent,
      (SELECT u.name FROM users u WHERE u.id = l.sticky_agent_id) AS sticky_agent_name
    FROM leads l
    LEFT JOIN orders o ON o.lead_id = l.id
    ${where}
    GROUP BY l.id, o.id
    ORDER BY l.updated_at DESC
    LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
    [...params, parseInt(limit), offset]
  );

  res.json({
    data: leads.map(formatLead),
    pagination: { total, page: parseInt(page), limit: parseInt(limit) },
  });
});

router.get('/:id', authenticate, async (req: Request, res: Response): Promise<void> => {
  const leadId = parseInt(req.params.id);

  const lead = await queryOne<any>(`SELECT * FROM leads WHERE id = $1`, [leadId]);
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

  const orders = await queryAll(`SELECT * FROM orders WHERE lead_id = $1`, [leadId]);
  const tasks = await queryAll(
    `SELECT t.*, u.name AS agent_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.lead_id = $1 ORDER BY t.created_at DESC`,
    [leadId]
  );
  const callHistory = await queryAll(
    `SELECT ca.*, u.name AS agent_name FROM call_attempts ca JOIN users u ON ca.agent_id = u.id WHERE ca.lead_id = $1 ORDER BY ca.called_at DESC`,
    [leadId]
  );

  const latestNote = (callHistory as any[]).find(c => c.notes)?.notes || null;

  res.json({
    ...lead,
    orders: (orders as any[]).map(o => ({ ...o, tests: safeJson(o.tests, []), packages: safeJson(o.packages, []) })),
    tasks,
    call_history: callHistory,
    latest_note: latestNote,
  });
});

function formatLead(row: any) {
  return { ...row, tests: safeJson(row.tests, []), packages: safeJson(row.packages, []) };
}

function safeJson(val: string | null, fallback: unknown) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

export default router;
