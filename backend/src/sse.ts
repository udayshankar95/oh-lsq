import { Response } from 'express';

// ─── SSE Connection Manager ───────────────────────────────────────────────────
// Maintains a map of agentId → active SSE Response objects.
// Designed for 7–20 concurrent agents (in-process map is sufficient).
// At larger scale, swap the map for Redis pub/sub.

interface SseClient {
  agentId: number;
  res: Response;
}

// agentId → Response (one active connection per agent; new login replaces old)
const clients = new Map<number, Response>();

export function addClient(agentId: number, res: Response): void {
  // If agent already has an open connection, close it before replacing
  const existing = clients.get(agentId);
  if (existing) {
    try { existing.end(); } catch { /* already closed */ }
  }
  clients.set(agentId, res);
}

export function removeClient(agentId: number): void {
  clients.delete(agentId);
}

export function notifyAgent(
  agentId: number,
  eventType: string,
  data: unknown
): void {
  const res = clients.get(agentId);
  if (!res) return;
  try {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Connection dropped — clean up
    clients.delete(agentId);
  }
}

export function broadcastToAllAgents(eventType: string, data: unknown): void {
  for (const [agentId, res] of clients) {
    try {
      res.write(`event: ${eventType}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(agentId);
    }
  }
}

export function connectedCount(): number {
  return clients.size;
}
