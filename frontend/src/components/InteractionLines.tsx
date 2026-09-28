import { useEffect, useRef } from "react";
import { cn } from "@/utils/cn";

/*
 * Ambient line field — adapted from the Framer Marketplace component
 * "Reactive Lines" by Karim Saif (https://x.com/karimsaif0).
 *
 * Adaptations for PIVOT (see docs/21ST_COMPONENT_INTEGRATION.md):
 *  - no `framer` runtime: property controls / static-renderer hooks dropped
 *  - always transparent (the workspace paints its own surface); edge falloff is
 *    a CSS mask (`lines-veil`) instead of the original painted vignette, which
 *    required an opaque background
 *  - the container is pointer-events-none, so pointer tracking listens on the
 *    window and maps into container space — the field can never swallow clicks
 *  - reduced-motion renders one static centered frame instead of a rAF loop
 *  - mobile uses the orbiting mode (touch-follow would fight scrolling)
 */

type Vec = { x: number; y: number };
type Direction = "vertical" | "horizontal" | "diagonal" | "reverse";
type Distribution = "quadratic" | "linear" | "exponential" | "logarithmic";

const vec = (x: number, y: number): Vec => ({ x, y });
const vecAdd = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const vecSub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const vecMult = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
const vecLerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, mn: number, mx: number): number => Math.max(mn, Math.min(mx, v));
const mapRange = (v: number, a: number, b: number, c: number, d: number): number => ((v - a) / (b - a)) * (d - c) + c;

export type InteractionLinesProps = {
  className?: string;
  /** Stroke colour — keep it low-alpha; this sits behind live UI. */
  lineColor?: string;
  lineWidth?: number;
  opacity?: number;
  minLines?: number;
  maxLines?: number;
  direction?: Direction;
  distribution?: Distribution;
  curveStrength?: number;
  padding?: number;
  interactionMode?: "mouse" | "auto" | "none";
  idleAnimation?: boolean;
  idleDelay?: number;
  /** Curve samples per line (15–100). */
  quality?: number;
};

