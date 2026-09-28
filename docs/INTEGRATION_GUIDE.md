# INTEGRATION_GUIDE.md — For Local AI Agent

> **PIVOT errata (verified against implementation, Sep 2026):**
> - Event names below are `UPPER_SNAKE`, but `backend/runtime/runtime.py` actually
>   emits `USER_INPUT`, `INTERRUPTION_DETECTED`, `STATE_VERSION_CHANGED`, etc.
>   (see §3 list) — while the PIVOT frontend translates them to its dotted
>   stream dialect in `frontend/src/runtime/api.ts`. Trust the code.
> - Paths below say `interruptible-agent/`; in this repo the root contains
>   `backend/`, `frontend/`, `tests/`, `docs/` as siblings.
> - `vite.config.ts` in PIVOT already contains the proxy + `allowedHosts` config
>   required in §4.1, and `frontend/src/runtime/api.ts` honors `VITE_API_URL`.
> - `POST /api/reset` starts a truly fresh session (DB files are dropped);
>   `StateManager` also resumes the version counter from an existing DB so
>   restarts never hit `UNIQUE constraint failed: state_versions.version`.

This document is for an AI agent operating on the user's local Windows 11 machine.
It explains the full project, how to integrate the frontend with the backend,
what to install, and how to run everything.

---

## 1. PROJECT OVERVIEW

This is an **Interruptible Agent** — a multimodal AI assistant whose core
innovation is semantic work invalidation. When the user changes their mind
mid-execution, the runtime determines which work remains valid, which is
stale, cancels/fences obsolete work, preserves useful work, and replans.

Built for the Samsung PRISM GenAI Hackathon 2026 — Theme 05.

### Architecture

```
┌──────────────────────────────────────────┐
│          Frontend (React + Vite)          │
│  Chat │ Tasks │ Impact │ Dev Mode Panel   │
└──────────────────┬───────────────────────┘
                   │ HTTP (REST API)
                   │ Vite proxy → backend
┌──────────────────┴───────────────────────┐
│         Backend (Python / FastAPI)        │
│                                           │
│  Runtime Engine:                          │
│  ├─ Event Bus (immutable event log)       │
│  ├─ State Manager (versioned, SQLite)     │
│  ├─ Dependency Graph (DAG traversal)      │
│  ├─ Semantic Diff Engine                  │
│  ├─ Impact Analysis                       │
│  ├─ Task Scheduler (asyncio)              │
│  ├─ Interruption Scorer & Classifier      │
│  ├─ Idempotency Guard                     │
│  ├─ Browser Executor (Playwright)         │
│  └─ Provider Abstraction (LLM/STT/Decision)│
│                                           │
│  SQLite (WAL mode, versioned state)       │
└──────────────────────────────────────────┘
```

---

## 2. REPOSITORY STRUCTURE

```
interruptible-agent/
│
├── backend/                    ← Python backend (EXISTS)
│   ├── __init__.py
│   ├── requirements.txt        ← Python dependencies
│   ├── api/
│   │   └── main.py             ← FastAPI app (all endpoints)
│   ├── runtime/
│   │   ├── types.py            ← Core data types (IntentState, TaskNode, etc.)
│   │   ├── events.py           ← Event bus
│   │   ├── state.py            ← State manager (SQLite)
│   │   ├── graph.py            ← Dependency graph
│   │   ├── semantic.py         ← Semantic diff engine
│   │   ├── scheduler.py        ← Task scheduler + idempotency
│   │   ├── interruption.py     ← Interruption scorer + classifier
│   │   └── runtime.py          ← Main runtime orchestrator
│   ├── providers/
│   │   ├── __init__.py         ← Provider interfaces (LLMProvider, etc.)
│   │   └── deterministic.py    ← Deterministic providers (no API key needed)
│   └── browser/
│       └── executor.py         ← Playwright browser automation
│
├── frontend/                   ← React frontend (TO BE CREATED BY OTHER AGENT)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── hooks/
│       ├── components/
│       └── styles/
│
├── tests/                      ← Test suite (EXISTS)
│   └── unit/
│       └── test_runtime.py     ← 63 passing tests
│
├── docs/                       ← Documentation (EXISTS)
│   ├── PEEK_INSIDE.md
│   ├── DEMO_RUNBOOK.md
│   ├── SELF_CRITIQUE.md
│   ├── FREE_SERVICES_AND_DEPLOYMENT.md
│   ├── LOCAL_AI_AGENT_SETUP.md
│   ├── DIFFERENTIATION_AUDIT.md
│   ├── TEST_EVIDENCE.md
│   └── RESEARCH_AND_ARCHITECTURE_DECISIONS.md
│
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml
├── .env.example
├── .gitignore
└── README.md
```

