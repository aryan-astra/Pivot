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
  /** plan metadata (e.g. the URL a browse version targets) — per-version truth */
  metadata?: Record<string, unknown>;
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
  const result = (t.result ?? {}) as Record<string, unknown>;
  const screenshot = typeof result.screenshot === "string" && result.screenshot.startsWith("data:image/")
    ? (result.screenshot as string)
    : undefined;
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
    output:
      typeof t.result === "string"
        ? t.result
        : typeof result.summary === "string"
          ? result.summary
          : undefined,
    screenshot,
    // Only the no-Playwright fallback marks results simulated; real browser
    // runs stay undefined so the preview can promise an honest capture.
    simulated: result.simulated === true || undefined,
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
        // A no-change interruption (backchannel, or a correction whose parsed
        // intent diffed to nothing) never emits INTENT_DIFF or bumps the
        // version — render neither the annotation row nor a version advance.
        const noop = classification === "backchannel" || Object.keys(diff).length === 0;
        out.push(
          mk(`${ev.event_id}:int`, "interruption.detected", ev.timestamp, ev.state_version, {
            text,
            changes: constraintChangesFromDiff(diff),
            from_version: ev.state_version,
            to_version: noop ? ev.state_version : ev.state_version + 1,
            noop,
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
      case "TASK_FAILED":
        out.push(
          mk(ev.event_id, "task.failed", ev.timestamp, ev.state_version, {
            task_id: ev.task_id,
            label: String(p.label ?? ev.task_id ?? ""),
            error: String(p.error ?? "failed"),
          }),
        );
        break;
      case "RECOVERY_COMPLETED": {
        const version = ev.state_version;
        const impact = impactFromAnalysis((p.impact ?? p) as Record<string, unknown>);
        const total = impact.preserved + impact.invalidated + impact.fenced;
        const planned = Array.isArray(p.planned_tasks) ? p.planned_tasks.length : 0;
        const plannedBit = planned > 0 ? ` ${planned} step${planned === 1 ? "" : "s"} re-planned and running.` : "";
        out.push(
          mk(ev.event_id, "assistant.message", ev.timestamp, version, {
            text:
              total > 0
                ? `Recovery complete — state v${version}: ${impact.preserved} preserved, ${impact.invalidated} invalidated, ${impact.fenced} fenced.${plannedBit} Continuing with what survived.`
                : `Recovery complete — state v${version}.${plannedBit} Continuing with what survived.`,
            closing: false,
          }),
        );
        break;
      }
      default:
        // RUNTIME_STARTED/STOPPED, INTERRUPTION_CLASSIFIED, INTENT_DIFF,
        // IMPACT_ANALYSIS, TASK_PROGRESS, CHECKPOINT_CREATED, RECOVERY_STARTED:
        // folded into the events above or not stream-relevant.
        break;
    }
  }
  return out;
}

/* ————— meaningful agent responses, built from real task results —————
 *
 * The backend returns task results (page titles, extracted text, screenshots,
 * simulated flags) but no prose. The agent's reply is composed here from that
 * data — never fabricated: if a run only simulated, the reply says so. */

interface TaskResult {
  url?: string;
  title?: string;
  text?: string;
  summary?: string;
  screenshot?: string;
  simulated?: boolean;
  error?: string;
}

function resultOf(raw: BackendTask | undefined): TaskResult {
  const value = raw?.result;
  return value && typeof value === "object" ? (value as TaskResult) : {};
}

