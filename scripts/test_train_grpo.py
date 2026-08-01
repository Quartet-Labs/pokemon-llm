#!/usr/bin/env python3
"""Tests for the GRPO trainer's pure layer, and for the ILLEGAL weight.

Two things are checked here and neither needs a GPU:

1. The GRPO arithmetic — group-relative advantage, the degenerate-group rule,
   per-trajectory tracker isolation, config validation. This is the whole of
   what can be verified off the desktop, so it is verified properly rather than
   smoke-tested.

2. The ILLEGAL weight, against a real 100-turn wall-bump scored by the real
   reward module. eval-v3 measured SFT-v1 at -163.9 over 300 turns — -0.546 a
   turn, which under the old weights was exactly STEP+ILLEGAL, i.e. the policy
   bumped a wall on essentially every turn. These assertions fix the ratio that
   was raised to fix that, so a later "let's soften ILLEGAL" fails here with the
   reason attached instead of quietly restoring the old behaviour.

Run:  python scripts/test_train_grpo.py
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import reward as reward_mod
import train_grpo as tg


# ── fixtures ─────────────────────────────────────────────────────────────────

def view(x, y, seen=30, area="route1"):
    """A minimal overworld view: 15x11 viewport centred on (x, y).

    Built to the shape reward.py actually reads (map.ascii + map.position +
    area.id + player.*) rather than to a captured blob, so a change to the view
    shape shows up here as a failure instead of as a stale fixture that still
    passes.
    """
    rows = []
    for dy in range(-5, 6):
        row = []
        for dx in range(-7, 8):
            gx, gy = x + dx, y + dy
            if dx == 0 and dy == 0:
                row.append("@")
            elif abs(gx) <= seen and abs(gy) <= seen:
                row.append(".")
            else:
                row.append("?")
        rows.append("".join(row))
    return {
        "area": {"id": area},
        "player": {"badges": 0, "money": 0, "party": [],
                   "pokedex_seen": 0, "pokedex_caught": 0},
        "map": {"ascii": "\n".join(rows), "position": {"x": x, "y": y}},
    }


MOVE = {"type": "move", "direction": "north"}


def wall_bump_episode(n=100):
    """n turns of walking into the same wall: position never changes, engine
    rejects every one. This is the behaviour eval-v3 caught SFT-v1 in."""
    return [{"prev_view": view(10, 10), "action": MOVE,
             "result_view": view(10, 10), "result_msg": "You can't go that way."}
            for _ in range(n)]


def exploring_episode(n=100):
    """n turns of walking into genuinely fresh ground."""
    return [{"prev_view": view(10, 10 + i, seen=12 + i), "action": MOVE,
             "result_view": view(10, 11 + i, seen=13 + i), "result_msg": ""}
            for i in range(n)]


def pacing_episode(n=100):
    """n legal turns that accomplish nothing — shuffling over known ground."""
    out = []
    for i in range(n):
        a, b = (10, 11) if i % 2 == 0 else (11, 10)
        out.append({"prev_view": view(a, b), "action": MOVE,
                    "result_view": view(b, a), "result_msg": ""})
    return out


def score(transitions):
    rewards, breakdowns = tg.score_trajectory(transitions)
    return tg.episode_return(rewards), breakdowns


# ── the ILLEGAL weight ───────────────────────────────────────────────────────

class IllegalWeightTests(unittest.TestCase):
    def test_wall_bumping_is_the_worst_thing_in_the_reward_space(self):
        """A 100-turn wall-bump must be decisively worse than any legal
        behaviour — not merely worse. At ILLEGAL=0.5 a wall scored -55 against
        +40 for aimless pacing, only ~2.7x the magnitude of the best legal
        behaviour, and a behaviour-cloned policy did not come off the wall."""
        wall, _ = score(wall_bump_episode())
        explore, _ = score(exploring_episode())
        pace, _ = score(pacing_episode())

        self.assertLess(wall, 0, "a wall-bumping episode must lose points")
        self.assertLess(wall, explore)
        self.assertLess(wall, pace)

        best_legal = max(explore, pace)
        self.assertGreaterEqual(
            abs(wall) / best_legal, 5.0,
            f"wall={wall:.1f} vs best legal={best_legal:.1f} — the wall is not "
            f"decisively the worst option, which is the condition ILLEGAL was "
            f"raised to 2.0 to create")

    def test_illegal_dominates_the_step_penalty(self):
        """The bump, not the clock, has to be what hurts. If ILLEGAL ever drops
        near STEP, a wall costs about the same as standing still and the policy
        has no reason to prefer either."""
        self.assertGreater(reward_mod.ILLEGAL, 4 * reward_mod.STEP)

    def test_one_bump_still_costs_less_than_entering_a_new_area(self):
        """The other side of the tuning: raised far enough and the policy learns
        to fear moving at all. A single bump must stay cheaper than the reward
        for real progress, or exploration becomes a bad bet."""
        self.assertLess(reward_mod.ILLEGAL + reward_mod.STEP, reward_mod.NEW_AREA)

    def test_a_full_bumping_episode_does_not_outweigh_a_badge(self):
        """300 turns of wall-bumping must not make the terminal objective look
        unreachable-and-not-worth-it. BADGE has to survive the penalty."""
        wall_300, _ = score(wall_bump_episode(300))
        self.assertGreater(reward_mod.BADGE + wall_300, wall_300,
                           "badge must remain a strict improvement")
        self.assertLess(abs(wall_300) / reward_mod.BADGE, 20.0)

    def test_illegal_rate_reads_off_the_breakdown(self):
        """The headline diagnostic must agree with the reward that was actually
        optimised, so it is derived from the breakdown rather than recounted."""
        _, bumps = score(wall_bump_episode(20))
        _, walks = score(exploring_episode(20))
        self.assertEqual(tg.illegal_rate(bumps), 1.0)
        self.assertEqual(tg.illegal_rate(walks), 0.0)


# ── GRPO arithmetic ──────────────────────────────────────────────────────────

class GroupAdvantageTests(unittest.TestCase):
    def test_advantage_is_the_within_group_zscore(self):
        advs, degenerate = tg.group_advantages([1.0, 2.0, 3.0])
        self.assertFalse(degenerate)
        self.assertAlmostEqual(sum(advs), 0.0, places=9)
        self.assertLess(advs[0], 0)
        self.assertGreater(advs[2], 0)

    def test_identical_returns_are_degenerate_not_infinite(self):
        """Every member walking into the same wall gives std 0. Dividing by it
        is inf/NaN and ends the run; this is the case that actually happens at
        the start of training, so it has to be named, not clipped."""
        advs, degenerate = tg.group_advantages([-55.0] * 8)
        self.assertTrue(degenerate)
        self.assertEqual(advs, [0.0] * 8)
        self.assertTrue(all(a == a for a in advs), "advantages must not be NaN")

    def test_group_of_one_is_degenerate(self):
        """G=1 has no group. Its advantage is 0 by construction, and a trainer
        that ran with it would log steps that taught nothing as if they had."""
        advs, degenerate = tg.group_advantages([12.5])
        self.assertTrue(degenerate)
        self.assertEqual(advs, [0.0])

    def test_empty_group_raises(self):
        with self.assertRaises(ValueError):
            tg.group_advantages([])

    def test_a_near_identical_group_is_still_degenerate(self):
        advs, degenerate = tg.group_advantages([-55.0, -55.0 + 1e-12])
        self.assertTrue(degenerate)


class EpisodeReturnTests(unittest.TestCase):
    def test_undiscounted_by_default(self):
        self.assertAlmostEqual(tg.episode_return([1.0, 2.0, 3.0]), 6.0)

    def test_discounting_applies_from_turn_zero(self):
        self.assertAlmostEqual(tg.episode_return([1.0, 1.0], gamma=0.5), 1.5)

    def test_gamma_must_be_a_valid_discount(self):
        for bad in (0.0, -0.1, 1.5):
            with self.assertRaises(ValueError):
                tg.episode_return([1.0], gamma=bad)


class ScoreTrajectoryTests(unittest.TestCase):
    def test_a_malformed_transition_raises_rather_than_scoring_zero(self):
        """A rollout that cannot be scored must stop the step. Treating it as
        reward 0 would put a fabricated middling return into the group and move
        every other member's advantage."""
        with self.assertRaises(tg.RolloutError):
            tg.score_trajectory([{"prev_view": view(1, 1), "action": MOVE}])

    def test_each_trajectory_gets_its_own_novelty_memory(self):
        """RewardTracker holds per-EPISODE novelty. Sharing one across a group
        would pay the bonus to whichever member was rolled out first and to
        none of the others — an ordering artefact turned into an advantage."""
        a, _ = score(exploring_episode(10))
        b, _ = score(exploring_episode(10))
        self.assertAlmostEqual(a, b, places=9,
                               msg="identical trajectories must score identically")


