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
import base64
import json
import re
import subprocess
import tempfile
import time
import urllib.request

SYSTEM = """You are an agent playing the real Pokémon Blue (Game Boy) through an \
API. You start in your character's bedroom. Your job: explore, get downstairs and \
out of the house, then head out to explore the world.

Each turn you get the game state (map id, your x/y position, party, whether you're \
in a battle, and your current "goal") and a short log of your recent actions and \
whether they worked. Reply with ONLY one JSON action, no prose:
  {"type":"move","direction":"north"}   (or south/east/west)
  {"type":"a"}      press A — talk to people/signs, confirm, advance text
  {"type":"b"}      press B — cancel
  {"type":"start"}  open the menu

You MAY optionally add a "goal" field to state what you're currently trying to \
do, e.g. {"type":"move","direction":"south","goal":"find the stairs down"}. The \
goal persists and is echoed back to you as "goal" each turn — update it whenever \
your intent changes, set it to "" to clear it. It is optional: omit it to leave \
your current goal unchanged.

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


def ask_haiku(system, user, model="claude-haiku-4-5-20251001", image_path=None):
    cmd = ["claude", "-p", "--model", model, "--append-system-prompt", system]
    if image_path:
        # Vision: let the agent open the frame with its Read tool (keyless, on
        # subscription auth — same way an interactive Claude views an image).
        cmd += ["--allowedTools", "Read"]
    out = subprocess.run(
        cmd, input=user, capture_output=True, text=True, timeout=180,
    ).stdout
    m = re.search(r"\{.*\}", out, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def ask_ollama(system, user, model, ollama_url):
    """Ask a local Ollama model (e.g. qwen3:32b on the desktop GPU) for one JSON
    action. "/no_think" keeps qwen3 from burning 60-1400s on a reasoning chain;
    num_ctx 4096 keeps the KV cache inside the 24GB GPU."""
    body = {
        "model": model, "stream": False, "keep_alive": "30m",
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": "/no_think\n" + user}],
        "options": {"temperature": 0.4, "num_ctx": 4096},
    }
    req = urllib.request.Request(
        ollama_url.rstrip("/") + "/api/chat",
        data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        resp = json.load(r)
    content = ((resp.get("message") or {}).get("content") or "")
    m = re.search(r"\{.*\}", content, re.DOTALL)
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
    ap.add_argument("--model", default="claude-haiku-4-5-20251001")
    ap.add_argument("--backend", choices=("claude", "ollama"), default="claude",
                    help="claude = `claude` CLI; ollama = local model on the desktop GPU.")
    ap.add_argument("--ollama-url", default="http://192.168.1.185:11434")
    ap.add_argument("--max-turns", type=int, default=100000)
    ap.add_argument("--sleep", type=float, default=0.5)
    ap.add_argument("--vision", action="store_true",
                    help="Feed the actual screen PNG to the model each turn "
                         "(the agent Reads it) instead of text state only.")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    sess = http_post(f"{base}/session", {"label": args.label})
    sid = sess["sessionId"]
    print(f"[haiku] playing on session {sid} at {base}/", flush=True)

    frame_path = f"{tempfile.gettempdir()}/pkmn-frame-{sid}.png" if args.vision else None

    hist = []
    for turn in range(args.max_turns):
        try:
            s = http_get(f"{base}/state?session={sid}")
        except Exception as e:
            print(f"[haiku] state error: {e}", flush=True)
            time.sleep(3)
            continue
        png_b64 = s.pop("screen_png_b64", None)
        h = "\n".join(hist[-6:]) or "(none)"
        if frame_path and png_b64:
            with open(frame_path, "wb") as fh:
                fh.write(base64.b64decode(png_b64))
            user = (f"A screenshot of the current screen is saved at {frame_path}. "
                    f"Open it with your Read tool and LOOK before deciding — it "
                    f"shows exit types, NPCs, furniture and menus the text can't.\n\n"
                    f"Recent actions:\n{h}\n\nState (coords/party/battle):\n"
                    f"{json.dumps(s)}\n\nYour action:")
        else:
            user = f"Recent actions:\n{h}\n\nState:\n{json.dumps(s)}\n\nYour action:"
        if args.backend == "ollama":
            action = ask_ollama(SYSTEM, user, args.model, args.ollama_url)
        else:
            action = ask_haiku(SYSTEM, user, args.model, frame_path)
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