---

## 3. BACKEND API REFERENCE

The backend runs on **port 8000** and exposes these endpoints:

### POST /api/message
Send a new user request.
```json
Request:  { "text": "Find laptops under 60000 with 8GB RAM", "is_interruption": false }
Response: { "planned_tasks": ["task_abc", ...], "execution_order": ["task_abc", ...] }
```

### POST /api/interrupt
Send an interruption while tasks are running.
```json
Request:  { "text": "Wait, make that 16 GB RAM" }
Response: {
  "action": "recovery",
  "state_version": 2,
  "diff": { "changed_fields": ["ram"], "impact_score": 0.33 },
  "impact": { "stale": [...], "preserved": [...], "fenced": [...] },
  "recovery_frontier": [...]
}
```

### GET /api/state
Get complete current runtime state.
```json
Response: {
  "run_id": "run_abc123",
  "state_version": 2,
  "intent": {
    "domain": "shopping",
    "objective": "search",
    "constraints": { "ram": "16GB", "max_price": 60000, "category": "laptop" },
    "targets": ["Amazon", "Flipkart"],
    "raw_text": "..."
  },
  "tasks": {
    "task_abc": {
      "task_id": "task_abc",
      "operation": "search_amazon",
      "label": "Search Amazon",
      "status": "completed",
      "execution_class": "interruptible",
      "reads": ["category", "max_price", "ram"],
      "state_version": 2,
      "started_at": 1234567890.123,
      "completed_at": 1234567892.456
    }
  },
  "archived_tasks": { ... },
  "graph": { "nodes": { ... }, "node_count": 6, "edge_count": 4 },
  "interruption_score": 0.0,
  "running_tasks": 0,
  "event_count": 42
}
```

### GET /api/events?limit=100
Get event history.
```json
Response: [
  {
    "event_id": "evt_abc123",
    "run_id": "run_abc",
    "timestamp": 1234567890.123,
    "event_type": "STATE_VERSION_CHANGED",
    "state_version": 2,
    "task_id": null,
    "payload": { "old_version": 1, "new_version": 2, "reason": "interruption" }
  }
]
```

Key event types the frontend should handle:
- `USER_INPUT` — user sent a message
- `INTERRUPTION_DETECTED` — interruption received
- `INTERRUPTION_CLASSIFIED` — classified as modification/clarification/etc.
- `INTENT_DIFF` — semantic diff computed (payload has `modified`, `added`, `removed`, `unchanged`)
- `STATE_VERSION_CHANGED` — state version incremented (payload has `old_version`, `new_version`)
- `IMPACT_ANALYSIS` — impact computed (payload has `stale_tasks`, `preserved_tasks`, `fenced_tasks`, `stale_count`, `preserved_count`, `fenced_count`)
- `TASK_CREATED` — new task created (payload has `operation`, `label`, `execution_class`)
- `TASK_STARTED` — task began executing
- `TASK_COMPLETED` — task finished successfully
- `TASK_CANCELLED` — task was cancelled
- `TASK_FENCED` — task result was fenced (stale)
- `TASK_FAILED` — task failed
- `STALE_RESULT_REJECTED` — stale result blocked (payload has `origin_version`, `current_version`)
- `RECOVERY_STARTED` — recovery process began
- `RECOVERY_COMPLETED` — recovery finished
- `CHECKPOINT_CREATED` — state checkpoint saved

### POST /api/reset
Reset the entire runtime to initial state.
```json
Response: { "status": "reset" }
```

### GET /api/health
Health check.
```json
Response: { "status": "ok", "runtime_active": true, "state_version": 0, "event_count": 1 }
```

---

## 4. FRONTEND INTEGRATION REQUIREMENTS

