import { Pool, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected pg pool error:', err);
});

export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<import('pg').QueryResult<T>> => {
  return pool.query<T>(text, params);
};

export const queryOne = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | undefined> => {
  const res = await pool.query<T>(text, params);
  return res.rows[0];
};

export const queryAll = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> => {
  const res = await pool.query<T>(text, params);
  return res.rows;
};

export async function initSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('agent', 'manager')),
      city TEXT DEFAULT 'Bangalore',
      is_punched_in BOOLEAN DEFAULT FALSE,
      last_assigned_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES users(id),
      punched_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      punched_out_at TIMESTAMPTZ,
      duration_minutes NUMERIC
    );

    CREATE TABLE IF NOT EXISTS agent_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_group_members (
      group_id INTEGER NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (group_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      request_id TEXT UNIQUE NOT NULL,
      doctor_name TEXT,
      partner_name TEXT,
      prescription_url TEXT,
      oh_notes TEXT,
      state TEXT NOT NULL DEFAULT 'NEW' CHECK(state IN (
        'NEW','ATTEMPTING','CONNECTED','SCHEDULED',
        'CALLBACK_SCHEDULED','UNREACHABLE','CANCELLED'
      )),
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      oms_order_id TEXT UNIQUE NOT NULL,
      customer_name TEXT,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_age INTEGER,
      patient_gender TEXT,
      tests TEXT DEFAULT '[]',
      packages TEXT DEFAULT '[]',
      preferred_slot TEXT,
      order_value NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      order_id INTEGER REFERENCES orders(id),
      type TEXT NOT NULL CHECK(type IN ('FIRST_CALL','RETRY_CALL','CALLBACK','FUTURE_CALL')),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN (
        'PENDING','ASSIGNED','IN_PROGRESS','COMPLETED','ABANDONED'
      )),
      assigned_to INTEGER REFERENCES users(id),
      due_at TIMESTAMPTZ,
      locked_at TIMESTAMPTZ,
      lock_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS call_attempts (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      lead_id INTEGER NOT NULL REFERENCES leads(id),
      agent_id INTEGER NOT NULL REFERENCES users(id),
      outcome TEXT NOT NULL CHECK(outcome IN (
        'CONNECTED_SCHEDULED','CONNECTED_FOLLOW_UP','NO_ANSWER','BUSY',
        'SWITCHED_OFF','WRONG_NUMBER','CALL_LATER','NOT_INTERESTED','CONNECTED_WILL_PAY'
      )),
      notes TEXT,
      cancellation_reason TEXT,
      callback_time TIMESTAMPTZ,
      called_at TIMESTAMPTZ DEFAULT NOW(),
      duration_seconds INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS priority_buckets (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '{}',
      display_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id SERIAL PRIMARY KEY,
      request_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT DEFAULT 'received' CHECK(status IN ('received','processed','failed')),
      error_message TEXT,
      attempts INTEGER DEFAULT 0,
      received_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS lead_events (
      id SERIAL PRIMARY KEY,
      lead_id INTEGER REFERENCES leads(id),
      action TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT,
      actor_id INTEGER REFERENCES users(id),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_tasks_lead_id ON tasks(lead_id);
    CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);
    CREATE INDEX IF NOT EXISTS idx_call_attempts_lead_id ON call_attempts(lead_id);
    CREATE INDEX IF NOT EXISTS idx_lead_events_lead_id ON lead_events(lead_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_request_id ON webhook_events(request_id);
  `);

  // ── Incremental migrations (idempotent) ─────────────────────────────────────
  // sticky_agent_id: once a lead is assigned to an agent, all follow-up tasks
  // are preferentially routed back to the same agent (falls back to round-robin
  // if that agent is offline).
  await query(`
    ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS sticky_agent_id INTEGER REFERENCES users(id);
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_leads_sticky_agent ON leads(sticky_agent_id);
  `);

  console.log('✅ Schema initialized');
}

// ─── Audit helpers (fire-and-forget — never throw to caller) ─────────────────

export async function logLeadEvent(params: {
  leadId: number;
  action: string;
  fromState?: string | null;
  toState?: string | null;
  actorId?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO lead_events (lead_id, action, from_state, to_state, actor_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.leadId,
        params.action,
        params.fromState ?? null,
        params.toState ?? null,
        params.actorId ?? null,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
  } catch (e) {
    console.error('Failed to write lead_event:', e);
  }
}

export async function logWebhookReceived(requestId: string, payload: unknown): Promise<number | null> {
  try {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO webhook_events (request_id, payload) VALUES ($1, $2) RETURNING id`,
      [requestId, JSON.stringify(payload)]
    );
    return row?.id ?? null;
  } catch (e) {
    console.error('Failed to log webhook_event:', e);
    return null;
  }
}

export async function updateWebhookEvent(
  id: number,
  status: 'processed' | 'failed',
  errorMessage?: string
): Promise<void> {
  try {
    await query(
      `UPDATE webhook_events
       SET status = $1, error_message = $2, processed_at = NOW(), attempts = attempts + 1
       WHERE id = $3`,
      [status, errorMessage ?? null, id]
    );
  } catch (e) {
    console.error('Failed to update webhook_event:', e);
  }
}

export default pool;
