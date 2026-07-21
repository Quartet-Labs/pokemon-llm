"""FastAPI server: real Pokémon Blue in PyBoy behind the game API.

Multi-session ("couch mode"): the server holds a dict of independent `Emu`
instances (each its own PyBoy running the same ROM from the same overworld
savestate), capped at 4. Every request selects its session via `?session=X`;
a `default` session always exists so the single-agent runner keeps working with
no session param. Endpoints mirror the existing JS game server closely enough
that scripts/ollama-runner.py can be pointed here with
`--base http://127.0.0.1:3100`:

  GET  /state?session=X      RAM-derived game state (+ available_actions, goal)
  POST /action?session=X     apply a high-level action dict, step, return state;
                             an optional top-level "goal" string updates the
                             session's tracked goal
  GET  /logs?session=X       rolling per-session action history (oldest-first)
  POST /reset?session=X      reload the overworld savestate
  GET  /screen.png?session=X current Game Boy frame as PNG
  GET  /session?session=X    a session's snapshot
  POST /session {label?,goal?}  create a new session (up to 4), return id/token
  DELETE /session?session=X  remove a session (frees a slot); 404 if unknown,
                             400 for the default session
  GET  /sessions             list all sessions [{sessionId,label,goal}]
  POST /benchmark            create a session and return it

Run:  .venv/bin/python -m emulator.server
"""
from __future__ import annotations

import collections
import secrets
import threading

from fastapi import FastAPI, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse

from emulator import actions, ram_map
from emulator.emu import Emu

app = FastAPI(title="pokemon-llm emulator backend")

MAX_SESSIONS = 4
DEFAULT_SESSION_ID = "default"
# Max characters kept for a session's free-text agent goal.
MAX_GOAL_LEN = 200


def _clean_goal(raw) -> str | None:
    """Normalize an incoming goal value. Returns the trimmed/capped string, or
    None if `raw` is not a usable string (so callers can leave the goal
    unchanged). An empty/whitespace string clears the goal (returns "")."""
    if not isinstance(raw, str):
        return None
    return raw.strip()[:MAX_GOAL_LEN]


def _action_message(result: dict, state: dict) -> str:
    """Boil an action result + post-action state down to one human-readable
    line for the viewer's log (e.g. 'moved to (10, 4)', 'blocked (wall)',
    'pressed a', 'battle')."""
    result = result or {}
    if not result.get("ok"):
        return result.get("error") or "failed"
    if "moved" in result:
        to = result.get("to") or {}
        if result.get("moved"):
            return f"moved to ({to.get('x')}, {to.get('y')})"
        return result.get("reason") or "blocked"
    if result.get("pressed"):
        note = f"pressed {result['pressed']}"
        if state.get("in_battle"):
            note += " (in battle)"
        return note
    if result.get("waited"):
        return "waited"
    # Fallback: compact the result dict.
    return ", ".join(f"{k}={v}" for k, v in result.items() if k != "ok") or "ok"


class Session:
    """One independent emulator plus its own lock. PyBoy is not thread-safe, so
    each session gets a dedicated lock — locks are per-session so driving one
    session never blocks another (no global serialization)."""

    def __init__(self, session_id: str, label: str, token: str, goal: str = ""):
        self.id = session_id
        self.label = label
        self.token = token
        # Free-text "what am I trying to do right now" the agent can set/update.
        # Echoed back in every state view so the model sees its own last goal.
        self.goal = goal or ""
        self.emu = Emu(headless=True)
        self.lock = threading.Lock()
        # Rolling per-session action history. Each entry:
        #   {n, action, result, message}
        # Oldest-first (append to the right). Guarded by self.lock, same as the
        # emulator, so a log entry is always recorded atomically with the step
        # that produced it.
        self.log: collections.deque = collections.deque(maxlen=50)
        self._action_n = 0

    def view(self) -> dict:
        state = ram_map.read_state(self.emu)
        state["screen_png_b64"] = self.emu.screen_png_b64()
        state["available_actions"] = actions.AVAILABLE_ACTIONS
        # Echo the agent's current goal back so it can track/update it each turn.
        state["goal"] = self.goal
        return state

    def record_action(self, action: dict, result: dict, state: dict) -> dict:
        """Append one action to the rolling log. Call under self.lock. `state`
        is the post-action view, used to derive a short human-readable note."""
        self._action_n += 1
        entry = {
            "n": self._action_n,
            "action": action,
            "result": result,
            "message": _action_message(result, state),
            "goal": self.goal,
        }
        self.log.append(entry)
        return entry

    def summary(self) -> dict:
        return {"sessionId": self.id, "label": self.label, "goal": self.goal}


