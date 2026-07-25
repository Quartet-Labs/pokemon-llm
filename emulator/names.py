"""Human-readable names for Pokémon species and moves, read from the ROM.

The party/battle structs store *internal* species indices (RHYDON == 1, not the
Pokédex number) and internal move indices (POUND == 1). Rather than embed a
static table that could drift from the ROM in the cartridge, we read the name
tables straight out of the loaded ROM the first time we're asked, decode the
Gen-1 character map to ASCII, and cache the result.

ROM locations (pokered / pokeblue, symbols/pokered.sym — shared codebase):
  - MonsterNames  bank 0x07 @ 0x421E   fixed 10 bytes/name, 0x50-padded
  - MoveNames     bank 0x2C @ 0x4000   variable length, 0x50-terminated, packed

File offset for a banked address: bank * 0x4000 + (addr - 0x4000).

The Gen-1 charmap (the subset that appears in names): 0x80-0x99 -> 'A'..'Z',
0xA0-0xB9 -> 'a'..'z', 0xF6-0xFF -> '0'..'9', 0x7F -> space, plus a handful of
punctuation glyphs. 0x50 is the string terminator ("@").
"""
from __future__ import annotations

import os

MONSTER_NAMES_BANK = 0x07
MONSTER_NAMES_ADDR = 0x421E
MONSTER_NAME_LEN = 10
NUM_SPECIES_SLOTS = 190  # internal indices run 1..190 (incl. MISSINGNO gaps)

MOVE_NAMES_BANK = 0x2C
MOVE_NAMES_ADDR = 0x4000
NUM_MOVES = 165

TERMINATOR = 0x50


def _decode_char(b: int) -> str:
    if 0x80 <= b <= 0x99:
        return chr(ord("A") + b - 0x80)
    if 0xA0 <= b <= 0xB9:
        return chr(ord("a") + b - 0xA0)
    if 0xF6 <= b <= 0xFF:
        return chr(ord("0") + b - 0xF6)
    if b == 0x7F:
        return " "
    return {
        0x9A: "(", 0x9B: ")", 0x9C: ":", 0x9D: ";", 0x9E: "[", 0x9F: "]",
        0xE1: "PK", 0xE2: "MN", 0xE3: "-", 0xE6: "?", 0xE7: "!", 0xE8: ".",
        0xE9: "&", 0xEF: "♂",  # male sign (Nidoran M)
        0xF5: "♀",  # female sign (Nidoran F)
        0xF4: ",",
    }.get(b, "")


def _decode(raw: bytes) -> str:
    out = []
    for b in raw:
        if b == TERMINATOR:
            break
        out.append(_decode_char(b))
    return "".join(out).strip()


def _rom_offset(bank: int, addr: int) -> int:
    return bank * 0x4000 + (addr - 0x4000)


class NameTable:
    """Species/move name lookups, lazily loaded from a ROM byte buffer."""

    def __init__(self) -> None:
        self._species: dict[int, str] | None = None
        self._moves: dict[int, str] | None = None

    def _rom_bytes(self, emu) -> bytes:
        path = getattr(emu, "rom_path", None)
        if not path or not os.path.exists(path):
            return b""
        with open(path, "rb") as f:
            return f.read()

    def _load(self, emu) -> None:
        rom = self._rom_bytes(emu)
        self._species = {}
        self._moves = {}
        if not rom:
            return

        base = _rom_offset(MONSTER_NAMES_BANK, MONSTER_NAMES_ADDR)
        for i in range(NUM_SPECIES_SLOTS):
            start = base + i * MONSTER_NAME_LEN
            name = _decode(rom[start:start + MONSTER_NAME_LEN])
            if name:
                self._species[i + 1] = name  # internal index is 1-based

        off = _rom_offset(MOVE_NAMES_BANK, MOVE_NAMES_ADDR)
        i = off
        for move_id in range(1, NUM_MOVES + 1):
            end = i
            while end < len(rom) and rom[end] != TERMINATOR:
                end += 1
            name = _decode(rom[i:end])
            if name:
                self._moves[move_id] = name
            i = end + 1

    def species_name(self, emu, species_id: int) -> str | None:
        if self._species is None:
            self._load(emu)
        return self._species.get(species_id) if self._species else None

    def move_name(self, emu, move_id: int) -> str | None:
        if self._moves is None:
            self._load(emu)
        return self._moves.get(move_id) if self._moves else None


# Module-level singleton; the ROM never changes within a process.
_TABLE = NameTable()


def species_name(emu, species_id: int) -> str | None:
    return _TABLE.species_name(emu, species_id)


def move_name(emu, move_id: int) -> str | None:
    return _TABLE.move_name(emu, move_id)
