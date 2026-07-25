#!/usr/bin/env python3
"""harvest-emulator.py — record a scripted real-game run as a trajectory.

This is the emulator-stack replacement for scripts/harvest-oracle.js, and P6 of
docs/emulator-rewrite-plan.md ("harvest from a scripted or recorded real-game
run — no hand-authored route to rot").

The JS oracle rotted because the hand-built engine kept changing underneath its
hard-coded route. That failure mode does not exist here: the route runs against a
real Pokémon Blue ROM from a fixed savestate, and neither of those ever changes.

It does NOT reimplement the runner's logging. It imports emulator/runner.py and
reuses `_feedback`, plus the real `TrajectoryLogger` and `RewardTracker`, and
walks the server's `steps` array exactly as runner.py's step-5 block does — so
the rows it writes are indistinguishable from rows produced by a live model run,
and build_sft.py consumes both identically. The only thing swapped out is the
brain: a scripted action list instead of an LLM.

Usage:
  python3 scripts/harvest-emulator.py --base http://127.0.0.1:3100 \\
      [--session harvest1] [--script scripts/routes/intro.json] [--out-dir data/trajectories]

  # then:
  python3 scripts/build_sft.py --source emulator \\
      --in data/trajectories/harvest1.jsonl --out data/trajectories/sft.jsonl

A script file is a JSON list of actions in the runner's own action vocabulary,
e.g. [{"type":"move","direction":"north"}, {"type":"a"}, ...]. Entries may also
be a list, which is posted as one queued `submit_actions` sequence (the server
executes it in order and aborts early on anything notable) — that exercises the
same multi-action path a real model uses.
"""
import argparse
import importlib.util
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# Reuse the training layer the live runner uses.
sys.path.insert(0, HERE)
from reward import RewardTracker      # noqa: E402
from trajectory import TrajectoryLogger  # noqa: E402


def load_runner():
    """Import emulator/runner.py for its _feedback (single source of truth for
    the history strings that end up in the SFT prompt)."""
    path = os.path.join(REPO, "emulator", "runner.py")
    spec = importlib.util.spec_from_file_location("emu_runner", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def http_get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def http_post(url, body, timeout=60, token=None):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


# A short deterministic route on the stock overworld savestate. Kept small and
# obvious on purpose: it is a smoke route, not a speedrun. Point --script at a
# longer one to harvest real volume.
DEFAULT_SCRIPT = [
    [{"type": "move", "direction": "south"}] * 3,
    {"type": "a"},
    [{"type": "move", "direction": "west"}] * 2,
    [{"type": "move", "direction": "south"}] * 3,
    {"type": "a"},
    {"type": "b"},
    [{"type": "move", "direction": "east"}] * 2,
    [{"type": "move", "direction": "north"}] * 2,
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("EMU_BASE", "http://127.0.0.1:3100"))
    ap.add_argument("--session", default=None,
                    help="Reuse an existing session id. Default: create a fresh "
                         "one so the run starts from the known savestate.")
    ap.add_argument("--script", default=None,
                    help="JSON file: list of actions (or lists of actions).")
    ap.add_argument("--out-dir", default=os.path.join(REPO, "data", "trajectories"))
    ap.add_argument("--token", default=os.environ.get("EMU_TOKEN"))
    ap.add_argument("--max-turns", type=int, default=10000)
    args = ap.parse_args()

    runner = load_runner()
    base = args.base.rstrip("/")

    script = DEFAULT_SCRIPT
    if args.script:
        with open(args.script) as f:
            script = json.load(f)

    # The server allocates session ids and mints a per-session write token, so we
    # take both from it rather than naming our own. Default is a FRESH session,
    # which is what makes the run reproducible: it starts from the stock
    # overworld savestate instead of wherever a reused session left off.
    if args.session:
        info = http_get(f"{base}/session?session={args.session}")
    else:
        info = http_post(f"{base}/session", {"label": "scripted harvest"})
    sid = info["sessionId"]
    token = args.token or info.get("token")
    print(f"[harvest-emu] session {sid}", flush=True)

    traj = TrajectoryLogger(sid, out_dir=args.out_dir, model="scripted")
    tracker = RewardTracker()
    print(f"[harvest-emu] trajectory -> {traj.path}", flush=True)

    turn = 0
    n_blocked = 0
    for entry in script:
        if turn >= args.max_turns:
            break
        acts = entry if isinstance(entry, list) else [entry]
        body = dict(acts[0]) if len(acts) == 1 else {"actions": acts}

        view = http_get(f"{base}/state?session={sid}")
        prev_state = {k: v for k, v in view.items() if k != "screen_png_b64"}

        result_view = http_post(f"{base}/action?session={sid}", body, token=token)
        steps = result_view.get("steps") or [
            {"action": body, "result": result_view.get("result") or {},
             "state": {k: v for k, v in result_view.items()
                       if k not in ("screen_png_b64", "steps")}}
        ]

        # Identical to emulator/runner.py step 5: one trajectory row per EXECUTED
        # sub-action, reward computed state-before -> action -> state-after.
        for step in steps:
            if turn >= args.max_turns:
                break
            turn += 1
            s_action = step.get("action") or {}
            s_result = step.get("result") or {}
            s_state = step.get("state") or {}
            fb = runner._feedback(s_action, s_result)
            result_msg = fb.split(": ", 1)[-1]
            r, bd = tracker.step(prev_state, s_action, s_state, result_msg)
            traj.log_turn(turn, state=prev_state, action=s_action, reward=r,
                          reward_breakdown=bd, done=False, feedback=fb)
            if ": BLOCKED" in fb or ": rejected" in fb:
                n_blocked += 1
            print(f"[harvest-emu] t{turn} {json.dumps(s_action)} -> {fb}", flush=True)
            prev_state = s_state

    traj.log_summary(reached=False)
    traj.close()
    print(f"[harvest-emu] wrote {turn} rows ({n_blocked} blocked/rejected) "
          f"-> {traj.path}", flush=True)


if __name__ == "__main__":
    main()
