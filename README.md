# OH-LSQ — Orange Health Lead Scheduling & Queue Engine

Internal calling operations platform for the Orange Health doctor-sales / OMT (Order Management Team).

## Quick Start

### Backend

```bash
cd backend
npm install
npm run seed      # populate with demo data
npm run dev       # starts on http://localhost:3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev       # starts on http://localhost:3000
```

---

## Login Credentials

| Role    | Email              | Password    |
|---------|--------------------|-------------|
| Manager | manager1@oh.in     | password123 |
| Manager | manager2@oh.in     | password123 |
| Agent   | agent1@oh.in       | password123 |
| Agent   | agent2@oh.in       | password123 |
| Agent   | agent3@oh.in       | password123 |
| Agent   | agent4@oh.in       | password123 (punched out) |
| Agent   | agent5@oh.in       | password123 |

---

## Architecture

```
frontend/   React + TypeScript + Tailwind (Vite, React Router)
backend/    Node.js + Express + TypeScript + SQLite (better-sqlite3)
```

### Key API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | JWT login |
| GET  | /api/auth/me | Current user |
| POST | /api/oms/event | OMS READY_FOR_CALLING webhook |
| GET  | /api/tasks/my-queue | Agent's prioritized task queue |
| POST | /api/tasks/:id/start | Lock task (10 min) |
| POST | /api/tasks/:id/outcome | Submit call outcome |
| POST | /api/agents/punch-in | Start shift |
| POST | /api/agents/punch-out | End shift |
| GET  | /api/manager/dashboard | Metrics overview |
| GET  | /api/manager/agents | Agent stats + session times |
| GET  | /api/manager/missed-followups | Overdue tasks |
| POST | /api/manager/leads/:id/reassign | Reassign lead to agent |
| GET  | /api/leads | Paginated lead list with search |
| GET  | /api/buckets | Priority bucket config |
| PUT  | /api/buckets/reorder/apply | Save new bucket order |

### OMS Event Payload

```json
POST /api/oms/event
{
  "request_id": "REQ-1234",
  "doctor_name": "Dr. Arvind Kumar",
  "partner_name": "Apollo Clinic",
  "prescription_url": "https://...",
  "oh_notes": "Priority patient",
  "orders": [
    {
      "order_id": "ORD-5678",
      "customer_name": "Rahul Sharma",
      "patient_name": "Rahul Sharma",
      "patient_phone": "9876543210",
      "patient_age": 38,
      "patient_gender": "Male",
      "tests": ["CBC", "Lipid Profile"],
      "packages": ["Full Body Checkup"],
      "preferred_slot": "2026-03-19T08:00:00+05:30",
      "order_value": 1500
    }
  ]
}
```

### Call Outcome → System Action

| Outcome | Lead State | Next Task |
|---------|-----------|-----------|
| CONNECTED_SCHEDULED | SCHEDULED | None |
| CONNECTED_FOLLOW_UP | CONNECTED | RETRY_CALL in 30 min |
| NO_ANSWER / BUSY / SWITCHED_OFF | ATTEMPTING | RETRY_CALL in 15 min (or UNREACHABLE after 3 attempts) |
| CALL_LATER | CALLBACK_SCHEDULED | CALLBACK at chosen time |
| NOT_INTERESTED / WRONG_NUMBER | CANCELLED | None |
| CONNECTED_WILL_PAY | CONNECTED | FUTURE_CALL in 2 hours |

---

## Postman Collection

Import `backend/postman/OH-LSQ.postman_collection.json` into Postman.

1. Run **Login (Manager)** → token auto-saved to collection variable
2. Run **Login (Agent)** → agent token auto-saved
3. Use **Ingest Single-Patient Request** to create a new lead
4. Use **My Queue** (as agent) to see assigned tasks

---

## Features

### Agent View
- Prioritized task queue (overdue callbacks → callbacks → stale new → new)
- Full call screen with patient info, call history, OH notes, prescription link
- OMS deep-link (opens request in OMS: `https://oms.orangehealth.in/request/{id}`)
- Call icon (tel: link for click-to-call)
- 9 standardized outcomes with auto-recall scheduling
- Punch in/out with live indicator

### Manager View
- **Dashboard** — lead pipeline, call metrics, conversion rate, active agents, alerts
- **Agents** — live punch-in status, active hours today, calls/conversions per agent
- **Leads** — searchable/filterable table with reassignment
- **Queue Config** — drag-and-drop priority buckets with condition editor

### Automation
- Round-robin task assignment to punched-in agents
- Auto-retry scheduling based on call outcome
- Task locking (10 min) to prevent duplicate work
- Expired lock release (runs every 60s)
- Tasks released back to queue when agent punches out
