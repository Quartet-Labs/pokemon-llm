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
            "level": emu.read(base + OFF_LEVEL),
            "hp": _be16(emu, base + OFF_HP),
            "max_hp": _be16(emu, base + OFF_MAXHP),
        })
    return party


def _read_battle_mon(emu, species_addr, hp_addr, level_addr, maxhp_addr,
                     moves_addr=None) -> dict:
    mon = {
        "species": emu.read(species_addr),
        "level": emu.read(level_addr),
        "hp": _be16(emu, hp_addr),
        "max_hp": _be16(emu, maxhp_addr),
    }
    if moves_addr is not None:
        # 4 move slots; 0 means "no move in this slot", drop those.
        mon["moves"] = [m for m in emu.read_range(moves_addr, 4) if m != 0]
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
    return state
