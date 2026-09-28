# Research & Architecture Decisions

## 1. Runtime Language: Python

**Chosen:** Python 3.12 with asyncio
**Alternatives:** Node.js, Go, Rust

**Reason:** Hackathon requirement specifies Python 3.10-3.12. Python's asyncio is mature, the ecosystem (FastAPI, Pydantic, Playwright) is excellent, and the team is familiar with it.

## 2. Web Framework: FastAPI

**Chosen:** FastAPI with Uvicorn
**Alternatives:** Flask, Django, Starlette

**Reason:** Native async support, automatic OpenAPI docs, WebSocket support, Pydantic integration. Perfect fit for an async runtime with real-time updates.

## 3. Persistence: SQLite

**Chosen:** SQLite with WAL mode
**Alternatives:** PostgreSQL, Redis, DuckDB, file-based JSON

**Reason:** Zero infrastructure, transactional, supports concurrent reads with WAL, sufficient for single-instance prototype. The hackathon spec mentions "smallest architecture that demonstrates required behavior."

**Rejected:** PostgreSQL (adds infrastructure), Redis (no durability), JSON files (no transactions).

## 4. Frontend: React + Vite

**Chosen:** React 18 + Vite + TypeScript
**Alternatives:** Next.js, Svelte, Vue, Solid

**Reason:** React has the largest ecosystem. Vite provides fast HMR. Next.js was rejected because this is primarily a client-side SPA with WebSocket updates, not a server-rendered app. Framer Motion for animations is well-maintained.

## 5. Animation: Framer Motion

**Chosen:** Framer Motion (Motion)
**Alternatives:** GSAP, React Spring, AutoAnimate

**Reason:** Declarative API that integrates naturally with React components. Good performance with layout animations. Supports reduced-motion preferences. GSAP was considered but has a more imperative API that's less idiomatic in React.

## 6. Browser Automation: Playwright

**Chosen:** Playwright (Python)
**Alternatives:** Selenium, Puppeteer, CDP directly

**Reason:** Best-in-class browser automation with native async support, screenshot capture, accessibility tree inspection, and network interception. Playwright 1.62 (latest) supports Chromium 143.

## 7. Provider Strategy: Gemini + Groq

**Chosen:**
- Primary LLM: Google Gemini 2.5 Flash (free: 1,500 RPD)
- Fallback LLM: Groq llama-3.3-70b (free: 14,400 RPD)
- STT: Browser Web Speech API (free, unlimited)

**Research:** Compared Gemini, Groq, OpenRouter, Cerebras, DeepSeek, Mistral in August 2026.

**Reason:** Gemini Flash has the best free tier for reasoning (1,500 RPD). Groq is fastest for structured output. Both require no credit card.

**Note:** Gemini free-tier data may be used to improve Google products (documented in UI).

## 8. Semantic Diff: Structured Constraint Comparison

**Chosen:** Field-by-field comparison of intent constraints
**Alternatives:** Embedding similarity, LLM-based comparison, AST diffing

**Reason:** Deterministic, fast (< 1ms), interpretable, and sufficient for the structured constraint model. Embedding similarity would be non-deterministic and slower. LLM comparison would defeat the "local-first" principle.

## 9. Interruption Scoring: Weighted Deterministic

**Chosen:** Weighted signal aggregation with EMA smoothing
**Alternatives:** Logistic regression, Bayesian estimate, finite-state machine

**Reason:** Transparent, debuggable, and doesn't require training data. The weights are documented and adjustable. A logistic model could be substituted later with labeled data.

## 10. Graph Structure: In-Memory DAG

**Chosen:** Adjacency list with BFS traversal
**Alternatives:** NetworkX, graph database, petri net

**Reason:** Simple, fast, and sufficient for the task dependency model. NetworkX was considered but adds a heavy dependency for basic graph operations we implement in ~100 lines.

## 11. Concurrency: asyncio + Semaphore

**Chosen:** asyncio tasks with semaphore-bounded concurrency
**Alternatives:** Thread pool, Celery, multiprocessing

**Reason:** The workload is I/O-bound (API calls, browser). asyncio is the natural fit. Semaphore provides clean concurrency bounds. Thread pool was rejected because of GIL issues with CPU work and complexity.

## 12. Event Model: Typed Events with Pydantic

**Chosen:** Dataclass events with typed payloads
**Alternatives:** Raw dicts, Protocol Buffers, JSON Schema

**Reason:** Type safety without heavy infrastructure. Pydantic validation ensures schema correctness. Protobuf was overkill for a prototype.
