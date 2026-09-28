import type {
  ConstraintChange,
  EnginePhase,
  ExecutionClass,
  ImpactSummary,
  ResultsPayload,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeIntent,
  RuntimeState,
  Task,
} from "./types";

/* ————————————————— intent parsing ————————————————— */

const CITIES = [
  "bengaluru", "bangalore", "mumbai", "delhi", "gurugram", "pune", "hyderabad",
  "chennai", "kolkata", "goa", "jaipur", "kochi", "ahmedabad", "chandigarh",
];

const TARGET_WORDS: Record<string, string> = {
  amazon: "Amazon",
  flipkart: "Flipkart",
  zomato: "Zomato",
  swiggy: "Swiggy",
  "booking.com": "Booking.com",
  booking: "Booking.com",
  makemytrip: "MakeMyTrip",
  goibibo: "Goibibo",
};

function detectDomain(text: string): string {
  const t = text.toLowerCase();
  if (/(hotel|stay|resort|trip|vacation|night)/.test(t)) return "travel";
  if (/(restaurant|dinner|lunch|food|cafe|eat|biryani|pizza)/.test(t)) return "dining";
  return "shopping";
}

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  const m = cleaned.match(/^(\d+(?:\.\d+)?)(k)?$/i);
  if (!m) return NaN;
  return Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1));
}

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

function parseIntent(text: string): RuntimeIntent {
  const t = text.toLowerCase();
  const domain = detectDomain(t);
  const constraints: Record<string, string | number> = {};

  const price = t.match(/(?:under|below|upto|up to|within|max(?:imum)?|<|≤)?\s*₹\s*([\d,]+(?:\.\d+)?\s*k?)/i)
    ?? t.match(/(?:under|below|within|budget of)\s+([\d,]+k?)\b/i);
  if (price) {
    const v = parseNumber(price[1]);
    if (!Number.isNaN(v)) constraints.max_price = v;
  }
  const ram = t.match(/(\d+)\s*gb\s*(?:ram|memory)/i) ?? t.match(/(\d+)\s*gb\b/i);
  if (ram && domain === "shopping") constraints.ram = `${ram[1]} GB`;
  const nights = t.match(/(\d+)\s*night/);
  if (nights) constraints.nights = Number(nights[1]);
  const guests = t.match(/(\d+)\s*(?:guests?|people|pax|adults?)/);
  if (guests) constraints.guests = Number(guests[1]);
  for (const c of CITIES) {
    if (t.includes(c)) {
      constraints.location = c === "bangalore" ? "Bengaluru" : c[0].toUpperCase() + c.slice(1);
      break;
    }
  }
  const cat = t.match(/\b(laptops?|phones?|smartphones?|headphones?|monitors?|tablets?|cameras?)\b/i);
  if (cat) constraints.category = cat[1][0].toUpperCase() + cat[1].slice(1).toLowerCase();

  const targets: string[] = [];
  for (const [word, label] of Object.entries(TARGET_WORDS)) {
    if (t.includes(word) && !targets.includes(label)) targets.push(label);
  }
  if (targets.length === 0) {
    targets.push(...(domain === "shopping" ? ["Amazon", "Flipkart"] : domain === "dining" ? ["Zomato", "Swiggy"] : ["Booking.com", "MakeMyTrip"]));
  }

  if (domain === "dining" && constraints.max_price) {
    constraints.budget = constraints.max_price;
    delete constraints.max_price;
  }

  return { domain, objective: text.trim(), constraints, targets };
}

/* ————————————————— plan templates ————————————————— */

interface Spec {
  op: string;
  label: string | ((intent: RuntimeIntent) => string);
  reads: string[];
  cls: ExecutionClass;
}

