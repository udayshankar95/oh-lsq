# OLMS — Orange Lead Management System

An internal calling operations platform for the Orange Health agent team. OLMS sits between OMS and agents, ensuring every patient lead is called up to 3 times with zero manual follow-up.

**Live:** https://ohleadmanagement.vercel.app
**API:** https://backend-blue-eight-71.vercel.app
**Full guide:** `OLMS_Overview_and_API_Guide.docx`

---

## The problem it solves

Before OLMS, agents managed callbacks via WhatsApp and sticky notes. ~75% of unanswered patients received fewer than 3 call attempts. Managers had no real-time visibility. Missed leads were discovered only after revenue was lost.

**OLMS changes this:** agents no longer decide what to do next. The system decides for them.

---

## How it works

1. OMS sends a webhook when a new prescription request is created
2. OLMS creates a lead and assigns a first-call task to an available agent within 10 minutes
3. Agent calls the patient via OMS and logs the outcome
4. OLMS automatically schedules the next action — retry, callback, or close
5. Manager sees everything in real time

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Tailwind (Vite) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL (Neon) |
| Auth | JWT + Google OAuth 2.0 |
| Hosting | Vercel (frontend + backend) |

---

## Quick start

```bash
git clone https://github.com/OrangeHealthVibeCode/oh-lead-management-system.git
cd oh-lead-management-system
```

**Backend**
```bash
cd backend
npm install
cp .env.example .env    # fill in all required variables
npm run dev             # http://localhost:3001
npm run seed            # populate demo data
```

**Frontend**
```bash
cd frontend
npm install
npm run dev             # http://localhost:3000
```

Schema migrations run automatically on server startup.

---

## Environment variables

**Backend (`.env`)** — see `.env.example` for the full template

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL — use `sslmode=require` (no `channel_binding`) |
| `JWT_SECRET` | Long random string — required in production, no default |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `8h` |
| `OMS_API_KEY` | Shared secret sent by OMS in `X-API-Key` header |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `CORS_ORIGIN` | Frontend URL in production (e.g. `https://ohleadmanagement.vercel.app`) |
| `NODE_ENV` | `production` — missing required vars cause immediate startup failure |

**Frontend**

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Backend URL (e.g. `https://backend-blue-eight-71.vercel.app`) |

---

## Login

| Role | Email | Password |
|---|---|---|
| Manager | manager1@oh.in | password123 |
| Agent | agent1@oh.in | password123 |

Production: managers add team emails via **Manager → Users → Grant Access**, then everyone logs in with their `@orangehealth.in` Google account — account created automatically with the assigned role.

---

## Lead states

| State | Meaning |
|---|---|
| `NEW` | Received from OMS, not yet called |
| `ATTEMPTING` | First or subsequent call in progress |
| `CONNECTED` | Spoke to patient, follow-up pending |
| `CALLBACK_SCHEDULED` | Patient requested a specific callback time |
| `SCHEDULED` | Patient booked — lead complete |
| `UNREACHABLE` | Max attempts exhausted |
| `CANCELLED` | OMS or agent closed the lead |
| `SYSTEM_DUPLICATE` | Same patient phone already has an open lead — suppressed from queue, visible as "Other Leads" on the original lead |

---

## Key API endpoints

**OMS Integration** — `X-API-Key: <key>` header required

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/oms/event` | Create lead — auto-detects phone duplicates |
| `PUT` | `/api/oms/leads/:request_id` | Update patient/order details |
| `POST` | `/api/oms/leads/:request_id/cancel` | Cancel lead + abandon tasks (atomic) |
| `POST` | `/api/oms/bulk` | Bulk create up to 500 leads |

**Agent** — `Authorization: Bearer <token>` required

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/agents/punch-in` | Start shift — pending tasks assigned immediately |
| `POST` | `/api/agents/punch-out` | End shift — tasks redistributed async |
| `GET` | `/api/tasks/my-queue` | Prioritised queue (overdue callbacks → retries → first calls → payment follow-ups) |
| `POST` | `/api/tasks/:id/start` | Lock task for 10 min (atomic ASSIGNED → IN_PROGRESS) |
| `POST` | `/api/tasks/:id/outcome` | Log outcome — drives state machine |
| `GET` | `/api/agents/summary?from=&to=` | Day-by-day performance |

