import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import { AppHeader } from "@/components/AppHeader";
import ClickSpark from "@/components/ClickSpark";
import { EmptyState } from "@/components/EmptyState";
import PromptBar from "@/components/PromptBar";
import VoicePill from "@/components/VoicePill";
import { ExecutionSection } from "@/components/Execution";
import { ImpactAnalysis } from "@/components/Impact";
import { InteractionLines } from "@/components/InteractionLines";
import { RuntimeInspector } from "@/components/Inspector";
import {
  AssistantNote,
  NoticeStack,
  ResultsBlock,
  SystemAnnotation,
  UserMessage,
  type Notice,
  type StreamItem,
} from "@/components/Stream";
import { useRuntime } from "@/hooks/useRuntime";
import { useSpeechDictation } from "@/hooks/useSpeechDictation";
import type { ConstraintChange, ImpactSummary, ResultsPayload, RuntimeEvent } from "@/runtime/types";
import { fmtValue, keyLabel } from "@/components/ui";
import { applyTheme, getInitialTheme, getTheme, type ThemeId } from "@/theme";

function changeText(changes: ConstraintChange[]): string {
  return changes
    .map((ch) => `${keyLabel(ch.key).toLowerCase()} ${fmtValue(ch.key, ch.from)} to ${fmtValue(ch.key, ch.to)}`)
    .join(" · ");
}

function mapEvent(ev: RuntimeEvent): StreamItem | null {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.event_type) {
    case "user.message":
      return { kind: "user", id: ev.event_id, text: String(p.text ?? ""), time: ev.timestamp, interruption: Boolean(p.interruption) };
    case "assistant.message":
      return { kind: "assistant", id: ev.event_id, text: String(p.text ?? ""), time: ev.timestamp, closing: Boolean(p.closing) };
    case "interruption.detected": {
      if (p.noop) return null;
      const changes = Array.isArray(p.changes) ? p.changes as ConstraintChange[] : [];
      return {
        kind: "annotation",
        id: ev.event_id,
        title: "Interruption detected",
        version: Number(p.to_version ?? ev.state_version),
        from: Number(p.from_version ?? ev.state_version),
        time: ev.timestamp,
        detail: changes.length > 0
          ? `Your new requirement changed the active constraints — ${changeText(changes)}. Valid work is being preserved.`
          : `“${String(p.text ?? "").slice(0, 80)}” — the search criteria are re-derived; dependent steps are re-evaluated.`,
      };
    }
    case "state.updated":
      if (!p.impact) return null;
      return {
        kind: "impact",
        id: ev.event_id,
        from: ev.state_version - 1,
        version: ev.state_version,
        impact: p.impact as ImpactSummary,
        changes: (p.changes as ConstraintChange[]) ?? [],
        time: ev.timestamp,
      };
    case "plan.created":
      return { kind: "plan", id: ev.event_id, version: Number(p.version ?? ev.state_version), time: ev.timestamp };
    case "run.completed":
      return { kind: "results", id: ev.event_id, version: ev.state_version, results: p.results as ResultsPayload, time: ev.timestamp };
    default:
      return null;
  }
}

