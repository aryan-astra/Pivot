import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import { AppHeader } from "@/components/AppHeader";
import { Composer, type ComposerHandle } from "@/components/Composer";
import { EmptyState } from "@/components/EmptyState";
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
import type { ConstraintChange, ImpactSummary, ResultsPayload, RuntimeEvent } from "@/runtime/types";
import { fmtValue, keyLabel } from "@/components/ui";

function changeText(changes: ConstraintChange[]): string {
  return changes
    .map((ch) => `${keyLabel(ch.key).toLowerCase()} ${fmtValue(ch.key, ch.from)} → ${fmtValue(ch.key, ch.to)}`)
    .join(" · ");
}

function mapEvent(ev: RuntimeEvent): StreamItem | null {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.event_type) {
    case "user.message":
      return { kind: "user", id: ev.event_id, text: String(p.text ?? ""), time: ev.timestamp, interruption: Boolean(p.interruption) };
    case "assistant.message":
      return { kind: "assistant", id: ev.event_id, text: String(p.text ?? ""), time: ev.timestamp, closing: Boolean(p.closing) };
    case "interruption.detected":
      if (p.noop) return null;
      return {
        kind: "annotation",
        id: ev.event_id,
        title: "Interruption detected",
        version: Number(p.to_version ?? ev.state_version),
        from: Number(p.from_version ?? ev.state_version),
        time: ev.timestamp,
        detail:
          (p.changes as ConstraintChange[]).length > 0
            ? `Your new requirement changed the active constraints — ${changeText(p.changes as ConstraintChange[])}. Valid work is being preserved.`
            : `“${String(p.text ?? "").slice(0, 80)}” — the search criteria are re-derived; dependent steps are re-evaluated.`,
      };
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

  const itemsRef = useRef<StreamItem[]>([]);
  const lastIdRef = useRef<string | null>(null);
  const sweptRef = useRef<Set<number>>(new Set());
  const [sweptVersions, setSweptVersions] = useState<Set<number>>(new Set());
  const noticeSeq = useRef(0);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

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
        composerRef.current?.focus();
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

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col overflow-hidden">
        <AppHeader state={state} devMode={devMode} onToggleDev={() => setDevMode((v) => !v)} onReset={() => void reset()} />

        <div className="flex min-h-0 flex-1">
          <main className="workspace-bg relative flex min-w-0 flex-1 flex-col" aria-label="Workspace">
            <InteractionLines className="lines-veil" />
            <NoticeStack notices={notices} onDismiss={(id) => setNotices((prev) => prev.filter((n) => n.id !== id))} />

            <div
              ref={scrollRef}
              onScroll={(e) => {
                if (autoScrollRef.current) return;
                const el = e.currentTarget;
                nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
              }}
              className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              {isEmpty ? (
                <EmptyState onPick={(text) => void send(text)} />
              ) : (
                <div
                  role="log"
                  aria-live="polite"
                  aria-label="Conversation and execution stream"
                  className="mx-auto flex w-full max-w-[840px] flex-col gap-7 px-5 pb-6 pt-8 md:gap-8 md:px-8"
                >
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
                          />
                        );
                      default:
                        return null;
                    }
                  })}

                </div>
              )}

              <Composer ref={composerRef} phase={state.phase} onSend={(text) => void send(text)} />
            </div>
          </main>

          {isDesktop ? (
            <RuntimeInspector state={state} open={devMode} onClose={() => setDevMode(false)} variant="inline" />
          ) : (
            <RuntimeInspector state={state} open={devMode} onClose={() => setDevMode(false)} variant="overlay" />
          )}
        </div>
      </div>
    </MotionConfig>
  );
}
