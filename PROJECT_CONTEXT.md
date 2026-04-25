# OH-LSQ — Project Context & Memory Document
Generated: April 2026 | Use this file to resume work in any new chat session.

---

## 1. Project Goal

Build **OH-LSQ** (Orange Health Lead Scheduling & Queue Engine) — an internal operational platform that automates the outbound customer-calling workflow for doctor-generated diagnostic orders at Orange Health.

**Core loop:**
OMS fires webhook → OH-LSQ creates Lead + Task → assigns to punched-in agent (round-robin) → agent calls patient → logs outcome → system auto-schedules retry/callback → manager monitors in real-time.

**Key constraint:** OH-LSQ reads from OMS only. It does **not** write back to OMS in MVP.

---

## 2. Repository Structure

```
/Users/udayshankar/Documents/AIWorkshop/OH-LSQ2/
├── backend/                        # Node.js + TypeScript + Express
│   ├── src/
│   │   ├── index.ts                # App entry point, starts server, runs initSchema()
│   │   ├── db/
│   │   │   ├── database.ts         # Neon PostgreSQL pool, query helpers, initSchema(), webhook/lead event loggers
│   │   │   └── seed.ts             # Seeds users, leads, orders, tasks, call_attempts, groups
│   │   ├── routes/
│   │   │   ├── auth.ts             # POST /api/auth/login, GET /api/auth/me
│   │   │   ├── agents.ts           # POST /api/agents/punch-in|punch-out
│   │   │   ├── tasks.ts            # GET /api/tasks/my-queue, POST /api/tasks/:id/outcome|start|abandon
│   │   │   ├── leads.ts            # GET /api/leads (manager search + list)
│   │   │   ├── manager.ts          # GET /api/manager/dashboard|agents|leads; full agent groups CRUD
│   │   │   ├── oms.ts              # POST /api/oms/event (single), POST /api/oms/bulk
│   │   │   └── buckets.ts          # Priority bucket CRUD
│   │   ├── services/
│   │   │   ├── leadEngine.ts       # createLeadFromEvent() — idempotent lead + order creation
│   │   │   ├── taskEngine.ts       # processOutcome() — state machine, retry/callback scheduling
│   │   │   └── assignmentEngine.ts # assignTask() — round-robin, releaseExpiredLocks()
│   │   ├── middleware/
│   │   │   └── auth.ts             # JWT authenticate middleware
│   │   └── types/index.ts          # Shared TypeScript types
│   ├── .env                        # DATABASE_URL, JWT_SECRET, PORT, OMS_API_KEY
│   └── package.json
└── frontend/                       # React 18 + TypeScript + Vite + Tailwind
    └── src/
        ├── App.tsx                 # React Router routes for agent + manager layouts
        ├── contexts/
        │   ├── AuthContext.tsx      # user state, login(), logout(), refreshUser()
        │   └── ThemeContext.tsx     # dark/light mode toggle
        ├── layouts/
        │   ├── AgentLayout.tsx      # Navbar, punch-in modal on login, punch-in/out button
        │   └── ManagerLayout.tsx    # Sidebar nav: Dashboard, Agents, Leads, Queue Config, Groups
        ├── pages/
        │   ├── Login.tsx
        │   ├── agent/
        │   │   └── AgentQueue.tsx   # Task queue, compact radio outcome form, contextual fields
        │   └── manager/
        │       ├── Dashboard.tsx
        │       ├── AgentList.tsx
        │       ├── LeadList.tsx
        │       ├── QueueConfig.tsx  # Priority bucket drag-and-drop config
        │       └── AgentGroups.tsx  # Create/manage agent groups + members
        └── api/client.ts           # Axios instance with JWT header injection
```

---

## 3. Database: Neon PostgreSQL

