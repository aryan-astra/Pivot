"""Browser automation executor using Playwright (real local Chromium).

Drives a real browser: navigation, clicks, typing, extraction, and JPEG
screenshots. There is no domain allowlist — any http(s) URL may be driven.
The single safety invariant is the URL scheme gate (http/https/data only),
which keeps local files and other schemes out of reach.

Cancel-safety contract (Playwright upstream: cancelling an in-flight
Playwright await is undefined behavior): every operation carries its own
short timeout, and asyncio.CancelledError is never swallowed here — it
propagates so the scheduler's cancellation takes effect at the next await.
Callers must close the task context on cancellation (see BrowserSession).
"""

from __future__ import annotations

import asyncio
import base64
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

NAV_TIMEOUT_MS = 12_000
ACTION_TIMEOUT_MS = 5_000
SHOT_TIMEOUT_MS = 5_000
EXTRACT_TIMEOUT_MS = 8_000
VIEWPORT = {"width": 1280, "height": 800}


def is_url_allowed(url: str) -> bool:
    """Scheme gate: http, https, and data (tests) only. Not a domain list."""
    try:
        return urlsplit(url.strip()).scheme.lower() in ("http", "https", "data")
    except Exception:
        return False


@dataclass
class BrowserAction:
    action_id: str = ""
    task_id: str = ""
    action_type: str = ""  # navigate, click, type, scroll, wait, screenshot, extract
    selector: str = ""
    value: str = ""
    url: str = ""
    timestamp: float = field(default_factory=time.time)
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    screenshot: Optional[str] = None  # base64 encoded


