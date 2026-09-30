# PIVOT

> ## ▶️ [**DEMO VIDEO — watch the PIVOT walkthrough**](https://drive.google.com/file/d/1DcgS1CpTjkDxaqSFtwKn6UR92573X751/view?usp=sharing)
>
> **https://drive.google.com/file/d/1DcgS1CpTjkDxaqSFtwKn6UR92573X751/view?usp=sharing**
>
> 📎 Submission deck: [`SRM_Institute_of_Science_and_Technology_Samseon_Sukas_Submission.pptx`](./SRM_Institute_of_Science_and_Technology_Samseon_Sukas_Submission.pptx)

---

**An execution runtime that lets you change your mind mid-task without throwing away work that is still valid.**

Built for the Samsung PRISM GenAI Hackathon 2026 — theme 05, *Interruptible Real-Time Agents*.

Most agent frameworks treat an interruption as a stop signal. PIVOT treats it as a
change to the problem, and works out which parts of the running job are still
worth keeping. When you change a constraint halfway through, the steps that never
read that constraint stay exactly where they are, the steps that did read it are
marked stale, and any result still in flight is refused entry to the new state
instead of quietly overwriting it. Then it replans from the earliest point that
actually needs redoing and carries on by itself.

The whole point is that it does not start over.

---

## The problem we focused on

Say you ask for laptops under ₹60,000, then half a minute later say *"wait, the
budget is ₹80,000."*

There are two very different things a system could mean by "interrupted":

- **Stop talking.** The agent pauses, waits, resumes when you speak again. Every
  agent with a microphone already does this, and it is not the hard part.
- **Understand that your changed request makes some finished work obsolete while
  other finished work is still correct.** A price bound of ₹80,000 invalidates
  anything that filtered on price. It does not invalidate a step that only parsed
  product titles.

Only the second is hard, and it is the one that matters. The second requires the
system to know *what each step depended on*, which is a data-structure problem, not
a language problem.

Cancellation alone is not enough, and this was the thing we had to get right. You
can cancel every running task the instant the user speaks, and you still end up in
a bad place, for two reasons:

1. **You lose good work.** Cancelling a step that never read the changed
   constraint means throwing away a correct result and paying to recompute it.
2. **You do not actually stop anything.** Cancellation is a request, not a
   guarantee. A step already past its last checkpoint — a page fetch, a tool call,
   a merge — finishes anyway. It comes back later with an answer computed against
   a request that no longer exists.

That second failure is the dangerous one, and it is invisible if you only look at
"did the task stop". PIVOT handles it at commit time instead of at cancel time.

---

## What PIVOT does

Every task records **which constraint values it read** and **which version of the
state it started from**. When you change the request:

1. The new request is parsed and **diffed** against the old one, field by field.
2. Each task is classified by intersecting the fields that changed with the fields
   it declared it reads. Nothing is guessed from timing or from whether it happened
   to be running.
3. Tasks that read a changed field are **invalidated** (recompute) or **fenced**
   (cancel, and refuse to commit). Tasks that read none of them are **preserved**,
   untouched and still wired into the graph.
4. The state **version** increments. Any in-flight result carrying an older version
   is rejected on arrival, no matter when it finishes.
5. The graph is walked to find the **recovery frontier** — the earliest invalidated
   nodes whose inputs are all still valid — and a fresh plan is built from there.
6. Execution resumes automatically and the final answer describes what happened.

The state version is the load-bearing idea, and it is worth stating plainly:

> Each task records the version of the state from which it started. If the user
> changes that state while the task is running, an old result cannot silently
> overwrite the newer state.

A task that starts at v1 and finishes after you have moved to v2 does not get to
commit. It is marked `fenced`, the runtime emits `STALE_RESULT_REJECTED`, and the
newer state is untouched. This is checked at the moment of commit, so it holds even
for steps that ignore cancellation entirely.

---

## The scenario we use to show it

> *Find laptops under ₹60,000 with 8 GB RAM on Amazon and Flipkart*

The parser turns that into constraints (`max_price` 60000, `ram` 8GB, `category`
laptop) and targets (Amazon, Flipkart), then plans six steps: search each store,
parse each store's results, merge the candidates, rank them.

