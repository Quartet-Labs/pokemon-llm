#!/usr/bin/env python3
"""Full emulator runner for pokemon-llm — the proper replacement for the stopgap
`emulator/haiku_loop.py`.

Opens its OWN session on the emulator backend (`emulator/server.py`, live at
https://pokemon-llm-production.up.railway.app), plays the REAL Pokémon Blue via
tool calls, logs a training-ready trajectory (state, action, reward, breakdown)
per turn, and stops when it hits a badge target or a turn cap.

Two brains, one loop:
  * DEFAULT — a local open-weight model on the desktop's Ollama, driven by native
    tool calls (qwen3:32b, `/no_think`, num_ctx 4096). Same pattern as
    scripts/ollama-runner.py::ollama_decide.
  * FALLBACK — Claude via the `claude` CLI (`--claude`), the way haiku_loop does
    it (no API key needed). Emits a JSON action which we parse.

The reward + trajectory layers (scripts/reward.py, scripts/trajectory.py) are the
SAME modules the JS-engine runners use, imported unchanged — they degrade
gracefully to the emulator's (currently thinner) state shape via defensive
getters. See reward.py's "EMULATOR-STATE COMPATIBILITY" note.

Usage:
  # Ollama qwen3:32b (default), stop at 1 badge or 200 turns:
  .venv/bin/python -m emulator.runner --goal-badges 1 --max-turns 200

  # Claude Haiku fallback:
  .venv/bin/python -m emulator.runner --claude --max-turns 50
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

# Reuse the training layer (reward + trajectory logger). They live in scripts/;
# add that dir to sys.path so this module imports them regardless of cwd. Also
# add the repo root so `from emulator import ...` style imports keep working when
# run as a module.
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_ROOT, "scripts"))
from reward import RewardTracker  # noqa: E402
from trajectory import TrajectoryLogger  # noqa: E402


# ── tool schema ──────────────────────────────────────────────────────────────
# Built from the emulator's actual action grammar (emulator/actions.py:
# AVAILABLE_ACTIONS -> move / a / talk / b / start / select / wait). The battle
# verbs are advertised too so the model has the vocabulary once the emulator maps
# them, but today the macro layer returns {partial: true, "not implemented"} for
# them — they score as illegal, which is the honest signal. `type` is the only
# required field; the server validates the rest, so an over-broad schema is safe.
TOOLS = [{
    "type": "function",
    "function": {
        "name": "submit_action",
        "description": "Submit exactly one game action for the current turn. "
                       "Only the fields relevant to the chosen `type` are used.",
        "parameters": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["move", "a", "talk", "b", "start", "select", "wait",
                             "battle_move", "use_item", "throw_ball", "switch"],
                    "description": "The action. move=walk one tile; a=press A "
                                   "(talk/confirm/advance text); b=press B "
                                   "(cancel); start=open menu; wait=pass a beat. "
                                   "battle_move/use_item/throw_ball/switch are not "
                                   "wired up yet and will be rejected.",
                },
                "direction": {
                    "type": "string",
                    "enum": ["north", "south", "east", "west"],
                    "description": "For type=move. Only north/south/east/west "
                                   "(NOT up/down/left/right).",
                },
                "move_index": {"type": "integer",
                               "description": "0-3, for type=battle_move (unsupported)."},
                "item": {"type": "string",
                         "description": "For type=use_item (unsupported)."},
                "ball": {"type": "string",
                         "description": "For type=throw_ball (unsupported)."},
                "party_index": {"type": "integer",
                                "description": "Party slot 0-5, for type=switch (unsupported)."},
            },
            "required": ["type"],
        },
    },
}]

# Keys we forward to the game API (drop everything else the model may echo).
ACTION_KEYS = {"type", "direction", "move_index", "item", "ball", "party_index"}


# ── prompt ───────────────────────────────────────────────────────────────────
# Emulator-appropriate: this is the REAL Pokémon Blue, and the savestate drops
# the player in the character's bedroom (map 38). The goal is to get out of the
# house and start progressing. Adapted from haiku_loop.SYSTEM, extended with the
# tool-call contract and stronger anti-wall-bump guidance since we feed per-turn
# "moved vs blocked" feedback.
SYSTEM = """You are an agent playing the REAL Pokémon Blue (Game Boy) through an \
API. You start in your character's bedroom on the upper floor of your house \
(map id 38). Your job: explore the room, find the stairs, get downstairs and out \
of the house, then head out into the world and make progress.

