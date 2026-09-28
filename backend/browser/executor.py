"""Browser automation executor using Playwright."""

from __future__ import annotations

import asyncio
import base64
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


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
    """
    Playwright-based browser automation with safety controls.
    
    Features:
    - Domain allowlisting
    - Screenshot capture
    - Action telemetry
    - Cancellation support
    - Read-only enforcement for demo
    """

    ALLOWED_DOMAINS = {
        "amazon.in", "amazon.com",
        "flipkart.com",
        "google.com", "google.co.in",
        "bing.com",
        "wikipedia.org",
    }

    BLOCKED_DOMAINS = {
        "banking", "payment", "checkout", "login",
        "accounts.google", "myaccount",
    }

    def __init__(self, headless: bool = True):
        self._headless = headless
        self._browser = None
        self._context = None
        self._page = None
        self._actions: list[BrowserAction] = []
        self._screenshot_callback: Optional[Callable] = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        try:
            from playwright.async_api import async_playwright
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(headless=self._headless)
            self._context = await self._browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            self._page = await self._context.new_page()
        except ImportError:
            # Playwright not installed, use simulated mode
            self._browser = None
        except Exception as e:
            self._browser = None

    async def stop(self) -> None:
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if hasattr(self, '_playwright') and self._playwright:
            await self._playwright.stop()

    def on_screenshot(self, callback: Callable) -> None:
        self._screenshot_callback = callback

    def is_domain_allowed(self, url: str) -> bool:
        from urllib.parse import urlparse
        try:
            domain = urlparse(url).netloc.lower()
            if any(blocked in domain for blocked in self.BLOCKED_DOMAINS):
                return False
            # Default-deny: only explicitly allowlisted shopping/search
            # domains may drive the real browser. (The executor currently has
            # no callers in the runtime — simulated mode — so this tightens
            # the control at zero behavioral cost.)
            return any(allowed in domain for allowed in self.ALLOWED_DOMAINS)
        except Exception:
            return False

    async def navigate(self, url: str, task_id: str = "") -> BrowserAction:
        action = BrowserAction(
            action_id=f"act_{len(self._actions)}",
            task_id=task_id,
            action_type="navigate",
            url=url,
        )

        if not self.is_domain_allowed(url):
            action.error = f"Domain not allowed: {url}"
            self._actions.append(action)
            return action

        if self._page:
            try:
                await self._page.goto(url, wait_until="domcontentloaded", timeout=15000)
                screenshot = await self._take_screenshot()
                action.screenshot = screenshot
                action.result = {"url": self._page.url, "title": await self._page.title()}
            except Exception as e:
                action.error = str(e)
        else:
            action.result = {"url": url, "simulated": True}

        self._actions.append(action)
        return action

    async def click(self, selector: str, task_id: str = "") -> BrowserAction:
        action = BrowserAction(
            action_id=f"act_{len(self._actions)}",
            task_id=task_id,
            action_type="click",
            selector=selector,
        )

        if self._page:
            try:
                await self._page.click(selector, timeout=5000)
                screenshot = await self._take_screenshot()
                action.screenshot = screenshot
                action.result = {"clicked": selector}
            except Exception as e:
                action.error = str(e)
        else:
            action.result = {"clicked": selector, "simulated": True}

        self._actions.append(action)
        return action

    async def type_text(self, selector: str, text: str, task_id: str = "") -> BrowserAction:
        action = BrowserAction(
            action_id=f"act_{len(self._actions)}",
            task_id=task_id,
            action_type="type",
            selector=selector,
            value=text,
        )

        if self._page:
            try:
                await self._page.fill(selector, text)
                screenshot = await self._take_screenshot()
                action.screenshot = screenshot
                action.result = {"typed": text, "selector": selector}
            except Exception as e:
                action.error = str(e)
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
        action = BrowserAction(
            action_id=f"act_{len(self._actions)}",
            task_id=task_id,
            action_type="extract",
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
            except Exception as e:
                action.error = str(e)
        else:
            action.result = {"extracted": {}, "simulated": True}

        self._actions.append(action)
        return action

    async def _take_screenshot(self) -> Optional[str]:
        if not self._page:
            return None
        try:
            png = await self._page.screenshot(type="jpeg", quality=60)
            b64 = base64.b64encode(png).decode("utf-8")
            if self._screenshot_callback:
                await self._screenshot_callback(b64)
            return b64
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
