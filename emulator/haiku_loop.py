#!/usr/bin/env python3
"""Stopgap agent loop: Claude Haiku plays the real Pokémon Blue emulator via the
API, on its own session, driven through the `claude` CLI (no API key needed).

This is a bridge until the full emulator-runner (proper state formatting, tool
schema, reward/trajectory logging) is built. It uses an emulator-appropriate
prompt (real Blue, starts in the bedroom) — NOT the JS-engine Oak's-Lab prompt.

Usage:
  python3 -m emulator.haiku_loop --base https://pokemon-llm-production.up.railway.app
"""
import argparse
import json
import re
import subprocess
import time
import urllib.request

SYSTEM = """You are an agent playing the real Pokémon Blue (Game Boy) through an \
API. You start in your character's bedroom. Your job: explore, get downstairs and \
out of the house, then head out to explore the world.

Each turn you get the game state (map id, your x/y position, party, whether you're \
in a battle) and a short log of your recent actions and whether they worked. \
Reply with ONLY one JSON action, no prose:
  {"type":"move","direction":"north"}   (or south/east/west)
  {"type":"a"}      press A — talk to people/signs, confirm, advance text
  {"type":"b"}      press B — cancel
  {"type":"start"}  open the menu

Rules:
- If a direction returned "blocked (wall or facing)" last turn, that way is a \
wall — try a DIFFERENT direction. Don't repeat a move that just failed.
- To leave a room, find the stairs/door — walk toward unexplored edges.
- Vary your exploration; don't oscillate between two tiles."""


def http_get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.load(r)


def http_post(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def ask_haiku(system, user):
    out = subprocess.run(
        ["claude", "-p", "--model", "claude-haiku-4-5-20251001",
         "--append-system-prompt", system],
        input=user, capture_output=True, text=True, timeout=60,
    ).stdout
    m = re.search(r"\{.*\}", out, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://pokemon-llm-production.up.railway.app")
    ap.add_argument("--label", default="haiku")
    ap.add_argument("--max-turns", type=int, default=100000)
    ap.add_argument("--sleep", type=float, default=0.5)
    args = ap.parse_args()
    base = args.base.rstrip("/")

    sess = http_post(f"{base}/session", {"label": args.label})
    sid = sess["sessionId"]
    print(f"[haiku] playing on session {sid} at {base}/", flush=True)

    hist = []
    for turn in range(args.max_turns):
        try:
            s = http_get(f"{base}/state?session={sid}")
        except Exception as e:
            print(f"[haiku] state error: {e}", flush=True)
            time.sleep(3)
            continue
        s.pop("screen_png_b64", None)
        h = "\n".join(hist[-6:]) or "(none)"
        user = f"Recent actions:\n{h}\n\nState:\n{json.dumps(s)}\n\nYour action:"
        action = ask_haiku(SYSTEM, user)
        if not action:
            action = {"type": "a"}
        try:
            res = http_post(f"{base}/action?session={sid}", action)
        except Exception as e:
            print(f"[haiku] action error: {e}", flush=True)
            time.sleep(2)
            continue
        msg = (res.get("result") or {}).get("message") or res.get("message") or ""
        label = action.get("direction", action.get("type"))
        hist.append(f"{label}: {msg[:40]}")
        time.sleep(args.sleep)


if __name__ == "__main__":
    main()
