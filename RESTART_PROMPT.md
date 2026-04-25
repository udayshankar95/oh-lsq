# OH-LSQ — New Chat Restart Prompt
Paste everything below this line into a new chat.

---

You are continuing active development of **OH-LSQ** (Orange Health Lead Scheduling & Queue Engine), a full-stack internal tool built for Orange Health. Here is the full project context.

---

## What OH-LSQ Does

Automates the outbound customer-calling workflow for doctor-generated diagnostic orders. OMS fires a webhook → OH-LSQ creates a Lead + Task → assigns to a punched-in agent via round-robin → agent calls patient → logs outcome → system auto-schedules retries/callbacks → manager monitors everything in real-time.

**Hard constraint:** OH-LSQ reads from OMS only. Never writes back to OMS in MVP.

---

## Stack

- **Backend:** Node.js, TypeScript, Express, `pg` (PostgreSQL), tsx watch (dev server)
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, React Router v6
- **Database:** Neon PostgreSQL (serverless)
- **Auth:** JWT (8h), bcrypt

---

## Project Root

```
/Users/udayshankar/Documents/AIWorkshop/OH-LSQ2/
```

Backend runs on **port 3001**, frontend on **port 3000**.

---

## Environment Variables (`backend/.env`)

```
DATABASE_URL=postgresql://neondb_owner:npg_hHnTk6scX9tK@ep-round-surf-amjx1xqh-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
JWT_SECRET=oh-lsq-super-secret-jwt-key-2025
JWT_EXPIRES_IN=8h
PORT=3001
NODE_ENV=development
OMS_API_KEY=oh-lsq-oms-api-key-2025
```

---

## Key Files

| File | Role |
|------|------|
| `backend/src/db/database.ts` | Neon pool, `query`/`queryOne`/`queryAll` async helpers, `initSchema()`, `logWebhookReceived()`, `logLeadEvent()` |
| `backend/src/services/leadEngine.ts` | `createLeadFromEvent()` — idempotent lead + order creation |
| `backend/src/services/taskEngine.ts` | `processOutcome()` — full lead state machine |
| `backend/src/services/assignmentEngine.ts` | `assignTask()` — round-robin by `last_assigned_at ASC NULLS FIRST` |
| `backend/src/routes/oms.ts` | `POST /api/oms/event` and `POST /api/oms/bulk` — both require `X-API-Key` header |
| `backend/src/routes/tasks.ts` | Agent task queue, outcome logging, task locking |
| `backend/src/routes/manager.ts` | Dashboard, agent list, lead list, agent groups CRUD |
| `frontend/src/layouts/AgentLayout.tsx` | Punch-in modal on login, navbar punch-in/out button |
| `frontend/src/pages/agent/AgentQueue.tsx` | Compact radio-button outcome form, contextual fields |
| `frontend/src/pages/manager/AgentGroups.tsx` | Create/manage agent groups and members |

---

## Database Tables

`users`, `agent_sessions`, `agent_groups`, `agent_group_members`, `leads`, `orders`, `tasks`, `call_attempts`, `priority_buckets`, `webhook_events`, `lead_events`

All SQL uses PostgreSQL syntax: `$1 $2` params, `SERIAL`, `BOOLEAN`, `TIMESTAMPTZ`, `NOW()`, `ILIKE`, `RETURNING id`.

---

## Seed Logins (password: `password123` for all)

| Role | Email |
|------|-------|
| Manager | manager1@oh.in |
| Agent — Anjali Rao | agent1@oh.in |
| Agent — Rohit Mehta | agent2@oh.in |
| Agent — Sneha Pillai | agent3@oh.in |
| Agent — Kiran Bhat | agent4@oh.in |
| Agent — Meena Iyer | agent5@oh.in |

---

## OMS Webhook (how to create a lead)

```bash
curl -X POST http://localhost:3001/api/oms/event \
  -H "Content-Type: application/json" \
  -H "X-API-Key: oh-lsq-oms-api-key-2025" \
  -d '{
    "request_id": "REQ-001",
    "doctor_name": "Dr. Sharma",
    "partner_name": "Apollo",
    "orders": [{
      "order_id": "ORD-001",
      "customer_name": "Anita Sharma",
      "patient_name": "Anita Sharma",
      "patient_phone": "9876500001",
      "tests": ["CBC", "HbA1c"],
      "order_value": 950
    }]
  }'
```

Bulk: `POST /api/oms/bulk` with body `{ "events": [ ...array of above payloads... ] }`, max 500.

---

## Lead State Machine

```
NEW → ATTEMPTING → CONNECTED → SCHEDULED (done)
                             → CALLBACK_SCHEDULED → (retry later)
              → UNREACHABLE (3 attempts exhausted)
              → CANCELLED (wrong number / not interested)
```

---

## Known Bugs (open)

1. **`total_minutes_today` string bug** — manager agent list returns `"0268.4"` instead of a number. In `manager.ts`, the SQL `COALESCE` for session minutes concatenates strings instead of summing numerics.

2. **Punch-in modal doesn't show on fresh login for seeded agents** — seed data starts agents already punched in, so `is_punched_in = true` on login and the modal condition (`!user.is_punched_in`) is never met. To test: punch out via UI first.

3. **OMS route hot-reload intermittent** — tsx sometimes doesn't pick up changes to `oms.ts`. Fix: `pkill -f tsx && npm run dev`.

---

## Open Tasks (priority order)

1. **Fix `total_minutes_today` numeric bug** in `backend/src/routes/manager.ts`
2. **Deploy backend** to Railway / Render / Fly.io
3. **Deploy frontend** to Vercel / Netlify
4. **Add `SELECT ... FOR UPDATE SKIP LOCKED`** in `assignmentEngine.ts` for production concurrency safety
5. **Lead audit log UI** — `lead_events` table exists in DB, no frontend viewer yet
6. **Webhook retry UI** — `webhook_events` table exists, no cron retry job yet
7. **Group-scoped assignment** — agent groups exist but assignment engine doesn't filter by group yet
8. **Fill PRD v2.0 baselines** — all [TBD]/[X] placeholders need real numbers from OMT call log export

---

## PRD Status

- v1.2 = original doc (low scores on Problem Statement and Metrics)
- v2.0 = fully reworked in this session with quantified problems, metric formulas, guardrail metrics, non-goals section, and appendix. All [TBD] fields await real data from OMT team by 15 April 2026.

---

## How to Start Backend

```bash
cd /Users/udayshankar/Documents/AIWorkshop/OH-LSQ2/backend
npm run dev

# Health check:
curl http://localhost:3001/health
```

## How to Start Frontend

```bash
cd /Users/udayshankar/Documents/AIWorkshop/OH-LSQ2/frontend
npm run dev
```

## How to Re-seed Database

```bash
cd /Users/udayshankar/Documents/AIWorkshop/OH-LSQ2/backend
npm run seed
```

---

The full detailed context is also saved at:
`/Users/udayshankar/Documents/AIWorkshop/OH-LSQ2/PROJECT_CONTEXT.md`
