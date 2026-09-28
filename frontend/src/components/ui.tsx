import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import type { TaskStatus } from "@/runtime/types";
import { cn } from "@/utils/cn";

/* ————— the interrupted-line motif ————— */

export function ProductMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M2.5 8h6.2l4.6 8h8.2" />
      <circle cx="2.5" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="21.5" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MotifLine({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 12" fill="none" aria-hidden="true" className={cn("h-3 w-28 text-line-2", className)} preserveAspectRatio="none">
      <path d="M1 4h48l14 5h56" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="1" cy="4" r="1.6" fill="currentColor" />
      <circle cx="119" cy="9" r="1.6" fill="currentColor" />
    </svg>
  );
}

/* ————— labels & chips ————— */

export function SectionLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-3">{children}</span>
      {right}
    </div>
  );
}

export function StateChip({ version, tone = "light" }: { version: number; tone?: "light" | "dark" }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-[19px] min-w-[34px] items-center justify-center overflow-hidden rounded-md border px-1.5 font-mono text-[11px] font-medium leading-none",
        tone === "light" ? "border-line-2 bg-surface text-ink-2" : "border-dark/40 bg-dark text-dark-text",
      )}
      aria-label={`state version ${version}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={version}
          initial={{ y: 9, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -9, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.3, 0.7, 0.3, 1] }}
          className="tnum"
        >
          v{version}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ————— status system ————— */

export const STATUS_META: Record<TaskStatus, { word: string; tone: string }> = {
  pending: { word: "pending", tone: "text-ink-3" },
  running: { word: "running", tone: "text-ink" },
  completed: { word: "done", tone: "text-ink-2" },
  cancelled: { word: "cancelled", tone: "text-warn" },
  failed: { word: "failed", tone: "text-danger" },
  stale: { word: "stale", tone: "text-danger" },
  fenced: { word: "fenced", tone: "text-fence" },
  invalidated: { word: "invalidated", tone: "text-danger" },
  preserved: { word: "preserved", tone: "text-ok" },
  archived: { word: "archived", tone: "text-ink-3" },
};

export function StatusGlyph({ status, animate = true }: { status: TaskStatus; animate?: boolean }) {
  const box = "flex h-[18px] w-[18px] items-center justify-center";
  switch (status) {
    case "running":
      return (
        <span className={box}>
          <span className="ring-breathe h-[7px] w-[7px] rounded-full bg-ink" />
        </span>
      );
    case "completed":
    case "preserved":
      return (
        <span className={box}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <motion.path
              d="M2.4 6.4 5 9l4.6-6"
              stroke={status === "preserved" ? "var(--color-ok)" : "var(--color-ink-2)"}
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={animate ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            />
          </svg>
        </span>
      );
    case "invalidated":
    case "stale":
      return (
        <span className={box}>
          <span className="h-[7px] w-[7px] rounded-full border-[1.5px] border-danger" />
        </span>
      );
    case "failed":
      return (
        <span className={box}>
          <span className="h-[7px] w-[7px] rounded-full bg-danger" />
        </span>
      );
    case "fenced":
      return (
        <span className={box}>
          <span className="h-[7px] w-[7px] rounded-[2px] bg-fence" />
        </span>
      );
    case "cancelled":
      return (
        <span className={box}>
          <span className="h-[1.5px] w-[9px] rounded-full bg-warn" />
        </span>
      );
    case "archived":
      return (
        <span className={box}>
          <span className="h-[1.5px] w-[7px] rounded-full bg-line-2" />
        </span>
      );
    default:
      return (
        <span className={box}>
          <span className="h-[6px] w-[6px] rounded-full bg-line-2" />
        </span>
      );
  }
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "fence" | "danger" | "info" }) {
  const tones: Record<string, string> = {
    neutral: "border-line-2 text-ink-2",
    ok: "border-ok/30 text-ok",
    fence: "border-fence/35 text-fence",
    danger: "border-danger/30 text-danger",
    info: "border-info/30 text-info",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border bg-surface px-1.5 py-[1px] font-mono text-[10px] font-medium uppercase tracking-[0.08em]", tones[tone])}>
      {children}
    </span>
  );
}

/* ————— formatters ————— */

export const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export const fmtClockFull = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const fmtValue = (key: string, v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return "—";
  if ((key === "max_price" || key === "budget") && typeof v === "number") return "₹" + v.toLocaleString("en-IN");
  return String(v);
};

export const keyLabel = (key: string): string => {
  const map: Record<string, string> = {
    max_price: "MAX PRICE",
    budget: "BUDGET",
    ram: "RAM",
    category: "CATEGORY",
    targets: "TARGETS",
    location: "LOCATION",
    nights: "NIGHTS",
    guests: "GUESTS",
    objective: "OBJECTIVE",
  };
  return map[key] ?? key.toUpperCase().replace(/_/g, " ");
};

export const spring = { type: "spring", stiffness: 420, damping: 34 } as const;

export function IconBtn({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ink-2",
        "transition-[background-color,border-color,color] duration-150 hover:border-line-2 hover:bg-surface hover:text-ink",
        "active:scale-[0.96]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export { Check };
