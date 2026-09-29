import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from "react";

type Spark = { x: number; y: number; angle: number; startTime: number };
type Easing = "linear" | "ease-in" | "ease-in-out" | "ease-out";

const resolveCanvasColor = (canvas: HTMLCanvasElement, color: string) => {
  const variable = color.match(/^var\(\s*(--[\w-]+)/)?.[1];
  return variable ? getComputedStyle(canvas).getPropertyValue(variable).trim() || color : color;
};

export type ClickSparkProps = {
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
  easing?: Easing;
  extraScale?: number;
  children: ReactNode;
};

export default function ClickSpark({
  sparkColor = "#fff",
  sparkSize = 10,
  sparkRadius = 15,
  sparkCount = 8,
  duration = 400,
  easing = "ease-out",
  extraScale = 1,
  children,
}: ClickSparkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const scheduleRef = useRef<(() => void) | null>(null);
  const configRef = useRef({ sparkColor, sparkSize, sparkRadius, sparkCount, duration, easing, extraScale });
  configRef.current = { sparkColor, sparkSize, sparkRadius, sparkCount, duration, easing, extraScale };

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return undefined;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    const resizeCanvas = () => {
      const rect = parent.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(parent);

    const ease = (t: number, kind: Easing) => {
      if (kind === "linear") return t;
      if (kind === "ease-in") return t * t;
      if (kind === "ease-in-out") return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      return t * (2 - t);
    };
    const draw = (timestamp: number) => {
      const cfg = configRef.current;
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = resolveCanvasColor(canvas, cfg.sparkColor);
      ctx.lineWidth = Math.max(1, dpr * 0.18);
      ctx.lineCap = "round";
      sparksRef.current = sparksRef.current.filter((spark) => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= Math.max(1, cfg.duration)) return false;
        const progress = Math.max(0, Math.min(1, elapsed / Math.max(1, cfg.duration)));
        const eased = ease(progress, cfg.easing);
        const distance = eased * cfg.sparkRadius * cfg.extraScale;
        const lineLength = cfg.sparkSize * (1 - eased);
        const x1 = spark.x + distance * Math.cos(spark.angle);
        const y1 = spark.y + distance * Math.sin(spark.angle);
        const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
        const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);
        ctx.globalAlpha = 1 - progress;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return true;
      });
      ctx.globalAlpha = 1;
      if (sparksRef.current.length > 0) raf = requestAnimationFrame(draw);
      else raf = 0;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    scheduleRef.current = schedule;

    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      scheduleRef.current = null;
      sparksRef.current = [];
    };
  }, []);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    // Keyboard-generated clicks have no pointer coordinate and should not
    // create a distracting burst at the top-left corner. Respect reduced motion.
    if (event.detail === 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cfg = configRef.current;
    const now = performance.now();
    const count = Math.max(0, Math.min(24, Math.round(cfg.sparkCount)));
    for (let i = 0; i < count; i += 1) {
      sparksRef.current.push({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        angle: (2 * Math.PI * i) / Math.max(count, 1),
        startTime: now,
      });
    }
    scheduleRef.current?.();
  }, []);

  return (
    <div className="click-spark-root" onClick={handleClick}>
      <canvas ref={canvasRef} className="click-spark-canvas" aria-hidden="true" />
      <div className="click-spark-content">{children}</div>
    </div>
  );
}
