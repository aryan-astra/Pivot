import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import "./StatusMark.css";

const UI = { type: "spring" as const, duration: 0.3, bounce: 0 };
const MORPH = { duration: 0.3, ease: [0.77, 0, 0.175, 1] as const };
const CHECK = "M7.5 12.25 10.5 15.25 16.75 8.75";
const CROSS = "M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5";
const TEXT: Record<StatusMarkStatus, string> = {
  pending: "Pending",
  running: "In progress",
  done: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
const IDLE_DASH = 0.3;
type StatusMarkStatus = "pending" | "running" | "done" | "failed" | "cancelled";
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export type StatusMarkProps = {
  status?: StatusMarkStatus;
  progress?: number;
  label?: ReactNode;
  color?: string;
  doneColor?: string;
  errorColor?: string;
  size?: number;
  strokeWidth?: number;
  dashes?: number;
  fontSize?: number;
  spinDuration?: number;
  arcLength?: number;
  drawDuration?: number;
  fillOpacity?: number;
  strike?: boolean;
  strikeDelay?: number;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
};

export default function StatusMark({
  status = "pending",
  progress,
  label,
  color = "currentColor",
  doneColor = "#22c55e",
  errorColor = "#ef4444",
  size = 20,
  strokeWidth = 2,
  dashes = 8,
  fontSize = 14,
  spinDuration = 1100,
  arcLength = 0.68,
  drawDuration = 240,
  fillOpacity = 0.06,
  strike = true,
  strikeDelay = 60,
  ariaLabel,
  className = "",
  style,
}: StatusMarkProps) {
  const reduce = useReducedMotion();
  const r = Math.max(1, 10 - strokeWidth / 2);
  const circumference = 2 * Math.PI * r;
  const dashPeriod = circumference / Math.max(1, dashes);
  const determinate = status === "running" && Number.isFinite(progress);
  const indeterminate = status === "running" && !determinate;
  const solid = status === "running" || status === "done" || status === "failed";
  const targetArc = indeterminate ? arcLength : determinate ? clamp01(progress ?? 0) : 1;
  const mode = useMotionValue(solid ? 1 : 0);
  const arc = useMotionValue(targetArc);
  const travel = useMotionValue(0);
  const ringRef = useRef<SVGCircleElement>(null);
  const geo = useRef({ circumference, dashPeriod });
  geo.current = { circumference, dashPeriod };
  const generation = useRef(0);

  const writeDash = () => {
    const g = geo.current;
    const m = mode.get();
    const a = arc.get();
    const dash = IDLE_DASH * g.dashPeriod + (a * g.circumference - IDLE_DASH * g.dashPeriod) * m;
    const gap = (1 - IDLE_DASH) * g.dashPeriod + ((1 - a) * g.circumference - (1 - IDLE_DASH) * g.dashPeriod) * m;
    ringRef.current?.setAttribute("stroke-dasharray", `${Math.max(0, dash)} ${Math.max(0, gap)}`);
  };

  useLayoutEffect(() => {
    writeDash();
    ringRef.current?.setAttribute("stroke-dashoffset", String(travel.get()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circumference, dashPeriod]);

  useEffect(() => {
    const offs = [
      mode.on("change", writeDash),
      arc.on("change", writeDash),
      travel.on("change", (value) => ringRef.current?.setAttribute("stroke-dashoffset", String(value))),
    ];
    return () => {
      offs.forEach((off) => off());
      mode.stop();
      arc.stop();
      travel.stop();
    };
    // Motion values are stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = ++generation.current;
    if (reduce) {
      mode.jump(solid ? 1 : 0);
      arc.jump(targetArc);
      travel.jump(0);
      return undefined;
    }
    if (mode.get() === 0) arc.jump(targetArc);
    const modeAnimation = animate(mode, solid ? 1 : 0, MORPH);
    const arcAnimation = animate(arc, targetArc, UI);
    let travelAnimation: ReturnType<typeof animate> | undefined;
    if (indeterminate) {
      const from = travel.get();
      travelAnimation = animate(travel, [from, from - circumference], {
        duration: Math.max(1, spinDuration) / 1000,
        ease: "linear",
        repeat: Infinity,
      });
    } else {
      const unit = determinate ? circumference : dashPeriod;
      const target = Math.floor(travel.get() / unit) * unit;
      travelAnimation = animate(travel, target, UI);
      travelAnimation.then(() => {
        if (generation.current === id) travel.jump(0);
      });
    }
    return () => {
      modeAnimation.stop();
      arcAnimation.stop();
      travelAnimation?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, determinate, targetArc, reduce, circumference, dashPeriod, spinDuration]);

  const spoken = `${TEXT[status]}${determinate ? `, ${Math.round(clamp01(progress ?? 0) * 100)}%` : ""}`;
  const hasLabel = label !== undefined && label !== null;

  return (
    <span
      className={`status-mark${className ? ` ${className}` : ""}`}
      data-status={status}
      data-indeterminate={indeterminate ? "" : undefined}
      data-strike={strike ? "" : undefined}
      style={{
        "--sm-size": `${size}px`,
        "--sm-stroke": strokeWidth,
        "--sm-color": color,
        "--sm-done": doneColor,
        "--sm-error": errorColor,
        "--sm-fill": fillOpacity,
        "--sm-font": `${fontSize}px`,
        "--sm-draw": `${drawDuration}ms`,
        "--sm-strike-delay": `${120 + strikeDelay}ms`,
        ...style,
      } as CSSProperties}
    >
      <svg
        className="status-mark__glyph"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        role={hasLabel ? undefined : "img"}
        aria-label={hasLabel ? undefined : ariaLabel ?? spoken}
        aria-hidden={hasLabel || undefined}
      >
        <circle className="status-mark__track" cx="12" cy="12" r={r} transform="rotate(-90 12 12)" />
        <circle ref={ringRef} className="status-mark__ring" cx="12" cy="12" r={r} transform="rotate(-90 12 12)" />
        <path className="status-mark__check" d={CHECK} pathLength="1" />
        <path className="status-mark__cross" d={CROSS} pathLength="1" />
      </svg>
      {hasLabel ? <span className="status-mark__sr">{spoken}: </span> : null}
      {hasLabel ? <span className="status-mark__label">{label}<span className="status-mark__strike" aria-hidden="true" /></span> : null}
    </span>
  );
}
