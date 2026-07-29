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

    def __init__(self, session_id, out_dir=None, seed=None, model=None, tag=None):
        self.session_id = session_id
        self.seed = seed
        self.model = model
        self.tag = tag
        out_dir = out_dir or _DEFAULT_OUT_DIR
        os.makedirs(out_dir, exist_ok=True)
        # `session_id` is assigned by the SERVER, which hands back the lowest free
        # slot -- so every episode of a multi-episode run that cleans up after
        # itself gets "p1" and writes the same filename, and this open(..., "w")
        # truncates the previous episode. The 7/29 eval-v2 run lost 5 of its 6
        # episodes that way, and eval_arms.ps1 (which detects trajectories by
        # diffing filenames) reported "0 new trajectory file(s)" for both arms.
        # `tag` is the caller's per-episode discriminator; pass one whenever more
        # than one episode can be in flight against the same server.
        stem = f"{session_id}-{tag}" if tag else str(session_id)
        self.path = os.path.join(out_dir, f"{stem}.jsonl")
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
            "kind": "meta", "session_id": session_id, "tag": tag,
            "seed": seed, "model": model,
        })

    def _write(self, obj):
        obj.setdefault("ts", int(time.time()))
        self._fh.write(json.dumps(obj) + "\n")
        self._fh.flush()

    def log_turn(self, turn, state, action, reward, reward_breakdown, done,
                 feedback=None):
        """Write one per-turn training row.

        `state` MUST be the full view dict the model saw this turn (the SFT
        prompt), not a compacted copy — the trajectory has to be replayable.

        `feedback` is the one-line result string the runner appends to its
        `history` window (e.g. "north: moved to (5,6)"). It is REQUIRED for a row
        to be replayable as an SFT prompt: the runner renders its "Recent
        actions" block from those strings, so without it the prompt a *later*
        turn saw cannot be reconstructed. Optional in the signature only for
        back-compat with trajectories written before it existed.
        """
        row = {
            "kind": "turn",
            "turn": turn,
            "state": state,
            "action": action,
            "reward": reward,
            "reward_breakdown": reward_breakdown,
            "done": bool(done),
        }
        if feedback is not None:
            row["feedback"] = feedback
        self._write(row)
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
