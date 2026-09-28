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
    ):
        self._event_bus = event_bus
        self._graph = graph
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._running_tasks: dict[str, asyncio.Task] = {}
        self._cancel_tokens: dict[str, asyncio.Event] = {}
        self._task_callbacks: dict[str, Callable] = {}
        self._lock = asyncio.Lock()

    async def schedule(
        self,
        task_id: str,
        coroutine_factory: Callable,
        execution_class: ExecutionClass = ExecutionClass.INTERRUPTIBLE,
        timeout: float = 30.0,
        run_id: str = "",
        state_version: int = 0,
    ) -> None:
        cancel_event = asyncio.Event()
        self._cancel_tokens[task_id] = cancel_event

        self._event_bus.emit(
            "TASK_STARTED",
            run_id=run_id,
            state_version=state_version,
            task_id=task_id,
            payload={"execution_class": execution_class.value, "timeout": timeout},
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
                            payload={"reason": "cancel_requested"},
                        )
                        return {"status": TaskStatus.CANCELLED.value}

                    self._event_bus.emit(
                        "TASK_COMPLETED",
                        run_id=run_id,
                        state_version=state_version,
                        task_id=task_id,
                        payload={"result": result},
                    )
                    return {"status": TaskStatus.COMPLETED.value, "result": result}

                except asyncio.TimeoutError:
                    self._event_bus.emit(
                        "TASK_FAILED",
                        run_id=run_id,
                        state_version=state_version,
                        task_id=task_id,
                        payload={"error": "timeout", "failure_class": FailureClass.TRANSIENT.value},
                    )
                    return {"status": TaskStatus.FAILED.value, "error": "timeout"}

                except asyncio.CancelledError:
                    self._event_bus.emit(
                        "TASK_CANCELLED",
                        run_id=run_id,
                        state_version=state_version,
                        task_id=task_id,
                        payload={"reason": "asyncio_cancelled"},
                    )
                    return {"status": TaskStatus.CANCELLED.value}

                except Exception as e:
                    self._event_bus.emit(
                        "TASK_FAILED",
                        run_id=run_id,
                        state_version=state_version,
                        task_id=task_id,
                        payload={"error": str(e), "failure_class": FailureClass.TOOL.value},
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
        if task and not task.done():
            task.cancel()
            self._event_bus.emit(
                "TASK_CANCEL_REQUESTED",
                task_id=task_id,
                payload={"reason": reason},
            )
            return True
        return False

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
