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
from fastapi.responses import HTMLResponse, JSONResponse

from emulator import actions, ram_map
from emulator.emu import Emu

app = FastAPI(title="pokemon-llm emulator backend")

# Live spectator page — upscaled Game Boy screen + the RAM-derived state, polled
# a few times a second so a human can watch an agent play in the browser.
VIEWER_HTML = """<!doctype html><html><head><meta charset="utf-8">
<title>Pokémon Blue — emulator</title>
<style>
 body{background:#0d0d0d;color:#d8d8d8;font-family:'Courier New',monospace;margin:0;padding:16px;display:flex;gap:20px;flex-wrap:wrap}
 h1{font-size:15px;color:#8bd;margin:0 0 10px}
 #screen{image-rendering:pixelated;width:480px;height:432px;background:#111;border:2px solid #333;border-radius:6px}
 #panel{min-width:240px}
 .k{color:#7a7a7a} .v{color:#e8e8e8}
 pre{white-space:pre-wrap;font-size:12px;line-height:1.5}
</style></head><body>
 <div><h1>POKÉMON BLUE — live emulator</h1><img id="screen" src="/screen.png"></div>
 <div id="panel"><h1>STATE</h1><pre id="state">…</pre></div>
<script>
 const img=document.getElementById('screen'), st=document.getElementById('state');
 async function tick(){
   img.src='/screen.png?'+Date.now();
   try{const s=await (await fetch('/state')).json(); delete s.screen_png_b64;
     const p=s.player||{};
     st.textContent=
       'screen   '+s.screen+'\\n'+
       'map      '+(s.area&&s.area.id)+'\\n'+
       'pos      x='+(p.position&&p.position.x)+' y='+(p.position&&p.position.y)+'\\n'+
       'badges   '+p.badges+'\\n'+
       'money    $'+p.money+'\\n'+
       'in_battle '+s.in_battle+'\\n'+
       'party    '+JSON.stringify(p.party);
   }catch(e){st.textContent='(state error)';}
 }
 setInterval(tick,350); tick();
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def viewer():
    return VIEWER_HTML

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
    import os
    import uvicorn

    # Railway (and any PaaS) injects the port to bind via $PORT.
    port = int(os.environ.get("PORT", "3100"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