Now interrupt mid-run with:

> *Wait, the budget is ₹80,000 now.*

Only `max_price` changed. The runtime diffs the two states, and because each step
declares what it reads, the classification falls out exactly:

| Step | Reads | Verdict |
|---|---|---|
| Search Amazon | category, max_price, ram, processor | **invalidated** — filtered on the bound |
| Search Flipkart | category, max_price, ram, processor | **invalidated** — filtered on the bound |
| Parse Amazon Results | category, ram | **preserved** — never saw the price |
| Parse Flipkart Results | category, ram | **preserved** |
| Merge Candidates | ram, max_price, category | **fenced** — was running |
| Compare & Rank | ram, max_price, category | **fenced** — was running |

That is a real run, not a staged one: 2 preserved, 2 invalidated, 2 fenced, state
`v1 → v2`. Both figures below were measured against a running backend rather than
reasoned about, and are recorded in
[docs/TEST_EVIDENCE.md](docs/TEST_EVIDENCE.md). The two running steps are fenced
rather than invalidated because they
were mid-flight — they are stopped *and* barred from committing. The four
completed steps split two-and-two on the same criterion, which is the whole
argument in one screen.

Now change the constraint to something else and the honest answer is different.
Interrupt with *"Wait, make that 16 GB RAM"* instead and the runtime reports
**0 preserved, 4 invalidated, 2 fenced** — because every step in this plan reads
`ram`, so nothing survives. Same mechanism, different dependencies, different
result. We mention it because a demo that only ever shows the flattering number
is not telling you anything about the method.

Preservation is a consequence of what steps declare they read, not a special case
we arranged. Change a bound nothing filtered on, and the expensive work stays put.

---

## Architecture

A request travels through these stages. Each one is a real module in `backend/`.

**User input** arrives at `POST /api/message` for a new request or
`POST /api/interrupt` for a change to one in flight. These are deliberately
separate endpoints. A new message re-parses intent from scratch, because
constraints you do not mention are gone. An interruption merges into the existing
constraints, because constraints you do not mention are still there. Collapsing
them would lose one of those two behaviours.

**Intent parsing** (`providers/deterministic.py`) turns text into a structured
`IntentState`: a domain, an objective, a set of constraint key/value pairs, and
targets. It is rule-based and runs with no API key. It also routes browsing
requests — a site you name is searched on that site rather than turned into a
string for a general engine.

**Event handling** (`runtime/events.py`) is an in-process `EventBus`. Everything
the runtime does emits an event: `TASK_CREATED`, `TASK_STARTED`, `TASK_COMPLETED`,
`TASK_CANCELLED`, `TASK_FENCED`, `TASK_PRESERVED`, `STATE_VERSION_CHANGED`,
`INTERRUPTION_DETECTED`, `RECOVERY_STARTED`, `RECOVERY_COMPLETED`,
`STALE_RESULT_REJECTED`. Events are how the UI follows a run, and how the tests
assert on one without reaching into internals.

**The runtime** (`runtime/runtime.py`) is the piece that actually owns the run.
It takes the parsed intent, asks the graph for an execution order, and then
drives that order: start a step, wait for it, record what it returned, and decide
what to do when you change your mind while it works. Everything else in this
section is a service it calls — the bus to announce what happened, state to
remember which version it is on, cancellation to stop work it no longer wants.
Events, versions and fencing are all separate ideas, but this is the one file
where they meet, so if you read only one, read this one.

**The task graph** (`runtime/graph.py`) is a DAG. Each node is a step, and each
edge means "this step needs that one's output first". The graph is what makes
preservation possible at all: without declared dependencies, the only defensible
response to a changed request is to redo everything. It also gives us a topological
order to execute in, descendant traversal to find blast radius, and — the reason it
really earns its place — `get_recovery_frontier`, which returns the stale nodes
whose dependencies are all still valid. That set is where the new plan starts.

**State versions** (`runtime/state.py`) are a monotonically increasing counter,
persisted in SQLite alongside a versioned snapshot of intent, tasks and archived
tasks. A restart resumes the counter from the highest stored version rather than
restarting at one, so a version can never be reused.

