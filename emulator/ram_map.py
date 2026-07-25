"""RAM -> game-state adapter for Pokémon Blue.

Reads documented WRAM addresses into a dict shaped like the existing JS game
API's /state view. Red and Blue share the identical pokered/pokeblue codebase,
so all these addresses are common to both.

Address sourcing
----------------
VERIFIED LIVE against this emulator (values observed to change when driving):
  - map id            0xD35E   wCurMap
  - player Y          0xD361   wYCoord
  - player X          0xD362   wXCoord
  - party count       0xD163   wPartyCount
  - in-battle flag    0xD057   wIsInBattle   (0 none / 1 wild / 2 trainer)
  - badges bitfield   0xD356   wObtainedBadges (popcount = badge count)

FROM pokered/pokeblue (wram.asm) — party-mon struct, not yet exercised live
because the starting savestate has an empty party (count 0). Documented so the
reads are correct the moment the agent catches a mon:
  - species list      0xD164   wPartySpecies (party_count bytes, 0xFF terminator)
  - party mon structs 0xD16B   wPartyMons, 44 (0x2C) bytes each
      +0x00  species  (1 byte, internal index)
      +0x01  currentHP (2 bytes, big-endian)
      +0x21  level    (1 byte)   [offset 33]
      +0x22  maxHP    (2 bytes, big-endian)
  - money             0xD347   wPlayerMoney, 3-byte BCD, big-endian

FROM pokered/pokeblue (symbols/pokered.sym) — battle structs. The enemy's active
mon and the player's active mon share the identical `battle_struct` layout:
  +0x00 species (1 byte) | +0x01 HP (2 bytes big-endian) | +0x08 moves (4 bytes)
  | +0x0E level (1 byte) | +0x0F maxHP (2 bytes big-endian).
VERIFIED LIVE against the intro Oak's-lab rival battle (see PR notes):
  - enemy species     0xCFE5   wEnemyMonSpecies
  - enemy HP          0xCFE6   wEnemyMonHP    (2 bytes big-endian)
  - enemy level       0xCFF3   wEnemyMonLevel
  - enemy maxHP       0xCFF4   wEnemyMonMaxHP (2 bytes big-endian)
  - player species    0xD014   wBattleMonSpecies
  - player HP         0xD015   wBattleMonHP   (2 bytes big-endian)
  - player moves      0xD01C   wBattleMonMoves (4 bytes, 0 = empty slot)
  - player level      0xD022   wBattleMonLevel
  - player maxHP      0xD023   wBattleMonMaxHP (2 bytes big-endian)

FROM pokered (symbols/pokered.sym), VERIFIED live at the bedroom start — used to
compute the walkable-neighbor readout via a save/probe/restore speculative test:
  - in-battle type    0xD057   wIsInBattle (see above; 1 wild / 2 trainer)
  - current tileset   0xD367   wCurMapTileset (INTERIOR=4 at the bedroom start)
  - collision list    0xD530   wTilesetCollisionPtr (2-byte LE ptr into the home
                               bank; points at a 0xFF-terminated list of the tile
                               IDs walkable in this tileset — documented for
                               reference; the walkable readout uses the probe
                               method instead, see player_walkable() below)
"""
from __future__ import annotations

import io

try:  # package import (server/actions use `from emulator import ram_map`)
    from emulator import names as _names
except ImportError:  # direct `import ram_map` from inside emulator/
    import names as _names

MAP_ID = 0xD35E
PLAYER_Y = 0xD361
PLAYER_X = 0xD362
BADGES = 0xD356
PARTY_COUNT = 0xD163
PARTY_SPECIES = 0xD164
PARTY_MONS = 0xD16B
PARTY_MON_SIZE = 44
MONEY = 0xD347
IN_BATTLE = 0xD057

# Party-mon struct offsets (pokered wram.asm).
OFF_SPECIES = 0x00
OFF_HP = 0x01          # 2 bytes big-endian
OFF_LEVEL = 0x21       # 33
OFF_MAXHP = 0x22       # 2 bytes big-endian

