import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/runtime/api";
import { engine } from "@/runtime/engine";
import type { RuntimeState } from "@/runtime/types";

/**
 * Keeps the UI in sync with the runtime.
 *
 * Two channels, as the contract intends:
 *  · subscription for immediate embedded updates
 *  · adaptive polling — aggressive while work is active, a slow heartbeat once
 *    the runtime is quiet, nothing more
 */
export function useRuntime() {
  const [state, setState] = useState<RuntimeState>(() => engine.getState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const modeRef = useRef<"undecided" | "network" | "embedded">("undecided");
  void api.ready().then((m) => {
    modeRef.current = m;
  });

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState());
    } catch {
      // Backend unreachable mid-session: keep last known state; the next
      // poll retries. Embedded fallback was decided at startup by api mode.
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const unsub = api.subscribe(() => {
      // Engine snapshots only apply in embedded mode; in network mode the
      // backend is the system of record and polling covers updates.
      if (mounted && modeRef.current !== "network") setState(engine.getState());
    });

    let timer: ReturnType<typeof setInterval> | null = null;
    const schedule = () => {
      if (timer) clearInterval(timer);
      const active = ["running", "planning", "interrupting"].includes(stateRef.current.phase);
      timer = setInterval(() => void refresh(), active ? 700 : 4000);
    };
    schedule();
    const reschedule = setInterval(schedule, 1500);
    // Background tabs get throttled timers; sync immediately on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    void refresh();

    return () => {
      mounted = false;
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timer) clearInterval(timer);
      clearInterval(reschedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async (text: string) => {
    const active = ["running", "planning", "interrupting"].includes(stateRef.current.phase);
    if (active) await api.interrupt(text);
    else await api.sendMessage(text, false);
    // Sync immediately: idle polling is a 4s heartbeat, which would otherwise
    // leave the composer in "new request" mode for seconds after a send and
    // misroute a fast follow-up interruption to /api/message (losing the
    // preserved-constraint parse). Refresh collapses that window to ~200ms.
    await refresh();
  }, [refresh]);

  const reset = useCallback(async () => {
    await api.reset();
    await refresh();
  }, [refresh]);

  return { state, send, reset };
}
