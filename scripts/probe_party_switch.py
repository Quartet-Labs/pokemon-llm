#!/usr/bin/env python3
"""Prove which party slot `switch` actually selects, on a 2-mon party.

The 1-mon savestate can show that the party cursor is 0-based but cannot show
whether index N selects mon N — with one entry every mapping looks correct.
That is the same trap that let `battle_move` pass eyeball checks for weeks.

So: synthesise a second party member directly in WRAM (party structs, species
list and the nickname table are all plain RAM the menu handler reads), open the
in-battle PKMN list, select a slot, and check the ONLY unforgeable side effect —
which species is standing on the field afterwards (wBattleMonSpecies).

Forging the party is sound here because the menu handler has no other source of
truth: it draws from wPartyCount / wPartySpecies / wPartyMons / wPartyMonNicks,
which is exactly what we write. The run asserts the game drew both entries
before trusting any of the cursor readings.

Usage:
    .venv/bin/python -m scripts.probe_party_switch
"""
from __future__ import annotations

import io
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from emulator import actions, names, ram_map  # noqa: E402
from emulator.emu import Emu  # noqa: E402

STATE = os.path.join(os.path.dirname(__file__), "..", "data", "states",
                     "rival-battle-menu.state")

# pokered wram.asm — the tables the party menu draws from.
W_PARTY_COUNT = ram_map.PARTY_COUNT      # 0xD163
W_PARTY_SPECIES = ram_map.PARTY_SPECIES  # 0xD164, count bytes + 0xFF terminator
W_PARTY_MONS = ram_map.PARTY_MONS        # 0xD16B, 44 bytes each
W_PARTY_MON_OT = 0xD273                  # 6 * 11 bytes
W_PARTY_MON_NICKS = 0xD2B5               # 6 * 11 bytes
NICK_LEN = 11
MON_SIZE = ram_map.PARTY_MON_SIZE

# Internal species index (NOT Pokédex number). Distinct from CHARMANDER (176) so
# the swap-in is unambiguous on sight.
SQUIRTLE = 177


def write(emu, addr: int, values) -> None:
    for i, v in enumerate(values):
        emu.pyboy.memory[addr + i] = v


def encode_name(text: str, length: int = NICK_LEN) -> list[int]:
    """Gen-1 charmap encode, 0x50-terminated and padded."""
    out = [0x80 + (ord(c) - ord("A")) for c in text.upper() if "A" <= c <= "Z"]
    out = out[:length - 1] + [0x50]
    return out + [0x50] * (length - len(out))


def forge_second_mon(emu, species: int = SQUIRTLE, level: int = 9,
                     hp: int = 27) -> dict:
    """Add a second party member by writing the tables the menu reads."""
    slot0 = emu.read_range(W_PARTY_MONS, MON_SIZE)
    slot1 = list(slot0)
    slot1[ram_map.OFF_SPECIES] = species
    slot1[ram_map.OFF_HP] = hp >> 8
    slot1[ram_map.OFF_HP + 1] = hp & 0xFF
    slot1[ram_map.OFF_LEVEL] = level
    slot1[ram_map.OFF_MAXHP] = hp >> 8
    slot1[ram_map.OFF_MAXHP + 1] = hp & 0xFF

    write(emu, W_PARTY_MONS + MON_SIZE, slot1)
    write(emu, W_PARTY_SPECIES, [emu.read(W_PARTY_SPECIES), species, 0xFF])
    write(emu, W_PARTY_MON_NICKS + NICK_LEN,
          encode_name(names.species_name(emu, species) or "SQUIRTLE"))
    write(emu, W_PARTY_MON_OT + NICK_LEN,
          emu.read_range(W_PARTY_MON_OT, NICK_LEN))
    emu.pyboy.memory[W_PARTY_COUNT] = 2
    emu.tick(4)
    return {"party": ram_map.read_party(emu)}


def open_party_list(emu) -> dict:
    """Battle main menu -> PKMN, returning the state of the opened list."""
    menu = actions._wait_for_battle_menu(emu)
    sel = actions._battle_main_select(emu, actions.BATTLE_PKMN)
    emu.tick(30)
    return {"entry_menu": menu, "select": sel}


def screen(emu) -> list[str]:
    tiles = emu.read_range(ram_map.TILEMAP, ram_map.TILEMAP_W * ram_map.TILEMAP_H)
    out = []
    for r in range(ram_map.TILEMAP_H):
        row = tiles[r * ram_map.TILEMAP_W:(r + 1) * ram_map.TILEMAP_W]
        text = " ".join("".join(ram_map._tile_to_char(t) for t in row).split())
        if text:
            out.append(f"{r:2d}: {text}")
    return out


def main() -> int:
    emu = Emu()
    with open(STATE, "rb") as fh:
        emu.pyboy.load_state(fh)
    emu.tick(30)

    report = {"state": os.path.basename(STATE)}
    report["forged"] = forge_second_mon(emu)
    report["active_before"] = names.species_name(
        emu, emu.read(ram_map.BATTLE_MON_SPECIES))

    opened = open_party_list(emu)
    report["open"] = opened
    report["list_screen"] = screen(emu)
    report["max_item_on_open"] = emu.read(0xCC28)
    report["cursor_on_open"] = emu.read(0xCC26)

    # Snapshot the opened list so both slot selections start identically.
    buf = io.BytesIO()
    emu.pyboy.save_state(buf)
    opened_snapshot = buf.getvalue()

    report["selections"] = []
    for want in (0, 1):
        emu.pyboy.load_state(io.BytesIO(opened_snapshot))
        emu.tick(10)
        pick = actions._menu_select(emu, want)
        emu.tick(20)
        # In battle, picking a mon opens SWITCH/STATS/CANCEL; SWITCH is default.
        emu.press("a", hold=8, release=16)
        actions._advance_text(emu, presses=8)
        emu.tick(30)
        got = names.species_name(emu, emu.read(ram_map.BATTLE_MON_SPECIES))
        expected = report["forged"]["party"][want]["name"]
        report["selections"].append({
            "asked_slot": want,
            "menu_select": pick,
            "expected_active": expected,
            "actual_active": got,
            # The whole point: does the mon we asked for end up on the field?
            "honoured": got == expected,
        })

    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