# ── battle struct (pokered symbols/pokered.sym) ──────────────────────────────
# Enemy active mon.
ENEMY_MON_SPECIES = 0xCFE5
ENEMY_MON_HP = 0xCFE6       # 2 bytes big-endian
ENEMY_MON_LEVEL = 0xCFF3
ENEMY_MON_MAXHP = 0xCFF4    # 2 bytes big-endian
# Player active mon.
BATTLE_MON_SPECIES = 0xD014
BATTLE_MON_HP = 0xD015      # 2 bytes big-endian
BATTLE_MON_MOVES = 0xD01C   # 4 bytes, one move id each (0 = empty slot)
BATTLE_MON_LEVEL = 0xD022
BATTLE_MON_MAXHP = 0xD023   # 2 bytes big-endian

# ── on-screen tilemap + text (pokered symbols/pokered.sym) ───────────────────
# wTileMap: the 20x18 grid of background tile IDs currently on screen (what the
# player literally sees). DMA'd to VRAM each frame, so it's always current.
TILEMAP = 0xC3A0
TILEMAP_W = 20
TILEMAP_H = 18
# Current map's tileset id (wCurMapTileset). INTERIOR=4 at the bedroom start.
CUR_TILESET = 0xD367
# Per-tileset "tall grass" tile id (wGrassTile) — the encounter tile. The engine
# sets this from the tileset header, so grass reads correctly on any map without
# a per-map guess; 0xFF means the tileset has no grass. VERIFY against pixels
# before trusting it (a wrong address would paint '"' on non-grass tiles).
GRASS_TILE = 0xD535
# Collision list for the current tileset: a 0xFF-terminated list (in the home
# bank, directly readable) of the tile IDs that are walkable in this tileset.
TILESET_COLLISION_PTR = 0xD530   # 2-byte LE pointer
# Warp table: wNumberOfWarps + wWarpEntries (4 bytes each: y, x, destWarp, dest
# map). These are the exits/doors/stairs — in *map* tile coordinates.
NUM_WARPS = 0xD3AE
WARP_ENTRIES = 0xD3AF
WARP_ENTRY_SIZE = 4
# Sprite state data 2: 16 bytes/sprite starting at 0xC200. Sprite 0 is the
# player; 1..15 are NPCs/objects. +0x04 = map Y, +0x05 = map X, +0x00 (data1
# PictureID at 0xC100 block) nonzero means the slot is active.
SPRITE_DATA1 = 0xC100        # +0x00 PictureID (0 = inactive slot)
SPRITE_DATA2 = 0xC200        # +0x04 MapY, +0x05 MapX
SPRITE_STRIDE = 0x10
NUM_SPRITE_SLOTS = 16
# Player on-screen anchor. The overworld camera keeps the player centered via
# border-block padding, but a fixed (col,row) guess desyncs the '@'/'>'/'N'
# overlays from the base tilemap. Instead read the player sprite's actual screen
# position each frame (wSpriteStateData1 sprite 0: +0x04 Y px "4px above grid",
# +0x06 X px "snaps to grid") and derive the standing tile — self-correcting.
PLAYER_SCREEN_Y = 0xC104
PLAYER_SCREEN_X = 0xC106
# Fallbacks if the sprite read looks bad (mid-transition/off-screen).
PLAYER_SCREEN_COL = 8
PLAYER_SCREEN_ROW = 8

# Tileset "talking-over" tiles (shop counters / tables you interact across):
# up to 3 tile ids in the tileset header (0 = unused slot).
COUNTER_TILES = 0xD532

# Textbox state. wTextBoxID is nonzero while a textbox/menu is up; the printed
# text lives in wTileMap itself as font tiles (0x80='A'.. see _tile_to_char).
TEXTBOX_ID = 0xD125

# ── walkable probe (collision) ───────────────────────────────────────────────
# Directions the agent speaks -> PyBoy d-pad buttons. Mirrors
# actions.DIRECTION_BUTTON (kept local to avoid an import cycle: actions imports
# this module).
_WALK_DIRS = {"north": "up", "south": "down", "east": "right", "west": "left"}
# How many presses to attempt per direction before declaring a tile blocked.
# A single grid step normally completes in <=2 presses; 3 is a safe cap and keeps
# the whole 4-way probe cheap (PyBoy runs uncapped, ~thousands of fps headless).
_WALK_PROBE_TRIES = 3


def _be16(emu, addr: int) -> int:
    """Big-endian 16-bit read (party struct HP fields are big-endian)."""
    return (emu.read(addr) << 8) | emu.read(addr + 1)


