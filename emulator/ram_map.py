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
"""
from __future__ import annotations

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


def read_state(emu) -> dict:
    """Return a game-state dict roughly matching the existing JS API shape."""
    in_battle = emu.read(IN_BATTLE)
    badges_raw = emu.read(BADGES)
    return {
        "screen": "battle" if in_battle else "overworld",
        "area": {"id": emu.read(MAP_ID)},
        "player": {
            "position": {"x": emu.read(PLAYER_X), "y": emu.read(PLAYER_Y)},
            "badges": _popcount(badges_raw),
            "badges_bitfield": badges_raw,
            "money": _bcd3(emu, MONEY),
            "party": read_party(emu),
        },
        "in_battle": in_battle,
    }