export function InteractionLines({
  className,
  lineColor = "rgba(29, 29, 27, 0.16)",
  lineWidth = 1,
  opacity = 1,
  minLines = 6,
  maxLines = 26,
  direction = "vertical",
  distribution = "quadratic",
  curveStrength = 1,
  padding = 0,
  interactionMode = "mouse",
  idleAnimation = true,
  idleDelay = 2,
  quality = 40,
}: InteractionLinesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const activityRef = useRef(Date.now());

  /* drawing loop */
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let size: { w: number; h: number } | null = null;
    let raf = 0;
    let inView = true;
    let pageVisible = document.visibilityState === "visible";
    let linesNum = (minLines + maxLines) / 2;
    let bias = 0.5;

    const setup = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w < 2 || h < 2) {
        size = null;
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      size = { w, h };
      const p = pointerRef.current;
      if (p.x === 0 && p.y === 0) {
        p.x = p.tx = w / 2;
        p.y = p.ty = h / 2;
      }
    };
    setup();

    const draw = (time: number) => {
      if (!size) return;
      const { w: r, h: n } = size;
      const p = pointerRef.current;
      const reduced = reducedMq.matches;
      const isSmall = window.matchMedia("(max-width: 768px)").matches;
      const mode = isSmall ? "auto" : interactionMode;

      if (mode === "none" || reduced) {
        p.tx = r / 2;
        p.ty = n / 2;
      } else {
        const idle = idleAnimation && mode === "mouse" && (Date.now() - activityRef.current) / 1000 > idleDelay;
        if (mode === "auto" || idle) {
          const t = time * 0.001;
          p.tx = r / 2 + Math.sin(t * 0.8) * r * 0.3;
          p.ty = n / 2 + Math.cos(t * 0.5) * n * 0.3;
        }
      }
      p.x += (p.tx - p.x) * clamp(0.05, 0.001, 1);
      p.y += (p.ty - p.y) * clamp(0.1, 0.001, 1);

      ctx.clearRect(0, 0, r, n);
      ctx.save();
      ctx.globalAlpha = opacity;

      const effW = Math.max(10, r - padding * 2);
      const effH = Math.max(10, n - padding * 2);
      ctx.translate(r / 2, n / 2);

      const small = effW < 500;
      const u = small ? 0.8 * effH : 0;
      const dFactor = (small ? 1.5 : 0.7) * curveStrength;
      let c: Vec;
      let f: Vec;
      let g: Vec;
      switch (direction) {
        case "horizontal":
          c = vec(effH, -(1.1 * effW) + u);
          f = vec(0, 2 * effW);
          g = vec(-effH, -effW + u);
          break;
        case "diagonal":
          c = vec(effW, -(1.1 * effH) + u);
          f = vec(effW, effH);
          g = vec(-effW, -effH);
          break;
        case "reverse":
          c = vec(-effW, 1.1 * effH - u);
          f = vec(0, -2 * effH);
          g = vec(effW, effH - u);
          break;
        default:
          c = vec(effW, -(1.1 * effH) + u);
          f = vec(0, 2 * effH);
          g = vec(-effW, -effH + u);
          break;
      }

      const lo = Math.min(minLines, maxLines);
      const hi = Math.max(minLines, maxLines);
      linesNum = lerp(linesNum, clamp(mapRange(p.y, 0, n, lo, hi), lo, hi), 0.1);
      bias = lerp(bias, clamp(mapRange(p.x, 0, r, 0.6, 0.4), 0.4, 0.6), 0.05);

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWidth;
      const segments = Math.max(10, quality);
      const total = Math.round(linesNum);

      for (let i = 0; i < total; i++) {
        const norm = total > 1 ? i / (total - 1) : 0;
        let dist = norm;
        if (distribution === "quadratic") dist = 1 - norm * norm;
        else if (distribution === "linear") dist = 1 - norm;
        else if (distribution === "exponential") dist = Math.pow(1 - norm, 3);
        else if (distribution === "logarithmic") dist = 1 - Math.log10(1 + norm * 9);

        const lineEnd = vec(lerp(f.x, g.x, dist), lerp(f.y, g.y, dist));
        const mid = vecAdd(vecMult(c, 0.5), vecMult(lineEnd, 0.5));
        const dispTarget = vecMult(vecAdd(f, mid), 0.5);
        const start = c;
        const end = lineEnd;
        const diff = vecSub(dispTarget, vecLerp(start, end, 0.5));

        ctx.beginPath();
        for (let s = 0; s <= segments; s++) {
          const segT = s / segments;
          const base = vecLerp(start, end, segT);
          const weight =
            2 * Math.pow(segT, dFactor * (1 - bias) * 2) * Math.pow(1 - segT, dFactor * bias * 2);
          const pt = vecAdd(base, vecMult(diff, weight));
          if (s === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    };

    const render = (time: number) => {
      raf = 0;
      if (!inView || !pageVisible) return;
      draw(time);
      if (reducedMq.matches) return; // static frame only
      raf = requestAnimationFrame(render);
    };
    const start = () => {
      if (raf || !inView || !pageVisible) return;
      raf = requestAnimationFrame(render);
    };
    const stop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      setup();
      if (reducedMq.matches) draw(0);
    });
    const viewObserver = new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? true;
        inView && pageVisible ? start() : stop();
      },
      { threshold: 0 },
    );
    const onVisibility = () => {
      pageVisible = document.visibilityState === "visible";
      pageVisible && inView ? start() : stop();
    };
    const onMotionChange = () => {
      stop();
      if (reducedMq.matches) draw(0);
      else start();
    };

    resizeObserver.observe(container);
    viewObserver.observe(container);
    document.addEventListener("visibilitychange", onVisibility);
    reducedMq.addEventListener("change", onMotionChange);
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      viewObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMq.removeEventListener("change", onMotionChange);
    };
  }, [
    lineColor,
    lineWidth,
    opacity,
    minLines,
    maxLines,
    direction,
    distribution,
    curveStrength,
    padding,
    interactionMode,
    idleAnimation,
    idleDelay,
    quality,
  ]);

  /* pointer tracking — window-level so the layer stays pointer-events-none */
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      activityRef.current = Date.now();
      const p = pointerRef.current;
      p.tx = clamp(ev.clientX - rect.left, 0, rect.width);
      p.ty = clamp(ev.clientY - rect.top, 0, rect.height);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
    };
  }, []);

  return (
    <div ref={containerRef} aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
