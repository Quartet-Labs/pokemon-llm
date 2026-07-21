"""FastAPI server: real Pokémon Blue in PyBoy behind the game API.

Multi-session ("couch mode"): the server holds a dict of independent `Emu`
instances (each its own PyBoy running the same ROM from the same overworld
savestate), capped at 4. Every request selects its session via `?session=X`;
a `default` session always exists so the single-agent runner keeps working with
no session param. Endpoints mirror the existing JS game server closely enough
that scripts/ollama-runner.py can be pointed here with
`--base http://127.0.0.1:3100`:

  GET  /state?session=X      RAM-derived game state (+ available_actions)
  POST /action?session=X     apply a high-level action dict, step, return state
  POST /reset?session=X      reload the overworld savestate
  GET  /screen.png?session=X current Game Boy frame as PNG
  GET  /session?session=X    a session's snapshot
  POST /session {label?}     create a new session (up to 4), return id/token
  GET  /sessions             list all sessions [{sessionId,label}]
  POST /benchmark            create a session and return it

Run:  .venv/bin/python -m emulator.server
"""
from __future__ import annotations

import secrets
import threading

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse

from emulator import actions, ram_map
from emulator.emu import Emu

app = FastAPI(title="pokemon-llm emulator backend")

MAX_SESSIONS = 4
DEFAULT_SESSION_ID = "default"


class Session:
    """One independent emulator plus its own lock. PyBoy is not thread-safe, so
    each session gets a dedicated lock — locks are per-session so driving one
    session never blocks another (no global serialization)."""

    def __init__(self, session_id: str, label: str, token: str):
        self.id = session_id
        self.label = label
        self.token = token
        self.emu = Emu(headless=True)
        self.lock = threading.Lock()

    def view(self) -> dict:
        state = ram_map.read_state(self.emu)
        state["screen_png_b64"] = self.emu.screen_png_b64()
        state["available_actions"] = actions.AVAILABLE_ACTIONS
        return state

    def summary(self) -> dict:
        return {"sessionId": self.id, "label": self.label}


# Session registry. `_sessions_lock` guards the dict itself (create/list); each
# session's own lock guards its emulator. Keep them distinct so registry ops
# don't serialize emulator work.
_sessions: dict[str, Session] = {}
_sessions_lock = threading.Lock()


def _make_session(session_id: str, label: str) -> Session:
    sess = Session(session_id, label, token=secrets.token_hex(8))
    with sess.lock:
        sess.emu.reset()
    _sessions[session_id] = sess
    return sess


def _alloc_id(used: set[str]) -> str:
    """Pick a stable short id p1..p4 not already in use; fall back to random."""
    for i in range(1, MAX_SESSIONS + 1):
        cand = f"p{i}"
        if cand not in used:
            return cand
    return secrets.token_hex(4)


def _resolve_or_404(request: Request):
    """Return (session, None) or (None, JSONResponse-404)."""
    sid = request.query_params.get("session") or DEFAULT_SESSION_ID
    sess = _sessions.get(sid)
    if sess is None:
        return None, JSONResponse(
            {"error": f"unknown session {sid!r}"}, status_code=404
        )
    return sess, None


@app.on_event("startup")
def _startup() -> None:
    # The default session always exists and starts in the controllable overworld.
    with _sessions_lock:
        if DEFAULT_SESSION_ID not in _sessions:
            _make_session(DEFAULT_SESSION_ID, "default")


# ── state ────────────────────────────────────────────────────────────────────
@app.get("/state")
def get_state(request: Request):
    sess, err = _resolve_or_404(request)
    if err:
        return err
    with sess.lock:
        return sess.view()


@app.post("/action")
async def post_action(request: Request):
    sess, err = _resolve_or_404(request)
    if err:
        return err
    try:
        action = await request.json()
    except Exception:
        return JSONResponse({"error": "body must be a JSON action dict"}, status_code=400)
    if not isinstance(action, dict) or not action.get("type"):
        return JSONResponse({"error": "action.type is required"}, status_code=400)
    with sess.lock:
        result = actions.apply_action(sess.emu, action)
        view = sess.view()
    view["action"] = action
    view["result"] = result
    return view


@app.post("/reset")
def post_reset(request: Request):
    sess, err = _resolve_or_404(request)
    if err:
        return err
    with sess.lock:
        sess.emu.reset()
        return sess.view()


# ── screen ───────────────────────────────────────────────────────────────────
@app.get("/screen.png")
def screen_png(request: Request):
    sess, err = _resolve_or_404(request)
    if err:
        return err
    with sess.lock:
        png = sess.emu.screen_png_bytes()
    return Response(content=png, media_type="image/png")


# ── sessions ─────────────────────────────────────────────────────────────────
@app.get("/session")
def get_session(request: Request):
    sess, err = _resolve_or_404(request)
    if err:
        return err
    with sess.lock:
        return {"sessionId": sess.id, "token": sess.token, "label": sess.label,
                "state": sess.view()}


