"""Deterministic providers for credential-less testing and development."""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Optional

from . import (
    DecisionProvider,
    LLMProvider,
    ProviderCapability,
    SearchProvider,
    STTProvider,
)


class DeterministicReasoningProvider(LLMProvider):
    """Provides deterministic responses without external API calls."""

    async def complete(
        self,
        messages: list[dict[str, str]],
        tools: Optional[list[dict]] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> dict[str, Any]:
        last_message = messages[-1]["content"] if messages else ""

        if tools:
            tool_call = self._select_tool(last_message, tools)
            if tool_call:
                return {"role": "assistant", "tool_calls": [tool_call]}

        response = self._generate_response(last_message)
        return {"role": "assistant", "content": response}

    def _select_tool(self, message: str, tools: list[dict]) -> Optional[dict]:
        msg_lower = message.lower()
        for tool in tools:
            name = tool.get("function", {}).get("name", "")
            if any(kw in msg_lower for kw in name.lower().split("_")):
                return {
                    "id": f"call_{name}",
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": "{}",
                    },
                }
        return None

    def _generate_response(self, message: str) -> str:
        if "laptop" in message.lower():
            return "I'll search for laptops across your specified stores with the given constraints."
        elif "hotel" in message.lower() or "stay" in message.lower():
            return "I'll search for hotels matching your criteria."
        elif "restaurant" in message.lower() or "food" in message.lower():
            return "I'll find restaurants matching your preferences."
        elif "flight" in message.lower():
            return "I'll search for flights within your budget."
        else:
            return f"I'll help you with: {message[:100]}"

    async def health_check(self) -> bool:
        return True

    def get_capability(self) -> ProviderCapability:
        return ProviderCapability(
            name="deterministic",
            supports_tool_calling=True,
            supports_structured_output=True,
            is_deterministic=True,
            latency_ms_estimate=5.0,
        )


class DeterministicDecisionProvider(DecisionProvider):
    """Deterministic decision maker using rule-based logic."""

    async def decide(
        self,
        decision_type: str,
        context: dict[str, Any],
        options: list[str],
    ) -> dict[str, Any]:
        if decision_type == "interruption_category":
            return self._classify_interruption(context, options)
        elif decision_type == "task_routing":
            return self._route_task(context, options)
        elif decision_type == "result_reuse":
            return self._decide_reuse(context, options)
        else:
            return {"decision": options[0] if options else "unknown", "confidence": 0.5}

    def _classify_interruption(
        self, context: dict[str, Any], options: list[str]
    ) -> dict[str, Any]:
        transcript = context.get("transcript", "").lower()

        if any(w in transcript for w in ["actually", "instead", "wait", "make that", "change"]):
            return {"decision": "modification", "confidence": 0.85}
        elif any(w in transcript for w in ["why", "how", "what does", "explain"]):
            return {"decision": "clarification", "confidence": 0.80}
        elif any(w in transcript for w in ["stop", "cancel", "never mind"]):
            return {"decision": "cancellation", "confidence": 0.90}
        elif any(w in transcript for w in ["ok", "right", "uh-huh", "yeah"]):
            return {"decision": "backchannel", "confidence": 0.75}
        else:
            return {"decision": "correction", "confidence": 0.60}

    def _route_task(
        self, context: dict[str, Any], options: list[str]
    ) -> dict[str, Any]:
        domain = context.get("domain", "")
        if domain in options:
            return {"decision": domain, "confidence": 0.9}
        return {"decision": options[0] if options else "general", "confidence": 0.5}

    def _decide_reuse(
        self, context: dict[str, Any], options: list[str]
    ) -> dict[str, Any]:
        fingerprint_match = context.get("fingerprint_match", False)
        age_seconds = context.get("result_age_seconds", 0)

        if fingerprint_match and age_seconds < 300:
            return {"decision": "reuse", "confidence": 0.95}
        elif fingerprint_match and age_seconds < 600:
            return {"decision": "revalidate", "confidence": 0.70}
        else:
            return {"decision": "recompute", "confidence": 0.85}

    async def health_check(self) -> bool:
        return True