export default function App() {
  const { state, send, reset } = useRuntime();
  const [devMode, setDevMode] = useState(false);
  const [items, setItems] = useState<StreamItem[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>(getInitialTheme);
  const strandColors = useMemo(() => [...getTheme(theme).strands], [theme]);
  const [draftText, setDraftText] = useState("");

  const itemsRef = useRef<StreamItem[]>([]);
  const lastIdRef = useRef<string | null>(null);
  const sweptRef = useRef<Set<number>>(new Set());
  const [sweptVersions, setSweptVersions] = useState<Set<number>>(new Set());
  const noticeSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  const appendDictation = useCallback((text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    setDraftText((current) => current.trim() ? `${current.trimEnd()} ${cleaned}` : cleaned);
  }, []);
  const dictation = useSpeechDictation(appendDictation);
  const submitMessage = useCallback(async (text: string) => {
    setRequestError(null);
    try {
      await send(text);
    } catch (error) {
      setDraftText(text);
      setRequestError(error instanceof Error ? error.message : "The request could not be sent. Check the runtime connection and try again.");
    }
  }, [send]);
  const resetRuntime = useCallback(async () => {
    setRequestError(null);
    try {
      await reset();
      setDraftText("");
      setNotices([]);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "The runtime could not be reset.");
    }
  }, [reset]);
  /* Keep the selected palette in sync with CSS and local storage. */
  useEffect(() => applyTheme(theme), [theme]);

  /* responsive inspector variant */
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const fn = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  /* keyboard: "/" focuses composer, Esc closes inspector */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "TEXTAREA" || target.tagName === "INPUT";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.querySelector<HTMLTextAreaElement>(".prompt-bar__input")?.focus({ preventScroll: true });
      }
      if (e.key === "Escape") setDevMode(false);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  /* derive the conversation stream from the event log */
  useEffect(() => {
    const evs = state.events;
    if (evs.length === 0) {
      if (itemsRef.current.length > 0 || lastIdRef.current !== null) {
        itemsRef.current = [];
        lastIdRef.current = null;
        sweptRef.current = new Set();
        setSweptVersions(new Set());
        setItems([]);
      }
      return;
    }
    if (lastIdRef.current && !evs.some((e) => e.event_id === lastIdRef.current)) {
      itemsRef.current = [];
      lastIdRef.current = null;
      sweptRef.current = new Set();
    }
    const start = lastIdRef.current ? evs.findIndex((e) => e.event_id === lastIdRef.current) + 1 : 0;
    const fresh = evs.slice(start);
    if (fresh.length === 0) return;

    const added: StreamItem[] = [];
    for (const ev of fresh) {
      const item = mapEvent(ev);
      if (item) added.push(item);

      const p = ev.payload as Record<string, unknown>;
      if (ev.event_type === "interruption.detected" && !p.noop) {
        sweptRef.current = new Set(sweptRef.current).add(Number(p.from_version ?? ev.state_version));
        const changes = (p.changes as ConstraintChange[]) ?? [];
        pushNotice({
          tone: "fence",
          label: "Interruption detected",
          version: Number(p.to_version ?? ev.state_version),
          text: changes.length ? changeText(changes.slice(0, 2)) : "search criteria re-derived",
        });
      }
      if (ev.event_type === "run.completed") {
        pushNotice({
          tone: "ok",
          label: "Run complete",
          version: ev.state_version,
          text: `${p.steps} steps · ${p.preserved} preserved · ${p.fenced} fenced`,
        });
      }
    }

    itemsRef.current = [...itemsRef.current, ...added];
    lastIdRef.current = evs[evs.length - 1].event_id;
    setSweptVersions(sweptRef.current);
    setItems(itemsRef.current);
  }, [state.events]);

  const pushNotice = useCallback((n: Omit<Notice, "id">) => {
    noticeSeq.current += 1;
    const id = noticeSeq.current;
    setNotices((prev) => [...prev.slice(-1), { ...n, id }]);
    setTimeout(() => setNotices((prev) => prev.filter((x) => x.id !== id)), 5600);
  }, []);

  /* keep the live edge in view */
  const autoScrollRef = useRef(false);
  const autoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && items.length > 0 && nearBottomRef.current) {
      autoScrollRef.current = true;
      if (autoScrollTimer.current) clearTimeout(autoScrollTimer.current);
      autoScrollTimer.current = setTimeout(() => {
        autoScrollRef.current = false;
      }, 450);
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [items, state.tasks]);

  const tasksByVersion = useMemo(() => {
    const map = new Map<number, typeof state.tasks>();
    for (const t of state.tasks) {
      const list = map.get(t.created_in) ?? [];
      list.push(t);
      map.set(t.created_in, list);
    }
    return map;
  }, [state.tasks]);

  const isEmpty = items.length === 0;
  const requestTextByVersion = useMemo(() => {
    const requests = new Map<number, string>();
    let latestRequest = "";
    for (const event of state.events) {
      if (event.event_type === "user.message") latestRequest = String(event.payload.text ?? "");
      if (event.event_type === "plan.created") {
        const payload = event.payload as Record<string, unknown>;
        requests.set(Number(payload.version ?? event.state_version), latestRequest);
      }
    }
    return requests;
  }, [state.events]);
  const evaluating = state.phase === "interrupting";
  const voiceDisabled = !dictation.supported || dictation.errorLocked || evaluating;

  return (
    <MotionConfig reducedMotion="user">
      <ClickSpark sparkColor="var(--color-accent)" sparkSize={8} sparkRadius={19} sparkCount={8} duration={420}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <AppHeader
            state={state}
            devMode={devMode}
            theme={theme}
            onToggleDev={() => setDevMode((v) => !v)}
            onReset={() => void resetRuntime()}
            onThemeChange={setTheme}
          />

          <div className="flex min-h-0 flex-1">
            <main className="workspace-bg relative flex min-w-0 flex-1 flex-col" aria-label="Workspace">
              <InteractionLines
                className="lines-veil"
                minLines={10}
                maxLines={28}
                curveStrength={1.12}
                lineWidth={1}
                opacity={0.94}
                idleDelay={1.2}
              />
              <NoticeStack notices={notices} onDismiss={(id) => setNotices((prev) => prev.filter((n) => n.id !== id))} />
              {requestError ? (
                <div role="alert" className="relative z-30 mx-auto mt-3 flex w-[calc(100%-32px)] max-w-[760px] items-center gap-3 rounded-lg border border-danger/25 bg-surface/95 px-3 py-2.5 text-[12px] text-danger shadow-lift">
                  <span className="min-w-0 flex-1">{requestError}</span>
                  <button type="button" onClick={() => setRequestError(null)} className="shrink-0 rounded-md px-2 py-1 font-medium text-ink-2 hover:bg-surface-2">Dismiss</button>
                </div>
              ) : null}

              <div
                ref={scrollRef}
                onScroll={(event) => {
                  if (autoScrollRef.current) return;
                  const element = event.currentTarget;
                  nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 160;
                }}
                className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                {isEmpty ? (
                  <EmptyState onPick={(text) => void submitMessage(text)} />
                ) : (
                  <div role="log" aria-live="polite" aria-label="Conversation and execution stream" className="mx-auto flex w-full max-w-[840px] flex-col gap-7 px-5 pb-6 pt-8 md:gap-8 md:px-8">
                    {items.map((item) => {
                      switch (item.kind) {
                        case "user":
                          return <UserMessage key={item.id} text={item.text} time={item.time} interruption={item.interruption} />;
                        case "assistant":
                          return <AssistantNote key={item.id} text={item.text} time={item.time} closing={item.closing} />;
                        case "annotation":
                          return <SystemAnnotation key={item.id} title={item.title} version={item.version} detail={item.detail} time={item.time} />;
                        case "impact":
                          return <ImpactAnalysis key={item.id} from={item.from} version={item.version} impact={item.impact} changes={item.changes} />;
                        case "results":
                          return <ResultsBlock key={item.id} results={item.results} version={item.version} />;
                        case "plan":
                          return (
                            <ExecutionSection
                              key={item.id}
                              version={item.version}
                              tasks={tasksByVersion.get(item.version) ?? []}
                              phase={state.phase}
                              currentVersion={state.state_version}
                              swept={sweptVersions.has(item.version)}
                              strandColors={strandColors}
                              requestText={requestTextByVersion.get(item.version) ?? ""}
                            />
                          );
                        default:
                          return null;
                      }
                    })}
                  </div>
                )}

                <div className="sticky bottom-0 z-20 px-4 pb-3 pt-5 md:pb-5">
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-paper via-paper/95 to-transparent" aria-hidden="true" />
                  <div className="relative mx-auto w-full max-w-[840px]">
                    <PromptBar
                      value={draftText}
                      onValueChange={setDraftText}
                      onSend={(text) => submitMessage(text)}
                      disabled={evaluating}
                      placeholder={dictation.listening ? "Listening — speak naturally…" : evaluating ? "Evaluating the impact…" : state.phase === "running" || state.phase === "planning" ? "Type a new requirement to interrupt…" : "What would you like PIVOT to do?"}
                      sources={[]}
                      commands={[]}
                      models={[]}
                      efforts={[]}
                      width={840}
                      radius={15}
                      background="var(--color-surface)"
                      color="var(--color-ink)"
                      menuBackground="var(--color-surface-2)"
                      sparkColor="var(--color-accent)"
                      sparkBoost={0.6}
                      voiceControl={
                        <VoicePill
                          size={30}
                          background="var(--color-surface-2)"
                          iconColor="var(--color-ink-2)"
                          accentColor="var(--color-accent)"
                          reactive="mic"
                          mode="auto"
                          holdAfter={300}
                          showTime
                          waveform
                          slideToCancel
                          disabled={voiceDisabled}
                          ariaLabel="Dictate a prompt"
                          onStart={dictation.start}
                          onStop={dictation.stop}
                        />
                      }
                    />
                    {dictation.message ? (
                      <p id="voice-status" role="status" aria-live="polite" className="mt-1.5 px-2 font-mono text-[10px] leading-relaxed text-ink-3">
                        {dictation.message}{dictation.interim ? <span className="ml-1 text-ink-2">{dictation.interim}</span> : null}
                        <span className="ml-2 hidden text-ink-3/80 sm:inline">Voice text is processed by the browser speech service.</span>
                      </p>
                    ) : (
                      <p className="mt-1.5 px-2 font-mono text-[10px] text-ink-3">Enter to send · Shift + Enter for a new line · / focuses the prompt</p>
                    )}
                  </div>
                </div>
              </div>
            </main>

            {isDesktop ? (
              <RuntimeInspector state={state} open={devMode} onClose={() => setDevMode(false)} variant="inline" />
            ) : (
              <RuntimeInspector state={state} open={devMode} onClose={() => setDevMode(false)} variant="overlay" />
            )}
          </div>
        </div>
      </ClickSpark>
    </MotionConfig>
  );
}