function planSpecs(intent: RuntimeIntent): Spec[] {
  const c = intent.constraints;
  const priceKey = intent.domain === "dining" ? "budget" : "max_price";
  const shared: Spec[] = [
    { op: "request.parse", label: "Parse request", reads: [], cls: "critical" },
    {
      op: "query.build",
      label: "Build search queries",
      reads: [priceKey, "category", "ram", "location", "nights", "guests"].filter((k) => c[k] !== undefined),
      cls: "interruptible",
    },
  ];
  const searches: Spec[] = intent.targets.map((target, i) => ({
    op: `search.${target.toLowerCase().replace(/[^a-z]/g, "")}`,
    label: `Search ${target}`,
    reads: [priceKey, "ram", "location"].filter((k) => c[k] !== undefined).concat(i === 0 ? ["category"] : []).filter((v, ix, a) => a.indexOf(v) === ix),
    cls: "interruptible",
  }));
  const tail: Spec[] = [
    { op: "results.parse", label: "Normalize results", reads: [], cls: "derived" },
    {
      op: "results.rank",
      label: "Filter & rank candidates",
      reads: [priceKey, "ram", "budget", "nights"].filter((k) => c[k] !== undefined),
      cls: "interruptible",
    },
    { op: "candidates.compare", label: "Compare shortlist", reads: ["ram", "guests"].filter((k) => c[k] !== undefined), cls: "critical" },
    { op: "request.summarize", label: "Compose summary", reads: [], cls: "derived" },
  ];
  return [...shared, ...searches, ...tail];
}

function replanSpecs(intent: RuntimeIntent, changedKeys: string[]): Spec[] {
  const priceKey = intent.domain === "dining" ? "budget" : "max_price";
  const specs: Spec[] = [];
  const affects = (keys: string[]) => keys.some((k) => changedKeys.includes(k));
  if (affects(["category", "ram", "location", "nights", "guests", "objective", priceKey, "budget", "max_price"])) {
    specs.push({ op: "query.rebuild", label: "Rebuild queries for new constraints", reads: changedKeys.filter((k) => k !== "objective"), cls: "critical" });
    specs.push({ op: "search.rerun", label: `Re-run search · ${intent.targets.join(" + ")}`, reads: changedKeys.filter((k) => k !== "objective"), cls: "interruptible" });
  }
  specs.push({ op: "results.rerank", label: "Re-rank against updated criteria", reads: changedKeys.filter((k) => k !== "objective"), cls: "interruptible" });
  specs.push({ op: "summary.update", label: "Recompose summary", reads: [], cls: "derived" });
  return specs;
}

/* ————————————————— results ————————————————— */

const POOLS: Record<string, string[]> = {
  shopping: ["Lenovo IdeaPad Slim 5", "HP Pavilion 15", "Acer Swift Go 14", "ASUS Vivobook 16", "Dell Inspiron 14", "MSI Modern 15"],
  dining: ["Truffles Bakes", "Onesta Pizza", "Vidyarthi Bhavan", "Koramangala Social", "Meghana Foods", "Byg Brewski"],
  travel: ["The Zuri Whitefields", "Taj West End", "ibis Bengaluru Tech Park", "Octave Suites", "The Leela Palace", "Sterling Kodai"],
};

function buildResults(intent: RuntimeIntent, fenced: number, reused: number): ResultsPayload {
  const c = intent.constraints;
  const headBits: string[] = [];
  const noun = intent.domain === "dining" ? "restaurants" : intent.domain === "travel" ? "stays" : "options";
  headBits.push(String(c.category ?? noun));
  if (c.max_price) headBits.push(`under ${inr(Number(c.max_price))}`);
  if (c.budget) headBits.push(`under ${inr(Number(c.budget))}`);
  if (c.ram) headBits.push(`${c.ram} RAM`);
  if (c.location) headBits.push(String(c.location));
  if (c.nights) headBits.push(`${c.nights} night${Number(c.nights) === 1 ? "" : "s"}`);
  const heading = `Shortlist — ${headBits.join(" · ")}`;

  const pool = POOLS[intent.domain] ?? POOLS.shopping;
  const items = pool.slice(0, 4).map((title, i) => {
    if (intent.domain === "shopping") {
      const cap = Number(c.max_price ?? 60000);
      const price = Math.round((cap * (0.74 + i * 0.065)) / 100) * 100;
      return {
        title,
        detail: `${inr(price)} · ${c.ram ?? "8 GB"} RAM · ${intent.targets[i % intent.targets.length]}`,
        badge: `${97 - i * 4}% match`,
      };
    }
    if (intent.domain === "dining") {
      const cap = Number(c.budget ?? 2000);
      const cost = Math.round((cap * (0.55 + i * 0.11)) / 10) * 10;
      return {
        title,
        detail: `${inr(cost)} for two · ${(0.8 + i * 0.7).toFixed(1)} km away · ★ ${(4.6 - i * 0.1).toFixed(1)}`,
        badge: ["Open now", "Trending", "Top rated", "Fast delivery"][i],
      };
    }
    const nights = Number(c.nights ?? 2);
    const per = Math.round((5200 + i * 1450) / 100) * 100;
    return {
      title: c.location ? `${title}, ${c.location}` : title,
      detail: `${inr(per)} / night × ${nights} nights · ${c.guests ?? 2} guests · ★ ${(4.7 - i * 0.1).toFixed(1)}`,
      badge: ["Free cancellation", "Breakfast included", "Pay at hotel", "Limited deal"][i],
    };
  });

  const bits: string[] = [];
  if (reused > 0) bits.push(`${reused} earlier step${reused === 1 ? "" : "s"} reused`);
  if (fenced > 0) bits.push(`${fenced} stale result set${fenced === 1 ? "" : "s"} fenced from commit`);
  return {
    heading,
    note: bits.length ? bits.join(" · ") : null,
    items,
    meta: `${intent.targets.join(" · ")} · state v${"X"} applied`,
  };
}