# Session registry. `_sessions_lock` guards the dict itself (create/list); each
# session's own lock guards its emulator. Keep them distinct so registry ops
# don't serialize emulator work.
_sessions: dict[str, Session] = {}
_sessions_lock = threading.Lock()


def _make_session(session_id: str, label: str, goal: str = "") -> Session:
    sess = Session(session_id, label, token=secrets.token_hex(8), goal=goal)
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
    # No default session — slots are filled only by named sessions from POST /session.
    pass


# ── state ────────────────────────────────────────────────────────────────────
@app.get("/state")
def get_state(request: Request):
    sess, err = _resolve_or_404(request)
    if err:
        return err
    with sess.lock:
        return sess.view()


# Max actions accepted in one queued /action request.
MAX_ACTION_SEQUENCE = 20


def _has_dialogue(view: dict) -> bool:
    """A textbox/dialogue is on screen (ram_map only sets `dialogue` when text
    is actually up)."""
    return bool(view.get("dialogue"))


def _abort_reason(prev_view: dict, view: dict, result: dict) -> str | None:
    """Decide whether a queued sequence should stop AFTER this step, based on the
    state before (`prev_view`) and after (`view`) it and the macro `result`.

    Returns a short reason string to stop, or None to keep going. We abort the
    instant something notable happens so a multi-step run never blindly walks
    past a battle, a room change, or a wall.
    """
    result = result or {}
    # Battle entered or left.
    if bool(prev_view.get("in_battle")) != bool(view.get("in_battle")):
        return "entered_battle" if view.get("in_battle") else "left_battle"
    # Map/area change (walked through a door, warp, or map edge).
    prev_area = (prev_view.get("area") or {}).get("id")
    area = (view.get("area") or {}).get("id")
    if prev_area != area:
        return "map_change"
    # A textbox/dialogue appeared that wasn't up before.
    if _has_dialogue(view) and not _has_dialogue(prev_view):
        return "dialogue"
    # A move that was blocked (wall/facing) — no point queuing more of the same.
    if "moved" in result and not result.get("moved"):
        return "blocked"
    return None


def _parse_action_body(body):
    """Normalize a /action body into a list of action dicts.

    Accepts, for back-compat and convenience:
      * a single action dict:        {"type": "move", ...}
      * a wrapped sequence:          {"actions": [<action>, ...]}
      * a bare JSON list:            [<action>, ...]
    Returns (actions_list, single_flag, error_str). `single_flag` marks a body
    that arrived as ONE action dict, so the response keeps the exact legacy shape.
    """
    if isinstance(body, dict) and "actions" in body:
        seq = body.get("actions")
        if not isinstance(seq, list):
            return None, False, "'actions' must be a list"
        return seq, False, None
    if isinstance(body, list):
        return body, False, None
    if isinstance(body, dict):
        return [body], True, None
    return None, False, "body must be a JSON action dict or {'actions': [...]}"


