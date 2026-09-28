"""State management with versioning, checkpoints, and snapshots."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

from .types import IntentState, TaskStatus, gen_fingerprint
from .events import EventBus, RuntimeEvent


@dataclass
class StateSnapshot:
    version: int
    intent: dict[str, Any]
    tasks: dict[str, dict[str, Any]]
    timestamp: float = field(default_factory=time.time)
    checksum: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "intent": self.intent,
            "tasks": self.tasks,
            "timestamp": self.timestamp,
            "checksum": self.checksum,
        }


class StateManager:
    """Versioned state store with checkpointing and SQLite persistence."""

    def __init__(self, event_bus: EventBus, db_path: Optional[str] = None):
        self._event_bus = event_bus
        self._version = 0
        self._intent = IntentState()
        self._tasks: dict[str, dict[str, Any]] = {}
        self._archived_tasks: dict[str, dict[str, Any]] = {}
        self._checkpoints: list[StateSnapshot] = []
        self._lock = asyncio.Lock()
        self._db_path = db_path
        self._db: Optional[sqlite3.Connection] = None
        if db_path:
            self._init_db(db_path)

    def _init_db(self, db_path: str) -> None:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute("""
            CREATE TABLE IF NOT EXISTS state_versions (
                version INTEGER PRIMARY KEY,
                intent_json TEXT NOT NULL,
                tasks_json TEXT NOT NULL,
                archived_json TEXT NOT NULL,
                timestamp REAL NOT NULL,
                checksum TEXT NOT NULL
            )
        """)
        self._db.execute("""
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY,
                run_id TEXT,
                event_type TEXT NOT NULL,
                state_version INTEGER,
                task_id TEXT,
                timestamp REAL NOT NULL,
                payload_json TEXT
            )
        """)
        self._db.execute("""
            CREATE TABLE IF NOT EXISTS checkpoints (
                version INTEGER PRIMARY KEY,
                snapshot_json TEXT NOT NULL,
                timestamp REAL NOT NULL
            )
        """)
        self._db.commit()

        # Resume the version counter from prior runs so INSERTs never collide
        # with rows left by an earlier process (e.g. after /api/reset or a
        # restart reusing the same DB file).
        try:
            row = self._db.execute("SELECT MAX(version) FROM state_versions").fetchone()
            if row and row[0]:
                self._version = int(row[0])
        except Exception:
            pass

    @property
    def version(self) -> int:
        return self._version

    @property
    def intent(self) -> IntentState:
        return self._intent

    async def update_intent(self, new_intent: IntentState, reason: str = "") -> int:
        async with self._lock:
            self._version += 1
            new_intent.version = self._version
            old_intent = self._intent
            self._intent = new_intent

            if self._db:
                self._db.execute(
                    "INSERT INTO state_versions (version, intent_json, tasks_json, archived_json, timestamp, checksum) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        self._version,
                        json.dumps(self._intent_to_dict(new_intent)),
                        json.dumps(self._tasks),
                        json.dumps(self._archived_tasks),
                        time.time(),
                        new_intent.fingerprint(),
                    ),
                )
                self._db.commit()

            self._event_bus.emit(
                "STATE_VERSION_CHANGED",
                run_id=new_intent.intent_id,
                state_version=self._version,
                payload={
                    "old_version": self._version - 1,
                    "new_version": self._version,
                    "reason": reason,
                    "old_fingerprint": old_intent.fingerprint(),
                    "new_fingerprint": new_intent.fingerprint(),
                },
            )
            return self._version

    def get_task(self, task_id: str) -> Optional[dict[str, Any]]:
        return self._tasks.get(task_id)

    def get_all_tasks(self) -> dict[str, dict[str, Any]]:
        return dict(self._tasks)

    def get_archived_tasks(self) -> dict[str, dict[str, Any]]:
        return dict(self._archived_tasks)

    async def register_task(self, task_data: dict[str, Any]) -> None:
        async with self._lock:
            self._tasks[task_data["task_id"]] = task_data

    async def update_task(self, task_id: str, updates: dict[str, Any]) -> None:
        async with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].update(updates)

    async def archive_task(self, task_id: str, reason: str) -> None:
        async with self._lock:
            if task_id in self._tasks:
                task = self._tasks[task_id]
                task["status"] = TaskStatus.ARCHIVED.value
                task["archive_reason"] = reason
                task["archived_at"] = time.time()
                task["origin_state_version"] = task.get("state_version", 0)
                self._archived_tasks[task_id] = task
                del self._tasks[task_id]

    async def create_checkpoint(self) -> StateSnapshot:
        async with self._lock:
            snapshot = StateSnapshot(
                version=self._version,
                intent=self._intent_to_dict(self._intent),
                tasks=dict(self._tasks),
                checksum=self._intent.fingerprint(),
            )
            self._checkpoints.append(snapshot)

            if self._db:
                self._db.execute(
                    "INSERT OR REPLACE INTO checkpoints (version, snapshot_json, timestamp) VALUES (?, ?, ?)",
                    (self._version, json.dumps(snapshot.to_dict()), time.time()),
                )
                self._db.commit()

            self._event_bus.emit(
                "CHECKPOINT_CREATED",
                state_version=self._version,
                payload={"checkpoint_version": self._version},
            )
            return snapshot

    def get_latest_checkpoint(self) -> Optional[StateSnapshot]:
        return self._checkpoints[-1] if self._checkpoints else None

    def get_snapshot(self) -> StateSnapshot:
        return StateSnapshot(
            version=self._version,
            intent=self._intent_to_dict(self._intent),
            tasks=dict(self._tasks),
            checksum=self._intent.fingerprint(),
        )

    def get_tasks_by_status(self, status: TaskStatus) -> list[dict[str, Any]]:
        return [t for t in self._tasks.values() if t.get("status") == status.value]

    def get_tasks_reading_field(self, field_name: str) -> list[dict[str, Any]]:
        return [
            t for t in self._tasks.values()
            if field_name in t.get("reads", [])
        ]

    def _intent_to_dict(self, intent: IntentState) -> dict[str, Any]:
        return {
            "intent_id": intent.intent_id,
            "version": intent.version,
            "domain": intent.domain,
            "objective": intent.objective,
            "constraints": intent.constraints,
            "targets": intent.targets,
            "raw_text": intent.raw_text,
            "created_at": intent.created_at,
        }

    def persist_event(self, event: RuntimeEvent) -> None:
        if self._db:
            try:
                self._db.execute(
                    "INSERT OR IGNORE INTO events (event_id, run_id, event_type, state_version, task_id, timestamp, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        event.event_id,
                        event.run_id,
                        event.event_type,
                        event.state_version,
                        event.task_id,
                        event.timestamp,
                        json.dumps(event.payload),
                    ),
                )
                self._db.commit()
            except Exception:
                pass

    def close(self) -> None:
        if self._db:
            self._db.close()
