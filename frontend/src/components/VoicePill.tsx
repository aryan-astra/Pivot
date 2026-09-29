import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ArrowLeft, Mic } from "lucide-react";
import "./VoicePill.css";

const LOOP = 4.8;
const SYLLABLES = [
  [0.1, 0.16, 0.9], [0.3, 0.12, 0.7], [0.5, 0.2, 1], [0.95, 0.14, 0.8], [1.15, 0.1, 0.6],
  [1.3, 0.22, 0.95], [1.9, 0.16, 0.85], [2.12, 0.12, 0.7], [2.3, 0.18, 0.9], [2.55, 0.1, 0.5],
  [3.05, 0.24, 1], [3.4, 0.12, 0.75], [3.6, 0.16, 0.9],
];
const MIC_BINS = [[1, 4], [4, 11], [11, 33]];
const MIC_GAIN = 2.2;
const DT_MAX = 0.05;
const SLIDE_MIN = 4;
const WAVE_EVERY = 4;
const WAVE_MAX = 80;

type VoiceMode = "auto" | "hold" | "toggle";
type VoiceStopReason = "release" | "tap" | "key" | "escape" | "blur" | "cancel" | "disabled" | "mic-denied" | "unmount";
type Reactive = "simulated" | "mic";
type AudioState = {
  ctx: AudioContext;
  stream?: MediaStream;
  src?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
  buf?: Uint8Array<ArrayBuffer>;
};
type VoiceRuntime = {
  listening: boolean;
  pointerId: number | null;
  ownPress: boolean;
  downX: number;
  sliding: boolean;
  hist: number[];
  tick: number;
  acc: number;
  downAt: number;
  startedAt: number;
  raf: number;
  last: number;
  env: number;
  t0: number;
  audio: AudioState | null;
};

