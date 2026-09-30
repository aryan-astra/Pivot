# Test Evidence

*Generated September 2026*

---

## Test Results Summary

| Suite | Tests | Passed | Failed | Duration |
|-------|-------|--------|--------|----------|
| Unit Tests | 63 | 63 | 0 | 1.54s |
| Integration | (covered by unit) | — | — | — |
| E2E (API) | 3 | 3 | 0 | < 1s |

## Unit Test Coverage

### Types & Fingerprints (4 tests)
- ✅ ID generation uniqueness
- ✅ Fingerprint determinism
- ✅ Fingerprint order-independence
- ✅ Fingerprint sensitivity to changes
- ✅ IntentState fingerprint changes

### Event Bus (5 tests)
- ✅ Publish and subscribe
- ✅ Subscribe all (global listener)
- ✅ Event history
- ✅ History filtering by type
- ✅ Unsubscribe

### Dependency Graph (9 tests)
- ✅ Node and edge counting
- ✅ Descendant traversal (BFS)
- ✅ Ancestor traversal (BFS)
- ✅ Impact node calculation
- ✅ Recovery frontier computation
- ✅ Topological execution ordering
- ✅ Root identification
- ✅ Leaf identification
- ✅ Node removal
- ✅ Graph cloning

### Semantic Diff (7 tests)
- ✅ No-change detection
- ✅ Constraint modification
- ✅ Constraint addition
- ✅ Constraint removal
- ✅ Domain change detection
- ✅ Target change detection
- ✅ Changed fields computation
- ✅ Impact analysis (stale/preserved/fenced)

### Interruption Scorer (5 tests)
- ✅ Initial score is zero
- ✅ Score increases with speech signals
- ✅ Score stays low without signals
- ✅ Commit-in-progress penalty
- ✅ Backchannel likelihood penalty
- ✅ Temporal smoothing

### Interruption Classifier (4 tests)
- ✅ Backchannel detection ("ok", "right", "uh-huh")
- ✅ Cancellation detection ("stop", "cancel")
- ✅ Clarification detection ("why are you...")
- ✅ Modification detection ("actually", "make that", "instead")

### Idempotency Guard (4 tests)
- ✅ Key determinism
- ✅ Key differs by state version
- ✅ Acquire and complete flow
- ✅ Duplicate prevention

### State Manager (7 tests)
- ✅ Initial version is 0
- ✅ Version increments on intent update
- ✅ Task registration and retrieval
- ✅ Task status updates
- ✅ Task archival with reason
- ✅ Checkpoint creation
- ✅ Tasks-by-field filtering
- ✅ Stale result protection (version fencing)

### Task Scheduler (3 tests)
- ✅ Schedule and complete
- ✅ Cancel running task
- ✅ Concurrency limit enforcement

### End-to-End Interruption (3 tests)
- ✅ Submit intent → interrupt → recovery
- ✅ State version fencing
- ✅ Chaos scenario (multiple rapid interruptions)

### Deterministic Providers (7 tests)
- ✅ Intent parsing: laptop search
- ✅ Intent modification parsing
- ✅ Intent parsing: hotel search
- ✅ Decision provider: interruption classification
- ✅ Decision provider: backchannel detection

## E2E API Test

Tested via HTTP against running server:

```
1. POST /api/message → 6 tasks planned
2. POST /api/interrupt → RAM changed, state v1→v2
3. GET /api/state → RAM=16GB, price=60000 (preserved), category=laptop (preserved)
```

## Security Checks

- ✅ No secrets in source code (grep scan)
- ✅ .env in .gitignore
- ✅ No hardcoded credentials
- ✅ Path traversal protection in filesystem tools
- ✅ Browser executor: http/https scheme gate only, no domain allowlist (live-verified below)
- ✅ WebSocket message validation

## Performance Measurements

| Operation | Measured |
|-----------|---------|
| Semantic diff | < 1ms |
| Impact analysis | < 1ms |
| Graph traversal | < 1ms |
| State version increment (with SQLite) | < 5ms |
| Full interruption pipeline | < 10ms (excluding LLM) |
| Unit test suite | 1.54s |

## Known Limitations

- Browser automation now tested against real websites (example.com,
  example.org, en.wikipedia.org/wiki/India) with real local Chromium.
- WebSocket load testing not performed
- Visual QA not automated

---

## PIVOT Consolidation Evidence (measured Sep 2026, Python 3.13 / Node 24)

Backend suite re-run from the repo root: **63 passed** (`python -m pytest tests/`).
E2E interruption, fencing, and chaos scenarios pass unchanged after the
simulated-work pacing change (`_default_task_handler` default 2.0s → 8.0s).

