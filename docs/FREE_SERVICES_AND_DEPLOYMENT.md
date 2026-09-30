# Free Services & Deployment Guide

*Researched September 2026. Verify current pricing before deployment.*

---

## Provider Comparison

### LLM Inference (Free Tiers)

| Provider | Free Quota | Models | Card Required? | Data Usage | Recommended |
|----------|-----------|--------|---------------|------------|-------------|
| **Google Gemini** | 1,500 RPD on Flash | Gemini 2.5 Flash, Flash-Lite | No | Free-tier content used to improve Google products | ✅ Primary |
| **Groq** | 30 RPM, 1K-14.4K RPD | Llama 3.3, Qwen 3, GPT-OSS | No | Not specified | ✅ Secondary |
| **OpenRouter** | 50 RPD (unfunded) | 28+ free models | No | Varies by model | Alternative |
| **Cerebras** | $5 credit, 1M tokens/day | Llama, Qwen | No | Not specified | Alternative |

### Structured Decisions (JEV)

| Provider | Free Tier | Purpose |
|----------|-----------|---------|
| **Deterministic (local)** | Unlimited | Rule-based classification |
| **JEV/TypeSafe** | Research needed | Structured decisions |

### Speech-to-Text

| Provider | Free Tier | Notes |
|----------|-----------|-------|
| **Web Speech API** | Unlimited (browser) | Chrome/Edge only, no server needed |
| **Groq Whisper** | Included in free tier | Fast, accurate |
| **faster-whisper (local)** | Unlimited | Requires local compute |

---

## Deployment Platforms

### Frontend Hosting

| Platform | Free Tier | WebSocket? | Custom Domain? | Git Deploy? | Recommended |
|----------|-----------|------------|----------------|-------------|-------------|
| **Vercel** | Unlimited bandwidth, 100GB | N/A (static) | Yes | Yes | ✅ |
| **Netlify** | 100GB bandwidth | N/A (static) | Yes | Yes | ✅ |
| **Cloudflare Pages** | Unlimited bandwidth | N/A (static) | Yes | Yes | ✅ |

### Backend Hosting

| Platform | Free Tier | WebSocket? | Persistent Storage? | Cold Start? | Recommended |
|----------|-----------|------------|---------------------|-------------|-------------|
| **Render** | 750 hrs/month, 512MB RAM | Yes (paid plan) | Ephemeral filesystem | Yes (~30s) | ⚠️ |
| **Railway** | $5 credit/month | Yes | Ephemeral | Yes | ⚠️ |
| **Fly.io** | 3 VMs, 256MB | Yes | Volumes (limited) | Yes | ✅ |
| **Cloudflare Workers** | 100K requests/day | Yes | D1/KV (limited) | No | ✅ |

### Database

| Platform | Free Tier | Type | Persistence |
|----------|-----------|------|-------------|
| **SQLite local** | Unlimited | File-based | Depends on platform |
| **Turso (libSQL)** | 9GB, 1B rows/month | SQLite-compatible | Yes |
| **Neon** | 0.5GB, 190 compute-hours | PostgreSQL | Yes |
| **Supabase** | 500MB, 50K MAU | PostgreSQL | Yes |

---

## Recommended Stack

### For Demo/Hackathon

```
Frontend: Vercel (free)
Backend:  Render (free, accept cold starts)
Database: Local SQLite (ephemeral is OK for demo)
LLM:     Google Gemini Flash (1,500 RPD)
STT:     Browser Web Speech API (free)
```

### For Production-Grade

```
Frontend: Cloudflare Pages
Backend:  Fly.io with persistent volume
Database: Turso (SQLite-compatible, persistent)
LLM:     Gemini Flash + Groq fallback
STT:     Groq Whisper
```

---

## Deployment Steps

### 1. Frontend → Vercel

```bash
cd frontend
vercel --prod
```

Or connect GitHub repo in Vercel dashboard:
- Root directory: `frontend`
- Build command: `npm run build`
- Output: `dist`

### 2. Backend → Render

1. Connect GitHub repo
2. Root directory: `.`
3. Build command: `pip install -r requirement.txt`
4. Start command: `cd backend && python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT`
5. Environment variables: Copy from `.env.example`
6. Plan: Free

### 3. Environment Variables

Set on both platforms:
- Frontend: `VITE_API_URL` = your backend URL
- Backend: `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` (optional)

### 4. WebSocket Configuration

Ensure your backend host allows WebSocket connections:
- Render: WebSocket on paid plans only
- Fly.io: WebSocket supported on free tier
- Cloudflare Workers: WebSocket supported

---

## Cost Analysis

For a typical hackathon demo:

| Component | Estimated Cost | Notes |
|-----------|---------------|-------|
| Frontend hosting | $0 | Vercel free tier |
| Backend hosting | $0 | Render free tier (cold starts) |
| LLM inference | $0 | Gemini free tier (1,500 RPD) |
| STT | $0 | Browser Web Speech API |
| Domain | $0 | Use platform subdomain |
| **Total** | **$0** | |

---

## Important Caveats

1. **Render free tier** sleeps after 15 minutes of inactivity (30s cold start)
2. **Gemini free tier** content may be used to improve Google products
3. **SQLite on ephemeral storage** — data is lost on redeploy (fine for demo)
4. **WebSocket on Render** requires paid plan — use HTTP polling as fallback
5. **Free tiers can change** — verify before live demo
