import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { addClient, removeClient, connectedCount } from '../sse';
import { AuthUser } from '../types';

const router = Router();

// ─── GET /api/events — Agent SSE subscription ─────────────────────────────────
// EventSource (browser API) cannot set custom headers, so the JWT token is
// passed as a query parameter: GET /api/events?token=<jwt>
//
// Event types the client should handle:
//   connected       — initial handshake, confirms auth
//   lead_updated    — OMS updated a lead the agent is currently working
//   lead_cancelled  — OMS cancelled a lead the agent is currently working
//   heartbeat       — keepalive every 25s (prevents proxy/load-balancer timeout)
//
router.get('/', (req: Request, res: Response): void => {
  // Auth: token via query param (EventSource can't set headers)
  const token = req.query.token as string;
  if (!token) { res.status(401).end(); return; }

  let user: AuthUser;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET || 'oh-lsq-super-secret-jwt-key-2025') as AuthUser;
  } catch {
    res.status(401).end();
    return;
  }

  const agentId = user.id;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Register this agent
  addClient(agentId, res);

  // Initial confirmation event
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ agentId, connectedAgents: connectedCount() })}\n\n`);

  // Heartbeat every 25s to keep proxies/load balancers from closing idle connections
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: {}\n\n`);
    } catch {
      clearInterval(heartbeat);
      removeClient(agentId);
    }
  }, 25_000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(agentId);
  });
});

export default router;