def _bcd3(emu, addr: int) -> int:
    """Decode a 3-byte big-endian BCD value (money)."""
    total = 0
    for i in range(3):
        byte = emu.read(addr + i)
        total = total * 100 + (byte >> 4) * 10 + (byte & 0x0F)
    return total


def _popcount(n: int) -> int:
    return bin(n & 0xFF).count("1")


def read_party(emu) -> list[dict]:
    count = emu.read(PARTY_COUNT)
    if count == 0 or count > 6:
        return []
    party = []
    for i in range(count):
        base = PARTY_MONS + i * PARTY_MON_SIZE
        species = emu.read(base + OFF_SPECIES)
        # Also available directly in the species list; prefer the struct.
        party.append({
            "species": species,
            "name": _names.species_name(emu, species),
            "level": emu.read(base + OFF_LEVEL),
            "hp": _be16(emu, base + OFF_HP),
            "max_hp": _be16(emu, base + OFF_MAXHP),
        })
    return party


def _read_battle_mon(emu, species_addr, hp_addr, level_addr, maxhp_addr,
                     moves_addr=None) -> dict:
    species = emu.read(species_addr)
    mon = {
        "species": species,
        "name": _names.species_name(emu, species),
        "level": emu.read(level_addr),
        "hp": _be16(emu, hp_addr),
        "max_hp": _be16(emu, maxhp_addr),
    }
    if moves_addr is not None:
        # 4 move slots; 0 means "no move in this slot", drop those.
        move_ids = [m for m in emu.read_range(moves_addr, 4) if m != 0]
        mon["move_ids"] = move_ids
        mon["moves"] = [_names.move_name(emu, m) or f"MOVE_{m}"
                        for m in move_ids]
    return mon


def read_battle(emu) -> dict | None:
    """Enemy + your active battle mon, read from the pokered battle structs.

    Returns None when not in a battle (wIsInBattle == 0). Both structs share the
    identical `battle_struct` layout; HP fields are big-endian, matching the
    party struct. Move ids are the game's internal move indices (0 = empty slot).
    """
    if emu.read(IN_BATTLE) == 0:
        return None
    return {
        "enemy": _read_battle_mon(
            emu, ENEMY_MON_SPECIES, ENEMY_MON_HP, ENEMY_MON_LEVEL,
            ENEMY_MON_MAXHP),
        "active": _read_battle_mon(
            emu, BATTLE_MON_SPECIES, BATTLE_MON_HP, BATTLE_MON_LEVEL,
            BATTLE_MON_MAXHP, moves_addr=BATTLE_MON_MOVES),
    }


def player_walkable(emu) -> dict:
    """Which of the 4 adjacent tiles the player can actually step onto.

    Implementation: speculative save/probe/restore. We snapshot the full emulator
    to an in-memory buffer, then for each direction press the d-pad and check
    whether the player's (x, y, map) actually changed; a step that leaves the
    coordinate unchanged means a wall, sign, sprite, or ledge blocked it. After
    each direction we reload the snapshot so probing has NO side effect on the
    live session (position, party, RNG-relevant game state all restored — only
    volatile frame/clock counters advance, exactly as a `wait` would).

    Chosen over the tileset-collision-list method because it exercises the game's
    real movement logic (walls AND sprites AND ledges AND facing-vs-moving),
    which a static tilemap read cannot fully reproduce, and because it needs no
    ROM-bank arithmetic. PyBoy runs uncapped headless, so 4 probes/turn is cheap.

    Not meaningful mid-battle (no overworld movement), so we skip probing and
    report all-false when in a battle.
    """
    result = {d: False for d in _WALK_DIRS}
    if emu.read(IN_BATTLE) != 0:
        return result

    buf = io.BytesIO()
    emu.pyboy.save_state(buf)
    snapshot = buf.getvalue()

    x0, y0, m0 = emu.read(PLAYER_X), emu.read(PLAYER_Y), emu.read(MAP_ID)
    for direction, button in _WALK_DIRS.items():
        moved = False
        for _ in range(_WALK_PROBE_TRIES):
            emu.press(button, hold=12, release=20)
            if (emu.read(PLAYER_X), emu.read(PLAYER_Y),
                    emu.read(MAP_ID)) != (x0, y0, m0):
                moved = True
                break
        result[direction] = moved
        # Restore before the next probe so directions don't interfere and the
        # live session is left exactly where it started.
        emu.pyboy.load_state(io.BytesIO(snapshot))
        emu.tick(1)
    return result


