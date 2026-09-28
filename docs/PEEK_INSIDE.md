# 🫣 Peeking Inside: Technical Deep Dive

*So you want to know how the magic trick actually works?*

---

## 1. The Core Problem

When a user changes their mind mid-execution, naive systems do one of two things:

1. **Ignore the interruption** until the current work finishes (frustrating)
2. **Cancel everything** and start over (wasteful)

Neither approach is intelligent. The user's new request typically changes *some* parameters while leaving others intact. Work that depends only on unchanged parameters remains valid.

Our runtime solves this through **semantic invalidation**: determining exactly which work is affected by the change and preserving everything else.

## 2. Architecture Overview

```
User Input → Event Normalizer → STT/Text → Interruption Scorer
                                              ↓
                                     Classifier (backchannel /
                                     clarification / modification)
                                              ↓
                                    Intent State Diff
                                              ↓
                                    Impact Analysis
                                    (which tasks read
                                     changed fields?)
                                              ↓
                              ┌───────────────┼───────────────┐
                              ↓               ↓               ↓
                         Cancel Stale    Fence Running    Preserve Valid
                                              ↓
                                    State Version++
                                              ↓
                                    Recovery Frontier
                                              ↓
                                      Replan & Execute
```

## 3. State Versioning

Every meaningful semantic change increments a monotonic version counter:

```python
# State Manager
async def update_intent(self, new_intent, reason):
    self._version += 1
    new_intent.version = self._version
    # ... persist and emit event
```

Every task captures the version at launch. Every result carries its origin version. The fencing check is simple:

```python
if current_version != origin_version:
    # Result is stale. Cannot commit.
    event_bus.emit("STALE_RESULT_REJECTED", ...)
```

This is **logical fencing** — it works even when physical cancellation fails.

## 4. Semantic Diff Algorithm

The diff compares two `IntentState` objects field by field:

```python
def compute_semantic_diff(old, new):
    for key in all_constraint_keys:
        if key only in old:    → removed
        if key only in new:    → added
        if values differ:      → modified
        else:                  → unchanged
```

The result is a structured `SemanticDiff` with:
- `added`, `removed`, `modified`, `unchanged` constraint maps
- `domain_changed`, `objective_changed`, `targets_changed` flags
- `impact_score()` — 0.0 (no change) to 1.0 (domain change)

## 5. Impact Analysis

Given the diff and the task registry:

```python
def compute_impact_analysis(diff, tasks):
    changed_fields = diff.changed_fields
    
    for task in tasks:
        relevant = task.reads ∪ task.semantic_scope
        affected = relevant ∩ changed_fields
        
        if affected:
            if task.status == "running":  → fenced
            else:                         → stale
        else:
            → preserved
```

Each task declares what semantic fields it reads. If only `ram` changed, tasks reading `["category"]` are preserved while tasks reading `["ram"]` are invalidated.

## 6. Dependency Graph

A directed acyclic graph (DAG) tracks task dependencies:

```
        Search Amazon        Search Flipkart
             ↓                     ↓
        Parse Amazon          Parse Flipkart
             ↓                     ↓
              └── Merge Candidates ──┘
                      ↓
                Compare & Rank
```

Key operations:
- **`get_all_descendants(task_id)`** — BFS downstream traversal
- **`get_impacted_nodes(changed_ids)`** — all affected downstream nodes
- **`get_recovery_frontier(stale, preserved)`** — earliest resumable nodes
- **`get_execution_order()`** — topological sort

## 7. Recovery Frontier

The recovery frontier identifies the earliest nodes where new work must begin:

```python
def get_recovery_frontier(self, stale_ids, preserved_ids):
    frontier = []
    for task_id in stale_ids:
        deps = self.get_dependencies(task_id)
        if not deps or deps.issubset(preserved_ids):
            frontier.append(task_id)
    return frontier
```

A stale task whose dependencies are all preserved can be directly re-executed. A stale task whose dependencies are also stale must wait for those to complete first.

## 8. Input Fingerprinting

At task start:

```python
fingerprint = sha256({
    field: current_value 
    for field in task.reads
})
```

At result commit:

