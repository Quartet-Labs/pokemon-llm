#!/usr/bin/env python3
"""Drive a pokemon-llm session with a local open-source LLM via Ollama TOOL CALLS.

The whole point: a local model (running on the desktop's Ollama) decides each
turn by emitting a native function/tool call, and that tool call's arguments are
POSTed straight to the game API. Local LLM does tool calls; tool calls hit the
endpoint.

Loop mirrors scripts/llm-runner.py (Claude-CLI driver): open a benchmark session,
GET /state -> model picks an action -> POST /action, stop at the target badge,
poke Amos with the outcome. The only difference is the brain: Ollama /api/chat
with a `tools` array instead of the `claude` CLI.

Usage:
  python3 scripts/ollama-runner.py --model qwen3:32b --goal-badges 1
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

# Reusable training layer: reward function + trajectory logger. Both live in
# scripts/ next to this driver; import them by adding scripts/ to sys.path so the
# runner works regardless of the cwd it's launched from.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reward import compute_reward  # noqa: E402
from trajectory import TrajectoryLogger  # noqa: E402

# Single tool the model calls each turn. `type` is always required; the other
# fields are filled in only when the chosen action needs them. The game server
# validates the resulting action, so an over-broad schema is fine.
TOOLS = [{
    "type": "function",
    "function": {
        "name": "submit_action",
        "description": "Submit exactly one game action for the current turn. "
                       "Only the fields relevant to the chosen `type` are used.",
        "parameters": {
            "type": "object",
            "properties": {
                "type": {"type": "string",
                         "enum": ["move", "talk", "choose_starter", "battle_move",
                                  "run", "throw_ball", "use_item", "switch"],
                         "description": "The action to take. 'talk' advances dialogue."},
                "direction": {"type": "string", "enum": ["north", "south", "east", "west"],
                              "description": "For type=move. The engine only accepts "
                                             "north/south/east/west (not up/down/left/right)."},
                "species": {"type": "string", "enum": ["bulbasaur", "charmander", "squirtle"],
                            "description": "For type=choose_starter."},
                "move_index": {"type": "integer", "description": "0-3, for type=battle_move."},
                "item": {"type": "string", "description": "For type=use_item, e.g. 'potion'."},
                "target_index": {"type": "integer", "description": "Party slot 0-5, for type=use_item."},
                "ball": {"type": "string", "description": "For type=throw_ball, e.g. 'poke_ball'."},
                "party_index": {"type": "integer", "description": "Party slot 0-5, for type=switch."},
            },
            "required": ["type"],
        },
    },
}]

# Keys we forward to the game API for each action type (drop the rest).
ACTION_KEYS = {"type", "direction", "species", "move_index", "item",
               "target_index", "ball", "party_index"}

SYSTEM = """You are playing a Gen-1 Pokemon game. Each turn you are given the game \
state and you MUST respond by calling the submit_action tool exactly once. Do not \
write prose — just call the tool.

Your goal: earn the BOULDER BADGE (the first gym badge), then stop.

Route to the Boulder Badge (Gen-1 accurate):
- First choose a starter (screen "starter_select"). Pick squirtle.
- Movement directions are north, south, east, west (NOT up/down/left/right).
- You start inside Oak's Lab. Prof. Oak stands to the NORTH and blocks that wall \
-- do not walk into him. Leave the lab by moving SOUTH to the door.
- Then head north into the grass, through Viridian City, up Route 2, through \
Viridian Forest, out the north side to Pewter City.
- The Pewter City gym holds the Boulder Badge. Leader Brock uses ROCK/GROUND \
Pokemon (Geodude, Onix); Water and Grass moves are super-effective, Normal moves \
are weak against Rock. Grind a few levels on wild Pokemon first so Brock doesn't \
wipe you.
- In wild battles you may run; in trainer/gym battles you cannot -- fight with \
your best move.
- When dialogue is active, call submit_action with type "talk" to advance it.