@app.post("/action")
async def post_action(request: Request):
    sess, err = _resolve_or_404(request)
    if err:
        return err
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "body must be a JSON action dict"}, status_code=400)

    # Optional top-level "goal": accepted alongside a single action dict or a
    # {"actions":[...]} wrapper (a bare list body carries no room for it). Update
    # the session's goal before stepping so the returned state echoes the new one.
    if isinstance(body, dict):
        goal = _clean_goal(body.get("goal"))
        if goal is not None:
            with sess.lock:
                sess.goal = goal

    action_list, single, perr = _parse_action_body(body)
    if perr:
        return JSONResponse({"error": perr}, status_code=400)
    if not action_list:
        return JSONResponse({"error": "no actions given"}, status_code=400)
    if len(action_list) > MAX_ACTION_SEQUENCE:
        return JSONResponse(
            {"error": f"too many actions ({len(action_list)} > {MAX_ACTION_SEQUENCE})"},
            status_code=400,
        )
    for a in action_list:
        if not isinstance(a, dict) or not a.get("type"):
            return JSONResponse({"error": "each action needs a 'type'"}, status_code=400)

    steps = []
    stopped_early = False
    stopped_reason = None
    with sess.lock:
        # Snapshot the pre-sequence state once; each step compares against the
        # state right before it so we detect the transition each action causes.
        # Per-step `state` is the RAM view WITHOUT the screenshot (read_state, not
        # Session.view) — it carries every field the reward/trajectory layer needs
        # (area, player, battle, map, dialogue) but stays cheap to embed per step.
        prev_state = ram_map.read_state(sess.emu)
        last_idx = len(action_list) - 1
        for i, action in enumerate(action_list):
            result = actions.apply_action(sess.emu, action)
            state = ram_map.read_state(sess.emu)
            sess.record_action(action, result, state)
            steps.append({"action": action, "result": result, "state": state})
            reason = _abort_reason(prev_state, state, result)
            if reason is not None:
                stopped_early = i != last_idx
                stopped_reason = reason
                break
            prev_state = state

    # Final returned view is the full state (with screenshot + available_actions),
    # same shape callers get today.
    with sess.lock:
        view = sess.view()
    view["action"] = steps[-1]["action"]
    view["result"] = steps[-1]["result"]
    view["steps"] = steps
    if stopped_reason is not None:
        # Report the reason even when it fired on the last step (informative);
        # `stopped_early` is only true if we aborted BEFORE finishing the list.
        view["stopped_reason"] = stopped_reason
    view["stopped_early"] = stopped_early
    return view


@app.get("/logs")
def get_logs(request: Request):
    """Per-session rolling action history. `log` is ordered most-recent-LAST
    (append order), each entry {n, action, result, message}. Optional
    ?limit=N returns only the newest N entries (still oldest-first)."""
    sess, err = _resolve_or_404(request)
    if err:
        return err
    limit_raw = request.query_params.get("limit")
    with sess.lock:
        entries = list(sess.log)
    if limit_raw:
        try:
            n = int(limit_raw)
            if n >= 0:
                entries = entries[-n:]
        except ValueError:
            pass
    return {"sessionId": sess.id, "log": entries}


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
    goal = _clean_goal((body or {}).get("goal")) or ""
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
        sess = _make_session(sid, label, goal=goal)
    return {"sessionId": sess.id, "token": sess.token, "label": sess.label,
            "goal": sess.goal}


@app.get("/sessions")
def get_sessions():
    with _sessions_lock:
        return [s.summary() for s in _sessions.values()]


