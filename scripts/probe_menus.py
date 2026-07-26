#!/usr/bin/env python3
"""Measure the START / bag / party menu cursors against a live emulator.

Why this exists
---------------
The FIGHT move list turned out to have a ONE-BASED cursor (slot 0 == cursor 1)
and a wMaxMenuItem that lied (3 for a two-move battler). That silently broke
`battle_move` for every call. The START menu, the bag list and the party list
all still go through `_menu_select`, which assumes a 0-based cursor and trusts
wMaxMenuItem — and nobody had measured them.

So measure, don't read pokered. For each menu this walks the cursor one press at
a time and records, per step:

  wCurrentMenuItem / wMaxMenuItem / wTopMenuItemY / wTopMenuItemX / wTextBoxID

and — the part that makes it ground truth rather than another assumption — the
label the arrow is actually pointing at, decoded straight out of wTileMap at
wMenuCursorLocation. A cursor register value means nothing on its own; the row
the game drew the arrow on is what the player selects.

Usage:
    .venv/bin/python -m scripts.probe_menus [--state PATH] [--json OUT]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from emulator import ram_map  # noqa: E402
from emulator.emu import Emu  # noqa: E402

W_CURRENT_MENU_ITEM = 0xCC26
W_MAX_MENU_ITEM = 0xCC28
W_LAST_MENU_ITEM = 0xCC2A
W_MENU_CURSOR_LOCATION = 0xCC30   # 2-byte LE pointer into wTileMap
W_LIST_SCROLL_OFFSET = 0xCC36
W_MENU_WATCHED_KEYS = 0xCC29

# The cursor arrow is drawn INTO wTileMap, so the pointer localises it to a
# screen cell and the label sits immediately to its right.
TILEMAP = ram_map.TILEMAP
TILEMAP_W = ram_map.TILEMAP_W
TILEMAP_H = ram_map.TILEMAP_H

# How far to walk a cursor while mapping it. Long enough to wrap any Gen-1 menu.
WALK_STEPS = 10


def cursor_cell(emu):
    """(row, col) in wTileMap that wMenuCursorLocation points at, or None."""
    ptr = emu.read16(W_MENU_CURSOR_LOCATION)
    off = ptr - TILEMAP
    if not (0 <= off < TILEMAP_W * TILEMAP_H):
        return None
    return divmod(off, TILEMAP_W)


def row_text(emu, row: int, from_col: int = 0) -> str:
    """Decode one wTileMap row to ASCII, starting at `from_col`."""
    if row is None:
        return ""
    tiles = emu.read_range(TILEMAP + row * TILEMAP_W, TILEMAP_W)[from_col:]
    return " ".join("".join(ram_map._tile_to_char(t) for t in tiles).split())


def norm(label: str) -> str:
    """Fold a decoded label for comparison: the game writes POKéMON, not POKEMON.

    'é'.upper() is 'É', so a naive startswith('POKEMON') never matches the real
    menu entry — which is how the first run of this probe reported POKéMON
    missing from a menu it had just printed.
    """
    return label.upper().replace("É", "E").replace("é", "e").upper()


def snap(emu, note: str = "") -> dict:
    """One full reading of the menu registers plus the arrow's actual label."""
    cell = cursor_cell(emu)
    row, col = cell if cell else (None, None)
    return {
        "note": note,
        "cursor": emu.read(W_CURRENT_MENU_ITEM),
        "max_item": emu.read(W_MAX_MENU_ITEM),
        "last_item": emu.read(W_LAST_MENU_ITEM),
        "scroll": emu.read(W_LIST_SCROLL_OFFSET),
        "top_y": emu.read(ram_map.TOP_MENU_ITEM_Y),
        "top_x": emu.read(ram_map.TOP_MENU_ITEM_X),
        "textbox": emu.read(ram_map.TEXTBOX_ID),
        "watched_keys": emu.read(W_MENU_WATCHED_KEYS),
        "arrow_row": row,
        "arrow_col": col,
        # The label the arrow points at — the only unambiguous "what is selected".
        "label": row_text(emu, row, (col + 1) if col is not None else 0),
    }


def screen_lines(emu) -> list[str]:
    """Every non-blank wTileMap row, for eyeballing what menu is really up."""
    out = []
    tiles = emu.read_range(TILEMAP, TILEMAP_W * TILEMAP_H)
    for r in range(TILEMAP_H):
        row = tiles[r * TILEMAP_W:(r + 1) * TILEMAP_W]
        text = " ".join("".join(ram_map._tile_to_char(t) for t in row).split())
        if text:
            out.append(f"{r:2d}: {text}")
    return out


