# Local AI Agent Setup Guide (PIVOT)

> PIVOT layout: repo root the repo root contains `backend/`, `frontend/`, `tests/`,
> `docs/` as siblings. Run backend commands from `backend/`, frontend
> commands from `frontend/`, tests from the repo root root.

This document is for another AI coding/deployment agent operating on the user's computer.

## Installation

### Required Software

1. **Python 3.10–3.12** — [python.org](https://python.org)
2. **Node.js 18+** — [nodejs.org](https://nodejs.org)
3. **Git** — [git-scm.com](https://git-scm.com)

### PowerShell (Windows)

```powershell
# Clone
git clone <repo-url>
cd Pivot

# Backend (backend has requirements.txt; venv lives in .venv)
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt

# Frontend (new terminal)
cd frontend
npm install
```

### macOS/Linux

```bash
git clone <repo-url>
cd Pivot

# Backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

# Frontend (new terminal)
cd ../frontend
npm install
```

## Environment

Copy `.env.example` to `.env` in the project root:

```
interruptible-agent/
  .env          ← your keys here
  .env.example  ← template
```

### Variables

| Variable | Required? | Purpose | Default |
|----------|-----------|---------|---------|
| `LLM_API_KEY` | No | Reasoning model API key | — (uses deterministic) |
| `LLM_BASE_URL` | No | API endpoint | — |
| `LLM_MODEL` | No | Model name | — |
| `JEV_API_KEY` | No | Decision model key | — |
| `STT_API_KEY` | No | Speech-to-text key | — |
| `DB_PATH` | No | SQLite database path | `data/runtime.db` |
| `PORT` | No | Backend port | `8000` |
| `BROWSER_HEADLESS` | No | Run browser headless | `true` |

**All keys are optional.** The system works in deterministic mode without any API keys.

## Provider Setup

### Google Gemini (Recommended for reasoning)

1. Go to [ai.google.dev](https://ai.google.dev)
2. Sign in with Google account
3. Click "Get API Key"
4. Copy the key to `LLM_API_KEY`
5. Set `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta`
6. Set `LLM_MODEL=gemini-2.5-flash`
7. Free tier: 1,500 requests/day
8. Note: Free-tier content may be used to improve Google products

### Groq (Fast inference)

1. Go to [console.groq.com](https://console.groq.com)
2. Create account
3. Generate API key
4. Copy to `LLM_API_KEY`
5. Set `LLM_BASE_URL=https://api.groq.com/openai/v1`
6. Set `LLM_MODEL=llama-3.3-70b-versatile`
7. Free tier: 30 RPM, 1,000 RPD

## Running Locally

### PowerShell

```powershell
# Terminal 1: Backend (from the repo rootbackend; imports resolve via local package layout)
cd backend
..\..\.venv\Scripts\Activate.ps1
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000
# (from the repo root root without cd: $env:PYTHONPATH = "$PWD\backend")

# Terminal 2: Frontend
cd frontend
npm run dev
```

### macOS/Linux

```bash
# Terminal 1: Backend
cd backend
source .venv/bin/activate
PYTHONPATH=$(pwd) python -m uvicorn api.main:app --host 0.0.0.0 --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev
```

Open `http://localhost:5173`

## Testing

```bash
# from the repo root root (test bootstrap adds backend/ to sys.path automatically)
python -m pytest tests/ -v

# Focused suites
python -m pytest tests/unit/ -v
python -m pytest tests/unit/test_runtime.py -v
```

## Browser Setup

```bash
pip install playwright
playwright install chromium
```

On Windows, if Playwright fails:
```powershell
python -m playwright install chromium
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `ModuleNotFoundError: No module named 'runtime'` | PYTHONPATH not set | Set `PYTHONPATH` to `backend/` |
| `Address already in use` | Port 8000 occupied | Change port or kill existing process |
| `playwright._impl._errors.Error` | Browsers not installed | Run `playwright install chromium` |
| `WebSocket connection failed` | Backend not running | Start backend first |
| `CORS error` | Frontend/Backend port mismatch | Check Vite proxy config |
| `SQLite database is locked` | Concurrent access | Ensure single writer |
| `Rate limit exceeded` | Provider quota exhausted | Wait or switch provider |
| `Microphone permission denied` | Browser permission | Allow mic in browser settings |

## Production Deployment

### GitHub

1. Create new repository
2. Push code:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <repo-url>
git push -u origin main
```

### Frontend (Vercel/Netlify)

1. Connect GitHub repo
2. Root directory: `frontend`
3. Build command: `npm run build`
4. Output directory: `dist`

### Backend (Render)

1. Connect GitHub repo
2. Root directory: `.`
3. Build command: `pip install -r backend/requirements.txt`
4. Start command: `cd backend && python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT`
5. Set environment variables from `.env.example`

### WebSocket Note

If deploying behind a reverse proxy, ensure WebSocket upgrade is supported. Render supports WebSocket on paid plans. Cloudflare Workers have WebSocket support.

## Security

- **Never commit** `.env` or any file containing API keys
- `.gitignore` already excludes `.env`
- Before pushing, run: `grep -r "API_KEY\|SECRET\|PASSWORD\|sk-\|ghp_\|AIza" . --include="*.py" --include="*.ts" --include="*.json"`
- Check Git history: `git log -p | grep -i "key\|secret\|password"`

## Troubleshooting

```bash
# Check if backend is running
curl http://localhost:8000/api/health

# Check Python version
python --version

# Check Node version
node --version

# Check if Playwright browsers are installed
python -m playwright install --dry-run

# View backend logs
# Logs appear in the terminal running uvicorn

# Reset database
rm data/runtime.db
```
