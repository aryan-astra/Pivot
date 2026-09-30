"""Tests for live browser execution (real local Chromium, data: URLs only).

No test here touches the network: all navigation uses data: URLs, so the
suite consumes zero API credits and works fully offline.
"""

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from browser.executor import (  # noqa: E402
    BrowserSession,
    is_url_allowed,
    make_browse_handlers,
)
from providers.deterministic import DeterministicIntentParser  # noqa: E402

DATA_PAGE = "data:text/html,<title>Probe</title><h1>Hello</h1><p>Body text here</p>"


class TestSchemeGuard:
    def test_http_https_data_allowed(self):
        assert is_url_allowed("http://example.com")
        assert is_url_allowed("https://example.com/a?b=c")
        assert is_url_allowed(DATA_PAGE)

    def test_other_schemes_rejected(self):
        assert not is_url_allowed("file:///etc/passwd")
        assert not is_url_allowed("ftp://example.com/x")
        assert not is_url_allowed("javascript:alert(1)")
        assert not is_url_allowed("not a url")
        assert not is_url_allowed("")


class TestIntentUrls:
    def test_extract_http_url(self):
        url = DeterministicIntentParser.extract_url("go to https://example.com/a?b=c!")
        assert url == "https://example.com/a?b=c"

    def test_extract_bare_domain_gets_scheme(self):
        url = DeterministicIntentParser.extract_url("go to instagram.com")
        assert url == "https://instagram.com"

    def test_extract_none_for_plain_text(self):
        assert DeterministicIntentParser.extract_url("find laptops under 60000") is None

    def test_parse_intent_browse(self):
        intent = DeterministicIntentParser().parse_intent("go to example.com and show me")
        assert intent.domain == "browse"
        assert intent.constraints["url"] == "https://example.com"
        assert intent.targets == ["example.com"]

    def test_parse_intent_non_url_unchanged(self):
        intent = DeterministicIntentParser().parse_intent("find laptops under 60000")
        assert intent.domain == "shopping"

    def test_parse_modification_url_change(self):
        parser = DeterministicIntentParser()
        current = parser.parse_intent("go to example.com")
        updated = parser.parse_modification("now go to example.org", current)
        assert updated.constraints["url"] == "https://example.org"
        assert updated.domain == "browse"
        assert updated.targets == ["example.org"]


