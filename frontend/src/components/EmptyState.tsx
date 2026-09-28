import { motion } from "framer-motion";
import { ArrowRight, BedDouble, Laptop, UtensilsCrossed } from "lucide-react";
import { CrossGlyph, HomeGlyph, SparkleGlyph, SwirlGlyph } from "./Glyphs";
import { MotifLine, SectionLabel } from "./ui";

const EXAMPLES = [
  {
    icon: Laptop,
    text: "Find laptops under ₹60,000 with 8 GB RAM on Amazon and Flipkart",
    hint: "shopping · 2 targets",
  },
  {
    icon: UtensilsCrossed,
    text: "Find restaurants near me under ₹2,000",
    hint: "dining · budget bound",
  },
  {
    icon: BedDouble,
    text: "Find a hotel in Bengaluru for three nights",
    hint: "travel · 3 nights",
  },
];

const INTERRUPT_HINTS = [
  "“actually, make it 16 GB RAM”",
  "“budget is ₹80,000 now”",
  "“only on Flipkart”",
];

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="relative mx-auto flex w-full max-w-[840px] flex-col px-5 pb-28 pt-[7vh] md:px-8 md:pb-24 md:pt-[11vh]">
      {/* opening statement — left-aligned, editorial */}
      <motion.div
        className="relative"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-3">Interruptible runtime</span>
          <MotifLine className="w-20 text-line-2" />
        </div>

        <h1 className="mt-6 max-w-[15ch] font-display text-[40px] font-semibold leading-[1.02] tracking-[-0.025em] text-ink md:text-[56px]">
          Change your mind,
          <br />
          mid&#8209;execution.
        </h1>

        <p className="mt-6 max-w-[52ch] text-[15.5px] leading-[1.6] text-ink-2 md:text-[16.5px]">
          Interrupt an agent without throwing away valid work. The runtime preserves what still
          applies, fences results that can no longer commit, and rebuilds only what changed.
        </p>

        {/* decorative mark cluster — desktop only, purely ornamental */}
        <motion.div
          aria-hidden="true"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
          className="pointer-events-none absolute right-0 top-0 hidden h-[190px] w-[240px] lg:block"
        >
          <SparkleGlyph className="absolute right-[176px] top-[6px] w-[22px] text-ink-3/55" />
          <CrossGlyph className="absolute right-[6px] top-[26px] w-[140px] text-line" />
          <SwirlGlyph strokeWidth={9} className="absolute right-[118px] top-[74px] w-[96px] text-line-2/70" />
          <HomeGlyph className="absolute right-[30px] top-[112px] w-[54px] text-ink-3/45" />
        </motion.div>
      </motion.div>

      {/* example prompts — refined list, not cards */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
        className="mt-14"
      >
        <SectionLabel
          right={<span className="font-mono text-[10.5px] tracking-[0.08em] text-ink-3">then interrupt it mid-run</span>}
        >
          Try an example
        </SectionLabel>

        <div className="mt-4 border-t border-line" aria-label="Example prompts">
          {EXAMPLES.map((ex, i) => (
            <button
              key={ex.text}
              type="button"
              onClick={() => onPick(ex.text)}
              className="group flex w-full items-center gap-4 border-b border-line px-2 py-[15px] text-left transition-[background-color,border-color] duration-150 last:border-b-0 hover:border-line-2 hover:bg-surface md:gap-5 md:px-3"
            >
              <span className="tnum w-6 shrink-0 font-mono text-[11px] text-ink-3 transition-colors duration-150 group-hover:text-ink-2">
                {String(i + 1).padStart(2, "0")}
              </span>
              <ex.icon size={16} strokeWidth={1.6} className="shrink-0 text-ink-3 transition-colors duration-150 group-hover:text-ink" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] text-ink transition-transform duration-200 ease-out group-hover:translate-x-[3px] md:truncate md:text-[15.5px]">
                  {ex.text}
                </span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3/80">{ex.hint}</span>
              </span>
              <ArrowRight
                size={15}
                strokeWidth={1.75}
                className="shrink-0 text-ink-3/50 transition-[opacity,transform,color] duration-200 group-hover:translate-x-[2px] group-hover:text-ink"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>

        {/* status vocabulary — teaches the semantic language */}
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">Vocabulary</span>
          {[
            { dot: "bg-ok", label: "preserved", note: "still valid, reused" },
            { dot: "bg-fence", label: "fenced", note: "blocked from commit" },
            { dot: "border border-danger bg-transparent", label: "invalidated", note: "superseded" },
          ].map((v) => (
            <span key={v.label} className="inline-flex items-baseline gap-2 text-[12.5px] text-ink-2">
              <span className={`h-[7px] w-[7px] shrink-0 translate-y-[-1px] rounded-full ${v.dot}`} aria-hidden="true" />
              <span className="font-medium text-ink">{v.label}</span>
              <span className="text-ink-3">{v.note}</span>
            </span>
          ))}
        </div>

        <p className="mt-8 text-[13px] leading-relaxed text-ink-3">
          While the agent works, type a new requirement — for example{" "}
          <em className="font-mono not-italic text-ink-2">{INTERRUPT_HINTS[0]}</em> — and watch the runtime
          decide what survives.
        </p>
      </motion.div>
    </div>
  );
}
