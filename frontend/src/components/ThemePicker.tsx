import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Moon, Palette, Sun } from "lucide-react";
import { THEMES, type ThemeId } from "@/theme";

export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (theme: ThemeId) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = THEMES.find((theme) => theme.id === value) ?? THEMES[0];
  const lightCount = THEMES.filter((theme) => theme.mode === "light").length;
  const darkCount = THEMES.filter((theme) => theme.mode === "dark").length;

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-label={`Change theme. Current theme: ${current.name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-2 bg-surface px-2.5 text-[12px] font-medium text-ink-2 transition-[background-color,border-color,color] hover:border-accent/60 hover:bg-surface-2 hover:text-ink active:scale-[0.97]"
      >
        <Palette size={14} strokeWidth={1.8} className="text-accent" aria-hidden="true" />
        <span className="hidden sm:inline">{current.name}</span>
        <ChevronDown size={13} strokeWidth={1.8} className="hidden text-ink-3 sm:block" aria-hidden="true" />
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Choose a color theme"
          className="theme-picker-dialog absolute right-0 top-[calc(100%+10px)] z-[80] w-[min(380px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line bg-surface shadow-float"
        >
          <div className="border-b border-line bg-surface-2/80 px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[14px] font-semibold tracking-[-0.02em] text-ink">Choose your atmosphere</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">{THEMES.length} palettes, saved on this device</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
                <Sun size={10} className="text-accent" aria-hidden="true" />
                {lightCount} light · {darkCount} dark
              </span>
            </div>
          </div>

          <div role="radiogroup" aria-label="Available themes" className="grid grid-cols-2 gap-2 p-3">
            {THEMES.map((theme) => {
              const selected = theme.id === value;
              const Icon = theme.mode === "dark" ? Moon : Sun;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  key={theme.id}
                  onClick={() => {
                    onChange(theme.id);
                    setOpen(false);
                  }}
                  className={`group relative flex min-h-[62px] items-center gap-2.5 rounded-xl border p-2.5 text-left transition-[background-color,border-color,transform] hover:-translate-y-px hover:bg-surface-2 ${selected ? "border-accent bg-accent-soft/60" : "border-line bg-surface"}`}
                >
                  <span
                    className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[11px] border border-ink/10 shadow-sm"
                    style={{ background: `linear-gradient(145deg, ${theme.swatches[0]} 4%, ${theme.swatches[1]} 55%, ${theme.swatches[2]} 100%)` }}
                    aria-hidden="true"
                  >
                    <span className="absolute left-[7px] top-[7px] h-2 w-2 rounded-full border border-white/30 bg-white/80" />
                    <span className="absolute bottom-[6px] right-[6px] h-[13px] w-[13px] rounded-[4px] border border-white/25 bg-white/20" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold text-ink">{theme.name}</span>
                      <Icon size={11} className="shrink-0 text-ink-3" aria-hidden="true" />
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[9.5px] tracking-[0.01em] text-ink-3">{theme.mood}</span>
                  </span>
                  {selected && <Check size={14} strokeWidth={2.5} className="absolute right-2 top-2 text-accent" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
            <span className="text-[10.5px] text-ink-3">Contrast tuned for the workspace</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-accent">Pivot palettes</span>
          </div>
        </section>
      )}
    </div>
  );
}