class TestSearchRouting:
    """Web-search requests route through the real browse pipeline.

    The parser points the live browser at a search engine so the run —
    capture, extract, floating preview — visibly IS the search.
    """

    def test_extract_query_phrases(self):
        extract = DeterministicIntentParser.extract_search_query
        assert extract("search for samsung galaxy s26 release date") == "samsung galaxy s26 release date"
        assert extract("Search the web for best cricket bats") == "best cricket bats"
        assert extract("google pixel 9 price") == "pixel 9 price"
        assert extract("look up python decorators") == "python decorators"
        assert extract("actually search for iphone 17 prices instead") == "iphone 17 prices"
        assert extract("find laptops under 60000") is None
        assert extract("go to example.com") is None
        assert extract("search?") is None

    def test_parse_intent_search_becomes_browse(self):
        intent = DeterministicIntentParser().parse_intent("search for samsung galaxy s26 release date")
        assert intent.domain == "browse"
        assert intent.objective == "search"
        assert intent.constraints["query"] == "samsung galaxy s26 release date"
        assert intent.constraints["url"] == "https://www.bing.com/search?q=samsung+galaxy+s26+release+date&setmkt=en-US&setlang=en&cc=US"
        assert intent.targets == ["bing.com"]

    def test_search_query_url_encoded(self):
        intent = DeterministicIntentParser().parse_intent("search for c++ templates & traits")
        assert intent.constraints["url"] == "https://www.bing.com/search?q=c%2B%2B+templates+%26+traits&setmkt=en-US&setlang=en&cc=US"
        assert intent.constraints["query"] == "c++ templates & traits"

    def test_explicit_url_wins_over_search_phrasing(self):
        intent = DeterministicIntentParser().parse_intent("search for docs at example.com")
        assert intent.constraints["url"] == "https://example.com"
        assert "query" not in intent.constraints

    def test_parse_modification_retargets_search(self):
        parser = DeterministicIntentParser()
        current = parser.parse_intent("go to example.com")
        updated = parser.parse_modification("actually search for iphone 17 prices instead", current)
        assert updated.domain == "browse"
        assert updated.objective == "search"
        assert updated.constraints["query"] == "iphone 17 prices"
        assert updated.constraints["url"].startswith("https://www.bing.com/search?q=")

    def test_repeated_search_changes_nothing(self):
        parser = DeterministicIntentParser()
        current = parser.parse_intent("search for iphone 17 prices")
        updated = parser.parse_modification("actually search for iphone 17 prices instead", current)
        assert updated.constraints == current.constraints
        assert updated.domain == current.domain
        assert updated.targets == current.targets

    def test_site_named_in_trailing_position(self):
        """'search for X on Wikipedia' must search Wikipedia for X.

        Handing the literal string to a general engine returns pages about
        searching Wikipedia, which is what the user was shown.
        """
        intent = DeterministicIntentParser().parse_intent("Search for Elon Musk on Wikipedia")
        assert intent.domain == "browse"
        assert intent.constraints["query"] == "Elon Musk"
        assert intent.constraints["site"] == "Wikipedia"
        assert intent.constraints["url"].startswith(
            "https://en.wikipedia.org/w/index.php?search=Elon+Musk"
        )

    def test_search_verb_outranks_a_bare_domain(self):
        """'go to wikipedia.com and search for X' searches, it does not just open.

        The URL branch used to win here, so the run navigated to the site
        homepage and reported the homepage's own text.
        """
        intent = DeterministicIntentParser().parse_intent(
            "Go to wikipedia.com and search for Elon Musk"
        )
        assert intent.objective == "search"
        assert intent.constraints["query"] == "Elon Musk"
        assert intent.constraints["url"].startswith(
            "https://en.wikipedia.org/w/index.php?search=Elon+Musk"
        )

    def test_site_named_in_leading_position(self):
        query, site = DeterministicIntentParser.extract_search_request(
            "search amazon for samsung galaxy s26"
        )
        assert (query, site) == ("samsung galaxy s26", "amazon")

    def test_store_search_drops_the_price_framing(self):
        """A store matches on product text, so 'the price of X' must not be searched."""
        intent = DeterministicIntentParser().parse_intent(
            "find the price of samsung galaxy s26 on flipkart"
        )
        assert intent.constraints["query"] == "samsung galaxy s26"
        assert intent.constraints["url"] == "https://www.flipkart.com/search?q=samsung+galaxy+s26"

    def test_unknown_domain_with_no_search_endpoint_still_navigates(self):
        """We cannot search an arbitrary site, so naming one is plain navigation."""
        intent = DeterministicIntentParser().parse_intent("search for docs at example.com")
        assert intent.constraints["url"] == "https://example.com"
        assert "query" not in intent.constraints

    def test_product_names_do_not_read_as_domain_keywords(self):
        """'iphone' contains 'phone'; that must not read as shopping work."""
        intent = DeterministicIntentParser().parse_intent("search for iphone 17 price")
        assert intent.domain == "browse"
        assert intent.constraints["query"] == "iphone 17 price"

    def test_questions_route_as_searches(self):
        """A question has no search verb; it must still be looked up."""
        parser = DeterministicIntentParser()
        for text, subject in (
            ("what is the price of Samsung Galaxy S26", "Samsung Galaxy S26"),
            ("who is Sam Altman", "Sam Altman"),
            ("how much does a Tesla Model 3 cost", "a Tesla Model 3"),
            ("what is the release date of the Galaxy S26", "the Galaxy S26"),
        ):
            intent = parser.parse_intent(text)
            assert intent.domain == "browse", text
            assert intent.constraints["query"] == subject, text
            assert intent.constraints["url"].startswith("https://www.bing.com/search?q="), text

    def test_question_on_a_named_site_searches_that_site(self):
        intent = DeterministicIntentParser().parse_intent(
            "what is the net worth of Elon Musk on Wikipedia"
        )
        assert intent.constraints["query"] == "Elon Musk"
        assert intent.constraints["url"].startswith(
            "https://en.wikipedia.org/w/index.php?search=Elon+Musk"
        )

    def test_shopping_and_travel_requests_keep_their_plans(self):
        parser = DeterministicIntentParser()
        shop = parser.parse_intent("Find laptops under 60000 with 8 GB RAM on Amazon and Flipkart")
        assert shop.domain == "shopping"
        assert "url" not in shop.constraints
        travel = parser.parse_intent("Find a hotel in Bengaluru for three nights")
        assert travel.domain == "travel"
        assert "url" not in travel.constraints
        # and an edit to either stays in its own domain
        assert parser.parse_modification("find a hotel in Mumbai instead", travel).domain == "travel"

    def test_subject_swap_reissues_the_same_site_search(self):
        """Changing the subject of a search in flight re-targets the same site."""
        parser = DeterministicIntentParser()
        current = parser.parse_intent("Search for Elon Musk on Wikipedia")
        for phrase in (
            "Wait, change Elon Musk to Sam Altman",
            "change it to Sam Altman",
            "actually use Sam Altman instead",
        ):
            updated = parser.parse_modification(phrase, current)
            assert updated.constraints["query"] == "Sam Altman", phrase
            assert updated.constraints["url"].startswith(
                "https://en.wikipedia.org/w/index.php?search=Sam+Altman"
            ), phrase
            assert updated.domain == "browse", phrase

    def test_constraint_change_is_never_read_as_a_subject(self):
        """'make it 16 GB RAM' states a constraint, not a new search subject."""
        parser = DeterministicIntentParser()
        shopping = parser.parse_intent("Find laptops under 60000 with 8 GB RAM on Amazon and Flipkart")
        updated = parser.parse_modification("make it 16 GB RAM", shopping)
        assert updated.constraints["ram"] == "16GB"
        assert updated.domain == "shopping"
        assert "url" not in updated.constraints
        # the same phrasing during a search re-targets, because a search has a subject
        search = parser.parse_intent("Search for Elon Musk on Wikipedia")
        assert parser.parse_modification("change it to Sam Altman", search).constraints[
            "query"
        ] == "Sam Altman"


