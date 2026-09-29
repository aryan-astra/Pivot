import { Activity, Globe2, LockKeyhole, Search, ShieldCheck } from "lucide-react";
import type { Task } from "@/runtime/types";

const SITES: Record<string, { name: string; domain: string }> = {
  amazon: { name: "Amazon", domain: "amazon.in" },
  flipkart: { name: "Flipkart", domain: "flipkart.com" },
  myntra: { name: "Myntra", domain: "myntra.com" },
  ajio: { name: "AJIO", domain: "ajio.com" },
  tatacliq: { name: "Tata CLiQ", domain: "tatacliq.com" },
  google: { name: "Google", domain: "google.com" },
  bing: { name: "Bing", domain: "bing.com" },
  wikipedia: { name: "Wikipedia", domain: "wikipedia.org" },
};

function siteForTask(task: Task) {
  const target = task.operation.replace(/^(?:search|browser)_/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return SITES[target] ?? { name: task.label.replace(/^Search\s+/i, "") || "Search", domain: "local.search" };
}

/**
 * Live preview beside the execution list. Search tasks get the inline site
 * window; every other live task gets an honest activity card instead — never
 * a fabricated site. Both variants disclose the local simulation.
 */
export function LiveTaskPreview({ task, requestText, siteWindow }: { task: Task; requestText: string; siteWindow: boolean }) {
  const progress = Math.max(0, Math.min(100, task.progress));
  const active = task.status === "running";

  if (!siteWindow) {
    return (
      <section
        aria-label={`${task.label} live task preview`}
        className="min-w-0 rounded-xl border border-line bg-surface p-2.5 shadow-lift sm:p-3"
      >
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-accent">
            <Activity size={14} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[11.5px] font-semibold text-ink">Live task</span>
              <span className="shrink-0 rounded-full border border-fence/30 bg-fence/5 px-1.5 py-[1px] font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-fence">demo</span>
            </div>
            <p className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">{active ? "Running" : "Queued"}</p>
          </div>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        </div>

        <p className="truncate text-[12px] font-medium text-ink" title={task.label}>{task.label}</p>
        <p className="tnum mt-0.5 truncate font-mono text-[9.5px] text-ink-3">{task.operation} · {task.task_id}</p>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <span className="shrink-0 font-mono text-[8px] text-ink-3">{progress}%</span>
        </div>

        <p className="mt-2 flex items-start gap-1.5 text-[9px] leading-relaxed text-ink-3">
          <ShieldCheck size={11} className="mt-px shrink-0 text-ok" aria-hidden="true" />
          <span>This is a local simulation; no live site content is loaded.</span>
        </p>
      </section>
    );
  }

  const site = siteForTask(task);
  const searching = task.status === "running";
  const query = requestText.trim() || task.label;

  return (
    <section
      aria-label={`${site.name} local browser task preview`}
      className="min-w-0 rounded-xl border border-line bg-surface p-2.5 shadow-lift sm:p-3"
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-accent">
          <Globe2 size={14} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[11.5px] font-semibold text-ink">Site preview</span>
            <span className="shrink-0 rounded-full border border-fence/30 bg-fence/5 px-1.5 py-[1px] font-mono text-[8px] font-semibold uppercase tracking-[0.1em] text-fence">demo</span>
          </div>
          <p className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3">{searching ? `Searching ${site.name}` : `Queued · ${site.name}`}</p>
        </div>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      </div>

      <div className="overflow-hidden rounded-lg border border-line-2 bg-browser-window">
        <div className="flex h-7 items-center gap-1.5 border-b border-line bg-browser-chrome px-2">
          <span className="hidden gap-1 sm:flex" aria-hidden="true">
            <i className="h-1.5 w-1.5 rounded-full bg-danger/75" />
            <i className="h-1.5 w-1.5 rounded-full bg-warn/75" />
            <i className="h-1.5 w-1.5 rounded-full bg-ok/75" />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-browser-window px-1.5 py-1 font-mono text-[9px] text-ink-3">
            <LockKeyhole size={10} className="shrink-0 text-ok" aria-hidden="true" />
            <span className="truncate">{site.domain}/search</span>
          </div>
          <span className="shrink-0 font-mono text-[7px] font-semibold uppercase tracking-[0.1em] text-ink-3">local</span>
        </div>

        <div className="min-h-[112px] bg-surface-2/65 p-2.5">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold text-ink-2">
            <span className="grid h-4 w-4 place-items-center rounded bg-accent-soft text-accent"><Globe2 size={10} aria-hidden="true" /></span>
            <span className="truncate">{site.name}</span>
          </div>
          <div className="mt-2 flex min-h-[30px] min-w-0 items-start gap-1.5 rounded-md border border-line bg-browser-window px-2 py-1.5 text-[9px] leading-relaxed text-ink-2">
            <Search size={10} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
            <span className="line-clamp-2 min-w-0 break-words" title={query}>{query}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-browser-chrome text-ink-3" aria-hidden="true">
              <Search size={13} strokeWidth={1.6} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9.5px] font-medium text-ink-2">{searching ? "Searching in the local demo runtime" : "Waiting for the local search task"}</p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <span className="shrink-0 font-mono text-[8px] text-ink-3">{progress}%</span>
          </div>
        </div>
      </div>

      <p className="mt-2 flex items-start gap-1.5 text-[9px] leading-relaxed text-ink-3">
        <ShieldCheck size={11} className="mt-px shrink-0 text-ok" aria-hidden="true" />
        <span>This is a local simulation; no live site content is loaded.</span>
      </p>
    </section>
  );
}
