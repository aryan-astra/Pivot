# PIVOT

**An interruptible execution runtime: change your mind mid-execution without losing valid work.**

Built for the Samsung PRISM GenAI Hackathon 2026 — Theme 05: Interruptible Real-Time Agents.

When you interrupt the agent with a new requirement, PIVOT determines which work
remains valid, which is stale, fences late results so they cannot corrupt the new
state, and resumes automatically from the recovery frontier. It does not restart
everything.

> **Cancellation is advisory. Validity is authoritative.**

## Repository structure

```
├── frontend/        React + Vite + TypeScript UI (dual network/embedded runtime)
├── backend/         FastAPI runtime: events, versioned state, DAG, semantic diff,
│                    scheduler, interruption scoring, providers, browser executor
├── tests/           Backend test suite (pytest)
├── docs/            Architecture, setup, deployment, runbook, audits, evidence
├── Dockerfile       Backend image (serves API + built frontend)
├── docker-compose.yml
├── pyproject.toml   pytest configuration
├── .gitignore       Keeps secrets, databases, caches, and builds out of Git
└── .env.example     All variables optional — runs with zero keys
```

Consolidated from two frontend prototypes and the `interruptible-agent` backend.
The frontend is based on frontend-option2 (network-or-embedded `api.ts`,
`InterruptEngine`, adaptive polling) with PIVOT branding and env-driven config;
the backend preserves all runtime modules with targeted fixes (conditional static
mount, DB version resume + fresh reset, explicit `preserved` marking,
human-usable simulated pacing, traversal containment, browser allowlist
default-deny). See `docs/` for the full architecture story.

## Quick start (no API keys needed)

Prerequisites: Python 3.10–3.12 (3.13 works; see `docs/LOCAL_AI_AGENT_SETUP.md`), Node.js 18+.

```powershell
# Backend (terminal 1) — from the repo root
pip install -r backend/requirements.txt
cd backend
$env:DB_PATH = "data/runtime.db"          # relative paths resolve against backend/
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (terminal 2) — new terminal at the repo root
cd frontend
npm install
npm run dev                                # http://localhost:5173, proxies /api → :8000
```

Or serve everything from the backend (production-style):

```powershell
cd frontend; npm install; npm run build   # → frontend/dist (single file)
cd ../backend; python -m uvicorn api.main:app --host 0.0.0.0 --port 8000
# open http://localhost:8000 — API + UI from one process
```

Copy `.env.example` to `.env` to override `PORT`, `DB_PATH`, `CORS_ORIGINS`,
`VITE_API_URL` (absolute backend URL baked into the frontend build),
`BACKEND_URL` (vite dev proxy target), or provider keys.

## How the demo goes

1. Open the app, pick *"Find laptops under ₹60,000 with 8 GB RAM on Amazon and Flipkart"*.
2. Watch task cards progress; toggle **Dev Mode** for the runtime inspector.
3. While tasks run, type *"Wait. Make that 16 GB RAM."*
4. Watch interruption detection → semantic diff → state v1→v2 → impact
   (preserved / invalidated / fenced) → recovery → completion.

Full script: `docs/DEMO_RUNBOOK.md`.

## Interface

The workspace renders the run as a stream: user request → execution plan
(task cards with tool calls, live progress, preserved/fenced/invalidated
states) → interruption notice → impact analysis (preserved / invalidated /
fenced counts plus the constraint change) → recovery note → settled summary.

- During an active search task, a small inline site preview appears
  automatically beside the execution card. It is labelled as a local
  simulation — no live site content is loaded and there is no preview
  button, modal, or other permanent control.
- **Dev Mode** (header toggle) opens the runtime inspector: state matrix,
  constraints, interruption readiness, last impact, execution graph, and a
  scrollable event timeline.
- Four themes: Warm paper, Arctic, Sakura, and Ink (soft charcoal with a
  white line field). The animated line background stays behind the reading
  column, respects `prefers-reduced-motion`, and never intercepts clicks.
- Composer: multiline prompt bar with voice dictation (browser speech
  service, permission failures surfaced inline). `/` focuses the prompt,
  `Esc` closes the inspector.
- Example prompts and the offline fallback's scripted sample results sit
  behind a Demo toggle in Dev Mode (off by default, remembered per browser).
- Browse requests (`go to <url>`) drive a real local Chromium (Playwright):
  open → capture → read, with live page captures in the preview and titles +
  text in the finished task cards. No domain allowlist (http/https only).
- Component roles: CallChip = tool commands, Strands = working state,
  ClickSpark = click feedback, SpringCheck = to-dos, VoicePill = audio
  prompts, ThoughtLine = agent working/settled status, StatusMark = task
  state glyphs, PromptBar = prompt input. Details and adaptation notes:
  `docs/21ST_COMPONENT_INTEGRATION.md`.

## API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/message` | New request `{text, is_interruption}` |
| POST | `/api/interrupt` | Interruption `{text}` |
| POST | `/api/intent` | Structured intent |
| GET | `/api/state` | Full runtime state |
| GET | `/api/events?limit=` | Event history |
| GET | `/api/graph` | Dependency graph |
| GET | `/api/snapshot` | State snapshot |
| POST | `/api/reset` | Reset runtime |
| GET | `/api/health` | Health check |
| WS | `/ws` | Live event stream (`state_snapshot` / `event` / `ping`) |

The frontend polls `/api/state` while work is active (subscription + adaptive
polling in embedded mode). WebSocket is available but not required.

## Testing

```powershell
# Backend (from the repo root)
python -m pytest tests/ -v
# Frontend (from frontend/)
npm run typecheck
npm run build
```

Evidence: `docs/TEST_EVIDENCE.md`. Honest limitations: `docs/SELF_CRITIQUE.md`.

## Documentation

| Document | Contents |
|----------|----------|
| `docs/PEEK_INSIDE.md` | Runtime internals: versioning, diff, impact, graph, fencing, scoring |
| `docs/LOCAL_AI_AGENT_SETUP.md` | Local install, run, and troubleshooting |
| `docs/FREE_SERVICES_AND_DEPLOYMENT.md` | Free providers and deployment options |
| `docs/DEMO_RUNBOOK.md` | 5-minute demo script |
| `docs/DIFFERENTIATION_AUDIT.md` | What is genuinely differentiated vs conventional |
| `docs/TEST_EVIDENCE.md` | Test results and measured performance |
| `docs/SELF_CRITIQUE.md` | What works, what is approximate, what not to claim |
| `docs/RESEARCH_AND_ARCHITECTURE_DECISIONS.md` | Alternatives investigated |
| `docs/INTEGRATION_GUIDE.md` | Original integration notes (partly stale — see below) |
| `docs/21ST_COMPONENT_INTEGRATION.md` | Rules for the upcoming 21st.dev UI pass (no components yet) |

Note: `docs/INTEGRATION_GUIDE.md` lists `UPPER_SNAKE` event names that do not
match the actual emissions in `backend/runtime/runtime.py`; trust the code.
`docker-compose.yml` in the original referenced a `frontend/` dir that did not
exist there — fixed in PIVOT.

## Design rules (do not regress)

- Local algorithms own state diff, invalidation, fencing, scheduling, recovery.
  LLMs are replaceable intelligence modules, never the source of runtime truth.
- The runtime is fully testable with zero API keys (deterministic providers).
- Never commit `.env`, `data/*.db*`, `node_modules/`, `.venv/`, or `frontend/dist/`.
- This repository tracks only the PIVOT project: the README, the source trees it
  documents, and the documentation table above. Local-only agent notes and the
  legacy prototype directories stay untracked.