Frontend: `npm run typecheck` clean, `npm run build` succeeds
(single-file `dist/index.html`, ~454KB / ~140KB gzip).

Live integration (backend `:8001` + vite dev `:5173`, real browser):
- `POST /api/message` (laptop 8GB) → 6 tasks planned → all complete, v1.
- Mid-run `POST /api/interrupt` ("make that 16 GB") → recovery to v2 with
  `ram=16GB`, `max_price`/`category`/`targets` preserved; in-flight tasks
  fenced; late v1 results rejected via `STALE_RESULT_REJECTED`.
- UI renders user messages, execution plans v1+v2, interruption annotation
  (`ram 8GB → 16GB`), impact card (0/0/6), inspector (state, constraints,
  readiness, impact, graph, timeline) with zero console errors.
- Production mode: `GET /` on the backend serves the built SPA; same-origin
  `/api/*` works with no proxy.

Bugs found and fixed during consolidation (all verified by re-test):
1. Backend crashed at startup when `frontend/dist` exists without `assets/`
   (single-file build) — static mount is now conditional.
2. `UNIQUE constraint failed: state_versions.version` after `/api/reset` or
   restart reusing the same DB — `StateManager` resumes the version counter
   from `MAX(version)`; `/api/reset` starts a fresh DB.
3. Frontend `state.tasks is not iterable` in network mode — backend returns
   tasks as an id-keyed object; `api.ts` now normalizes to the `RuntimeState`
   array shape (plus event-dialect translation, score scaling, phase derivation).
4. Fast follow-up interruptions misrouted to `/api/message` (4s idle poll left
   the composer unaware a run started) — `send()` refreshes state immediately.
5. `TASK_PROGRESS` spam slid lifecycle events out of the 100-event window and
   starved the stream — progress events are dropped in translation and the
   window widened to 400.

## Stabilization Audit (post-consolidation pass)

- Adversarial runtime checks (direct, scripted): 22/22 pass — normal completion,
  cancel-all, cancellation-ignoring handlers still fenced (`STALE_RESULT_REJECTED`,
  no stale commit), backchannel ignored, explicit cancellation, empty-text
  interruption (no crash), 3× rapid interruptions (v4, latest-wins), preserved /
  archived separation, idempotency-guard determinism + duplicate-cached,
  parser edge cases.
- New behavior from this pass: unaffected completed tasks are now explicitly
  marked `preserved` (new `TASK_PRESERVED` event) instead of staying
  indistinguishable `completed`; frontend maps the event for the inspector.
- Security: fixed static-server path traversal (`/{full_path}` is now contained
  in `frontend/dist`; `..` escapes return 404, verified); no
  `dangerouslySetInnerHTML`/`eval` in frontend; no secrets in tree or bundle;
  `.env`/`data/*.db*`/`node_modules`/`dist` ignored and uncommitted.
- Viewports (1440/768/~500px, production build): no page-level horizontal
  overflow; task meta lines ellipsis-clip by design. Fixed: composer textarea
  now `16px` below `md` (was 15px → iOS focus zoom).
- WebSocket `/ws`: verified `state_snapshot` on connect + `command_result` on
  message (frontend uses polling as primary; WS available).
- Full suite re-run after every backend change: 63 passed; `tsc --noEmit`
  clean; `vite build` clean; production served-mode (`GET /` → SPA) verified
  in a real browser with a full interrupt/recovery flow and zero console errors.
- Mobile testing limited to CSS responsive design and measurement (no
  device/emulator in this environment): at 390px, `scrollWidth == clientWidth`,
  the theme dialog stays inside the viewport, and the canvas matches the workspace.
  With `prefers-reduced-motion: reduce`, two canvas samples 500ms apart are
  identical; the motion preference also reaches Framer Motion via `MotionConfig`.

## Component integration pass (Framer bundle, 2026-09-28)

Sources adapted: `Interaction_Lines_Background` (Karim Saif) + four vector
glyphs (`Home`, `Shape 1` ×2, `Vector`). Adaptation rules and the decision not
to take on the `framer` runtime are recorded in `docs/21ST_COMPONENT_INTEGRATION.md`
§6. No new dependencies.

Verified on this pass:
- `npm run typecheck` clean; production `vite build` clean (1,196.42 kB
  single-file HTML, 616.06 kB gzip); `npm audit` reports 0 vulnerabilities;
  backend `pytest`: 63 passed.
- Production-served browser check: `GET /` returns 200 and `/api/health` is
  healthy. In the 1440×840 Ink canvas probe, 36,333 white stroke pixels render
  beneath the soft central mask; the theme is `#27313b` charcoal, and the former
  `obsidian` preference migrates to `ink`.