function excerpt(text: string, max = 320): string {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

function isBrowseList(list: Task[]): boolean {
  return list.some((task) => task.operation.startsWith("browse_"));
}

function hostFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

/**
 * The URL this version actually targeted — read from the version's own task
 * metadata (never the current intent, which an interruption may already have
 * re-pointed elsewhere).
 */
function browseTarget(
  list: Task[],
  rawById: Map<string, BackendTask>,
): { host: string; url: string } | null {
  for (const task of list) {
    if (!task.operation.startsWith("browse_")) continue;
    const meta = rawById.get(task.task_id)?.metadata;
    const metaUrl = typeof meta?.url === "string" ? meta.url : "";
    if (metaUrl) return { host: hostFromUrl(metaUrl), url: metaUrl };
    const resultUrl = resultOf(rawById.get(task.task_id)).url;
    if (resultUrl) return { host: hostFromUrl(resultUrl), url: resultUrl };
  }
  return null;
}

/**
 * Which request created each state version: the last USER_INPUT or
 * INTERRUPTION_DETECTED transcript, attached to the next version that gets
 * tasks. Used so replies about an older version quote THAT run's request.
 */
function requestTextByVersion(rawEvents: BackendEvent[]): Map<number, string> {
  const out = new Map<number, string>();
  let pending = "";
  for (const ev of rawEvents) {
    if (ev.event_type === "USER_INPUT") pending = String(ev.payload?.raw_text ?? "");
    else if (ev.event_type === "INTERRUPTION_DETECTED") pending = String(ev.payload?.transcript ?? "");
    else if (ev.event_type === "TASK_CREATED" && pending && !out.has(ev.state_version)) {
      out.set(ev.state_version, pending);
      pending = "";
    }
  }
  return out;
}

/**
 * Display names for the sites the backend parser can search directly. Read
 * from the version's own target URL (never the current intent, which an
 * interruption may already have re-pointed), so the answer names the site that
 * was actually searched.
 */
const SITE_NAMES: Record<string, string> = {
  "en.wikipedia.org": "Wikipedia",
  "wikipedia.org": "Wikipedia",
  "www.amazon.in": "Amazon",
  "amazon.in": "Amazon",
  "www.flipkart.com": "Flipkart",
  "flipkart.com": "Flipkart",
  "www.youtube.com": "YouTube",
  "youtube.com": "YouTube",
  "www.reddit.com": "Reddit",
  "reddit.com": "Reddit",
  "www.imdb.com": "IMDb",
  "imdb.com": "IMDb",
  "github.com": "GitHub",
  "www.linkedin.com": "LinkedIn",
  "www.bing.com": "the web",
  "www.google.com": "Google",
};

function siteLabel(target: { host: string; url: string } | null): string | null {
  if (!target) return null;
  return SITE_NAMES[hostFromUrl(target.url)] ?? SITE_NAMES[target.host] ?? null;
}

function constraintBits(c: Record<string, string | number>): string[] {
  const bits: string[] = [];
  if (c.category) bits.push(String(c.category).toLowerCase());
  if (c.max_price) bits.push(`under ₹${Number(c.max_price).toLocaleString("en-IN")}`);
  if (c.budget) bits.push(`under ₹${Number(c.budget).toLocaleString("en-IN")}`);
  if (c.ram) bits.push(`${c.ram} RAM`);
  if (c.location) bits.push(`in ${c.location}`);
  if (c.nights) bits.push(`${Number(c.nights) === 1 ? "1 night" : `${c.nights} nights`}`);
  return bits;
}

/**
 * The query in a web-search request ("search for X" / "search the web for
 * X" / "google X" / "look up X") — mirrors the backend parser so the
 * acknowledgement and final answer name the search the live browser ran.
 */
function searchQueryOf(text: string): string | null {
  const m = text
    .trim()
    .match(
      /^(?:actually\s+|wait[,\s]+|so\s+)?(?:search(?:ing|ed)?(?:\s+the\s+web)?(?:\s+for)?|google|look(?:ing|ed)?\s+up)\s+(.+)$/i,
    );
  if (!m) return null;
  const query = m[1]
    .trim()
    .replace(/\s+(?:instead|now|please|actually)$/i, "")
    .replace(/[.?!,;:]+$/, "")
    .trim();
  return query || null;
}

/**
 * Acknowledge a run the way the embedded engine does. Built from per-version
 * evidence (the targeted URL, the request that created the version) so an
 * acknowledgement synthesized after an interruption never re-describes an
 * older run with the new intent.
 */
function ackLine(
  target: { host: string } | null,
  isCurrent: boolean,
  intent: RuntimeIntent | null,
  requestText: string,
): string {
  const query = searchQueryOf(requestText);
  if (query) {
    return `Searching the web for “${excerpt(query, 90)}” — opening the results in a local browser, then I'll capture the page and read back what I find. Interrupt me mid-run and I'll re-target.`;
  }
  if (target) {
    return `Opening ${target.host} in a local browser — I'll capture the page, read what's on it, and pin the screenshot. Interrupt me mid-run and I'll re-target.`;
  }
  if (isCurrent && intent) {
    if ((intent.domain === "generic" || intent.domain === "general") && !intent.targets.length) {
      return "On it — working through your request, one step at a time. Interrupt any time; whatever stays valid is kept.";
    }
    const bits = constraintBits(intent.constraints);
    const noun = intent.domain === "dining" || intent.domain === "food"
      ? "restaurants"
      : intent.domain === "travel"
        ? "stays"
        : "options";
    const where = intent.targets.join(" and ") || "the local runtime";
    const what = bits.length ? bits.join(", ") : "matching your criteria";
    return `Understood — searching ${where} for ${noun} ${what}. Interrupt any time; whatever stays valid is kept.`;
  }
  if (requestText) {
    return `On it — "${excerpt(requestText, 110)}". Working through it now; interrupt any time — whatever stays valid is kept.`;
  }
  return "On it — building the execution plan. Interrupt any time.";
}

/** Final reply for a settled version, composed from what that run actually did. */
function answerLine(
  list: Task[],
  rawById: Map<string, BackendTask>,
  intent: RuntimeIntent | null,
  isCurrent: boolean,
  requestText = "",
): string {
  const preserved = list.filter((t) => t.status === "preserved").length;
  const fenced = list.filter((t) => t.status === "fenced").length;
  const cancelled = list.filter((t) => t.status === "cancelled").length;
  const parts: string[] = [];

  if (isBrowseList(list)) {
    const results = list
      .filter((t) => t.operation.startsWith("browse_"))
      .map((t) => resultOf(rawById.get(t.task_id)));
    const content = results.filter((r) => r.title || r.text || r.summary);
    const last = content[content.length - 1] ?? results[results.length - 1] ?? {};
    const target = browseTarget(list, rawById);
    const host =
      target?.host ??
      (isCurrent ? String(intent?.targets[0] ?? intent?.constraints.url ?? "the page") : "the page");
    const title = last.title || (last.summary ? last.summary.split(" — ")[0] : "");
    const shot = results.some((r) => Boolean(r.screenshot));
    const query = searchQueryOf(requestText);
    const body = last.text || "";
    const completedBrowse = list.filter((t) => t.status === "completed").length;
    if (completedBrowse === 0 && cancelled > 0) {
      parts.push(
        `Stopped — ${cancelled} step${cancelled === 1 ? "" : "s"} cancelled on your request; nothing was captured.`,
      );
    } else if (query) {
      const where = siteLabel(target) ?? "the web";
      parts.push(`Done — I searched ${where} for “${excerpt(query, 90)}”.`);
      if (body) parts.push(`The page says: ${excerpt(body, 380)}`);
      else if (title) parts.push(`The results page reads “${excerpt(title, 90)}”.`);
    } else {
      parts.push(`Done — I opened ${host}.`);
      if (body) parts.push(`The page says: ${excerpt(body, 380)}`);
      else if (title) parts.push(`The page reads “${excerpt(title, 90)}”.`);
    }
    if (shot) parts.push("The final capture stays visible in the floating preview.");
    if (!body && !shot && results.some((r) => r.simulated)) {
      parts.push("This run was simulated locally — no live page was loaded.");
    }
    const err = results.map((r) => r.error).find(Boolean);
    if (err && !body) parts.push(`The browser reported: ${excerpt(String(err), 140)}`);
    if (cancelled > 0 && completedBrowse > 0) {
      parts.push(`${cancelled} step${cancelled === 1 ? "" : "s"} cancelled on your request.`);
    }
  } else {
    const finished = list.filter((t) => t.status === "completed" || t.status === "preserved");
    const labels = finished.map((t) => t.label).slice(0, 4);
    if (finished.length === 0 && cancelled > 0) {
      parts.push(
        `Stopped — ${cancelled} step${cancelled === 1 ? "" : "s"} cancelled on your request.`,
      );
    } else {
      parts.push(
        `Done — ${finished.length} step${finished.length === 1 ? "" : "s"} finished${labels.length ? `: ${labels.join(" · ")}` : ""}.`,
      );
      const completed = list.filter((t) => t.status === "completed");
      if (completed.length > 0 && completed.every((t) => resultOf(rawById.get(t.task_id)).simulated)) {
        parts.push("This run was executed by the local simulation — no live results were fetched.");
      }
      if (cancelled > 0) {
        parts.push(`${cancelled} step${cancelled === 1 ? "" : "s"} cancelled on your request.`);
      }
    }
  }

  if (preserved > 0) parts.push(`${preserved} earlier step${preserved === 1 ? "" : "s"} preserved — nothing valid was recomputed.`);
  if (fenced > 0) parts.push(`${fenced} stale result${fenced === 1 ? "" : "s"} fenced from commit.`);
  return parts.join(" ");
}

/** Results block for the settled version, populated from real task data. */
function buildApiResults(
  list: Task[],
  rawById: Map<string, BackendTask>,
  intent: RuntimeIntent | null,
  version: number,
  fenced: number,
  preserved: number,
  isCurrent: boolean,
  requestText: string,
): { heading: string; note: string | null; items: { title: string; detail: string; badge: string }[]; meta: string } {
  const seen = new Map<string, number>();
  const items = list.map((task) => {
    const count = (seen.get(task.label) ?? 0) + 1;
    seen.set(task.label, count);
    const badge = ["completed", "preserved"].includes(task.status)
      ? "done"
      : ["fenced", "invalidated", "archived"].includes(task.status)
        ? task.status
        : task.status;
    return {
      title: count > 1 ? `${task.label} (${count})` : task.label,
      detail: excerpt(task.output ?? `${task.operation} · ${task.status}`, 110),
      badge,
    };
  });

  if (isBrowseList(list)) {
    const results = list.map((t) => resultOf(rawById.get(t.task_id)));
    const content = [...results].reverse().find((r) => r.title || r.text) ?? {};
    const target = browseTarget(list, rawById);
    const host = target?.host ?? (isCurrent ? String(intent?.targets[0] ?? intent?.constraints.url ?? "the page") : "the page");
    const pageUrl = target?.url ?? String(content.url ?? (isCurrent ? intent?.constraints.url ?? "" : ""));
    const shot = results.some((r) => Boolean(r.screenshot));
    const query = searchQueryOf(requestText);
    return {
      heading: query
        ? `Search “${excerpt(query, 70)}” — ${host}`
        : content.title
          ? `${host} — ${excerpt(content.title, 80)}`
          : `Opened ${host}`,
      note: shot
        ? `Final capture floating in the preview · ${list.length} steps · state v${version}`
        : `State v${version} · ${list.length} steps`,
      items,
      meta: `${pageUrl || host} · state v${version} applied`,
    };
  }

  const completed = list.filter((t) => t.status === "completed");
  const simulated = completed.length > 0 && completed.every((t) => resultOf(rawById.get(t.task_id)).simulated);
  const bits = isCurrent ? constraintBits(intent?.constraints ?? {}) : [];
  const heading = bits.length
    ? `${bits.join(" · ")} — ${simulated ? "local simulation" : "results"}`
    : requestText
      ? `${excerpt(requestText, 72)} — ${simulated ? "local simulation" : "results"}`
      : `Execution complete — ${list.length} step${list.length === 1 ? "" : "s"}`;
  const notes: string[] = [];
  if (simulated) notes.push("no live results were fetched — this ran in the local simulation");
  if (preserved > 0) notes.push(`${preserved} earlier step${preserved === 1 ? "" : "s"} reused`);
  if (fenced > 0) notes.push(`${fenced} stale result${fenced === 1 ? "" : "s"} fenced`);
  const targets = isCurrent ? intent?.targets ?? [] : [];
  return {
    heading,
    note: notes.length ? notes.join(" · ") : null,
    items,
    meta: `${targets.join(" · ") || "local runtime"} · state v${version} applied`,
  };
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

  // Synthesize the agent's replies for each version from real task state
  // (never fabricated result items). Stable synthetic ids + timestamps across
  // polls so the UI's append-only stream never rewinds. Ids are scoped by
  // run_id: versions restart at v1 after /api/reset, so a bare `syn-close-v1`
  // would collide with the previous run's tail and defeat the stream's reset
  // detection in App (frozen pre-reset items).
  const runId = raw.run_id ?? "run";
  const running = raw.running_tasks ?? tasks.filter((t) => t.status === "running").length;
  const hasPending = tasks.some((task) => task.status === "pending");
  const rawTaskById = new Map([...live, ...archived].map((task) => [task.task_id, task]));
  const byVersion = new Map<number, Task[]>();
  for (const t of tasks) {
    const list = byVersion.get(t.created_in) ?? [];
    list.push(t);
    byVersion.set(t.created_in, list);
  }

  // Acknowledgement: emitted as soon as a version's tasks exist (not only
  // when settled), timestamped at first task creation so it lands right after
  // the plan in the stream — the agent's first word is an intent-aware opener,
  // never silence. The opener is derived from THIS version's evidence (its
  // targeted URL / creating request), so replies synthesized after an
  // interruption never describe an older run with the newer intent.
  const requests = requestTextByVersion(rawEvents);
  for (const [v, list] of byVersion) {
    if (list.length === 0) continue;
    const firstAt = Math.min(
      ...list.map((task) => rawTaskById.get(task.task_id)?.created_at ?? Number.POSITIVE_INFINITY),
    );
    if (!Number.isFinite(firstAt)) continue;
    const text = ackLine(browseTarget(list, rawTaskById), v === version, intent, requests.get(v) ?? "");
    events.push(mk(`syn-ack-${runId}-v${v}`, "assistant.message", firstAt, v, { text, closing: false }));
  }

  for (const [v, list] of byVersion) {
    if (list.length === 0) continue;
    const settled = list.every((t) => TERMINAL.has(t.status));
    if (!settled) continue;
    if (v === version && running > 0) continue;
    const steps = list.filter((t) => t.status === "completed" || t.status === "preserved").length;
    const preserved = list.filter((t) => t.status === "preserved").length;
    const fenced = list.filter((t) => t.status === "fenced").length;
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
      mk(`syn-close-${runId}-v${v}`, "assistant.message", closedAt + 0.001, v, {
        text: answerLine(list, rawTaskById, intent, v === version, requests.get(v) ?? ""),
        closing: true,
      }),
    );
    events.push(
      mk(`syn-results-${runId}-v${v}`, "run.completed", closedAt + 0.002, v, {
        steps,
        preserved,
        fenced,
        results: buildApiResults(list, rawTaskById, intent, v, fenced, preserved, v === version, requests.get(v) ?? ""),
      }),
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

  /**
   * Demo content switch for the embedded fallback (scripted picks and
   * fabricated outputs). No-op in network mode — the backend is the system
   * of record and carries no demo content.
   */
  setDemoContent(on: boolean): void {
    engine.setDemoContent(on);
  },
};
