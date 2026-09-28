# Differentiation Audit

## Comparison Against Existing Systems

### OpenAI Realtime Agents

| Aspect | OpenAI Realtime | Our System |
|--------|----------------|------------|
| Interruption handling | Voice barge-in, restart | Semantic invalidation, preserve valid work |
| State management | Implicit in model context | Explicit versioned state with fencing |
| Dependency tracking | None visible | Explicit DAG with impact analysis |
| Works without API | No | Yes (deterministic mode) |
| Transparency | Black box | Full event timeline and graph visualization |

**Gap:** OpenAI has superior NLU and voice quality. We have superior interruption semantics.

### LiveKit Agents

| Aspect | LiveKit | Our System |
|--------|---------|------------|
| Focus | Real-time communication infrastructure | Interruption-aware execution runtime |
| Interruption | VAD-based turn detection | Semantic diff + state versioning |
| Work preservation | Not addressed | Core feature |
| Browser automation | Not included | Playwright integration |

**Gap:** LiveKit is a communication framework, not an execution runtime. Complementary, not competing.

### Pipecat

| Aspect | Pipecat | Our System |
|--------|---------|------------|
| Pipeline model | Media processing pipeline | Task dependency graph |
| Interruption | Pipeline interruption | Semantic invalidation |
| State versioning | Not included | Core mechanism |
| Fencing | Not included | Prevents stale commits |

**Gap:** Pipecat is a media pipeline framework. Our runtime handles semantic work invalidation.

### LangGraph

| Aspect | LangGraph | Our System |
|--------|-----------|------------|
| Graph model | State machine for LLM workflows | Dependency DAG for task execution |
| Interruption | Human-in-the-loop breakpoints | Mid-execution semantic invalidation |
| Fencing | Not addressed | State version fencing |
| Idempotency | Manual | Built-in guard |
| Works without LLM | No | Yes |

**Gap:** LangGraph orchestrates LLM calls. Our runtime orchestrates arbitrary tool execution with semantic awareness.

### Generic Browser Agents

| Aspect | Browser Agents | Our System |
|--------|---------------|------------|
| Focus | Web task completion | Interruptible execution |
| State awareness | Page state | Semantic intent state |
| Interruption | Manual stop | Automatic invalidation |
| Work preservation | Not addressed | Core feature |

### Adaptive Interruption Systems (Academic)

| Aspect | Academic Research | Our System |
|--------|------------------|------------|
| Approach | User behavior modeling | Deterministic constraint analysis |
| Implementation | Simulation | Working prototype |
| Validation | User studies | Integration tests |
| Availability | Papers only | Open source |

---

## Our Particular Combination

No existing system combines:
1. **Semantic constraint diffing** for interruption impact analysis
2. **State version fencing** for stale result protection
3. **Dependency graph recovery frontier** for efficient replanning
4. **Local-first runtime** that works without AI services
5. **Visual proof** through execution graph dashboard

Each individual component has precedents. The combination — applied to a multimodal assistant with browser execution — is the contribution.

## Remaining Gaps

1. **NLU quality** — We rely on regex parsing; production needs real NLU
2. **Voice quality** — Web Speech API is functional but not premium
3. **Scale** — Single-instance; no distributed execution
4. **Real browser execution** — Anti-bot measures limit real-world use
5. **User studies** — No validation of interruption UX with real users