class BrowserExecutor:
    """Single-task browser driver. Prefer BrowserSession for managed use."""

    def __init__(self, headless: bool = True):
        self._headless = headless
        self._browser = None
        self._context = None
        self._page = None
        self._actions: list[BrowserAction] = []
        self._screenshot_callback: Optional[Callable] = None
        self._console_errors: list[str] = []

    async def start(self) -> None:
        try:
            from playwright.async_api import async_playwright
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self._headless, timeout=30_000
            )
            self._context = await self._browser.new_context(viewport=dict(VIEWPORT))
            self._context.set_default_timeout(ACTION_TIMEOUT_MS)
            self._context.set_default_navigation_timeout(NAV_TIMEOUT_MS)
            self._page = await self._context.new_page()
            self._attach_listeners(self._page)
        except ImportError:
            # Playwright not installed, use simulated mode
            self._browser = None
        except Exception:
            self._browser = None

    async def stop(self) -> None:
        # Strict close order: page -> context -> browser -> playwright.
        try:
            if self._page:
                await self._page.close()
        except Exception:
            pass
        finally:
            self._page = None
        try:
            if self._context:
                await self._context.close()
        except Exception:
            pass
        finally:
            self._context = None
        try:
            if self._browser:
                await self._browser.close()
        except Exception:
            pass
        finally:
            self._browser = None
        try:
            if hasattr(self, "_playwright") and self._playwright:
                await self._playwright.stop()
        except Exception:
            pass

    def on_screenshot(self, callback: Callable) -> None:
        self._screenshot_callback = callback

    def _attach_listeners(self, page) -> None:
        def _on_console(msg) -> None:
            try:
                if msg.type == "error":
                    self._console_errors.append(str(msg.text)[:2000])
            except Exception:
                pass

        def _on_pageerror(exc) -> None:
            try:
                self._console_errors.append(str(exc)[:2000])
            except Exception:
                pass

        try:
            page.on("console", _on_console)
            page.on("pageerror", _on_pageerror)
        except Exception:
            pass

    def _new_action(self, **kwargs) -> BrowserAction:
        action = BrowserAction(action_id=f"act_{len(self._actions)}", **kwargs)
        return action

    async def navigate(self, url: str, task_id: str = "") -> BrowserAction:
        action = self._new_action(
            task_id=task_id, action_type="navigate", url=url,
        )

        if not is_url_allowed(url):
            action.error = f"Unsupported URL scheme (http/https/data only): {url[:120]}"
            self._actions.append(action)
            return action

        if self._page:
            try:
                from playwright.async_api import Error as PWError

                self._console_errors = []
                await self._page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
                screenshot = await self._take_screenshot()
                action.screenshot = screenshot
                action.result = {
                    "url": self._page.url,
                    "title": await self._page.title(),
                    "page_errors": list(self._console_errors[:5]),
                }
            except asyncio.CancelledError:
                raise
            except Exception as e:
                action.error = str(e)[:500]
        else:
            action.result = {"url": url, "simulated": True}

        self._actions.append(action)
        return action

    async def click(self, selector: str, task_id: str = "") -> BrowserAction:
        action = self._new_action(
            task_id=task_id, action_type="click", selector=selector,
        )

        if self._page:
            try:
                await self._page.click(selector, timeout=ACTION_TIMEOUT_MS)
                action.screenshot = await self._take_screenshot()
                action.result = {"clicked": selector}
            except asyncio.CancelledError:
                raise
            except Exception as e:
                action.error = str(e)[:500]
        else:
            action.result = {"clicked": selector, "simulated": True}

        self._actions.append(action)
        return action

    async def type_text(self, selector: str, text: str, task_id: str = "") -> BrowserAction:
        action = self._new_action(
            task_id=task_id, action_type="type", selector=selector, value=text,
        )

        if self._page:
            try:
                await self._page.fill(selector, text, timeout=ACTION_TIMEOUT_MS)
                action.screenshot = await self._take_screenshot()
                action.result = {"typed": text, "selector": selector}
            except asyncio.CancelledError:
                raise
            except Exception as e:
                action.error = str(e)[:500]
        else:
            action.result = {"typed": text, "simulated": True}

        self._actions.append(action)
        return action

    async def search(self, query: str, site: str = "google", task_id: str = "") -> list[BrowserAction]:
        """Convenience method for search flow."""
        actions = []

        if site == "google":
            nav = await self.navigate(f"https://www.google.com/search?q={query}", task_id)
            actions.append(nav)
        elif site == "amazon":
            nav = await self.navigate("https://www.amazon.in", task_id)
            actions.append(nav)
            type_action = await self.type_text("#twotabsearchtextbox", query, task_id)
            actions.append(type_action)
        elif site == "flipkart":
            nav = await self.navigate("https://www.flipkart.com", task_id)
            actions.append(nav)

        return actions

    async def extract_data(self, selectors: dict[str, str], task_id: str = "") -> BrowserAction:
        action = self._new_action(
            task_id=task_id, action_type="extract",
        )

        if self._page:
            try:
                extracted = {}
                for key, selector in selectors.items():
                    try:
                        el = await self._page.query_selector(selector)
                        if el:
                            text = await el.inner_text()
                            extracted[key] = text.strip()
                    except Exception:
                        extracted[key] = None
                action.result = {"extracted": extracted}
            except asyncio.CancelledError:
                raise
            except Exception as e:
                action.error = str(e)[:500]
        else:
            action.result = {"extracted": {}, "simulated": True}

        self._actions.append(action)
        return action

    async def _take_screenshot(self) -> Optional[str]:
        if not self._page:
            return None
        try:
            png = await self._page.screenshot(
                type="jpeg", quality=60, timeout=SHOT_TIMEOUT_MS, animations="disabled"
            )
            b64 = base64.b64encode(png).decode("utf-8")
            if self._screenshot_callback:
                await self._screenshot_callback(b64)
            return b64
        except asyncio.CancelledError:
            raise
        except Exception:
            return None

    def get_action_history(self, limit: int = 50) -> list[dict[str, Any]]:
        actions = self._actions[-limit:]
        return [
            {
                "action_id": a.action_id,
                "task_id": a.task_id,
                "action_type": a.action_type,
                "selector": a.selector,
                "url": a.url,
                "timestamp": a.timestamp,
                "error": a.error,
                "has_screenshot": a.screenshot is not None,
                "result": a.result,
            }
            for a in actions
        ]

    @property
    def is_available(self) -> bool:
        return self._browser is not None or True  # Simulated mode always available