class DeterministicSTTProvider(STTProvider):
    """Simulated STT for testing."""

    _scripted_transcripts: list[str] = []
    _call_count: int = 0

    @classmethod
    def set_script(cls, transcripts: list[str]) -> None:
        cls._scripted_transcripts = transcripts
        cls._call_count = 0

    async def transcribe(self, audio_data: bytes, format: str = "wav") -> str:
        await asyncio.sleep(0.1)

        if self._scripted_transcripts:
            idx = min(self._call_count, len(self._scripted_transcripts) - 1)
            self._call_count += 1
            return self._scripted_transcripts[idx]

        return "simulated transcript"

    async def health_check(self) -> bool:
        return True


class DeterministicSearchProvider(SearchProvider):
    """Simulated search results for testing."""

    MOCK_LAPTOPS = [
        {"name": "HP Pavilion 15", "price": 54999, "ram": "8GB", "processor": "Intel i5", "store": "Amazon"},
        {"name": "Lenovo IdeaPad 3", "price": 48999, "ram": "8GB", "processor": "AMD Ryzen 5", "store": "Amazon"},
        {"name": "Dell Inspiron 14", "price": 57999, "ram": "16GB", "processor": "Intel i5", "store": "Amazon"},
        {"name": "ASUS VivoBook 15", "price": 52999, "ram": "8GB", "processor": "AMD Ryzen 5", "store": "Flipkart"},
        {"name": "Acer Aspire 5", "price": 45999, "ram": "8GB", "processor": "Intel i3", "store": "Flipkart"},
        {"name": "HP 15s", "price": 59999, "ram": "16GB", "processor": "AMD Ryzen 7", "store": "Flipkart"},
    ]

    async def search(self, query: str, max_results: int = 10) -> list[dict[str, Any]]:
        await asyncio.sleep(0.5)
        return self.MOCK_LAPTOPS[:max_results]

    async def health_check(self) -> bool:
        return True