class TestFocusedExtraction:
    """The extract step returns page content about the request, not page chrome."""

    BODY = (
        "Contents\n"
        "hide (Top)\n"
        "Early life and education\n"
        "Toggle\n"
        "External links\n"
        "Elon Musk\n"
        "162 languages\n"
        "Article\n"
        "Talk\n"
        "View source\n"
        "Skip to content\n"
        "Accessibility Feedback\n"
        "Rewards\n"
        "ALLSEARCHIMAGESVIDEOSMAPSNEWS\n"
        "MORE\n"
        "Elon Reeve Musk (born June 28, 1971) is a businessman and industrialist who is "
        "the chief executive officer and largest shareholder of Tesla and SpaceX.\n"
        "Musk was born in Pretoria, South Africa, and is of British and Pennsylvania Dutch "
        "ancestry. His mother, Maye, is a model and dietitian.\n"
        "Citizenship United States\n"
        "Education University of Pennsylvania\n"
    )

    def test_returns_the_article_not_the_table_of_contents(self):
        from browser.executor import focused_text

        out = focused_text(self.BODY, "Elon Musk")
        assert "chief executive officer" in out
        assert "Pennsylvania Dutch" in out
        # chrome must not reach the answer
        for chrome in ("162 languages", "View source", "Accessibility Feedback", "ALLSEARCH", "Toggle"):
            assert chrome not in out, chrome

    def test_no_query_returns_the_plain_leading_text(self):
        from browser.executor import content_text, focused_text

        assert focused_text(self.BODY, "") == content_text(self.BODY)

    def test_unmatched_query_still_returns_something(self):
        from browser.executor import content_text, focused_text

        body = "A page that never mentions the subject at all, in any wording whatsoever here."
        assert focused_text(body, "quantum chromodynamics") == content_text(body)

    def test_nav_bar_lines_are_not_treated_as_prose(self):
        from browser.executor import focused_text

        shouted = (
            "Skip to content\n"
            "Rewards\n"
            "ELONMUSKWIKIPEDIA SEARCH IMAGES VIDEOS MAPS NEWS MORE\n"
            "Elon Musk is a businessman who runs Tesla and also happens to own SpaceX entirely.\n"
        )
        out = focused_text(shouted, "Elon Musk")
        assert "runs Tesla" in out
        assert "ELONMUSKWIKIPEDIA" not in out

    def test_search_intent_plan_uses_browse_ops_and_labels(self):
        from runtime.runtime import Runtime

        runtime = Runtime()
        intent = DeterministicIntentParser().parse_intent("search for samsung galaxy s26 release date")
        plan = runtime._create_plan(intent)
        assert [t["operation"] for t in plan] == ["browse_navigate", "browse_snapshot", "browse_extract"]
        assert plan[0]["label"] == "Search the web for samsung galaxy s26 release date"
        assert plan[0]["metadata"]["url"] == "https://www.bing.com/search?q=samsung+galaxy+s26+release+date&setmkt=en-US&setlang=en&cc=US"
        # Plain browse keeps its original label.
        plain = runtime._create_plan(DeterministicIntentParser().parse_intent("go to example.com"))
        assert plain[0]["label"] == "Open example.com"