```python
current_fp = sha256({
    field: current_value 
    for field in task.reads
})

if current_fp != task.input_fingerprint:
    → result is stale, reject
```

This provides a deterministic validity check that doesn't depend on any AI model.

## 9. Interruption Readiness Scorer

A weighted scoring algorithm from observable signals:

```
score = w₁·speech_active
      + w₂·transcript_available
      + w₃·transcript_length_norm
      + w₄·agent_executing
      + w₅·task_interruptible
      + w₆·speculative_running
      + w₇·commit_in_progress  (negative)
      + w₈·recent_user_activity
      + w₉·backchannel_likelihood  (negative)
```

Weights are calibrated for typical assistant interactions. Temporal smoothing (EMA) prevents jitter. A false-interruption penalty reduces sensitivity after misclassifications.

## 10. Interruption Classifier

Deterministic rule-based classification:

| Category | Patterns | Action |
|----------|----------|--------|
| Backchannel | "ok", "right", "uh-huh" | Ignore |
| Clarification | "why", "how does" + "?" | Slow speculative work, answer |
| Correction | "actually", "make that" | Full interruption pipeline |
| Modification | "change", "instead" | Full interruption pipeline |
| Cancellation | "stop", "never mind" | Cancel all |
| New Task | Long new request | Full interruption pipeline |

## 11. Concurrency Model

- **asyncio TaskGroup** for structured concurrency
- **Semaphore** for bounded concurrent task execution
- **Cancel tokens** (asyncio.Event) for cooperative cancellation
- **Lock** for state mutations

```python
async def schedule(self, task_id, factory, ...):
    cancel_event = asyncio.Event()
    async with self._semaphore:
        result = await asyncio.wait_for(factory(cancel_event), timeout)
```

## 12. Idempotency Protocol

Every tool call has a unique key:

```python
key = sha256({tool_name, params, state_version})
```

Before execution:
1. Check if key was already executed → return cached result
2. Check if key is in-flight → wait or reject
3. Acquire, execute, record

This prevents duplicate state-changing operations even across retries.

## 13. Provider Abstraction

```python
class LLMProvider(ABC):
    async def complete(messages, tools, ...) → dict
    async def health_check() → bool
    def get_capability() → ProviderCapability
```

Implemented providers:
- `DeterministicReasoningProvider` — no API needed
- `DeterministicDecisionProvider` — rule-based
- `DeterministicSTTProvider` — scripted transcripts
- `DeterministicSearchProvider` — mock data

Real providers can be added as drop-in replacements.

## 14. Event Model

Every state change produces a typed event:

```python
RuntimeEvent(
    event_id, run_id, timestamp,
    event_type, state_version,
    task_id, correlation_id, payload
)
```

Events are immutable, persisted to SQLite, and forwarded to WebSocket subscribers.

## 15. Persistence (SQLite WAL)

```
state_versions:  version → intent + tasks + checksum
events:          event_id → type + payload + timestamp
checkpoints:     version → full snapshot
```

WAL mode enables concurrent reads during writes. Transactions ensure atomic state mutations.

## 16. Security Boundaries

- **Filesystem**: Restricted to workspace directory; path traversal blocked
- **Browser**: Domain allowlist; no auto-purchasing; read-only demo
- **API**: No secrets in frontend; all sensitive calls through backend
- **Events**: Schema validation; no arbitrary code execution

## 17. Performance Characteristics

| Operation | Measured Time |
|-----------|--------------|
| Semantic diff | < 1ms |
| Impact analysis | < 1ms |
| Graph traversal (100 nodes) | < 2ms |
| State version increment | < 5ms (with SQLite write) |
| Fencing decision | < 1ms |
| Interruption score update | < 1ms |

The deterministic runtime is orders of magnitude faster than LLM inference, so interruption handling adds negligible overhead.

## 18. What's NOT Implemented

See [SELF_CRITIQUE.md](SELF_CRITIQUE.md) for the honest list. Key gaps:

- Real browser execution on Amazon/Flipkart (anti-bot measures)
- Advanced NLU for complex intent parsing
- Production-grade auth and multi-tenancy
- Distributed deployment
- Comprehensive visual QA automation
