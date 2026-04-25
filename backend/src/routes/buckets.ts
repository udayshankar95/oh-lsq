import { Router, Request, Response } from 'express';
import { query, queryOne, queryAll } from '../db/database';
import { authenticate, requireManager } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  const buckets = await queryAll(`SELECT * FROM priority_buckets ORDER BY display_order ASC`);
  res.json(buckets.map((b: any) => ({ ...b, conditions: JSON.parse(b.conditions) })));
});

router.post('/', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const { name, conditions, display_order } = req.body;
  if (!name || !conditions) { res.status(400).json({ error: 'name and conditions are required' }); return; }

  const maxRow = await queryOne<{ m: number | null }>(`SELECT MAX(display_order) AS m FROM priority_buckets`);
  const maxOrder = maxRow?.m ?? 0;

  const bucket = await queryOne<any>(
    `INSERT INTO priority_buckets (name, conditions, display_order, is_active, created_by)
     VALUES ($1, $2, $3, TRUE, $4) RETURNING *`,
    [name, JSON.stringify(conditions), display_order ?? maxOrder + 1, req.user!.id]
  );
  res.status(201).json({ ...bucket, conditions: JSON.parse(bucket.conditions) });
});

router.put('/:id', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const bucketId = parseInt(req.params.id);
  const { name, conditions, is_active } = req.body;

  const bucket = await queryOne<any>(`SELECT * FROM priority_buckets WHERE id = $1`, [bucketId]);
  if (!bucket) { res.status(404).json({ error: 'Bucket not found' }); return; }

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
  if (conditions !== undefined) { sets.push(`conditions = $${idx++}`); params.push(JSON.stringify(conditions)); }
  if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(Boolean(is_active)); }

  if (sets.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  params.push(bucketId);
  const updated = await queryOne<any>(
    `UPDATE priority_buckets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  res.json({ ...updated, conditions: JSON.parse(updated.conditions) });
});

router.put('/reorder/apply', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const { order } = req.body as { order: { id: number; display_order: number }[] };
  if (!Array.isArray(order)) { res.status(400).json({ error: 'order must be an array' }); return; }

  for (const item of order) {
    await query(`UPDATE priority_buckets SET display_order = $1 WHERE id = $2`, [item.display_order, item.id]);
  }
  res.json({ message: 'Buckets reordered' });
});

router.delete('/:id', authenticate, requireManager, async (req: Request, res: Response): Promise<void> => {
  const result = await query(`DELETE FROM priority_buckets WHERE id = $1`, [parseInt(req.params.id)]);
  if ((result as any).rowCount === 0) { res.status(404).json({ error: 'Bucket not found' }); return; }
  res.json({ message: 'Bucket deleted' });
});

export default router;