Each turn you receive the game state (map/area id, your x/y position, party, \
whether you're in a battle, and the list of available_actions) plus a short log \
of your recent actions and whether each one WORKED (moved) or was BLOCKED (wall). \
You MUST respond by calling the submit_action tool exactly once. Do not write \
prose.

Actions:
  submit_action(type="move", direction="north")   walk one tile (or south/east/west)
  submit_action(type="a")       press A — talk to people/signs, confirm, advance text
  submit_action(type="talk")    same as A (advance dialogue)
  submit_action(type="b")       press B — cancel / back out
  submit_action(type="start")   open the menu
  submit_action(type="wait")    pass a beat

Rules:
- Directions are north, south, east, west — NEVER up/down/left/right.
- If your recent log shows a direction was BLOCKED last turn, that way is a wall \
or an obstacle — pick a DIFFERENT direction. Do NOT repeat a move that just \
failed.
- To leave a room, walk toward unexplored edges to find the stairs/door.
- Vary your exploration; don't oscillate between two tiles. Your x/y position \
tells you where you are — use it to avoid retracing.
- battle_move / use_item / throw_ball / switch are not supported yet; if you try \
them they'll be rejected. Stick to move/a/talk/b/start/wait."""


# ── http helpers ─────────────────────────────────────────────────────────────
def http_get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def http_post(url, body, token=None, timeout=300):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


# ── state formatting ─────────────────────────────────────────────────────────
def compact_state(view):
    """Strip the screenshot and keep the fields the model needs to decide.

    Drops `screen_png_b64` (huge, useless to a text model) and passes through the
    emulator's useful fields plus `available_actions`. Defensive about which keys
    exist so it works on a /state view, a /action view, and a benchmark view.
    """
    keep = {k: view.get(k) for k in ("screen", "area", "in_battle",
                                     "available_actions")
            if k in view}
    p = view.get("player") or {}
    keep["player"] = {
        "position": p.get("position"),
        "badges": p.get("badges"),
        "money": p.get("money"),
        "party": p.get("party"),
    }
    return keep


def _feedback(action, result):
    """One-line 'moved vs blocked' feedback for the recent-action log, derived
    from the macro `result` dict the emulator returns on /action."""
    result = result or {}
    label = action.get("direction") or action.get("type")
    if not result.get("ok"):
        return f"{label}: rejected ({result.get('error', 'failed')})"
    if "moved" in result:
        to = result.get("to") or {}
        if result.get("moved"):
            return f"{label}: moved to ({to.get('x')},{to.get('y')})"
        return f"{label}: BLOCKED ({result.get('reason', 'wall')})"
    if result.get("pressed"):
        return f"{label}: pressed {result['pressed']}"
    if result.get("waited"):
        return f"{label}: waited"
    return f"{label}: ok"


# ── brains ───────────────────────────────────────────────────────────────────
def ollama_decide(ollama, model, system, user, timeout=300):
    """Ask the local model for one action via a native tool call. Returns the
    action dict (filtered to ACTION_KEYS) or None. Copied from
    scripts/ollama-runner.py: `/no_think` disables qwen3's think-chain (native
    `think:false` can't combine with `tools`), num_ctx 4096 keeps the KV cache in
    GPU."""
    body = {
        "model": model,
        "stream": False,
        "keep_alive": "30m",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": "/no_think\n" + user},
        ],
        "tools": TOOLS,
        "options": {"temperature": 0.4, "num_ctx": 4096},
    }
    resp = http_post(f"{ollama}/api/chat", body, timeout=timeout)
    msg = resp.get("message", {}) or {}
    calls = msg.get("tool_calls") or []
    if calls:
        args = calls[0].get("function", {}).get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = None
        if isinstance(args, dict) and args.get("type"):
            return {k: v for k, v in args.items() if k in ACTION_KEYS and v is not None}
    # Fallback: some models emit the action as JSON text instead of a tool call.
    content = (msg.get("content") or "").strip()
    if content:
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            try:
                args = json.loads(m.group(0))
                if isinstance(args, dict) and args.get("type"):
                    return {k: v for k, v in args.items()
                            if k in ACTION_KEYS and v is not None}
            except json.JSONDecodeError:
                pass
    return None


