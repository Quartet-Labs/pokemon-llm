#!/usr/bin/env python3
"""Diagnostic: why does an interior's walkable floor decode as '#'?

Boots the emulator at `emulator/overworld.state` (Red's bedroom — tileset
INTERIOR), then dumps, side by side:

  - the tileset collision list (which 8x8 tile ids the engine calls walkable)
  - the raw 20x18 wTileMap
  - the per-block classification read_local_map() produces
  - the ground truth from player_walkable(), which presses the d-pad

If a block reads '#' while the probe says the player can step onto it, the
block classifier is wrong, not the collision list.

Usage:  python3 scripts/probe_interior_tiles.py [--state PATH]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from emulator.emu import Emu, STATE_PATH  # noqa: E402
from emulator import ram_map as rm  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default=STATE_PATH)
    args = ap.parse_args()

    emu = Emu()
    with open(args.state, "rb") as fh:
        emu.pyboy.load_state(fh)
    emu.tick(4)

    tileset = emu.read(rm.CUR_TILESET)
    map_id = emu.read(rm.MAP_ID)
    px, py = emu.read(rm.PLAYER_X), emu.read(rm.PLAYER_Y)
    walkable = rm._walkable_tile_ids(emu)

    print(f"map_id={map_id}  tileset={tileset}  player=({px},{py})")
    print(f"collision_ptr=0x{emu.read16(rm.TILESET_COLLISION_PTR):04X}")
    print(f"walkable tile ids ({len(walkable)}): "
          f"{sorted(hex(t) for t in walkable)}")
    print()

    tiles = emu.read_range(rm.TILEMAP, rm.TILEMAP_W * rm.TILEMAP_H)
    print("raw wTileMap (20x18), hex:")
    for r in range(rm.TILEMAP_H):
        row = tiles[r * rm.TILEMAP_W:(r + 1) * rm.TILEMAP_W]
        print(f"  r{r:2d} " + " ".join(f"{t:02X}" for t in row))
    print()

    print("walkability of each raw tile (W=in collision list, .=not):")
    for r in range(rm.TILEMAP_H):
        row = tiles[r * rm.TILEMAP_W:(r + 1) * rm.TILEMAP_W]
        print(f"  r{r:2d} " + "".join("W" if t in walkable else "." for t in row))
    print()

    local = rm.read_local_map(emu)
    print("read_local_map() ascii:")
    for line in local["ascii"].splitlines():
        print("  " + line)
    print()

    truth = rm.player_walkable(emu)
    print(f"player_walkable() ground truth: {truth}")

    # For each direction the probe says is walkable, report what the block
    # classifier called that neighbour — the disagreement is the bug.
    print()
    print("classifier vs probe for the 4 neighbours:")
    sy, sx = emu.read(rm.PLAYER_SCREEN_Y), emu.read(rm.PLAYER_SCREEN_X)
    acol, arow = sx // 8, (sy + 4) // 8
    pbc, pbr = acol // 2, arow // 2
    deltas = {"north": (0, -1), "south": (0, 1), "east": (1, 0), "west": (-1, 0)}
    for d, (dc, dr) in deltas.items():
        bc, br = pbc + dc, pbr + dr
        ts = [tiles[(br * 2 + dy) * rm.TILEMAP_W + (bc * 2 + dx)]
              for dx in (0, 1) for dy in (0, 1)]
        allw = all(t in walkable for t in ts)
        topleft = ts[0]
        print(f"  {d:6s} block=({bc},{br}) tiles={[hex(t) for t in ts]} "
              f"all_walkable={allw} topleft_walkable={topleft in walkable} "
              f"probe={truth[d]}")

    emu.pyboy.stop(save=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