The state each turn includes an `available_actions` list -- your action must be \
one of those forms."""


def http_get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def http_post(url, body, token=None):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def compact_state(view):
    keep = {k: view.get(k) for k in
            ("turn", "screen", "area", "message", "dialogue_active", "dialogue",
             "available_actions", "hint", "starter_options")}
    p = view.get("player", {})
    keep["player"] = {
        "position": p.get("position"),
        "surroundings": p.get("surroundings"),
        "badges": p.get("badges"),
        "money": p.get("money"),
        "bag": p.get("bag"),
        "party": p.get("party"),
    }
    if "battle" in view:
        keep["battle"] = view["battle"]
    return keep


def ollama_decide(ollama, model, system, user):
    """Ask the local model for one action via a native tool call.

    Returns the action dict (from tool-call args) or None if the model produced
    no usable tool call. Prefers native tool_calls; falls back to parsing a JSON
    object out of message content only if the model returned no tool_calls.
    """
    # qwen3 and other hybrid-reasoning models emit long think-chains before the
    # tool call by default (60-1400s/turn, wildly variable). "/no_think" disables
    # that per-message and still returns a clean tool call in a few seconds. (The
    # native `think: false` param can't be combined with `tools` here — it returns
    # an empty response — so we steer via the prompt instead.)
    body = {
        "model": model,
        "stream": False,
        "keep_alive": "30m",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": "/no_think\n" + user},
        ],
        "tools": TOOLS,
        # num_ctx 4096 keeps a 32B model's KV cache small enough to fit fully in a
        # 24GB GPU alongside the desktop — without it qwen3:32b spills and runs at
        # ~40s/turn instead of ~5s. Game prompts are well under 4k tokens.
        "options": {"temperature": 0.4, "num_ctx": 4096},
    }
    resp = http_post(f"{ollama}/api/chat", body)
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
        import re
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            try:
                args = json.loads(m.group(0))
                if isinstance(args, dict) and args.get("type"):
                    return {k: v for k, v in args.items() if k in ACTION_KEYS and v is not None}
            except json.JSONDecodeError:
                pass
    return None


def poke_amos(msg):
    poke = "/home/carmody/.karakos/workspace/bin/poke-amos.sh"
    if os.path.exists(poke):
        os.system(f"{poke} --source ollama-runner {json.dumps(msg)} >/dev/null 2>&1")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://pokemon-llm-production.up.railway.app",
                    help="Game server base URL.")
    ap.add_argument("--ollama", default="http://192.168.1.185:11434",
                    help="Ollama base URL (desktop).")
    ap.add_argument("--model", default="qwen3:32b",
                    help="Local model. Must support Ollama tool calling (qwen3:32b, llama3:70b).")
    ap.add_argument("--goal-badges", type=int, default=1)
    ap.add_argument("--budget", type=int, default=4000)
    ap.add_argument("--max-turns", type=int, default=4000)
    ap.add_argument("--label", default="qwen3:32b · Boulder Badge")
    ap.add_argument("--sleep", type=float, default=0.3)
    ap.add_argument("--logfile", default="/home/carmody/.karakos/workspace/data/ollama-run.jsonl")
    # Trajectory logging is ON by default: every episode writes a training-ready
    # JSONL to data/trajectories/<session_id>.jsonl (full view + reward per turn).
    ap.add_argument("--log-trajectories", dest="log_trajectories",
                    action="store_true", default=True,
                    help="Write per-turn reward + full-view trajectory JSONL (default on).")
    ap.add_argument("--no-log-trajectories", dest="log_trajectories",
                    action="store_false",
                    help="Disable trajectory logging.")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    ollama = args.ollama.rstrip("/")

    bench = http_post(f"{base}/benchmark",
                      {"model": args.model, "actionBudget": args.budget, "label": args.label})
    sid, token = bench["sessionId"], bench["token"]
    seed = bench.get("seed")
    log = open(args.logfile, "w")

    def record(obj):
        obj["t"] = int(time.time())
        log.write(json.dumps(obj) + "\n")
        log.flush()

    # Training trajectory logger (reward + full-view JSONL per turn). Separate
    # from the operational `log` above — this one is the SFT/GRPO training feed.
    traj = TrajectoryLogger(sid, seed=seed, model=args.model) if args.log_trajectories else None

    record({"event": "start", "session": sid, "seed": seed, "model": args.model,
            "ollama": ollama, "spectate": f"{base}/", "budget": args.budget,
            "trajectories": traj.path if traj else None})
    print(f"[ollama-runner] session={sid} seed={seed} model={args.model}", flush=True)
    print(f"[ollama-runner] watch: {base}/", flush=True)

    history = []
    reached = False
    turn = 0
    consecutive_errors = 0

    while turn < args.max_turns:
        turn += 1
        try:
            view = http_get(f"{base}/state?session={sid}")
        except Exception as e:
            record({"event": "state_error", "turn": turn, "error": str(e)})
            time.sleep(2)
            consecutive_errors += 1
            if consecutive_errors > 20:
                break
            continue

        badges = (view.get("player") or {}).get("badges", 0)
        if badges >= args.goal_badges:
            reached = True
            record({"event": "goal_reached", "turn": turn, "badges": badges})
            break

        hist_txt = "\n".join(
            f"  {i+1}. did {json.dumps(h[0])} -> {h[1]}" for i, h in enumerate(history[-10:])
        ) or "  (none yet)"
        user = (f"Recent actions:\n{hist_txt}\n\n"
                f"Current state:\n{json.dumps(compact_state(view))}\n\n"
                f"Call submit_action with your one action for this turn.")

        try:
            action = ollama_decide(ollama, args.model, SYSTEM, user)
        except Exception as e:
            record({"event": "ollama_error", "turn": turn, "error": str(e)})
            time.sleep(3)
            consecutive_errors += 1
            if consecutive_errors > 20:
                break
            continue

        if not action:
            # No usable tool call. Don't play for the agent — log and re-request.
            record({"event": "no_tool_call", "turn": turn})
            time.sleep(args.sleep)
            continue

        try:
            result = http_post(f"{base}/action?session={sid}", action, token=token)
        except Exception as e:
            record({"event": "action_error", "turn": turn, "action": action, "error": str(e)})
            time.sleep(1)
            consecutive_errors += 1
            if consecutive_errors > 20:
                break
            continue

        consecutive_errors = 0
        if result.get("halted") or result.get("outcome") not in (None, "ongoing"):
            record({"event": "server_stop", "turn": turn, "result": result})
            reached_badge = str(result.get("outcome", "")).startswith("badge")
            if reached_badge:
                reached = True
            # Terminal reward: the /action payload here is a stop/summary object,
            # not a full view. `view` (from /state) is the last real observation;
            # score the terminal transition against the stop message so a
            # badge-earning final turn still records its BADGE reward. We hand
            # compute_reward a synthetic result_view that carries the (possibly
            # bumped) badge count and the terminal area so the delta is correct.
            if traj:
                stop_msg = result.get("message") or ""
                stop_view = {
                    "area": view.get("area"),
                    "message": stop_msg,
                    "player": {
                        "badges": badges + (1 if reached_badge else 0),
                        "position": (view.get("player") or {}).get("position"),
                    },
                    # No map on a stop payload -> no new-tile signal, which is
                    # correct for a terminal transition.
                }
                r, bd = compute_reward(view, action, stop_view, stop_msg)
                traj.log_turn(turn, state=view, action=action, reward=r,
                              reward_breakdown=bd, done=True)
            break

        # Normal turn: `result` IS the next full view (server returns getView()).
        msg = result.get("message") or (result.get("state") or {}).get("message") or ""
        if traj:
            r, bd = compute_reward(view, action, result, msg)
            # `state` is the FULL view the model saw this turn (view from /state),
            # so the row is replayable as an SFT prompt.
            traj.log_turn(turn, state=view, action=action, reward=r,
                          reward_breakdown=bd, done=False)
        history.append((action, msg[:120]))
        record({"event": "turn", "turn": turn, "badges": badges, "action": action, "msg": msg[:160]})
        time.sleep(args.sleep)

    if traj:
        traj.log_summary(reached=reached)
        traj.close()
    log.close()
    if reached:
        poke_amos(f"OLLAMA POKEMON RUN: {args.model} earned the Boulder Badge in {turn} turns "
                  f"(session {sid}). Log: {args.logfile}. Report to Mike.")
        print(f"[ollama-runner] DONE — Boulder Badge in {turn} turns", flush=True)
    else:
        poke_amos(f"OLLAMA POKEMON RUN ended without the Boulder Badge after {turn} turns "
                  f"({args.model}, session {sid}). Check {args.logfile}. Brief Mike.")
        print(f"[ollama-runner] ended without badge after {turn} turns", flush=True)


if __name__ == "__main__":
    main()