- Animation check: the idle canvas fingerprint changed between 420ms samples;
  with reduced motion enabled, two samples 500ms apart were identical. At 390px,
  there is no horizontal overflow.
- Production integration flow: automatic inline Site preview appeared during
  a laptop search with local-simulation disclosure and no permanent preview
  button; interrupting with “Actually make that 16 GB RAM” reached state v2
  with RAM `16GB`. Recovery and interruption glyphs appeared beside their
  matching stream events. No external requests, console errors, or 5xx responses.
- Dev Mode Event timeline: scroll container measured 788px high with 3,452px
  of history; it scrolled to `scrollTop: 2,664`.
- Layout at 390px and 1440px: no horizontal overflow; semantic glyphs stay with
  their labels; the field is `pointer-events-none` so clicks pass through.

## Live browser execution pass (2026-09-29)

- `go to example.com` plans 3 chained tasks (`browse_navigate` →
  `browse_snapshot` → `browse_extract`, INTERRUPTIBLE, `reads: ["url"]`) via
  `register_tool` handlers on a shared Chromium session (one context per
  task, strict close order, 12s/5s/8s timeouts, cooperative cancellation).
  No domain allowlist; http/https/data scheme gate only.
- Real captures verified server-side: 22 KB JPEG data URIs, title
  `Example Domain`, extracted body text; wikipedia run: 153 KB captures,
  `India - Wikipedia` title + snippet. `/api/state` with 6 screenshots =
  141,557 bytes (localhost polling only).
- Interrupting mid-browse (`wait, go to example.org instead`) recovers to v2
  with `url`+`targets` changed, v1 preserved, no hang; v2 tasks capture the
  new domain. No external API calls in any test (Chromium + `data:` URLs in
  unit tests; user-driven site loads only).
- UI: preview follows any live task; real pixels render with a `live` badge
  (`Live capture from the running browser`), mocks keep `demo` + simulation
  disclosure; finished browse cards show title/snippet outputs. Inspector
  timeline + graph verified with browse ops. Zero console errors.
- Suite: 78 passed (63 + 15 new browser tests); `tsc --noEmit` clean;
  `vite build` clean (one transient rollup worker flake, clean on rerun);
  `npm audit` 0 vulnerabilities (frontend + video).

## Floating preview window pass (2026-09-29)

- The browser preview moved out of the execution list into
  `FloatingPreview`: a fixed viewport layer (`z-30`, pointer-transparent)
  holding one draggable card near the bottom-left, clear of the composer
  (31px gap measured at 1062x670). The execution section is a single stable
  column again — no reflow as steps turn over.
- Timed in-page samples across a live `go to instagram.com` run (card
  present at every tick, same rect left=24/bottom=526): t=1.0s running step
  with `demo` badge (activity card, no fabricated image), t=2.6s still
  running, t=4.2s `final` badge + real capture image, t=6.8s pinned after
  settle. The window never disappears between steps or at completion.
- Minimize toggle: one click shrinks 323px -> 63px header pill (image
  hidden, label swaps to "Expand the floating preview"), second click
  restores; a new state version re-opens a minimized window.
- Real-pointer drag (MCP browser drag from the card header to the Dev Mode
  button): `translateX(714px) translateY(-202px)`, landed fully on-screen
  (constraints held against the 1062x670 viewport), collapse still wired
  afterwards. Synthetic pointer events do not engage framer-motion's
  gesture — verified with browser-driven input instead.
- Selection priority unchanged and verified: live search site window ->
  newest real capture (during the run and pinned as final) -> running task
  activity card while live -> nothing for non-browser runs. Answer copy
  now reads "The final capture stays visible in the floating preview."
  and the results note "Final capture floating in the preview".
- Console clean (only the React DevTools info line); zero errors during
  run, collapse, and drag.
- Suite: 78 passed; `tsc --noEmit` clean; `vite build` clean (one transient
  rollup failure on first run, clean on rerun).

## Final review + web-search pass (2026-09-29)

Suite: **97 passed** (78 → 97: search routing, scheduler terminal
persistence, noop interruption, live readiness score, stale-commit fence,
completed-read staleness, `content_text` chrome trim); `tsc --noEmit`
clean; `vite build` clean (1,208.31 kB single-file, 8.87s).

Reviewer findings, all verified fixed except the deliberately-skipped
unreachable `engine.ts` recursion (UI-gated dead path, over-engineering to
fix):
- Terminal statuses persisted: `TaskScheduler(on_terminal=…)` writes
  cancelled/failed/timeout from `_run`'s outcome branches; stop no longer
  leaves tasks stuck `running` (`TASK_FAILED` now also mapped to a
  `task.failed` stream event).
