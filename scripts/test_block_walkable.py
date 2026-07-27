#!/usr/bin/env python3
"""Tests for the 16x16 movement-block walkability rule in emulator/ram_map.py.

This is a silent failure, which is why it gets tests: misclassifying a block
does not crash anything, it just makes navigate.py's BFS believe a wall is
there. '#' is a *definite* obstacle to the pathfinder (unlike ' ', which is
"unknown" and left to the emulator to rule on), so a false wall is never
attempted and `goto` reports "no route" without moving a step.

The tile values below are the real ones read out of a live session, not
invented: the Pokemon Centre floor block and the collision list are from
data/states/viridian-pokecenter.state (map 41, tileset 6), and the uniform
0x01 floor is from Red's bedroom (tileset 4), which is why the old rule
survived so long undetected.

    python3 scripts/test_block_walkable.py
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from emulator.ram_map import _block_is_walkable  # noqa: E402

# classify_block builds its 4 tiles as [dx for dx in (0,1) for dy in (0,1)],
# i.e. top-left, bottom-left, top-right, bottom-right.
def block(tl, bl, tr, br):
    return [tl, bl, tr, br]


# Tileset 6 (POKECENTER), read from the live collision list at 0xD530.
POKECENTER_WALKABLE = {0x11, 0x1A, 0x1C, 0x2, 0x3, 0x13, 0x14, 0x12, 0x1}
# Tileset 4 (Red's house), where every floor tile is 0x01.
BEDROOM_WALKABLE = {0x1, 0x2, 0x3, 0x11, 0x12, 0x13, 0x14, 0x1A, 0x1C}


class BlockWalkable(unittest.TestCase):

    def test_pokecenter_floor_is_walkable(self):
        """The regression. Only the bottom-left 0x11 is in the collision list;
        the other three tiles are decoration the engine never consults. The old
        all-four rule called this a wall and made the whole building unreachable.
        """
        floor = block(0x01, 0x11, 0x0B, 0x1B)
        self.assertTrue(_block_is_walkable(floor, POKECENTER_WALKABLE))

    def test_pokecenter_counter_is_not_walkable(self):
        """The nurse's counter, north of the healing spot. Its bottom-left 0x18
        is not in the collision list, so it stays solid."""
        counter = block(0x08, 0x18, 0x0A, 0x19)
        self.assertFalse(_block_is_walkable(counter, POKECENTER_WALKABLE))

    def test_uniform_floor_still_walkable(self):
        """Red's bedroom and Oak's lab: four copies of 0x01. Both the old rule
        and the new one accept this, which is exactly why the bug hid — every
        map the opening route touched was uniform."""
        floor = block(0x01, 0x01, 0x01, 0x01)
        self.assertTrue(_block_is_walkable(floor, BEDROOM_WALKABLE))

    def test_solid_block_still_blocked(self):
        """No tile walkable anywhere in the block — must stay a wall under the
        looser rule, or the pathfinder starts walking into furniture."""
        wall = block(0x2D, 0x3D, 0x2E, 0x3E)
        self.assertFalse(_block_is_walkable(wall, BEDROOM_WALKABLE))

    def test_only_bottom_left_is_consulted(self):
        """The rule is specifically bottom-left — the tile under the sprite's
        feet — not "any of the four". A block whose bottom-left is solid stays
        solid even when the other three are walkable, which is what keeps
        test_solid_block_still_blocked from being satisfied by an any() rule.
        """
        self.assertFalse(
            _block_is_walkable(block(0x01, 0xFF, 0x01, 0x01), BEDROOM_WALKABLE))
        self.assertTrue(
            _block_is_walkable(block(0xFF, 0x01, 0xFF, 0xFF), BEDROOM_WALKABLE))

    def test_empty_collision_list_blocks_everything(self):
        """A tileset whose list failed to read must not read as open floor."""
        self.assertFalse(_block_is_walkable(block(0x1, 0x1, 0x1, 0x1), set()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
