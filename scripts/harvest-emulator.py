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
      [--session harvest1] [--script scripts/routes/opening.json] [--out-dir data/trajectories]

  # then:
  python3 scripts/build_sft.py --source emulator \\
      --in data/trajectories/harvest1.jsonl --out data/trajectories/sft.jsonl

A script file is a JSON list of *steps*. The simplest step is a raw action in
the runner's own vocabulary, e.g. {"type":"move","direction":"north"}; a step
may also be a list of them, posted as one queued `submit_actions` sequence (the
server executes it in order and aborts early on anything notable) — that
exercises the same multi-action path a real model uses.

Raw actions alone cannot express a route of any length, because the emulator
reports a *viewport*, not a map: a destination eight tiles away is not visible
when the step list is authored, and a hand-counted sequence of presses is the
exact thing that rotted `harvest-oracle.js`. So there are three more step kinds,
which name an intent and resolve it against live state:

  {"goto": {"x": 6, "y": 2}}       walk there (scripts/navigate.py plans it)
  {"exit": "oak"}                  walk to the exit leading to that map
  {"press": {"type":"a"}, "until": {"area": 40}, "max": 30}
                                   repeat an action until the world agrees

`until` conditions are ANDed and drawn from a deliberately small vocabulary —
area, screen, in_battle, has_party, battle_ready, dialogue, pos (see COND_KEYS).
`press`/`until` exists because cutscene lengths are not constants: Oak's speech
plus the walk to his lab measured 37 A-presses on one run, and any text-speed or
routing difference moves it. A route that hard-codes the count desynchronises
silently and every waypoint after it is wrong; one that says "press A until we
are in map 40" cannot.

Every action these expand to is still recorded one row per executed sub-step,
exactly as a raw action is, so nothing about the training rows changes.
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
import navigate                       # noqa: E402
from reward import RewardTracker      # noqa: E402
from trajectory import TrajectoryLogger  # noqa: E402

# How many plan/execute cycles one `goto` or `exit` step may spend before the
# harvest gives up on it and moves to the next step.
MAX_LEGS = 16
# Consecutive legs that move the player nowhere before the waypoint is declared
# unreachable. Two, not one: the first bump is often just a turn-to-face.
MAX_STALLS = 2


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
# obvious on purpose: it is a smoke route, not a speedrun. Point --script at
# scripts/routes/opening.json for real volume.
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


# ── `until` conditions ───────────────────────────────────────────────────────
# Each maps a route-file key to a predicate over the current view. Small on
# purpose: a route should assert the handful of things the game actually makes
# observable, not grow a query language.
COND_KEYS = {
    # map id, e.g. 40 == Oak's Lab
    "area": lambda v, want: (v.get("area") or {}).get("id") == want,
    # "overworld" | "battle" | ...
    "screen": lambda v, want: v.get("screen") == want,
    # truthy in a battle (1 wild, 2 trainer)
    "in_battle": lambda v, want: bool(v.get("in_battle")) is bool(want),
    # the starter has actually landed in the party
    "has_party": lambda v, want: bool((v.get("player") or {}).get("party")) is bool(want),
    # battle RAM populated — the menu is live and battle_move can be issued.
    # The intro animation reports in_battle long before this is true.
    "battle_ready": lambda v, want: bool(
        ((v.get("battle") or {}).get("enemy") or {}).get("species")) is bool(want),
    # a text box is up
    "dialogue": lambda v, want: bool((v.get("dialogue") or {}).get("text")) is bool(want),
    # exact tile
    "pos": lambda v, want: (v.get("player") or {}).get("position") == want,
}


