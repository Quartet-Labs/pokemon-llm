#!/usr/bin/env python3
"""Tests for the env-facing half of grpo_rollout — session handling.

These exist because of a specific failure. The 2026-08-06 00:29 GRPO smoke run
got the whole GPU side right and then died on its first environment call:
`make_emulator_rollout` drove `/reset`, `/state` and `/action` with no
`?session=`, and `emulator/server.py` mints no default session, so every call
came back 404 "unknown session 'default'". Reproduced against a local server
AND against Railway prod before it was believed. Nothing on the GPU side could
have caught it, and nothing here needs a GPU — so it is checked here.

The environment is a fake that records URLs. The point is not that HTTP works;
it is that every request carries the session the episode opened, and that the
session is handed back at the end. Both are things a reader can get wrong again.

Run:  python scripts/test_grpo_rollout.py
"""

import contextlib
import os
import sys
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# grpo_rollout does `import torch` inside make_emulator_rollout. The Pi has no
# torch and must not get one, so a stub stands in — via patch.dict so it is
# removed again on exit. test_train_grpo.py asserts torch is absent from
# sys.modules, and a stub left behind would fail it from the outside.
FAKE_TORCH = types.SimpleNamespace(no_grad=contextlib.nullcontext)


class FakeTensor:
    """Enough tensor to survive the rollout loop: shape, .to, indexing, and the
    detach/cpu chain the transition dict stores."""

    def __init__(self, n=4):
        self.n = n

    @property
    def shape(self):
        return (1, self.n)

    def to(self, _device):
        return self

    def __getitem__(self, _idx):
        return self

    def detach(self):
        return self

    def cpu(self):
        return self

    def numel(self):
        return self.n


class FakeTok:
    pad_token_id = 0

    def apply_chat_template(self, *a, **k):
        return FakeTensor()

    def decode(self, *a, **k):
        # A well-formed tool call, so the turn produces a real action rather
        # than exercising the no-op path by accident.
        return '<tool_call>{"name":"submit_action","arguments":' \
               '{"type":"move","direction":"up"}}</tool_call>'


class FakePolicy:
    device = "cpu"

    def generate(self, *a, **k):
        return types.SimpleNamespace(sequences=FakeTensor())


class FakeEnv:
    """Records every URL the rollout touches, and answers like the real server:
    a session is required, and an unknown one 404s."""

    def __init__(self, turns_before_done=2, action_raises=False, blocked=False):
        self.calls = []
        self.live = set()
        self.next_id = 1
        self.turns = 0
        self.turns_before_done = turns_before_done
        self.action_raises = action_raises
        self.blocked = blocked

    def _view(self, x, y):
        """The shape sess.view() really returns — verified against Railway prod
        on 2026-08-06: area/player/map/screen/available_actions/goal, and NO
        'state', 'ok', 'message' or 'done' anywhere."""
        return {"screen": "overworld", "area": {"id": "route1"},
                "player": {"party": []},
                "map": {"position": {"x": x, "y": y}, "ascii": "..."},
                "available_actions": ["move"], "goal": None}

    def _sid_of(self, url):
        return url.split("session=")[1].split("&")[0] if "session=" in url else None

    def _require_session(self, url):
        sid = self._sid_of(url)
        # This is the exact failure being guarded: no session param at all.
        if sid is None:
            raise AssertionError(f"request with no ?session=: {url}")
        if sid not in self.live:
            raise AssertionError(f"404 unknown session {sid!r}: {url}")

    def http_post(self, url, body, token=None, **k):
        self.calls.append(("POST", url, token))
        if url.endswith("/benchmark"):
            sid = f"p{self.next_id}"
            self.next_id += 1
            self.live.add(sid)
            return {"sessionId": sid, "token": f"tok-{sid}",
                    "state": self._view(0, 0)}
        self._require_session(url)
        if self.action_raises:
            raise RuntimeError("env exploded mid-episode")
        self.turns += 1
        # A real /action response: the post-action view, with action/result/
        # steps/stopped_early laid on top. The walker advances one tile a turn
        # unless `blocked`, which is how the emulator reports a wall.
        y = 0 if self.blocked else self.turns
        view = self._view(0, y)
        step_result = ({"ok": True, "moved": False, "reason": "wall",
                        "from": {"x": 0, "y": 0}, "to": {"x": 0, "y": 0}}
                       if self.blocked else
                       {"ok": True, "moved": True,
                        "from": {"x": 0, "y": y - 1}, "to": {"x": 0, "y": y}})
        action = {"type": "move", "direction": "up"}
        view.update({"action": action, "result": step_result,
                     "steps": [{"action": action, "result": step_result,
                                "state": view}],
                     "stopped_early": False})
        return view

    def http_get(self, url, **k):
        self.calls.append(("GET", url, None))
        self._require_session(url)
        return self._view(0, 0)

    def http_delete(self, url, token=None, **k):
        self.calls.append(("DELETE", url, token))
        sid = self._sid_of(url)
        self.live.discard(sid)
        return {"ok": True}

    # -- assertions helpers --
    def urls(self, method=None):
        return [u for m, u, _ in self.calls if method is None or m == method]


@contextlib.contextmanager
def rollout_against(env):
    """Build a rollout_fn wired to `env`, with torch stubbed."""
    with mock.patch.dict(sys.modules, {"torch": FAKE_TORCH}):
        import grpo_rollout
        with mock.patch.multiple(grpo_rollout.env_runner,
                                 http_post=env.http_post,
                                 http_get=env.http_get,
                                 http_delete=env.http_delete):
            yield grpo_rollout.make_emulator_rollout(
                FakePolicy(), FakeTok(), max_turns=5,
                base_url="http://env.test")


