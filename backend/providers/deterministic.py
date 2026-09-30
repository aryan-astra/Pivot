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

    # ------------------------------------------------------------- site search
    #
    # "search for Elon Musk on Wikipedia" asks the agent to search a specific
    # site. Handing the literal string "elon musk on wikipedia" to a general
    # engine returns pages *about searching Wikipedia*, not about Elon Musk —
    # which is what the user was shown. Each entry names a site a user can
    # mention and that site's own search endpoint, so the live browser lands on
    # real results for the subject.
    SITE_SEARCH: dict[str, dict[str, Any]] = {
        "wikipedia": {
            "name": "Wikipedia",
            "aliases": ("wikipedia.org", "wikipedia", "wiki"),
            "hosts": ("wikipedia.org",),
            "template": "https://en.wikipedia.org/w/index.php?search={q}",
        },
        "amazon": {
            "name": "Amazon",
            "aliases": ("amazon.in", "amazon.com", "amazon"),
            "hosts": ("amazon.in", "amazon.com"),
            "template": "https://www.amazon.in/s?k={q}",
        },
        "flipkart": {
            "name": "Flipkart",
            "aliases": ("flipkart.com", "flipkart"),
            "hosts": ("flipkart.com",),
            "template": "https://www.flipkart.com/search?q={q}",
        },
        "youtube": {
            "name": "YouTube",
            "aliases": ("youtube.com", "youtube", "yt"),
            "hosts": ("youtube.com",),
            "template": "https://www.youtube.com/results?search_query={q}",
        },
        "reddit": {
            "name": "Reddit",
            "aliases": ("reddit.com", "reddit"),
            "hosts": ("reddit.com",),
            "template": "https://www.reddit.com/search/?q={q}",
        },
        "imdb": {
            "name": "IMDb",
            "aliases": ("imdb.com", "imdb"),
            "hosts": ("imdb.com",),
            "template": "https://www.imdb.com/find/?q={q}",
        },
        "github": {
            "name": "GitHub",
            "aliases": ("github.com", "github"),
            "hosts": ("github.com",),
            "template": "https://github.com/search?q={q}",
        },
        "linkedin": {
            "name": "LinkedIn",
            "aliases": ("linkedin.com", "linkedin"),
            "hosts": ("linkedin.com",),
            "template": "https://www.linkedin.com/search/results/all/?keywords={q}",
        },
        "google": {
            "name": "Google",
            "aliases": ("google.com", "google"),
            "hosts": ("google.com", "google.co.in"),
            "template": "https://www.google.com/search?q={q}",
        },
    }

    @classmethod
    def site_name(cls, site_key: Optional[str]) -> Optional[str]:
        site = cls.SITE_SEARCH.get(site_key or "")
        return site["name"] if site else None

    @classmethod
    def extract_site_key(cls, text: str) -> Optional[str]:
        """Which site the user named, by alias (wikipedia, wiki, amazon, …)."""
        low = text.lower()
        for key, site in cls.SITE_SEARCH.items():
            for alias in site["aliases"]:
                if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", low):
                    return key
        return None

    @classmethod
    def site_key_for_url(cls, url: str) -> Optional[str]:
        """Which site a URL belongs to, so 'go to wikipedia.com and search X'
        resolves the same way as 'search Wikipedia for X'."""
        if not url:
            return None
        host = cls.url_host(url)
        for key, site in cls.SITE_SEARCH.items():
            for h in site["hosts"]:
                if host == h or host.endswith("." + h):
                    return key
        return None

    @classmethod
    def strip_site_mention(cls, query: str, site_key: str) -> str:
        """Remove the site word and its preposition from the query itself."""
        site = cls.SITE_SEARCH[site_key]
        out = query
        for alias in site["aliases"]:
            out = re.sub(
                rf"(?:^|\s)(?:on|in|at|from|via|within|inside)\s+(?:the\s+)?{re.escape(alias)}(?![a-z0-9])",
                " ",
                out,
                flags=re.IGNORECASE,
            )
            out = re.sub(
                rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", " ", out, flags=re.IGNORECASE
            )
        # Removing the site leaves its preposition behind, in whichever
        # direction it sat: "elon musk in" and "for elon musk" both have to end
        # up as "elon musk". Collapse spaces first so the anchors see the
        # fragment's first character.
        out = re.sub(r"\s{2,}", " ", out).strip()
        out = re.sub(r"^(?:for|on|in|at|from|about|of)\s+", "", out, flags=re.IGNORECASE)
        out = re.sub(
            r"\s+(?:on|in|at|from|via|within|inside|for|about)$", "", out, flags=re.IGNORECASE
        )
        return re.sub(r"\s{2,}", " ", out).strip(" -—,")

    # Stores match on product text, so a price framing has to come off before
    # the query reaches them.
    COMMERCE_SITES = frozenset({"amazon", "flipkart"})

    @classmethod
    def strip_price_frame(cls, query: str) -> str:
        """'the price of X' -> 'X' for a store search.

        Searching a store for the literal phrase "the price of" returns
        accessories and comparison pages rather than the product.
        """
        out = re.sub(
            r"^(?:what(?:'s| is| are)\s+)?(?:the\s+|current\s+|latest\s+|best\s+)?"
            r"(?:price|prices|cost|costs)\s+(?:of|for)\s+",
            "",
            query,
            flags=re.IGNORECASE,
        )
        return out.strip() or query

    # A search verb anywhere in the sentence, not only at the start. "Go to
    # wikipedia.com and search for X" is still a search — the anchored
    # SEARCH_RE above cannot see it because the sentence begins with "go to".
    # "find" is included because the shopping/travel/food guard in the callers
    # is what keeps "find laptops under …" on the comparison plan.
    SEARCH_VERB_RE = re.compile(
        r"(?:search(?:ing|ed)?(?:\s+the\s+web)?(?:\s+for)?|google|look\s+up|find)\s+(.+)$",
        re.IGNORECASE,
    )

    # A question is a search with the interrogative still attached. Without
    # this, "what is the price of Samsung Galaxy S26" carries no search verb,
    # falls through every branch, and lands on a generic plan that answers
    # nothing — the same failure as a bogus result, one step earlier.
    QUESTION_RE = re.compile(
        r"^(?:"
        r"what(?:'s| is| are| was| were)\s+(?:the\s+)?(?:current\s+|latest\s+|newest\s+)?"
        r"(?:price|prices|cost|costs|value|release date|specs|specifications|details|"
        r"net worth|rating|reviews?)\s+(?:of|for)\s+"
        r"|who(?:'s| is| was| are)\s+"
        r"|how much (?:does|do|is|are)\s+"
        r"|(?:what|when|where)\s+(?:is|are|was|were|does|do)\s+"
        r")(?P<subj>.+)$",
        re.IGNORECASE,
    )

    @classmethod
    def extract_question(cls, text: str) -> Optional[str]:
        """The subject of an interrogative request, with the question stripped."""
        m = cls.QUESTION_RE.match(text.strip())
        if not m:
            return None
        subj = m.group("subj").strip()
        # "how much does a Model 3 cost" — the verb is at the end here
        subj = re.sub(
            r"\s+(?:cost|costs|weigh|weighs|last|sell for|go for)\s*$", "", subj, flags=re.IGNORECASE
        )
        subj = subj.strip().rstrip("?.!,;")
        return subj or None

    @classmethod
    def extract_search_request(cls, text: str) -> tuple[Optional[str], Optional[str]]:
        """The (subject, site) a user is asking a site for.

        Handles both orders — "search for X on Wikipedia" and "search Wikipedia
        for X" — and a domain named in the same sentence, which is the shape
        that previously navigated to the site homepage and stopped there.
        """
        stripped = text.strip()
        site = cls.extract_site_key(stripped) or cls.site_key_for_url(
            cls.extract_url(stripped) or ""
        )
        query = cls.extract_search_query(stripped)
        if query is None:
            m = cls.SEARCH_VERB_RE.search(stripped)
            if m:
                query = m.group(1).strip()
        if query is None:
            query = cls.extract_question(stripped)
        if site and query:
            query = cls.strip_site_mention(query, site)
            if site in cls.COMMERCE_SITES:
                query = cls.strip_price_frame(query)
        query = cls.SEARCH_TAIL_RE.sub("", (query or "").strip()).strip().rstrip("?.!,;:")
        return (query or None), site

    @classmethod
    def search_url_for(cls, query: str, site_key: Optional[str]) -> str:
        """A named site searches itself; otherwise a general engine."""
        from urllib.parse import quote_plus

        site = cls.SITE_SEARCH.get(site_key or "")
        if site:
            return site["template"].format(q=quote_plus(query))
        return cls.search_url(query)

    @classmethod
    def has_domain_hint(cls, text: str) -> bool:
        """True when the request is really shopping/travel/food work.

        Those requests build the multi-store comparison plan; treating them as
        web searches would replace the product's core demo with a Bing SERP.
        """
        return cls.has_domain_keyword(text)

    @classmethod
    def has_domain_keyword(cls, text: str) -> bool:
        """Any shopping/travel/food keyword present, matched on a word START.

        A start boundary only. These keywords are prefixes of the words that
        follow them ("laptops", "hotels", "products"), so a trailing boundary
        would stop working — but a leading one is what stops "iphone" from
        reading as the shopping keyword "phone".
        """
        low = text.lower()
        return any(
            re.search(rf"(?<![a-z0-9]){re.escape(kw)}", low)
            for kws in cls.DOMAIN_KEYWORDS.values()
            for kw in kws
        )

    @classmethod
    def match_domain(cls, text: str) -> Optional[str]:
        """The shopping/travel/food domain this text is about, if any."""
        low = text.lower()
        for domain, keywords in cls.DOMAIN_KEYWORDS.items():
            for kw in keywords:
                if re.search(rf"(?<![a-z0-9]){re.escape(kw)}", low):
                    return domain
        return None

    # "change Elon Musk to Sam Altman" / "replace X with Y" / "make it Y" —
    # an interruption that renames the *subject* of a search in flight rather
    # than restating the request. The user is naming the new thing to look up,
    # so the trailing value is the subject, not the thing being replaced.
    SUBJECT_REPLACEMENT_RE = re.compile(
        r"^(?:actually\s+|wait,?\s+|no,?\s+|so\s+|ok,?\s+|hmm,?\s+)?"
        r"(?:"
        r"(?:change|replace|switch|swap|substitute|rename|update|make)\s+"
        r".{1,60}?\s+(?:to|with|into)\s+"
        r"|make\s+it\s+"
        r"|it\s+should\s+be\s+"
        r"|instead(?:\s+of\s+.{1,60}?\s+)?(?:use|search\s+for|look\s+up|try)\s+"
        r"|(?:use|try|go\s+with)\s+"
        r")(?P<subj>.+)$",
        re.IGNORECASE,
    )

    def is_constraint_change(self, text: str) -> bool:
        """True when the transcript states a RAM/price value.

        'make it 16 GB RAM' is a constraint change, not a new subject, and must
        never be read as one.
        """
        low = text.lower()
        if any(re.search(p, low) for p in self.RAM_PATTERNS):
            return True
        return any(re.search(p, low) for p in self.PRICE_PATTERNS)

    @classmethod
    def extract_subject_replacement(cls, text: str) -> Optional[str]:
        """The new subject of an in-flight search, when the transcript names one."""
        m = cls.SUBJECT_REPLACEMENT_RE.match(text.strip())
        if not m:
            return None
        subj = m.group("subj").strip().rstrip("?.!,;")
        subj = re.sub(r"^(?:search\s+for|look\s+up)\s+", "", subj, flags=re.IGNORECASE)
        # "use Sam Altman instead" puts the marker after the subject
        subj = re.sub(r"\s+instead$", "", subj, flags=re.IGNORECASE)
        if len(subj) < 2 or subj.isdigit():
            return None
        return subj.strip()

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

        # Search re-targets first, for the same reason as in parse_intent: a
        # search verb plus a site outranks a bare URL. Returning early also
        # skips the unrelated extraction below (a repeated search otherwise
        # reads "for <word>" as a location), so a repeated request lands as a
        # clean no-op. Shopping/travel/food phrasings stay excluded for the
        # same reason as a fresh request: those are comparison-plan edits.
        query, site = self.extract_search_request(transcript)
        url_in_text = self.extract_url(transcript)
        if query and (site is not None or url_in_text is None) and not self.has_domain_hint(transcript):
            url = self.search_url_for(query, site)
            new_intent.constraints["url"] = url
            new_intent.constraints["query"] = query
            site_name = self.site_name(site)
            if site_name:
                new_intent.constraints["site"] = site_name
            new_intent.domain = "browse"
            new_intent.objective = "search"
            new_intent.targets = [self.url_host(url)]
            return new_intent

        # A subject swap while a search is in flight: "change Elon Musk to Sam
        # Altman" re-issues the same site's search for the new subject. It only
        # applies to a search in flight (the intent carries a query) and never
        # to a stated constraint, so "make it 16 GB RAM" stays a RAM change.
        if new_intent.constraints.get("query") and not self.is_constraint_change(transcript):
            subject = self.extract_subject_replacement(transcript)
            if subject:
                site_key = self.site_key_for_url(str(new_intent.constraints.get("url", "")))
                url = self.search_url_for(subject, site_key)
                new_intent.constraints["url"] = url
                new_intent.constraints["query"] = subject
                new_intent.domain = "browse"
                new_intent.objective = "search"
                new_intent.targets = [self.url_host(url)]
                return new_intent

        # URL change ("now go to example.com") — re-targets browse work.
        url = self.extract_url(transcript)
        if url is not None and new_intent.constraints.get("url") != url:
            new_intent.constraints["url"] = url
            new_intent.domain = "browse"
            new_intent.targets = [self.url_host(url)]
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
        domain = self.match_domain(transcript)
        if domain:
            new_intent.domain = domain

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

        # Search, and ahead of the URL branch. A request that carries a search
        # verb is asking a *question* of something, so it outranks a bare URL:
        # "go to wikipedia.com and search for Elon Musk" must search Wikipedia,
        # not merely open its homepage and quote the homepage.
        #
        # Two things stay out of it. Shopping/travel/food phrasings, which are
        # the multi-store comparison plans rather than web searches. And an
        # arbitrary domain with no search endpoint of its own — we cannot search
        # "docs at example.com", so that request is still plain navigation.
        url_in_text = self.extract_url(text)
        query, site = self.extract_search_request(text)
        if query and (site is not None or url_in_text is None) and not self.has_domain_hint(text):
            url = self.search_url_for(query, site)
            intent.domain = "browse"
            intent.objective = "search"
            intent.constraints["url"] = url
            intent.constraints["query"] = query
            site_name = self.site_name(site)
            if site_name:
                intent.constraints["site"] = site_name
            intent.targets = [self.url_host(url)]
            return intent

        # URL-first: "go to example.com" is browse work, not shopping/travel.
        if url_in_text is not None:
            intent.domain = "browse"
            intent.objective = "browse"
            intent.constraints["url"] = url_in_text
            intent.targets = [self.url_host(url_in_text)]
            return intent

        # Detect domain
        intent.domain = self.match_domain(text) or "general"

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