def cond_met(view, cond):
    """True when every key in `cond` holds for `view`. Unknown keys are a route
    authoring error and raise rather than silently passing — a condition that
    is never true would otherwise look like a condition that is always true."""
    for key, want in (cond or {}).items():
        test = COND_KEYS.get(key)
        if test is None:
            raise ValueError(f"unknown until-condition {key!r}; "
                             f"known: {sorted(COND_KEYS)}")
        if not test(view, want):
            return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("EMU_BASE", "http://127.0.0.1:3100"))
    ap.add_argument("--session", default=None,
                    help="Reuse an existing session id. Default: create a fresh "
                         "one so the run starts from the known savestate.")
    ap.add_argument("--script", default=None,
                    help="JSON route file: raw actions, action lists, and/or "
                         "goto/exit/press steps. See scripts/routes/opening.json.")
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

    state = {"turn": 0, "blocked_rows": 0, "blocked_cells": set()}

    def view_now():
        return http_get(f"{base}/state?session={sid}")

    def run_batch(acts):
        """Post one action (or queued sequence) and log a row per EXECUTED
        sub-step. Returns the resulting view.

        The body of this is unchanged from the original flat harvest and is
        identical to emulator/runner.py step 5 — one row per sub-action, reward
        computed state-before -> action -> state-after — so rows stay
        indistinguishable from a live model run's whichever step kind produced
        them.
        """
        body = dict(acts[0]) if len(acts) == 1 else {"actions": acts}
        view = view_now()
        prev_state = {k: v for k, v in view.items() if k != "screen_png_b64"}

        result_view = http_post(f"{base}/action?session={sid}", body, token=token)
        steps = result_view.get("steps") or [
            {"action": body, "result": result_view.get("result") or {},
             "state": {k: v for k, v in result_view.items()
                       if k not in ("screen_png_b64", "steps")}}
        ]

        for step in steps:
            if state["turn"] >= args.max_turns:
                break
            state["turn"] += 1
            s_action = step.get("action") or {}
            s_result = step.get("result") or {}
            s_state = step.get("state") or {}
            fb = runner._feedback(s_action, s_result)
            result_msg = fb.split(": ", 1)[-1]
            r, bd = tracker.step(prev_state, s_action, s_state, result_msg)
            traj.log_turn(state["turn"], state=prev_state, action=s_action,
                          reward=r, reward_breakdown=bd, done=False, feedback=fb)
            if ": BLOCKED" in fb or ": rejected" in fb:
                state["blocked_rows"] += 1

            # Remember terrain the emulator refused, so the planner stops
            # re-deriving the same illegal step (see navigate.plan_moves).
            at = (prev_state.get("player") or {}).get("position") or {}
            cell = navigate.blocked_cell((at.get("x"), at.get("y")),
                                         s_action, s_result)
            if cell is not None:
                state["blocked_cells"].add(cell)

            print(f"[harvest-emu] t{state['turn']} {json.dumps(s_action)} -> {fb}",
                  flush=True)
            prev_state = s_state

        return {k: v for k, v in result_view.items()
                if k not in ("screen_png_b64", "steps")}

    def do_goto(target, label):
        """Walk to a world cell, re-planning after every leg."""
        stalls = 0
        for leg in range(MAX_LEGS):
            if state["turn"] >= args.max_turns:
                return
            view = view_now()
            moves, arrived = navigate.plan_moves(
                view, target, blocked=state["blocked_cells"])
            if arrived:
                print(f"[harvest-emu] {label} reached {target}", flush=True)
                return
            if not moves:
                print(f"[harvest-emu] {label} no route to {target} "
                      f"from {(view.get('player') or {}).get('position')} "
                      f"— skipping", flush=True)
                return
            before = (view.get("player") or {}).get("position")
            after = (run_batch(moves).get("player") or {}).get("position")
            if after == before:
                stalls += 1
                if stalls >= MAX_STALLS:
                    print(f"[harvest-emu] {label} stalled at {after} "
                          f"— skipping {target}", flush=True)
                    return
            else:
                stalls = 0
        print(f"[harvest-emu] {label} gave up after {MAX_LEGS} legs", flush=True)

    def do_press(action, until, cap):
        """Repeat an action — or a short cycle of them — until `until` holds.

        A list is run one action per batch, not as a queued sequence: the cycle
        (face the shelf, press A) has to survive the first half being a no-op
        for the whole cutscene, and a queued sequence would abort on that.

        Bounded by `cap` and reported when it runs out, because a silent cap is
        indistinguishable from a satisfied condition in the output.
        """
        cycle = action if isinstance(action, list) else [action]
        for i in range(cap):
            if state["turn"] >= args.max_turns:
                return
            if cond_met(view_now(), until):
                print(f"[harvest-emu] until {json.dumps(until)} met "
                      f"after {i} cycles", flush=True)
                return
            for act in cycle:
                if state["turn"] >= args.max_turns:
                    return
                run_batch([act])
        if not cond_met(view_now(), until):
            print(f"[harvest-emu] until {json.dumps(until)} NOT met in "
                  f"{cap} cycles — continuing anyway", flush=True)

    for entry in script:
        if state["turn"] >= args.max_turns:
            break

        if isinstance(entry, list):
            run_batch(entry)
        elif not isinstance(entry, dict):
            raise ValueError(f"route step must be a dict or list, got {entry!r}")
        elif set(entry) == {"_"}:
            # JSON has no comments; a lone "_" is the route's prose. Routes are
            # read far more often than written, and every waypoint here needs a
            # sentence saying which game event it is anchored to.
            continue
        elif "goto" in entry:
            do_goto(entry["goto"], "goto")
        elif "exit" in entry or "exit_map" in entry:
            view = view_now()
            at = navigate.find_exit(view, to_map_id=entry.get("exit_map"),
                                    to_name=entry.get("exit"))
            if at is None:
                print(f"[harvest-emu] no exit matching {json.dumps(entry)} "
                      f"in {json.dumps((view.get('map') or {}).get('exits'))}"
                      f" — skipping", flush=True)
            else:
                do_goto(at, f"exit->{entry.get('exit') or entry.get('exit_map')}")
        elif "press" in entry:
            do_press(entry["press"], entry.get("until") or {},
                     int(entry.get("max", 40)))
        elif "type" in entry:
            run_batch([entry])
        else:
            raise ValueError(f"unrecognised route step {json.dumps(entry)}")

    traj.log_summary(reached=False)
    traj.close()
    print(f"[harvest-emu] wrote {state['turn']} rows "
          f"({state['blocked_rows']} blocked/rejected) -> {traj.path}", flush=True)


if __name__ == "__main__":
    main()
