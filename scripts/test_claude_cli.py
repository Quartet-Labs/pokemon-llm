#!/usr/bin/env python3
"""Tests for the persistent-CLI brain's lifecycle logic.

The part worth testing is not "does claude answer" — it is the bookkeeping around
recycling, because that only misbehaves hundreds of turns into a run where nobody
is watching. Everything here stubs the subprocess out, so this costs no tokens and
runs in milliseconds.

  python3 scripts/test_claude_cli.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from claude_cli import PersistentClaude, ColdClaude, make_brain  # noqa: E402


class FakePersistent(PersistentClaude):
    """PersistentClaude with the real process swapped for a counter."""

    def __init__(self, *a, fail_on=(), **kw):
        super().__init__(*a, **kw)
        self.starts = 0
        self.stops = 0
        self.prompts = []
        self.fail_on = set(fail_on)
        self._ask_n = 0

    def _start(self):
        self.starts += 1
        self.proc = object()
        self._turns_this_gen = 0
        self.generation += 1

    def _stop(self):
        if self.proc is not None:
            self.stops += 1
        self.proc = None

    def _ask_once(self, prompt):
        self._ask_n += 1
        if self._ask_n in self.fail_on:
            raise RuntimeError("simulated process death")
        self.prompts.append(prompt)
        self._turns_this_gen += 1
        return '{"type":"talk"}'


def check(label, got, want):
    if got != want:
        print(f"  FAIL {label}: got {got!r}, want {want!r}")
        return False
    print(f"  ok   {label}")
    return True


def test_recycle_boots_once_per_generation():
    print("recycle boots once per generation")
    b = FakePersistent("m", "s", recycle_turns=2)
    for _ in range(5):
        b.ask("x")
    return all([
        check("boots", b.starts, 3),          # turns 1-2, 3-4, 5
        check("generation", b.generation, 3),
    ])


def test_every_fresh_generation_is_flagged_for_reseed():
    """The regression this file exists for.

    needs_reseed() must answer for the process that will receive the next turn.
    It previously answered for the process currently alive, so the turn that
    triggered a recycle was sent to a brand-new, history-less process without the
    runner ever being told to re-seed it — silent context loss mid-run.
    """
    print("every fresh generation is flagged for reseed")
    b = FakePersistent("m", "s", recycle_turns=2)
    flagged, fresh = [], []
    for i in range(6):
        flagged.append(b.needs_reseed())
        gen = b.generation
        b.ask("x")
        fresh.append(b.generation != gen)
    missed = [i + 1 for i, (f, n) in enumerate(zip(flagged, fresh)) if n and not f]
    return all([
        check("turns starting a new process", fresh, [True, False, True, False, True, False]),
        check("reseed flagged on exactly those turns", flagged, fresh),
        check("new processes missing a reseed flag", missed, []),
    ])


def test_recycle_disabled_never_restarts():
    print("recycle_turns=0 never restarts")
    b = FakePersistent("m", "s", recycle_turns=0)
    for _ in range(10):
        b.ask("x")
    return all([
        check("boots", b.starts, 1),
        check("reseed only on first turn", b.needs_reseed(), False),
    ])


def test_dead_process_is_retried_not_fatal():
    print("a dead process is retried, not fatal")
    b = FakePersistent("m", "s", recycle_turns=0, fail_on=(2,))
    b.ask("first")
    reply = b.ask("second")          # underlying ask #2 dies, must retry
    return all([
        check("reply survived", reply, '{"type":"talk"}'),
        check("restarted once after death", b.starts, 2),
        check("turns recorded", len(b.prompts), 2),
    ])


def test_cold_always_needs_history():
    print("cold brain always needs history")
    return all([
        check("cold flag", ColdClaude("m", "s").needs_history_every_turn, True),
        check("persistent flag", PersistentClaude("m", "s").needs_history_every_turn, False),
        check("persistent implies factory", isinstance(
            make_brain("m", "s", persistent=True), PersistentClaude), True),
    ])


def main():
    tests = [
        test_recycle_boots_once_per_generation,
        test_every_fresh_generation_is_flagged_for_reseed,
        test_recycle_disabled_never_restarts,
        test_dead_process_is_retried_not_fatal,
        test_cold_always_needs_history,
    ]
    results = [t() for t in tests]
    passed = sum(results)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
