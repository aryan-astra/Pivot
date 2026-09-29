import { AnimatePresence, motion } from "framer-motion";
import { X, Zap } from "lucide-react";
import type { ConstraintChange, ImpactSummary, ResultsPayload } from "@/runtime/types";
import { cn } from "@/utils/cn";
import { CrossGlyph, SwirlGlyph } from "./Glyphs";
import { fmtClock, ProductMark, SectionLabel, Tag } from "./ui";

/* ————— stream item model ————— */

export type StreamItem =
  | { kind: "user"; id: string; text: string; time: number; interruption: boolean }
  | { kind: "assistant"; id: string; text: string; time: number; closing?: boolean }
  | { kind: "annotation"; id: string; title: string; version: number; from: number; detail: string; time: number }
  | { kind: "impact"; id: string; from: number; version: number; impact: ImpactSummary; changes: ConstraintChange[]; time: number }
  | { kind: "plan"; id: string; version: number; time: number }
  | { kind: "results"; id: string; version: number; results: ResultsPayload; time: number };

/* ————— renderers ————— */

export function UserMessage({ text, time, interruption }: { text: string; time: number; interruption: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex flex-col items-end"
    >
      <div className="flex items-center gap-2">
        {interruption && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-warn">
            <Zap size={10} strokeWidth={2.2} aria-hidden="true" />
            interrupt
          </span>
        )}
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
          You · <span className="tnum">{fmtClock(time)}</span>
        </span>
      </div>
      <p className={cn("mt-1.5 max-w-[86%] text-right text-[15px] leading-[1.55] md:text-[15.5px]", interruption ? "font-medium text-ink" : "text-ink")}>
        {text}
      </p>
    </motion.div>
  );
}

export function AssistantNote({ text, time, closing }: { text: string; time: number; closing?: boolean }) {
  const isRecovery = /recovery complete/i.test(text);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
      className="max-w-[64ch]"
    >
      <div className="flex items-center gap-2">
        {isRecovery ? (
          <SwirlGlyph strokeWidth={14} className="h-4 w-4 text-accent" />
        ) : (
          <ProductMark size={13} className="text-ink-2" />
        )}
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
          Agent · <span className="tnum">{fmtClock(time)}</span>
        </span>
      </div>
      <p className={cn("mt-1.5 text-[15px] leading-[1.6]", closing ? "font-medium text-ink" : "text-ink-2")}>{text}</p>
    </motion.div>
  );
}

export function SystemAnnotation({ title, version, detail, time }: { title: string; version: number; detail: string; time: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
      role="note"
      className="border-l-2 border-fence/70 py-1 pl-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-fence">
          <CrossGlyph className="h-3 w-3 text-fence" />
          {title}
        </span>
        <span className="tnum font-mono text-[11px] text-ink-2">state v{version}</span>
        <span className="tnum font-mono text-[10.5px] text-ink-3">{fmtClock(time)}</span>
      </div>
      <p className="mt-1 text-[13.5px] leading-[1.55] text-ink-2">{detail}</p>
    </motion.div>
  );
}

export function ResultsBlock({ results, version }: { results: ResultsPayload; version: number }) {
  return (
    <motion.section
      aria-label="Results"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <SectionLabel right={<span className="tnum font-mono text-[11px] text-ink-3">committed · v{version}</span>}>Results</SectionLabel>
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3 md:px-5">
          <h3 className="truncate font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">{results.heading}</h3>
          {results.note && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-ok" aria-hidden="true" />
              {results.note}
            </p>
          )}
        </div>
        <ul>
          {results.items.map((item, i) => (
            <motion.li
              key={item.title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.1 + i * 0.07, ease: [0.22, 0.61, 0.36, 1] }}
              className="flex items-baseline gap-3.5 border-b border-line px-4 py-3 last:border-b-0 md:px-5"
            >
              <span className="tnum shrink-0 font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium text-ink">{item.title}</span>
                <span className="mt-[1px] block truncate font-mono text-[11.5px] text-ink-2">{item.detail}</span>
              </span>
              <Tag>{item.badge}</Tag>
            </motion.li>
          ))}
        </ul>
        <div className="border-t border-line bg-surface-2 px-4 py-2 md:px-5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">{results.meta}</span>
        </div>
      </div>
    </motion.section>
  );
}

/* ————— notification strip ————— */

export interface Notice {
  id: number;
  tone: "fence" | "ok" | "info";
  label: string;
  version?: number;
  text: string;
}

export function NoticeStack({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-40 flex w-full max-w-[560px] -translate-x-1/2 flex-col gap-2 px-4" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {notices.map((n) => (
          <motion.div
            key={n.id}
            layout
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
            className="pointer-events-auto flex items-center gap-3 overflow-hidden rounded-lg border border-line bg-surface py-2 pl-3 pr-2 shadow-lift"
          >
            <span
              className={cn("h-4 w-[2.5px] shrink-0 rounded-full", n.tone === "fence" ? "bg-fence" : n.tone === "ok" ? "bg-ok" : "bg-info")}
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
              <span className={cn("mr-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em]", n.tone === "fence" ? "text-fence" : n.tone === "ok" ? "text-ok" : "text-info")}>
                {n.label}
                {n.version ? ` · v${n.version}` : ""}
              </span>
              {n.text}
            </p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(n.id)}
              className="shrink-0 rounded-md p-1 text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
