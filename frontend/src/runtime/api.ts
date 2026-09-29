import { engine } from "./engine";
import type {
  ConstraintChange,
  ExecutionClass,
  ImpactSummary,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeIntent,
  RuntimeState,
  Task,
  TaskStatus,
} from "./types";

/**
 * API client.
 *
 * Mirrors the service contract:
 *   POST /api/message   { text, is_interruption }
 *   POST /api/interrupt { text }
 *   GET  /api/state
 *   GET  /api/events?limit=100
 *   POST /api/reset
 *
 * When the backend is reachable it is used directly. In a standalone build the
 * embedded runtime engine backs the same contract, so behaviour is identical.
 *
 * Network-mode translation: the backend is the system of record and speaks its
 * own dialect — tasks arrive as an object keyed by task_id, events use
 * UPPER_SNAKE names, there is no phase field, and interruption_score is 0..1.
 * Everything below translates that dialect into RuntimeState without inventing
 * data: statuses, versions, constraints, and impact counts pass through as-is.
 */

// Env-driven API base: same-origin by default (vite proxy or backend-served
// dist), absolute URL when VITE_API_URL is set (e.g. docker compose).
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");
const url = (path: string) => `${API_BASE}${path}`;

type Mode = "undecided" | "network" | "embedded";
let probe: Promise<Mode> | null = null;

async function net(path: string, init?: RequestInit, timeoutMs = 900): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url(path), { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(id);
  }
}

function ensureMode(): Promise<Mode> {
  if (!probe) {
    probe = net("/api/state")
      .then(() => "network" as Mode)
      .catch(() => "embedded" as Mode)
      .then((m) => m);
  }
  return probe;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ————————————————— backend dialect → RuntimeState ————————————————— */

interface BackendTask {
  task_id: string;
  operation?: string;
  label?: string;
  status?: string;
  reads?: string[];
  execution_class?: string;
  state_version?: number;
  dependencies?: string[];
  result?: unknown;
  created_at?: number;
  completed_at?: number;
  preserved_at?: number;
  fenced_at?: number;
  cancelled_at?: number;
  failed_at?: number;
  archived_at?: number;
}

interface BackendEvent {
  event_id: string;
  timestamp: number;
  event_type: string;
  state_version: number;
  task_id?: string | null;
  payload?: Record<string, unknown>;
}

interface BackendState {
  run_id?: string;
  state_version: number;
  intent?: {
    domain?: string;
    objective?: string;
    constraints?: Record<string, string | number>;
    targets?: string[];
  } | null;
  tasks?: Record<string, BackendTask>;
  archived_tasks?: Record<string, BackendTask>;
  interruption_score?: number;
  running_tasks?: number;
}

function mapStatus(s: unknown): TaskStatus {
  switch (s) {
    case "pending":
    case "running":
    case "completed":
    case "cancelled":
    case "failed":
    case "stale":
    case "fenced":
    case "invalidated":
    case "preserved":
    case "archived":
      return s;
    default:
      return "pending";
  }
}

function mapExecClass(c: unknown): ExecutionClass {
  if (c === "critical" || c === "derived") return c;
  if (c === "commit") return "critical";
  return "interruptible";
}

const TERMINAL: ReadonlySet<string> = new Set([
  "completed",
  "preserved",
  "fenced",
  "invalidated",
  "cancelled",
  "failed",
  "archived",
]);

function normalizeTask(t: BackendTask, fallbackVersion: number): Task {
  const status = mapStatus(t.status);
  return {
    task_id: t.task_id,
    operation: t.operation ?? "unknown",
    label: t.label ?? t.operation ?? t.task_id,
    status,
    reads: Array.isArray(t.reads) ? t.reads : [],
    execution_class: mapExecClass(t.execution_class),
    created_in: typeof t.state_version === "number" ? t.state_version : fallbackVersion,
    depends_on: t.dependencies?.[0] ?? null,
    progress: t.status === "running" ? 50 : TERMINAL.has(String(t.status)) ? 100 : 0,
    output: typeof t.result === "string" ? t.result : undefined,
    late: false,
  };
}

function constraintChangesFromDiff(p: Record<string, unknown>): ConstraintChange[] {
  const out: ConstraintChange[] = [];
  const modified = (p.modified ?? {}) as Record<string, { old?: unknown; new?: unknown }>;
  for (const [k, v] of Object.entries(modified)) {
    out.push({ key: k, from: (v.old as string | number | null) ?? null, to: (v.new as string | number | null) ?? null });
  }
  for (const [k, v] of Object.entries((p.added ?? {}) as Record<string, unknown>)) {
    out.push({ key: k, from: null, to: (v as string | number | null) ?? null });
  }
  for (const [k, v] of Object.entries((p.removed ?? {}) as Record<string, unknown>)) {
    out.push({ key: k, from: (v as string | number | null) ?? null, to: null });
  }
  return out;
}

function impactFromAnalysis(p: Record<string, unknown>): ImpactSummary {
  const len = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : 0);
  return {
    preserved: len(p.preserved_tasks ?? p.preserved_count ?? p.preserved),
    invalidated: len(p.stale_tasks ?? p.stale_count ?? p.stale ?? p.invalidated),
    fenced: len(p.fenced_tasks ?? p.fenced_count ?? p.fenced),
  };
}

