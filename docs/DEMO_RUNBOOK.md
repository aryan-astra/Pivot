# Demo Runbook — 5-Minute Presentation (PIVOT)

> PIVOT paths: backend in `backend/`, frontend in `frontend/`.
> Default ports unchanged: backend `:8000`, frontend `:5173`.

## Setup (before demo)

1. Start backend: `python -m uvicorn api.main:app --host 0.0.0.0 --port 8000`
2. Start frontend: `npm run dev`
3. Open `http://localhost:5173`
4. Ensure Samsung Dev mode toggle is visible

---

## Timeline

### 00:00–00:30 — Introduction

> "This is an interruptible assistant. Its defining feature isn't the AI — it's the runtime. When you change your mind mid-execution, it doesn't restart. It determines what work remains valid and preserves it."

Show the clean interface. Mention Samsung Dev mode.

### 00:30–01:30 — First Task

Type or paste:
> "Find me laptops under ₹60,000 with 8 GB RAM on Amazon and Flipkart"

Observe:
- Tasks being created (Search Amazon, Search Flipkart, Parse, Merge, Compare)
- Task progression in real time
- **Toggle Samsung Dev mode ON**

Point out:
- State version (v1)
- Execution graph
- Constraint panel showing ram=8GB, max_price=60000

### 01:30–02:00 — The Interruption

While tasks are running, type:
> "Wait. Make that 16 GB RAM."

Watch the event banners:
1. ⚡ Interruption detected
2. Semantic diff — RAM changed
3. State v1 → v2
4. Impact analysis — X stale, Y preserved, Z fenced

### 02:00–03:00 — Recovery

Point out in Samsung Dev mode:
- **State version** jumped to v2
- **Constraints** now show ram=16GB
- **Impact panel** shows preserved vs invalidated counts
- **Event timeline** shows the full interruption pipeline
- **Graph** shows tasks in different states
- New tasks created for the 16GB search

> "The system detected that only RAM changed. The laptop category, price limit, and store targets were preserved. Only RAM-dependent work was invalidated."

### 03:00–04:00 — Samsung Dev Explanation

Walk through the dashboard sections:
1. **State panel** — version, domain, task count
2. **Constraints** — all current parameters
3. **Interruption score** — weighted deterministic algorithm
4. **Impact analysis** — exact counts of preserved/stale/fenced work
5. **Execution graph** — task dependencies and statuses
6. **Event timeline** — immutable audit trail

> "Every decision here is made by our local runtime algorithms, not by an LLM. The runtime would work identically even if all AI providers were offline."

### 04:00–05:00 — Technical Proof & Conclusion

Show the architecture principles:
1. **Cancellation is advisory** — click on a fenced task to show it completed but was rejected
2. **Validity is authoritative** — fingerprint-based staleness detection
3. **No chain-of-thought theater** — all displayed data comes from actual runtime state

Close with:
> "The models are replaceable. The runtime is the product."

---

## Backup Scenarios

If time permits, demonstrate:

**Scenario B — Location change:**
> "Find me a hotel in Bengaluru for three nights"
Then: "Wait, make it Chennai instead"

**Scenario C — Additive change:**
> "Search laptops with 16 GB RAM"
Then: "Keep everything, but I only want AMD processors"
(Preserves RAM-dependent work, adds processor filter)

**Scenario E — Clarification:**
> "Why are you checking Flipkart?"
(Main task doesn't stop, only speculative work reduces)

---

## Troubleshooting During Demo

| Issue | Fix |
|-------|-----|
| Tasks not appearing | Check backend is running on port 8000 |
| WebSocket not connecting | Refresh page; check browser console |
| Slow response | Expected — simulated task steps run ~8s so a human can interrupt mid-execution |
| No interruption banner | Type while tasks are still running |
| Reset needed | Click the reset button in header |
