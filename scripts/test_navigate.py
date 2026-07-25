#!/usr/bin/env python3
"""Tests for scripts/navigate.py.

The viewports below are verbatim captures from a live server on the stock
`emulator/overworld.state` — not hand-drawn fixtures. Both planner bugs these
cover were found by running the thing, and both are silent: the planner does not
crash, it just walks into a wall forever and fills the trajectory with rows that
teach a model to do the same.

    python3 scripts/test_navigate.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import navigate  # noqa: E402


def view(ascii_map, x, y, exits=()):
    return {"map": {"ascii": ascii_map, "position": {"x": x, "y": y},
                    "exits": list(exits)},
            "player": {"position": {"x": x, "y": y}}}


# Red's house, ground floor, standing at (3,3). The front-door warps are at
# (2,7) and (3,7) — and rows y=5,6 render as off-map blanks even though they are
# walkable floor, which is the whole problem.
HOUSE_1F = (
    " ######## \n"
    " ##.#...> \n"
    " ........ \n"
    " ...@.... \n"
    " ...##... \n"
    "          \n"
    "          \n"
    "   >>     "
)

# Oak's lab after the warp, standing at (5,11) by the door.
LAB = (
    "###..#####\n"
    ".........#\n"
    ".........#\n"
    ".........#\n"
    "...>@....#\n"
    "##########"
)


class TestParseMap(unittest.TestCase):
    def test_anchors_on_player_not_row_index(self):
        """The renderer trims blank border rows, so a row's index is NOT its y.
        Anchoring on '@' plus the reported position is what survives that."""
        grid, pos = navigate.parse_map(view(HOUSE_1F, 3, 3))
        self.assertEqual(pos, (3, 3))
        self.assertEqual(grid[(3, 3)], "@")
        # Both front-door warps land where the payload says they are.
        self.assertEqual(grid[(2, 7)], ">")
        self.assertEqual(grid[(3, 7)], ">")
        # The wall pair directly south of the player.
        self.assertEqual(grid[(3, 4)], "#")
        self.assertEqual(grid[(4, 4)], "#")

    def test_empty_mid_battle(self):
        """No overworld view in battle; callers must get a clean 'no idea'."""
        grid, pos = navigate.parse_map({"map": {"ascii": "", "position": {}}})
        self.assertEqual((grid, pos), ({}, None))


class TestBfs(unittest.TestCase):
    def test_finds_shortest_path_in_open_room(self):
        grid, pos = navigate.parse_map(view(LAB, 5, 11))
        path = navigate.bfs(grid, pos, (8, 8))
        self.assertEqual(len(path), 6)  # |dx|=3 + |dy|=3, no detour needed

    def test_routes_around_a_wall(self):
        grid, pos = navigate.parse_map(view(HOUSE_1F, 3, 3))
        # (3,4) and (4,4) are wall; reaching (3,5)-equivalent means going wide.
        path = navigate.bfs(grid, pos, (2, 4))
        self.assertEqual(path, ["west", "south"])

    def test_goal_cell_is_enterable_even_as_a_warp(self):
        """'>' is not in PASSABLE by accident — you step ONTO a warp to use it."""
        grid, pos = navigate.parse_map(view(LAB, 5, 11))
        self.assertEqual(navigate.bfs(grid, pos, (4, 11)), ["west"])


class TestPlanMoves(unittest.TestCase):
    def test_arrived_is_only_true_at_the_target(self):
        moves, arrived = navigate.plan_moves(view(LAB, 5, 11), {"x": 5, "y": 11})
        self.assertEqual((moves, arrived), ([], True))

    def test_blank_rows_do_not_deadlock_the_front_door(self):
        """REGRESSION. The door at (2,7) sits past two rows that render blank,
        and (3,4) — straight down from Red — is a wall, so the goal is not
        reachable inside this window at all. The planner must still commit to a
        leg that closes the gap; the pre-fix version returned nothing and the
        harvest stalled one room short of ever leaving the house.

        Asserted as progress, not as a fixed direction: the real path opens
        west (around the wall) and the shape of it is the planner's business.
        """
        start, goal = (3, 3), (2, 7)
        moves, arrived = navigate.plan_moves(
            view(HOUSE_1F, *start), {"x": goal[0], "y": goal[1]})
        self.assertFalse(arrived)
        self.assertTrue(moves, "planner gave up at the door instead of moving")

        end = start
        for m in moves:
            self.assertEqual(m["type"], "move")
            dx, dy = navigate.DIRECTIONS[m["direction"]]
            end = (end[0] + dx, end[1] + dy)
        before = abs(start[0] - goal[0]) + abs(start[1] - goal[1])
        after = abs(end[0] - goal[0]) + abs(end[1] - goal[1])
        self.assertLess(after, before,
                        f"leg {[m['direction'] for m in moves]} did not get "
                        f"closer to the door")

    def test_refused_cells_are_never_replanned_into(self):
        """REGRESSION. The sprite overlay misses NPCs, so the window renders a
        body as plain floor and BFS routes through it. Without feeding refusals
        back, the planner re-derives the identical illegal step every leg — ten
        identical wall-bumps against Oak's lab door, all recorded as rows."""
        v = view(LAB, 5, 11)
        first, _ = navigate.plan_moves(v, {"x": 5, "y": 8})
        self.assertEqual(first[0]["direction"], "north")

        # Now (5,10) is known-refused: the plan must not open with north again.
        again, _ = navigate.plan_moves(v, {"x": 5, "y": 8}, blocked={(5, 10)})
        self.assertTrue(again)
        self.assertNotEqual(
            (again[0]["direction"], 1), ("north", 1),
            "planner walked back into a cell the emulator already refused")

    def test_gives_up_when_every_route_is_refused(self):
        """An empty plan is the caller's signal to stop. It has to be reachable,
        or 'no route' degrades into an infinite retry."""
        v = view(LAB, 5, 11)
        walled = {(4, 11), (6, 11), (5, 10), (5, 12)}
        moves, arrived = navigate.plan_moves(v, {"x": 8, "y": 8}, blocked=walled)
        self.assertFalse(arrived)
        self.assertEqual(moves, [])