@app.delete("/session")
def delete_session(request: Request):
    """Remove a session from the registry, freeing its couch slot without a
    redeploy. 404 if the session is unknown; 400 if it's the default session
    (which must always exist). A viewer polling a removed session just sees the
    slot go empty on its next /sessions discovery pass."""
    sid = request.query_params.get("session") or DEFAULT_SESSION_ID
    with _sessions_lock:
        sess = _sessions.pop(sid, None)
    if sess is None:
        return JSONResponse(
            {"error": f"unknown session {sid!r}"}, status_code=404
        )
    # Stop the PyBoy instance so the removed session frees its emulator too.
    # Guarded by the session's own lock so we don't yank it mid-step.
    with sess.lock:
        stop = getattr(sess.emu, "stop", None)
        if callable(stop):
            try:
                stop()
            except Exception:
                pass
    return {"deleted": sid}


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
 /* Per-slot tint drives the cell border/header via --pc (P1..P4 palette). */
 .cell{background:#141414;border:2px solid var(--pc,#2a2a2a);border-radius:8px;padding:10px;display:flex;gap:12px;min-height:216px;cursor:pointer;transition:box-shadow .15s}
 .cell.selected{box-shadow:0 0 12px var(--pc,#8bd)}
 .cell.empty{align-items:center;justify-content:center;color:#555;font-size:14px;border-style:dashed;border-color:#2a2a2a;cursor:default}
 .scr{image-rendering:pixelated;width:320px;height:288px;background:#111;border:1px solid #333;border-radius:4px;flex:none}
 .info{min-width:150px;font-size:12px;line-height:1.6}
 .label{font-size:13px;margin:0 0 6px;display:flex;align-items:center;gap:6px}
 .ptag{color:#000;background:var(--pc,#8bd);font-weight:bold;padding:1px 7px;border-radius:3px;letter-spacing:1px;font-size:11px}
 .plabel{color:var(--pc,#8bd);font-weight:bold;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
 .rm{margin-left:auto;color:#a55;background:#1a1010;border:1px solid #3a1a1a;border-radius:3px;font-size:11px;padding:0 6px;cursor:pointer;line-height:1.6}
 .rm:hover{color:#e77;border-color:#5a2a2a}
 .goal{color:#c9b06a;font-size:11px;font-style:italic;margin:0 0 6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:150px}
 .goal.empty{color:#555;font-style:normal}
 .k{color:#7a7a7a} .v{color:#e8e8e8}
 .batt{color:#e57}
 /* Detail panel */
 #detail{margin-top:16px;max-width:1040px;background:#111;border:1px solid #2a2a2a;border-left:4px solid var(--dpc,#2a2a2a);border-radius:6px;padding:12px;display:none}
 #detail.on{display:block}
 #detail h2{font-size:13px;margin:0 0 8px;display:flex;align-items:center;gap:8px}
 #detail .cols{display:grid;grid-template-columns:220px 1fr;gap:18px}
 .dstate div{font-size:12px;line-height:1.7}
 .party{margin-top:6px}
 .pmon{font-size:11px;color:#7ec8e3}
 .dlog{max-height:260px;overflow-y:auto;border:1px solid #22262e;border-radius:3px;background:#0a0a10}
 .dlog::-webkit-scrollbar{width:5px}.dlog::-webkit-scrollbar-thumb{background:#333}
 .le{display:grid;grid-template-columns:34px 1fr;gap:6px;padding:3px 7px;border-bottom:1px solid #141414;font-size:11px;line-height:1.4}
 .le:last-child{border-bottom:none}
 .le.now{background:#0a0f18}
 .le-n{color:#555;text-align:right}
 .le-act{color:#7ec8e3;font-weight:bold}
 .le-msg{color:#999}
 .loghdr{font-size:12px;color:var(--dpc,#8bd);margin:0 0 6px}
 .dmap{font-size:12px;line-height:1.1;color:#9fe0b0;background:#0a0a10;border:1px solid #22262e;border-radius:3px;padding:6px 8px;margin:0 0 12px;white-space:pre;overflow:auto;max-height:220px}
 .dmap .dlg{display:block;color:#e8d98b;margin-top:6px;white-space:pre-wrap}
</style></head><body>
 <h1>POKÉMON BLUE — couch mode (up to 4)</h1>
 <div id="grid"></div>
 <div id="detail">
   <h2><span class="ptag" id="d-tag">P1</span><span id="d-title" style="color:var(--dpc,#8bd)"></span></h2>
   <div class="cols">
     <div class="dstate" id="d-state"></div>
     <div>
       <div class="loghdr">MAP</div>
       <pre class="dmap" id="d-map"></pre>
       <div class="loghdr">RECENT ACTIONS</div>
       <div class="dlog" id="d-log"></div>
     </div>
   </div>
 </div>
<script>
 const N=4;
 // P1..P4 palette carried over from the old JS-engine viewer (public/index.html).
 const PCOLORS={1:'#e74c3c',2:'#3498db',3:'#2ecc71',4:'#f1c40f'};
 const grid=document.getElementById('grid');
 // Build 4 fixed cells once; fill/clear them as sessions come and go. Slot i
 // (0-based) is player P(i+1) and keeps its palette color for its lifetime.
 const cells=[];
 for(let i=0;i<N;i++){
   const c=document.createElement('div');
   c.className='cell empty';
   c.style.setProperty('--pc',PCOLORS[i+1]);
   c.innerHTML='waiting…';
   c.addEventListener('click',()=>selectSlot(i));
   grid.appendChild(c);
   cells.push({el:c, slot:i, sid:null, label:null, img:null, bodyEl:null, labelEl:null, goalEl:null, state:null});
 }
 let selected=-1;   // index into cells, or -1 = none
 function mount(cell,sid,label){
   cell.sid=sid; cell.label=label;
   cell.el.className='cell'+(cell.slot===selected?' selected':'');
   const rmBtn='<span class="rm" title="remove session">✕</span>';
   cell.el.innerHTML=
     '<img class="scr">'+
     '<div class="info"><div class="label"><span class="ptag">P'+(cell.slot+1)+'</span><span class="plabel"></span>'+rmBtn+'</div>'+
     '<div class="goal empty"></div><pre class="body"></pre></div>';
   cell.img=cell.el.querySelector('img');
   cell.labelEl=cell.el.querySelector('.plabel');
   cell.goalEl=cell.el.querySelector('.goal');
   cell.bodyEl=cell.el.querySelector('.body');
   cell.labelEl.textContent=(label||sid);
   const rm=cell.el.querySelector('.rm');
   if(rm) rm.addEventListener('click',(ev)=>{ev.stopPropagation();removeSession(cell.sid);});
 }
 function unmount(cell){
   cell.sid=null; cell.label=null; cell.img=null; cell.goalEl=null; cell.state=null;
   cell.el.className='cell empty';
   cell.el.innerHTML='waiting…';
   if(selected===cell.slot) updateDetail();
 }
 async function removeSession(sid){
   if(!sid) return;
   try{
     await fetch('/session?session='+encodeURIComponent(sid),{method:'DELETE'});
   }catch(e){}
   // The next discover() pass will unmount the now-gone slot; force one now so
   // the slot goes empty immediately.
   discover();
 }
 function selectSlot(i){
   if(!cells[i].sid) return;   // don't select an empty slot
   selected=i;
   cells.forEach(c=>c.el.classList.toggle('selected',c.slot===selected&&!!c.sid));
   updateDetail();
 }
 async function discover(){
   try{
     const list=await (await fetch('/sessions')).json();
     const active=list.slice(0,N);
     const ids=active.map(s=>s.sessionId);
     cells.forEach(c=>{ if(c.sid && !ids.includes(c.sid)) unmount(c); });
     active.forEach(s=>{
       const existing=cells.find(c=>c.sid===s.sessionId);
       if(existing){ existing.label=s.label; if(existing.labelEl) existing.labelEl.textContent=(s.label||s.sessionId); return; }
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
       c.state=s;
       const p=s.player||{};
       if(c.goalEl){
         const g=(s.goal||'').trim();
         c.goalEl.textContent=g?('▸ '+g):'no goal set';
         c.goalEl.className='goal'+(g?'':' empty');
         c.goalEl.title=g||'';
       }
       c.bodyEl.innerHTML=
         '<span class="k">map   </span><span class="v">'+(s.area&&s.area.id)+'</span>\\n'+
         '<span class="k">pos   </span><span class="v">x='+(p.position&&p.position.x)+' y='+(p.position&&p.position.y)+'</span>\\n'+
         '<span class="k">badges</span> <span class="v">'+p.badges+'</span>\\n'+
         '<span class="k">money </span><span class="v">$'+p.money+'</span>\\n'+
         '<span class="'+(s.in_battle?'batt':'k')+'">battle</span> <span class="v">'+(s.in_battle?'YES':'no')+'</span>';
     }catch(e){}
   }
   if(selected>=0 && cells[selected].sid) updateDetail();
 }
 function fmtAction(a){
   if(!a) return '—';
   const t=a.type||'?';
   if(t==='move') return 'move '+(a.direction||'');
   return t;
 }
 async function updateDetail(){
   const panel=document.getElementById('detail');
   const c=(selected>=0)?cells[selected]:null;
   if(!c || !c.sid){ panel.classList.remove('on'); return; }
   const col=PCOLORS[c.slot+1];
   panel.classList.add('on');
   panel.style.setProperty('--dpc',col);
   document.getElementById('d-tag').textContent='P'+(c.slot+1);
   document.getElementById('d-tag').style.background=col;
   document.getElementById('d-title').textContent=(c.label||c.sid);
   const s=c.state||{};
   const p=s.player||{};
   const pos=p.position||{};
   const party=(p.party||[]);
   const esc=t=>t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
   const goalTxt=(s.goal||'').trim();
   document.getElementById('d-state').innerHTML=
     '<div><span class="k">session </span><span class="v">'+c.sid+'</span></div>'+
     '<div><span class="k">goal    </span><span class="v" style="color:#c9b06a">'+(goalTxt?esc(goalTxt):'—')+'</span></div>'+
     '<div><span class="k">map     </span><span class="v">'+(s.area&&s.area.id)+'</span></div>'+
     '<div><span class="k">pos     </span><span class="v">x='+pos.x+' y='+pos.y+'</span></div>'+
     '<div><span class="k">badges  </span><span class="v">'+p.badges+'</span></div>'+
     '<div><span class="k">money   </span><span class="v">$'+p.money+'</span></div>'+
     '<div><span class="'+(s.in_battle?'batt':'k')+'">battle  </span><span class="v">'+(s.in_battle?'YES':'no')+'</span></div>'+
     '<div class="party">'+(party.length
        ? party.map(m=>'<div class="pmon">'+m.name+' L'+m.level+' — '+m.hp+'</div>').join('')
        : '<span class="k">no party</span>')+'</div>';
   // ASCII map + dialogue (now top-level on the state: s.map / s.dialogue).
   const mapEl=document.getElementById('d-map');
   const ascii=(s.map&&s.map.ascii)||'';
   const dlg=(s.dialogue&&s.dialogue.text)||'';
   if(ascii||dlg){
     mapEl.innerHTML=esc(ascii)+(dlg?'<span class="dlg">'+esc(dlg)+'</span>':'');
   }else{
     mapEl.textContent=s.in_battle?'(in battle)':'—';
   }
   try{
     const data=await (await fetch('/logs?session='+encodeURIComponent(c.sid)+'&limit=25')).json();
     const log=data.log||[];
     const body=document.getElementById('d-log');
     if(!log.length){ body.innerHTML='<div class="le"><span class="le-n"></span><span class="le-msg">No actions yet.</span></div>'; return; }
     // server returns oldest-first; show newest at the top of the list
     body.innerHTML=log.slice().reverse().map((e,i)=>
       '<div class="le'+(i===0?' now':'')+'"><span class="le-n">'+e.n+'</span>'+
       '<span><span class="le-act">'+fmtAction(e.action)+'</span> '+
       '<span class="le-msg">'+(e.message||'')+'</span></span></div>').join('');
   }catch(e){}
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
