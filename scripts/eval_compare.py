#!/usr/bin/env python3
"""Aggregate + compare eval trajectories, arm vs arm (base vs SFT adapter).

Input: labeled trajectory JSONL files written by TrajectoryLogger, one label
per arm, repeatable:

    python3 scripts/eval_compare.py \
        base=data/trajectories/emu-abc.jsonl base=data/trajectories/emu-def.jsonl \
        sft=data/trajectories/emu-ghi.jsonl  sft=data/trajectories/emu-jkl.jsonl

Per arm it reports episodes, mean/median total reward, mean turns, distinct
areas reached, badge counts and goal-reached rate — the run-level numbers the
board item asked for ("eval adapter vs base on live runner"). Reads each file's
summary row; a crashed episode without one is reconstructed from its turn rows
(flagged in the output) so a wedged run still counts instead of vanishing.
"""
import argparse
import json
import statistics
import sys


def episode_stats(path):
    """One episode file -> its summary dict. Falls back to reconstructing from
    turn rows when the summary row is missing (crashed/killed run)."""
    summary = None
    total_reward, turns, areas, max_badges = 0.0, 0, [], 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            kind = row.get("kind")
            if kind == "summary":
                summary = row
            elif kind == "turn":
                total_reward += float(row.get("reward") or 0.0)
                turns += 1
                area = ((row.get("state") or {}).get("area") or {}).get("id")
                if area and area not in areas:
                    areas.append(area)
                badges = ((row.get("state") or {}).get("player") or {}).get("badges") or 0
                max_badges = max(max_badges, badges)
    if summary:
        summary["reconstructed"] = False
        return summary
    return {"total_reward": total_reward, "turns": turns,
            "areas_visited": areas, "max_area": areas[-1] if areas else None,
            "max_badges": max_badges, "goal_reached": None,
            "reconstructed": True}


def arm_report(label, episodes):
    rewards = [e["total_reward"] for e in episodes]
    turns = [e["turns"] for e in episodes]
    reached = [e for e in episodes if e.get("goal_reached")]
    rebuilt = sum(1 for e in episodes if e.get("reconstructed"))
    all_areas = []
    for e in episodes:
        for a in e.get("areas_visited") or []:
            if a not in all_areas:
                all_areas.append(a)
    return {
        "arm": label,
        "episodes": len(episodes),
        "reward_mean": round(statistics.mean(rewards), 2) if rewards else None,
        "reward_median": round(statistics.median(rewards), 2) if rewards else None,
        "turns_mean": round(statistics.mean(turns), 1) if turns else None,
        "distinct_areas": len(all_areas),
        "max_badges": max((e.get("max_badges") or 0) for e in episodes) if episodes else 0,
        "goal_reached": f"{len(reached)}/{len(episodes)}",
        "reconstructed_episodes": rebuilt,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+",
                    help="label=path pairs; repeat a label to group episodes into an arm")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args(argv)

    arms = {}
    for spec in args.runs:
        if "=" not in spec:
            ap.error(f"'{spec}' is not label=path")
        label, path = spec.split("=", 1)
        arms.setdefault(label, []).append(episode_stats(path))

    reports = [arm_report(label, eps) for label, eps in arms.items()]
    if args.json:
        print(json.dumps(reports, indent=2))
        return reports

    cols = ["arm", "episodes", "reward_mean", "reward_median", "turns_mean",
            "distinct_areas", "max_badges", "goal_reached"]
    widths = {c: max(len(c), *(len(str(r[c])) for r in reports)) for c in cols}
    print("  ".join(c.ljust(widths[c]) for c in cols))
    for r in reports:
        print("  ".join(str(r[c]).ljust(widths[c]) for c in cols))
        if r["reconstructed_episodes"]:
            print(f"  ! {r['arm']}: {r['reconstructed_episodes']} episode(s) had no "
                  f"summary row (crashed run) — stats reconstructed from turn rows")
    return reports


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