/* ————————————————— engine ————————————————— */

const OUTPUTS: Record<string, () => string> = {
  "request.parse": () => "intent + constraints extracted",
  "query.build": () => `${2 + Math.floor(Math.random() * 2)} query variants built`,
  "results.parse": () => `${110 + Math.floor(Math.random() * 60)} listings normalized`,
  "results.rank": () => "top 8 candidates kept",
  "candidates.compare": () => "3-way comparison ready",
  "request.summarize": () => "summary composed",
  "query.rebuild": () => "queries rewritten",
  "results.rerank": () => "shortlist recomputed",
  "summary.update": () => "summary revised",
};

class InterruptEngine {
  private version = 0;
  private intent: RuntimeIntent | null = null;
  private tasks: Task[] = [];
  private events: RuntimeEvent[] = [];
  private phase: EnginePhase = "idle";
  private evSeq = 0;
  private taskSeq = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();

  /* — public surface (mirrors the HTTP contract) — */

  getState(): RuntimeState {
    const running = this.tasks.filter((t) => t.status === "running").length;
    const score = this.score();
    return {
      state_version: this.version,
      intent: this.intent ? { ...this.intent, constraints: { ...this.intent.constraints }, targets: [...this.intent.targets] } : null,
      tasks: this.tasks.map((t) => ({ ...t, reads: [...t.reads] })),
      events: [...this.events],
      running_tasks: running,
      interruption_score: score,
      phase: this.phase,
    };
  }

  getEvents(limit = 100): RuntimeEvent[] {
    return this.events.slice(-limit);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async message(text: string, isInterruption = false): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.phase === "running" || this.phase === "planning" || this.phase === "interrupting") {
      return this.interrupt(text);
    }
    if (this.phase === "complete") this.archivePreviousRun();

    const intent = parseIntent(trimmed);
    this.intent = intent;
    this.version += 1;
    this.phase = "planning";

    this.emit("user.message", { text: trimmed, interruption: isInterruption });
    this.emit("intent.parsed", {
      domain: intent.domain,
      constraints: intent.constraints,
      targets: intent.targets,
    });
    this.emit("assistant.message", {
      text: this.ackLine(intent),
      closing: false,
    });

    const specs = planSpecs(intent);
    this.emit("plan.created", { version: this.version, count: specs.length });