function toClientTimestamp(timestamp: number): number {
  // Backend event storage uses epoch seconds; the embedded runtime and UI use
  // JavaScript epoch milliseconds. Accept either so both transports format the
  // same local clock time.
  return timestamp > 0 && timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function mk(
  event_id: string,
  event_type: RuntimeEventType,
  timestamp: number,
  state_version: number,
  payload: Record<string, unknown>,
): RuntimeEvent {
  return { event_id, event_type, timestamp: toClientTimestamp(timestamp), state_version, payload };
}

/**
 * Translate the backend event log into stream events. Folded (not dropped):
 * INTENT_DIFF + IMPACT_ANALYSIS payloads attach to the interruption/state
 * events they explain; per-task lifecycle events pass through for the
 * inspector timeline; plan.created sections are synthesized from the first
 * TASK_CREATED of each state version so the execution graph renders.
 */
function translateEvents(raw: BackendEvent[]): RuntimeEvent[] {
  const diffByVersion = new Map<number, Record<string, unknown>>();
  const impactByVersion = new Map<number, Record<string, unknown>>();
  for (const ev of raw) {
    if (ev.event_type === "INTENT_DIFF") diffByVersion.set(ev.state_version, ev.payload ?? {});
    if (ev.event_type === "IMPACT_ANALYSIS") impactByVersion.set(ev.state_version, ev.payload ?? {});
  }

  const out: RuntimeEvent[] = [];
  const plannedVersions = new Set<number>();

  for (const ev of raw) {
    // TASK_PROGRESS is per-step noise (one event per 0.5s of simulated work);
    // it would drown both the conversation stream and the inspector timeline.
    // Task lifecycle (created/started/completed/...) is preserved separately.
    if (ev.event_type === "TASK_PROGRESS") continue;
    const p = ev.payload ?? {};
    switch (ev.event_type) {
      case "USER_INPUT":
        out.push(
          mk(ev.event_id, "user.message", ev.timestamp, ev.state_version, {
            text: String(p.raw_text ?? ""),
            interruption: false,
          }),
        );
        break;
      case "INTERRUPTION_DETECTED": {
        const text = String(p.transcript ?? "");
        const classification = String(p.classification ?? "modification");
        out.push(mk(`${ev.event_id}:msg`, "user.message", ev.timestamp, ev.state_version, { text, interruption: true }));
        const diff = diffByVersion.get(ev.state_version) ?? {};
        out.push(
          mk(`${ev.event_id}:int`, "interruption.detected", ev.timestamp, ev.state_version, {
            text,
            changes: constraintChangesFromDiff(diff),
            from_version: ev.state_version,
            to_version: ev.state_version + 1,
            noop: classification === "backchannel",
          }),
        );
        break;
      }
      case "STATE_VERSION_CHANGED": {
        if (p.reason !== "interruption") break;
        const version = Number(p.new_version ?? ev.state_version);
        // IMPACT_ANALYSIS / INTENT_DIFF are emitted at the pre-increment
        // version; the transition event carries old_version/new_version, so
        // prefer old_version and fall back to neighboring versions.
        const prevVersion = Number(p.old_version ?? ev.state_version);
        const impactPayload =
          impactByVersion.get(prevVersion) ??
          impactByVersion.get(ev.state_version) ??
          impactByVersion.get(version) ??
          impactByVersion.get(version - 1) ??
          {};
        const diff = diffByVersion.get(prevVersion) ?? diffByVersion.get(ev.state_version) ?? {};
        out.push(
          mk(ev.event_id, "state.updated", ev.timestamp, version, {
            version,
            impact: impactFromAnalysis(impactPayload),
            changes: constraintChangesFromDiff(diff),
          }),
        );
        break;
      }
      case "TASK_CREATED": {
        const version = ev.state_version;
        if (!plannedVersions.has(version)) {
          plannedVersions.add(version);
          out.push(mk(`${ev.event_id}:plan`, "plan.created", ev.timestamp, version, { version, count: 0 }));
        }
        out.push(
          mk(ev.event_id, "task.created", ev.timestamp, version, {
            task_id: ev.task_id,
            label: String(p.label ?? p.operation ?? ev.task_id ?? ""),
            late: false,
          }),
        );
        break;
      }
      case "TASK_STARTED":
        out.push(
          mk(ev.event_id, "task.started", ev.timestamp, ev.state_version, {
            task_id: ev.task_id,
            label: String(p.label ?? ev.task_id ?? ""),
          }),
        );
        break;
      case "TASK_COMPLETED":
        out.push(
          mk(ev.event_id, "task.completed", ev.timestamp, ev.state_version, {
            task_id: ev.task_id,
            label: String(p.label ?? ev.task_id ?? ""),
            output: typeof p.result === "string" ? p.result : "finished",
          }),
        );
        break;
      case "TASK_CANCELLED":
      case "TASK_CANCEL_REQUESTED":
        out.push(mk(ev.event_id, "task.cancelled", ev.timestamp, ev.state_version, { task_id: ev.task_id }));
        break;
      case "TASK_FENCED":
      case "STALE_RESULT_REJECTED":
        out.push(
          mk(ev.event_id, "task.fenced", ev.timestamp, ev.state_version, {
            task_id: ev.task_id,
            label: String(p.label ?? ev.task_id ?? ""),
          }),
        );
        break;
      case "TASK_PRESERVED":
        out.push(
          mk(ev.event_id, "task.preserved", ev.timestamp, ev.state_version, {
            task_id: ev.task_id,
            label: String(p.label ?? ev.task_id ?? ""),
          }),
        );
        break;
      case "RECOVERY_COMPLETED": {
        const version = ev.state_version;
        const impact = impactFromAnalysis((p.impact ?? p) as Record<string, unknown>);
        const total = impact.preserved + impact.invalidated + impact.fenced;
        out.push(
          mk(ev.event_id, "assistant.message", ev.timestamp, version, {
            text:
              total > 0
                ? `Recovery complete — state v${version}: ${impact.preserved} preserved, ${impact.invalidated} invalidated, ${impact.fenced} fenced. Continuing with what survived.`
                : `Recovery complete — state v${version}. Continuing.`,
            closing: false,
          }),
        );
        break;
      }
      default:
        // RUNTIME_STARTED/STOPPED, INTERRUPTION_CLASSIFIED, INTENT_DIFF,
        // IMPACT_ANALYSIS, TASK_PROGRESS, CHECKPOINT_CREATED, RECOVERY_STARTED,
        // TASK_FAILED: folded into the events above or not stream-relevant.
        break;
    }
  }
  return out;
}

function closingLine(steps: number, preserved: number): string {
  const base = `Done — ${steps} execution step${steps === 1 ? "" : "s"} total`;
  return preserved > 0 ? `${base}, ${preserved} preserved from the earlier state. Nothing valid was recomputed.` : `${base}.`;
}

function normalizeState(raw: BackendState, rawEvents: BackendEvent[]): RuntimeState {
  const version = raw.state_version ?? 0;
  const live = Object.values(raw.tasks ?? {});
  const archived = Object.values(raw.archived_tasks ?? {}).map((t) => ({ ...t, status: "archived" }));
  const latestProgress = new Map<string, number>();
  for (const event of rawEvents) {
    if (event.event_type !== "TASK_PROGRESS" || !event.task_id) continue;
    const value = Number(event.payload?.progress);
    if (Number.isFinite(value)) latestProgress.set(event.task_id, Math.round(Math.min(1, Math.max(0, value)) * 100));
  }
  const tasks = [...live, ...archived].map((task) => {
    const normalized = normalizeTask(task, version);
    if (normalized.status === "running" && latestProgress.has(normalized.task_id)) {
      normalized.progress = latestProgress.get(normalized.task_id)!;
    }
    return normalized;
  });

  const intent: RuntimeIntent | null = raw.intent
    ? {
        domain: raw.intent.domain ?? "",
        objective: raw.intent.objective ?? "",
        constraints: { ...(raw.intent.constraints ?? {}) },
        targets: [...(raw.intent.targets ?? [])],
      }
    : null;

  const events = translateEvents(rawEvents);

  // Synthesize a stable closing line for each fully settled version from real
  // task state (never fabricated result items). Keep the synthetic event id and
  // timestamp stable across polls so the UI's append-only stream never rewinds.
  const running = raw.running_tasks ?? tasks.filter((t) => t.status === "running").length;
  const hasPending = tasks.some((task) => task.status === "pending");
  const rawTaskById = new Map([...live, ...archived].map((task) => [task.task_id, task]));
  const byVersion = new Map<number, Task[]>();
  for (const t of tasks) {
    const list = byVersion.get(t.created_in) ?? [];
    list.push(t);
    byVersion.set(t.created_in, list);
  }
  for (const [v, list] of byVersion) {
    if (list.length === 0) continue;
    const settled = list.every((t) => TERMINAL.has(t.status));
    if (!settled) continue;
    if (v === version && running > 0) continue;
    const steps = list.filter((t) => t.status === "completed" || t.status === "preserved").length;
    const preserved = list.filter((t) => t.status === "preserved").length;
    const closedAt = Math.max(
      0,
      ...list.map((task) => {
        const source = rawTaskById.get(task.task_id);
        if (!source) return 0;
        if (task.status === "fenced") return source.fenced_at ?? source.completed_at ?? source.created_at ?? 0;
        if (task.status === "preserved") return source.preserved_at ?? source.completed_at ?? source.created_at ?? 0;
        if (task.status === "cancelled") return source.cancelled_at ?? source.completed_at ?? source.created_at ?? 0;
        if (task.status === "failed") return source.failed_at ?? source.completed_at ?? source.created_at ?? 0;
        if (task.status === "archived") return source.archived_at ?? source.completed_at ?? source.created_at ?? 0;
        return source.completed_at ?? source.created_at ?? 0;
      }),
    );
    events.push(
      mk(`syn-close-v${v}`, "assistant.message", closedAt + 0.001, v, { text: closingLine(steps, preserved), closing: true }),
    );
  }
  events.sort((a, b) => a.timestamp - b.timestamp);

  return {
    state_version: version,
    intent,
    tasks,
    events,
    running_tasks: running,
    interruption_score: Math.round((raw.interruption_score ?? 0) * 100),
    phase: running > 0 || hasPending ? "running" : version > 0 ? "complete" : "idle",
  };
}

export const api = {
  async ready(): Promise<Mode> {
    return ensureMode();
  },

  async getState(): Promise<RuntimeState> {
    const m = await ensureMode();
    if (m === "network") {
      // Wide window: the backend logs per-step TASK_PROGRESS (dropped in
      // translate) and long runs exceed 100 events; narrowing the window
      // would slide lifecycle events out and reset the conversation stream.
      const [stateRes, eventsRes] = await Promise.all([net("/api/state"), net("/api/events?limit=400")]);
      const raw = (await stateRes.json()) as BackendState;
      const rawEvents = (await eventsRes.json()) as BackendEvent[];
      return normalizeState(raw, rawEvents);
    }
    return engine.getState();
  },

  async getEvents(limit = 100): Promise<RuntimeEvent[]> {
    const m = await ensureMode();
    if (m === "network") {
      const res = await net(`/api/events?limit=${Math.max(limit, 400)}`);
      return translateEvents((await res.json()) as BackendEvent[]);
    }
    return engine.getEvents(limit);
  },

  async sendMessage(text: string, isInterruption = false): Promise<void> {
    const m = await ensureMode();
    if (m === "network") {
      await net("/api/message", json({ text, is_interruption: isInterruption }));
      return;
    }
    await engine.message(text, isInterruption);
  },

  async interrupt(text: string): Promise<void> {
    const m = await ensureMode();
    if (m === "network") {
      await net("/api/interrupt", json({ text }));
      return;
    }
    await engine.interrupt(text);
  },

  async reset(): Promise<void> {
    const m = await ensureMode();
    if (m === "network") {
      await net("/api/reset", { method: "POST" });
      return;
    }
    await engine.reset();
  },

  /** Embedded-runtime subscription (no-op in network mode; polling covers it). */
  subscribe(fn: () => void): () => void {
    return engine.subscribe(fn);
  },
};
