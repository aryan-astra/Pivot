import { motion, useReducedMotion } from "framer-motion";
import type { EnginePhase, Task } from "@/runtime/types";
import { cn } from "@/utils/cn";
import CallChip from "./CallChip";
import SpringCheck from "./SpringCheck";
import StatusMark from "./StatusMark";
import ThoughtLine from "./ThoughtLine";
import Strands from "./Strands";
import { LiveTaskPreview } from "./LiveTaskPreview";
import { SectionLabel, StateChip, STATUS_META, Tag } from "./ui";

function toolStatus(task: Task): "idle" | "running" | "done" | "error" {
  if (task.status === "pending") return "idle";
  if (task.status === "running") return "running";
  if (task.status === "failed") return "error";
  return "done";
}

function markStatus(task: Task): "pending" | "running" | "done" | "failed" | "cancelled" {
  if (task.status === "running") return "running";
  if (task.status === "completed" || task.status === "preserved") return "done";
  if (task.status === "failed") return "failed";
  if (task.status === "pending") return "pending";
  return "cancelled";
}

function toolIcon(operation: string): "terminal" | "file" | "search" | "edit" {
  if (/search|browser|query/i.test(operation)) return "search";
  if (/parse|file|result/i.test(operation)) return "file";
  if (/update|edit|rebuild|rank|compare/i.test(operation)) return "edit";
  return "terminal";
}

function toolName(operation: string): string {
  return operation.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 20) || "agent";
}

function isBrowserSearchTask(task: Task): boolean {
  return /search|browser/i.test(`${task.operation} ${task.label}`);
}

function ExecutionTask({ task, index, isLast }: { task: Task; index: number; isLast: boolean }) {
  const meta = STATUS_META[task.status];
  const receded = task.status === "invalidated" || task.status === "archived" || task.status === "cancelled";
  const reads = task.reads.length > 0 ? `reads ${task.reads.join(" · ")}` : "no dependencies";
  const completed = task.status === "completed" || task.status === "preserved";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: receded ? 0.54 : 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.035, ease: [0.22, 0.61, 0.36, 1] }}
      className="relative px-2 py-[10px] transition-[background-color] duration-150 hover:bg-surface-2 sm:px-3"
    >
      {index > 0 && <span className="absolute left-[8.5px] top-0 h-[calc(50%-9px)] w-px bg-line" aria-hidden="true" />}
      {!isLast && <span className="absolute bottom-0 left-[8.5px] top-[calc(50%+9px)] w-px bg-line" aria-hidden="true" />}
      {task.status === "fenced" && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-fence/70" aria-hidden="true" />}

      <div className="relative flex min-w-0 items-start gap-3">
        <span className="relative z-10 mt-[1px] flex w-[18px] shrink-0 justify-center bg-surface">
          <SpringCheck
            label=""
            ariaLabel={`${task.label}, ${completed ? "complete" : meta.word}`}
            checked={completed}
            readOnly
            boxSize={18}
            boxRadius={6}
            color="var(--color-ink-2)"
            fillColor="var(--color-ok)"
            checkColor="var(--color-dark-text)"
            fontSize={12}
            doneOpacity={0.62}
            className="task-check"
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={cn("min-w-0 truncate text-[14px] font-medium leading-snug text-ink", receded && "text-ink-2")}>{task.label}</span>
            {task.status === "preserved" && <Tag tone="ok">preserved</Tag>}
            {task.status === "fenced" && <Tag tone="fence">fenced</Tag>}
            {task.status === "invalidated" && <Tag tone="danger">invalidated</Tag>}
          </div>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
            <CallChip
              icon={toolIcon(task.operation)}
              name={toolName(task.operation)}
              argument={task.label}
              status={toolStatus(task)}
              expectedMs={8000}
              size={27}
              radius={8}
              color="var(--color-tool-ink)"
              surfaceColor="var(--color-tool-surface)"
              progressColor="var(--color-accent)"
              progressOpacity={0.12}
              doneColor="var(--color-ok)"
              errorColor="var(--color-danger)"
              washOpacity={0.12}
              showTimer={task.status === "running"}
            />
            <span className="min-w-0 truncate font-mono text-[10px] text-ink-3">
              {task.output && completed ? task.output : reads}
              <span className="text-line-2"> · </span><span className="tnum">{task.task_id}</span>
              {task.execution_class === "critical" ? <><span className="text-line-2"> · </span><span className="uppercase tracking-[0.06em]">critical</span></> : null}
              {task.execution_class === "interruptible" && task.status === "pending" ? <><span className="text-line-2"> · </span><span className="uppercase tracking-[0.06em]">interruptible</span></> : null}
            </span>
          </div>
        </div>

        <div className="mt-1 flex shrink-0 items-center gap-2">
          <StatusMark
            status={markStatus(task)}
            progress={task.status === "running" ? task.progress / 100 : undefined}
            size={17}
            strokeWidth={2}
            color="var(--color-ink-2)"
            doneColor="var(--color-ok)"
            errorColor="var(--color-danger)"
            strike={false}
            aria-label={`${task.label}: ${meta.word}`}
          />
          {task.status === "running" ? <span className="tnum min-w-8 text-right font-mono text-[10px] font-medium text-ink-2">{task.progress}%</span> : <span className={cn("min-w-8 text-right font-mono text-[9px] font-medium uppercase tracking-[0.1em]", meta.tone)}>{meta.word}</span>}
        </div>
      </div>

      {task.status === "running" ? <span className="absolute inset-x-10 bottom-0 h-[2px] rounded-full bg-ink/10" aria-hidden="true"><span className="block h-full rounded-full bg-ink/45 transition-[width] duration-500 ease-linear" style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }} /></span> : null}
    </motion.li>
  );
}

