#!/usr/bin/env python3
"""Drive a pokemon-llm session with a Claude model via the Messages API.

The game server (server.js) holds the game state and broadcasts every action to
the browser viewer over WebSocket, so a human can watch this agent play live.

This runner:
  1. opens a benchmark session (auto badge + budget tracking, no rate limit),
  2. each turn: GET /state -> ask the model for ONE action -> POST /action,
  3. stops when the target badge count is reached (default 1 = Boulder Badge),
  4. pokes Amos with the outcome so he can report back.

Usage:
  ANTHROPIC_API_KEY=... python3 scripts/llm-runner.py \
      --port 3010 --model claude-haiku-4-5-20251001 --goal-badges 1
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

SYSTEM = """You are playing a Gen-1 Pokemon game through a REST API. You see the \
game state as JSON and reply with exactly ONE action as JSON.

Your goal: earn the BOULDER BADGE (the first gym badge). Reach it as directly as \
you can, then stop.

Route to the Boulder Badge (Gen-1 accurate):
- First you must choose a starter (screen "starter_select"). Pick squirtle.
- You start inside Oak's Lab. Prof. Oak stands to the NORTH and blocks that wall \
-- do not walk into him repeatedly. EXIT the lab by walking DOWN/south to the \
door at the bottom of the room.
- Once outside in Pallet Town, THEN head north into the grass, through Viridian \
City, up Route 2, into Viridian Forest, out the north side to Pewter City.
- The Pewter City gym holds the Boulder Badge. Its leader Brock uses ROCK/GROUND \
Pokemon (Geodude, Onix). Water and Grass moves are super-effective; Normal moves \
like Tackle are weak against Rock. Grind a few levels on wild Pokemon in the \
grass/forest BEFORE fighting Brock so you don't get wiped.
- In wild battles you may `run` to save HP; in trainer/gym battles you cannot run \
-- fight with your best move.

