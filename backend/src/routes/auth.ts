import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { queryOne, query } from '../db/database';
import { authenticate, signToken } from '../middleware/auth';
import { UserRow } from '../types';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

// ── Google Sign In ────────────────────────────────────────────────────────────
// Verifies a Google ID token, checks the allowed_users list, and returns a JWT.
// On first login, auto-creates a user account with the role from allowed_users.
//
router.post('/google', async (req: Request, res: Response): Promise<void> => {
  const { credential } = req.body as { credential?: string };
  if (!credential) { res.status(400).json({ error: 'credential is required' }); return; }

  // Verify the token with Google
  let email: string;
  let name: string;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new Error('No email in token');
    email = payload.email.toLowerCase();
    name  = payload.name || email.split('@')[0];
  } catch {
    res.status(401).json({ error: 'Invalid Google token' }); return;
  }

  // Check allowed_users list (manager-controlled access)
  const allowed = await queryOne<{ role: string }>(
    `SELECT role FROM allowed_users WHERE email = $1`, [email]
  );

  // Also check if they already have an account (seeded users, or returning Google users)
  let user = await queryOne<UserRow>(`SELECT * FROM users WHERE email = $1`, [email]);

  if (!user && !allowed) {
    res.status(403).json({
      error: `Access denied. ${email} is not on the OLMS access list. Ask your manager to add you via the Users page.`,
    });
    return;
  }

  const role = (allowed?.role || user?.role || 'agent') as 'agent' | 'manager';

  if (!user) {
    // First-time Google login — create account automatically
    const randomHash = await bcrypt.hash(Math.random().toString(36) + Date.now(), 10);
    user = await queryOne<UserRow>(
      `INSERT INTO users (name, email, password_hash, role, city)
       VALUES ($1, $2, $3, $4, 'Bangalore') RETURNING *`,
      [name, email, randomHash, role]
    );
  } else if (allowed && user.role !== allowed.role) {
    // Role changed in allowed_users — sync it
    await query(`UPDATE users SET role = $1 WHERE id = $2`, [allowed.role, user.id]);
    user = { ...user, role: allowed.role as any };
  }

  const authUser = {
    id: user!.id,
    name: user!.name,
    email: user!.email,
    role: user!.role,
    city: user!.city,
    is_punched_in: user!.is_punched_in as unknown as boolean,
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
