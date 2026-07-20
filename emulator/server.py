"""FastAPI server: real Pokémon Blue in PyBoy behind the game API.

A single global emulator instance. Endpoints mirror the existing JS game server
closely enough that scripts/ollama-runner.py can be pointed here with
`--base http://127.0.0.1:3100`:

  GET  /state       RAM-derived game state (+ available_actions)
  POST /action      apply a high-level action dict, step, return new state
  POST /reset       reload the overworld savestate
  GET  /screen.png  current Game Boy frame as PNG
  GET  /session     the default session
  POST /session     create/return the default session
  GET  /sessions    list sessions (just the default)
  POST /benchmark   minimal shim so the runner's benchmark start works

Run:  .venv/bin/python -m emulator.server
"""
from __future__ import annotations

import threading

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from emulator import actions, ram_map
from emulator.emu import Emu

app = FastAPI(title="pokemon-llm emulator backend")

# Single global emulator + a lock: PyBoy is not thread-safe and the ASGI server
# may service requests concurrently.
_emu = Emu(headless=True)
_lock = threading.Lock()

DEFAULT_SESSION = {
    "sessionId": "default",
    "token": "default",
    "label": "emulator",
}


def _view() -> dict:
    state = ram_map.read_state(_emu)
    state["screen_png_b64"] = _emu.screen_png_b64()
    state["available_actions"] = actions.AVAILABLE_ACTIONS
    return state


@app.on_event("startup")
def _startup() -> None:
    # Start every server run in the controllable overworld.
    with _lock:
        _emu.reset()


# ── state ────────────────────────────────────────────────────────────────────
@app.get("/state")
def get_state():
    with _lock:
        return _view()


@app.post("/action")
async def post_action(request: Request):
    try:
        action = await request.json()
    except Exception:
        return JSONResponse({"error": "body must be a JSON action dict"}, status_code=400)
    if not isinstance(action, dict) or not action.get("type"):
        return JSONResponse({"error": "action.type is required"}, status_code=400)
    with _lock:
        result = actions.apply_action(_emu, action)
        view = _view()
    view["action"] = action
    view["result"] = result
    return view


@app.post("/reset")
def post_reset():
    with _lock:
        _emu.reset()
        return _view()


# ── screen ───────────────────────────────────────────────────────────────────
@app.get("/screen.png")
def screen_png():
    with _lock:
        png = _emu.screen_png_bytes()
    return Response(content=png, media_type="image/png")


# ── sessions (minimal, single default) ───────────────────────────────────────
@app.get("/session")
def get_session():
    with _lock:
        return {**DEFAULT_SESSION, "state": _view()}


@app.post("/session")
def post_session():
    with _lock:
        return {**DEFAULT_SESSION, "state": _view(),
                "note": "single global emulator; sessionId/token are 'default'."}


@app.get("/sessions")
def get_sessions():
    return [DEFAULT_SESSION]


@app.post("/benchmark")
async def post_benchmark(request: Request):
    """Shim so the runner's benchmark-start call succeeds. There's one global
    emulator; budget/badge bookkeeping is left to the runner/reward harness."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    with _lock:
        _emu.reset()
        view = _view()
    return {
        "benchmarkId": "default",
        "sessionId": "default",
        "token": "default",
        "model": (body or {}).get("model"),
        "actionBudget": (body or {}).get("actionBudget"),
        "state": view,
        "note": "emulator backend: single global instance.",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=3100, log_level="info")
