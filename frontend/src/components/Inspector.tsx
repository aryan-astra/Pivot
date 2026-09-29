import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, X } from "lucide-react";
import type { RuntimeEvent, RuntimeState, Task } from "@/runtime/types";
import { cn } from "@/utils/cn";
import CallChip from "./CallChip";
import StatusMark from "./StatusMark";
import { fmtClockFull, fmtValue, keyLabel, SectionLabel, spring, StateChip, STATUS_META } from "./ui";

const toolStatus = (task: Task): "idle" | "running" | "done" | "error" => {
  if (task.status === "pending") return "idle";
  if (task.status === "running") return "running";
  if (task.status === "failed") return "error";
  return "done";
};
const markStatus = (task: Task): "pending" | "running" | "done" | "failed" | "cancelled" => {
  if (task.status === "running") return "running";
  if (task.status === "completed" || task.status === "preserved") return "done";
  if (task.status === "failed") return "failed";
  if (task.status === "pending") return "pending";
  return "cancelled";
};

function eventTone(type: string): string {
  if (type === "interruption.detected" || type === "execution.paused") return "bg-fence";
  if (type === "task.invalidated") return "bg-danger";
  if (type === "task.fenced") return "bg-fence";
  if (type === "task.preserved" || type === "run.completed") return "bg-ok";
  if (type === "state.updated") return "bg-info";
  if (type === "user.message") return "bg-ink-2";
  return "bg-line-2";
}

function eventSummary(ev: RuntimeEvent): string {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.event_type) {
    case "user.message": return String(p.text ?? "").slice(0, 64);
    case "task.completed": return `${p.label} — ${p.output}`;
    case "task.started":
    case "task.created":
    case "task.invalidated":
    case "task.fenced":
    case "task.preserved": return String(p.label ?? "");
    case "state.updated": return `v${ev.state_version} committed`;
    case "interruption.detected": return p.noop ? "no constraint delta" : "constraints amended";
    default: return "";
  }
}

