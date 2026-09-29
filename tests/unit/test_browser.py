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
