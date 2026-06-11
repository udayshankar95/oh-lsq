import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser } from '../types';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  let decoded: unknown;

  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const d = decoded as any;
  if (!d || typeof d.id !== 'number' || !Number.isInteger(d.id) || d.id <= 0 ||
      !['agent', 'manager'].includes(d.role) || typeof d.email !== 'string') {
    res.status(401).json({ error: 'Invalid token payload' });
    return;
  }

  req.user = decoded as AuthUser;
  next();
}

export function requireManager(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'manager') {
    res.status(403).json({ error: 'Manager access required' });
    return;
  }
  next();
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user as object, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}
