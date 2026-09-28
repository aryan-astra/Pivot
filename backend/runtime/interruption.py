"""Interruption readiness scoring algorithm."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from .types import ExecutionClass, InterruptionReadiness


class InterruptionScorer:
    """
    Deterministic interruption-readiness scoring.
    
    Uses weighted signals from observable runtime state to produce
    a score between 0.0 (not ready) and 1.0 (highly ready for interruption).
    
    Algorithm: Weighted logistic-style scoring with temporal smoothing.
    """

    # Signal weights (calibrated for typical assistant interactions)
    WEIGHTS = {
        "speech_active": 0.25,
        "transcript_available": 0.20,
        "transcript_length": 0.10,
        "agent_executing": 0.10,
        "task_interruptible": 0.10,
        "speculative_running": 0.05,
        "commit_in_progress": -0.15,
        "recent_user_activity": 0.20,
        "backchannel_likelihood": -0.25,
    }

    # Temporal smoothing factor (exponential moving average)
    SMOOTHING = 0.3

    def __init__(self):
        self._smoothed_score = 0.0
        self._last_update = time.time()
        self._false_interruption_count = 0
        self._true_interruption_count = 0

    def compute(
        self,
        speech_active: bool = False,
        transcript_available: bool = False,
        transcript_length: int = 0,
        agent_executing: bool = False,
        current_task_interruptible: bool = True,
        speculative_work_running: bool = False,
        commit_in_progress: bool = False,
        recent_user_activity: bool = False,
        backchannel_likelihood: float = 0.0,
    ) -> InterruptionReadiness:
        raw_score = 0.0

        if speech_active:
            raw_score += self.WEIGHTS["speech_active"]
        if transcript_available:
            raw_score += self.WEIGHTS["transcript_available"]
        if transcript_length > 0:
            length_factor = min(transcript_length / 20.0, 1.0)
            raw_score += self.WEIGHTS["transcript_length"] * length_factor
        if agent_executing:
            raw_score += self.WEIGHTS["agent_executing"]
        if current_task_interruptible:
            raw_score += self.WEIGHTS["task_interruptible"]
        if speculative_work_running:
            raw_score += self.WEIGHTS["speculative_running"]
        if commit_in_progress:
            raw_score += self.WEIGHTS["commit_in_progress"]
        if recent_user_activity:
            raw_score += self.WEIGHTS["recent_user_activity"]

        raw_score += self.WEIGHTS["backchannel_likelihood"] * backchannel_likelihood

        # False interruption penalty (reduces sensitivity after false positives)
        if self._false_interruption_count > 0:
            penalty = min(self._false_interruption_count * 0.05, 0.2)
            raw_score -= penalty

        # True interruption boost (increases sensitivity after confirmed interruptions)
        if self._true_interruption_count > 0:
            boost = min(self._true_interruption_count * 0.03, 0.1)
            raw_score += boost

        # Clamp to [0, 1]
        raw_score = max(0.0, min(1.0, raw_score))

        # Temporal smoothing (EMA)
        now = time.time()
        dt = now - self._last_update
        if dt < 0.01:
            # First call or very rapid succession — use direct assignment
            alpha = 1.0
        else:
            alpha = 1.0 - (self.SMOOTHING ** dt)
        self._smoothed_score = alpha * raw_score + (1.0 - alpha) * self._smoothed_score
        self._last_update = now

        return InterruptionReadiness(
            score=self._smoothed_score,
            speech_active=speech_active,
            transcript_available=transcript_available,
            transcript_length=transcript_length,
            agent_executing=agent_executing,
            current_task_interruptible=current_task_interruptible,
            speculative_work_running=speculative_work_running,
            commit_in_progress=commit_in_progress,
            recent_user_activity=recent_user_activity,
            backchannel_likelihood=backchannel_likelihood,
        )

    def record_true_interruption(self) -> None:
        self._true_interruption_count += 1
        self._false_interruption_count = max(0, self._false_interruption_count - 1)

    def record_false_interruption(self) -> None:
        self._false_interruption_count += 1

    def reset(self) -> None:
        self._smoothed_score = 0.0
        self._false_interruption_count = 0
        self._true_interruption_count = 0

    @property
    def current_score(self) -> float:
        return self._smoothed_score


class InterruptionClassifier:
    """
    Classifies user interruptions into categories using deterministic rules.
    
    Categories:
    - backchannel: "uh-huh", "ok", "right" (no intent change)
    - clarification: question about current work
    - correction: fixing a parameter or constraint
    - modification: changing the task parameters
    - new_task: completely new request
    - cancellation: stop everything
    """

    BACKCHANNEL_PATTERNS = {
        "ok", "okay", "right", "uh-huh", "yeah", "yes", "mm-hmm",
        "sure", "got it", "i see", "interesting", "cool",
    }

    CLARIFICATION_STARTERS = {
        "why", "how", "what", "when", "where", "which",
        "can you explain", "what does", "how does",
    }

    CANCELLATION_PATTERNS = {
        "stop", "cancel", "never mind", "forget it", "abort",
        "don't", "no wait stop",
    }

    MODIFICATION_INDICATORS = {
        "actually", "instead", "make it", "change", "switch to",
        "wait", "no wait", "make that", "how about", "let's do",
        "i meant", "i mean", "rather",
    }

    def classify(self, transcript: str, current_intent: dict[str, Any]) -> str:
        text = transcript.lower().strip()

        if text in self.BACKCHANNEL_PATTERNS:
            return "backchannel"

        if any(text.startswith(p) for p in self.CANCELLATION_PATTERNS):
            return "cancellation"

        if any(text.startswith(s) for s in self.CLARIFICATION_STARTERS):
            if "?" in text or text.startswith("why"):
                return "clarification"

        if any(indicator in text for indicator in self.MODIFICATION_INDICATORS):
            return "modification"

        if current_intent and text:
            # If the text seems like a new complete request
            if len(text.split()) > 5 and not any(
                ind in text for ind in self.MODIFICATION_INDICATORS
            ):
                return "new_task"

        return "correction"

    def is_backchannel(self, transcript: str) -> bool:
        return self.classify(transcript, {}) == "backchannel"