# ── on-screen tilemap font decode ────────────────────────────────────────────
# Gen-1 loads its font so that tile ID 0x80 == 'A'. Uppercase 0x80-0x99, lower
# 0xA0-0xB9, digits 0xF6-0xFF, plus punctuation. 0x7F is the in-box blank tile.
# Border tiles (0x79-0x7E) frame textboxes/menus and decode to nothing.
def _tile_to_char(tile: int) -> str:
    if 0x80 <= tile <= 0x99:
        return chr(ord("A") + tile - 0x80)
    if 0xA0 <= tile <= 0xB9:
        return chr(ord("a") + tile - 0xA0)
    if 0xF6 <= tile <= 0xFF:
        return chr(ord("0") + tile - 0xF6)
    if tile in (0x7F, 0x00):        # in-box blank / empty
        return " "
    return {
        0x9A: "(", 0x9B: ")", 0x9C: ":", 0x9D: ";", 0x9E: "[", 0x9F: "]",
        0xBA: "é", 0xE1: "PK", 0xE2: "MN", 0xE3: "-", 0xE6: "?", 0xE7: "!",
        0xE8: ".", 0xE9: "&", 0xF2: ".", 0xF4: ",", 0xEF: "♂", 0xF5: "♀",
        0x75: "…",
    }.get(tile, "")


def _is_text_tile(tile: int) -> bool:
    """A tile that carries readable text (a glyph), excluding blanks/borders."""
    return (0x80 <= tile <= 0x99 or 0xA0 <= tile <= 0xB9
            or 0xF6 <= tile <= 0xFF
            or tile in (0x9A, 0x9B, 0x9C, 0x9D, 0x9E, 0x9F, 0xBA, 0xE1, 0xE2,
                        0xE3, 0xE6, 0xE7, 0xE8, 0xE9, 0xF2, 0xF4, 0xEF, 0xF5,
                        0x75))


def read_dialogue(emu) -> dict | None:
    """Text shown in the current on-screen textbox/menu, decoded to ASCII.

    Returns None when no textbox is up (wTextBoxID == 0 and no text glyphs on
    screen). Reads the printed characters straight out of wTileMap: any row that
    contains font glyphs is decoded left-to-right, blank runs collapse to single
    spaces, and rows are joined with newlines. This captures NPC dialogue, sign
    text, menu contents, and battle messages alike.
    """
    tiles = emu.read_range(TILEMAP, TILEMAP_W * TILEMAP_H)
    grid = [tiles[r * TILEMAP_W:(r + 1) * TILEMAP_W] for r in range(TILEMAP_H)]

    lines = []
    for row in grid:
        if not any(_is_text_tile(t) for t in row):
            continue
        # Blank out filler runs: some menu/graphic rows repeat one font tile
        # (e.g. tile 0x80 drawn as a horizontal divider bar) which would decode
        # to "AAAAAAA". A run of >=4 identical text tiles is never a real word.
        cleaned = list(row)
        i = 0
        while i < len(cleaned):
            j = i
            while j < len(cleaned) and cleaned[j] == cleaned[i]:
                j += 1
            if _is_text_tile(cleaned[i]) and j - i >= 4:
                for k in range(i, j):
                    cleaned[k] = 0x7F  # blank
            i = j
        chars = "".join(_tile_to_char(t) for t in cleaned)
        # Collapse interior blank runs, strip the border padding at the edges.
        collapsed = " ".join(chars.split())
        if collapsed:
            lines.append(collapsed)

    active = emu.read(TEXTBOX_ID) != 0
    if not lines and not active:
        return None
    text = "\n".join(lines).strip()
    if not text:
        return None
    return {"text": text}


# ── local ASCII map ──────────────────────────────────────────────────────────
_GLYPH_PLAYER = "@"
_GLYPH_PATH = "."
_GLYPH_WALL = "#"
_GLYPH_WARP = ">"     # door / stairs / any exit warp
_GLYPH_NPC = "N"
_GLYPH_GRASS = '"'    # tall grass (wild-encounter tile)
_GLYPH_COUNTER = "c"  # shop counter / talk-over furniture
_GLYPH_OFFMAP = " "   # outside the loaded room (black padding tiles)

