"""Core type definitions for the interruptible runtime."""

from __future__ import annotations

import enum
import hashlib
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional


class TaskStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FENCED = "fenced"
    FAILED = "failed"
    INVALIDATED = "invalidated"
    PRESERVED = "preserved"
    ARCHIVED = "archived"
    STALE = "stale"


class ExecutionClass(str, enum.Enum):
    CRITICAL = "critical"
    INTERRUPTIBLE = "interruptible"
    SPECULATIVE = "speculative"
    COMMIT = "commit"


class SideEffect(str, enum.Enum):
    READ_ONLY = "read_only"
    REVERSIBLE = "reversible"
    IRREVERSIBLE = "irreversible"


class InterruptionType(str, enum.Enum):
    BACKCHANNEL = "backchannel"
    CLARIFICATION = "clarification"
    CORRECTION = "correction"
    MODIFICATION = "modification"
    NEW_TASK = "new_task"
    CANCELLATION = "cancellation"


class FailureClass(str, enum.Enum):
    TRANSIENT = "transient"
    RATE_LIMIT = "rate_limit"
    AUTH = "auth"
    VALIDATION = "validation"
    STALE = "stale"
    CANCELLED = "cancelled"
    NETWORK = "network"
    BROWSER = "browser"
    TOOL = "tool"
    PERMANENT = "permanent"


def gen_id(prefix: str = "") -> str:
    short = uuid.uuid4().hex[:12]
    return f"{prefix}{short}" if prefix else short


def gen_fingerprint(data: dict[str, Any]) -> str:
    """Create a stable SHA-256 fingerprint of structured data."""
    canonical = _canonicalize(data)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _canonicalize(data: Any) -> str:
    if isinstance(data, dict):
        items = sorted(data.items())
        inner = ",".join(f'"{k}":{_canonicalize(v)}' for k, v in items)
        return f"{{{inner}}}"
    elif isinstance(data, (list, tuple)):
        inner = ",".join(_canonicalize(v) for v in data)
        return f"[{inner}]"
    elif isinstance(data, str):
        return f'"{data}"'
    elif isinstance(data, bool):
        return "true" if data else "false"
    elif data is None:
        return "null"
    else:
        return str(data)


@dataclass
class SemanticConstraint:
    field: str
    value: Any
    operator: str = "eq"  # eq, lt, gt, contains, in

    def matches(self, other_value: Any) -> bool:
        if self.operator == "eq":
            return self.value == other_value
        elif self.operator == "lt":
            return other_value < self.value
        elif self.operator == "gt":
            return other_value > self.value
        elif self.operator == "contains":
            return self.value in other_value
        elif self.operator == "in":
            return other_value in self.value
        return False


@dataclass
class IntentState:
    """Represents the current user intent with structured constraints."""
    intent_id: str = field(default_factory=lambda: gen_id("intent_"))
    version: int = 0
    domain: str = ""
    objective: str = ""
    constraints: dict[str, Any] = field(default_factory=dict)
    targets: list[str] = field(default_factory=list)
    raw_text: str = ""
    created_at: float = field(default_factory=time.time)

    def fingerprint(self) -> str:
        return gen_fingerprint({
            "domain": self.domain,
            "objective": self.objective,
            "constraints": self.constraints,
            "targets": sorted(self.targets),
        })

    def constraint_fingerprint(self, fields: list[str]) -> str:
        subset = {k: v for k, v in self.constraints.items() if k in fields}
        return gen_fingerprint(subset)


@dataclass
class TaskNode:
    task_id: str = field(default_factory=lambda: gen_id("task_"))
    run_id: str = ""
    operation: str = ""
    semantic_scope: list[str] = field(default_factory=list)
    reads: list[str] = field(default_factory=list)
    writes: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    dependents: list[str] = field(default_factory=list)
    state_version: int = 0
    input_fingerprint: str = ""
    status: TaskStatus = TaskStatus.PENDING
    execution_class: ExecutionClass = ExecutionClass.INTERRUPTIBLE
    interruptibility: float = 1.0
    idempotent: bool = True
    resumable: bool = False
    side_effect: SideEffect = SideEffect.READ_ONLY
    compensation: Optional[str] = None
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    result: Any = None
    result_ref: Optional[str] = None
    partial_result: Any = None
    archive_ref: Optional[str] = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 2
    timeout_seconds: float = 30.0
    label: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def is_terminal(self) -> bool:
        return self.status in (
            TaskStatus.COMPLETED,
            TaskStatus.CANCELLED,
            TaskStatus.FAILED,
            TaskStatus.INVALIDATED,
            TaskStatus.ARCHIVED,
            TaskStatus.FENCED,
        )

    def is_active(self) -> bool:
        return self.status in (TaskStatus.PENDING, TaskStatus.RUNNING)

    def duration_ms(self) -> Optional[float]:
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at) * 1000
        return None


@dataclass
class SemanticDiff:
    """Result of comparing two intent states."""
    added: dict[str, Any] = field(default_factory=dict)
    removed: dict[str, Any] = field(default_factory=dict)
    modified: dict[str, tuple[Any, Any]] = field(default_factory=dict)
    unchanged: dict[str, Any] = field(default_factory=dict)
    domain_changed: bool = False
    objective_changed: bool = False
    targets_changed: bool = False
    old_targets: list[str] = field(default_factory=list)
    new_targets: list[str] = field(default_factory=list)

    @property
    def has_changes(self) -> bool:
        return bool(self.added or self.removed or self.modified
                     or self.domain_changed or self.objective_changed
                     or self.targets_changed)

    @property
    def changed_fields(self) -> set[str]:
        fields = set(self.added.keys()) | set(self.removed.keys()) | set(self.modified.keys())
        if self.domain_changed:
            fields.add("domain")
        if self.objective_changed:
            fields.add("objective")
        if self.targets_changed:
            fields.add("targets")
        return fields

    def impact_score(self) -> float:
        """Estimate how disruptive this diff is (0.0 to 1.0)."""
        if self.domain_changed:
            return 1.0
        if self.objective_changed:
            return 0.8
        total_changes = len(self.added) + len(self.removed) + len(self.modified)
        total_fields = total_changes + len(self.unchanged)
        if total_fields == 0:
            return 0.0
        return min(total_changes / max(total_fields, 1), 1.0)


@dataclass
class InterruptionReadiness:
    """Score and signals for interruption readiness."""
    score: float = 0.0
    speech_active: bool = False
    transcript_available: bool = False
    transcript_length: int = 0
    agent_executing: bool = False
    current_task_interruptible: bool = True
    speculative_work_running: bool = False
    commit_in_progress: bool = False
    recent_user_activity: bool = False
    backchannel_likelihood: float = 0.0
    timestamp: float = field(default_factory=time.time)


@dataclass
class ExecutionTelemetry:
    timestamp: float = field(default_factory=time.time)
    run_id: str = ""
    task_id: str = ""
    event_type: str = ""
    duration_ms: float = 0.0
    state_version: int = 0
    interruption_score: float = 0.0
    execution_class: str = ""
    decision_source: str = ""
    provider: str = ""
    status: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
