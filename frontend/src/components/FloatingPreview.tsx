import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import type { EnginePhase, Task } from "@/runtime/types";
import { LiveTaskPreview, isBrowserSearchTask } from "./LiveTaskPreview";

/**
 * Floating picture-in-picture browser preview.
 *
 * The card lives in a fixed, viewport-wide (pointer-transparent) layer so it
 * never scrolls away with the conversation and never reflows the execution
 * list — it hovers near the bottom-left corner, clear of the composer, and
 * can be dragged by its header to any other corner. Selection priority:
 *
 *   1. a simulated search task (embedded demo runtime) keeps its site window
 *      while the run is active — real browser runs never show the mockup;
 *   2. the newest real browser capture — visible while the rest of the run
 *      continues and pinned after it settles;
 *   3. otherwise any running/pending task falls back to the honest activity
 *      card while live;
 *   4. nothing — the card unmounts (no permanent preview for runs that never
 *      touched a browser).
 *
 * The header doubles as the drag handle and carries a minimize toggle, which
 * shrinks the card to a header pill. Minimizing re-arms on a new state
 * version (a fresh run or an interruption deserves the window back).
 */
export function FloatingPreview({
  tasks,
  phase,
  version,
  requestText,
}: {
  tasks: Task[];
  phase: EnginePhase;
  version: number;
  requestText: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);

  // A new run (or a recovery version) re-opens a window the user minimized.
  useEffect(() => setCollapsed(false), [version]);

  const live = phase === "running" || phase === "planning" || phase === "interrupting";
  const current = tasks.filter((task) => task.created_in === version);
  const runningTask = current.find((task) => task.status === "running") ?? current.find((task) => task.status === "pending");
  const siteWindowTask =
    live && runningTask && runningTask.simulated && isBrowserSearchTask(runningTask) ? runningTask : undefined;
  const pinnedCapture = [...current].reverse().find((task) => task.screenshot);
  const previewTask = siteWindowTask ?? pinnedCapture ?? (live ? runningTask : undefined);
  const settled = !siteWindowTask && Boolean(pinnedCapture) && previewTask === pinnedCapture && !live;

  return (
    <div ref={layerRef} className="pointer-events-none fixed inset-0 z-30">
      <AnimatePresence>
        {previewTask ? (
          <motion.div
            key="floating-preview"
            drag
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={layerRef}
            dragMomentum={false}
            dragElastic={0.05}
            whileDrag={{ scale: 1.02 }}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            className="pointer-events-auto absolute bottom-36 left-4 w-[min(276px,calc(100vw-2rem))] shadow-float sm:left-6"
          >
            <LiveTaskPreview
              task={previewTask}
              requestText={requestText}
              siteWindow={Boolean(siteWindowTask)}
              settled={settled}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((value) => !value)}
              onHeaderPointerDown={(event) => dragControls.start(event)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
