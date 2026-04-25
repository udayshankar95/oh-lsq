// ─── OMS Event Payload ───────────────────────────────────────────────────────

export interface OmsOrderPayload {
  order_id: string;
  customer_name: string;
  patient_name: string;
  patient_phone: string;
  patient_age?: number;
  patient_gender?: 'Male' | 'Female' | 'Other';
  tests: string[];
  packages: string[];
  preferred_slot?: string;
  order_value?: number;
}

export interface OmsEventPayload {
  request_id: string;
  doctor_name: string;
  partner_name: string;
  prescription_url?: string;
  oh_notes?: string;
  orders: OmsOrderPayload[];
}

// ─── DB Row Types ─────────────────────────────────────────────────────────────

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: 'agent' | 'manager';
  city: string;
  is_punched_in: number;
  last_assigned_at: string | null;
  created_at: string;
}

export interface AgentSessionRow {
  id: number;
  agent_id: number;
  punched_in_at: string;
  punched_out_at: string | null;
  duration_minutes: number | null;
}

export interface LeadRow {
  id: number;
  request_id: string;
  doctor_name: string;
  partner_name: string;
  prescription_url: string | null;
  oh_notes: string | null;
  state: LeadState;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: number;
  lead_id: number;
  oms_order_id: string;
  customer_name: string;
  patient_name: string;
  patient_phone: string;
  patient_age: number | null;
  patient_gender: string | null;
  tests: string; // JSON string
  packages: string; // JSON string
  preferred_slot: string | null;
  order_value: number;
  created_at: string;
}

export interface TaskRow {
  id: number;
  lead_id: number;
  order_id: number | null;
  type: TaskType;
  status: TaskStatus;
  assigned_to: number | null;
  due_at: string | null;
  locked_at: string | null;
  lock_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallAttemptRow {
  id: number;
  task_id: number;
  lead_id: number;
  agent_id: number;
  outcome: CallOutcome;
  notes: string | null;
  callback_time: string | null;
  called_at: string;
  duration_seconds: number;
  agent_name?: string;
}

export interface PriorityBucketRow {
  id: number;
  name: string;
  conditions: string; // JSON string
  display_order: number;
  is_active: number;
  created_by: number | null;
  created_at: string;
}

// ─── Enums ────────────────────────────────────────────────────────────────────

export type LeadState =
  | 'NEW'
  | 'ATTEMPTING'
  | 'CONNECTED'
  | 'SCHEDULED'
  | 'CALLBACK_SCHEDULED'
  | 'UNREACHABLE'
  | 'CANCELLED';

export type TaskType = 'FIRST_CALL' | 'RETRY_CALL' | 'CALLBACK' | 'FUTURE_CALL';

export type TaskStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export type CallOutcome =
  | 'CONNECTED_SCHEDULED'
  | 'CONNECTED_FOLLOW_UP'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'SWITCHED_OFF'
  | 'WRONG_NUMBER'
  | 'CALL_LATER'
  | 'NOT_INTERESTED'
  | 'CONNECTED_WILL_PAY';

// ─── API Response Types ───────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'agent' | 'manager';
  city: string;
  is_punched_in: boolean;
}

export interface BucketConditions {
  task_type?: TaskType[];
  lead_state?: LeadState[];
  due_before?: string; // 'now' | 'now-Xh'
  created_before?: string; // 'now-Xh'
  attempt_count_gte?: number;
}

// ─── Express Extensions ───────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
