#!/usr/bin/env python3
"""Trajectory logging for pokemon-llm RL/SFT training.

Writes one JSONL row per turn to data/trajectories/<session_id>.jsonl. Each row
is self-contained and replayable: `state` is the FULL view the model saw that
turn, so a row doubles as an SFT prompt (state -> action) and carries the reward
+ breakdown that GRPO consumes. At episode end an extra summary row records the
run-level metrics.

Usage:
    log = TrajectoryLogger(session_id)          # opens data/trajectories/<sid>.jsonl
    log.log_turn(turn, state=view, action=act,
                 reward=r, reward_breakdown=bd, done=False)
    ...
    log.log_summary(reached=True)               # writes summary + closes
    log.close()
"""
import json
import os
import time

# Default output directory, relative to the repo root (this file lives in
# scripts/). Overridable via the `out_dir` arg for tests / alt locations.
_DEFAULT_OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "trajectories",
)


class TrajectoryLogger:
    """Append-only JSONL trajectory writer for a single episode/session."""

    def __init__(self, session_id, out_dir=None, seed=None, model=None):
        self.session_id = session_id
        self.seed = seed
        self.model = model
        out_dir = out_dir or _DEFAULT_OUT_DIR
        os.makedirs(out_dir, exist_ok=True)
        self.path = os.path.join(out_dir, f"{session_id}.jsonl")
        self._fh = open(self.path, "w")
        # Running totals for the summary row.
        self._total_reward = 0.0
        self._turns = 0
        self._max_badges = 0
        self._areas_seen = []          # ordered, de-duped list of areas entered
        self._max_area = None
        # Kick the file off with a lightweight meta row so consumers know the
        # seed/model without re-deriving them (kept out of per-turn rows).
        self._write({
            "kind": "meta", "session_id": session_id,
            "seed": seed, "model": model,
        })

    def _write(self, obj):
        obj.setdefault("ts", int(time.time()))
        self._fh.write(json.dumps(obj) + "\n")
        self._fh.flush()

    def log_turn(self, turn, state, action, reward, reward_breakdown, done):
        """Write one per-turn training row.

        `state` MUST be the full view dict the model saw this turn (the SFT
        prompt), not a compacted copy — the trajectory has to be replayable.
        """
        self._write({
            "kind": "turn",
            "turn": turn,
            "state": state,
            "action": action,
            "reward": reward,
            "reward_breakdown": reward_breakdown,
            "done": bool(done),
        })
        # Update running totals for the summary.
        self._total_reward += float(reward)
        self._turns += 1
        area = ((state or {}).get("area") or {}).get("id")
        if area and area not in self._areas_seen:
            self._areas_seen.append(area)
            self._max_area = area
        badges = ((state or {}).get("player") or {}).get("badges") or 0
        # Prefer the post-action badge count if the breakdown recorded a gain.
        badges = max(badges, badges + int((reward_breakdown or {}).get("badge_delta", 0)))
        self._max_badges = max(self._max_badges, badges)

    def log_summary(self, reached=None, extra=None):
        """Write the episode summary row: totals, turns, max area, badges."""
        row = {
            "kind": "summary",
            "session_id": self.session_id,
            "seed": self.seed,
            "model": self.model,
            "total_reward": self._total_reward,
            "turns": self._turns,
            "max_area": self._max_area,
            "areas_visited": self._areas_seen,
            "max_badges": self._max_badges,
            "goal_reached": reached,
        }
        if extra:
            row.update(extra)
        self._write(row)

    def close(self):
        if self._fh and not self._fh.closed:
            self._fh.close()

    # Context-manager sugar so callers can `with TrajectoryLogger(...) as log:`.
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False