def walk(emu, steps: int = WALK_STEPS, button: str = "down") -> list[dict]:
    """Press `button` one step at a time, snapshotting after each press.

    Deliberately one press per read: the whole class of bug being hunted here is
    a register that does not mean what the index means, and that only shows up as
    a per-step mapping between the register and the drawn arrow.
    """
    steps_out = [snap(emu, "open")]
    for i in range(steps):
        emu.press(button, hold=6, release=10)
        emu.tick(4)
        steps_out.append(snap(emu, f"{button} #{i + 1}"))
    return steps_out


def cursor_map(steps: list[dict]) -> dict:
    """Collapse a walk into cursor-value -> label, and flag the base index."""
    mapping = {}
    for s in steps:
        if s["label"]:
            mapping.setdefault(s["cursor"], s["label"])
    seen = sorted(mapping)
    return {
        "cursor_to_label": {str(k): mapping[k] for k in seen},
        "min_cursor": seen[0] if seen else None,
        "max_cursor": seen[-1] if seen else None,
        "distinct_labels": len({v for v in mapping.values()}),
        # The headline: does index 0 exist, or is this list 1-based like FIGHT's?
        "one_based": bool(seen) and seen[0] == 1,
    }


def probe_start_menu(emu) -> dict:
    """Open START from the overworld and map its cursor to its entries."""
    emu.press("start", hold=8, release=16)
    emu.tick(12)
    steps = walk(emu)
    result = {
        "menu": "start",
        "opened_max_item": steps[0]["max_item"],
        "steps": steps,
        "map": cursor_map(steps),
        "screen": screen_lines(emu),
    }
    return result


def probe_submenu(emu, name: str, entry_label: str, steps_out: list[dict]) -> dict:
    """From an open START menu, drive to `entry_label` by READING the arrow.

    Not by index — the index is exactly what is under suspicion. Walk the cursor
    until the arrow's own label matches, then press A.
    """
    found = None
    for _ in range(WALK_STEPS):
        s = snap(emu)
        if norm(s["label"]).startswith(norm(entry_label)):
            found = s
            break
        emu.press("down", hold=6, release=10)
        emu.tick(4)
    if found is None:
        return {"menu": name, "ok": False,
                "reason": f"{entry_label} not found on the START menu",
                "screen": screen_lines(emu)}
    emu.press("a", hold=8, release=16)
    emu.tick(20)
    steps = walk(emu)
    return {
        "menu": name,
        "ok": True,
        "entered_via_cursor": found["cursor"],
        "entered_via_label": found["label"],
        "opened_max_item": steps[0]["max_item"],
        "steps": steps,
        "map": cursor_map(steps),
        "screen": screen_lines(emu),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default=None,
                    help="savestate to load (default: emulator/overworld.state)")
    ap.add_argument("--json", default=None, help="write the full reading here")
    ap.add_argument("--in-battle", action="store_true",
                    help="state is mid-battle: probe the battle PKMN/ITEM lists")
    args = ap.parse_args()

    emu = Emu()
    state = args.state or os.path.join(os.path.dirname(__file__), "..",
                                       "emulator", "overworld.state")
    with open(state, "rb") as fh:
        emu.pyboy.load_state(fh)
    emu.tick(30)

    report = {
        "state": os.path.basename(state),
        "party_count": emu.read(ram_map.PARTY_COUNT),
        "in_battle": emu.read(ram_map.IN_BATTLE),
        "probes": [],
    }

    if args.in_battle:
        # Battle PKMN list: main menu -> PKMN, then map the party cursor.
        from emulator import actions
        menu = actions._wait_for_battle_menu(emu)
        report["battle_menu_on_entry"] = menu
        sel = actions._battle_main_select(emu, actions.BATTLE_PKMN)
        report["pkmn_select"] = sel
        emu.tick(24)
        steps = walk(emu)
        report["probes"].append({
            "menu": "battle_party", "steps": steps, "map": cursor_map(steps),
            "opened_max_item": steps[0]["max_item"],
            "screen": screen_lines(emu),
        })
    else:
        start = probe_start_menu(emu)
        report["probes"].append(start)
        # Re-open START for each submenu so every probe starts from a known place.
        for name, label in (("party", "POKEMON"), ("bag", "ITEM")):
            emu.press("b", hold=6, release=10)
            emu.tick(20)
            emu.press("b", hold=6, release=10)
            emu.tick(20)
            emu.press("start", hold=8, release=16)
            emu.tick(16)
            report["probes"].append(probe_submenu(emu, name, label, []))

    text = json.dumps(report, indent=2)
    if args.json:
        with open(args.json, "w") as fh:
            fh.write(text)
        print(f"wrote {args.json}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
