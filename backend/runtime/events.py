"""Immutable event bus for the interruptible runtime."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .types import gen_id


@dataclass
class RuntimeEvent:
    event_id: str = field(default_factory=lambda: gen_id("evt_"))
    run_id: str = ""
    timestamp: float = field(default_factory=time.time)
    event_type: str = ""
    state_version: int = 0
    task_id: Optional[str] = None
    correlation_id: Optional[str] = None
    payload: dict[str, Any] = field(default_factory=dict)
    schema_version: int = 1

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "run_id": self.run_id,
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "state_version": self.state_version,
            "task_id": self.task_id,
            "correlation_id": self.correlation_id,
            "payload": self.payload,
            "schema_version": self.schema_version,
        }


class EventBus:
    """Typed event bus with subscriber management and event history."""

    def __init__(self, max_history: int = 10000):
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)
        self._global_subscribers: list[Callable] = []
        self._history: list[RuntimeEvent] = []
        self._max_history = max_history
        self._lock = asyncio.Lock()

    def subscribe(self, event_type: str, callback: Callable) -> Callable:
        self._subscribers[event_type].append(callback)
        def unsubscribe():
            self._subscribers[event_type].remove(callback)
        return unsubscribe

    def subscribe_all(self, callback: Callable) -> Callable:
        self._global_subscribers.append(callback)
        def unsubscribe():
            self._global_subscribers.remove(callback)
        return unsubscribe

    async def publish(self, event: RuntimeEvent) -> None:
        async with self._lock:
            self._history.append(event)
            if len(self._history) > self._max_history:
                self._history = self._history[-self._max_history:]

        callbacks = list(self._subscribers.get(event.event_type, []))
        callbacks.extend(self._global_subscribers)

        for cb in callbacks:
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as e:
                error_event = RuntimeEvent(
                    run_id=event.run_id,
                    event_type="ERROR",
                    state_version=event.state_version,
                    payload={"source_event": event.event_type, "error": str(e)},
                )
                self._history.append(error_event)

    def emit(self, event_type: str, run_id: str = "", state_version: int = 0,
             task_id: Optional[str] = None, correlation_id: Optional[str] = None,
             payload: Optional[dict[str, Any]] = None) -> RuntimeEvent:
        event = RuntimeEvent(
            run_id=run_id,
            event_type=event_type,
            state_version=state_version,
            task_id=task_id,
            correlation_id=correlation_id,
            payload=payload or {},
        )
        asyncio.ensure_future(self.publish(event))
        return event

    def get_history(self, event_type: Optional[str] = None,
                    run_id: Optional[str] = None,
                    limit: int = 100) -> list[RuntimeEvent]:
        events = self._history
        if event_type:
            events = [e for e in events if e.event_type == event_type]
        if run_id:
            events = [e for e in events if e.run_id == run_id]
        return events[-limit:]

    def get_events_since(self, timestamp: float,
                         event_type: Optional[str] = None) -> list[RuntimeEvent]:
        events = [e for e in self._history if e.timestamp >= timestamp]
        if event_type:
            events = [e for e in events if e.event_type == event_type]
        return events

    @property
    def event_count(self) -> int:
        return len(self._history)

    def clear_history(self) -> None:
        self._history.clear()