class DeterministicIntentParser:
    """Parse user modifications deterministically."""

    URL_RE = re.compile(r"https?://[^\s'\"<>]+", re.IGNORECASE)
    BARE_DOMAIN_RE = re.compile(
        r"\b((?:[a-z0-9-]+\.)+(?:com|org|net|io|in|co|dev|app|ai|edu|gov|info|me)(?:/[^\s'\"<>]*)?)",
        re.IGNORECASE,
    )

    @staticmethod
    def extract_url(text: str) -> Optional[str]:
        """First URL in text, normalized with a scheme. None when absent."""
        m = DeterministicIntentParser.URL_RE.search(text)
        if m:
            return m.group(0).rstrip(".,;!?)")
        m = DeterministicIntentParser.BARE_DOMAIN_RE.search(text)
        if m:
            return "https://" + m.group(1).rstrip(".,;!?)")
        return None

    @staticmethod
    def url_host(url: str) -> str:
        try:
            from urllib.parse import urlsplit

            host = urlsplit(url).netloc.lower() or url
        except Exception:
            host = url
        if host.startswith("www."):
            host = host[4:]
        return host

    # Web-search phrasing: "search for X" / "search the web for X" /
    # "google X" / "look up X" — optionally led by an interrupt filler
    # ("actually search for X instead"). Such requests run against a real
    # search engine in the live browser so the capture, extract, and
    # floating preview visibly ARE the search (not a simulated request).
    SEARCH_RE = re.compile(
        r"^(?:actually\s+|wait[,\s]+|so\s+)?"
        r"(?:search(?:ing|ed)?(?:\s+the\s+web)?(?:\s+for)?|google|look(?:ing|ed)?\s+up)\s+(.+)$",
        re.IGNORECASE,
    )
    SEARCH_TAIL_RE = re.compile(r"\s+(?:instead|now|please|actually)$", re.IGNORECASE)

    @staticmethod
    def extract_search_query(text: str) -> Optional[str]:
        """The query in a web-search request; None for anything else."""
        m = DeterministicIntentParser.SEARCH_RE.match(text.strip())
        if not m:
            return None
        query = DeterministicIntentParser.SEARCH_TAIL_RE.sub("", m.group(1).strip()).strip()
        query = query.rstrip("?.!,;:")
        return query or None

    @staticmethod
    def search_url(query: str) -> str:
        """Search-engine results URL for a query (Bing renders cleanly in
        Chromium: no consent wall, no captcha, server-rendered results).

        The market/language params pin results to the English US market: a
        bare headless context gets geolocated to a random market and Bing
        serves unrelated junk pages instead of the real SERP (verified
        side-by-side: plain → junk, pinned → "42,900 results")."""
        from urllib.parse import quote_plus

        return f"https://www.bing.com/search?q={quote_plus(query)}&setmkt=en-US&setlang=en&cc=US"

    # Parameter extraction patterns
    RAM_PATTERNS = [
        r"(\d+)\s*gb\s*(?:ram|memory)",
        r"ram\s*(?:of\s*)?(\d+)\s*gb",
        r"(\d+)\s*gigabytes?\s*(?:of\s*)?(?:ram|memory)",
        r"(?:make\s+(?:that|it)\s+)?(\d+)\s*gb",
    ]

    PRICE_PATTERNS = [
        r"(?:under|below|less than|max|maximum|budget|within|up to)\s*(?:₹|rs\.?|rupees?)?\s*(\d[\d,]*)",
        r"(?:₹|rs\.?|rupees?)\s*(\d[\d,]*)",
    ]

    LOCATION_PATTERNS = [
        r"(?:in|at|near|around)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)",
        r"(?:in|at|near|around|for)\s+([A-Za-z][a-z]{3,})",
    ]

    LOCATION_SKIP_WORDS = {
        "the", "a", "an", "my", "your", "me", "us", "three", "two", "one",
        "some", "any", "laptops", "hotel", "restaurants", "restaurant",
        "flights", "flight", "trains", "train", "nights", "night",
        "days", "day", "for", "with", "from", "to", "and", "or",
    }

    DOMAIN_KEYWORDS = {
        "shopping": ["laptop", "phone", "tablet", "product", "buy", "purchase", "shop"],
        "travel": ["hotel", "flight", "train", "travel", "trip", "vacation", "booking"],
        "food": ["restaurant", "food", "eat", "dinner", "lunch", "cafe"],
    }

    STORE_PATTERNS = [
        r"(?:on|from|at)\s+(amazon|flipkart|mynta|ajio|tata cliq)",
        r"(amazon|flipkart)",
    ]

    def parse_modification(self, transcript: str, current_intent) -> Any:
        """Parse a modification transcript into a new IntentState."""
        try:
            from backend.runtime.types import IntentState
        except ImportError:
            from runtime.types import IntentState

        new_intent = IntentState(
            domain=current_intent.domain,
            objective=current_intent.objective,
            constraints=dict(current_intent.constraints),
            targets=list(current_intent.targets),
            raw_text=transcript,
        )

        text_lower = transcript.lower()

        # URL change ("now go to example.com") — re-targets browse work.
        url = self.extract_url(transcript)
        if url is not None and new_intent.constraints.get("url") != url:
            new_intent.constraints["url"] = url
            new_intent.domain = "browse"
            new_intent.targets = [self.url_host(url)]
            return new_intent

        # Web-search re-target ("actually search for X instead") — points
        # the live browser at the search engine instead. Also taken when the
        # query repeats the current one: returning identical fields here
        # skips unrelated constraint extraction (e.g. "for <word>" reading as
        # a location), so a repeated search lands as a clean no-op.
        query = self.extract_search_query(transcript)
        if query is not None:
            search_url = self.search_url(query)
            new_intent.constraints["url"] = search_url
            new_intent.constraints["query"] = query
            new_intent.domain = "browse"
            new_intent.objective = "search"
            new_intent.targets = [self.url_host(search_url)]
            return new_intent

        # Extract RAM changes
        for pattern in self.RAM_PATTERNS:
            match = re.search(pattern, text_lower)
            if match:
                new_intent.constraints["ram"] = f"{match.group(1)}GB"
                break

        # Extract price changes
        for pattern in self.PRICE_PATTERNS:
            match = re.search(pattern, text_lower)
            if match:
                price = int(match.group(1).replace(",", ""))
                new_intent.constraints["max_price"] = price
                break

        # Extract location changes
        for pattern in self.LOCATION_PATTERNS:
            match = re.search(pattern, transcript)
            if match:
                location = match.group(1).strip()
                if location.lower() not in self.LOCATION_SKIP_WORDS:
                    new_intent.constraints["destination"] = location
                    break

        # Check for domain changes
        for domain, keywords in self.DOMAIN_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                new_intent.domain = domain
                break

        # Check for store changes
        store_map = {"amazon": "Amazon", "flipkart": "Flipkart"}
        for pattern in self.STORE_PATTERNS:
            match = re.search(pattern, text_lower)
            if match:
                store_name = store_map.get(match.group(1).lower(), match.group(1))
                if store_name not in new_intent.targets:
                    new_intent.targets = [store_name]
                break

        # Check for processor preferences
        if "amd" in text_lower:
            new_intent.constraints["processor"] = "AMD"
        elif "intel" in text_lower:
            new_intent.constraints["processor"] = "Intel"

        # Check for seating preference
        if "outdoor" in text_lower:
            new_intent.constraints["outdoor_seating"] = True

        return new_intent

    def parse_intent(self, text: str) -> Any:
        """Parse a fresh user request into an IntentState."""
        try:
            from backend.runtime.types import IntentState
        except ImportError:
            from runtime.types import IntentState

        intent = IntentState(raw_text=text)
        text_lower = text.lower()

        # URL-first: "go to example.com" is browse work, not shopping/travel.
        url = self.extract_url(text)
        if url is not None:
            intent.domain = "browse"
            intent.objective = "browse"
            intent.constraints["url"] = url
            intent.targets = [self.url_host(url)]
            return intent

        # Web-search: open a real search engine in the live browser so the
        # run (capture, extract, preview) visibly IS the search.
        query = self.extract_search_query(text)
        if query is not None:
            search_url = self.search_url(query)
            intent.domain = "browse"
            intent.objective = "search"
            intent.constraints["url"] = search_url
            intent.constraints["query"] = query
            intent.targets = [self.url_host(search_url)]
            return intent

        # Detect domain
        for domain, keywords in self.DOMAIN_KEYWORDS.items():
            if any(kw in text_lower for kw in keywords):
                intent.domain = domain
                break

        if not intent.domain:
            intent.domain = "general"

        # Detect objective
        if "find" in text_lower:
            intent.objective = "search"
        elif "compare" in text_lower:
            intent.objective = "compare"
        elif "book" in text_lower:
            intent.objective = "book"
        else:
            intent.objective = "search"

        # Extract constraints
        for pattern in self.RAM_PATTERNS:
            match = re.search(pattern, text_lower)
            if match:
                intent.constraints["ram"] = f"{match.group(1)}GB"
                break

        for pattern in self.PRICE_PATTERNS:
            match = re.search(pattern, text_lower)
            if match:
                price = int(match.group(1).replace(",", ""))
                intent.constraints["max_price"] = price
                break

        # Extract location/destination
        for pattern in self.LOCATION_PATTERNS:
            match = re.search(pattern, text)
            if match:
                location = match.group(1).strip()
                if location.lower() not in self.LOCATION_SKIP_WORDS:
                    intent.constraints["destination"] = location
                    break

        if "laptop" in text_lower:
            intent.constraints["category"] = "laptop"
        elif "phone" in text_lower:
            intent.constraints["category"] = "phone"
        elif "hotel" in text_lower:
            intent.constraints["category"] = "hotel"
        elif "restaurant" in text_lower:
            intent.constraints["category"] = "restaurant"

        # Extract targets
        store_map = {"amazon": "Amazon", "flipkart": "Flipkart", "myntra": "Myntra", "ajio": "Ajio"}
        for pattern in self.STORE_PATTERNS:
            matches = re.findall(pattern, text_lower)
            for m in matches:
                store_name = store_map.get(m.lower(), m.title())
                if store_name not in intent.targets:
                    intent.targets.append(store_name)

        if not intent.targets and intent.domain == "shopping":
            intent.targets = ["Amazon", "Flipkart"]

        # Processor
        if "amd" in text_lower:
            intent.constraints["processor"] = "AMD"
        elif "intel" in text_lower:
            intent.constraints["processor"] = "Intel"

        return intent
