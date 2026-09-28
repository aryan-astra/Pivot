"""Provider abstraction interfaces."""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class ProviderCapability:
    name: str
    supports_tool_calling: bool = False
    supports_structured_output: bool = False
    supports_streaming: bool = False
    supports_cancellation: bool = False
    max_context_tokens: int = 4096
    latency_ms_estimate: float = 0.0
    is_deterministic: bool = False


class LLMProvider(abc.ABC):
    """Interface for language model providers."""

    @abc.abstractmethod
    async def complete(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> dict[str, Any]:
        ...

    @abc.abstractmethod
    async def health_check(self) -> bool:
        ...

    @abc.abstractmethod
    def get_capability(self) -> ProviderCapability:
        ...


class DecisionProvider(abc.ABC):
    """Interface for structured decision providers (JEV or local)."""

    @abc.abstractmethod
    async def decide(
        self,
        decision_type: str,
        context: dict[str, Any],
        options: list[str],
    ) -> dict[str, Any]:
        ...

    @abc.abstractmethod
    async def health_check(self) -> bool:
        ...


class STTProvider(abc.ABC):
    """Interface for speech-to-text providers."""

    @abc.abstractmethod
    async def transcribe(self, audio_data: bytes, format: str = "wav") -> str:
        ...

    @abc.abstractmethod
    async def health_check(self) -> bool:
        ...


class SearchProvider(abc.ABC):
    """Interface for search providers."""

    @abc.abstractmethod
    async def search(self, query: str, max_results: int = 10) -> list[dict[str, Any]]:
        ...

    @abc.abstractmethod
    async def health_check(self) -> bool:
        ...