- Semantic impact: completed/preserved tasks with changed reads become
  `stale`; the runtime archives both statuses (no blanket `continue`).
- No-change interruptions return `{action: "noop"}` (plus a recorded false
  interruption) — same guard as fresh messages; the UI shows no
  annotation, no version bump, no recovery copy.
- `_readiness_score()` calls `interruption_scorer.compute()` with live
  signals before every `/api/state` — Inspector readiness is non-zero
  (observed 16% mid-run, 6% idle; was a permanent 0%).
- Dead code/docs cleanup: `PWError` imports + `is_available` removed,
  `Composer.tsx` deleted (`git rm`), README/21st-doc references renamed,
  `Query(ge=1)` + WebSocket frame-size guard.

Search now runs in the real browser end-to-end (`search for samsung galaxy
s26 release date` → `browse_navigate|snapshot|extract`, plan label
"Search the web for …", ack/answer/results heading all quote the query):
- **Bing market pinning (found during E2E)**: a bare headless request got
  geolocated junk SERPs ("50 results", unrelated DE/JP pages);
  `&setmkt=en-US&setlang=en&cc=US` returns the real SERP (side-by-side
  probe: plain → junk, pinned → "About 42,900 results" with Wikipedia /
  TechAdvisor listings).
- Capture settle: `wait_for_load_state("networkidle")` (5s cap) after
  `domcontentloaded`, so captures show rendered results, not the shell.
- `content_text()` trims leading boilerplate (skip links, ALL-CAPS nav
  rows, Rewards/MORE/Privacy/Terms) — the answer and task summaries quote
  content: "About 42,900 results wikipedia.org … Samsung Galaxy S26 - Wikipedia…".
- Preview honesty via `Task.simulated`: the embedded demo keeps its site
  window; real runs never show the mockup — mid-run they show an honest
  "Live task / OPENING — the capture appears here the moment it renders"
  card, then upgrade to real captures (pinned final after settle).

Browser E2E (vite `:5173` + backend `:8000`, MCP Chromium, screenshots):
- Search run: mid-run preview shows the OPENING card with live task
  progress; settle pins the final capture (real Bing SERP pixels),
  answer quotes real result text, results block "Search
  'samsung galaxy s26 release date' — bing.com", 0 console errors.
- Stop mid-run → "Stopped — 3 steps cancelled on your request; nothing
  was captured.", every cancelled task persisted `cancelled`,
  `running_tasks: 0`, no stuck spinners.
- No-op interruption mid-run ("sounds good keep going please") → state
  version unchanged (v3 → v3), no "Interruption detected" annotation, no
  recovery message, run completes normally with the full answer.
- Dev Mode Inspector: readiness 16% mid-run / 6% idle; constraints show
  pinned URL + query + `bing.com` target; zero console errors in every
  run above.

## Plan pacing (2026-09-29)

`_create_plan` staggers the simulated step durations for shopping/search plans
instead of leaving all six steps on the `_default_task_handler` 8 s default:

| Step | Before | After | Why |
|---|---|---|---|
| Search (per target) | 8 s | 6.0 s | completes while parses are still parsing |
| Parse (per target) | 8 s | 7.5 s | completes before merge starts |
| Merge | 8 s | 18.0 s | still running when the interrupt lands |
| Compare | 8 s | 22.0 s | still running when the interrupt lands |

This is **pacing only** - scheduling, impact analysis, fencing and state logic
are untouched. It exists because uniform 8 s durations make every step of a
chain finish inside the same instantaneous cascade, leaving no window in which
an interruption can report a *mixed* impact (completed work preserved **and**
completed work invalidated **and** in-flight work fenced) through the real UI.
The staggered plan opens that window without staging anything. Travel, hotel,
flight and the default branch are unchanged.

## Browse request routing and answer extraction (2026-09-30)

Three defects made a named-site request misbehave against live Chromium:

1. The URL branch ran before the search branch, so `go to wikipedia.com and
   search for X` returned as navigation and quoted the homepage's own text.
2. There was no site-scoped search, so `search for X on Wikipedia` searched Bing
   for the literal string `"X on Wikipedia"` - pages about searching Wikipedia
   rather than about the subject.
3. The extract step returned the first 2000 characters of `inner_text`, which
   is navigation; a Wikipedia run quoted the article's own table of contents.