**Semantic invalidation** (`runtime/semantic.py`) is the diff and the impact
analysis. `compute_semantic_diff` reports which constraint fields were added,
removed, modified, or left alone. `compute_impact_analysis` intersects the changed
fields with each task's declared `reads` and sorts every task into `stale`,
`preserved`, or `fenced`. Running-and-affected becomes `fenced`; completed-and-
affected becomes `stale`; unaffected stays `preserved`. The distinction matters:
`stale` work is recomputed, `fenced` work is stopped and refused.

**Cancellation** (`runtime/scheduler.py`) is cooperative and best-effort. Each
running task gets an `asyncio.Event`; handlers poll it and also sit inside
`asyncio.wait_for` with a timeout. `cancel_task` sets the event, cancels the
coroutine, and then *awaits* the unwind before returning — so "cancelled" means the
slot is actually released, not merely requested. This is the part that is allowed
to be advisory.

**Stale-result fencing** is the part that is not. After a handler returns, before
anything is written, the runtime compares the task's originating state version to
the current one. If they differ, the result is discarded, the task is marked
`fenced`, and `STALE_RESULT_REJECTED` is emitted. Because this runs at commit time
rather than cancel time, it is immune to handlers that ignore their cancel token.
`IdempotencyGuard` sits alongside it, keying work on a fingerprint of
`(tool, params, state_version)` so a duplicated call returns the original result
instead of repeating a side effect.

**Tool execution** goes through a registry of handlers keyed by operation name
(`browse_navigate`, `browse_snapshot`, `browse_extract`, …). An operation with no
registered handler falls back to a simulated handler, which is why the whole system
is runnable and testable with no browser and no keys.

**Browser execution** (`browser/executor.py`) is a real local Chromium via
Playwright. Each browse step opens a fresh browser context, navigates, waits for
the network to settle, captures a screenshot, and for the extract step pulls text.
URLs pass a scheme gate — `http`, `https`, and `data` for tests. It is a scheme
gate rather than a domain allowlist, deliberately: the demo needs to reach real
search engines and real sites, and the process is a local, single-user research
tool. If Playwright or its Chromium build is missing, the session reports simulated
rather than failing the task.

The extract step does not return the first two thousand characters of the page,
because that is navigation. It keeps prose-length lines, drops interface chrome,
and ranks what remains by how much of the request's subject it contains — so a
Wikipedia run returns the article's lead rather than its table of contents.

**Recovery** (`runtime/runtime.py`) replans from the recovery frontier. The preserved
subgraph is kept; stale and fenced nodes are replaced by fresh v2 nodes; the
frontend gets `RECOVERY_STARTED` and `RECOVERY_COMPLETED` and can show that the
preserved work is still connected.

**The final response** is assembled in the frontend (`frontend/src/runtime/api.ts`)
from the event stream and the settled task results. It names what ran, quotes the
content that was actually extracted, and states plainly what was preserved and what
was fenced. When a run was simulated rather than live, it says so on screen.

### Where external AI models fit

`backend/providers/` defines four interfaces — `LLMProvider`, `DecisionProvider`,
`STTProvider`, `SearchProvider` — and ships deterministic implementations of each.
The runtime uses them for reasoning-shaped work only.

**The interruption, invalidation, fencing and recovery logic in this repository is
implemented locally and does not call a model.** The diff is field comparison, the
impact analysis is set intersection, fencing is a version comparison, and recovery
is a graph traversal. All of it runs, and is tested, with the network unplugged.

No live remote provider is wired up in this submission, so there is no model to
configure. `.env.example` records the variable names those adapters would use, and
they are currently ignored. The honest summary is that the model is the replaceable
part; the runtime is the part we built.

---

## The "Samsung Dev" view

Dev Mode is a header toggle that opens a runtime inspector. It is meant to let a
judge see the mechanism rather than take our word for it. It shows:

- the current state version and the event timeline, so you can watch `v1 → v2` happen
- parsed constraints for the current run
- interruption readiness, computed live from observable runtime signals
- the last impact summary: which tasks were preserved, invalidated, fenced
- the dependency graph with per-task status