_MAP_LEGEND = {
    _GLYPH_PLAYER: "you",
    _GLYPH_PATH: "walkable",
    _GLYPH_WALL: "wall/obstacle",
    _GLYPH_WARP: "exit — walk onto it (bottom-edge doors: keep walking south out) "
                 "to use; see 'exits' for where each leads",
    _GLYPH_NPC: "person/sprite",
    _GLYPH_GRASS: "tall grass (wild encounters)",
    _GLYPH_COUNTER: "counter/furniture (talk across, can't walk on)",
    _GLYPH_OFFMAP: "off-map",
}

# Destination-map names for the badge-1 arc. The RAM warp table records each
# exit's destination map id (something a screenshot cannot show) — naming it
# turns a bare '>' into "this door leads to Route 1". Unknown ids fall back to
# "map <id>" rather than inventing a name.
_MAP_NAMES = {
    0: "Pallet Town", 1: "Viridian City", 2: "Pewter City", 3: "Cerulean City",
    12: "Route 1", 13: "Route 2", 14: "Route 3",
    37: "your house (1F)", 38: "your house (2F)", 39: "rival's house",
    40: "Oak's Lab", 51: "Viridian Forest", 54: "Pewter Gym (Brock)",
}


def _map_name(map_id: int) -> str:
    return _MAP_NAMES.get(map_id, f"map {map_id}")


def _walkable_tile_ids(emu) -> set[int]:
    """The 0xFF-terminated walkable-tile list for the current tileset."""
    ptr = emu.read16(TILESET_COLLISION_PTR)
    ids = set()
    addr = ptr
    for _ in range(128):
        v = emu.read(addr)
        addr += 1
        if v == 0xFF:
            break
        ids.add(v)
    return ids


def _map_to_screen(mx: int, my: int, px: int, py: int):
    """Map tile (mx,my) -> (col,row) in the 20x18 on-screen tilemap, using the
    player's centered anchor."""
    return (PLAYER_SCREEN_COL + (mx - px), PLAYER_SCREEN_ROW + (my - py))


