export type LeadState =
  | 'NEW' | 'ATTEMPTING' | 'CONNECTED' | 'SCHEDULED'
  | 'CALLBACK_SCHEDULED' | 'UNREACHABLE' | 'CANCELLED';

export type TaskType = 'FIRST_CALL' | 'RETRY_CALL' | 'CALLBACK' | 'FUTURE_CALL';
export type TaskStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export type CallOutcome =
  | 'CONNECTED_SCHEDULED' | 'CONNECTED_FOLLOW_UP' | 'NO_ANSWER' | 'BUSY'
  | 'SWITCHED_OFF' | 'WRONG_NUMBER' | 'CALL_LATER' | 'NOT_INTERESTED' | 'CONNECTED_WILL_PAY';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'agent' | 'manager';
  city: string;
  is_punched_in: boolean;
}

export interface Task {
  id: number;
  lead_id: number;
  order_id: number | null;
  type: TaskType;
  status: TaskStatus;
  assigned_to: number | null;
  due_at: string | null;
  created_at: string;
  // Lead fields (joined)
  request_id: string;
  doctor_name: string;
  partner_name: string;
  prescription_url?: string | null;
  oh_notes?: string | null;
  lead_state: LeadState;
  attempt_count: number;
  max_attempts: number;
  // Order fields (joined)
  oms_order_id: string;
  patient_name: string;
  patient_phone: string;
  customer_name: string;
  patient_age: number | null;
  patient_gender: string | null;
  tests: string[];
  packages: string[];
  preferred_slot: string | null;
  order_value: number;
  // Call history (only on detail view)
  call_history?: CallAttempt[];
}

export interface Lead {
  id: number;
  request_id: string;
  doctor_name: string;
  partner_name: string;
  state: LeadState;
  attempt_count: number;
  max_attempts: number;
  oh_notes: string | null;
  created_at: string;
  updated_at: string;
  // Order (first order joined)
  oms_order_id?: string;
  patient_name?: string;
  patient_phone?: string;
  customer_name?: string;
  tests?: string[];
  packages?: string[];
  order_value?: number;
  preferred_slot?: string | null;
  assigned_agent?: string | null;
  task_count?: number;
}

export interface CallAttempt {
  id: number;
  task_id: number;
  lead_id: number;
  agent_id: number;
  agent_name: string;
  outcome: CallOutcome;
  notes: string | null;
  callback_time: string | null;
  called_at: string;
}

export interface AgentStat {
  id: number;
  name: string;
  email: string;
  city: string;
  is_punched_in: boolean;
  current_session_start: string | null;
  total_minutes_today: number;
  open_tasks: number;
  calls_today: number;
  conversions_today: number;
  connections_today: number;
}

export interface DashboardMetrics {
  leads: { total: number; active: number; scheduled_today: number; unreachable: number; cancelled: number };
  calls: { today: number; connections: number; conversions: number };
  queue: { pending: number; assigned: number; overdue_callbacks: number; waiting_over_24h: number };
  agents: { active: number };
  state_breakdown: { state: LeadState; count: number }[];
}

export interface PriorityBucket {
  id: number;
  name: string;
  conditions: Record<string, unknown>;
  display_order: number;
  is_active: number | boolean;
  created_at: string;
}