It deliberately does **not** expose model reasoning or private scratch output. What
it shows is observable execution state: what was created, what ran, what was
preserved, what was refused, and which version it belongs to.

---

## Tech stack

- **Python 3.10+ / FastAPI / Uvicorn** — the backend API and WebSocket endpoint.
- **Pydantic** — request and response models.
- **SQLite** — state versions and the event log, via the standard library. No
  database server to run.
- **asyncio** — the scheduler. One event loop, cooperative cancellation.
- **Playwright** — real local Chromium for the browse operations.
- **pytest / pytest-asyncio** — the test suite.
- **React 19 + TypeScript + Vite** — the frontend.
- **Tailwind CSS 4** — styling, with the design tokens in `index.css`.
- **framer-motion** — UI transition primitives.
- **lucide-react** — icon set.
- **ogl** — the animated line field behind the reading column.

---

## Running it

Windows / PowerShell first, since that is what we developed on. The commands work
on bash with `cd` and `&&` in place of `;` and `Copy-Item`.

Prerequisites: **Python 3.10 or newer** (3.13 works; the Docker image pins
3.12) and **Node.js 18 or newer** (developed on 24).

```powershell
# 1. Backend dependencies, from the repo root
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirement.txt
playwright install chromium          # one-off; downloads the browser

# 2. Start the backend (terminal 1)
cd backend
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

```powershell
# 3. Frontend (terminal 2, new terminal at the repo root)
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` and `/ws` to port 8000, so
there is no CORS setup to do in development.

The backend also serves the built frontend, which is how the Docker image runs:

```powershell
npm --prefix frontend run build     # single-file dist
cd backend
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000
# then open http://localhost:8000
```

### Tests

```powershell
python -m pytest tests/ -v          # 112 tests, from the repo root
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

`tests/e2e/`, `tests/integration/` and `tests/faults/` are empty placeholders for
suites we planned but did not write. We would rather say that than imply coverage
we do not have.

---

## Environment variables

### Required

**None.** With no `.env` and no keys, PIVOT starts, runs its whole test suite,
and executes tasks with its deterministic providers.

```powershell
Copy-Item .env.example .env
```

The backend loads `.env` at startup; Vite loads it for the frontend. Real
environment variables take precedence over file values.

### Optional — read by this build

**Backend**

| Variable | Default | Meaning |
|---|---|---|
| `DB_PATH` | `data/runtime.db` | SQLite location. Relative paths resolve against `backend/` whatever your working directory. |
| `PORT` | `8000` | Port, when you pass it to uvicorn. |
| `LOG_LEVEL` | `INFO` | Log level. |
| `CORS_ORIGINS` | `*` | Comma-separated origins, or `*` for local development. |
| `BROWSER_HEADLESS` | `true` | Set `false` to watch Chromium drive the page; needs a display. |
| `BROWSER_MAX_CONCURRENT` | `3` | Concurrent browser contexts. |

**Frontend**

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_URL` | empty | Absolute backend URL baked in at build time. Empty means same-origin, which is the single-process setup. |
| `BACKEND_URL` | `http://localhost:8000` | Where the Vite dev proxy forwards `/api` and `/ws`. |
| `FRONTEND_PORT` | `5173` | Dev server port. |

### Local mode — listed, not read

`LLM_API_KEY`, `JEV_API_KEY`, `STT_API_KEY`, `FALLBACK_LLM_*` and their
`*_BASE_URL` / `*_MODEL` companions are listed in `.env.example` but commented
out. No live remote provider is wired into this build, so setting them changes
nothing. They are recorded so the intended shape of the provider layer is visible.

**With no keys at all** the app runs on deterministic providers. Intent parsing is
rule-based rather than model-based, so requests parse identically every time. The
only feature that genuinely needs setup is live browsing, which needs
`playwright install chromium`; without it, browse tasks complete as simulated and
the UI labels them as such on screen rather than pretending otherwise.

---

## Seeing it work

With both servers running:

1. Open http://localhost:5173 and turn on **Dev Mode** in the header.
2. Submit: `Find laptops under ₹60,000 with 8 GB RAM on Amazon and Flipkart`
3. Let a few steps complete. Six tasks are planned; the cheap ones finish first.
4. Before the last two finish, submit: `Wait, the budget is ₹80,000 now`
5. Watch the interruption land: the annotation appears, the semantic diff names
   `max_price`, and the two completed search steps turn **stale**.