class TestBrowsePlanAndHandlers:
    def test_handlers_register_three_ops(self):
        handlers = make_browse_handlers(BrowserSession())
        assert set(handlers) == {"browse_navigate", "browse_snapshot", "browse_extract"}

    def test_handler_rejects_missing_url(self):
        async def go():
            handlers = make_browse_handlers(BrowserSession())
            out = await handlers["browse_navigate"]({"task_id": "t1", "metadata": {}}, asyncio.Event())
            assert out["status"] == "error"
            assert "url" in out["error"].lower()

        asyncio.run(go())

    def test_handler_rejects_bad_scheme(self):
        async def go():
            handlers = make_browse_handlers(BrowserSession())
            task = {"task_id": "t1", "metadata": {"url": "file:///etc/passwd"}}
            out = await handlers["browse_navigate"](task, asyncio.Event())
            assert out["status"] == "error"

        asyncio.run(go())

    def test_handler_cancelled_when_flag_set(self):
        async def go():
            handlers = make_browse_handlers(BrowserSession())
            ev = asyncio.Event()
            ev.set()
            task = {"task_id": "t1", "metadata": {"url": DATA_PAGE}}
            with pytest.raises(asyncio.CancelledError):
                await handlers["browse_navigate"](task, ev)

        asyncio.run(go())


class TestContentText:
    """Leading page boilerplate is trimmed from extracted text so answers
    quote the page's content, not its skip links and nav labels."""

    def test_trims_leading_chrome(self):
        from browser.executor import content_text

        body = (
            "Skip to content\nAccessibility Feedback\nRewards\nALLSEARCHIMAGESVIDEOSMAPSNEWS\n"
            "MORE\nPrivacy\nTerms\n42,900 results\nAmazon\nwww.amazon.in › Galaxy S26"
        )
        out = content_text(body)
        assert out.startswith("42,900 results")
        assert "Skip to content" not in out
        assert "Privacy" not in out

    def test_regular_pages_untouched(self):
        from browser.executor import content_text

        assert content_text("Hello\nBody text here") == "Hello Body text here"

    def test_limit_applied(self):
        from browser.executor import content_text

        assert content_text("Real content line", limit=5) == "Real "


class TestSimulatedFallback:
    def test_run_task_without_playwright_returns_simulated(self, monkeypatch):
        """The documented zero-key install (requirements only, no playwright)
        must degrade to a simulated result — never raise at import time."""
        import builtins

        real_import = builtins.__import__

        def blocked(name, *args, **kwargs):
            if name.split(".")[0] == "playwright":
                raise ImportError("playwright unavailable (blocked by test)")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", blocked)

        async def go():
            session = BrowserSession()
            try:
                return await session.run_task(DATA_PAGE, task_id="t1")
            finally:
                await session.close()

        out = asyncio.run(go())
        assert out["status"] == "simulated"
        assert out.get("simulated") is True


@pytest.mark.skipif(os.getenv("PIVOT_SKIP_BROWSER") == "1", reason="browser tests disabled")
class TestLiveBrowser:
    def test_navigate_data_url(self):
        async def go():
            session = BrowserSession()
            try:
                out = await session.run_task(DATA_PAGE, task_id="t1")
                assert out["status"] == "completed"
                assert out["title"] == "Probe"
                assert out["screenshot"].startswith("data:image/jpeg;base64,")
                assert len(out["screenshot"]) > 1000
            finally:
                await session.close()

        asyncio.run(go())

    def test_extract_text(self):
        async def go():
            session = BrowserSession()
            try:
                out = await session.run_task(DATA_PAGE, task_id="t1", extract_text=True)
                assert out["status"] == "completed"
                assert "Hello" in out["text"]
                assert "Body text here" in out["text"]
            finally:
                await session.close()

        asyncio.run(go())

    def test_repeated_cycles_no_leak(self):
        """Start/navigate/close repeatedly; a leaked browser breaks this."""
        import subprocess

        def chromium_count():
            try:
                raw = subprocess.check_output(["tasklist", "/FI", "IMAGENAME eq chrome.exe"], text=True)
                return raw.count("chrome.exe")
            except Exception:
                return -1

        async def go():
            session = BrowserSession()
            try:
                for i in range(3):
                    out = await session.run_task(DATA_PAGE, task_id=f"t{i}")
                    assert out["status"] == "completed"
            finally:
                await session.close()

        before = chromium_count()
        asyncio.run(go())
        after = chromium_count()
        assert after <= before or before == -1