export function ExecutionSection({
  version,
  tasks,
  phase,
  currentVersion,
  swept,
  strandColors,
  requestText,
}: {
  version: number;
  tasks: Task[];
  phase: EnginePhase;
  currentVersion: number;
  swept: boolean;
  strandColors: string[];
  requestText: string;
}) {
  const done = tasks.filter((task) => ["completed", "preserved", "fenced", "archived"].includes(task.status)).length;
  const reduceMotion = useReducedMotion();
  const isLive = version === currentVersion && (phase === "running" || phase === "planning" || phase === "interrupting");
  const paused = isLive && phase === "interrupting";
  const activeTasks = tasks.filter((task) => task.status === "running").map((task) => task.label);
  // Live preview follows whatever is actually running: a search task keeps
  // the site window, any other task gets the honest activity card. This is
  // why non-search requests (e.g. a generic "go to …") still show a preview.
  const previewTask = isLive
    ? tasks.find((task) => isBrowserSearchTask(task) && task.status === "running")
      ?? tasks.find((task) => task.status === "running")
      ?? tasks.find((task) => isBrowserSearchTask(task) && task.status === "pending")
      ?? tasks.find((task) => task.status === "pending")
    : undefined;

  if (tasks.length === 0) return null;

  return (
    <section aria-label={`Execution plan, state version ${version}`} className="relative">
      <div className="flex items-center gap-2.5">
        <SectionLabel>Execution</SectionLabel>
        <StateChip version={version} />
        {paused && <Tag tone="fence">paused · evaluating</Tag>}
        {isLive && !paused && phase !== "planning" ? <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3"><span className="caret-blink inline-block h-[10px] w-[4px] rounded-[1px] bg-ink/70" aria-hidden="true" />live</span> : null}
        {isLive ? (
          <span className="execution-strands relative h-6 w-12 shrink-0 overflow-hidden rounded-full sm:h-8 sm:w-24" aria-hidden="true">
            <Strands
              colors={strandColors}
              count={4}
              speed={reduceMotion ? 0 : 0.38}
              amplitude={1.35}
              waviness={0.9}
              thickness={0.72}
              glow={2.2}
              taper={2.5}
              spread={1.6}
              intensity={0.72}
              saturation={1.2}
              opacity={0.85}
              scale={1.4}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", maskImage: "radial-gradient(ellipse at center, #000 34%, transparent 98%)" }}
            />
          </span>
        ) : null}
        <span className="tnum ml-auto font-mono text-[10.5px] text-ink-3">{done}/{tasks.length} steps</span>
      </div>

      <div className="mt-2.5 pl-1">
        <ThoughtLine
          working={isLive}
          label={paused ? "Re-evaluating the changed request…" : phase === "planning" ? "Preparing the execution plan…" : "Running valid work…"}
          doneLabel="Run settled in"
          glyph="sparkle"
          steps={isLive ? (activeTasks.length ? activeTasks : [phase === "planning" ? "Preparing the execution plan" : "Waiting for the next tool"]): []}
          collapsible
          collapseOnSettle
          showTimer
          fontSize={12}
          color="var(--color-ink-2)"
          glyphColor="var(--color-accent)"
          breathDepth={0.28}
          shimmer
          settleDuration={260}
        />
      </div>

      <div className={cn("mt-2.5 grid items-start gap-3", previewTask && "lg:grid-cols-[minmax(0,1fr)_280px]")}>
        <div className="relative min-w-0 overflow-hidden rounded-xl border border-line bg-surface">
          {swept && <span className="sweep-line z-10" aria-hidden="true" />}
          <ul className="divide-y divide-line/80 px-1.5 py-1 sm:px-2">
            {tasks.map((task, index) => <ExecutionTask key={task.task_id} task={task} index={index} isLast={index === tasks.length - 1} />)}
          </ul>
        </div>
        {previewTask ? <LiveTaskPreview task={previewTask} requestText={requestText} siteWindow={isBrowserSearchTask(previewTask)} /> : null}
      </div>
    </section>
  );
}