6. Watch the split: the two parse steps turn **preserved** and stay where they
   are, the two in-flight steps turn **fenced**, the state version steps
   `v1 → v2`, and the impact panel reads 2 preserved, 2 invalidated, 2 fenced.
7. Watch recovery replan around the preserved work and the result arrive under
   the new constraint, then scroll the Dev Mode event timeline — every step
   above is recorded there.

Timing matters on step 4. The plan staggers its simulated durations so the cheap
steps finish first and the last two are still running when you interrupt. Send the
change after the parse steps have completed; earlier than that and the split is
different, later and nothing is left in flight to fence.

For the live-browser path, `Search for Elon Musk on Wikipedia` opens the real
article in local Chromium and quotes its opening text. Asking for something else
mid-run — `Wait, change Elon Musk to Sam Altman` — re-targets the same site, fences
the in-flight work, and commits the new answer at `v2`.

---

## Repository layout

```
├── frontend/          React + Vite + TypeScript UI
├── backend/
│   ├── api/           FastAPI app, routes, WebSocket
│   ├── runtime/       the runtime: events, state, graph, semantic diff,
│   │                  scheduler, interruption scoring, recovery
│   ├── browser/       Playwright executor
│   └── providers/     provider interfaces + deterministic implementations
├── tests/unit/        112 tests
├── docs/              architecture, setup, deployment, runbook, evidence
├── scripts/           dependency verification helper
├── Dockerfile         backend image, serves API + built frontend
├── docker-compose.yml
├── requirement.txt    Python dependencies
└── pyproject.toml     pytest configuration
```

There is exactly one application. The workspace root *is* the project — no
`src/`, no monorepo indirection.

---

## Documentation

| Document | What it covers |
|---|---|
| [`docs/PEEK_INSIDE.md`](docs/PEEK_INSIDE.md) | Runtime internals: versioning, diff, impact, graph, fencing, scoring |
| [`docs/RESEARCH_AND_ARCHITECTURE_DECISIONS.md`](docs/RESEARCH_AND_ARCHITECTURE_DECISIONS.md) | Alternatives we considered and why we did not take them |
| [`docs/DIFFERENTIATION_AUDIT.md`](docs/DIFFERENTIATION_AUDIT.md) | What is genuinely differentiated versus conventional agent frameworks |
| [`docs/LOCAL_AI_AGENT_SETUP.md`](docs/LOCAL_AI_AGENT_SETUP.md) | Local install, run, troubleshooting |
| [`docs/FREE_SERVICES_AND_DEPLOYMENT.md`](docs/FREE_SERVICES_AND_DEPLOYMENT.md) | Deployment options and free tiers |
| [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) | Five-minute demo script |
| [`docs/TEST_EVIDENCE.md`](docs/TEST_EVIDENCE.md) | Test results, with commands and measured output |
| [`docs/SELF_CRITIQUE.md`](docs/SELF_CRITIQUE.md) | What works, what is approximate, what not to claim |
| [`docs/21ST_COMPONENT_INTEGRATION.md`](docs/21ST_COMPONENT_INTEGRATION.md) | Notes on adapting the UI components we reused |
| [`docs/INTEGRATION_GUIDE.md`](docs/INTEGRATION_GUIDE.md) | Ported integration reference, with a PIVOT errata header listing what differs |

`docs/INTEGRATION_GUIDE.md` was ported from an earlier layout and refers to paths
like `interruptible-agent/`. Its header lists every place it diverges from this
repository. The authoritative references are `PEEK_INSIDE.md` and the code.

---

## Things we decided not to regress

- Local algorithms own state diff, invalidation, fencing, scheduling and recovery.
  Models are replaceable, and currently absent.
- The runtime must stay runnable and testable with zero API keys.
- Never commit `.env`, `data/*.db*`, `node_modules/`, `.venv/`, or
  `frontend/dist/`.
- The browser gate is a scheme allowlist (`http`, `https`, `data`), not a domain
  list. This is a deliberate trade-off, documented above.