Rules for your reply:
- The state includes an `available_actions` list and often a `hint`. Your action \
MUST be one of those forms.
- When `dialogue_active` is true, reply {"type":"talk"} to advance the text.
- Reply with ONLY the JSON object for one action. No prose, no code fences.
Examples: {"type":"move","direction":"up"}  {"type":"talk"}  \
{"type":"choose_starter","species":"squirtle"}  {"type":"battle_move","move_index":0}  \
{"type":"run"}"""


def http_get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def http_post(url, body, token=None):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def call_model(model, system, user, timeout=90):
    """Ask a Claude model for one action via the local `claude` CLI.

    Uses the CLI (OAuth auth) rather than the raw API because the Pi has no
    standalone ANTHROPIC_API_KEY. Prompt goes in on stdin so large JSON state
    never hits argv length/escaping limits.
    """
    proc = subprocess.run(
        ["claude", "-p", "--model", model, "--append-system-prompt", system],
        input=user, capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"claude cli rc={proc.returncode}: {proc.stderr[:200]}")
    return proc.stdout


def extract_action(text):
    """Pull the first JSON object out of the model's reply."""
    text = text.strip()
    # Strip code fences if the model added them despite instructions.
    text = re.sub(r"^```[a-z]*|```$", "", text, flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def compact_state(view):
    """Trim the state view to what the model needs, to keep tokens (and cost) low."""
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


def poke_amos(msg):
    poke = "/home/carmody/.karakos/workspace/bin/poke-amos.sh"
    if os.path.exists(poke):
        os.system(f"{poke} --source pokemon-runner {json.dumps(msg)} >/dev/null 2>&1")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://pokemon-llm-production.up.railway.app",
                    help="Game server base URL (Railway prod by default).")
    ap.add_argument("--model", default="claude-haiku-4-5-20251001")
    ap.add_argument("--goal-badges", type=int, default=1)
    ap.add_argument("--budget", type=int, default=4000)
    ap.add_argument("--max-turns", type=int, default=4000)
    ap.add_argument("--label", default="Haiku · Boulder Badge")
    ap.add_argument("--sleep", type=float, default=0.4)
    ap.add_argument("--logfile", default="/home/carmody/.karakos/workspace/data/pokemon-haiku-run.jsonl")
    args = ap.parse_args()

    base = args.base.rstrip("/")

    bench = http_post(f"{base}/benchmark",
                      {"model": args.model, "actionBudget": args.budget, "label": args.label})
    sid, token = bench["sessionId"], bench["token"]
    seed = bench.get("seed")
    log = open(args.logfile, "w")

    def record(obj):
        obj["t"] = int(time.time())
        log.write(json.dumps(obj) + "\n")
        log.flush()

    record({"event": "start", "session": sid, "seed": seed, "model": args.model,
            "spectate": f"{base}/", "budget": args.budget})
    print(f"[runner] session={sid} seed={seed} model={args.model}", flush=True)
    print(f"[runner] watch: {base}/", flush=True)

    history = []  # rolling (action, resulting message) memory
    reached = False
    turn = 0
    consecutive_errors = 0
    last_pos = None      # last DISTINCT overworld position seen
    stall = 0            # overworld turns stuck at that position (dialogue frames don't reset it)
    SWEEP = ["down", "left", "right", "up"]

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

        # Stall detection: if we keep returning to the same overworld tile we're
        # wedged against a wall/NPC (e.g. bumping Prof. Oak forever). Dialogue and
        # battle frames carry no position — they must NOT reset the counter, or an
        # NPC that talks every bump masks the stall.
        pos = (view.get("player") or {}).get("position") if view.get("screen") == "overworld" else None
        if pos is not None:
            if pos == last_pos:
                stall += 1
            else:
                stall = 0
                last_pos = pos

        stall_note = ""
        if stall >= 2:
            stall_note = (f"\n\nWARNING: your position hasn't changed in {stall} turns — you are "
                          f"BLOCKED that way (a wall or an NPC). Stop repeating it. To leave a "
                          f"building, walk to the door (usually DOWN/south) first. Pick a DIFFERENT "
                          f"direction than your recent moves.")

        hist_txt = "\n".join(
            f"  {i+1}. did {json.dumps(h[0])} -> {h[1]}" for i, h in enumerate(history[-10:])
        ) or "  (none yet)"
        user = (f"Recent actions:\n{hist_txt}\n\n"
                f"Current state:\n{json.dumps(compact_state(view))}\n\n"
                f"Reply with ONE action as JSON.{stall_note}")

        try:
            reply = call_model(args.model, SYSTEM, user)
        except Exception as e:
            record({"event": "api_error", "turn": turn, "error": str(e)})
            time.sleep(3)
            consecutive_errors += 1
            if consecutive_errors > 20:
                break
            continue

        action = extract_action(reply)
        if not action:
            # Fallback so a bad parse never stalls the run.
            action = {"type": "talk"} if view.get("dialogue_active") else {"type": "move", "direction": "up"}
            record({"event": "parse_fallback", "turn": turn, "reply": reply[:200], "action": action})

        # Hard anti-stall: if the model still hasn't escaped after 4 wedged turns,
        # override with a deterministic sweep of the other directions so it can't
        # burn its whole budget bumping the same tile.
        if stall >= 3 and not view.get("dialogue_active"):
            forced = {"type": "move", "direction": SWEEP[(stall - 3) % len(SWEEP)]}
            record({"event": "stall_override", "turn": turn, "stall": stall,
                    "model_action": action, "action": forced})
            action = forced

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
            if result.get("outcome", "").startswith("badge"):
                reached = True
            break

        msg = (result.get("state") or {}).get("message") or result.get("message") or ""
        history.append((action, msg[:120]))
        record({"event": "turn", "turn": turn, "badges": badges, "action": action, "msg": msg[:160]})
        time.sleep(args.sleep)

    log.close()
    if reached:
        poke_amos(f"POKEMON RUN COMPLETE: Haiku earned the Boulder Badge in {turn} turns "
                  f"(session {sid}, seed {seed}). Log: {args.logfile}. Report to Mike.")
        print(f"[runner] DONE — Boulder Badge in {turn} turns", flush=True)
    else:
        poke_amos(f"POKEMON RUN ENDED without the Boulder Badge after {turn} turns "
                  f"(session {sid}). Check {args.logfile} — decide whether to retry or fix. Brief Mike.")
        print(f"[runner] ended without badge after {turn} turns", flush=True)


if __name__ == "__main__":
    main()