Task detail (`GET /api/tasks/:id`) returns:
- `call_history` — full timeline of prior attempts for this lead
- `other_leads` — other leads for the same patient phone (system duplicates + open leads)

**Manager** — `Authorization: Bearer <token>` required

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/manager/dashboard` | Live metrics |
| `GET` | `/api/leads?state=&attempt_count=&lead_source=&q=` | Lead list (max 100/page, SYSTEM_DUPLICATE excluded by default) |
| `POST` | `/api/manager/leads/:id/reassign` | Reassign to agent |
| `GET/POST/DELETE` | `/api/manager/users/allowed` | Manage access list |
| `PUT` | `/api/manager/users/:id/role` | Change user role |

---

## Features

**Live today**
- OMS webhook ingestion (create / update / cancel) with idempotency via `ON CONFLICT`
- Lead + task state machine — retry (4h), callback (user-scheduled), payment follow-up (2h)
- **System duplicate detection** — same patient phone already open → `SYSTEM_DUPLICATE`, no tasks, shown as "Other Leads" in agent view
- **Phone dedup window (1h)** — agent won't receive another lead for the same phone number within 1 hour
- **Call history always visible** — auto-expanded for 2nd/3rd attempt and payment follow-up tasks with "Last worked by X at Y" summary
- **Payment Follow-up** — `WILL_PAY_LATER` outcome creates a dedicated payment reminder task with distinct badge
- Agent queue with priority sorting, filter chips (First Call / Retry / Callback / Payment Follow-up / Overdue)
- Round-robin + sticky agent assignment (concurrency-safe via `SELECT FOR UPDATE SKIP LOCKED`)
- Real-time notifications when OMS cancels a lead mid-call
- Manager dashboard: live stats, lead management, agent performance
- Google Sign In with manager-controlled access list
- Phone number masking (last 4 digits visible only)
- Multi-lead source: `B2C_OMT`, `D2C`, `D2C_CHAT`
- Agent daily summary with CSV download
- Full audit trail — every call, state change, and assignment logged

**Coming next**
- Business hours scheduling (hold after 11 PM, resume at 8 AM)
- SLA breach alerts (first call >10 min after lead creation)
- Ozontel click-to-call integration
- Bulk reassign + CSV export
- WhatsApp/SMS reminders for confirmed appointments
- OMS write-back (sync confirmed slot back to OMS)

---

## Architecture notes

**`src/config.ts`** — single source of truth for all env vars and business constants. Process exits immediately in production if required vars are missing — no silent fallbacks.

**Transaction safety** — lead+order creation, lead cancellation, and task-lock transitions all run in dedicated transactions. `processOutcome` uses an atomic `UPDATE WHERE status IN ... RETURNING` gate to prevent double-processing under concurrent requests.

**Concurrency** — assignment uses `SELECT FOR UPDATE SKIP LOCKED` on both the task row and the chosen agent row. Phone-dedup exclusion list is computed per-assignment from `call_attempts` joined through to `orders`.

**Serverless notes** — schema migrations run on local `npm run dev` and apply to the shared Neon DB. Vercel deployments skip `initSchema()` to avoid cold-start timeouts. Lock cleanup runs fire-and-forget on every `GET /tasks/my-queue` call.

---

## Deployment

```
render.yaml          # full Render deployment (backend + frontend)
backend/vercel.json  # Vercel serverless config
frontend/vercel.json # Vercel SPA routing (all paths → index.html)
```

Connect to Render or Vercel, add the environment variables listed above, deploy.
