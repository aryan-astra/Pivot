import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import type { ConstraintChange, ImpactSummary } from "@/runtime/types";
import { cn } from "@/utils/cn";
import { fmtValue, keyLabel, SectionLabel } from "./ui";

export function ImpactAnalysis({
  from,
  version,
  impact,
  changes,
}: {
  from: number;
  version: number;
  impact: ImpactSummary;
  changes: ConstraintChange[];
}) {
  const total = Math.max(1, impact.preserved + impact.invalidated + impact.fenced);
  const segments = [
    { key: "preserved", n: impact.preserved, color: "var(--color-ok)", label: "preserved", note: "reused as-is" },
    { key: "invalidated", n: impact.invalidated, color: "var(--color-danger)", label: "invalidated", note: "superseded" },
    { key: "fenced", n: impact.fenced, color: "var(--color-fence)", label: "fenced", note: "blocked from commit" },
  ];

  return (
    <motion.section
      aria-label="Impact analysis"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <SectionLabel
        right={
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-2">
            <span className="tnum">v{from}</span>
            <ArrowRight size={11} strokeWidth={2} className="text-ink-3" aria-hidden="true" />
            <span className="tnum font-medium text-ink">v{version}</span>
          </span>
        }
      >
        Impact analysis
      </SectionLabel>

      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
        {/* headline numbers */}
        <dl className="grid grid-cols-3">
          {segments.map((s, i) => (
            <div key={s.key} className={cn("px-4 py-4 md:px-5", i > 0 && "border-l border-line")}>
              <dt className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
                <span className="h-[6px] w-[6px] rounded-full" style={{ background: s.color }} aria-hidden="true" />
                {s.label}
              </dt>
              <dd className="tnum mt-1 font-display text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink">
                {String(s.n).padStart(2, "0")}
              </dd>
              <p className="mt-1.5 hidden text-[12px] text-ink-3 sm:block">{s.note}</p>
            </div>
          ))}
        </dl>

        {/* validity map */}
        <div className="border-t border-line px-4 py-3.5 md:px-5">
          <div className="flex h-[6px] w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${impact.preserved} preserved, ${impact.invalidated} invalidated, ${impact.fenced} fenced`}>
            {segments.map(
              (s) =>
                s.n > 0 && (
                  <motion.span
                    key={s.key}
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.n / total) * 100}%` }}
                    transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1], delay: 0.15 }}
                    style={{ background: s.color }}
                  />
                ),
            )}
          </div>
          <p className="mt-2.5 text-[12.5px] text-ink-2">
            {impact.preserved > 0 ? (
              <>
                <strong className="font-medium text-ink">{impact.preserved} completed step{impact.preserved === 1 ? "" : "s"}</strong> survived the
                change and {impact.preserved === 1 ? "was" : "were"} reused without recomputation.
              </>
            ) : (
              <>No completed work survived this change.</>
            )}
            {impact.fenced > 0 && (
              <>
                {" "}
                <strong className="font-medium text-fence">{impact.fenced} result set{impact.fenced === 1 ? "" : "s"}</strong>{" "}
                {impact.fenced === 1 ? "is" : "are"} fenced — visible, but excluded from the final commit.
              </>
            )}
          </p>
        </div>

        {/* what changed */}
        {changes.length > 0 && (
          <div className="border-t border-line">
            {changes.map((ch) => (
              <div key={ch.key} className="flex items-baseline gap-3 border-b border-line px-4 py-2.5 last:border-b-0 md:px-5">
                <span className="w-[92px] shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">{keyLabel(ch.key)}</span>
                <span className="tnum min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">
                  {fmtValue(ch.key, ch.from)}
                  <ArrowRight size={11} strokeWidth={2} className="mx-2 inline-block translate-y-[1px] text-ink-3" aria-hidden="true" />
                  <span className="font-medium text-ink">{fmtValue(ch.key, ch.to)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}