def claude_decide(model, system, user, timeout=60):
    """Ask Claude via the `claude` CLI for one action (haiku_loop pattern). No API
    key needed; parses the first JSON object out of stdout."""
    out = subprocess.run(
        ["claude", "-p", "--model", model, "--append-system-prompt", system],
        input=user, capture_output=True, text=True, timeout=timeout,
    ).stdout
    m = re.search(r"\{.*\}", out, re.DOTALL)
    if not m:
        return None
    try:
        args = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if isinstance(args, dict) and args.get("type"):
        return {k: v for k, v in args.items() if k in ACTION_KEYS and v is not None}
    return None


def poke_amos(msg):
    poke = "/home/carmody/.karakos/workspace/bin/poke-amos.sh"
    if os.path.exists(poke):
        os.system(f"{poke} --source emu-runner {json.dumps(msg)} >/dev/null 2>&1")


# ── main loop ────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Full emulator runner for pokemon-llm.")
    ap.add_argument("--base", default="https://pokemon-llm-production.up.railway.app",
                    help="Emulator backend base URL.")
    ap.add_argument("--ollama", default="http://192.168.1.185:11434",
                    help="Ollama base URL (desktop). Used unless --claude.")
    ap.add_argument("--model", default="qwen3:32b",
                    help="Ollama model (native tool calling required). Default qwen3:32b.")
    ap.add_argument("--claude", action="store_true",
                    help="Use the `claude` CLI instead of Ollama (fallback brain).")
    ap.add_argument("--claude-model", default="claude-haiku-4-5-20251001",
                    help="Model id for --claude mode.")
    ap.add_argument("--label", default=None,
                    help="Session label (default derives from the brain).")
    ap.add_argument("--max-turns", type=int, default=200)
    ap.add_argument("--goal-badges", type=int, default=1,
                    help="Stop once player.badges >= this. 0 disables the goal.")
    ap.add_argument("--sleep", type=float, default=0.3)
    ap.add_argument("--use-benchmark", action="store_true",
                    help="Open the session via POST /benchmark (returns a token) "
                         "instead of POST /session.")
    ap.add_argument("--log-trajectories", dest="log_trajectories",
                    action="store_true", default=True,
                    help="Write per-turn reward + full-view trajectory JSONL (default on).")
    ap.add_argument("--no-log-trajectories", dest="log_trajectories",
                    action="store_false", help="Disable trajectory logging.")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    ollama = args.ollama.rstrip("/")
    brain = "claude:" + args.claude_model if args.claude else "ollama:" + args.model
    label = args.label or brain

    # ── open OUR OWN session (never touch default/p1) ────────────────────────
    token = None
    if args.use_benchmark:
        sess = http_post(f"{base}/benchmark", {"label": label, "model": brain})
        token = sess.get("token")
    else:
        sess = http_post(f"{base}/session", {"label": label})
        token = sess.get("token")
    sid = sess["sessionId"]
    print(f"[emu-runner] session={sid} brain={brain} base={base}/", flush=True)
    print(f"[emu-runner] watch: {base}/  (session {sid})", flush=True)

    # ── training layer ───────────────────────────────────────────────────────
    traj = (TrajectoryLogger(sid, model=brain) if args.log_trajectories else None)
    reward_tracker = RewardTracker()   # one per episode: cross-turn novelty memory
    if traj:
        print(f"[emu-runner] trajectory -> {traj.path}", flush=True)

    history = []           # [(action, feedback_str), ...]
    reached = False
    consecutive_errors = 0
    turn = 0

    while turn < args.max_turns:
        turn += 1
        # 1) observe
        try:
            view = http_get(f"{base}/state?session={sid}")
        except Exception as e:
            print(f"[emu-runner] state error t{turn}: {e}", flush=True)
            consecutive_errors += 1
            if consecutive_errors > 20:
                break
            time.sleep(2)
            continue

        # 2) goal check
        badges = (view.get("player") or {}).get("badges", 0) or 0
        if args.goal_badges and badges >= args.goal_badges:
            reached = True
            print(f"[emu-runner] GOAL: {badges} badge(s) at turn {turn}", flush=True)
            break

        # 3) decide
        hist_txt = "\n".join(f"  {i+1}. {h[1]}" for i, h in enumerate(history[-8:])) \
            or "  (none yet)"
        user = (f"Recent actions:\n{hist_txt}\n\n"
                f"Current state:\n{json.dumps(compact_state(view))}\n\n"
                f"Call submit_action with your one action for this turn.")
        try:
            if args.claude:
                action = claude_decide(args.claude_model, SYSTEM, user)
            else:
                action = ollama_decide(ollama, args.model, SYSTEM, user)
        except Exception as e:
            print(f"[emu-runner] decide error t{turn}: {e}", flush=True)
            consecutive_errors += 1
            if consecutive_errors > 20:
                break
            time.sleep(3)
            continue

        if not action:
            # No usable action from the model — log and re-request, don't fake one.
            print(f"[emu-runner] no action t{turn}", flush=True)
            time.sleep(args.sleep)
            continue

        # 4) act — the /action response IS the next full view (+action/+result).
        try:
            result_view = http_post(f"{base}/action?session={sid}", action, token=token)
        except Exception as e:
            print(f"[emu-runner] action error t{turn}: {e}", flush=True)
            consecutive_errors += 1
            if consecutive_errors > 20:
                break
            time.sleep(1)
            continue
        consecutive_errors = 0

        macro = result_view.get("result") or {}
        fb = _feedback(action, macro)
        # reward.py keys illegal-moves off a message string; give it the macro's
        # human-readable reason so "blocked (wall or facing)" is scored -ILLEGAL.
        result_msg = _feedback(action, macro).split(": ", 1)[-1]

        # 5) reward + trajectory (state = the full view the model saw THIS turn,
        # minus the redundant base64 screenshot — ~3KB/turn of dead weight that
        # bloats the JSONL without adding replay value; every game field stays).
        if traj:
            r, bd = reward_tracker.step(view, action, result_view, result_msg)
            log_state = {k: v for k, v in view.items() if k != "screen_png_b64"}
            traj.log_turn(turn, state=log_state, action=action, reward=r,
                          reward_breakdown=bd, done=False)

        history.append((action, fb))
        pos = ((result_view.get("player") or {}).get("position")) or {}
        print(f"[emu-runner] t{turn} {json.dumps(action)} -> {fb} "
              f"pos=({pos.get('x')},{pos.get('y')})", flush=True)
        time.sleep(args.sleep)

    # ── wrap up ──────────────────────────────────────────────────────────────
    if traj:
        traj.log_summary(reached=reached)
        traj.close()
    tag = "reached goal" if reached else f"ended after {turn} turns"
    print(f"[emu-runner] DONE — {tag} (session {sid})", flush=True)


if __name__ == "__main__":
    main()
