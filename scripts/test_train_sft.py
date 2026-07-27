#!/usr/bin/env python3
"""Tests for the data layer in scripts/train_sft.py.

Everything covered here is a SILENT failure — a row that is malformed in one of
these ways still trains. It does not crash the run; it quietly teaches the model
a grammar the live runner will never accept, and the only symptom is a model
that scores fine on loss and cannot play. That is why the validator is strict by
default and why these are tests rather than assertions in a docstring.

Deliberately imports nothing from torch/TRL — this file must stay runnable on
the Pi, where the training deps are not installed.

    python3 scripts/test_train_sft.py
"""
import copy
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import train_sft  # noqa: E402


def good_row(action="a"):
    """A row shaped exactly like build_sft.py's emitter output."""
    return {
        "messages": [
            {"role": "system", "content": "You are playing Pokemon Blue."},
            {"role": "user", "content": "Recent actions:\n  (none yet)\n\nCurrent state:\n{}"},
            {"role": "assistant", "content": "",
             "tool_calls": [{"type": "function",
                             "function": {"name": "submit_action",
                                          "arguments": json.dumps({"type": action})}}]},
        ],
        "tools": [{"type": "function", "function": {"name": "submit_action"}}],
    }


class TestValidateRow(unittest.TestCase):
    def test_good_row_returns_action(self):
        self.assertEqual(train_sft.validate_row(good_row("move"), 0), "move")

    def test_rejects_dict_arguments(self):
        """The OpenAI convention is a JSON *string*. A dict renders differently
        under the chat template, so training text silently stops matching
        inference text — the exact drift class build_sft.py exists to prevent."""
        row = good_row()
        row["messages"][2]["tool_calls"][0]["function"]["arguments"] = {"type": "a"}
        with self.assertRaises(train_sft.RowError) as cm:
            train_sft.validate_row(row, 0)
        self.assertIn("JSON string", str(cm.exception))

    def test_rejects_missing_tools(self):
        """Without the schema the template omits the tools block entirely, so
        the model trains having never been shown the function it must call."""
        row = good_row()
        del row["tools"]
        with self.assertRaises(train_sft.RowError):
            train_sft.validate_row(row, 0)

    def test_rejects_wrong_tool_name(self):
        row = good_row()
        row["messages"][2]["tool_calls"][0]["function"]["name"] = "submit_actions"
        with self.assertRaises(train_sft.RowError):
            train_sft.validate_row(row, 0)

    def test_rejects_multiple_tool_calls(self):
        """The live runner accepts exactly one action per turn."""
        row = good_row()
        row["messages"][2]["tool_calls"].append(
            copy.deepcopy(row["messages"][2]["tool_calls"][0]))
        with self.assertRaises(train_sft.RowError):
            train_sft.validate_row(row, 0)

    def test_rejects_bad_role_order(self):
        row = good_row()
        row["messages"][0], row["messages"][1] = row["messages"][1], row["messages"][0]
        with self.assertRaises(train_sft.RowError):
            train_sft.validate_row(row, 0)

    def test_rejects_unparseable_arguments(self):
        row = good_row()
        row["messages"][2]["tool_calls"][0]["function"]["arguments"] = "{not json"
        with self.assertRaises(train_sft.RowError):
            train_sft.validate_row(row, 0)

    def test_rejects_arguments_without_type(self):
        row = good_row()
        row["messages"][2]["tool_calls"][0]["function"]["arguments"] = json.dumps({"dir": "north"})
        with self.assertRaises(train_sft.RowError):
            train_sft.validate_row(row, 0)


class TestLoadRows(unittest.TestCase):
    def _write(self, rows):
        fd, path = tempfile.mkstemp(suffix=".jsonl")
        with os.fdopen(fd, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        self.addCleanup(os.unlink, path)
        return path

    def test_counts_action_mix(self):
        path = self._write([good_row("a"), good_row("a"), good_row("move")])
        rows, counts, dropped = train_sft.load_rows(path)
        self.assertEqual(len(rows), 3)
        self.assertEqual(counts, {"a": 2, "move": 1})
        self.assertEqual(dropped, [])

    def test_strict_raises_on_bad_row(self):
        bad = good_row()
        del bad["tools"]
        path = self._write([good_row(), bad])
        with self.assertRaises(train_sft.RowError):
            train_sft.load_rows(path, strict=True)

    def test_non_strict_drops_and_reports(self):
        """A dropped row must be reported, never silently swallowed."""
        bad = good_row()
        del bad["tools"]
        path = self._write([good_row(), bad])
        rows, counts, dropped = train_sft.load_rows(path, strict=False)
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(dropped), 1)

    def test_skips_blank_lines(self):
        path = self._write([good_row()])
        with open(path, "a") as f:
            f.write("\n\n")
        rows, _, _ = train_sft.load_rows(path)
        self.assertEqual(len(rows), 1)


class TestSplitHoldout(unittest.TestCase):
    def test_split_sizes(self):
        rows = [good_row(str(i)) for i in range(100)]
        train, ev = train_sft.split_holdout(rows, frac=0.1, seed=0)
        self.assertEqual((len(train), len(ev)), (90, 10))

    def test_split_is_deterministic(self):
        rows = [good_row(str(i)) for i in range(50)]
        a = train_sft.split_holdout(rows, 0.2, seed=7)
        b = train_sft.split_holdout(rows, 0.2, seed=7)
        self.assertEqual(a, b)

    def test_split_shuffles_rather_than_slicing_the_tail(self):
        """Rows arrive in play order. A tail slice would hold out only the end
        of the route, so eval would be all Viridian and none of the opening."""
        rows = [good_row(str(i)) for i in range(100)]
        _, ev = train_sft.split_holdout(rows, frac=0.1, seed=0)
        tail = rows[-10:]
        self.assertNotEqual(ev, tail)

    def test_no_overlap_between_train_and_eval(self):
        rows = [good_row(str(i)) for i in range(40)]
        train, ev = train_sft.split_holdout(rows, 0.25, seed=1)
        self.assertEqual(len(train) + len(ev), 40)
        for row in ev:
            self.assertNotIn(row, train)

    def test_zero_holdout_keeps_everything(self):
        rows = [good_row(str(i)) for i in range(10)]
        train, ev = train_sft.split_holdout(rows, frac=0.0)
        self.assertEqual((len(train), len(ev)), (10, 0))

    def test_rejects_frac_of_one(self):
        with self.assertRaises(ValueError):
            train_sft.split_holdout([good_row()], frac=1.0)


class TestActionMix(unittest.TestCase):
    def test_renders_percentages_descending(self):
        out = train_sft.action_mix({"a": 46, "move": 49, "battle_move": 5})
        self.assertTrue(out.startswith("move 49 (49%)"))
        self.assertIn("battle_move 5 (5%)", out)

    def test_empty_counts_does_not_divide_by_zero(self):
        self.assertEqual(train_sft.action_mix({}), "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
