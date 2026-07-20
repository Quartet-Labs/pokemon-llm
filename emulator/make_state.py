"""Script the title/intro/name-entry to reach a controllable overworld, then
save a PyBoy savestate to emulator/overworld.state.

Fresh boot lands in the Game Freak logo -> title screen -> Oak intro speech ->
name entry. Mashing A/START through all of it accepts default names and drops
the player in the bedroom (map 38), where the d-pad moves the sprite. We detect
"controllable" by pressing a direction and confirming the player Y/X coordinate
changes, then snapshot.

Run:  .venv/bin/python -m emulator.make_state
"""
from __future__ import annotations

from emulator.emu import Emu, STATE_PATH

MAP_ID = 0xD35E
PY = 0xD361
PX = 0xD362


def mash(emu: Emu, button: str, times: int, hold: int = 4, release: int = 4) -> None:
    for _ in range(times):
        emu.press(button, hold=hold, release=release)


def controllable(emu: Emu) -> bool:
    """Can the player move? Try each direction; if Y or X changes, yes."""
    y0, x0 = emu.read(PY), emu.read(PX)
    for d in ("down", "up", "left", "right"):
        emu.press(d, hold=8, release=16)
        if (emu.read(PY), emu.read(PX)) != (y0, x0):
            return True
    return False


def main() -> None:
    emu = Emu(headless=True)
    # Boot through the Game Freak / title splash.
    emu.tick(600)
    # Mash A through the title, Oak's speech, and name entry (default names).
    mash(emu, "a", 250, hold=4, release=6)
    # A few STARTs in case a menu wants confirming, then more A.
    mash(emu, "start", 10)
    mash(emu, "a", 120, hold=4, release=6)

    if not controllable(emu):
        # Give it another round — some emulated timings need more mashing.
        mash(emu, "a", 200, hold=4, release=6)

    ok = controllable(emu)
    print(f"map={emu.read(MAP_ID)} y={emu.read(PY)} x={emu.read(PX)} "
          f"party={emu.read(0xD163)} controllable={ok}")
    if not ok:
        raise SystemExit("Did not reach a controllable overworld — not saving.")

    emu.save_state(STATE_PATH)
    print(f"saved savestate -> {STATE_PATH}")
    emu.stop()


if __name__ == "__main__":
    main()
