"""Task scheduler with concurrency management and execution classes."""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Optional

from .types import (
    ExecutionClass,
    FailureClass,
    TaskStatus,
    gen_id,
)
from .events import EventBus
from .graph import DependencyGraph


class TaskScheduler:
    """Manages task execution with concurrency limits and priorities."""

    def __init__(
        self,
        event_bus: EventBus,
        graph: DependencyGraph,
        max_concurrent: int = 10,
        on_terminal: Optional[Callable[[str, dict[str, Any]], Any]] = None,
    ):
        self._event_bus = event_bus
        self._graph = graph
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._running_tasks: dict[str, asyncio.Task] = {}
        self._cancel_tokens: dict[str, asyncio.Event] = {}
        self._task_callbacks: dict[str, Callable] = {}
        self._lock = asyncio.Lock()
        # Persists terminal statuses (cancelled/failed) to state — the
        # coroutine's own persistence only covers success/fencing paths, so
        # without this an interrupted or failed task would spin forever as
        # "running" while the scheduler reports zero running tasks.
        self._on_terminal = on_terminal

    async def _persist_terminal(self, task_id: str, fields: dict[str, Any]) -> None:
        if self._on_terminal is None:
            return
        try:
            await self._on_terminal(task_id, fields)
        except Exception:
            pass  # state writes must never mask the task outcome

    async def schedule(
        self,
        task_id: str,
        coroutine_factory: Callable,
        execution_class: ExecutionClass = ExecutionClass.INTERRUPTIBLE,
        timeout: float = 30.0,
        run_id: str = "",
        state_version: int = 0,
        label: str = "",
    ) -> None:
        cancel_event = asyncio.Event()
        self._cancel_tokens[task_id] = cancel_event

        self._event_bus.emit(
            "TASK_STARTED",
            run_id=run_id,
            state_version=state_version,
            task_id=task_id,
            payload={"execution_class": execution_class.value, "timeout": timeout, "label": label},
        )

        async def _run():
            async with self._semaphore:
                try:
                    coro = coroutine_factory(cancel_event)
                    result = await asyncio.wait_for(coro, timeout=timeout)

                    if cancel_event.is_set():
                        self._event_bus.emit(
                            "TASK_CANCELLED",
                            run_id=run_id,
                            state_version=state_version,
                            task_id=task_id,
                            payload={"reason": "cancel_requested", "label": label},
                        )
                        return {"status": TaskStatus.CANCELLED.value}

                    self._event_bus.emit(
                        "TASK_COMPLETED",
                        run_id=run_id,
                        state_version=state_version,
                        task_id=task_id,
                        payload={"result": result, "label": label},
                    )
                    return {"status": TaskStatus.COMPLETED.value, "result": result}

                except asyncio.TimeoutError:
                    await self._persist_terminal(task_id, {
                        "status": TaskStatus.FAILED.value,
                        "failed_at": time.time(),
                        "result": {"error": "timeout", "failure_class": FailureClass.TRANSIENT.value},
                    })
                    self._event_bus.emit(
                        "TASK_FAILED",
                        run_id=run_id,
                        state_version=state_version,
                        task_id=task_id,
                        payload={"error": "timeout", "failure_class": FailureClass.TRANSIENT.value, "label": label},
                    )
                    return {"status": TaskStatus.FAILED.value, "error": "timeout"}

                except asyncio.CancelledError:
                    await self._persist_terminal(task_id, {
                        "status": TaskStatus.CANCELLED.value,
                        "cancelled_at": time.time(),
                    })
                    self._event_bus.emit(
                        "TASK_CANCELLED",
                        run_id=run_id,
                        state_version=state_version,
                        task_id=task_id,
                        payload={"reason": "asyncio_cancelled", "label": label},
                    )
                    return {"status": TaskStatus.CANCELLED.value}

                except Exception as e:
                    await self._persist_terminal(task_id, {
                        "status": TaskStatus.FAILED.value,
                        "failed_at": time.time(),
                        "result": {"error": str(e)[:500]},
                    })
                    self._event_bus.emit(
                        "TASK_FAILED",
                        run_id=run_id,
                        state_version=state_version,
                        task_id=task_id,
                        payload={"error": str(e), "failure_class": FailureClass.TOOL.value, "label": label},
                    )
                    return {"status": TaskStatus.FAILED.value, "error": str(e)}

                finally:
                    async with self._lock:
                        self._running_tasks.pop(task_id, None)
                        self._cancel_tokens.pop(task_id, None)

        task = asyncio.create_task(_run())
        async with self._lock:
            self._running_tasks[task_id] = task
        return None

    async def cancel_task(self, task_id: str, reason: str = "") -> bool:
        cancel_event = self._cancel_tokens.get(task_id)
        if cancel_event:
            cancel_event.set()

        task = self._running_tasks.get(task_id)
        if not task or task.done():
            return False

        task.cancel()
        self._event_bus.emit(
            "TASK_CANCEL_REQUESTED",
            task_id=task_id,
            payload={"reason": reason},
        )
        # Cancellation is not complete until the coroutine's finally block has
        # released its slot and emitted TASK_CANCELLED. Awaiting here prevents
        # shutdown/reset from closing persistence while a worker is still unwinding.
        await asyncio.gather(task, return_exceptions=True)
        await self._event_bus.drain()
        return True

    async def cancel_tasks(self, task_ids: list[str], reason: str = "") -> dict[str, bool]:
        results = {}
        for tid in task_ids:
            results[tid] = await self.cancel_task(tid, reason)
        return results

    async def cancel_all(self, reason: str = "") -> int:
        cancelled = 0
        for task_id in list(self._running_tasks.keys()):
            if await self.cancel_task(task_id, reason):
                cancelled += 1
        await self.wait_all()
        await self._event_bus.drain()
        return cancelled

    def is_running(self, task_id: str) -> bool:
        return task_id in self._running_tasks

    @property
    def running_count(self) -> int:
        return len(self._running_tasks)

    @property
    def available_slots(self) -> int:
        return self._max_concurrent - self.running_count

    def get_running_task_ids(self) -> list[str]:
        return list(self._running_tasks.keys())

    async def wait_all(self) -> None:
        tasks = list(self._running_tasks.values())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


class IdempotencyGuard:
    """Prevents duplicate execution of the same logical operation."""

    def __init__(self):
        self._executed: dict[str, dict[str, Any]] = {}
        self._in_flight: set[str] = set()
        self._lock = asyncio.Lock()

    def make_key(self, tool_name: str, params: dict[str, Any], state_version: int) -> str:
        from .types import gen_fingerprint
        return gen_fingerprint({
            "tool": tool_name,
            "params": params,
            "state_version": state_version,
        })

    async def check_and_acquire(self, key: str) -> tuple[bool, Optional[dict[str, Any]]]:
        async with self._lock:
            if key in self._executed:
                return False, self._executed[key]
            if key in self._in_flight:
                return False, {"status": "in_flight"}
            self._in_flight.add(key)
            return True, None

    async def record_completion(self, key: str, result: dict[str, Any]) -> None:
        async with self._lock:
            self._in_flight.discard(key)
            self._executed[key] = result

    async def record_failure(self, key: str) -> None:
        async with self._lock:
            self._in_flight.discard(key)

    def has_executed(self, key: str) -> bool:
        return key in self._executed

    def get_result(self, key: str) -> Optional[dict[str, Any]]:
        return self._executed.get(key)

    def clear(self) -> None:
        self._executed.clear()
        self._in_flight.clear()