class TrainLoopTests(unittest.TestCase):
    def _loop(self, episodes, steps=1, group_size=None):
        applied = []
        group_size = group_size or len(episodes)

        def rollout_fn(step, member):
            return episodes[member]

        def apply_update(samples):
            applied.append(samples)

        history = tg.train_loop(rollout_fn, steps, group_size, apply_update)
        return history, applied

    def test_a_degenerate_group_skips_the_update(self):
        """Eight members all bumping the same wall carry no 'which was better'
        signal. Applying zero advantages anyway would log a step that taught
        nothing as a step that trained."""
        history, applied = self._loop([wall_bump_episode(5)] * 8)
        self.assertTrue(history[0]["degenerate"])
        self.assertEqual(applied, [], "no update may be applied to a flat group")
        self.assertIn("degenerate", history[0]["skipped"])

    def test_a_group_with_spread_updates_and_ranks_correctly(self):
        episodes = [wall_bump_episode(5), exploring_episode(5),
                    pacing_episode(5), wall_bump_episode(5)]
        history, applied = self._loop(episodes)
        self.assertFalse(history[0]["degenerate"])
        self.assertEqual(len(applied), 1)

        samples = applied[0]
        self.assertEqual(len(samples), 4)
        # The wall-bumpers must carry negative advantage and the legal episodes
        # positive — the entire point of the step.
        self.assertLess(samples[0]["advantage"], 0)
        self.assertLess(samples[3]["advantage"], 0)
        self.assertGreater(samples[1]["advantage"], 0)
        self.assertGreater(samples[2]["advantage"], 0)

    def test_summary_reports_the_diagnostics_that_matter(self):
        history, _ = self._loop([wall_bump_episode(5), exploring_episode(5)])
        s = history[0]
        self.assertEqual(s["n"], 2)
        self.assertEqual(s["turns_mean"], 5)
        self.assertAlmostEqual(s["illegal_rate_mean"], 0.5)
        self.assertLess(s["return_min"], s["return_max"])
        self.assertIn("[train-grpo]", tg.format_step(s))

    def test_every_step_is_recorded_even_when_skipped(self):
        history, applied = self._loop([wall_bump_episode(3)] * 4, steps=3)
        self.assertEqual(len(history), 3)
        self.assertEqual([h["step"] for h in history], [0, 1, 2])
        self.assertEqual(applied, [])


