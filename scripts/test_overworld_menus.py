#!/usr/bin/env python3
"""Tests for the overworld menu macros in emulator/actions.py.

Companion to test_battle_menu.py, and the same lesson one layer out. Every
behaviour asserted here was MEASURED on 2026-07-25 against a live emulator by
scripts/probe_menus.py, scripts/probe_bag_and_start.py and
scripts/probe_party_switch.py — not read off pokered.

The fake emulator models the three findings, each of which contradicts the
obvious mental model and so will be "corrected" back into a bug by anyone
working from it:

  1. The START menu is BUILT FROM PROGRESSION FLAGS. Without the Pokédex it is
     POKéMON/ITEM/<NAME>/SAVE/OPTION/EXIT; with it, everything shifts down one.
     The old code hardcoded "POKEMON is index 1, ITEM is index 2" — the Pokédex
     layout — so for the whole pre-Pokédex opening, `switch` opened the BAG and
     `use_item` opened the TRAINER CARD. Both returned ok=True.
  2. The bag is a SCROLLING list. wCurrentMenuItem is the row within a 3-tall
     window and pins at 2; the item index is wListScrollOffset + cursor. The old
     code bailed at "index 3 exceeds wMaxMenuItem 2", so no item past the third
     was reachable, and it reported an 8-item bag as holding 3.
  3. wMaxMenuItem means something DIFFERENT in every menu: count-1 for the
     party, count for the START menu, and the window height for the bag.

The party list is included precisely because it turned out to be CORRECT — the
1-based cursor that broke the move list does not exist there, and that negative
result is worth pinning down so nobody "fixes" it.

    python3 scripts/test_overworld_menus.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from emulator import actions, ram_map  # noqa: E402

BLANK = 0x7F
E_ACUTE = 0xBA          # the 'é' in POKéMON / POKéDEX


def encode(text: str) -> list[int]:
    """Text -> wTileMap font tiles, matching ram_map._tile_to_char."""
    out = []
    for ch in text:
        if "A" <= ch <= "Z":
            out.append(0x80 + ord(ch) - ord("A"))
        elif "0" <= ch <= "9":
            out.append(0xF6 + ord(ch) - ord("0"))
        elif ch == "é":
            out.append(E_ACUTE)
        else:
            out.append(BLANK)
    return out


class TileMapEmu:
    """Base fake: enough of a Game Boy to draw a menu and point an arrow at it.

    The arrow matters. Selection is now verified against the label the game
    actually drew (wMenuCursorLocation -> wTileMap), because an index register
    only describes the menu the code already believes it is looking at — which
    is exactly the assumption that was wrong every previous time.
    """

    ROW0 = 2        # screen row of the first entry
    ROW_STRIDE = 2  # entries are drawn every other row
    COL = 1         # arrow column; the label starts at COL + 1

    def __init__(self):
        self.mem = {}
        self.tiles = [0] * (ram_map.TILEMAP_W * ram_map.TILEMAP_H)
        self.presses = []
        self.selected_label = None

    # ── memory ──────────────────────────────────────────────────────────────
    def read(self, addr):
        base = ram_map.TILEMAP
        if base <= addr < base + len(self.tiles):
            return self.tiles[addr - base]
        return self.mem.get(addr, 0)

    def read16(self, addr):
        return self.read(addr) | (self.read(addr + 1) << 8)

    def read_range(self, addr, length):
        return [self.read(addr + i) for i in range(length)]

    def tick(self, n=1):
        pass

    # ── drawing ─────────────────────────────────────────────────────────────
    def _draw(self, visible, cursor_row):
        self.tiles = [0] * (ram_map.TILEMAP_W * ram_map.TILEMAP_H)
        for i, label in enumerate(visible):
            row = self.ROW0 + i * self.ROW_STRIDE
            start = row * ram_map.TILEMAP_W + self.COL + 1
            for j, tile in enumerate(encode(label)):
                self.tiles[start + j] = tile
        cell = ((self.ROW0 + cursor_row * self.ROW_STRIDE) * ram_map.TILEMAP_W
                + self.COL)
        ptr = ram_map.TILEMAP + cell
        self.mem[ram_map.W_MENU_CURSOR_LOCATION] = ptr & 0xFF
        self.mem[ram_map.W_MENU_CURSOR_LOCATION + 1] = ptr >> 8


class StartMenuEmu(TileMapEmu):
    """The overworld START menu, whose entries depend on progression flags.

    Measured layouts (probe_bag_and_start.py, one savestate, flag flipped):
        no Pokédex  POKéMON ITEM <NAME> SAVE OPTION EXIT        wMaxMenuItem 6
        Pokédex     POKéDEX POKéMON ITEM <NAME> SAVE OPTION EXIT wMaxMenuItem 7
    Note wMaxMenuItem is the entry COUNT here, not count-1 as in the party list.
    """

    BASE = ["POKéMON", "ITEM", "REDDD", "SAVE", "OPTION", "EXIT"]

    def __init__(self, has_pokedex=False):
        super().__init__()
        self.entries = (["POKéDEX"] + self.BASE) if has_pokedex else list(self.BASE)
        self.cursor = 0
        self.mem[actions.W_MAX_MENU_ITEM] = len(self.entries)   # COUNT, not -1
        self._sync()

    def _sync(self):
        self.mem[actions.W_CURRENT_MENU_ITEM] = self.cursor
        self._draw(self.entries, self.cursor)

    def press(self, button, hold=8, release=8):
        self.presses.append(button)
        if button == "down":
            self.cursor = (self.cursor + 1) % len(self.entries)
        elif button == "up":
            self.cursor = (self.cursor - 1) % len(self.entries)
        elif button == "a":
            self.selected_label = self.entries[self.cursor]
        self._sync()


class BagEmu(TileMapEmu):
    """The bag: a 3-row window over the item list, plus a trailing CANCEL.

    Measured with an 8-item bag: cursor went 0,1,2,2,2,2,2,2 while
    wListScrollOffset went 0,0,0,1,2,3,4,5. wMaxMenuItem read 2 for a 3-item bag
    and for an 8-item bag alike.
    """

    WINDOW = ram_map.LIST_WINDOW_ROWS

    def __init__(self, items=("POTION", "POKé BALL", "ANTIDOTE")):
        super().__init__()
        self.items = list(items)
        self.rows = self.items + ["CANCEL"]
        self.cursor = 0     # row WITHIN the window
        self.scroll = 0
        self.mem[actions.W_NUM_BAG_ITEMS] = len(self.items)
        self.mem[actions.W_MAX_MENU_ITEM] = min(len(self.rows) - 1, self.WINDOW - 1)
        self._sync()

    @property
    def position(self):
        return self.scroll + self.cursor

    def _sync(self):
        self.mem[actions.W_CURRENT_MENU_ITEM] = self.cursor
        self.mem[actions.W_LIST_SCROLL_OFFSET] = self.scroll
        self._draw(self.rows[self.scroll:self.scroll + self.WINDOW], self.cursor)

    def press(self, button, hold=8, release=8):
        self.presses.append(button)
        last = len(self.rows) - 1
        if button == "down":
            if self.cursor < min(self.WINDOW - 1, last):
                self.cursor += 1
            elif self.position < last:
                self.scroll += 1
        elif button == "up":
            if self.cursor > 0:
                self.cursor -= 1
            elif self.scroll > 0:
                self.scroll -= 1
        elif button == "a":
            self.selected_label = self.rows[self.position]
        self._sync()


class PartyEmu(TileMapEmu):
    """The party list — 0-based, wMaxMenuItem = count-1, never scrolls.

    Verified live on 2- and 6-mon parties, and end-to-end by switching and
    reading wBattleMonSpecies. This fake exists to keep that correct behaviour
    from being "fixed".
    """

    def __init__(self, mons=("CHARMANDER", "SQUIRTLE")):
        super().__init__()
        self.mons = list(mons)
        self.cursor = 0
        self.mem[actions.W_MAX_MENU_ITEM] = len(self.mons) - 1   # COUNT-1
        self._sync()

    def _sync(self):
        self.mem[actions.W_CURRENT_MENU_ITEM] = self.cursor
        self.mem[ram_map.W_LIST_SCROLL_OFFSET] = 0
        self._draw(self.mons, self.cursor)

    def press(self, button, hold=8, release=8):
        self.presses.append(button)
        if button == "down":
            self.cursor = (self.cursor + 1) % len(self.mons)
        elif button == "up":
            self.cursor = (self.cursor - 1) % len(self.mons)
        elif button == "a":
            self.selected_label = self.mons[self.cursor]
        self._sync()


class TestLabelReadback(unittest.TestCase):
    def test_reads_the_entry_the_arrow_points_at(self):
        emu = StartMenuEmu()
        self.assertEqual(ram_map.menu_cursor_label(emu), "POKéMON")
        emu.press("down")
        self.assertEqual(ram_map.menu_cursor_label(emu), "ITEM")

    def test_normalize_folds_the_accent(self):
        """REGRESSION (in the probe itself). 'é'.upper() is 'É', so a naive
        startswith("POKEMON") never matches the entry the menu just drew — the
        first probe run reported POKéMON missing from a menu it had printed."""
        self.assertEqual(ram_map.normalize_label("POKéMON"), "POKEMON")
        self.assertTrue(
            ram_map.normalize_label("POKéMON").startswith(
                ram_map.normalize_label("pokemon")))

    def test_off_screen_cursor_pointer_is_not_a_label(self):
        emu = StartMenuEmu()
        emu.mem[ram_map.W_MENU_CURSOR_LOCATION] = 0x00
        emu.mem[ram_map.W_MENU_CURSOR_LOCATION + 1] = 0x00
        self.assertEqual(ram_map.menu_cursor_label(emu), "")


class TestStartMenuSelect(unittest.TestCase):
    """The headline bug: START indices are not stable, so nothing may hardcode
    one. Both layouts must resolve the same names."""

    def test_finds_entries_in_both_layouts(self):
        for has_dex in (False, True):
            for label in ("POKEMON", "ITEM", "SAVE", "EXIT"):
                emu = StartMenuEmu(has_pokedex=has_dex)
                res = actions._start_menu_select(emu, label)
                self.assertTrue(res.get("ok"), f"dex={has_dex} {label}: {res}")
                self.assertEqual(
                    ram_map.normalize_label(emu.selected_label), label,
                    f"dex={has_dex}: asked {label}, got {emu.selected_label}")

    def test_pokedex_shifts_every_index(self):
        """The measured table. If these ever match, the menu stopped being
        dynamic and the whole label-matching approach can be reconsidered."""
        self.assertEqual(StartMenuEmu(False).entries[1], "ITEM")
        self.assertEqual(StartMenuEmu(True).entries[1], "POKéMON")

    def test_hardcoded_index_1_hits_the_bag_before_the_pokedex(self):
        """REGRESSION. `switch` used _menu_select(1) for POKEMON. Reproduced on
        the live emulator: pre-Pokédex it opened the BAG and returned ok=True."""
        emu = StartMenuEmu(has_pokedex=False)
        self.assertTrue(actions._menu_select(emu, 1).get("ok"))
        self.assertEqual(emu.selected_label, "ITEM")     # wanted POKéMON

    def test_hardcoded_index_2_hits_the_trainer_card_before_the_pokedex(self):
        """REGRESSION. `use_item` used _menu_select(2) for ITEM. Live, that
        opened the trainer card (NAME/MONEY/TIME/BADGES), also ok=True."""
        emu = StartMenuEmu(has_pokedex=False)
        self.assertTrue(actions._menu_select(emu, 2).get("ok"))
        self.assertNotEqual(ram_map.normalize_label(emu.selected_label), "ITEM")

    def test_missing_entry_is_reported_not_guessed(self):
        emu = StartMenuEmu(has_pokedex=False)
        res = actions._start_menu_select(emu, "POKEDEX")
        self.assertFalse(res.get("ok"))
        self.assertIn("not on the START menu", res.get("reason", ""))


class TestBagSelect(unittest.TestCase):
    LONG = ["POTION", "POKé BALL", "ANTIDOTE", "PARLYZ HEAL", "HYPER POTION",
            "SUPER POTION", "ESCAPE ROPE", "MOON STONE"]

    def test_reaches_every_item_in_a_long_bag(self):
        for idx, want in enumerate(self.LONG):
            emu = BagEmu(self.LONG)
            res = actions._bag_select(emu, idx)
            self.assertTrue(res.get("ok"), f"slot {idx}: {res}")
            self.assertEqual(emu.selected_label, want)

    def test_old_primitive_cannot_reach_past_the_window(self):
        """REGRESSION. wMaxMenuItem is the window height, so _menu_select bailed
        with 'index 3 exceeds wMaxMenuItem 2' on every deep item."""
        emu = BagEmu(self.LONG)
        self.assertEqual(emu.read(actions.W_MAX_MENU_ITEM), 2)
        res = actions._menu_select(emu, 5)
        self.assertFalse(res.get("ok"))
        self.assertIn("exceeds wMaxMenuItem", res.get("reason", res.get("error", "")))

    def test_scroll_offset_is_part_of_the_position(self):
        emu = BagEmu(self.LONG)
        actions._bag_select(emu, 7)
        self.assertEqual(emu.scroll + emu.cursor, 7)
        self.assertGreater(emu.scroll, 0)   # it genuinely had to scroll

    def test_walks_back_upward(self):
        emu = BagEmu(self.LONG)
        actions._bag_select(emu, 7)
        emu.selected_label = None
        self.assertTrue(actions._bag_select(emu, 1).get("ok"))
        self.assertEqual(emu.selected_label, "POKé BALL")

    def test_count_comes_from_num_bag_items(self):
        emu = BagEmu(self.LONG)
        self.assertEqual(actions._bag_item_count(emu), 8)

    def test_index_past_the_bag_is_rejected(self):
        emu = BagEmu(self.LONG)
        res = actions._bag_select(emu, 9)
        self.assertFalse(res.get("ok"))
        self.assertIn("out of range", res.get("reason", ""))

    def test_cancel_sits_at_index_equal_to_count(self):
        emu = BagEmu(self.LONG)
        self.assertTrue(actions._bag_select(emu, 8).get("ok"))
        self.assertEqual(emu.selected_label, "CANCEL")

    def test_empty_bag_offers_only_cancel(self):
        emu = BagEmu([])
        self.assertEqual(actions._bag_item_count(emu), 0)
        self.assertTrue(actions._bag_select(emu, 0).get("ok"))
        self.assertEqual(emu.selected_label, "CANCEL")


class TestPartySelectStillCorrect(unittest.TestCase):
    """The party list is 0-based and honest. Measured, not assumed — and pinned
    here so the move list's 1-based cursor is never generalised onto it."""

    def test_selects_the_slot_asked_for(self):
        mons = ["CHARMANDER", "SQUIRTLE", "CHARMELEON", "WARTORTLE",
                "CHARIZARD", "PIDGEY"]
        for idx, want in enumerate(mons):
            emu = PartyEmu(mons)
            res = actions._menu_select(emu, idx)
            self.assertTrue(res.get("ok"), f"slot {idx}: {res}")
            self.assertEqual(emu.selected_label, want)

    def test_cursor_is_zero_based_not_one_based(self):
        emu = PartyEmu()
        self.assertEqual(emu.read(actions.W_CURRENT_MENU_ITEM), 0)
        self.assertTrue(actions._menu_select(emu, 0).get("ok"))
        self.assertEqual(emu.selected_label, "CHARMANDER")

    def test_max_menu_item_is_count_minus_one_here(self):
        self.assertEqual(PartyEmu(["A", "B"]).read(actions.W_MAX_MENU_ITEM), 1)

    def test_never_scrolls(self):
        emu = PartyEmu(["A", "B", "C", "D", "E", "F"])
        actions._menu_select(emu, 5)
        self.assertEqual(emu.read(ram_map.W_LIST_SCROLL_OFFSET), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
