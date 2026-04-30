import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import { initSchema } from './db/database';
import authRouter from './routes/auth';
import omsRouter from './routes/oms';
import agentsRouter from './routes/agents';
import tasksRouter from './routes/tasks';
import leadsRouter from './routes/leads';
import managerRouter from './routes/manager';
import bucketsRouter from './routes/buckets';
import eventsRouter from './routes/events';
import { authenticate } from './middleware/auth';
import { releaseExpiredLocks } from './services/assignmentEngine';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const actor = req.user ? `user=${req.user.id}` : 'anon';
    console.log(
      `${new Date().toISOString()}  ${req.method.padEnd(6)} ${req.originalUrl.padEnd(45)} ${String(res.statusCode).padEnd(4)} ${ms}ms  [${actor}]`
    );
  });
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'OH-LSQ', db: 'neon-pg', time: new Date().toISOString() }));

app.use('/api/auth', authRouter);
app.use('/api/oms', omsRouter);
app.use('/api/agents', authenticate, agentsRouter);
app.use('/api/tasks', authenticate, tasksRouter);
app.use('/api/leads', authenticate, leadsRouter);
app.use('/api/manager', authenticate, managerRouter);
app.use('/api/buckets', authenticate, bucketsRouter);
app.use('/api/events', eventsRouter); // SSE — auth handled inside router

// Cron endpoint: called by Vercel cron every minute to release expired task locks.
// In local/traditional mode this is handled by setInterval below instead.
app.post('/api/cron/release-locks', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' }); return;
  }
  try {
    await releaseExpiredLocks();
    res.json({ ok: true, time: new Date().toISOString() });
  } catch (e) {
    console.error('Cron release-locks error:', e);
    res.status(500).json({ error: 'Failed' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Local / traditional server mode (not Vercel) ──────────────────────────────
// When deployed to Vercel, this file is imported as a module and `app` is the
// default export. Vercel never calls listen(). The schema is initialised lazily
// on the first request via the middleware below.
if (process.env.VERCEL !== '1') {
  async function start() {
    await initSchema();

    // Background job: release expired locks every 60 seconds (non-serverless only)
    setInterval(async () => {
      try { await releaseExpiredLocks(); } catch (e) { console.error('Lock release error:', e); }
    }, 60 * 1000);

    app.listen(PORT, () => {
      console.log(`🚀 OH-LSQ backend running on http://localhost:${PORT}`);
      console.log(`📋 Health: http://localhost:${PORT}/health`);
      console.log(`🐘 Database: Neon PostgreSQL`);
      console.log(`\nRun 'npm run seed' to populate with dummy data`);
    });
  }
  start().catch(err => { console.error('Failed to start server:', err); process.exit(1); });
} else {
  // Vercel: run schema migration once per cold start
  initSchema().catch(err => console.error('Schema init error:', err));
}

export default app;