class ConfigValidationTests(unittest.TestCase):
    def _args(self, **over):
        args = tg.build_parser().parse_args([])
        for k, v in over.items():
            setattr(args, k, v)
        return args

    def test_defaults_are_valid(self):
        tg.validate_args(self._args())

    def test_group_of_one_is_refused_before_an_hour_of_rollouts(self):
        with self.assertRaises(SystemExit):
            tg.validate_args(self._args(group_size=1))

    def test_greedy_sampling_is_refused(self):
        """The SFT policy is near-deterministic — three greedy episodes returned
        an identical mean AND median. At temperature 0 every group member is the
        same episode and every advantage is 0."""
        with self.assertRaises(SystemExit):
            tg.validate_args(self._args(temperature=0.0))

    def test_negative_kl_is_refused(self):
        with self.assertRaises(SystemExit):
            tg.validate_args(self._args(kl_coef=-0.1))

    def test_bad_gamma_and_turn_budget_are_refused(self):
        for over in ({"gamma": 0.0}, {"gamma": 1.5}, {"max_turns": 0}):
            with self.assertRaises(SystemExit):
                tg.validate_args(self._args(**over))


class ManifestTests(unittest.TestCase):
    def test_reward_weights_are_snapshotted_into_the_run(self):
        """Weights WILL be tuned between runs — ILLEGAL already moved 0.5 -> 2.0.
        A run whose returns cannot be attributed to a weight table is not
        comparable to any other run."""
        m = tg.reward_manifest()
        for name in ("ILLEGAL", "STEP", "NEW_TILE", "NEW_AREA", "BADGE"):
            self.assertIn(name, m)
        self.assertEqual(m["ILLEGAL"], reward_mod.ILLEGAL)

    def test_dry_run_does_not_import_torch(self):
        """The dry run has to work on the Pi, which has no torch and must not
        get one."""
        self.assertEqual(tg.main(["--dry-run"]), 0)
        self.assertNotIn("torch", sys.modules)


if __name__ == "__main__":
    unittest.main(verbosity=2)
