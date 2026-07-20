"""PyBoy wrapper for Pokémon Blue.

Thin layer over PyBoy: load the ROM headless, step frames, press buttons,
read RAM, and grab the screen. All state derivation lives in ram_map.py;
all high-level action semantics live in actions.py. This file is just the
Game Boy.
"""
from __future__ import annotations

import base64
import io
import os

from PIL import Image
from pyboy import PyBoy

ROM_PATH = os.environ.get(
    "POKEMON_ROM",
    os.path.join(os.path.dirname(__file__), "..", "roms", "pokemon_blue.gb"),
)
STATE_PATH = os.path.join(os.path.dirname(__file__), "overworld.state")

# Valid d-pad + action buttons, matching PyBoy's button names.
BUTTONS = ("up", "down", "left", "right", "a", "b", "start", "select")


class Emu:
    def __init__(self, rom_path: str = ROM_PATH, headless: bool = True):
        self.rom_path = os.path.abspath(rom_path)
        window = "null" if headless else "SDL2"
        self.pyboy = PyBoy(self.rom_path, window=window)
        # Uncapped speed for headless server use.
        self.pyboy.set_emulation_speed(0)

    # ── stepping ────────────────────────────────────────────────────────────
    def tick(self, n: int = 1) -> None:
        for _ in range(n):
            self.pyboy.tick()

    def press(self, button: str, hold: int = 8, release: int = 8) -> None:
        """Press a button: hold it for `hold` frames, then release and tick
        `release` frames so the game registers and processes the input."""
        button = button.lower()
        if button not in BUTTONS:
            raise ValueError(f"unknown button {button!r}; valid: {BUTTONS}")
        self.pyboy.button_press(button)
        self.tick(hold)
        self.pyboy.button_release(button)
        self.tick(release)

    # ── memory ──────────────────────────────────────────────────────────────
    def read(self, addr: int) -> int:
        return self.pyboy.memory[addr]

    def read16(self, addr: int) -> int:
        """Little-endian 16-bit read."""
        return self.pyboy.memory[addr] | (self.pyboy.memory[addr + 1] << 8)

    def read_range(self, addr: int, length: int) -> list[int]:
        return [self.pyboy.memory[addr + i] for i in range(length)]

    # ── screen ──────────────────────────────────────────────────────────────
    def screen_ndarray(self):
        # (144, 160, 4) RGBA uint8
        return self.pyboy.screen.ndarray

    def screen_png_b64(self) -> str:
        arr = self.screen_ndarray()
        img = Image.fromarray(arr[:, :, :3], "RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")

    def screen_png_bytes(self) -> bytes:
        arr = self.screen_ndarray()
        img = Image.fromarray(arr[:, :, :3], "RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    # ── savestates ──────────────────────────────────────────────────────────
    def save_state(self, path: str = STATE_PATH) -> None:
        with open(path, "wb") as f:
            self.pyboy.save_state(f)

    def load_state(self, path: str = STATE_PATH) -> None:
        with open(path, "rb") as f:
            self.pyboy.load_state(f)

    def reset(self, path: str = STATE_PATH) -> None:
        """Restore to a known controllable-overworld savestate. Falls back to a
        raw ROM reboot if no savestate exists (agent will land in the intro)."""
        if os.path.exists(path):
            self.load_state(path)
            # A couple ticks to let the frame settle.
            self.tick(2)
        else:
            self.pyboy.stop(save=False)
            self.pyboy = PyBoy(self.rom_path, window="null")
            self.pyboy.set_emulation_speed(0)
            self.tick(60)

    def stop(self) -> None:
        self.pyboy.stop(save=False)