class TestBlockedCell(unittest.TestCase):
    def test_reports_the_cell_a_refused_move_proves_solid(self):
        cell = navigate.blocked_cell(
            (5, 3), {"type": "move", "direction": "east"},
            {"ok": True, "moved": False, "reason": "blocked (wall or facing)"})
        self.assertEqual(cell, (6, 3))

    def test_a_successful_move_proves_nothing(self):
        self.assertIsNone(navigate.blocked_cell(
            (5, 3), {"type": "move", "direction": "east"},
            {"ok": True, "moved": True, "to": {"x": 6, "y": 3}}))

    def test_a_non_move_action_proves_nothing(self):
        """An A-press that did nothing says nothing about the terrain — marking
        a cell solid off it would wall the planner out of open floor."""
        self.assertIsNone(navigate.blocked_cell(
            (5, 3), {"type": "a"}, {"ok": True, "pressed": "a"}))

    def test_a_rejected_action_proves_nothing(self):
        self.assertIsNone(navigate.blocked_cell(
            (5, 3), {"type": "move", "direction": "east"},
            {"ok": False, "error": "unknown direction"}))


class TestFindExit(unittest.TestCase):
    EXITS = [{"at": {"x": 2, "y": 7}, "to_map_id": 255, "to": "map 255"},
             {"at": {"x": 7, "y": 1}, "to_map_id": 38, "to": "your house (2F)"}]

    def test_by_map_id(self):
        v = view(HOUSE_1F, 3, 3, self.EXITS)
        self.assertEqual(navigate.find_exit(v, to_map_id=38), {"x": 7, "y": 1})

    def test_by_name_substring_case_insensitive(self):
        v = view(HOUSE_1F, 3, 3, self.EXITS)
        self.assertEqual(navigate.find_exit(v, to_name="HOUSE (2f)"),
                         {"x": 7, "y": 1})

    def test_missing_exit_is_none_not_an_exception(self):
        v = view(HOUSE_1F, 3, 3, self.EXITS)
        self.assertIsNone(navigate.find_exit(v, to_map_id=40))


if __name__ == "__main__":
    unittest.main(verbosity=2)
