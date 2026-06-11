# OH-LSQ — Lead Scheduling & Queue Engine
## Product Requirements Document · v3.0
**Owner:** Product · Orange Health
**Last Updated:** April 2026
**Status:** Active Development — MVP in Progress

---

## Table of Contents
1. [Problem Statement](#1-problem-statement)
2. [Business Impact](#2-business-impact)
3. [Solution Overview](#3-solution-overview)
4. [System Architecture](#4-system-architecture)
5. [Lead Lifecycle & State Machine](#5-lead-lifecycle--state-machine)
6. [Call Attempt Rules & SLAs](#6-call-attempt-rules--slas)
7. [Agent Assignment Engine](#7-agent-assignment-engine)
8. [Business Hours & Queue Scheduling](#8-business-hours--queue-scheduling)
9. [Agent Experience](#9-agent-experience)
10. [Manager Dashboard & Controls](#10-manager-dashboard--controls)
11. [OMS Integration](#11-oms-integration)
12. [Webhook Reliability](#12-webhook-reliability)
13. [Audit Trail & Data Retention](#13-audit-trail--data-retention)
14. [Phone Masking & Telephony](#14-phone-masking--telephony)
15. [Scalability Model](#15-scalability-model)
16. [MVP Scope](#16-mvp-scope)
17. [Success Metrics](#17-success-metrics)
18. [Open Items](#18-open-items)

---

## 1. Problem Statement

Orange Health's doctor-originated diagnostic workflow has a structural accountability gap. Once a doctor submits a prescription request, what happens next depends entirely on individual agent initiative — there is no system enforcing recall, sequencing follow-ups, or alerting a manager when a patient is dropped.

### What's happening today

```
Doctor submits request
        │
        ▼
 OMS: Request created
        │
        ▼
 Agent manually browses list
        │
     (no structure)
        │
   ┌────┴──────────────────────────────┐
   │  Agent tries once                 │
   │  No answer → writes note          │
   │  Forgets to call back             │
   │  Patient lost                     │
   └───────────────────────────────────┘
```

**The result:**
- ~75% of requests receive fewer than the required 3 call attempts
- Callbacks tracked in personal notes, sticky tabs, or WhatsApp threads
- Managers learn about missed leads after revenue is already lost
- No visibility into queue health, SLA compliance, or per-agent performance
- Scaling the team doesn't fix the problem — it multiplies it

### Root cause
The workflow depends on agent memory rather than system enforcement. There is no mechanism that guarantees a patient gets called back. This is a process design failure, not a people failure.

---

## 2. Business Impact

| Problem | Measurable Effect |
|---------|------------------|
| Missed recall attempts | Lost bookings — patient books elsewhere or drops off |
| No callback scheduling | High-intent leads (CALL_LATER) treated as cold leads |
| No manager visibility | Reactive management; problems discovered after the fact |
| Manual tracking overhead | Agents spend ~15–20% of time on recall management, not calling |
| No conversion attribution | No way to identify which doctor/clinic drives high-value leads |

**Conservative estimate:** If 3-attempt compliance improves from 25% to 90%, conversion rates are projected to increase 10–15%, directly recovering revenue from leads that currently go cold.

---

## 3. Solution Overview

OH-LSQ (Lead Scheduling & Queue Engine) is Orange Health's internal operational platform for outbound patient-calling workflows. It is the in-house equivalent of a purpose-built LeadSquared — designed specifically for the diagnostics calling use case.

### Design Principles

> **The system should be smarter than the agent's memory.**

1. **Agents work tasks, not requests.** The system generates the next action; agents never have to decide what to do next.
2. **The system owns recall sequencing.** No agent should have to remember to call back.
3. **Every event is audited.** Every state change, every call attempt, every assignment — recorded with a timestamp and actor.
4. **OMS is source of truth for orders. OH-LSQ is source of truth for calling workflows.** They stay loosely coupled via webhooks.

### What the system does

```
OMS                          OH-LSQ
─────                        ──────
Request READY_FOR_CALLING ──► Creates Lead
                             Creates FIRST_CALL task (within 10 min)
                             Assigns to agent (round-robin)
                             
Agent logs NO_ANSWER ───────► Schedules RETRY_CALL (4 hrs later)
                             or holds until business hours if after 11pm

Agent logs CALL_LATER ──────► Creates CALLBACK task at requested time
                             Sticky-assigned to same agent

OMS cancels lead ───────────► Abandons open task
                             Notifies active agent via SSE (real-time)
                             No new tasks created

Lead hits 3 attempts ───────► State → UNREACHABLE
                             Manager can reopen manually
```

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         OMS (source of truth)               │
│  Emits: lead created / lead updated / lead cancelled        │
└──────────────────────────┬──────────────────────────────────┘
                           │  Webhooks (X-API-Key auth)
                           │  Retry w/ exponential backoff
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    OH-LSQ Backend                           │
│                  Node.js + Express + TypeScript             │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Lead Engine  │  │ Task Engine  │  │Assignment Engine │  │
│  │              │  │              │  │                  │  │
│  │ State machine│  │ FIRST_CALL   │  │ Round-robin      │  │
│  │ Attempt rules│  │ RETRY_CALL   │  │ Sticky agent     │  │
│  │ SLA tracking │  │ CALLBACK     │  │ Group routing    │  │
│  │              │  │ FUTURE_CALL  │  │ FOR UPDATE       │  │
│  └──────────────┘  └──────────────┘  │ SKIP LOCKED      │  │
│                                      └──────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              SSE Push Layer                          │  │
│  │  Per-agent persistent connection                     │  │
│  │  Events: lead_updated / lead_cancelled / heartbeat   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Database: Neon PostgreSQL (serverless)                     │
└────────────────────────────┬────────────────────────────────┘
                             │  REST API + SSE
                    ┌────────┴────────┐
                    │                 │
          ┌─────────▼──────┐  ┌──────▼──────────┐
          │  Agent UI      │  │  Manager UI      │
          │                │  │                  │
          │  Task queue    │  │  Live dashboard  │
          │  Call detail   │  │  Agent stats     │
          │  Outcome form  │  │  Queue controls  │
          │  SSE listener  │  │  Bulk assign     │
          └────────────────┘  └──────────────────┘
```

**Tech stack:** Node.js / TypeScript / Express / Neon PostgreSQL / React / Vite / Tailwind CSS

**Concurrency safety:** Assignment engine uses `SELECT FOR UPDATE SKIP LOCKED` inside a transaction — prevents double-assignment even with 7–20 agents working simultaneously.

---

## 5. Lead Lifecycle & State Machine

```
                    ┌─────────────────┐
                    │       NEW       │ ◄── OMS: READY_FOR_CALLING
                    └────────┬────────┘
                             │ FIRST_CALL task assigned
                             ▼
                    ┌─────────────────┐
              ┌──── │   ATTEMPTING    │ ◄── Each retry attempt
              │     └────────┬────────┘
              │              │
      ┌───────┤    ┌─────────┴──────────┐
      │       │    │                    │
      ▼       │    ▼                    ▼
 CALLBACK_    │  Connected           RNR / BUSY /
 SCHEDULED ◄──┘  (answered)         SWITCHED_OFF
      │              │                  │
      │     ┌────────┴──────┐           │ (attempt < max)
      │     │               │           ▼
      │     ▼               ▼      RETRY in 4h
      │  SCHEDULED      CONNECTED  (or 15m for BUSY)
      │  (terminal)         │
      │                     │ Will Pay Later
      │                     ▼
      │               FUTURE_CALL
      │               (payment reminder 2h)
      │
      │  ── If patient cancels slot, OMS sends update ──►  re-open → ATTEMPTING
      │
 NOT_INTERESTED / WRONG_NUMBER
      │
      ▼
 CANCELLED (terminal)
 
 3 attempts exhausted
      │
      ▼
 UNREACHABLE (terminal — manager can manually reopen)
```

**Terminal states:** `SCHEDULED`, `CANCELLED`, `UNREACHABLE`
No new tasks are created after a terminal state. If OMS sends an update to a terminal-state lead, the system re-evaluates and can reopen the lead (see §11).

---

## 6. Call Attempt Rules & SLAs

All values below are **configurable** via admin settings. Defaults shown.

### 6.1 Attempt Configuration

| Parameter | Default | Configurable? |
|-----------|---------|---------------|
| Max attempts per lead | 3 | Yes |
| Time to first call (after lead creation) | 10 minutes | Yes |
| Retry delay — RNR (No Answer / Switched Off) | 4 hours | Yes |
| Retry delay — BUSY | 15 minutes | Yes |
| Follow-up delay — Connected (needs follow-up) | 30 minutes | Yes |
| Payment reminder delay — Will Pay | 2 hours | Yes |

### 6.2 SLA Breach Rules

```
Lead created in OH-LSQ
        │
        ▼ (configurable window, default 10 min)
   First call attempted?
        │
        ├── YES → SLA met ✓
        │
        └── NO → SLA BREACH
                  │
                  ├── Alert assigned agent
                  └── Alert manager
```

**Breach alerts sent to:** Assigned agent + Team Manager
**Alert channel (MVP):** In-app notification + manager dashboard flag
**Future:** Slack channel integration / configurable webhook

### 6.3 Outcome → Next Action Mapping

| Outcome | Lead State | Next Task | Delay |
|---------|-----------|-----------|-------|
| Connected – Scheduled | SCHEDULED (terminal) | None | — |
| Connected – Follow-up | CONNECTED | RETRY_CALL | 30 min |
| Connected – Will Pay | CONNECTED | FUTURE_CALL | 2 hours |
| No Answer | ATTEMPTING | RETRY_CALL | 4 hours |
| Switched Off | ATTEMPTING | RETRY_CALL | 4 hours |
| Busy | ATTEMPTING | RETRY_CALL | 15 min |
| Call Later | CALLBACK_SCHEDULED | CALLBACK | Agent-specified |
| Not Interested | CANCELLED (terminal) | None | — |
| Wrong Number | CANCELLED (terminal) | None | — |

If attempt count reaches max → lead moves to UNREACHABLE regardless of outcome.

### 6.4 Race Condition Protection

If OMS cancels a lead while an agent is actively on a call:

```
OMS: POST /cancel
        │
        ▼
OH-LSQ: Lead → CANCELLED
        Abandon open task
        Push SSE: lead_cancelled → active agent
        │
        ▼
Agent UI: Red banner appears
"This lead was cancelled by OMS while you were on the call.
Your call has been recorded. No further tasks created."
        │
        ▼
Agent submits outcome → 409 LEAD_TERMINAL returned
Call attempt recorded, no state change
```

---

## 7. Agent Assignment Engine

### 7.1 Assignment Priority

```
New task created
        │
        ▼
Does the lead have a previously assigned agent?
        │
        ├── YES → Is that agent punched in?
        │              │
        │              ├── YES → Assign to same agent (sticky)
        │              │
        │              └── NO → Assign randomly to any punched-in agent
        │
        └── NO (first ever assignment)
                       │
                       ▼
              Does OMS specify a target group or agent?
                       │
                       ├── Specific agent → assign directly
                       │
                       ├── Group → pick least-recently-assigned
                       │          agent in that group who is punched in
                       │
                       └── No preference → round-robin across
                                          all punched-in agents
```

**Sticky assignment rule:** The agent who makes the first call on a request owns all follow-up calls. If they're offline, the task floats to whoever is available — but when the original agent punches back in, future tasks for that lead revert to them.

### 7.2 Group-Based Routing

- OMS can specify a `group_id` or `agent_id` when creating a lead
- Groups are city/shift/specialty scoped — configured by managers
- If no group agent is online → fallback to any punched-in agent
- If nobody is punched in → task enters the **waiting queue**

### 7.3 Waiting Queue (No Agents Online)

```
Task created, no agents punched in
        │
        ▼
Task status → PENDING (waiting queue)

Agent punches in
        │
        ▼
Queue clearing runs:
  ├── Assigns up to 10 tasks within 15-minute window
  ├── If new tasks arrive in that window → can assign up to 10 more to this agent
  └── After 15 min → next batch runs, subsequent tasks distributed normally

Manager can see pending queue at all times (see §10)
Manager can manually assign any queued task to any agent
```

**Why rate-limited assignment?** Prevents a single agent from being overwhelmed when they punch in after a backlog builds up overnight.

### 7.4 Concurrency Safety

Assignment uses a PostgreSQL transaction with `SELECT FOR UPDATE SKIP LOCKED`:

```sql
BEGIN;
  -- Lock this task exclusively; skip if already being assigned
  SELECT id FROM tasks WHERE id = $1 AND status = 'PENDING'
  FOR UPDATE SKIP LOCKED;

  -- Lock least-recently-assigned available agent
  SELECT id FROM users
  WHERE role = 'agent' AND is_punched_in = TRUE
  ORDER BY last_assigned_at ASC NULLS FIRST
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  UPDATE tasks SET status = 'ASSIGNED', assigned_to = $agent_id ...
  UPDATE users SET last_assigned_at = NOW() ...
COMMIT;
```

Safe for 7–20 concurrent agents without double-assignment.

---

## 8. Business Hours & Queue Scheduling

### 8.1 Operating Hours

| Parameter | Default | Configurable? |
|-----------|---------|---------------|
| Day start | 8:00 AM | Yes (admin) |
| Day end | 11:00 PM | Yes (admin) |
| Timezone | IST | Yes (admin) |

### 8.2 After-Hours Task Handling

```
Retry task scheduled for 11:30 PM
        │
        ▼
Is scheduled time within operating hours?
        │
        ├── YES → Schedule normally
        │
        └── NO (after 11 PM)
                │
                ▼
        Hold task → reschedule to 8:00 AM next business day
        Task status: PENDING (time-locked)
        Surfaced to agents only after 8 AM
```

This prevents agents from receiving calls at midnight and prevents patients from being disturbed after operating hours.

### 8.3 Agent Availability
If no agents are punched in when a scheduled task fires, the task waits in the pending queue (see §7.3). Shift configuration is managed in the admin panel — the system does not auto-punch agents in/out.

---

## 9. Agent Experience

### 9.1 Task Queue (Left Panel)

- Tasks shown in priority order (see §9.4)
- Each card shows: patient name, phone, tests, task type badge, overdue indicator
- Auto-refreshes every 10 seconds + instant update via SSE on lead events
- Click card → opens call detail in right panel

### 9.2 Call Detail View (Right Panel)

```
┌─────────────────────────────────────────────┐
│  FIRST CALL · Attempt 1 of 3       × Close  │
├─────────────────────────────────────────────┤
│  [P]  Priya Sharma          [📞 9845001001] │
│       34 yrs · Female                       │
│                                             │
│  Doctor          Request                    │
│  Dr. Ramesh      REQ-DEMO-001 ↗            │
│  Fortis Diag.    ORD-DEMO-001               │
│                                             │
│  Order Value     Preferred Slot             │
│  ₹1,200          7am–9am                   │
│                                             │
│  Tests: [HbA1c] [Fasting Blood Sugar] [CBC] │
├─────────────────────────────────────────────┤
│  ⚠ Last Interaction                        │
│  "Patient in meeting, call after 3 PM"      │
├─────────────────────────────────────────────┤
│  📋 Call History (2 attempts) ▼             │
│  ─────────────────────────────────────      │
│  2. NO_ANSWER · Anjali · Apr 29, 3:14 PM    │
│  1. BUSY      · Rohit  · Apr 29, 1:02 PM    │
├─────────────────────────────────────────────┤
│  🗒 OH Note                                │
│  "Fasting required — 8 hours minimum"       │
└─────────────────────────────────────────────┘
```

### 9.3 Outcome Logging

Agents must select an outcome before the panel closes. Groups:

**Connected**
- ✅ Appointment Scheduled → lead terminal
- 🔄 Follow-up Needed → retry in 30 min
- 💳 Will Pay Later → payment reminder in 2 hours

**Unreachable**
- 📵 No Answer → retry in 4 hours
- 🚫 Busy / Engaged → retry in 15 minutes
- ⚡ Switched Off → retry in 4 hours

**Callback**
- 📅 Schedule Callback → agent picks date/time

**Close Lead**
- 🚫 Not Interested → cancellation reason required → terminal
- ❌ Wrong Number → terminal

Notes field (optional) — stored and shown to future agents on same lead.

### 9.4 Queue Prioritization Order

```
Priority 1 ── Overdue callbacks (CALLBACK, due_at < now)
Priority 2 ── Due-soon callbacks (CALLBACK, upcoming)
Priority 3 ── Overdue retries (RETRY_CALL, due_at < now)
Priority 4 ── Stale new requests (FIRST_CALL, created > 4h ago)
Priority 5 ── Standard new requests (FIRST_CALL)
Priority 6 ── Other retries (RETRY_CALL, not yet due)
```

Managers can define and reorder these buckets via a drag-and-drop admin UI. Custom conditions (e.g., `order_value > 2000`) can be added to buckets for value-based prioritization.

### 9.5 Real-Time Agent Alerts (SSE)

Each agent holds a persistent Server-Sent Events connection. No polling required.

| Event | Trigger | Agent UI |
|-------|---------|----------|
| `lead_updated` | OMS updates order while agent is on call | Amber banner: "This lead was updated — patient details may have changed" |
| `lead_cancelled` | OMS cancels lead while agent mid-call | Red banner: "This lead was cancelled by OMS. No further action needed." |
| `heartbeat` | Every 25 seconds | Silent — keeps connection alive through proxies |

---

## 10. Manager Dashboard & Controls

### 10.1 Live Metrics (Top of Dashboard)

| Metric | Description |
|--------|-------------|
| Active agents | Punched-in count, live |
| Queue depth | Pending + assigned tasks |
| Overdue callbacks | Callbacks past their due_at |
| SLA breaches today | First calls not made within configured window |
| Calls today | Total call attempts |
| Connections | Calls where patient answered |
| Conversions | CONNECTED_SCHEDULED outcomes |
| Waiting queue | Tasks with no assigned agent |

### 10.2 Per-Agent Performance Table

```
Agent          Status      Calls  Connected  Converted  Missed Followups  Time Today
─────────────────────────────────────────────────────────────────────────────────────
Anjali Rao     ● Active    24     11         6          0                 3h 12m
Rohit Mehta    ● Active    19     8          4          1                 2h 45m
Sneha Pillai   ○ Offline   31     14         9          0                 5h 00m
```

### 10.3 Queue Management View

Managers can see:
- **Pending queue** — tasks waiting for an agent (no one punched in)
- **Assigned queue** — tasks assigned but not yet in-progress
- **Overdue tasks** — tasks past their due_at

**Actions:**
- Assign any task to a specific agent (single)
- Multi-select → bulk assign to one agent or distribute across a group
- Re-assign in-progress tasks (with confirmation)
- Filter by: state, task type, doctor, clinic, date range, order value, city

### 10.4 Lead Filtering & Export

Managers (and agents) can filter leads by any combination of:
- Lead state (NEW / ATTEMPTING / SCHEDULED / UNREACHABLE / CANCELLED etc.)
- Task type
- Doctor / Partner / Clinic
- Date range (created, last attempt, due date)
- City
- Agent assigned
- Attempt count
- Order value range

**Export:** Filtered results exportable as CSV — includes all lead, order, and call history fields.

**Future:** On state transition (e.g., UNREACHABLE), trigger a configurable outbound action — Slack message to a channel, POST to an external webhook/API (e.g., CRM, analytics pipeline).

### 10.5 Lead Reopening

When a lead reaches UNREACHABLE, the manager can manually reopen it — this creates a new FIRST_CALL task and resets the attempt counter (configurable: reset to 0 or continue from current count). A full audit trail entry is created.

---

## 11. OMS Integration

### 11.1 Inbound API (OMS → OH-LSQ)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/oms/leads` | X-API-Key | Create lead + order; triggers FIRST_CALL |
| `PUT /api/oms/leads/:request_id` | X-API-Key | Update mutable lead/order fields |
| `POST /api/oms/leads/:request_id/cancel` | X-API-Key | Cancel lead; abandon open tasks; notify agent |

All endpoints are **idempotent** — duplicate `request_id` on create returns 200 without side effects.

### 11.2 Lead Reopening via OMS

If a lead is in a terminal state (SCHEDULED, CANCELLED, UNREACHABLE) and OMS sends an update that warrants reopening (e.g., patient cancels a booked slot, payment not received):

```
OMS: PUT /api/oms/leads/:request_id
     body: { "trigger_reopen": true, "reason": "slot_cancelled" }
        │
        ▼
OH-LSQ checks current lead state
        │
        ├── Terminal state → reopen lead
        │     Lead state → ATTEMPTING
        │     Create new FIRST_CALL task
        │     Assign to original agent if available, else round-robin
        │     Audit event logged
        │
        └── Non-terminal → update fields only
```

**Note:** Write-back from OH-LSQ to OMS (confirming slot, sending call notes) is deferred to Phase 2. API contract will be agreed with OMS team before Phase 2 development begins.

### 11.3 City & Routing Data

OMS includes `city` and optionally `group_id` / `agent_id` in the lead creation payload. OH-LSQ uses these for routing without needing city-level infrastructure separation. A single OH-LSQ instance handles all cities — routing is data-driven, not instance-driven.

---

## 12. Webhook Reliability

### 12.1 The Risk

If OH-LSQ is down when OMS fires a webhook, the lead is silently lost. This cannot happen in production.

### 12.2 Recommended Approach (LeadSquared pattern)

```
OMS fires webhook
        │
        ▼
OH-LSQ webhook endpoint receives event
        │
        ├── Success (200) → event processed, lead created
        │
        └── Failure (5xx / timeout)
                │
                ▼
        OMS retries with exponential backoff:
          Attempt 1: immediate
          Attempt 2: 30 seconds
          Attempt 3: 2 minutes
          Attempt 4: 10 minutes
          Attempt 5: 30 minutes
          After 5 failures → Dead Letter Queue (DLQ)
                │
                ▼
        DLQ: Stored in OMS with status = FAILED
        Alert: Slack / PagerDuty notification to on-call
        Manual retry available from OMS admin panel
```

### 12.3 At-Least-Once Delivery Guarantee

OH-LSQ makes all webhook endpoints **idempotent** via `request_id` uniqueness. OMS can safely retry without creating duplicate leads.

### 12.4 Reconciliation Endpoint (Recommended)

```
GET /api/oms/sync?since=<timestamp>
```

Returns all leads OH-LSQ has created since a given time. OMS can call this on startup or on a daily cron to reconcile state — catch any webhooks that were lost during downtime.

---

## 13. Audit Trail & Data Retention

### 13.1 What's Recorded

Every action in the system generates an audit event:

| Event | Data Recorded |
|-------|---------------|
| Lead created | timestamp, source (OMS), request_id |
| Lead state changed | from_state, to_state, actor (agent/system/OMS), timestamp |
| Task created | task type, due_at, assigned_to |
| Task assigned | agent_id, assignment_method (round-robin/sticky/manual) |
| Call attempt | outcome, notes, agent, timestamp |
| Task abandoned | reason |
| Lead reopened | actor, reason |
| Bulk reassign | manager_id, task_ids, new_agent |

### 13.2 Where Agents & Managers See It

Audit trail is visible inline in the lead detail view — accessible to both agents and managers:

```
┌─────────────────────────────────────────────┐
│  Timeline                                   │
│  ──────────────────────────────────────     │
│  Apr 29, 9:02 AM  Lead created (OMS)        │
│  Apr 29, 9:08 AM  Assigned to Anjali Rao    │
│  Apr 29, 9:15 AM  Called — No Answer        │
│                   Note: "Phone rang 6x"     │
│  Apr 29, 1:14 PM  Retry assigned to Anjali  │
│  Apr 29, 1:20 PM  Called — Busy             │
│  Apr 29, 5:20 PM  Callback scheduled        │
│                   by Anjali Rao             │
└─────────────────────────────────────────────┘
```

### 13.3 Retention Policy

| Data | Retention | After expiry |
|------|-----------|-------------|
| Lead + order records | 3 months active | Archived to cold storage |
| Call attempt records | 3 months active | Archived |
| Audit / event log | 3 months active | Archived |
| Agent session data | 3 months active | Archived |

Archived data queryable on request (not surfaced in UI by default).

---

## 14. Phone Masking & Telephony

### 14.1 MVP (Current)
Full phone number displayed and clickable (tel: link). Agent's device handles the call. No telephony integration.

### 14.2 Phase 2 — Ozontel Integration
When Ozontel click-to-call is integrated:
- Phone number masked in UI — only last 4 digits shown (e.g., ●●●●●●0001)
- Call initiated through Ozontel SIP layer — agent dials via browser/softphone
- Caller ID presented to patient is Orange Health's outbound number (not agent's personal number)
- Call recording (subject to compliance approval) — stored against call attempt

---

## 15. Scalability Model

### 15.1 Current Architecture (MVP — up to ~25 agents)

| Layer | Technology | Ceiling |
|-------|-----------|---------|
| Database | Neon PostgreSQL (serverless) | Scales automatically |
| Assignment locking | SELECT FOR UPDATE SKIP LOCKED | Safe to ~25 concurrent agents |
| SSE connections | In-process Map (per Node.js instance) | ~50 concurrent agents |
| API server | Single Node.js process | ~50 RPS comfortable |

### 15.2 Phase 2 Scale Path (~50–200 agents)

| What changes | Why |
|-------------|-----|
| SSE layer → Redis pub/sub | In-process Map doesn't survive multi-instance Node deploys |
| Assignment → queue worker | Separate worker process handles task distribution at scale |
| Node.js → horizontally scaled | Multiple instances behind a load balancer |

The **data model does not need to change** for any of this. City routing, group routing, sticky assignment — all already modelled. The upgrade path is infrastructure, not schema.

### 15.3 Multi-City
Single OH-LSQ instance serves all cities. City data flows through from OMS on each lead. Agent groups are city-scoped. No separate deployments needed per city.

---

## 16. MVP Scope

### In Scope

| Feature | Status |
|---------|--------|
| OMS webhook: create lead | ✅ Built |
| OMS webhook: update lead | ✅ Built |
| OMS webhook: cancel lead | ✅ Built |
| Lead + task creation | ✅ Built |
| Retry scheduling (all outcomes) | ✅ Built |
| Round-robin agent assignment | ✅ Built |
| Sticky agent assignment | 🔲 Planned |
| Concurrent assignment safety (SKIP LOCKED) | ✅ Built |
| Terminal state race condition protection | ✅ Built |
| Agent queue view | ✅ Built |
| Call detail with history | ✅ Built |
| Outcome logging | ✅ Built |
| Real-time SSE notifications | ✅ Built |
| Manager dashboard (live stats) | ✅ Built |
| Punch in/out | ✅ Built |
| Priority bucket config | 🔲 Planned |
| Waiting queue (no agents online) | 🔲 Planned |
| Business hours scheduling | 🔲 Planned |
| SLA breach alerting | 🔲 Planned |
| Lead filtering + CSV export | 🔲 Planned |
| Bulk assign (manager) | 🔲 Planned |
| Audit trail UI | 🔲 Planned |
| Lead reopen (manager) | 🔲 Planned |
| Reconciliation endpoint | 🔲 Planned |

### Out of Scope (Phase 2+)

- OMS write-back (slot confirmation, call notes)
- Telephony / Ozontel integration + phone masking
- Slack / external webhook alerts on state transitions
- Auto-dial
- AI-based prioritization
- Predictive analytics

---

## 17. Success Metrics

| Metric | Baseline | 90-day Target | How Measured |
|--------|----------|---------------|-------------|
| 3-attempt compliance rate | ~25% | > 90% | (leads with ≥3 attempts) / (total UNREACHABLE leads) |
| Time to first call (median) | Untracked | < 10 minutes | created_at → first call_attempt.called_at |
| Missed callback rate | High | < 5% | CALLBACK tasks with actual called_at > due_at + 15min |
| SLA breach rate | 100% (no SLA) | < 10% | first calls not made within configured window |
| Lead-to-scheduled conversion | Baseline | +10–15% | SCHEDULED / total leads created |
| Agent tasks per hour | Untracked | +25% | call_attempts / agent_session_hours |
| Manager escalation time | Manual | Real-time | Dashboard refresh lag |

---

## 18. Open Items

| Item | Decision Needed | Owner |
|------|----------------|-------|
| OMS write-back API contract | Define endpoint spec for slot confirmation, cancellation sync | Product + OMS Dev |
| Slack alert configuration | Which states trigger Slack? Which channel? Alert format? | Product |
| Call recording compliance | Is call recording permissible? Consent mechanism? | Legal |
| Data archival mechanism | Cold storage target (S3? Postgres archive schema?) | Engineering |
| Ozontel integration timeline | Phase 2 kickoff dependency | Infra |
| SLA breach Slack vs. in-app | MVP: in-app only. Phase 2: Slack? | Product |

---

*OH-LSQ is Orange Health's operational backbone for outbound diagnostic calling. Every patient call is tracked. Every retry is enforced. Every manager question has a data answer.*
