#!/usr/bin/env python3
"""TrajectoryLogger filename tests.

Written after the 7/29 eval-v2 run reported "NO TRAJECTORIES: both arms produced
nothing" despite three sft episodes each playing a full 300 turns. Cause: the
trajectory filename came only from the session id, the emulator server hands back
its lowest free slot ("p1") to every episode that tears down cleanly, and the
logger opens with mode "w". Six episodes truncated one file, and eval_arms.ps1 --
which detects trajectories by diffing filenames before/after an arm -- saw no new
name and concluded nothing had run.

So these tests drive the multi-episode case directly, not just the mechanics of
one logger.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from trajectory import TrajectoryLogger  # noqa: E402


def _rows(path):
    with open(path) as fh:
        return [json.loads(line) for line in fh if line.strip()]


def _play(tmp_path, tag, turns, model="hf-sft"):
    """Run a miniature episode the way runner.py does."""
    log = TrajectoryLogger("p1", out_dir=str(tmp_path), model=model, tag=tag)
    for t in range(turns):
        log.log_turn(t, state={"area": {"id": "pallet"}, "player": {"badges": 0}},
                     action={"type": "move", "direction": "north"},
                     reward=1.0, reward_breakdown={}, done=False,
                     feedback="north: moved")
    log.log_summary(reached=False)
    log.close()
    return log.path


def test_sequential_episodes_on_one_session_id_keep_their_own_files(tmp_path):
    """The regression. Same server slot, three episodes, three surviving files."""
    paths = [_play(tmp_path, f"eval-v2-sft-{i}", turns=i) for i in (1, 2, 3)]

    assert len(set(paths)) == 3, f"episodes shared a filename: {paths}"
    for path, expected_turns in zip(paths, (1, 2, 3)):
        assert os.path.exists(path), f"{path} was clobbered by a later episode"
        turn_rows = [r for r in _rows(path) if r["kind"] == "turn"]
        assert len(turn_rows) == expected_turns


def test_arms_do_not_collide(tmp_path):
    """base and sft both run as p1; their trajectories must stay separable."""
    base = _play(tmp_path, "eval-v2-base-1", turns=0, model="hf-base")
    sft = _play(tmp_path, "eval-v2-sft-1", turns=5, model="hf-sft")

    assert base != sft
    assert [r for r in _rows(base) if r["kind"] == "turn"] == []
    assert len([r for r in _rows(sft) if r["kind"] == "turn"]) == 5


def test_filename_diff_detects_every_episode(tmp_path):
    """eval_arms.ps1 finds trajectories by diffing names -- model that here.

    Under the old scheme `after - before` was empty from episode 2 onward, which
    is exactly how a run with real data reported zero.
    """
    before = set(os.listdir(tmp_path))
    for i in (1, 2, 3):
        _play(tmp_path, f"eval-v2-sft-{i}", turns=2)
    new = set(os.listdir(tmp_path)) - before

    assert len(new) == 3, f"name diff would report {len(new)} of 3 episodes"


def test_tag_is_recorded_in_meta(tmp_path):
    """A collected file has to say which arm and episode it came from."""
    path = _play(tmp_path, "eval-v2-base-2", turns=1, model="hf-base")
    meta = _rows(path)[0]

    assert meta["kind"] == "meta"
    assert meta["tag"] == "eval-v2-base-2"
    assert meta["session_id"] == "p1"
    assert meta["model"] == "hf-base"


def test_untagged_logger_keeps_session_id_filename(tmp_path):
    """Back-compat: existing single-episode callers pass no tag."""
    log = TrajectoryLogger("p4", out_dir=str(tmp_path))
    log.close()

    assert os.path.basename(log.path) == "p4.jsonl"
    assert _rows(log.path)[0]["tag"] is None
