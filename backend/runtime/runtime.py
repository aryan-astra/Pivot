"""Main runtime orchestrator - coordinates all subsystems."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Optional

from .types import (
    ExecutionClass,
    IntentState,
    InterruptionType,
    SemanticDiff,
    SideEffect,
    TaskStatus,
    gen_fingerprint,
    gen_id,
)
from .events import EventBus, RuntimeEvent
from .state import StateManager, StateSnapshot
from .graph import DependencyGraph
from .semantic import compute_semantic_diff, compute_impact_analysis
from .scheduler import TaskScheduler, IdempotencyGuard
from .interruption import InterruptionScorer, InterruptionClassifier


class Runtime:
    """
    Core interruptible runtime orchestrator.
    
    Coordinates: event bus, state manager, dependency graph,
    task scheduler, semantic diff, interruption handling.
    """

    def __init__(self, db_path: Optional[str] = None):
        self.event_bus = EventBus()
        self.state = StateManager(self.event_bus, db_path)
        self.graph = DependencyGraph()
        self.scheduler = TaskScheduler(self.event_bus, self.graph)
        self.idempotency = IdempotencyGuard()
        self.interruption_scorer = InterruptionScorer()
        self.classifier = InterruptionClassifier()

        self._run_id: str = ""
        self._tool_registry: dict[str, Callable] = {}
        self._ws_subscribers: list[asyncio.Queue] = []
        self._running = False

        # Wire up event forwarding to WebSocket subscribers
        self.event_bus.subscribe_all(self._forward_event)

    async def start(self) -> None:
        self._running = True
        self._run_id = gen_id("run_")
        self.event_bus.emit("RUNTIME_STARTED", run_id=self._run_id)

    async def stop(self) -> None:
        self._running = False
        await self.scheduler.cancel_all("runtime_shutdown")
        self.event_bus.emit("RUNTIME_STOPPED", run_id=self._run_id)
        await self.event_bus.drain()
        self.state.close()

    def register_tool(self, name: str, handler: Callable) -> None:
        self._tool_registry[name] = handler

    async def submit_intent(self, intent: IntentState) -> dict[str, Any]:
        """Submit a new user intent and begin execution."""
        self._run_id = intent.intent_id

        self.event_bus.emit(
            "USER_INPUT",
            run_id=self._run_id,
            state_version=self.state.version,
            payload={"raw_text": intent.raw_text, "domain": intent.domain},
        )

        old_intent = self.state.intent
        if old_intent.raw_text:
            diff = compute_semantic_diff(old_intent, intent)
            if diff.has_changes:
                return await self._handle_interruption(old_intent, intent, diff)

        version = await self.state.update_intent(intent, reason="new_intent")
        return await self._plan_and_execute(intent)

    async def handle_interruption(self, transcript: str) -> dict[str, Any]:
        """Handle a user interruption during execution."""
        classification = self.classifier.classify(
            transcript, self.state.intent.constraints
        )

        self.event_bus.emit(
            "INTERRUPTION_DETECTED",
            run_id=self._run_id,
            state_version=self.state.version,
            payload={"transcript": transcript, "classification": classification},
        )

        if classification == "backchannel":
            self.interruption_scorer.record_false_interruption()
            return {"action": "ignored", "reason": "backchannel"}

        if classification == "clarification":
            return await self._handle_clarification(transcript)

        if classification == "cancellation":
            cancelled = await self.scheduler.cancel_all("user_cancellation")
            return {"action": "cancelled", "tasks_cancelled": cancelled}

        # For modification/correction/new_task, we need to parse the new intent
        # This would normally use the LLM provider, but we handle it structurally
        new_intent = self._parse_modification(transcript, self.state.intent)
        if new_intent:
            diff = compute_semantic_diff(self.state.intent, new_intent)
            return await self._handle_interruption(self.state.intent, new_intent, diff)

        return {"action": "queued", "transcript": transcript}

    async def _handle_interruption(
        self, old_intent: IntentState, new_intent: IntentState, diff: SemanticDiff
    ) -> dict[str, Any]:
        """Core interruption handling: diff, impact, cancel, fence, replan."""
        self.interruption_scorer.record_true_interruption()

        self.event_bus.emit(
            "INTERRUPTION_CLASSIFIED",
            run_id=self._run_id,
            state_version=self.state.version,
            payload={
                "type": "modification",
                "changed_fields": list(diff.changed_fields),
                "impact_score": diff.impact_score(),
            },
        )

        self.event_bus.emit(
            "INTENT_DIFF",
            run_id=self._run_id,
            state_version=self.state.version,
            payload={
                "added": diff.added,
                "removed": diff.removed,
                "modified": {k: {"old": v[0], "new": v[1]} for k, v in diff.modified.items()},
                "unchanged": diff.unchanged,
                "domain_changed": diff.domain_changed,
                "objective_changed": diff.objective_changed,
                "targets_changed": diff.targets_changed,
            },
        )

        # Impact analysis
        impact = compute_impact_analysis(diff, self.state.get_all_tasks())

        self.event_bus.emit(
            "IMPACT_ANALYSIS",
            run_id=self._run_id,
            state_version=self.state.version,
            payload={
                "stale_count": len(impact["stale"]),
                "preserved_count": len(impact["preserved"]),
                "fenced_count": len(impact["fenced"]),
                "stale_tasks": impact["stale"],
                "preserved_tasks": impact["preserved"],
                "fenced_tasks": impact["fenced"],
            },
        )

        # Mark unaffected completed work as preserved so reuse is explicit
        # in state, events, and the UI (rather than indistinguishable "done").
        for task_id in impact["preserved"]:
            task = self.state.get_task(task_id)
            if task and task.get("status") == TaskStatus.COMPLETED.value:
                await self.state.update_task(task_id, {
                    "status": TaskStatus.PRESERVED.value,
                    "preserved_at": time.time(),
                })
                self.event_bus.emit(
                    "TASK_PRESERVED",
                    run_id=self._run_id,
                    task_id=task_id,
                    payload={"label": task.get("label", "")},
                )

        # Cancel stale tasks
        cancel_results = await self.scheduler.cancel_tasks(
            impact["stale"], reason="semantic_invalidation"
        )

        # Archive stale completed tasks
        for task_id in impact["stale"]:
            task = self.state.get_task(task_id)
            if task and task.get("status") == "completed":
                await self.state.archive_task(task_id, "semantic_invalidation")

        # Fence running tasks that will produce stale results
        for task_id in impact["fenced"]:
            await self.state.update_task(task_id, {
                "status": TaskStatus.FENCED.value,
                "fenced_at": time.time(),
            })
            self.event_bus.emit(
                "TASK_FENCED",
                run_id=self._run_id,
                task_id=task_id,
                payload={"reason": "state_version_mismatch"},
            )

        # Update state version
        version = await self.state.update_intent(new_intent, reason="interruption")

        # Create checkpoint
        await self.state.create_checkpoint()

        # Replan from recovery frontier
        stale_set = set(impact["stale"])
        preserved_set = set(impact["preserved"])
        frontier = self.graph.get_recovery_frontier(stale_set, preserved_set)

        self.event_bus.emit(
            "RECOVERY_STARTED",
            run_id=self._run_id,
            state_version=version,
            payload={
                "recovery_frontier": frontier,
                "preserved_count": len(preserved_set),
                "invalidated_count": len(stale_set),
            },
        )

        # Execute new plan
        result = await self._plan_and_execute(new_intent)

        self.event_bus.emit(
            "RECOVERY_COMPLETED",
            run_id=self._run_id,
            state_version=self.state.version,
            payload=result,
        )

        return {
            "action": "recovery",
            "state_version": version,
            "diff": {
                "changed_fields": list(diff.changed_fields),
                "impact_score": diff.impact_score(),
            },
            "impact": {
                "stale": impact["stale"],
                "preserved": impact["preserved"],
                "fenced": impact["fenced"],
            },
            "recovery_frontier": frontier,
        }

    async def _handle_clarification(self, transcript: str) -> dict[str, Any]:
        """Handle clarification without destroying work."""
        self.event_bus.emit(
            "CLARIFICATION_RECEIVED",
            run_id=self._run_id,
            state_version=self.state.version,
            payload={"transcript": transcript},
        )

        # Reduce speculative execution
        speculative_ids = [
            tid for tid in self.scheduler.get_running_task_ids()
            if self.graph.get_node(tid) and
            self.graph.get_node(tid).get("execution_class") == ExecutionClass.SPECULATIVE.value
        ]

        if speculative_ids:
            await self.scheduler.cancel_tasks(speculative_ids, "clarification_reduction")

        return {
            "action": "clarification",
            "speculative_reduced": len(speculative_ids),
            "critical_preserved": True,
        }

    async def _plan_and_execute(self, intent: IntentState) -> dict[str, Any]:
        """Create execution plan and begin task execution."""
        plan = self._create_plan(intent)

        for task_def in plan:
            task_id = task_def["task_id"]
            self.graph.add_node(task_id, {
                "operation": task_def["operation"],
                "label": task_def.get("label", task_def["operation"]),
                "execution_class": task_def.get("execution_class", ExecutionClass.INTERRUPTIBLE.value),
                "reads": task_def.get("reads", []),
            })

            for dep_id in task_def.get("dependencies", []):
                self.graph.add_edge(dep_id, task_id)

            task_data = {
                "task_id": task_id,
                "run_id": self._run_id,
                "operation": task_def["operation"],
                "reads": task_def.get("reads", []),
                "writes": task_def.get("writes", []),
                "semantic_scope": task_def.get("semantic_scope", []),
                "dependencies": task_def.get("dependencies", []),
                "state_version": self.state.version,
                "input_fingerprint": gen_fingerprint({
                    k: intent.constraints.get(k) for k in task_def.get("reads", [])
                }),
                "status": TaskStatus.PENDING.value,
                "execution_class": task_def.get("execution_class", ExecutionClass.INTERRUPTIBLE.value),
                "label": task_def.get("label", task_def["operation"]),
                "created_at": time.time(),
            }
            await self.state.register_task(task_data)

            self.event_bus.emit(
                "TASK_CREATED",
                run_id=self._run_id,
                state_version=self.state.version,
                task_id=task_id,
                payload={
                    "operation": task_def["operation"],
                    "label": task_def.get("label", ""),
                    "execution_class": task_def.get("execution_class", ""),
                },
            )

        # Execute in topological order
        exec_order = self.graph.get_execution_order(
            {t["task_id"] for t in plan}
        )

        for task_id in exec_order:
            task = self.state.get_task(task_id)
            if task and task["status"] == TaskStatus.PENDING.value:
                await self._execute_task(task)

        return {"planned_tasks": [t["task_id"] for t in plan], "execution_order": exec_order}

    def _create_plan(self, intent: IntentState) -> list[dict[str, Any]]:
        """Create an execution plan based on intent."""
        plan = []

        if intent.domain in ("shopping", "search", "research"):
            # Create search tasks for each target
            for i, target in enumerate(intent.targets):
                search_id = gen_id("task_")
                plan.append({
                    "task_id": search_id,
                    "operation": f"search_{target.lower()}",
                    "label": f"Search {target}",
                    "reads": ["category", "max_price", "ram", "processor"],
                    "semantic_scope": [target.lower()],
                    "execution_class": ExecutionClass.INTERRUPTIBLE.value,
                    "dependencies": [],
                })

                parse_id = gen_id("task_")
                plan.append({
                    "task_id": parse_id,
                    "operation": f"parse_{target.lower()}_results",
                    "label": f"Parse {target} Results",
                    "reads": ["category", "ram"],
                    "semantic_scope": [target.lower()],
                    "execution_class": ExecutionClass.INTERRUPTIBLE.value,
                    "dependencies": [search_id],
                })

            # Merge results
            if len(intent.targets) > 1:
                merge_id = gen_id("task_")
                parse_ids = [t["task_id"] for t in plan if "parse" in t["operation"]]
                plan.append({
                    "task_id": merge_id,
                    "operation": "merge_candidates",
                    "label": "Merge Candidates",
                    "reads": list(intent.constraints.keys()),
                    "execution_class": ExecutionClass.CRITICAL.value,
                    "dependencies": parse_ids,
                })

                compare_id = gen_id("task_")
                plan.append({
                    "task_id": compare_id,
                    "operation": "compare_candidates",
                    "label": "Compare & Rank",
                    "reads": list(intent.constraints.keys()),
                    "execution_class": ExecutionClass.COMMIT.value,
                    "dependencies": [merge_id],
                })

        elif intent.domain in ("travel", "hotel", "flight"):
            for target in intent.targets:
                search_id = gen_id("task_")
                plan.append({
                    "task_id": search_id,
                    "operation": f"search_{target.lower()}",
                    "label": f"Search {target}",
                    "reads": ["destination", "check_in", "check_out", "guests", "max_price"],
                    "semantic_scope": [target.lower()],
                    "execution_class": ExecutionClass.INTERRUPTIBLE.value,
                    "dependencies": [],
                })

        else:
            # Generic plan
            task_id = gen_id("task_")
            plan.append({
                "task_id": task_id,
                "operation": "execute_request",
                "label": "Execute Request",
                "reads": list(intent.constraints.keys()),
                "execution_class": ExecutionClass.INTERRUPTIBLE.value,
                "dependencies": [],
            })

        return plan

    async def _execute_task(self, task: dict[str, Any]) -> None:
        """Execute a single task with fencing validation."""
        task_id = task["task_id"]
        operation = task["operation"]

        handler = self._tool_registry.get(operation)
        if not handler:
            handler = self._default_task_handler

        async def task_coroutine(cancel_event: asyncio.Event):
            await self.state.update_task(task_id, {
                "status": TaskStatus.RUNNING.value,
                "started_at": time.time(),
            })

            # Simulate work with cancellation awareness
            result = await handler(task, cancel_event)

            # Validate state version before committing
            current_version = self.state.version
            origin_version = task.get("state_version", 0)

            if current_version != origin_version:
                self.event_bus.emit(
                    "STALE_RESULT_REJECTED",
                    run_id=self._run_id,
                    task_id=task_id,
                    state_version=current_version,
                    payload={
                        "origin_version": origin_version,
                        "current_version": current_version,
                        "result": str(result)[:200],
                    },
                )
                await self.state.update_task(task_id, {
                    "status": TaskStatus.FENCED.value,
                    "completed_at": time.time(),
                })
                return {"status": "fenced", "origin_version": origin_version}

            await self.state.update_task(task_id, {
                "status": TaskStatus.COMPLETED.value,
                "completed_at": time.time(),
                "result": result,
            })
            return result

        exec_class = ExecutionClass(task.get("execution_class", "interruptible"))
        await self.scheduler.schedule(
            task_id=task_id,
            coroutine_factory=task_coroutine,
            execution_class=exec_class,
            timeout=task.get("timeout_seconds", 30.0),
            run_id=self._run_id,
            state_version=self.state.version,
        )

    async def _default_task_handler(
        self, task: dict[str, Any], cancel_event: asyncio.Event
    ) -> dict[str, Any]:
        """Default task handler that simulates work.

        Simulated steps last ~8s so a human can interrupt mid-execution (the
        product's core interaction). Cancellation is cooperative: each 0.5s
        step checks the cancel token. Real tool handlers replace this timing.
        """
        duration = task.get("metadata", {}).get("duration", 8.0)
        steps = int(duration * 2)

        for i in range(steps):
            if cancel_event.is_set():
                return {"status": "cancelled"}
            await asyncio.sleep(0.5)
            self.event_bus.emit(
                "TASK_PROGRESS",
                run_id=self._run_id,
                task_id=task["task_id"],
                payload={"progress": (i + 1) / steps, "step": i + 1},
            )

        return {
            "status": "completed",
            "operation": task["operation"],
            "simulated": True,
        }

    def _parse_modification(self, transcript: str, current_intent: IntentState) -> Optional[IntentState]:
        """Parse a modification from user transcript into new intent state."""
        try:
            from providers.deterministic import DeterministicIntentParser
        except ImportError:
            from backend.providers.deterministic import DeterministicIntentParser  # type: ignore[no-redef]
        parser = DeterministicIntentParser()
        return parser.parse_modification(transcript, current_intent)

    async def _forward_event(self, event: RuntimeEvent) -> None:
        """Forward events to WebSocket subscribers."""
        self.state.persist_event(event)
        for queue in self._ws_subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def subscribe_ws(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._ws_subscribers.append(queue)
        return queue

    def unsubscribe_ws(self, queue: asyncio.Queue) -> None:
        if queue in self._ws_subscribers:
            self._ws_subscribers.remove(queue)

    def get_runtime_state(self) -> dict[str, Any]:
        """Get complete runtime state for dashboard."""
        return {
            "run_id": self._run_id,
            "state_version": self.state.version,
            "intent": {
                "domain": self.state.intent.domain,
                "objective": self.state.intent.objective,
                "constraints": self.state.intent.constraints,
                "targets": self.state.intent.targets,
                "raw_text": self.state.intent.raw_text,
            },
            "tasks": self.state.get_all_tasks(),
            "archived_tasks": self.state.get_archived_tasks(),
            "graph": self.graph.to_dict(),
            "interruption_score": self.interruption_scorer.current_score,
            "running_tasks": self.scheduler.running_count,
            "event_count": self.event_bus.event_count,
        }
