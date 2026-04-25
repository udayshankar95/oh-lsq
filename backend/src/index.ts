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
import { authenticate } from './middleware/auth';
import { releaseExpiredLocks } from './services/assignmentEngine';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// Request logger — prints: timestamp METHOD /path status Xms [user=N | anon]
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

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Global async error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await initSchema();

  // Background job: release expired locks every 60 seconds
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

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
