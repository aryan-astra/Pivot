import { motion } from "framer-motion";
import type { EnginePhase, Task } from "@/runtime/types";
import { cn } from "@/utils/cn";
import { SectionLabel, StateChip, StatusGlyph, STATUS_META, Tag } from "./ui";

function ExecutionTask({ task, index, isLast }: { task: Task; index: number; isLast: boolean }) {
  const meta = STATUS_META[task.status];
  const receded = task.status === "invalidated" || task.status === "archived" || task.status === "cancelled";
  const reads = task.reads.length > 0 ? `reads ${task.reads.join(" · ")}` : "no dependencies";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: receded ? 0.5 : 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.045, ease: [0.22, 0.61, 0.36, 1] }}
      className="relative py-[9px] pl-8 pr-2 transition-[background-color] duration-150 hover:bg-surface-2"
    >
      {/* timeline rail */}
      {index > 0 && <span className="absolute left-[8.5px] top-0 h-[calc(50%-9px)] w-px bg-line" aria-hidden="true" />}
      {!isLast && <span className="absolute bottom-0 left-[8.5px] top-[calc(50%+9px)] w-px bg-line" aria-hidden="true" />}
      {task.status === "fenced" && <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-fence/70" aria-hidden="true" />}

      <div className="relative flex items-center gap-3">
        <span className="absolute -left-8 flex w-[18px] justify-center">
          <span className="relative z-10 bg-surface">
            <StatusGlyph status={task.status} />
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <span className={cn("truncate text-[14.5px] font-medium leading-snug text-ink", receded && "text-ink-2")}>{task.label}</span>
            {task.status === "preserved" && <Tag tone="ok">preserved</Tag>}
            {task.status === "fenced" && <Tag tone="fence">fenced</Tag>}
            {task.status === "invalidated" && <Tag tone="danger">invalidated</Tag>}
          </div>
          <div className="mt-[1px] truncate font-mono text-[11px] text-ink-3">
            {task.status === "completed" || task.status === "preserved" || task.status === "fenced"
              ? task.output ?? reads
              : reads}
            <span className="text-line-2"> · </span>
            <span className="tnum">{task.task_id}</span>
            {task.execution_class === "critical" && (
              <>
                <span className="text-line-2"> · </span>
                <span className="uppercase tracking-[0.06em]">critical</span>
              </>
            )}
            {task.execution_class === "interruptible" && task.status === "pending" && (
              <>
                <span className="text-line-2"> · </span>
                <span className="uppercase tracking-[0.06em]">interruptible</span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {task.status === "running" ? (
            <span className="tnum font-mono text-[11px] font-medium text-ink">{task.progress}%</span>
          ) : !["preserved", "fenced", "invalidated"].includes(task.status) ? (
            <span className={cn("font-mono text-[10.5px] font-medium uppercase tracking-[0.1em]", meta.tone)}>{meta.word}</span>
          ) : null}
        </div>
      </div>

      {/* live progress hairline */}
      {task.status === "running" && (
        <span
          className="absolute inset-x-8 bottom-0 h-[2px] rounded-full bg-ink/12 transition-[width] duration-500 ease-linear"
          style={{ width: `${task.progress}%` }}
          aria-hidden="true"
        />
      )}
    </motion.li>
  );
}

export function ExecutionSection({
  version,
  tasks,
  phase,
  currentVersion,
  swept,
}: {
  version: number;
  tasks: Task[];
  phase: EnginePhase;
  currentVersion: number;
  swept: boolean;
}) {
  const done = tasks.filter((t) => ["completed", "preserved", "fenced", "archived"].includes(t.status)).length;
  const isLive = version === currentVersion && (phase === "running" || phase === "planning" || phase === "interrupting");
  const paused = isLive && phase === "interrupting";

  if (tasks.length === 0) return null;

  return (
    <section aria-label={`Execution plan, state version ${version}`} className="relative">
      <div className="flex items-center gap-2.5">
        <SectionLabel>Execution</SectionLabel>
        <StateChip version={version} />
        {paused && <Tag tone="fence">paused · evaluating</Tag>}
        {isLive && !paused && phase !== "planning" && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            <span className="caret-blink inline-block h-[11px] w-[5px] rounded-[1px] bg-ink/70" aria-hidden="true" />
            live
          </span>
        )}
        <span className="tnum ml-auto font-mono text-[11px] text-ink-3">
          {done}/{tasks.length} steps
        </span>
      </div>

      <div className="relative mt-3 overflow-hidden rounded-xl border border-line bg-surface">
        {swept && <span className="sweep-line z-10" aria-hidden="true" />}
        <ul className="px-2 py-1.5 md:px-3">
          {tasks.map((t, i) => (
            <ExecutionTask key={t.task_id} task={t} index={i} isLast={i === tasks.length - 1} />
          ))}
        </ul>
      </div>
    </section>
  );
}
