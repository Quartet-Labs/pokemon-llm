#!/usr/bin/env python3
"""Measure per-turn latency of the three ways to ask the `claude` CLI for a move.

The question this answers: is Sonnet unusable as a pokemon-llm brain because the
model is slow, or because we pay a full CLI boot (household MCP config, ~90 tools,
CLAUDE.md loading) on every single turn?

Three modes, same prompt, same model:
  cold-full     `claude -p` exactly as scripts/llm-runner.py does it today.
  cold-factory  `claude -p --strict-mcp-config --mcp-config '{}'` — boots a CLI
                with no MCP servers and no project context at all.
  persistent    one long-lived `claude -p --input-format stream-json` process;
                each turn is a JSON line on stdin, so boot is paid exactly once.

Usage:
  python3 scripts/bench_cli_latency.py --model claude-sonnet-4-6 --turns 3
"""
import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from claude_cli import ColdClaude, PersistentClaude  # noqa: E402

SYSTEM = ("You are playing a Gen-1 Pokemon game through a REST API. You see the game "
          "state as JSON and reply with exactly ONE action as JSON. Reply with ONLY the "
          "JSON object for one action. No prose, no code fences. "
          'Examples: {"type":"move","direction":"north"}  {"type":"talk"}')

# A representative turn payload — roughly the size compact_state() produces mid-route,
# so the measurement reflects real prompt weight rather than a toy question.
STATES = [
    {"turn": 12, "screen": "overworld", "area": "Pallet Town", "dialogue_active": False,
     "available_actions": ["move", "talk"], "hint": "Head north to Route 1.",
     "player": {"position": {"x": 5, "y": 6}, "badges": 0, "money": 3000,
                "surroundings": {"north": "grass", "south": "sign", "east": "fence",
                                 "west": "house"},
                "party": [{"species": "squirtle", "level": 5, "hp": 19, "max_hp": 19}]}},
    {"turn": 13, "screen": "overworld", "area": "Route 1", "dialogue_active": False,
     "available_actions": ["move", "talk"], "hint": "Viridian City is north.",
     "player": {"position": {"x": 5, "y": 2}, "badges": 0, "money": 3000,
                "surroundings": {"north": "tall_grass", "south": "path", "east": "ledge",
                                 "west": "tree"},
                "party": [{"species": "squirtle", "level": 6, "hp": 21, "max_hp": 22}]}},
    {"turn": 14, "screen": "battle", "area": "Route 1", "dialogue_active": False,
     "available_actions": ["battle_move", "run", "throw_ball"],
     "hint": "Wild PIDGEY appeared.",
     "battle": {"opponent": {"species": "pidgey", "level": 3, "hp": 12},
                "moves": ["tackle", "tail_whip", "bubble"]},
     "player": {"position": {"x": 5, "y": 2}, "badges": 0, "money": 3000,
                "party": [{"species": "squirtle", "level": 6, "hp": 21, "max_hp": 22}]}},
]


def prompt_for(i):
    st = STATES[i % len(STATES)]
    return (f"Current state:\n{json.dumps(st)}\n\nReply with ONE action as JSON.")


def run_cold(model, prompt, factory, timeout=180):
    """One turn through a freshly booted `claude -p`. Returns (seconds, reply)."""
    brain = ColdClaude(model, SYSTEM, factory=factory, timeout=timeout)
    t0 = time.monotonic()
    reply = brain.ask(prompt)
    return time.monotonic() - t0, reply.strip()


def summarize(name, times, replies):
    if not times:
        print(f"{name:14s}  FAILED — no successful turns", flush=True)
        return None
    med = statistics.median(times)
    print(f"{name:14s}  n={len(times)}  median={med:6.1f}s  "
          f"min={min(times):6.1f}s  max={max(times):6.1f}s", flush=True)
    return med


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="claude-sonnet-4-6")
    ap.add_argument("--turns", type=int, default=3)
    ap.add_argument("--modes", default="cold-full,cold-factory,persistent")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    results = {}
    print(f"[bench] model={args.model} turns={args.turns} modes={modes}", flush=True)

    if "cold-full" in modes:
        times, replies = [], []
        for i in range(args.turns):
            try:
                dt, reply = run_cold(args.model, prompt_for(i), factory=False)
            except Exception as e:
                print(f"  cold-full turn {i+1} failed: {e}", flush=True)
                continue
            times.append(dt)
            replies.append(reply)
            print(f"  cold-full  turn {i+1}: {dt:6.1f}s  {reply[:60]!r}", flush=True)
        results["cold-full"] = summarize("cold-full", times, replies)

    if "cold-factory" in modes:
        times, replies = [], []
        for i in range(args.turns):
            try:
                dt, reply = run_cold(args.model, prompt_for(i), factory=True)
            except Exception as e:
                print(f"  cold-factory turn {i+1} failed: {e}", flush=True)
                continue
            times.append(dt)
            replies.append(reply)
            print(f"  cold-fact  turn {i+1}: {dt:6.1f}s  {reply[:60]!r}", flush=True)
        results["cold-factory"] = summarize("cold-factory", times, replies)

    if "persistent" in modes:
        times, replies = [], []
        # Recycling off for the benchmark: we are measuring steady-state per-turn
        # cost, and a mid-run restart would fold a boot back into the sample.
        pc = PersistentClaude(args.model, SYSTEM, recycle_turns=0)
        try:
            t0 = time.monotonic()
            first = pc.ask(prompt_for(0))
            boot_plus_first = time.monotonic() - t0
            print(f"  persist    turn 1: {boot_plus_first:6.1f}s (incl. boot)  "
                  f"{first.strip()[:60]!r}", flush=True)
            for i in range(1, args.turns):
                t = time.monotonic()
                reply = pc.ask(prompt_for(i))
                dt = time.monotonic() - t
                times.append(dt)
                replies.append(reply)
                print(f"  persist    turn {i+1}: {dt:6.1f}s  {reply.strip()[:60]!r}",
                      flush=True)
        except Exception as e:
            print(f"  persistent failed: {e}", flush=True)
        finally:
            pc.close()
        results["persistent"] = summarize("persistent", times, replies)

    if args.out:
        with open(args.out, "w") as f:
            json.dump(results, f, indent=2)
    print(json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    main()
