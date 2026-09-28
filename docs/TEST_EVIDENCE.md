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
- ✅ Domain allowlisting in browser executor
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

- Browser automation not tested against real websites (anti-bot)
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
  in `frontend/dist`; `..` escapes return 404, verified); `BrowserExecutor`
  allowlist is now default-deny (module has no runtime callers); no
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
- Mobile testing limited to CSS responsive design
