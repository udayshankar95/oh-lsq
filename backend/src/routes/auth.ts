import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { queryOne } from '../db/database';
import { authenticate, signToken } from '../middleware/auth';
import { UserRow } from '../types';

const router = Router();

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = await queryOne<UserRow>(`SELECT * FROM users WHERE email = $1`, [email]);

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const authUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    city: user.city,
    is_punched_in: user.is_punched_in as unknown as boolean,
  };

  const token = signToken(authUser);
  res.json({ token, user: authUser });
});

router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  const user = await queryOne<Omit<UserRow, 'password_hash'>>(
    `SELECT id, name, email, role, city, is_punched_in FROM users WHERE id = $1`,
    [req.user!.id]
  );
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(user);
});

export default router;