class BrowserSession:
    """Managed browser lifetime: one shared browser, one context per task.

    Contexts are cheap and isolated; every task context is closed even on
    cancellation or error. Playwright is never shared across threads — all
    use stays on the runtime's event loop.
    """

    def __init__(self, headless: Optional[bool] = None):
        if headless is None:
            headless = os.getenv("BROWSER_HEADLESS", "true").lower() != "false"
        self._headless = headless
        self._playwright = None
        self._browser = None
        self._lock = asyncio.Lock()

    async def ensure_started(self) -> bool:
        """Idempotent start. Returns True when a real browser is ready."""
        if self._browser is not None:
            return True
        async with self._lock:
            if self._browser is not None:
                return True
            try:
                from playwright.async_api import async_playwright

                self._playwright = await async_playwright().start()
                self._browser = await self._playwright.chromium.launch(
                    headless=self._headless, timeout=30_000
                )
                return True
            except Exception:
                self._playwright = None
                self._browser = None
                return False

    async def run_task(self, url: str, task_id: str = "", extract_text: bool = False) -> dict[str, Any]:
        """Navigate + capture title/screenshot inside a fresh task context.

        With extract_text, also captures the visible body text (truncated).
        Returns a result dict. asyncio.CancelledError propagates (never
        converted) so scheduler cancellation ends the task as CANCELLED.
        The task context is always closed via a shielded cleanup.
        """
        from playwright.async_api import Error as PWError

        started = await self.ensure_started()
        if not started or self._browser is None:
            return {"status": "simulated", "url": url, "simulated": True}

        context = None
        try:
            context = await self._browser.new_context(viewport=dict(VIEWPORT))
            context.set_default_timeout(ACTION_TIMEOUT_MS)
            context.set_default_navigation_timeout(NAV_TIMEOUT_MS)
            page = await context.new_page()
            errors: list[str] = []

            def _on_pageerror(exc) -> None:
                try:
                    errors.append(str(exc)[:500])
                except Exception:
                    pass

            try:
                page.on("pageerror", _on_pageerror)
            except Exception:
                pass

            await page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            # Let full load settle briefly so captures show rendered content
            # (best effort — never fails the task on slow pages).
            try:
                await page.wait_for_load_state("load", timeout=3_000)
            except Exception:
                pass
            title = await page.title()
            shot = None
            try:
                raw = await page.screenshot(
                    type="jpeg", quality=60, timeout=SHOT_TIMEOUT_MS, animations="disabled"
                )
                shot = "data:image/jpeg;base64," + base64.b64encode(raw).decode("utf-8")
            except Exception:
                shot = None
            out: dict[str, Any] = {
                "status": "completed",
                "url": page.url,
                "title": title,
                "page_errors": errors[:5],
            }
            if shot is not None:
                out["screenshot"] = shot
            if extract_text:
                try:
                    body = await page.locator("body").inner_text(timeout=ACTION_TIMEOUT_MS)
                    out["text"] = body.strip()[:2000]
                except Exception:
                    pass
            return out
        except Exception as e:
            # NOTE: asyncio.CancelledError is deliberately NOT caught — it must
            # propagate so scheduler cancellation ends the task as CANCELLED
            # (not committed). Context cleanup below is shielded so it runs.
            return {"status": "error", "url": url, "error": str(e)[:500]}
        finally:
            try:
                if context is not None:
                    await asyncio.shield(context.close())
            except Exception:
                pass

    async def close(self) -> None:
        try:
            if self._browser is not None:
                await self._browser.close()
        except Exception:
            pass
        finally:
            self._browser = None
        try:
            if self._playwright is not None:
                await self._playwright.stop()
        except Exception:
            pass
        finally:
            self._playwright = None


def make_browse_handlers(session: "BrowserSession") -> dict[str, Callable]:
    """Runtime tool handlers for the browse_* operations.

    Each handler runs one self-contained browser pass (fresh context) and
    returns a result dict carrying the latest screenshot. Handlers never
    raise except asyncio.CancelledError, which propagates so the scheduler
    records a real cancellation instead of committing a partial result.
    """

    def _url_of(task: dict[str, Any]) -> str:
        return str((task.get("metadata") or {}).get("url", ""))

    async def _run(task: dict[str, Any], cancel_event: "asyncio.Event", extract: bool = False) -> dict[str, Any]:
        if cancel_event.is_set():
            raise asyncio.CancelledError()
        url = _url_of(task)
        if not url:
            return {"status": "error", "error": "browse task has no url in metadata"}
        if not is_url_allowed(url):
            return {"status": "error", "error": f"Unsupported URL scheme: {url[:120]}"}
        out = await session.run_task(url, task_id=task.get("task_id", ""), extract_text=extract)
        # One-line human summary: the UI renders result.summary for completed
        # dict results (task outputs stay strings; screenshots ride separately).
        if isinstance(out, dict) and out.get("status") == "completed":
            title = str(out.get("title") or url)
            text = str(out.get("text") or "").strip().replace("\n", " ")
            out["summary"] = title if not text else f"{title} — {text[:140]}"
        return out

    async def browse_navigate(task: dict[str, Any], cancel_event: "asyncio.Event") -> dict[str, Any]:
        return await _run(task, cancel_event)

    async def browse_snapshot(task: dict[str, Any], cancel_event: "asyncio.Event") -> dict[str, Any]:
        return await _run(task, cancel_event)

    async def browse_extract(task: dict[str, Any], cancel_event: "asyncio.Event") -> dict[str, Any]:
        return await _run(task, cancel_event, extract=True)

    return {
        "browse_navigate": browse_navigate,
        "browse_snapshot": browse_snapshot,
        "browse_extract": browse_extract,
    }