### 4.1 Vite Proxy Configuration

The frontend's `vite.config.ts` MUST proxy API requests to the backend:

```typescript
export default defineConfig({
  // ... plugins, etc.
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,     // Required for Arena/sandbox environments
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
```

### 4.2 Communication Strategy

The frontend should use **HTTP polling** to communicate with the backend:

1. **Send messages** via `POST /api/message` or `POST /api/interrupt`
2. **Poll state** via `GET /api/state` every 800ms while tasks are running
3. **Poll events** via `GET /api/events?limit=100` alongside state
4. **Stop polling** after 5 seconds of inactivity

Do NOT rely solely on WebSocket — it may not work through all proxies.
HTTP polling is the reliable fallback and primary communication method.

### 4.3 Determining Interruption vs New Request

Before sending a message, the frontend should check if tasks are currently
running. If `running_tasks > 0` or any task has `status === "running"`,
send to `/api/interrupt`. Otherwise send to `/api/message`.

### 4.4 State Updates

After each API call, poll `/api/state` and `/api/events` to update the UI:

- **Tasks**: Extract from `state.tasks` (object keyed by task_id)
- **Archived tasks**: Extract from `state.archived_tasks`
- **Constraints**: Extract from `state.intent.constraints`
- **State version**: Extract from `state.state_version`
- **Events**: Use event array for timeline and banners
- **Impact**: Look for `IMPACT_ANALYSIS` events in recent events

### 4.5 Build Output

When building for production (`npm run build`), the output goes to
`frontend/dist/`. The backend automatically serves this directory
as static files. So in production, only the backend needs to run —
it serves both the API and the frontend.

---

## 5. INSTALLATION (Windows 11, ALL LOCAL)

Everything must be installed locally in the project folder.
Do NOT install anything globally.

### 5.1 Prerequisites (check first)

Open PowerShell in the project root folder and run:

```powershell
# Check Python (need 3.10, 3.11, or 3.12)
python --version
# Expected: Python 3.10.x, 3.11.x, or 3.12.x
# If not found: Download from https://python.org/downloads/
# IMPORTANT: Check "Add Python to PATH" during installation

# Check Node.js (need 18+)
node --version
# Expected: v18.x.x or higher
# If not found: Download from https://nodejs.org/ (LTS version)

# Check npm (comes with Node)
npm --version
# Expected: 9.x.x or higher
```

### 5.2 Backend Setup

```powershell
# Navigate to project root
cd C:\path\to\interruptible-agent

# Create a LOCAL Python virtual environment
python -m venv .venv

# Activate the virtual environment
.\.venv\Scripts\Activate.ps1
# NOTE: If you get an execution policy error, run this first:
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Verify you're in the venv (should show (.venv) in prompt)
python --version

# Install Python dependencies LOCALLY (inside .venv)
pip install -r backend\requirements.txt

# Install test dependencies
pip install pytest pytest-asyncio
```

The `.venv` folder contains all Python packages locally.
Nothing is installed globally.

### 5.3 Frontend Setup

```powershell
# Navigate to frontend directory
cd C:\path\to\interruptible-agent\frontend

# Install Node dependencies LOCALLY (creates node_modules in this folder)
npm install
```

The `node_modules` folder contains all Node packages locally.
Nothing is installed globally.

### 5.4 Optional: Playwright (Browser Automation)

```powershell
# Make sure venv is activated first
cd C:\path\to\interruptible-agent
.\.venv\Scripts\Activate.ps1

# Install Playwright
pip install playwright

# Install Chromium browser LOCALLY
python -m playwright install chromium
```

Playwright downloads browsers to a local cache. This is optional —
the system works without it (uses simulated browser mode).

### 5.5 Optional: Environment Variables

Copy the example file:
```powershell
Copy-Item .env.example .env
```

All variables are OPTIONAL. The system works without any API keys
using deterministic providers.

If you want real AI:
```
# Google Gemini (free tier: 1500 requests/day)
LLM_API_KEY=your-key-here
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta
LLM_MODEL=gemini-2.5-flash

# OR Groq (free tier: 14400 requests/day)
LLM_API_KEY=your-key-here
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
```

---

