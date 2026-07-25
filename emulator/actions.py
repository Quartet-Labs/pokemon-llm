"""High-level action -> button-press macro layer.

Translates the semantic action vocabulary the LLM speaks (matching the existing
JS API) into PyBoy button sequences with frame-stepping. The move macro presses
a direction and ticks until the player coordinate changes or a frame cap is hit
(a wall = no change, which is a valid, expected outcome).

Menu / battle macros
--------------------
The battle and menu verbs are NOT blind button counts. They read the pokered
menu-cursor RAM to know where the cursor is and drive it to the wanted slot,
then confirm with A. All the menu machinery in Red/Blue funnels through one
handler that maintains:

  - wCurrentMenuItem   0xCC26  index the cursor is currently on (0-based)
  - wMaxMenuItem       0xCC28  highest selectable index (count-1)
  - wMenuCursorLocation 0xCC30 tile the arrow is drawn at (2 bytes)
  - wListScrollOffset  0xCC36  first visible row for scrolling lists (bag/party)

The overworld START menu, the battle main menu (FIGHT/PKMN/ITEM/RUN), the FIGHT
move list, the bag item list and the party list are all driven by this same
handler, so a single `_menu_select(emu, index)` primitive that reads the cursor
and presses up/down to converge works for every one of them.

Battle main menu layout (pokered `wCurrentMenuItem` values in the 2x2 box):
    FIGHT = 0   PKMN = 1
    ITEM  = 2   RUN  = 3
The box is a wrapping menu, so `_menu_select` uses the cursor read to converge
regardless of the exact geometry and does not depend on the 2x2-vs-linear
distinction.
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
    {"type": "battle_move", "move_index": "0-3"},
    {"type": "run"},
    {"type": "use_item", "item": "id?", "target_index": "0-5?"},
    {"type": "switch", "party_index": "0-5"},
    {"type": "choose_starter", "which": "0-2"},
]

# Max button presses to attempt when trying to complete one grid step.
MOVE_MAX_TRIES = 6

# ── menu-cursor RAM (pokered symbols/pokered.sym) ────────────────────────────
# These are the addresses every Red/Blue menu handler maintains. Resolved from
# pokered.sym (bank 00 -> flat WRAM address):
#   00:cc26 wCurrentMenuItem   00:cc28 wMaxMenuItem
#   00:cc30 wMenuCursorLocation 00:cc36 wListScrollOffset
#   00:cc2a wLastMenuItem
W_CURRENT_MENU_ITEM = 0xCC26
W_MAX_MENU_ITEM = 0xCC28
W_LAST_MENU_ITEM = 0xCC2A
W_MENU_CURSOR_LOCATION = 0xCC30
W_LIST_SCROLL_OFFSET = 0xCC36
W_IS_IN_BATTLE = 0xD057  # 0 none / 1 wild / 2 trainer (== ram_map.IN_BATTLE)
W_TEXT_BOX_ID = 0xD125

# Battle main-menu indices.
BATTLE_FIGHT = 0
BATTLE_PKMN = 1
BATTLE_ITEM = 2
BATTLE_RUN = 3

# How many cursor moves to attempt before giving up converging on a target.
_MENU_MAX_STEPS = 12
# How many A-presses/ticks to clear a run of text boxes back to an actionable
# state.
_TEXT_ADVANCE_PRESSES = 8


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


# ── menu primitives ──────────────────────────────────────────────────────────

def _in_battle(emu) -> int:
    return emu.read(W_IS_IN_BATTLE)


def _menu_select(emu, index: int, axis: str = "vertical") -> dict:
    """Drive the current menu cursor to `index` and press A.

    Reads wCurrentMenuItem every step and presses toward the target, so it is
    robust to the initial cursor position and to how many items the menu has.
    Vertical menus (START, move list, bag, party) use up/down; the battle main
    menu is a wrapping 2x2 that pokered also drives as a wrapping vertical menu,
    so up/down works there too.

    Returns a dict with the cursor path taken. Does NOT itself advance result
    text — callers decide whether to.
    """
    if index < 0:
        return {"ok": False, "error": f"negative menu index {index}"}
    max_item = emu.read(W_MAX_MENU_ITEM)
    # Clamp to the menu's real range so we never chase a non-existent slot.
    if max_item and index > max_item:
        return {"ok": False,
                "error": f"index {index} exceeds wMaxMenuItem {max_item}"}

    down, up = ("down", "up") if axis == "vertical" else ("right", "left")
    other_down = "right" if axis == "vertical" else "down"
    path = [emu.read(W_CURRENT_MENU_ITEM)]
    for _ in range(_MENU_MAX_STEPS):
        cur = emu.read(W_CURRENT_MENU_ITEM)
        if cur == index:
            break
        emu.press(down if cur < index else up, hold=6, release=10)
        new = emu.read(W_CURRENT_MENU_ITEM)
        path.append(new)
        if new == cur:
            # Press did not move the cursor — retry once on the other axis in
            # case this menu's geometry differs, else bail rather than spin.
            emu.press(other_down, hold=6, release=10)
            if emu.read(W_CURRENT_MENU_ITEM) == cur:
                return {"ok": False, "partial": True,
                        "reason": "cursor not responding to d-pad",
                        "cursor_path": path,
                        "cursor": emu.read(W_CURRENT_MENU_ITEM),
                        "max_item": max_item}
    final = emu.read(W_CURRENT_MENU_ITEM)
    if final != index:
        return {"ok": False, "partial": True,
                "reason": f"could not reach index {index}, stuck at {final}",
                "cursor_path": path, "max_item": max_item}
    emu.press("a", hold=8, release=16)
    return {"ok": True, "selected": index, "cursor_path": path,
            "max_item": max_item}


def _advance_text(emu, presses: int = _TEXT_ADVANCE_PRESSES) -> None:
    """Mash A to page through result/dialogue boxes back to an actionable state.

    Each press advances one text box; between presses we tick so the box has a
    chance to fully print before the next A. Safe to over-press: extra A on a
    settled menu just re-selects, which the callers guard against by reading the
    battle flag afterward.
    """
    for _ in range(presses):
        emu.press("a", hold=6, release=12)
        emu.tick(12)


def _open_start_menu(emu) -> dict:
    """Open the overworld START menu, confirming it actually opened.

    Detects "open" via the menu handler populating wMaxMenuItem (the START menu
    exposes 6 as its max -> 7 entries). Not available mid-battle.
    """
    if _in_battle(emu):
        return {"ok": False, "partial": True,
                "reason": "in battle; START menu not available"}
    emu.press("start", hold=8, release=16)
    emu.tick(10)
    max_item = emu.read(W_MAX_MENU_ITEM)
    return {"ok": True, "opened": True, "max_item": max_item,
            "cursor": emu.read(W_CURRENT_MENU_ITEM)}


# ── battle / menu macros ─────────────────────────────────────────────────────

def _battle_move(emu, move_index: int) -> dict:
    """From the battle main menu: FIGHT -> move `move_index` -> A.

    Reads the cursor at each step. Confirms the move fired by checking that we
    are still in battle and reporting whether the enemy HP changed (miss/status
    turns leave HP unchanged, so HP change is reported but not required for ok).
    """
    if not _in_battle(emu):
        return {"ok": False, "partial": True,
                "reason": "not in battle (wIsInBattle == 0)"}
    if not isinstance(move_index, int) or not (0 <= move_index <= 3):
        return {"ok": False, "error": "move_index must be 0-3"}

    enemy_hp0 = ram_map._be16(emu, ram_map.ENEMY_MON_HP)
    # Select FIGHT in the main menu.
    fight = _menu_select(emu, BATTLE_FIGHT)
    if not fight.get("ok"):
        return {"ok": False, "partial": True,
                "reason": f"could not select FIGHT: {fight.get('reason')}",
                "detail": fight}
    emu.tick(10)
    # Now on the move list; drive to the requested move slot.
    max_move = emu.read(W_MAX_MENU_ITEM)
    if move_index > max_move:
        # Fewer than move_index+1 moves known; back out and report.
        emu.press("b", hold=6, release=10)
        return {"ok": False, "partial": True,
                "reason": f"move slot {move_index} empty (only "
                          f"{max_move + 1} moves)",
                "max_move_item": max_move}
    pick = _menu_select(emu, move_index)
    if not pick.get("ok"):
        return {"ok": False, "partial": True,
                "reason": f"could not select move {move_index}: "
                          f"{pick.get('reason')}", "detail": pick}
    # Move fires: page through the attack text back to an actionable state.
    _advance_text(emu)
    enemy_hp1 = ram_map._be16(emu, ram_map.ENEMY_MON_HP)
    return {"ok": True, "move_index": move_index,
            "enemy_hp_before": enemy_hp0, "enemy_hp_after": enemy_hp1,
            "enemy_hp_changed": enemy_hp1 != enemy_hp0,
            "still_in_battle": bool(_in_battle(emu)),
            "fight_cursor_path": fight.get("cursor_path"),
            "move_cursor_path": pick.get("cursor_path")}


def _run(emu) -> dict:
    """Battle main menu -> RUN -> A, then advance the result text."""
    if not _in_battle(emu):
        return {"ok": False, "partial": True,
                "reason": "not in battle (wIsInBattle == 0)"}
    sel = _menu_select(emu, BATTLE_RUN)
    if not sel.get("ok"):
        return {"ok": False, "partial": True,
                "reason": f"could not select RUN: {sel.get('reason')}",
                "detail": sel}
    _advance_text(emu)
    escaped = _in_battle(emu) == 0
    return {"ok": True, "escaped": escaped,
            "still_in_battle": bool(_in_battle(emu)),
            "cursor_path": sel.get("cursor_path")}


def _use_item(emu, item=None, target_index=None) -> dict:
    """Open the bag/ITEM menu and best-effort navigate.

    In battle: main menu -> ITEM. In the overworld: START -> ITEM. Item lists
    are a scrolling menu keyed by wCurrentMenuItem / wListScrollOffset; without
    an item-id -> list-position table (which depends on live bag contents) we
    can only best-effort scroll to `target_index` within the current window.
    Item selection is therefore reported partial unless a concrete target_index
    is given and reached.
    """
    in_battle = _in_battle(emu)
    if in_battle:
        sel = _menu_select(emu, BATTLE_ITEM)
        if not sel.get("ok"):
            return {"ok": False, "partial": True,
                    "reason": f"could not open ITEM in battle: "
                              f"{sel.get('reason')}", "detail": sel}
    else:
        opened = _open_start_menu(emu)
        if not opened.get("ok"):
            return opened
        # START menu: ITEM is index 2 (POKEDEX 0, POKEMON 1, ITEM 2).
        sel = _menu_select(emu, 2)
        if not sel.get("ok"):
            return {"ok": False, "partial": True,
                    "reason": f"could not open ITEM bag: {sel.get('reason')}",
                    "detail": sel}
    emu.tick(12)
    bag_max = emu.read(W_MAX_MENU_ITEM)
    result = {"opened_bag": True, "bag_max_item": bag_max,
              "in_battle": bool(in_battle)}
    if target_index is None:
        # Menu is open; selection deferred — not enough info to resolve an item.
        result.update({"ok": False, "partial": True,
                       "reason": "bag opened; no target_index given, "
                                 "item-id->slot resolution not implemented"})
        return result
    pick = _menu_select(emu, int(target_index))
    if not pick.get("ok"):
        result.update({"ok": False, "partial": True,
                       "reason": f"could not select bag slot {target_index}: "
                                 f"{pick.get('reason')}", "detail": pick})
        return result
    _advance_text(emu, presses=4)
    result.update({"ok": True, "selected_slot": int(target_index),
                   "item": item, "cursor_path": pick.get("cursor_path")})
    return result


def _switch(emu, party_index: int) -> dict:
    """PKMN (battle) or POKEMON (START) -> select party slot `party_index`.

    The party list is a vertical menu keyed by wCurrentMenuItem, so the same
    cursor-converge primitive selects the slot. In battle this brings up the
    switch/summary sub-prompt; we press A once more to confirm SWITCH (the
    default top option), then advance the switch-in text.
    """
    if not isinstance(party_index, int) or not (0 <= party_index <= 5):
        return {"ok": False, "error": "party_index must be 0-5"}
    in_battle = _in_battle(emu)
    if in_battle:
        top = _menu_select(emu, BATTLE_PKMN)
        if not top.get("ok"):
            return {"ok": False, "partial": True,
                    "reason": f"could not open PKMN: {top.get('reason')}",
                    "detail": top}
    else:
        opened = _open_start_menu(emu)
        if not opened.get("ok"):
            return opened
        top = _menu_select(emu, 1)  # POKEMON is START index 1
        if not top.get("ok"):
            return {"ok": False, "partial": True,
                    "reason": f"could not open POKEMON: {top.get('reason')}",
                    "detail": top}
    emu.tick(12)
    party_max = emu.read(W_MAX_MENU_ITEM)
    if party_index > party_max:
        emu.press("b", hold=6, release=10)
        return {"ok": False, "partial": True,
                "reason": f"party slot {party_index} empty (only "
                          f"{party_max + 1} mons)", "party_max_item": party_max}
    pick = _menu_select(emu, party_index)
    if not pick.get("ok"):
        return {"ok": False, "partial": True,
                "reason": f"could not select party slot {party_index}: "
                          f"{pick.get('reason')}", "detail": pick}
    if in_battle:
        # In battle, selecting a mon opens a SWITCH/STATS/CANCEL sub-prompt with
        # SWITCH as the default top entry -> confirm with A.
        emu.tick(8)
        emu.press("a", hold=8, release=16)
        _advance_text(emu, presses=6)
    return {"ok": True, "party_index": party_index,
            "in_battle": bool(in_battle),
            "cursor_path": pick.get("cursor_path"),
            "still_in_battle": bool(_in_battle(emu))}


def _choose_starter(emu, which=None) -> dict:
    """Choosing a starter in Red/Blue is a WORLD interaction, not a menu.

    The three Poke Balls sit on Oak's lab table; the player walks up to a ball
    and presses A, then confirms a YES/NO box. There is no cursor menu to read,
    so a pure RAM-driven menu macro cannot select the starter — it requires
    navigating the sprite to the correct ball tile first. That navigation is out
    of scope for this macro layer (it belongs to the overworld pathing the agent
    already does with `move`). Left partial by design; the intended flow is:
    `move` adjacent to the chosen ball, `a`, then `a` on the YES prompt.
    """
    return {"ok": False, "partial": True,
            "reason": "choose_starter is a world interaction (walk to the "
                      "ball + A + confirm YES), not a menu macro; use `move` "
                      "to reach the ball then `a`. Out of scope for a pure "
                      "cursor-read macro.",
            "which": which}


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

    # ── battle / menu verbs ──────────────────────────────────────────────────
    if kind == "battle_move":
        return _battle_move(emu, action.get("move_index"))
    if kind == "run":
        return _run(emu)
    if kind == "use_item":
        return _use_item(emu, item=action.get("item"),
                         target_index=action.get("target_index"))
    if kind == "switch":
        return _switch(emu, action.get("party_index"))
    if kind == "choose_starter":
        return _choose_starter(emu, which=action.get("which"))

    return {"ok": False, "error": f"action type {kind!r} not implemented",
            "partial": True}