def read_local_map(emu) -> dict:
    """Render the visible area around the player as an ASCII grid.

    Base layer: classify each on-screen tile (wTileMap) as walkable path vs
    wall via the tileset collision list. Overlay, in order: warps/exits from the
    map's warp table ('>'), NPC/object sprites ('N'), and the player ('@'). The
    black padding around a small room decodes to off-map blanks so the room's
    shape — and its exits — read clearly.

    Not meaningful mid-battle (no overworld view), so returns an empty grid then.
    """
    px, py = emu.read(PLAYER_X), emu.read(PLAYER_Y)
    position = {"x": px, "y": py}
    if emu.read(IN_BATTLE) != 0:
        return {"ascii": "", "legend": {}, "position": position, "exits": []}

    tiles = emu.read_range(TILEMAP, TILEMAP_W * TILEMAP_H)
    walkable = _walkable_tile_ids(emu)
    grass_tile = emu.read(GRASS_TILE)
    counters = {emu.read(COUNTER_TILES + i) for i in range(3)} - {0}

    def tile_at(c, r):
        return tiles[r * TILEMAP_W + c]

    # Gen-1's world — player position, movement, warp coords — is a 16x16 BLOCK
    # grid (each block = 2x2 of the 8x8 tiles). Render ONE glyph per block so the
    # map shares that coordinate system instead of being 2x oversized (a 1-block
    # TV was showing as a 2x2 wall clump). Blocks are tile-aligned to even offsets.
    BW, BH = TILEMAP_W // 2, TILEMAP_H // 2   # 10 x 9 blocks
    def classify_block(bc, br):
        ts = [tile_at(bc * 2 + dx, br * 2 + dy) for dx in (0, 1) for dy in (0, 1)]
        if all(t == 0x10 for t in ts):        # solid black padding = off-map
            return _GLYPH_OFFMAP
        if grass_tile != 0xFF and any(t == grass_tile for t in ts):
            return _GLYPH_GRASS
        if any(t in counters for t in ts):
            return _GLYPH_COUNTER
        if all(t in walkable for t in ts):
            return _GLYPH_PATH
        return _GLYPH_WALL

    grid = [[classify_block(bc, br) for bc in range(BW)] for br in range(BH)]

    # A dialogue/menu box covers the bottom ~6 tile rows (3 block rows) with text
    # tiles that would otherwise read as a wall band. Blank them while it's up.
    if emu.read(TEXTBOX_ID) != 0:
        for br in range(BH - 3, BH):
            grid[br] = [_GLYPH_OFFMAP] * BW

    def put(col, row, glyph):
        if 0 <= row < BH and 0 <= col < BW:
            grid[row][col] = glyph

    # Player's block cell on screen: sprite screen pixel -> tile -> block.
    sy, sx = emu.read(PLAYER_SCREEN_Y), emu.read(PLAYER_SCREEN_X)
    acol = sx // 8
    arow = (sy + 4) // 8
    if not (0 <= acol < TILEMAP_W and 0 <= arow < TILEMAP_H):
        acol, arow = PLAYER_SCREEN_COL, PLAYER_SCREEN_ROW
    pbc, pbr = acol // 2, arow // 2

    # Player/warp coords are already in blocks, so overlays are a plain block delta.
    def to_block(mx, my):
        return (pbc + (mx - px), pbr + (my - py))

    # Overlay warps/exits and record where each leads.
    # WARP_ENTRY layout (pokered): +0 y, +1 x, +2 destWarp, +3 destMap.
    exits = []
    n_warps = emu.read(NUM_WARPS)
    if n_warps <= 32:
        for i in range(n_warps):
            base = WARP_ENTRIES + i * WARP_ENTRY_SIZE
            wy, wx = emu.read(base), emu.read(base + 1)
            dest_map = emu.read(base + 3)
            col, row = to_block(wx, wy)
            put(col, row, _GLYPH_WARP)
            exits.append({"at": {"x": wx, "y": wy},
                          "to_map_id": dest_map, "to": _map_name(dest_map)})

    # Overlay NPC/object sprites (slots 1..15; slot 0 is the player).
    for s in range(1, NUM_SPRITE_SLOTS):
        pic = emu.read(SPRITE_DATA1 + s * SPRITE_STRIDE)  # PictureID, 0 = inactive
        if pic == 0:
            continue
        d2 = SPRITE_DATA2 + s * SPRITE_STRIDE
        smy, smx = emu.read(d2 + 0x04), emu.read(d2 + 0x05)
        pmy, pmx = emu.read(SPRITE_DATA2 + 0x04), emu.read(SPRITE_DATA2 + 0x05)
        col, row = to_block(px + (smx - pmx), py + (smy - pmy))
        put(col, row, _GLYPH_NPC)

    # Player last, so it wins any overlap.
    put(pbc, pbr, _GLYPH_PLAYER)

    # Trim fully-off-map border rows/cols so the room isn't buried in blanks.
    def row_blank(row):
        return all(ch == _GLYPH_OFFMAP for ch in row)

    top, bot = 0, len(grid) - 1
    while top < bot and row_blank(grid[top]):
        top += 1
    while bot > top and row_blank(grid[bot]):
        bot -= 1
    rows = grid[top:bot + 1]
    ascii_map = "\n".join("".join(r) for r in rows)

    return {"ascii": ascii_map, "legend": dict(_MAP_LEGEND),
            "position": position, "exits": exits}


def read_state(emu) -> dict:
    """Return a game-state dict roughly matching the existing JS API shape."""
    in_battle = emu.read(IN_BATTLE)
    badges_raw = emu.read(BADGES)
    state = {
        "screen": "battle" if in_battle else "overworld",
        "area": {"id": emu.read(MAP_ID)},
        "player": {
            "position": {"x": emu.read(PLAYER_X), "y": emu.read(PLAYER_Y)},
            "badges": _popcount(badges_raw),
            "badges_bitfield": badges_raw,
            "money": _bcd3(emu, MONEY),
            "party": read_party(emu),
            "walkable": player_walkable(emu),
        },
        "in_battle": in_battle,
    }
    battle = read_battle(emu)
    if battle is not None:
        state["battle"] = battle

    # Navigational + situational fields, TOP-LEVEL on the state (consistent with
    # the other fields and visible to the couch viewer): a local ASCII map (with
    # exits marked) and, when a textbox is up, the decoded on-screen text.
    state["map"] = read_local_map(emu)
    dialogue = read_dialogue(emu)
    if dialogue is not None:
        state["dialogue"] = dialogue
    return state
