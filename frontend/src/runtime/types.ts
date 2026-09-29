export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "stale"
  | "fenced"
  | "invalidated"
  | "preserved"
  | "archived";

export type ExecutionClass = "interruptible" | "critical" | "derived";

export interface Task {
  task_id: string;
  operation: string;
  label: string;
  status: TaskStatus;
  reads: string[];
  execution_class: ExecutionClass;
  /** state version the task currently belongs to */
  created_in: number;
  depends_on: string | null;
  progress: number;
  output?: string;
  /** live capture from the running browser (data URI); absent until a page renders */
  screenshot?: string;
  /** ran in simulation (embedded engine or no-Playwright fallback) — no real browser */
  simulated?: boolean;
  /** created by a re-plan after an interruption */
  late?: boolean;
}

export interface RuntimeIntent {
  domain: string;
  objective: string;
  constraints: Record<string, string | number>;
  targets: string[];
}

export type RuntimeEventType =
  | "user.message"
  | "intent.parsed"
  | "plan.created"
  | "task.created"
  | "task.started"
  | "task.progress"
  | "task.completed"
  | "task.cancelled"
  | "task.failed"
  | "task.invalidated"
  | "task.fenced"
  | "task.preserved"
  | "execution.paused"
  | "execution.resumed"
  | "interruption.detected"
  | "state.updated"
  | "run.completed"
  | "run.reset"
  | "assistant.message";

export interface RuntimeEvent {
  event_id: string;
  event_type: RuntimeEventType;
  timestamp: number;
  state_version: number;
  payload: Record<string, unknown>;
}

export type EnginePhase = "idle" | "planning" | "running" | "interrupting" | "complete";

export interface RuntimeState {
  state_version: number;
  intent: RuntimeIntent | null;
  tasks: Task[];
  events: RuntimeEvent[];
  running_tasks: number;
  interruption_score: number;
  phase: EnginePhase;
}

export interface ResultItem {
  title: string;
  detail: string;
  badge: string;
}

export interface ResultsPayload {
  heading: string;
  note: string | null;
  items: ResultItem[];
  meta: string;
}

export interface ImpactSummary {
  preserved: number;
  invalidated: number;
  fenced: number;
}

export interface ConstraintChange {
  key: string;
  from: string | number | null;
  to: string | number | null;
}