    specs.forEach((spec, i) => {
      this.after(350 + i * 160, () => {
        if (this.phase !== "planning" && this.phase !== "running") return;
        const prev = this.tasks[this.tasks.length - 1];
        this.addTask(spec, prev?.task_id ?? null);
        if (i === 0) this.startTicking();
      });
    });
    this.after(350 + specs.length * 160 + 120, () => {
      if (this.phase === "planning") this.setPhase("running");
    });
    this.notify();
  }

  async interrupt(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.phase !== "running" && this.phase !== "planning") return this.message(text);

    this.setPhase("interrupting");
    this.emit("user.message", { text: trimmed, interruption: true });
    this.emit("execution.paused", {});

    const delta = this.parseDelta(trimmed);

    this.after(520, () => {
      if (this.phase !== "interrupting") return;
      this.emit("interruption.detected", {
        text: trimmed,
        changes: delta.changes,
        from_version: this.version,
        to_version: delta.noop ? this.version : this.version + 1,
        noop: delta.noop,
      });

      if (delta.noop) {
        this.after(420, () => {
          if (this.phase !== "interrupting") return;
          this.emit("assistant.message", {
            text: "That doesn't alter any active constraint — the current plan stays valid. Continuing.",
            closing: false,
          });
          this.setPhase("running");
          this.emit("execution.resumed", {});
          this.startTicking();
        });
        return;
      }

      // — evaluate every task against the changed keys —
      const fromVersion = this.version;
      const candidates = this.tasks.filter((t) => t.created_in <= fromVersion && ["pending", "running", "completed"].includes(t.status));
      const impact: ImpactSummary = { preserved: 0, invalidated: 0, fenced: 0 };
      const affected = (t: Task) =>
        t.reads.some((k) => delta.keys.includes(k)) ||
        (delta.objectiveChanged && t.reads.length > 0 && t.operation !== "request.summarize");

      candidates.forEach((task, i) => {
        this.after(700 + i * 110, () => {
          if (this.phase !== "interrupting") return;
          const hit = affected(task);
          if (task.status === "completed") {
            if (hit) {
              task.status = "fenced";
              impact.fenced += 1;
              this.emit("task.fenced", { task_id: task.task_id, label: task.label });
            } else {
              task.status = "preserved";
              impact.preserved += 1;
              this.emit("task.preserved", { task_id: task.task_id, label: task.label });
            }
          } else if (task.status === "running" || task.status === "pending") {
            if (hit) {
              task.status = "invalidated";
              impact.invalidated += 1;
              this.emit("task.invalidated", { task_id: task.task_id, label: task.label });
            } else {
              task.created_in = this.version + 1; // carried into the next state
            }
          }
          this.notify();

          if (i === candidates.length - 1) this.applyInterruption(delta, impact);
        });
      });

      if (candidates.length === 0) this.applyInterruption(delta, impact);
    });
    this.notify();
  }

  async reset(): Promise<void> {
    this.clearTimers();
    this.version = 0;
    this.intent = null;
    this.tasks = [];
    this.events = [];
    this.phase = "idle";
    this.evSeq = 0;
    this.taskSeq = 0;
    this.emit("run.reset", {});
    this.notify();
  }

  /* — internals — */

  private applyInterruption(
    delta: { changes: ConstraintChange[]; keys: string[]; targets: string[] | null; objectiveChanged: boolean; objectiveText?: string },
    impact: ImpactSummary,
  ) {
    if (this.phase !== "interrupting") return;
    if (!this.intent) return;

    for (const ch of delta.changes) {
      if (ch.key === "targets" && delta.targets) this.intent.targets = delta.targets;
      else if (ch.to != null) this.intent.constraints[ch.key] = ch.to;
    }
    if (delta.objectiveChanged) this.intent.objective = delta.objectiveText ?? this.intent.objective;

    this.version += 1;
    this.emit("state.updated", {
      version: this.version,
      impact,
      changes: delta.changes,
    });

    const specs = replanSpecs(this.intent, delta.keys.length ? delta.keys : ["objective"]);
    this.emit("plan.created", { version: this.version, count: specs.length, replan: true });
    let prev: Task | null = this.tasks.filter((t) => t.status === "pending" || t.status === "running").pop() ?? null;
    specs.forEach((spec, i) => {
      this.after(300 + i * 150, () => {
        if (this.phase !== "interrupting" && this.phase !== "running") return;
        prev = this.addTask(spec, prev?.task_id ?? null, true);
      });
    });

    this.after(300 + specs.length * 150 + 180, () => {
      // re-plan steps run before any carried-over tail steps
      const settled = ["completed", "preserved", "fenced", "invalidated", "cancelled", "archived"];
      this.tasks = [
        ...this.tasks.filter((t) => settled.includes(t.status)),
        ...this.tasks.filter((t) => t.status === "running"),
        ...this.tasks.filter((t) => t.status === "pending" && t.late),
        ...this.tasks.filter((t) => t.status === "pending" && !t.late),
      ];
      this.setPhase("running");
      this.emit("execution.resumed", { version: this.version });
      this.startTicking();
    });
  }

  private parseDelta(text: string): {
    changes: ConstraintChange[];
    keys: string[];
    targets: string[] | null;
    noop: boolean;
    objectiveChanged: boolean;
    objectiveText?: string;
  } {
    const intent = this.intent;
    if (!intent) return { changes: [], keys: [], targets: null, noop: true, objectiveChanged: false };
    const t = text.toLowerCase();
    if (/^(ok(ay)?|sure|fine|thanks|thank you|continue|keep going|go on|proceed|hurry up)[\s!.]*$/.test(t)) {
      return { changes: [], keys: [], targets: null, noop: true, objectiveChanged: false };
    }
    const changes: ConstraintChange[] = [];
    const keys: string[] = [];
    let targets: string[] | null = null;

    const price = t.match(/₹\s*([\d,]+(?:\.\d+)?\s*k?)/i) ?? t.match(/(?:under|below|within|budget of)\s+([\d,]+k?)\b/i);
    if (price) {
      const v = parseNumber(price[1]);
      const key = intent.domain === "dining" ? "budget" : "max_price";
      if (!Number.isNaN(v) && intent.constraints[key] !== v) {
        changes.push({ key, from: intent.constraints[key] ?? null, to: v });
        keys.push(key);
      }
    }
    const ram = t.match(/(\d+)\s*gb/i);
    if (ram && intent.domain === "shopping") {
      const v = `${ram[1]} GB`;
      if (intent.constraints.ram !== v) {
        changes.push({ key: "ram", from: intent.constraints.ram ?? null, to: v });
        keys.push("ram");
      }
    }
    const nights = t.match(/(\d+)\s*night/);
    if (nights) {
      const v = Number(nights[1]);
      if (intent.constraints.nights !== v) {
        changes.push({ key: "nights", from: intent.constraints.nights ?? null, to: v });
        keys.push("nights");
      }
    }
    const guests = t.match(/(\d+)\s*(?:guests?|people|pax|adults?)/);
    if (guests) {
      const v = Number(guests[1]);
      if (intent.constraints.guests !== v) {
        changes.push({ key: "guests", from: intent.constraints.guests ?? null, to: v });
        keys.push("guests");
      }
    }
    for (const c of CITIES) {
      if (t.includes(c)) {
        const v = c === "bangalore" ? "Bengaluru" : c[0].toUpperCase() + c.slice(1);
        if (intent.constraints.location !== v) {
          changes.push({ key: "location", from: intent.constraints.location ?? null, to: v });
          keys.push("location");
        }
        break;
      }
    }
    const foundTargets: string[] = [];
    for (const [word, label] of Object.entries(TARGET_WORDS)) {
      if (t.includes(word) && !foundTargets.includes(label)) foundTargets.push(label);
    }
    if (foundTargets.length && JSON.stringify(foundTargets.sort()) !== JSON.stringify([...intent.targets].sort())) {
      targets = foundTargets;
      changes.push({ key: "targets", from: intent.targets.join(" · "), to: foundTargets.join(" · ") });
      keys.push("targets");
    }

    const objectiveChanged = changes.length === 0;
    if (objectiveChanged) {
      const volatileKeys = this.tasks
        .filter((tk) => tk.created_in <= this.version && tk.reads.length > 0 && tk.operation !== "request.summarize")
        .flatMap((tk) => tk.reads);
      for (const k of Array.from(new Set(volatileKeys))) keys.push(k);
    }

    return { changes, keys, targets, noop: false, objectiveChanged, objectiveText: text.trim() };
  }

  private addTask(spec: Spec, dependsOn: string | null, late = false): Task {
    this.taskSeq += 1;
    const task: Task = {
      task_id: `t-${String(this.taskSeq).padStart(2, "0")}`,
      operation: spec.op,
      label: typeof spec.label === "function" ? spec.label(this.intent!) : spec.label,
      status: "pending",
      reads: [...spec.reads],
      execution_class: spec.cls,
      created_in: this.version,
      depends_on: dependsOn,
      progress: 0,
      late,
    };
    this.tasks.push(task);
    this.emit("task.created", { task_id: task.task_id, label: task.label, late });
    this.notify();
    return task;
  }

  private startTicking() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), 560);
  }

  private stopTicking() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tick() {
    if (this.phase !== "running" && this.phase !== "planning") return;
    const running = this.tasks.find((t) => t.status === "running");
    if (running) {
      const fast = ["request.parse", "request.summarize", "summary.update"].includes(running.operation) ? 2.6
        : running.operation.startsWith("search") ? 0.9 : 1;
      running.progress = Math.min(100, running.progress + Math.round((20 + Math.random() * 18) * fast));
      if (running.progress >= 100) {
        running.status = "completed";
        running.output = OUTPUTS[running.operation]?.() ?? `${running.label.toLowerCase()} finished`;
        this.emit("task.completed", { task_id: running.task_id, label: running.label, output: running.output });
        this.notify();
      } else {
        this.notify();
      }
      return;
    }
    const next = this.tasks.find((t) => t.status === "pending");
    if (next) {
      next.status = "running";
      next.progress = 6 + Math.floor(Math.random() * 10);
      this.emit("task.started", { task_id: next.task_id, label: next.label });
      this.notify();
      return;
    }
    // nothing left — run complete
    this.stopTicking();
    this.setPhase("complete");
    const preserved = this.tasks.filter((t) => t.status === "preserved").length;
    const fenced = this.tasks.filter((t) => t.status === "fenced").length;
    const steps = this.tasks.filter((t) => ["completed", "preserved"].includes(t.status)).length;
    const results = buildResults(this.intent!, fenced, preserved);
    results.meta = results.meta.replace("vX", `v${this.version}`);
    this.emit("assistant.message", {
      text: this.closingLine(steps, preserved),
      closing: true,
    });
    this.emit("run.completed", { steps, preserved, fenced, results });
    this.notify();
  }

  private archivePreviousRun() {
    for (const t of this.tasks) {
      if (["completed", "preserved", "fenced", "invalidated", "cancelled"].includes(t.status)) {
        t.status = "archived";
      }
    }
  }

  private ackLine(intent: RuntimeIntent): string {
    const c = intent.constraints;
    const bits: string[] = [];
    if (c.max_price) bits.push(`under ${inr(Number(c.max_price))}`);
    if (c.budget) bits.push(`under ${inr(Number(c.budget))}`);
    if (c.ram) bits.push(`${c.ram} RAM`);
    if (c.nights) bits.push(`${c.nights} night${Number(c.nights) === 1 ? "" : "s"}`);
    if (c.location) bits.push(`in ${c.location}`);
    const what = bits.length ? bits.join(", ") : "your criteria";
    return `Understood — searching ${intent.targets.join(" and ")} for ${intent.domain === "shopping" ? String(c.category ?? "options").toLowerCase() : intent.domain === "dining" ? "restaurants" : "stays"} ${what}. Interrupt any time; whatever stays valid is kept.`;
  }

  private closingLine(steps: number, preserved: number): string {
    const base = `Done — ${steps} execution step${steps === 1 ? "" : "s"} total`;
    return preserved > 0 ? `${base}, ${preserved} preserved from the earlier state. Nothing valid was recomputed.` : `${base}.`;
  }

  private score(): number {
    const active = this.tasks.filter((t) => !["archived", "invalidated", "cancelled"].includes(t.status));
    if (active.length === 0) return 0;
    const committed = active.filter((t) => ["completed", "preserved", "fenced"].includes(t.status)).length;
    const runningPart = active.filter((t) => t.status === "running").reduce((s, t) => s + t.progress / 100, 0);
    return Math.round(((committed + runningPart) / active.length) * 100);
  }

  private emit(type: RuntimeEventType, payload: Record<string, unknown>) {
    this.evSeq += 1;
    this.events.push({
      event_id: `e-${String(this.evSeq).padStart(3, "0")}`,
      event_type: type,
      timestamp: Date.now(),
      state_version: this.version,
      payload,
    });
    if (this.events.length > 400) this.events = this.events.slice(-300);
  }

  private setPhase(p: EnginePhase) {
    this.phase = p;
    if (p !== "running" && p !== "planning") this.stopTicking();
  }

  private after(ms: number, fn: () => void) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  private clearTimers() {
    this.stopTicking();
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}

export const engine = new InterruptEngine();