Fixed by a site registry (Wikipedia, Amazon, Flipkart, YouTube, Reddit, IMDb,
GitHub, LinkedIn, Google) that maps a named site to its own search endpoint, a
search verb that outranks a bare URL for sites we can actually search, and
`focused_text()` which keeps prose lines, drops interface chrome, and ranks the
remainder by query coverage.

Also added: subject-swap interruptions (`change Elon Musk to Sam Altman`
re-issues the same site's search), question-form routing (`what is the price of
X`), and word-start anchoring for domain keywords - `iphone` was matching the
shopping keyword `phone`.

Verification:

- `python -m pytest tests/ -q` -> **112 passed** (97 -> 112: 15 new tests
  covering each routing rule, the guardrails that keep shopping and travel on
  their comparison plans, and the extraction).
- Live Chromium, three-step sequence. `Search for Elon Musk on Wikipedia` opened
  `https://en.wikipedia.org/wiki/Elon_Musk` (title `Elon Musk - Wikipedia`) and
  extracted the article lead. Repeating the request re-ran cleanly. Interrupting
  a third run with `Wait, change Elon Musk to Sam Altman` moved state v1 -> v2 ->
  v3 -> v4 with the Elon Musk tasks **fenced** and the Sam Altman tasks
  committed, extracting `Samuel Harris Altman (born April 22, 1985) is an
  American entrepreneur and investor who has been the chief executive officer
  (CEO) of the artificial intelligence company OpenAI since 2019.`
- `search for samsung galaxy s26 price` returned real Samsung result rows rather
  than a header dump.

## Dependency declaration and submission check (2026-09-30)

`requirement.txt` at the repo root replaces `backend/requirements.txt`. The
declared set, each traceable to an import in `backend/`:

| Package | Pin | Why |
|---|---|---|
| `fastapi` | 0.115.6 | HTTP + WebSocket API |
| `uvicorn[standard]` | 0.32.1 | ASGI server; `[standard]` supplies the `/ws` implementation |
| `pydantic` | 2.10.3 | request/response models |
| `python-dotenv` | 1.0.1 | loads `.env` in `backend/api/main.py` |
| `playwright` | 1.63.0 | real local Chromium for the browse operations |
| `pytest` | 8.3.4 | test runner |
| `pytest-asyncio` | 0.24.0 | async test support |

Dropped as declared-but-unused: `httpx` (no `TestClient` or client use anywhere)
and `websockets` (arrives transitively via `uvicorn[standard]`; the `/ws` route
uses `fastapi.WebSocket`). No live remote provider is wired up, so no HTTP client
is required - the provider variables in `.env.example` are commented out and
unread.

Verified in a **clean virtual environment created outside the repository**:

- `pip install -r requirement.txt` -> all 7 distributions installed at the
  pinned versions
- every `backend/` module imports (`api.main`, `runtime.*`, `browser.executor`,
  `providers.*`) - this is what proves no undeclared import is hiding
- the app object builds with **16 routes**, including `/api/health` and `/ws`
- `python -m pytest tests/ -q` -> **112 passed** inside the clean environment

Reproduce with `python scripts/verify_requirements.py` (creates the venv under
`%TEMP%`, runs the checks, then deletes it).

Frontend, re-verified at the same time:

- `npm run typecheck` -> clean
- `npm run build` -> `dist/index.html` 1,208.81 kB (gzip 619.64 kB), single file
- README link and path audit via `python scripts/check_readme_links.py` ->
  42 references checked, all resolve

### Demo scenario impact, measured

The README's headline demo was checked against the live stack rather than assumed.
Submitting `Find laptops under ₹60,000 with 8 GB RAM on Amazon and Flipkart`,
waiting for the mixed-impact window (both parses completed, merge and compare
still running), then interrupting:

| Interrupt text | `changed_fields` | v | preserved | invalidated | fenced |
|---|---|---|---|---|---|
| `Wait, budget is ₹80,000 now` | `max_price` | 1 -> 2 | **2** | **2** | **2** |
| `Wait, make that 16 GB RAM` | `ram` | 1 -> 2 | **0** | **4** | **2** |
| `Wait, 16 GB RAM and budget ₹80,000` | `ram`, `max_price` | 1 -> 2 | **0** | **4** | **2** |

The price change is the one the README uses, because it is the only one of the
three that produces a split. The RAM change preserves nothing, and correctly so:
every step in this plan declares `ram` in its reads, so all four completed steps
are affected. Both numbers come from `POST /api/interrupt` responses on the live
stack, not from the plan on paper.

The first draft of the README claimed 2/2/2 for a RAM change. It was wrong, and
`check_demo_claim` caught it before the commit. The table and the
`Seeing it work` steps now quote the measured values.
