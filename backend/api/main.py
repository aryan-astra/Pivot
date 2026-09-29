"""PIVOT backend — interruptible execution runtime API."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

# Allow running as `api.main:app` (cwd=backend, PYTHONPATH=backend) or as
# `backend.api.main:app` (cwd=PIVOT root): ensure the backend dir is importable.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel

from runtime.runtime import Runtime
from runtime.types import IntentState, gen_id
from runtime.events import RuntimeEvent
from providers.deterministic import DeterministicIntentParser
from browser.executor import BrowserSession, make_browse_handlers


def _resolve_db_path() -> str:
    raw = os.getenv("DB_PATH", "data/runtime.db")
    p = Path(raw)
    if p.is_absolute():
        return str(p)
    # Resolve relative to the backend directory so cwd does not matter.
    return str((_BACKEND_DIR / raw).resolve())


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "*")
    if raw.strip() == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


# Global runtime instance
_runtime: Optional[Runtime] = None
_browser_session: Optional[BrowserSession] = None


def _register_browse_tools(runtime: Runtime) -> None:
    # Live browser tools: real local Chromium, lazy-started on first browse
    # task. No domain allowlist; simulated fallback when Playwright is absent.
    # Called on startup AND after every reset: reset builds a fresh Runtime
    # with an empty tool registry, so registration must be re-applied.
    if _browser_session is None:
        return
    for operation, handler in make_browse_handlers(_browser_session).items():
        runtime.register_tool(operation, handler)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _runtime, _browser_session
    db_path = _resolve_db_path()
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    _runtime = Runtime(db_path=db_path)
    _browser_session = BrowserSession()
    _register_browse_tools(_runtime)
    await _runtime.start()
    yield
    if _runtime:
        await _runtime.stop()
    if _browser_session:
        await _browser_session.close()
        _browser_session = None


app = FastAPI(
    title="PIVOT",
    description="Interruptible execution runtime with semantic work invalidation",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files (PIVOT/frontend/dist, sibling of backend/).
# vite-plugin-singlefile inlines everything into index.html, so an assets/
# dir may not exist — only mount it when present.
frontend_dist = _BACKEND_DIR.parent / "frontend" / "dist"
if (frontend_dist / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")


class MessageRequest(BaseModel):
    text: str
    is_interruption: bool = False
    run_id: Optional[str] = None


class IntentRequest(BaseModel):
    domain: str = ""
    objective: str = ""
    constraints: dict[str, Any] = {}
    targets: list[str] = []
    raw_text: str = ""


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "runtime_active": _runtime is not None and _runtime._running,
        "state_version": _runtime.state.version if _runtime else 0,
        "event_count": _runtime.event_bus.event_count if _runtime else 0,
    }


@app.post("/api/message")
async def handle_message(req: MessageRequest):
    if not _runtime:
        return JSONResponse({"error": "Runtime not initialized"}, status_code=503)

    parser = DeterministicIntentParser()

    if req.is_interruption:
        result = await _runtime.handle_interruption(req.text)
        return result

    intent = parser.parse_intent(req.text)
    result = await _runtime.submit_intent(intent)
    return result


@app.post("/api/intent")
async def submit_intent(req: IntentRequest):
    if not _runtime:
        return JSONResponse({"error": "Runtime not initialized"}, status_code=503)

    intent = IntentState(
        domain=req.domain,
        objective=req.objective,
        constraints=req.constraints,
        targets=req.targets,
        raw_text=req.raw_text,
    )
    result = await _runtime.submit_intent(intent)
    return result


@app.post("/api/interrupt")
async def handle_interrupt(req: MessageRequest):
    if not _runtime:
        return JSONResponse({"error": "Runtime not initialized"}, status_code=503)

    result = await _runtime.handle_interruption(req.text)
    return result


@app.get("/api/state")
async def get_state():
    if not _runtime:
        return JSONResponse({"error": "Runtime not initialized"}, status_code=503)
    return _runtime.get_runtime_state()


@app.get("/api/events")
async def get_events(event_type: Optional[str] = None, limit: int = Query(100, ge=1)):
    if not _runtime:
        return JSONResponse({"error": "Runtime not initialized"}, status_code=503)
    events = _runtime.event_bus.get_history(event_type=event_type, limit=limit)
    return [e.to_dict() for e in events]


@app.get("/api/graph")
async def get_graph():
    if not _runtime:
        return JSONResponse({"error": "Runtime not initialized"}, status_code=503)
    return _runtime.graph.to_dict()


@app.get("/api/snapshot")
async def get_snapshot():
    if not _runtime:
        return JSONResponse({"error": "Runtime not initialized"}, status_code=503)
    snapshot = _runtime.state.get_snapshot()
    return snapshot.to_dict()


@app.post("/api/reset")
async def reset_runtime():
    global _runtime
    if _runtime:
        await _runtime.stop()
        _runtime = None
    # Fresh session: drop prior rows so the new runtime starts at v0 with a
    # clean audit trail (the event bus is in-memory per process lifetime).
    db_path = _resolve_db_path()
    for suffix in ("", "-wal", "-shm", "-journal"):
        try:
            Path(f"{db_path}{suffix}").unlink(missing_ok=True)
        except OSError:
            pass
    _runtime = Runtime(db_path=db_path)
    _register_browse_tools(_runtime)
    await _runtime.start()
    return {"status": "reset"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    if not _runtime:
        await websocket.close(code=1011, reason="Runtime not available")
        return

    queue = _runtime.subscribe_ws()

    try:
        # Send initial state
        await websocket.send_json({
            "type": "state_snapshot",
            "data": _runtime.get_runtime_state(),
        })

        async def listen_ws():
            while True:
                data = await websocket.receive_text()
                try:
                    msg = json.loads(data)
                except (ValueError, TypeError):
                    continue  # malformed frame — ignore, never crash the socket
                if not isinstance(msg, dict):
                    continue
                if msg.get("type") == "message":
                    text = msg.get("text")
                    if not isinstance(text, str):
                        continue
                    result = await handle_message(
                        MessageRequest(text=text, is_interruption=msg.get("is_interruption", False))
                    )
                    await websocket.send_json({"type": "command_result", "data": result})
                elif msg.get("type") == "interrupt":
                    text = msg.get("text") or ""
                    result = await handle_interrupt(MessageRequest(text=text))
                    await websocket.send_json({"type": "command_result", "data": result})

        async def forward_events():
            while True:
                try:
                    event: RuntimeEvent = await asyncio.wait_for(queue.get(), timeout=30.0)
                    await websocket.send_json({
                        "type": "event",
                        "data": event.to_dict(),
                    })
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break

        await asyncio.gather(listen_ws(), forward_events())

    except WebSocketDisconnect:
        pass
    finally:
        _runtime.unsubscribe_ws(queue)


# Serve frontend for all other routes
@app.get("/")
async def serve_frontend():
    index_path = frontend_dist / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "PIVOT API", "docs": "/docs"}


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    # Contain path traversal: the resolved file must stay inside frontend_dist
    # (e.g. "/../backend/data/runtime.db" must not escape the static root).
    try:
        file_path = (frontend_dist / full_path).resolve()
        if frontend_dist.resolve() not in file_path.parents:
            raise ValueError("outside static root")
    except (ValueError, OSError):
        return JSONResponse({"error": "not found"}, status_code=404)
    if file_path.is_file():
        return FileResponse(file_path)
    index_path = frontend_dist / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse({"error": "not found"}, status_code=404)
