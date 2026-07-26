#!/usr/bin/env python3
"""Tests for the battle menu macros in emulator/actions.py.

Every constant asserted here was MEASURED against a live rival battle on
2026-07-25 (via the /debug/ram probe), not read off pokered. The fake emulator
below reproduces the three behaviours that made `battle_move` fail, all of which
are counter-intuitive enough that they will be "corrected" back into bugs by
anyone working from the obvious mental model:

  1. The battle main menu is a 2x2 grid, not a 4-item list. wMaxMenuItem reads
     1. The row lives in wCurrentMenuItem, the column in wTopMenuItemX.
  2. The FIGHT move list cursor is ONE-BASED — move slot 0 is cursor value 1.
  3. wTopMenuItemY/X are NOT cleared when a menu closes, so during result text
     they still describe the move list. Only wTextBoxID says it is really up.

    python3 scripts/test_battle_menu.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from emulator import actions, ram_map  # noqa: E402


class FakeEmu:
    """A Game Boy that models the measured battle-menu RAM behaviour."""

    def __init__(self, menu="main", moves=(10, 45, 0, 0), pp=(35, 40, 0, 0),
                 result_text_presses=3):
        self.mem = {}
        self.presses = []
        # How many A-presses of result text a fired move produces before the
        # main menu comes back. Variable in the real game (crits, stat drops,
        # faints), which is why the macro polls instead of mashing a fixed count.
        self.result_text_presses = result_text_presses
        self.text_left = 0
        self.mem[ram_map.IN_BATTLE] = 2
        self.mem[ram_map.TEXTBOX_ID] = ram_map.BATTLE_MENU_TEXTBOX_ID
        for i, m in enumerate(moves):
            self.mem[ram_map.BATTLE_MON_MOVES + i] = m
        for i, p in enumerate(pp):
            self.mem[ram_map.BATTLE_MON_PP + i] = p
        self.n_moves = len([m for m in moves if m])
        self._set_menu(menu)

    def _set_menu(self, menu):
        self.menu = menu
        if menu == "main":
            self.mem[ram_map.TOP_MENU_ITEM_Y] = ram_map.BATTLE_MAIN_TOP_Y
            self.mem[ram_map.TOP_MENU_ITEM_X] = ram_map.BATTLE_MAIN_COL_X[0]
            self.mem[actions.W_CURRENT_MENU_ITEM] = 0   # row
            self.mem[actions.W_MAX_MENU_ITEM] = 1
        elif menu == "moves":
            self.mem[ram_map.TOP_MENU_ITEM_Y] = ram_map.BATTLE_MOVES_TOP_Y
            self.mem[ram_map.TOP_MENU_ITEM_X] = ram_map.BATTLE_MOVES_TOP_X
            self.mem[actions.W_CURRENT_MENU_ITEM] = 1   # 1-BASED
            self.mem[actions.W_MAX_MENU_ITEM] = 3       # lies; 2 moves known

    def read(self, addr):
        return self.mem.get(addr, 0)

    def read16(self, addr):
        return self.read(addr) | (self.read(addr + 1) << 8)

    def read_range(self, addr, length):
        return [self.read(addr + i) for i in range(length)]

    def tick(self, n=1):
        pass

    def press(self, button, hold=8, release=8):
        self.presses.append(button)
        if self.text_left:
            # Result text is up: A pages it, nothing else does anything. Only
            # when it runs out does the main menu redraw and start polling again.
            if button == "a":
                self.text_left -= 1
                if not self.text_left:
                    self._set_menu("main")
                    self.mem[ram_map.TEXTBOX_ID] = \
                        ram_map.BATTLE_MENU_TEXTBOX_ID
            return
        cur = self.mem[actions.W_CURRENT_MENU_ITEM]
        if self.menu == "main":
            if button == "down":
                self.mem[actions.W_CURRENT_MENU_ITEM] = 1
            elif button == "up":
                self.mem[actions.W_CURRENT_MENU_ITEM] = 0
            elif button == "right":
                self.mem[ram_map.TOP_MENU_ITEM_X] = ram_map.BATTLE_MAIN_COL_X[1]
            elif button == "left":
                self.mem[ram_map.TOP_MENU_ITEM_X] = ram_map.BATTLE_MAIN_COL_X[0]
            elif button == "a":
                self.selected = (cur, self.mem[ram_map.TOP_MENU_ITEM_X])
                if self.selected == (0, ram_map.BATTLE_MAIN_COL_X[0]):
                    self._set_menu("moves")     # FIGHT opens the move list
        elif self.menu == "moves":
            # Wraps within the KNOWN moves only, 1-based — so 0 is unreachable.
            if button == "down":
                self.mem[actions.W_CURRENT_MENU_ITEM] = cur % self.n_moves + 1
            elif button == "up":
                self.mem[actions.W_CURRENT_MENU_ITEM] = (
                    cur - 2) % self.n_moves + 1
            elif button == "a":
                self.fired = cur - 1            # 1-based cursor -> 0-based slot
                self.mem[ram_map.BATTLE_MON_PP + self.fired] -= 1
                # The menu closes and result text opens. wTopMenuItemY/X are NOT
                # cleared — that staleness is the point of the regression test.
                self.mem[ram_map.TEXTBOX_ID] = 1
                self.text_left = self.result_text_presses
            elif button == "b":
                self._set_menu("main")


class TestBattleMenuDiscriminator(unittest.TestCase):
    def test_identifies_each_menu(self):
        self.assertEqual(ram_map.battle_menu(FakeEmu("main")), "main")
        self.assertEqual(ram_map.battle_menu(FakeEmu("moves")), "moves")

    def test_stale_geometry_during_result_text_is_not_a_menu(self):
        """REGRESSION. wTopMenuItemY/X still say "move list" after the menu
        closes. Trusting them alone reported the list was open while the cursor
        ignored every press — the permanent-failure state."""
        emu = FakeEmu("moves")
        emu.mem[ram_map.TEXTBOX_ID] = 1          # "Enemy SQUIRTLE used TACKLE!"
        self.assertIsNone(ram_map.battle_menu(emu))

    def test_not_in_battle_is_never_a_menu(self):
        emu = FakeEmu("main")
        emu.mem[ram_map.IN_BATTLE] = 0
        self.assertIsNone(ram_map.battle_menu(emu))


class TestBattleMainMenu(unittest.TestCase):
    """The 2x2 grid. wMaxMenuItem is 1, so anything driving wCurrentMenuItem to
    2 or 3 can never reach ITEM or RUN."""

    def test_each_slot_maps_to_the_right_cell(self):
        for slot, want in ((actions.BATTLE_FIGHT, (0, 9)),
                           (actions.BATTLE_PKMN, (0, 15)),
                           (actions.BATTLE_ITEM, (1, 9)),
                           (actions.BATTLE_RUN, (1, 15))):
            emu = FakeEmu("main")
            res = actions._battle_main_select(emu, slot)
            self.assertTrue(res.get("ok"), f"slot {slot}: {res}")
            self.assertEqual(emu.selected, want, f"slot {slot} hit {emu.selected}")

    def test_run_is_reachable(self):
        """REGRESSION. RUN went through _menu_select(3), which bailed with
        'index 3 exceeds wMaxMenuItem 1' — run was simply broken."""
        emu = FakeEmu("main")
        self.assertTrue(actions._run(emu).get("ok") is not None)
        self.assertEqual(emu.selected, (1, 15))


class TestMoveListSelection(unittest.TestCase):
    def test_cursor_is_one_based(self):
        """REGRESSION. Asking for move 0 used to drive the cursor toward 0,
        which the 1-based list can never reach; it oscillated 1,2,1,2 and gave
        up, permanently, for the rest of the battle."""
        emu = FakeEmu("moves")
        res = actions._move_list_select(emu, 0)
        self.assertTrue(res.get("ok"), res)
        self.assertEqual(emu.fired, 0)

    def test_selects_second_move(self):
        emu = FakeEmu("moves")
        self.assertTrue(actions._move_list_select(emu, 1).get("ok"))
        self.assertEqual(emu.fired, 1)

    def test_empty_slot_uses_real_move_count_not_wmaxmenuitem(self):
        """wMaxMenuItem reads 3 for a two-move battler, so bounds must come
        from the move-id array or slots 2 and 3 look selectable."""
        emu = FakeEmu("moves")
        self.assertEqual(emu.read(actions.W_MAX_MENU_ITEM), 3)
        res = actions._move_list_select(emu, 2)
        self.assertFalse(res.get("ok"))
        self.assertIn("empty", res.get("reason", ""))


class TestBattleMove(unittest.TestCase):
    def test_from_main_menu_honours_move_index(self):
        for idx in (0, 1):
            emu = FakeEmu("main")
            res = actions._battle_move(emu, idx)
            self.assertTrue(res.get("ok"), res)
            self.assertTrue(res.get("move_index_honoured"), res)
            self.assertEqual(res["pp_spent_slots"], [idx])

    def test_from_inside_the_move_list_honours_move_index(self):
        """REGRESSION. Anything that mashes A during the battle intro leaves the
        move list already open. battle_move assumed the main menu and nothing
        restored that assumption, so it failed for the rest of the battle."""
        for idx in (0, 1):
            emu = FakeEmu("moves")
            res = actions._battle_move(emu, idx)
            self.assertTrue(res.get("ok"), res)
            self.assertEqual(res["pp_spent_slots"], [idx])

    def test_pp_not_hp_is_the_success_signal(self):
        """A status move deals no damage, so an HP-based check would call this a
        failure — and conversely a stray A press moves HP while ignoring
        move_index, which is how the bug hid for so long."""
        emu = FakeEmu("main")
        res = actions._battle_move(emu, 1)          # GROWL: no damage
        self.assertFalse(res["enemy_hp_changed"])
        self.assertTrue(res["move_index_honoured"])

    def test_rejects_out_of_range_index(self):
        self.assertIn("error", actions._battle_move(FakeEmu("main"), 9))

    def test_not_in_battle_is_partial(self):
        emu = FakeEmu("main")
        emu.mem[ram_map.IN_BATTLE] = 0
        self.assertTrue(actions._battle_move(emu, 0).get("partial"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
