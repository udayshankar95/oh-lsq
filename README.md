# OLMS — Orange Lead Management System

An internal calling operations platform for the Orange Health agent team. OLMS sits between OMS and agents, ensuring every patient lead is called up to 3 times with zero manual follow-up.

**Live:** https://ohleadmanagement.vercel.app
**API:** https://backend-blue-eight-71.vercel.app
**Full guide:** See `OLMS_Overview_and_API_Guide.docx`

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
cp .env.example .env    # fill in DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID
npm run dev             # http://localhost:3001
npm run seed            # populate demo data
```

**Frontend**
```bash
cd frontend
npm install
npm run dev             # http://localhost:3000
```

---

## Environment variables

**Backend (`.env`)**

```
DATABASE_URL=postgresql://...?sslmode=require
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=8h
OMS_API_KEY=shared-key-for-oms-webhooks
GOOGLE_CLIENT_ID=your-google-oauth-client-id
NODE_ENV=production
```

**Frontend**

```
VITE_API_BASE_URL=https://your-backend-url.vercel.app
```

---

## Login (after seeding)

| Role | Email | Password |
|---|---|---|
| Manager | manager1@oh.in | password123 |
| Agent | agent1@oh.in | password123 |

For production: managers add team emails via **Manager → Users**, then everyone logs in with Google (`@orangehealth.in`).

---

## Key API endpoints

**OMS Integration** — requires `X-API-Key` header

| Method | Path | Description |
|---|---|---|
| POST | `/api/oms/event` | Create a lead from OMS request |
| PUT | `/api/oms/leads/:request_id` | Update patient/order details |
| POST | `/api/oms/leads/:request_id/cancel` | Cancel a lead |
| POST | `/api/oms/bulk` | Bulk create up to 500 leads |

**Agent** — requires `Authorization: Bearer <token>`

| Method | Path | Description |
|---|---|---|
| POST | `/api/agents/punch-in` | Start shift |
| POST | `/api/agents/punch-out` | End shift |
| GET | `/api/tasks/my-queue` | Prioritised task list |
| POST | `/api/tasks/:id/outcome` | Log call result |
| GET | `/api/agents/summary` | Day-by-day performance stats |

**Manager** — requires `Authorization: Bearer <token>`

| Method | Path | Description |
|---|---|---|
| GET | `/api/manager/dashboard` | Live metrics |
| GET | `/api/leads` | Lead list with filters |
| POST | `/api/manager/leads/:id/reassign` | Reassign to agent |
| GET | `/api/manager/users` | User + access list |
| POST | `/api/manager/users/allowed` | Grant access |

---

## Features

**Live today**
- OMS webhook ingestion (create / update / cancel) with idempotency
- Lead + task state machine with automatic retry and callback scheduling
- Agent queue UI with priority sorting, filter chips, outcome logging
- Round-robin + sticky agent assignment (concurrency-safe, 20 agents)
- Real-time notifications when OMS cancels a lead mid-call
- Manager dashboard: live stats, lead management, agent performance
- Google Sign In with manager-controlled access list
- Phone number masking (last 4 digits visible)
- Multi-lead source: B2C_OMT, D2C, D2C_CHAT
- Agent daily summary with CSV download
- Full audit trail

**Coming next**
- Business hours scheduling (hold after 11 PM, resume at 8 AM)
- SLA breach alerts
- Ozontel click-to-call
- Bulk reassign + CSV export
- WhatsApp/SMS reminders

---

## Deployment

The repo includes ready-to-use deployment configs:

- `render.yaml` — full Render deployment (backend + frontend, free tier)
- `backend/vercel.json` — Vercel serverless config
- `frontend/vercel.json` — Vercel SPA routing

Connect to Render or Vercel, add environment variables, deploy. Schema migrations run automatically on first server start.
