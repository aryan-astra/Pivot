import { RotateCcw, TerminalSquare } from "lucide-react";
import type { RuntimeState } from "@/runtime/types";
import { cn } from "@/utils/cn";
import { IconBtn, ProductMark } from "./ui";

export function AppHeader({
  state,
  devMode,
  onToggleDev,
  onReset,
}: {
  state: RuntimeState;
  devMode: boolean;
  onToggleDev: () => void;
  onReset: () => void;
}) {
  const active = ["running", "planning", "interrupting"].includes(state.phase);
  const center =
    state.phase === "idle"
      ? "runtime idle — awaiting first request"
      : `${state.intent?.domain ?? "task"} · ${state.tasks.filter((t) => ["pending", "running"].includes(t.status)).length} open step${
          state.tasks.filter((t) => ["pending", "running"].includes(t.status)).length === 1 ? "" : "s"
        }${state.phase === "interrupting" ? " · evaluating impact" : state.phase === "complete" ? " · complete" : ""}`;

  return (
    <header className="relative z-30 flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-surface/85 px-4 backdrop-blur-[6px] md:px-6">
      {/* identity */}
      <div className="flex min-w-0 items-center gap-3">
        <ProductMark size={22} className="shrink-0 text-ink" />
        <span className="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">PIVOT</span>
        <span className="hidden shrink-0 rounded-md border border-line-2 px-1.5 py-[2px] font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-ink-3 sm:inline-block">
          Samsung&nbsp;PRISM
        </span>
      </div>

      {/* contextual runtime state */}
      <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 font-mono text-[11px] text-ink-3 lg:flex" aria-hidden="true">
        {state.state_version > 0 && (
          <span className="tnum text-ink-2">v{state.state_version}</span>
        )}
        <span className="text-line-2">/</span>
        <span className="max-w-[340px] truncate">{center}</span>
      </div>

      {/* controls */}
      <div className="ml-auto flex items-center gap-2.5">
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          {active ? (
            <>
              <span className="pulse-soft h-[7px] w-[7px] rounded-full bg-ink" aria-hidden="true" />
              <span className="tnum whitespace-nowrap text-[12.5px] font-medium text-ink">
                {state.running_tasks > 0 ? `${state.running_tasks} running` : state.phase === "interrupting" ? "evaluating" : "working"}
              </span>
            </>
          ) : (
            <>
              <span className={cn("h-[7px] w-[7px] rounded-full", state.phase === "complete" ? "bg-ok" : "bg-line-2")} aria-hidden="true" />
              <span className="whitespace-nowrap text-[12.5px] text-ink-3">{state.phase === "complete" ? "complete" : "idle"}</span>
            </>
          )}
        </div>

        <span className="h-4 w-px bg-line" aria-hidden="true" />

        <IconBtn label="Reset runtime" onClick={onReset}>
          <RotateCcw size={15} strokeWidth={1.75} />
        </IconBtn>

        <button
          type="button"
          onClick={onToggleDev}
          aria-label="Dev Mode"
          aria-pressed={devMode}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium",
            "transition-[background-color,border-color,color] duration-150 active:scale-[0.97]",
            devMode
              ? "border-dark bg-dark text-dark-text"
              : "border-line-2 bg-surface text-ink-2 hover:border-ink/30 hover:text-ink",
          )}
        >
          <TerminalSquare size={14} strokeWidth={1.75} />
          <span className="hidden sm:inline">Dev Mode</span>
        </button>
      </div>
    </header>
  );
}
