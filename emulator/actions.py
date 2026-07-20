"""High-level action -> button-press macro layer.

Translates the semantic action vocabulary the LLM speaks (matching the existing
JS API) into PyBoy button sequences with frame-stepping. The move macro presses
a direction and ticks until the player coordinate changes or a frame cap is hit
(a wall = no change, which is a valid, expected outcome).
"""
from __future__ import annotations

from emulator import ram_map

DIRECTION_BUTTON = {
    "north": "up",
    "south": "down",
    "west": "left",
    "east": "right",
    # accept raw d-pad names too
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
}

# The grammar surfaced to the agent in available_actions.
AVAILABLE_ACTIONS = [
    {"type": "move", "direction": "north|south|east|west"},
    {"type": "a"},
    {"type": "talk"},
    {"type": "b"},
    {"type": "start"},
    {"type": "select"},
    {"type": "wait"},
]

# Max button presses to attempt when trying to complete one grid step.
MOVE_MAX_TRIES = 6


def _move(emu, direction: str) -> dict:
    button = DIRECTION_BUTTON.get(str(direction).lower())
    if button is None:
        return {"ok": False, "error": f"unknown direction {direction!r}"}
    x0, y0 = emu.read(ram_map.PLAYER_X), emu.read(ram_map.PLAYER_Y)
    # Press repeatedly until the coordinate changes or we give up (wall).
    for _ in range(MOVE_MAX_TRIES):
        emu.press(button, hold=12, release=20)
        x1, y1 = emu.read(ram_map.PLAYER_X), emu.read(ram_map.PLAYER_Y)
        if (x1, y1) != (x0, y0):
            return {"ok": True, "moved": True, "from": {"x": x0, "y": y0},
                    "to": {"x": x1, "y": y1}}
    return {"ok": True, "moved": False, "reason": "blocked (wall or facing)",
            "from": {"x": x0, "y": y0}, "to": {"x": x0, "y": y0}}


def apply_action(emu, action: dict) -> dict:
    """Apply one high-level action. Returns a small result dict describing what
    the macro did (the caller then re-reads full state)."""
    if not isinstance(action, dict) or "type" not in action:
        return {"ok": False, "error": "action.type is required"}
    kind = str(action["type"]).lower()

    if kind == "move":
        return _move(emu, action.get("direction"))
    if kind in ("a", "talk"):
        emu.press("a", hold=8, release=16)
        return {"ok": True, "pressed": "a"}
    if kind == "b":
        emu.press("b", hold=8, release=16)
        return {"ok": True, "pressed": "b"}
    if kind == "start":
        emu.press("start", hold=8, release=16)
        return {"ok": True, "pressed": "start"}
    if kind == "select":
        emu.press("select", hold=8, release=16)
        return {"ok": True, "pressed": "select"}
    if kind == "wait":
        emu.tick(30)
        return {"ok": True, "waited": True}

    # Best-effort/partial: unknown high-level verbs (battle_move, use_item,
    # throw_ball, etc.) are not yet mapped to menu navigation. Advance a frame
    # so the loop doesn't stall, and report it as unhandled.
    return {"ok": False, "error": f"action type {kind!r} not implemented",
            "partial": True}