const simulatedLevel = (time: number) => {
  const unit = time % LOOP;
  let amplitude = 0.06;
  for (const [start, length, peak] of SYLLABLES) {
    const x = (unit - start) / length;
    if (x >= 0 && x <= 1) amplitude = Math.max(amplitude, peak * 0.5 * (1 - Math.cos(2 * Math.PI * x)));
  }
  return amplitude * (0.7 + 0.3 * Math.abs(Math.sin(2 * Math.PI * 7.1 * unit)));
};
const micLevel = (analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>) => {
  analyser.getByteFrequencyData(buffer);
  let total = 0;
  for (const [low, high] of MIC_BINS) {
    let sum = 0;
    for (let i = low; i < high; i += 1) sum += buffer[i];
    total += sum / ((high - low) * 255);
  }
  return (total / MIC_BINS.length) * MIC_GAIN;
};
const drawWave = (s: VoiceRuntime, canvas: HTMLCanvasElement, level: number, color: string, floor: number) => {
  const variable = color.match(/^var\(\s*(--[\w-]+)/)?.[1];
  const resolvedColor = variable ? getComputedStyle(canvas).getPropertyValue(variable).trim() || color : color;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  s.acc = Math.max(s.acc, level);
  s.tick = (s.tick + 1) % WAVE_EVERY;
  if (s.tick === 0) {
    s.hist.push(s.acc);
    s.acc = 0;
    if (s.hist.length > WAVE_MAX) s.hist.shift();
  }
  const w = rect.width;
  const h = rect.height;
  const barWidth = 2;
  const step = 3;
  const shift = (s.tick / WAVE_EVERY) * step;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = resolvedColor;
  for (let i = 0; i < s.hist.length; i += 1) {
    const value = s.hist[s.hist.length - 1 - i];
    const x = w - (i + 1) * step - shift;
    if (x + barWidth < 0) break;
    const barHeight = Math.max(barWidth, (floor + (1 - floor) * value) * h);
    const t = Math.min(1, Math.max(0, (x + barWidth / 2) / (w * 0.55)));
    const fade = t * t * (3 - 2 * t);
    ctx.globalAlpha = (0.35 + 0.65 * value) * fade;
    ctx.beginPath();
    ctx.roundRect(x, (h - barHeight) / 2, barWidth, barHeight, barWidth / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const openMic = async (state: VoiceRuntime) => {
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx || !navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
  state.audio ??= { ctx: new Ctx() };
  const audio = state.audio;
  if (audio.ctx.state === "suspended") await audio.ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (!state.listening) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  audio.stream = stream;
  audio.src = audio.ctx.createMediaStreamSource(stream);
  audio.analyser = audio.ctx.createAnalyser();
  audio.analyser.fftSize = 256;
  audio.analyser.smoothingTimeConstant = 0;
  audio.src.connect(audio.analyser);
  audio.buf = new Uint8Array(audio.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
};
const closeMic = (state: VoiceRuntime) => {
  const audio = state.audio;
  if (!audio?.stream) return;
  audio.stream.getTracks().forEach((track) => track.stop());
  audio.src?.disconnect();
  audio.stream = undefined;
  audio.src = undefined;
  audio.analyser = undefined;
  audio.buf = undefined;
};

export type VoicePillProps = {
  accentColor?: string;
  iconColor?: string;
  background?: string;
  size?: number;
  shape?: "pill" | "rounded";
  reach?: number;
  showTime?: boolean;
  waveform?: boolean;
  slideToCancel?: boolean;
  cancelDistance?: number;
  attack?: number;
  release?: number;
  sensitivity?: number;
  floor?: number;
  openDuration?: number;
  pressScale?: number;
  mode?: VoiceMode;
  holdAfter?: number;
  reactive?: Reactive;
  disabled?: boolean;
  ariaLabel?: string;
  onStart?: (event: { source: Reactive }) => void;
  onStop?: (event: { reason: VoiceStopReason; duration: number }) => void;
  className?: string;
};

export default function VoicePill({
  accentColor = "#f5f5f5",
  iconColor = "#a1a1aa",
  background = "#27272a",
  size = 28,
  shape = "pill",
  reach = 8,
  showTime = true,
  waveform = true,
  slideToCancel = true,
  cancelDistance = 64,
  attack = 40,
  release = 240,
  sensitivity = 1,
  floor = 0.1,
  openDuration = 200,
  pressScale = 0.95,
  mode = "auto",
  holdAfter = 300,
  reactive = "simulated",
  disabled = false,
  ariaLabel = "Dictate",
  onStart,
  onStop,
  className = "",
}: VoicePillProps) {
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [input, setInput] = useState<"pointer" | "key">("pointer");
  const timeRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLButtonElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<VoiceRuntime>({
    listening: false,
    pointerId: null,
    ownPress: false,
    downX: 0,
    sliding: false,
    hist: [],
    tick: 0,
    acc: 0,
    downAt: 0,
    startedAt: 0,
    raf: 0,
    last: 0,
    env: 0,
    t0: 0,
    audio: null,
  });
  const cfg = useRef({});
  cfg.current = { attack, release, sensitivity, floor, mode, holdAfter, reactive, showTime, waveform, slideToCancel, cancelDistance, accentColor, onStart, onStop };

  const frame = (now: number) => {
    const s = stateRef.current;
    const c = cfg.current as typeof cfg.current & {
      attack: number; release: number; sensitivity: number; floor: number; reactive: Reactive;
      showTime: boolean; waveform: boolean; accentColor: string;
    };
    const dt = Math.min((now - s.last) / 1000, DT_MAX);
    s.last = now;
    let target = 0;
    if (s.listening) {
      if (s.audio?.analyser && s.audio.buf) target = micLevel(s.audio.analyser, s.audio.buf);
      else if (c.reactive !== "mic") target = simulatedLevel((now - s.t0) / 1000);
    }
    target = Math.min(1, target * c.sensitivity);
    const tau = Math.max(1, target > s.env ? c.attack : c.release) / 1000;
    s.env += (target - s.env) * (1 - Math.exp(-dt / tau));
    if (s.listening && c.showTime && timeRef.current) {
      const text = clock(now - s.startedAt);
      if (timeRef.current.textContent !== text) timeRef.current.textContent = text;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (s.listening && c.waveform && waveRef.current && !reduceMotion) drawWave(s, waveRef.current, s.env, c.accentColor, c.floor);
    s.raf = s.listening ? requestAnimationFrame(frame) : 0;
  };

  const end = (reason: VoiceStopReason) => {
    const s = stateRef.current;
    const c = cfg.current as typeof cfg.current & { onStop?: VoicePillProps["onStop"] };
    if (!s.listening) return;
    s.listening = false;
    closeMic(s);
    setListening(false);
    setPressed(false);
    setInput(reason === "key" || reason === "escape" ? "key" : "pointer");
    c.onStop?.({ reason, duration: Math.round(performance.now() - s.startedAt) });
  };

  const begin = (source: "pointer" | "key") => {
    const s = stateRef.current;
    const c = cfg.current as typeof cfg.current & {
      reactive: Reactive; onStart?: VoicePillProps["onStart"];
    };
    if (s.listening || disabled) return;
    s.listening = true;
    s.hist = [];
    s.tick = 0;
    s.acc = 0;
    s.env = 0;
    s.startedAt = performance.now();
    s.t0 = s.startedAt;
    s.last = s.startedAt;
    if (timeRef.current) timeRef.current.textContent = "0:00";
    setListening(true);
    setInput(source);
    if (!s.raf) s.raf = requestAnimationFrame(frame);
    try { c.onStart?.({ source: c.reactive }); } catch { /* keep the control responsive */ }
    if (c.reactive === "mic") openMic(s).catch(() => end("mic-denied"));
  };

  const settleSlide = () => {
    const s = stateRef.current;
    const root = rootRef.current;
    s.sliding = false;
    if (!root) return;
    delete root.dataset.sliding;
    root.style.setProperty("--vp-slide", "0px");
    root.style.setProperty("--vp-cancel", "0");
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const s = stateRef.current;
    const c = cfg.current as typeof cfg.current & { slideToCancel: boolean; cancelDistance: number };
    const root = rootRef.current;
    if (!root || s.pointerId !== event.pointerId || !c.slideToCancel || !s.listening || !s.ownPress) return;
    const delta = event.clientX - s.downX;
    if (!s.sliding && delta > -SLIDE_MIN) return;
    s.sliding = true;
    root.dataset.sliding = "";
    const pull = Math.min(c.cancelDistance + 24, Math.max(0, -delta));
    root.style.setProperty("--vp-slide", `${-pull}px`);
    const progress = Math.min(1, pull / Math.max(1, c.cancelDistance));
    root.style.setProperty("--vp-cancel", progress.toFixed(3));
    if (progress >= 1) {
      settleSlide();
      end("cancel");
    }
  };
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    const s = stateRef.current;
    if (disabled || event.button !== 0 || !event.isPrimary || s.pointerId !== null) return;
    s.pointerId = event.pointerId;
    s.downX = event.clientX;
    s.downAt = performance.now();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not supported */ }
    setPressed(true);
    s.ownPress = !s.listening;
    if (!s.listening) begin("pointer");
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const s = stateRef.current;
    const c = cfg.current as typeof cfg.current & { mode: VoiceMode; holdAfter: number };
    if (event.pointerId !== s.pointerId) return;
    s.pointerId = null;
    setPressed(false);
    if (s.sliding) settleSlide();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* pointer capture may already be released */ }
    if (!s.listening) return;
    const held = performance.now() - s.downAt;
    const isHold = c.mode === "hold" || (c.mode === "auto" && held >= c.holdAfter);
    if (s.ownPress) {
      if (isHold) end("release");
    } else {
      end(held < c.holdAfter ? "tap" : "release");
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") end("escape");
  };
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 && stateRef.current.pointerId === null) {
      if (stateRef.current.listening) end("key");
      else begin("key");
    }
  };

  useEffect(() => {
    if (!pressed) return undefined;
    const stop = () => end("blur");
    const onVisibility = () => { if (document.hidden) stop(); };
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressed]);
  useEffect(() => {
    if (disabled) end("disabled");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);
  useEffect(() => {
    const s = stateRef.current;
    return () => {
      end("unmount");
      cancelAnimationFrame(s.raf);
      void s.audio?.ctx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const radius = shape === "rounded" ? Math.round(size * 0.29) : size / 2;
  const hit = Math.max(0, Math.min(10, (44 - size) / 2));
  const timeSize = Math.max(10, Math.round(size * 0.36));
  const clockWidth = showTime ? Math.round(timeSize * 2.5) + 4 : 0;
  const waveWidth = waveform ? Math.round(size * 1.9) : 0;
  const extra = clockWidth + waveWidth;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={listening}
      title={disabled ? "Voice input is not available in this browser" : listening ? "Listening — tap to stop" : ariaLabel}
      className={`voice-pill${className ? ` ${className}` : ""}`}
      data-state={listening ? "listening" : "idle"}
      data-pressed={pressed ? "" : undefined}
      data-input={input}
      data-time={showTime ? "" : undefined}
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        "--vp-accent": accentColor,
        "--vp-icon": iconColor,
        "--vp-bg": background,
        "--vp-size": `${size}px`,
        "--vp-radius": `${radius}px`,
        "--vp-reach": `${reach}px`,
        "--vp-extra": `${extra}px`,
        "--vp-clock-w": `${clockWidth}px`,
        "--vp-wave-w": `${waveWidth}px`,
        "--vp-stop": `${Math.round(size * 0.32)}px`,
        "--vp-icon-size": `${Math.round(size * 0.54)}px`,
        "--vp-time-size": `${timeSize}px`,
        "--vp-open": `${openDuration}ms`,
        "--vp-press": pressScale,
        "--vp-hit": `${hit}px`,
      } as CSSProperties}
    >
      <span className="voice-pill__capsule" aria-hidden="true" />
      {waveform ? <canvas ref={waveRef} className="voice-pill__wave" aria-hidden="true" /> : null}
      {slideToCancel ? (
        <span className="voice-pill__cancel" aria-hidden="true">
          <ArrowLeft size={12} strokeWidth={2.2} />
          <span>Cancel</span>
        </span>
      ) : null}
      {showTime ? <span ref={timeRef} className="voice-pill__time" aria-hidden="true">0:00</span> : null}
      <span className="voice-pill__glyph" aria-hidden="true">
        <span className="voice-pill__mic"><Mic size={Math.round(size * 0.54)} strokeWidth={2} /></span>
        <span className="voice-pill__stop" />
      </span>
    </button>
  );
}