**Connection string (in `backend/.env`):**
```
DATABASE_URL=postgresql://neondb_owner:npg_hHnTk6scX9tK@ep-round-surf-amjx1xqh-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

**Pool config:** `max: 20`, `ssl: { rejectUnauthorized: false }`, `idleTimeoutMillis: 30000`

### Tables

| Table | Purpose |
|-------|---------|
| `users` | Agents + managers. Has `is_punched_in BOOLEAN`, `last_assigned_at TIMESTAMPTZ` |
| `agent_sessions` | Punch-in/out time records |
| `agent_groups` | Named groups (e.g. Morning Shift) |
| `agent_group_members` | Many-to-many users↔groups |
| `leads` | One per OMS request. States: NEW→ATTEMPTING→CONNECTED→SCHEDULED/CALLBACK_SCHEDULED/UNREACHABLE/CANCELLED |
| `orders` | Patient + test details, linked to lead |
| `tasks` | Callable unit of work. Types: FIRST_CALL/RETRY_CALL/CALLBACK/FUTURE_CALL. Statuses: PENDING/ASSIGNED/IN_PROGRESS/COMPLETED/ABANDONED |
| `call_attempts` | Every outcome logged: outcome, notes, cancellation_reason, callback_time |
| `priority_buckets` | Manager-defined filter rules for queue ordering |
| `webhook_events` | Audit log of every OMS webhook received (status: received/processed/failed) |
| `lead_events` | Full audit trail of every lead state change |

### Query Helpers (database.ts)
```typescript
query(text, params)       // returns QueryResult
queryOne<T>(text, params) // returns T | undefined
queryAll<T>(text, params) // returns T[]
```
All async. Parameters use `$1, $2, ...` (PostgreSQL style).

---

## 4. Key Architecture Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Database | Neon PostgreSQL (serverless) | Migrated from SQLite. Neon auto-scales, no server to manage |
| ORM | None — raw pg queries | Simple helpers (`queryOne`/`queryAll`) sufficient for this scale |
| Auth | JWT (8h expiry), bcrypt passwords | Standard for internal tools |
| Assignment | Round-robin by `last_assigned_at ASC NULLS FIRST` | Fairest distribution; agents with NULL (newly punched in) go first |
| Task locking | `locked_at` + `lock_expires_at` (10 min) | Prevents two agents picking same task; background job releases expired locks every 60s |
| OMS webhook | Fire-and-forget with synchronous ACK | OMS sends and forgets; OH-LSQ responds in <200ms, processes async |
| API security | `X-API-Key` header on all `/api/oms/*` routes | Protects webhook from public abuse; key stored in `OMS_API_KEY` env var |
| Frontend polling | `setInterval` every 30 seconds on agent queue | New leads appear within 30s without WebSocket complexity |

---

## 5. API Reference

### Authentication (no API key needed)
```
POST /api/auth/login        { email, password } → { token, user }
GET  /api/auth/me           → user object (requires Bearer token)
```

### OMS Webhook (requires X-API-Key header)
```
POST /api/oms/event         Single lead creation
POST /api/oms/bulk          Bulk lead creation — body: { events: OmsEventPayload[] }, max 500
```

**Single event payload:**
```json
{
  "request_id": "REQ-001",          // required, unique
  "doctor_name": "Dr. Sharma",
  "partner_name": "Apollo",
  "oh_notes": "Fasting required",
  "orders": [{
    "order_id": "ORD-001",           // required
    "customer_name": "Anita Sharma", // required
    "patient_name": "Anita Sharma",  // required
    "patient_phone": "9876500001",   // required
    "patient_age": 38,
    "patient_gender": "Female",
    "tests": ["HbA1c", "CBC"],
    "packages": [],
    "preferred_slot": "7am-9am",
    "order_value": 950
  }]
}
```

**Curl example:**
```bash
curl -X POST http://localhost:3001/api/oms/event \
  -H "Content-Type: application/json" \
  -H "X-API-Key: oh-lsq-oms-api-key-2025" \
  -d '{ ... payload ... }'
```

### Agent Routes (Bearer token)
```
POST /api/agents/punch-in
POST /api/agents/punch-out
GET  /api/tasks/my-queue                    → agent's assigned tasks
POST /api/tasks/:id/start                   → lock task (10 min)
POST /api/tasks/:id/outcome                 → log call result
POST /api/tasks/:id/abandon                 → release task back to queue
```

**Outcome payload:**
```json
{
  "outcome": "CALL_LATER",
  "callback_time": "2026-04-20T10:00:00.000Z",
  "notes": "Optional text",
  "cancellation_reason": "Patient Refused"
}
```

### Manager Routes (Bearer token)
```
GET  /api/manager/dashboard
GET  /api/manager/agents
GET  /api/manager/leads
POST /api/manager/leads/:id/reassign        { agent_id }
GET  /api/manager/groups
POST /api/manager/groups                    { name, description }
PUT  /api/manager/groups/:id
DELETE /api/manager/groups/:id
POST /api/manager/groups/:id/members        { agent_id }
DELETE /api/manager/groups/:id/members/:agentId
```

---

## 6. Call Outcome State Machine

| Outcome | Lead State After | Next Task Created |
|---------|-----------------|-------------------|
| CONNECTED_SCHEDULED | SCHEDULED | None |
| CONNECTED_FOLLOW_UP | CONNECTED | FUTURE_CALL (agent picks time) |
| NO_ANSWER / BUSY / SWITCHED_OFF | ATTEMPTING | RETRY_CALL (if attempts < max_attempts) or UNREACHABLE |
| WRONG_NUMBER / NOT_INTERESTED | CANCELLED | None |
| CALL_LATER | CALLBACK_SCHEDULED | CALLBACK (at agent-specified time) |
| CONNECTED_WILL_PAY | CONNECTED | FUTURE_CALL |

**max_attempts default: 3**

---

## 7. Seed Data (npm run seed)

| Entity | Seeded |
|--------|--------|
| Users | 1 manager (`manager1@oh.in`), 5 agents (`agent1–5@oh.in`), all password: `password123` |
| Leads | 20 leads with varied states |
| Groups | Morning Shift (agents 1,2,3), Evening Shift (agents 4,5) |
| Agents punched in | agent1 (Anjali Rao), agent2 (Rohit Mehta), agent3 (Sneha Pillai), agent5 (Meena Iyer) |

---

## 8. Environment Setup

### Backend
```bash
cd backend
npm install
# .env already configured with Neon + JWT + OMS_API_KEY
npm run dev          # tsx watch — port 3001
npm run seed         # populate Neon with test data
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # Vite — port 3000
```

### Health check
```bash
curl http://localhost:3001/health
# → {"status":"ok","service":"OH-LSQ","db":"neon-pg"}
```

### Key env vars (backend/.env)
```
DATABASE_URL=postgresql://neondb_owner:npg_hHnTk6scX9tK@ep-round-surf-amjx1xqh-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
JWT_SECRET=oh-lsq-super-secret-jwt-key-2025
JWT_EXPIRES_IN=8h
PORT=3001
NODE_ENV=development
OMS_API_KEY=oh-lsq-oms-api-key-2025
```

---

## 9. Known Bugs / Issues

| Bug | Status | Details |
|-----|--------|---------|
| Punch-in modal not showing on fresh login | Open | Modal only shows when `is_punched_in = false`. Seed data starts all agents punched in, so modal never triggers on seeded accounts. To test: punch out via UI, then logout + login. |
| `total_minutes_today` string concatenation | Open | Manager agent list returns `"0268.4"` (two numbers concatenated as strings) instead of a numeric sum. SQL `COALESCE` type mismatch. Fix: cast both values to `NUMERIC` in the query. |
| OMS route not hot-reloading on tsx watch | Intermittent | After editing `oms.ts`, sometimes tsx doesn't reload. Restart backend manually: `pkill -f tsx && npm run dev` |
| API key check bypassed on old binary | Fixed | Was caused by tsx not reloading; restart fixes it |

---

## 10. Open / Pending Tasks

| Task | Priority | Notes |
|------|----------|-------|
| Fix `total_minutes_today` numeric concatenation bug | High | In `backend/src/routes/manager.ts`, the agent list query |
| Punch-in modal — improve for always-punched-in seed agents | Medium | Consider showing modal on every login, not just when `!is_punched_in` |
| Wire up `SELECT ... FOR UPDATE SKIP LOCKED` in assignment engine | Medium | Current round-robin works but isn't race-condition safe under high concurrency |
| Add lead audit log UI (lead_events table viewer) | Medium | Table exists in DB, no frontend yet |
| Add webhook_events retry UI for failed webhooks | Medium | Table exists, no UI or cron retry job yet |
| Confirm and fill baseline metrics in PRD v2.0 | High | All [TBD] / [X] fields in the PRD need real numbers from OMT call log export |
| Deploy backend (Railway / Render / Fly.io) | High | Not yet deployed; currently localhost only |
| Deploy frontend (Vercel / Netlify) | High | Not yet deployed |
| Add `SELECT ... FOR UPDATE SKIP LOCKED` to task assignment | Medium | For production safety under concurrent agent load |
| Agent groups scoping for assignment (city-based) | Low | Groups created but assignment engine doesn't filter by group yet |

---

## 11. PRD Status

- **v1.2** — original document (OH-LSQ.docx) — scores: Problem Statement 4/10, Metrics 3/10
- **v2.0** — reworked in this session with:
  - Quantified problem statement with source citation framework [A1–A6]
  - Metric formulas defined (3-attempt compliance, conversion rate, agent utilisation)
  - Guardrail metrics added (assignment lag, webhook failure rate, conversion drop alert)
  - Weasel words removed, prose sections replacing pure bullet lists
  - Sections 13A–13E consolidated into 11–13
  - Explicit Non-Goals section added (Section 19)
  - Appendix added (data sources + glossary)
  - All [TBD] baselines flagged for OMT team to fill by 15 April 2026
