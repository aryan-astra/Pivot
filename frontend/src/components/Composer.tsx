import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Mic, Zap } from "lucide-react";
import type { EnginePhase } from "@/runtime/types";
import { cn } from "@/utils/cn";

export interface ComposerHandle {
  focus: () => void;
}

export const Composer = forwardRef<ComposerHandle, { phase: EnginePhase; onSend: (text: string) => void }>(
  function Composer({ phase, onSend }, ref) {
    const [value, setValue] = useState("");
    const [hint, setHint] = useState(false);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => taRef.current?.focus(),
    }));

    useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

    const running = phase === "running" || phase === "planning";
    const evaluating = phase === "interrupting";
    const placeholder = evaluating ? "Evaluating impact…" : running ? "Type to interrupt…" : "What would you like me to find?";

    const resize = () => {
      const ta = taRef.current;
      if (!ta) return;
      ta.style.height = "0px";
      ta.style.height = Math.min(ta.scrollHeight, 148) + "px";
    };

    const submit = () => {
      const text = value.trim();
      if (!text || evaluating) return;
      onSend(text);
      setValue("");
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = "auto";
      });
    };

    const micTap = () => {
      setHint(true);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(false), 2600);
    };

    return (
      <div className="pointer-events-none sticky bottom-0 z-20">
        <div className="bg-gradient-to-t from-paper via-paper/92 to-transparent pt-6 pb-3 md:pb-4">
          <div className="pointer-events-auto mx-auto w-full max-w-[840px] px-4 md:px-8">
            <div
              className={cn(
                "rounded-xl border bg-surface shadow-lift transition-[border-color,box-shadow] duration-200",
                "focus-within:border-line-2 focus-within:shadow-float",
                running ? "border-warn/35" : "border-line",
              )}
            >
              <div className="flex items-end gap-2 px-3 py-2.5">
                <button
                  type="button"
                  aria-label="Voice input (unavailable in this build)"
                  onClick={micTap}
                  className="mb-[3px] shrink-0 rounded-lg p-1.5 text-ink-3 transition-[background-color,color] duration-150 hover:bg-surface-2 hover:text-ink"
                >
                  <Mic size={16} strokeWidth={1.75} />
                </button>

                <textarea
                  ref={taRef}
                  rows={1}
                  value={value}
                  disabled={evaluating}
                  onChange={(e) => {
                    setValue(e.target.value);
                    resize();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={placeholder}
                  aria-label={running ? "Interrupt the agent with a new requirement" : "Send a request to the agent"}
                  className="max-h-[148px] min-h-[26px] flex-1 resize-none bg-transparent py-[5px] text-[16px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 disabled:cursor-wait md:text-[15px]"
                />

                <button
                  type="button"
                  onClick={submit}
                  disabled={!value.trim() || evaluating}
                  aria-label={running ? "Send interruption" : "Send request"}
                  className={cn(
                    "mb-[1px] flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-dark text-dark-text",
                    "transition-[transform,opacity,background-color] duration-150",
                    "hover:-translate-y-[1px] hover:bg-ink active:translate-y-0 active:scale-[0.94]",
                    "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:translate-y-0",
                  )}
                >
                  {running ? <Zap size={16} strokeWidth={1.9} /> : <ArrowUp size={17} strokeWidth={2} />}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line/70 px-3.5 py-[7px]">
                <span className="truncate font-mono text-[10.5px] text-ink-3" aria-live="polite">
                  {hint ? (
                    <span className="text-ink-2">voice capture isn't wired in this build</span>
                  ) : (
                    <>enter to send · shift+enter for a new line</>
                  )}
                </span>
                {running && (
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-warn">
                    <Zap size={10} strokeWidth={2.2} aria-hidden="true" />
                    will interrupt the run
                  </span>
                )}
                {evaluating && (
                  <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.1em] text-fence">evaluating impact…</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