class SessionThreadingTests(unittest.TestCase):
    def test_episode_opens_a_session_before_touching_the_env(self):
        """POST /benchmark is the only way to get a session on this server."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            rollout(0, 0)
        self.assertTrue(env.calls[0][1].endswith("/benchmark"),
                        f"first call was {env.calls[0][1]}")

    def test_every_request_after_open_carries_the_session(self):
        """The regression itself. FakeEnv raises on a session-less request, so
        this fails loudly rather than by a subtle count mismatch."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            rollout(0, 0)
        after_open = [u for u in env.urls() if not u.endswith("/benchmark")]
        self.assertTrue(after_open, "episode made no env calls at all")
        for url in after_open:
            self.assertIn("session=p1", url)

    def test_action_uses_the_session_token_not_the_callers(self):
        """Each session mints its own token; the episode must send that one."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            rollout(0, 0)
        actions = [(u, t) for m, u, t in env.calls if "/action" in u]
        self.assertTrue(actions)
        for _url, token in actions:
            self.assertEqual(token, "tok-p1")

    def test_session_is_released_at_episode_end(self):
        """The server caps the registry at 4 and never reaps a benchmark
        session, so a leak kills the fifth episode of a run, not the first."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            rollout(0, 0)
        self.assertEqual(env.urls("DELETE"),
                         ["http://env.test/session?session=p1"])
        self.assertEqual(env.live, set(), "session leaked")

    def test_session_is_released_when_the_episode_raises(self):
        """A crashed episode leaks exactly the same slot as a clean one — which
        is why the cleanup is in `finally` and not at the end of the body."""
        env = FakeEnv(action_raises=True)
        with rollout_against(env) as rollout:
            with self.assertRaises(RuntimeError):
                rollout(0, 0)
        self.assertEqual(env.live, set(), "session leaked on the error path")

    def test_many_episodes_never_hold_more_than_one_session(self):
        """Rollouts are sequential in train_loop; if that stays true, a run of
        any length stays far under the 4-session cap."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            for step in range(3):
                for member in range(2):
                    rollout(step, member)
                    self.assertLessEqual(len(env.live), 1)
        self.assertEqual(env.live, set())
        self.assertEqual(len(env.urls("DELETE")), 6)

    def test_opening_view_comes_from_the_benchmark_response(self):
        """/benchmark resets the emulator and returns that view, so a separate
        /state round-trip at episode start is pure cost."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            rollout(0, 0)
        self.assertEqual(env.urls("GET"), [])

    def test_view_advances_between_turns(self):
        """POST /action returns the post-action view ITSELF. Reading a "state"
        key that does not exist left `view` pinned to the opening frame for the
        whole episode — the model saw turn 1 forever."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            transitions = rollout(0, 0)
        positions = [t["result_view"]["map"]["position"]["y"] for t in transitions]
        self.assertEqual(positions, [1, 2, 3, 4, 5])
        for t in transitions:
            self.assertNotEqual(t["prev_view"]["map"]["position"],
                                t["result_view"]["map"]["position"])

    def test_result_msg_comes_from_the_step_result(self):
        """_feedback reads ok/moved/to, which live in resp["result"], not at the
        top level. Handed the whole response it saw ok=None and called every
        action rejected; handed nothing it produced an empty string."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            transitions = rollout(0, 0)
        for t in transitions:
            self.assertTrue(t["result_msg"], "result_msg was empty")
            self.assertIn("moved to", t["result_msg"])
            self.assertNotIn("rejected", t["result_msg"])


class RewardIntegrationTests(unittest.TestCase):
    """The consequence of the shape bugs, measured with the real reward module.

    These two numbers are the whole point. A frozen view plus an empty message
    makes reward._is_illegal fire its "a MOVE that did not change position"
    fallback on every single turn, so a clean walk scores exactly like a policy
    that bumps a wall 300 times — at ILLEGAL weight 2.0. A GRPO run on that
    signal cannot learn anything, and looks like a model problem."""

    def _score(self, env):
        import train_grpo as tg
        with rollout_against(env) as rollout:
            transitions = rollout(0, 0)
        _rewards, breakdowns = tg.score_trajectory(transitions)
        return tg.illegal_rate(breakdowns)

    def test_a_clean_walk_scores_fully_legal(self):
        self.assertEqual(self._score(FakeEnv()), 0.0)

    def test_walking_into_a_wall_still_scores_fully_illegal(self):
        """The guard against over-correcting: the fix must not make everything
        look legal. A genuinely blocked walk is still 100% illegal."""
        self.assertEqual(self._score(FakeEnv(blocked=True)), 1.0)

    def test_blocked_move_says_so_in_the_message(self):
        """reward._is_illegal's FIRST signal is a marker string in result_msg;
        the position fallback is belt-and-suspenders. Keep the marker working."""
        env = FakeEnv(blocked=True)
        with rollout_against(env) as rollout:
            transitions = rollout(0, 0)
        self.assertIn("BLOCKED", transitions[0]["result_msg"])


class EpisodeEndTests(unittest.TestCase):
    def test_stopped_early_does_not_end_the_episode(self):
        """`stopped_early` means a queued action SEQUENCE aborted mid-list, not
        that the episode is over. Breaking on it would truncate every episode
        that ever queued a sequence."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            transitions = rollout(0, 0)
        self.assertEqual(len(transitions), 5, "episode ended before max_turns")


class SessionThreadingTailTests(unittest.TestCase):
    def test_torch_stub_does_not_escape(self):
        """Guards the guard: test_train_grpo.py asserts torch is absent from
        sys.modules, and would fail from here if the stub leaked."""
        env = FakeEnv()
        with rollout_against(env) as rollout:
            rollout(0, 0)
        self.assertNotIn("torch", sys.modules)


if __name__ == "__main__":
    unittest.main(verbosity=2)
