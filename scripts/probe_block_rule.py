#!/usr/bin/env python3
"""PROBE ONLY (untracked helper): A/B the block-walkability rule end to end.

Measures the thing navigate.py actually consumes -- the glyph read_local_map()
puts in each of the player's four neighbouring cells -- against player_walkable(),
which presses the d-pad and is ground truth. Runs the same walk twice, once with
the shipped ALL-FOUR-tiles rule and once with the bottom-left rule, so the change
is scored on agreement rather than argued from the pokered source.

A neighbour is scored as "classifier says you can step here" when its glyph is not
in navigate.OBSTACLE ({'#','N','c'}); off-map ' ' is deliberately treated as
passable-unknown there, so it is scored the same way here.

Usage:  .venv/bin/python scripts/probe_block_rule.py --state <state> [--steps 200]
"""
from __future__ import annotations

import argparse
import os
import random
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from emulator.emu import Emu, STATE_PATH  # noqa: E402
from emulator import ram_map as rm  # noqa: E402

OBSTACLE = {"#", "N", "c"}
DIRS = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}


def walk_positions(emu, steps):
    """Visit distinct cells, yielding after each arrival. Deterministic order,
    rotated per step so the walk sweeps the room instead of ping-ponging."""
    order = ["south", "east", "north", "west"]
    rng = random.Random(0)
    seen = set()
    # The healing counter leaves a textbox up, and a d-pad press only advances
    # text while it is. Clear it first or the walk ends before it starts.
    for _ in range(12):
        if emu.read(rm.TEXTBOX_ID) == 0:
            break
        emu.press("b", hold=8, release=16)
    for i in range(steps):
        key = (emu.read(rm.MAP_ID), emu.read(rm.PLAYER_X), emu.read(rm.PLAYER_Y))
        if key not in seen:
            seen.add(key)
            yield key
        # A fixed rotation closes into a 2x2 cycle almost immediately (measured:
        # 4 distinct cells in 150 steps). Shuffle from a seeded RNG so the walk
        # actually covers the room and the run stays reproducible.
        rng.shuffle(order)
        for d in order:
            x0, y0, m0 = key
            emu.press(rm._WALK_DIRS[d], hold=12, release=20)
            if (emu.read(rm.MAP_ID), emu.read(rm.PLAYER_X),
                    emu.read(rm.PLAYER_Y)) != (m0, x0, y0):
                break
        else:
            # Wedged (a textbox re-opened, or we are boxed in). Try to clear it
            # once; only give up if that does not free us either.
            emu.press("b", hold=8, release=16)
            x0, y0, m0 = key
            for d in order:
                emu.press(rm._WALK_DIRS[d], hold=12, release=20)
                if (emu.read(rm.MAP_ID), emu.read(rm.PLAYER_X),
                        emu.read(rm.PLAYER_Y)) != (m0, x0, y0):
                    break
            else:
                return


def neighbour_glyphs(emu):
    """The glyph read_local_map() assigns to each of the 4 neighbouring cells."""
    local = rm.read_local_map(emu)
    rows = local["ascii"].splitlines()
    if not rows:
        return None
    # Find the player; the trim in read_local_map moves the grid origin.
    pr = pc = None
    for r, row in enumerate(rows):
        c = row.find("@")
        if c >= 0:
            pr, pc = r, c
            break
    if pr is None:
        return None
    out = {}
    for d, (dc, dr) in DIRS.items():
        r, c = pr + dr, pc + dc
        if 0 <= r < len(rows) and 0 <= c < len(rows[r]):
            out[d] = rows[r][c]
    return out


def run(state_path, steps, rule):
    """Score one rule over one walk. rule=None uses the shipped code."""
    original = rm._block_is_walkable
    if rule == "all4":
        rm._block_is_walkable = lambda ts, w: all(t in w for t in ts)
    elif rule == "bottomleft":
        rm._block_is_walkable = lambda ts, w: ts[1] in w

    emu = Emu()
    with open(state_path, "rb") as fh:
        emu.pyboy.load_state(fh)
    emu.tick(4)

    stats = defaultdict(int)
    misses = []
    for _ in walk_positions(emu, steps):
        if emu.read(rm.IN_BATTLE) != 0:
            continue
        glyphs = neighbour_glyphs(emu)
        if not glyphs:
            continue
        truth = rm.player_walkable(emu)
        px, py = emu.read(rm.PLAYER_X), emu.read(rm.PLAYER_Y)
        for d, g in glyphs.items():
            says_open = g not in OBSTACLE
            actual = truth[d]
            stats["n"] += 1
            if says_open == actual:
                stats["ok"] += 1
            else:
                kind = "FALSE_WALL" if actual and not says_open else "FALSE_OPEN"
                stats[kind] += 1
                if len(misses) < 8:
                    misses.append(f"({px},{py}) {d} glyph={g!r} actual={actual} [{kind}]")

    emu.pyboy.stop(save=False)
    rm._block_is_walkable = original
    return stats, misses


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default=STATE_PATH)
    ap.add_argument("--steps", type=int, default=200)
    args = ap.parse_args()

    for label, rule in (("shipped (all-4)", "all4"), ("bottom-left", "bottomleft")):
        stats, misses = run(args.state, args.steps, rule)
        n, ok = stats["n"], stats["ok"]
        print(f"\n=== {label} ===")
        print(f"  neighbours scored: {n}   agree: {ok}  "
              f"({ok / n * 100 if n else 0:.1f}%)")
        print(f"  false walls (walkable called blocked): {stats['FALSE_WALL']}")
        print(f"  false opens (blocked called walkable): {stats['FALSE_OPEN']}")
        for m in misses:
            print("    " + m)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
