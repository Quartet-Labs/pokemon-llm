#!/usr/bin/env python3
"""Measure the bag list, and whether the START menu's entry indices are fixed.

Two questions the FIGHT-move-list bug left open for the overworld macros:

1. The bag. `_use_item(target_index)` drives it with `_menu_select`, which is
   0-based and trusts wMaxMenuItem. An empty bag shows only CANCEL, which proves
   nothing, so this forges a three-item bag (wNumBagItems / wBagItems are plain
   RAM the list handler reads) and maps every cursor value to the drawn label.

2. The START menu. `_use_item` hardcodes ITEM as index 2 and `_switch` hardcodes
   POKEMON as index 1, from a comment claiming "POKEDEX 0, POKEMON 1, ITEM 2".
   The Gen-1 START menu is built at open time from progression flags, so this
   flips the has-Pokédex flag (wd74b bit 5) and re-reads the menu. If the labels
   move, a hardcoded index cannot be correct in both states.

Usage:
    .venv/bin/python -m scripts.probe_bag_and_start
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from emulator import ram_map  # noqa: E402
from emulator.emu import Emu  # noqa: E402
from scripts.probe_menus import cursor_map, norm, screen_lines, snap, walk  # noqa: E402

STATE = os.path.join(os.path.dirname(__file__), "..", "emulator",
                     "overworld.state")

# pokered wram.asm
W_NUM_BAG_ITEMS = 0xD31D
W_BAG_ITEMS = 0xD31E     # (id, qty) pairs, 0xFF terminator
W_STATUS_FLAGS = 0xD74B  # bit 5 = player has the Pokédex
POKEDEX_BIT = 1 << 5

# Item ids (pokered item constants): distinct and easy to recognise on screen.
ITEMS = [(0x14, 2),   # POTION
         (0x04, 5),   # POKE BALL
         (0x0B, 1)]   # ANTIDOTE


def forge_bag(emu, items=ITEMS) -> None:
    emu.pyboy.memory[W_NUM_BAG_ITEMS] = len(items)
    addr = W_BAG_ITEMS
    for item_id, qty in items:
        emu.pyboy.memory[addr] = item_id
        emu.pyboy.memory[addr + 1] = qty
        addr += 2
    emu.pyboy.memory[addr] = 0xFF
    emu.tick(4)


def open_start(emu) -> None:
    emu.press("start", hold=8, release=16)
    emu.tick(16)


def close_menus(emu) -> None:
    for _ in range(3):
        emu.press("b", hold=6, release=10)
        emu.tick(16)


def start_menu_reading(emu) -> dict:
    open_start(emu)
    steps = walk(emu)
    reading = {
        "max_item_register": steps[0]["max_item"],
        "map": cursor_map(steps),
        "screen": screen_lines(emu),
    }
    reading["entries"] = reading["map"]["cursor_to_label"]
    close_menus(emu)
    return reading


def select_by_label(emu, label: str) -> dict | None:
    """Walk the START cursor until the arrow's own label matches, then press A."""
    for _ in range(10):
        s = snap(emu)
        if norm(s["label"]).startswith(norm(label)):
            emu.press("a", hold=8, release=16)
            emu.tick(24)
            return s
        emu.press("down", hold=6, release=10)
        emu.tick(4)
    return None


def main() -> int:
    emu = Emu()
    with open(STATE, "rb") as fh:
        emu.pyboy.load_state(fh)
    emu.tick(30)

    report = {}

    # ── 1. START menu before and after the Pokédex flag ──────────────────────
    report["start_no_pokedex"] = start_menu_reading(emu)
    emu.pyboy.memory[W_STATUS_FLAGS] = emu.read(W_STATUS_FLAGS) | POKEDEX_BIT
    emu.tick(8)
    report["start_with_pokedex"] = start_menu_reading(emu)

    before = report["start_no_pokedex"]["entries"]
    after = report["start_with_pokedex"]["entries"]
    report["start_indices_are_stable"] = before == after
    report["code_assumes"] = {"0": "POKEDEX", "1": "POKEMON", "2": "ITEM"}

    # ── 2. Bag list with real contents ───────────────────────────────────────
    forge_bag(emu)
    open_start(emu)
    entered = select_by_label(emu, "ITEM")
    report["bag_entered_via"] = entered and {"cursor": entered["cursor"],
                                             "label": entered["label"]}
    steps = walk(emu)
    report["bag"] = {
        "max_item_register": steps[0]["max_item"],
        "num_bag_items": emu.read(W_NUM_BAG_ITEMS),
        "map": cursor_map(steps),
        "screen": screen_lines(emu),
        "scroll_seen": sorted({s["scroll"] for s in steps}),
    }

    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