function Section({ label, children, right }: { label: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-4">
      <SectionLabel right={right}>{label}</SectionLabel>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function RuntimeInspector({
  state,
  open,
  onClose,
  variant,
  demoMode,
  onDemoChange,
}: {
  state: RuntimeState;
  open: boolean;
  onClose: () => void;
  variant: "inline" | "overlay";
  demoMode: boolean;
  onDemoChange: (on: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const lastImpact = useMemo(() => {
    for (let i = state.events.length - 1; i >= 0; i--) {
      const ev = state.events[i];
      if (ev.event_type === "state.updated" && ev.payload.impact) return ev;
    }
    return null;
  }, [state.events]);

  const visibleTasks = state.tasks.filter((t) => t.status !== "archived");
  const events = useMemo(() => [...state.events].reverse().slice(0, 40), [state.events]);
  const active = state.tasks.filter((t) => ["pending", "running"].includes(t.status)).length;

  const body = (
    <div className="flex h-full flex-col bg-surface">
      {/* panel header */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span className="font-display text-[14px] font-semibold tracking-[-0.01em] text-ink">Runtime Inspector</span>
        {state.state_version > 0 && <StateChip version={state.state_version} />}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close runtime inspector"
          className="ml-auto rounded-lg p-1.5 text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
        >
          <X size={15} strokeWidth={1.9} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* state matrix */}
        <Section label="State">
          <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-line">
            {[
              { k: "VERSION", v: state.state_version > 0 ? `v${state.state_version}` : "—" },
              { k: "DOMAIN", v: state.intent?.domain ?? "—" },
              { k: "ACTIVE", v: String(active) },
              { k: "EVENTS", v: String(state.events.length) },
            ].map((cell, i) => (
              <div key={cell.k} className={cn("px-2.5 py-2.5", i > 0 && "border-l border-line")}>
                <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-ink-3">{cell.k}</div>
                <div className="tnum mt-0.5 truncate font-mono text-[12.5px] font-medium text-ink">{cell.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">phase</span>
            <span className={cn("font-mono text-[11px] font-medium", state.phase === "running" ? "text-ink" : state.phase === "interrupting" ? "text-fence" : "text-ink-2")}>
              {state.phase}
            </span>
          </div>
        </Section>

        {/* demo content switch */}
        <Section label="Demo">
          <button
            type="button"
            role="switch"
            aria-checked={demoMode}
            aria-label="Demo"
            onClick={() => onDemoChange(!demoMode)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-[background-color,border-color] duration-150 hover:bg-surface-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-200",
                demoMode ? "border-dark bg-dark text-dark-text" : "border-line-2 text-ink-3",
              )}
            >
              Demo
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors duration-200",
                demoMode ? "bg-ok" : "bg-line-2",
              )}
            >
              <span
                className={cn(
                  "absolute top-[2px] h-[16px] w-[16px] rounded-full bg-surface shadow-lift transition-[left] duration-200",
                  demoMode ? "left-[18px]" : "left-[2px]",
                )}
              />
            </span>
          </button>
        </Section>

        {/* constraints */}
        <Section label="Constraints" right={<span className="font-mono text-[10.5px] text-ink-3">{state.intent ? `${Object.keys(state.intent.constraints).length} bound` : "none"}</span>}>
          {state.intent ? (
            <ul className="divide-y divide-line">
              {Object.entries(state.intent.constraints).map(([k, v]) => (
                <li key={k} className="flex items-baseline justify-between gap-3 py-[7px]">
                  <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3">{keyLabel(k)}</span>
                  <span className="tnum truncate font-mono text-[12px] font-medium text-ink">{fmtValue(k, v)}</span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 py-[7px]">
                <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3">TARGETS</span>
                <span className="truncate font-mono text-[12px] font-medium text-ink">{state.intent.targets.join(" · ")}</span>
              </li>
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">No intent parsed yet.</p>
          )}
        </Section>

        {/* interruption readiness */}
        <Section label="Interruption readiness" right={<span className="tnum font-mono text-[11px] font-medium text-ink">{state.interruption_score}%</span>}>
          <div className="h-[5px] w-full overflow-hidden rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full bg-ink"
              initial={false}
              animate={{ width: `${state.interruption_score}%` }}
              transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
            />
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
            Share of committed work. The higher it climbs, the more an interruption has to preserve rather than discard.
          </p>
        </Section>

        {/* last impact */}
        <Section label="Last impact">
          {lastImpact ? (
            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-line">
              {(
                [
                  ["PRESERVED", (lastImpact.payload.impact as { preserved: number }).preserved, "text-ok"],
                  ["INVALID", (lastImpact.payload.impact as { invalidated: number }).invalidated, "text-danger"],
                  ["FENCED", (lastImpact.payload.impact as { fenced: number }).fenced, "text-fence"],
                ] as const
              ).map(([k, v, tone], i) => (
                <div key={k} className={cn("px-2.5 py-2", i > 0 && "border-l border-line")}>
                  <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-ink-3">{k}</div>
                  <div className={cn("tnum mt-0.5 font-display text-[18px] font-semibold leading-none", tone)}>{String(v).padStart(2, "0")}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-3">No state transition yet — interrupt a running task to see one.</p>
          )}
        </Section>

        {/* execution graph */}
        <Section label="Execution graph" right={<span className="tnum font-mono text-[10.5px] text-ink-3">{visibleTasks.length} nodes</span>}>
          <ul>
            {visibleTasks.map((t, i) => (
              <li key={t.task_id} className="relative py-[5px] pl-6">
                {i > 0 && <span className="absolute left-[5px] top-0 h-[calc(50%-5px)] w-px bg-line" aria-hidden="true" />}
                {i < visibleTasks.length - 1 && <span className="absolute bottom-0 left-[5px] top-[calc(50%+5px)] w-px bg-line" aria-hidden="true" />}
                <span className="absolute left-0 top-1/2 -translate-y-1/2 bg-surface">
                  <StatusMark status={markStatus(t)} progress={t.status === "running" ? t.progress / 100 : undefined} size={15} strokeWidth={2} color="var(--color-ink-2)" doneColor="var(--color-ok)" errorColor="var(--color-danger)" strike={false} ariaLabel={`${t.label}: ${STATUS_META[t.status].word}`} />
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-[12.5px] font-medium", t.status === "invalidated" || t.status === "archived" ? "text-ink-3" : "text-ink")}>
                    {t.label}
                  </span>
                  <span className={cn("shrink-0 font-mono text-[9.5px] font-medium uppercase tracking-[0.1em]", STATUS_META[t.status].tone)}>
                    {STATUS_META[t.status].word}
                  </span>
                </div>
                <div className="mt-[1px] truncate font-mono text-[10px] text-ink-3">
                  <span className="tnum">{t.task_id}</span>
                  {t.depends_on && <span> · depends on {t.depends_on}</span>}
                  {t.reads.length > 0 && <span> · reads {t.reads.join(", ")}</span>}
                  <span> · v{t.created_in}</span>
                </div>
                <div className="mt-1.5 max-w-full">
                  <CallChip
                    icon={/search|browser/i.test(t.operation) ? "search" : /parse|result|file/i.test(t.operation) ? "file" : "terminal"}
                    name={t.operation.slice(0, 18)}
                    argument={t.label}
                    status={toolStatus(t)}
                    expectedMs={8000}
                    size={25}
                    radius={7}
                    color="var(--color-tool-ink)"
                    surfaceColor="var(--color-tool-surface)"
                    progressColor="var(--color-accent)"
                    doneColor="var(--color-ok)"
                    errorColor="var(--color-danger)"
                    showTimer={t.status === "running"}
                    className="max-w-full"
                  />
                </div>
              </li>
            ))}
            {visibleTasks.length === 0 && <p className="text-[12.5px] text-ink-3">Graph is empty.</p>}
          </ul>
        </Section>

        {/* event timeline */}
        <Section label="Event timeline" right={<span className="tnum font-mono text-[10.5px] text-ink-3">{state.events.length} total</span>}>
          <ul>
            {events.map((ev) => {
              const isOpen = expanded === ev.event_id;
              return (
                <li key={ev.event_id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : ev.event_id)}
                    aria-expanded={isOpen}
                    className="group flex w-full items-start gap-2.5 rounded-md px-1.5 py-[6px] text-left transition-[background-color] duration-150 hover:bg-surface-2"
                  >
                    <span className={cn("mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full", eventTone(ev.event_type))} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-2">{ev.event_type}</span>
                        <span className="tnum shrink-0 font-mono text-[10px] text-ink-3">{fmtClockFull(ev.timestamp)}</span>
                      </span>
                      {eventSummary(ev) && <span className="mt-[1px] block truncate text-[11.5px] text-ink-3">{eventSummary(ev)}</span>}
                    </span>
                    <ChevronDown size={12} strokeWidth={2} className={cn("mt-1 shrink-0 text-ink-3 transition-transform duration-200", isOpen && "rotate-180")} aria-hidden="true" />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.pre
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
                        className="overflow-hidden rounded-md bg-surface-2 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink-2"
                      >
                        {JSON.stringify({ event_id: ev.event_id, state_version: ev.state_version, ...ev.payload }, null, 2)}
                      </motion.pre>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
            {events.length === 0 && <p className="text-[12.5px] text-ink-3">No events recorded.</p>}
          </ul>
        </Section>
      </div>
    </div>
  );

  if (variant === "inline") {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            key="inspector-inline"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 400, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={spring}
            className="shrink-0 overflow-hidden border-l border-line bg-surface"
            aria-label="Runtime inspector"
          >
            <div className="h-full w-[400px]">{body}</div>
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="inspector-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-dark/25 xl:hidden"
            aria-hidden="true"
          />
          <motion.aside
            key="inspector-overlay"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={spring}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-[400px] border-l border-line shadow-float"
            role="dialog"
            aria-modal="true"
            aria-label="Runtime inspector"
          >
            {body}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