@app.post("/session")
async def post_session(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    label = (body or {}).get("label")
    with _sessions_lock:
        if len(_sessions) >= MAX_SESSIONS:
            return JSONResponse(
                {"error": f"session cap reached ({MAX_SESSIONS})",
                 "sessions": [s.summary() for s in _sessions.values()]},
                status_code=409,
            )
        sid = _alloc_id(set(_sessions))
        if not label:
            label = f"player {sid[1:]}" if sid.startswith("p") else sid
        sess = _make_session(sid, label)
    return {"sessionId": sess.id, "token": sess.token, "label": sess.label}


@app.get("/sessions")
def get_sessions():
    with _sessions_lock:
        return [s.summary() for s in _sessions.values()]


@app.post("/benchmark")
async def post_benchmark(request: Request):
    """Create a session for a benchmark run and return it. Budget/badge
    bookkeeping is left to the runner/reward harness."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    label = (body or {}).get("label") or (body or {}).get("model") or "benchmark"
    with _sessions_lock:
        if len(_sessions) >= MAX_SESSIONS:
            return JSONResponse(
                {"error": f"session cap reached ({MAX_SESSIONS})",
                 "sessions": [s.summary() for s in _sessions.values()]},
                status_code=409,
            )
        sid = _alloc_id(set(_sessions))
        sess = _make_session(sid, label)
    with sess.lock:
        view = sess.view()
    return {
        "benchmarkId": sess.id,
        "sessionId": sess.id,
        "token": sess.token,
        "label": sess.label,
        "model": (body or {}).get("model"),
        "actionBudget": (body or {}).get("actionBudget"),
        "state": view,
    }


# ── viewer ───────────────────────────────────────────────────────────────────
# 4-up "couch" spectator page: a 2x2 grid, one cell per active session, each
# polling that session's /screen.png + /state a few times a second. Empty grid
# slots show "waiting". Dependency-free inline HTML/JS.
VIEWER_HTML = """<!doctype html><html><head><meta charset="utf-8">
<title>Pokémon Blue — couch mode</title>
<style>
 body{background:#0d0d0d;color:#d8d8d8;font-family:'Courier New',monospace;margin:0;padding:14px}
 h1{font-size:15px;color:#8bd;margin:0 0 12px}
 #grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:1040px}
 .cell{background:#141414;border:2px solid #2a2a2a;border-radius:8px;padding:10px;display:flex;gap:12px;min-height:216px}
 .cell.empty{align-items:center;justify-content:center;color:#555;font-size:14px;border-style:dashed}
 .scr{image-rendering:pixelated;width:320px;height:288px;background:#111;border:1px solid #333;border-radius:4px;flex:none}
 .info{min-width:150px;font-size:12px;line-height:1.6}
 .label{color:#8bd;font-size:13px;margin:0 0 6px;font-weight:bold}
 .k{color:#7a7a7a} .v{color:#e8e8e8}
 .batt{color:#e57}
</style></head><body>
 <h1>POKÉMON BLUE — couch mode (up to 4)</h1>
 <div id="grid"></div>
<script>
 const N=4;
 const grid=document.getElementById('grid');
 // Build 4 fixed cells once; fill/clear them as sessions come and go.
 const cells=[];
 for(let i=0;i<N;i++){
   const c=document.createElement('div');
   c.className='cell empty';
   c.innerHTML='waiting…';
   grid.appendChild(c);
   cells.push({el:c, sid:null, img:null, bodyEl:null, labelEl:null});
 }
 function mount(cell,sid,label){
   cell.sid=sid;
   cell.el.className='cell';
   cell.el.innerHTML=
     '<img class="scr">'+
     '<div class="info"><div class="label"></div><pre class="body"></pre></div>';
   cell.img=cell.el.querySelector('img');
   cell.labelEl=cell.el.querySelector('.label');
   cell.bodyEl=cell.el.querySelector('.body');
   cell.labelEl.textContent=label||sid;
 }
 function unmount(cell){
   cell.sid=null; cell.img=null;
   cell.el.className='cell empty';
   cell.el.innerHTML='waiting…';
 }
 async function discover(){
   try{
     const list=await (await fetch('/sessions')).json();
     const active=list.slice(0,N);
     const ids=active.map(s=>s.sessionId);
     // Drop cells whose session vanished.
     cells.forEach(c=>{ if(c.sid && !ids.includes(c.sid)) unmount(c); });
     // Assign each active session to a cell (existing slot or first empty).
     active.forEach(s=>{
       if(cells.some(c=>c.sid===s.sessionId)) return;
       const slot=cells.find(c=>c.sid===null);
       if(slot) mount(slot,s.sessionId,s.label);
     });
   }catch(e){}
 }
 async function tick(){
   for(const c of cells){
     if(!c.sid) continue;
     c.img.src='/screen.png?session='+encodeURIComponent(c.sid)+'&t='+Date.now();
     try{
       const s=await (await fetch('/state?session='+encodeURIComponent(c.sid))).json();
       const p=s.player||{};
       c.bodyEl.innerHTML=
         '<span class="k">map   </span><span class="v">'+(s.area&&s.area.id)+'</span>\\n'+
         '<span class="k">pos   </span><span class="v">x='+(p.position&&p.position.x)+' y='+(p.position&&p.position.y)+'</span>\\n'+
         '<span class="k">badges</span> <span class="v">'+p.badges+'</span>\\n'+
         '<span class="k">money </span><span class="v">$'+p.money+'</span>\\n'+
         '<span class="'+(s.in_battle?'batt':'k')+'">battle</span> <span class="v">'+(s.in_battle?'YES':'no')+'</span>';
     }catch(e){}
   }
 }
 discover(); tick();
 setInterval(discover,2000);
 setInterval(tick,333);
</script></body></html>"""


@app.get("/", response_class=HTMLResponse)
def viewer():
    return VIEWER_HTML


if __name__ == "__main__":
    import os
    import uvicorn

    # Railway (and any PaaS) injects the port to bind via $PORT.
    port = int(os.environ.get("PORT", "3100"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