## 6. RUNNING THE PROJECT

### 6.1 Start Backend

Open PowerShell terminal #1:
```powershell
cd C:\path\to\interruptible-agent

# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Set PYTHONPATH to include the backend directory
$env:PYTHONPATH = (Get-Location).Path + "\backend"

# Start the backend server
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

Expected output:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 6.2 Start Frontend

Open PowerShell terminal #2:
```powershell
cd C:\path\to\interruptible-agent\frontend

# Start the Vite dev server
npx vite --host 0.0.0.0 --port 5173
```

Expected output:
```
VITE v6.x.x  ready in xxx ms
➜  Local:   http://localhost:5173/
```

### 6.3 Open the App

Open browser to: **http://localhost:5173**

You should see the frontend with the chat interface.
The Vite proxy forwards `/api/*` requests to the backend on port 8000.

---

## 7. TESTING

### 7.1 Run Backend Tests

```powershell
cd C:\path\to\interruptible-agent
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = (Get-Location).Path + "\backend"

# Run all tests
python -m pytest tests\ -v

# Expected: 63 passed
```

### 7.2 Test API Manually

```powershell
# Health check
Invoke-RestMethod http://localhost:8000/api/health

# Send a message
Invoke-RestMethod -Method POST http://localhost:8000/api/message `
  -ContentType "application/json" `
  -Body '{"text": "Find laptops under 60000 with 8GB RAM on Amazon and Flipkart"}'

# Check state
Invoke-RestMethod http://localhost:8000/api/state

# Send interruption
Invoke-RestMethod -Method POST http://localhost:8000/api/interrupt `
  -ContentType "application/json" `
  -Body '{"text": "Wait, make that 16 GB RAM"}'

# Check state again (should show v2, ram=16GB)
Invoke-RestMethod http://localhost:8000/api/state
```

---

## 8. PRODUCTION BUILD

For deployment, build the frontend and let the backend serve it:

```powershell
# Build frontend
cd C:\path\to\interruptible-agent\frontend
npm run build
# Output goes to frontend/dist/

# Start backend (it auto-serves frontend/dist/)
cd C:\path\to\interruptible-agent
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH = (Get-Location).Path + "\backend"
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Now open http://localhost:8000 — the backend serves both API and frontend.

---

## 9. DOCKER (Alternative)

```powershell
cd C:\path\to\interruptible-agent

# Build and run with Docker Compose
docker-compose up --build
```

This starts both backend (port 8000) and frontend dev server (port 5173).

---

## 10. TROUBLESHOOTING

### Problem: "python is not recognized"
**Fix:** Python is not installed or not in PATH.
Download from https://python.org/downloads/ and check "Add to PATH".

### Problem: "node is not recognized"
**Fix:** Node.js is not installed or not in PATH.
Download from https://nodejs.org/ (LTS version).

### Problem: "Cannot activate venv — execution policy"
**Fix:** Run this in PowerShell first:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Problem: "ModuleNotFoundError: No module named 'runtime'"
**Fix:** PYTHONPATH is not set. Run:
```powershell
$env:PYTHONPATH = (Get-Location).Path + "\backend"
```

### Problem: "Address already in use" (port 8000 or 5173)
**Fix:** Another process is using the port. Kill it:
```powershell
# Find process on port 8000
netstat -ano | findstr :8000
# Kill it (replace PID with the number from above)
taskkill /PID <PID> /F
```

### Problem: Frontend shows blank page
**Fix:** Check that:
1. Backend is running on port 8000
2. Vite proxy is configured correctly in vite.config.ts
3. Browser console (F12) for JavaScript errors

### Problem: "WebSocket connection failed"
**Fix:** This is expected in some environments. The frontend should
fall back to HTTP polling automatically. Make sure the frontend
uses HTTP POST/GET for communication, not only WebSocket.

### Problem: CORS error in browser console
**Fix:** The backend allows all origins by default. If you see CORS
errors, make sure the frontend is accessing the API through the Vite
proxy (localhost:5173), not directly hitting localhost:8000.

### Problem: "pip install fails"
**Fix:** Make sure the venv is activated first:
```powershell
.\.venv\Scripts\Activate.ps1
```

### Problem: Tests fail with import errors
**Fix:** Make sure PYTHONPATH is set:
```powershell
$env:PYTHONPATH = (Get-Location).Path + "\backend"
python -m pytest tests\ -v
```

---

## 11. CHECKLIST FOR LOCAL AI AGENT

Before declaring the integration complete, verify:

- [ ] Python 3.10-3.12 is installed
- [ ] Node.js 18+ is installed
- [ ] `.venv` created in project root (not global)
- [ ] Python dependencies installed in `.venv`
- [ ] `node_modules` created in `frontend/` (not global)
- [ ] Frontend dependencies installed
- [ ] `vite.config.ts` has proxy to localhost:8000
- [ ] `vite.config.ts` has `allowedHosts: true`
- [ ] Backend starts on port 8000
- [ ] Frontend starts on port 5173
- [ ] http://localhost:5173 loads the frontend
- [ ] Clicking an example prompt sends a request to the backend
- [ ] Task cards appear showing execution progress
- [ ] Sending an interruption while tasks run triggers recovery
- [ ] Impact analysis displays preserved/invalidated/fenced counts
- [ ] Dev Mode panel shows runtime state
- [ ] Reset button clears everything
- [ ] All 63 backend tests pass
- [ ] No secrets in source code
- [ ] `.env` is in `.gitignore`
- [ ] Frontend builds successfully (`npm run build`)
- [ ] Production mode works (backend serves frontend/dist/)

---

## 12. KEY TECHNICAL DETAILS

### Task Statuses
- `pending` — queued, not started
- `running` — currently executing
- `completed` — finished successfully
- `cancelled` — cancelled by system or user
- `fenced` — completed but result rejected (stale state version)
- `invalidated` — marked stale by semantic diff
- `preserved` — confirmed valid despite interruption
- `archived` — old result kept for inspection

### Execution Classes
- `critical` — cannot be easily abandoned
- `interruptible` — can be cancelled without side effects
- `speculative` — may be cancelled aggressively
- `commit` — produces state-changing effects, needs validation

### State Version
Every intent change increments the version. Tasks carry their origin
version. Results from old versions cannot commit to newer state (fencing).

### Semantic Diff
Compares old and new intent constraints field by field:
- `added` — new constraints
- `removed` — deleted constraints
- `modified` — changed constraints (with old and new values)
- `unchanged` — preserved constraints

### Impact Analysis
For each task, checks if its `reads` fields overlap with changed fields:
- If overlap and task is running → fenced
- If overlap and task is pending → stale/invalidated
- If no overlap → preserved

---

## 13. FILES THAT ALREADY EXIST

These files are already complete and should NOT be modified:

| File | Purpose |
|------|---------|
| `backend/api/main.py` | FastAPI app with all endpoints |
| `backend/runtime/types.py` | Core data types |
| `backend/runtime/events.py` | Event bus |
| `backend/runtime/state.py` | State manager with SQLite |
| `backend/runtime/graph.py` | Dependency graph |
| `backend/runtime/semantic.py` | Semantic diff engine |
| `backend/runtime/scheduler.py` | Task scheduler + idempotency |
| `backend/runtime/interruption.py` | Interruption scorer/classifier |
| `backend/runtime/runtime.py` | Main runtime orchestrator |
| `backend/providers/__init__.py` | Provider interfaces |
| `backend/providers/deterministic.py` | Deterministic providers |
| `backend/browser/executor.py` | Playwright browser automation |
| `backend/requirements.txt` | Python dependencies |
| `tests/unit/test_runtime.py` | 63 unit/integration tests |
| `docs/*` | All documentation |
| `Dockerfile` | Docker configuration |
| `docker-compose.yml` | Docker Compose configuration |
| `pyproject.toml` | Python project configuration |
| `.env.example` | Environment variable template |
| `.gitignore` | Git ignore rules |
| `README.md` | Project README |

### FILES TO CREATE (by the other AI agent)

Everything inside `frontend/`:
- `package.json`
- `vite.config.ts` (with proxy configuration as described above)
- `tsconfig.json`
- `index.html`
- `src/main.tsx`
- `src/App.tsx`
- `src/hooks/*`
- `src/components/*`
- `src/styles/*`
- `public/favicon.svg`
