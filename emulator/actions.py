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

Every Gen-1 menu funnels through one handler, but the registers do NOT mean the
same thing in each — measured live, menu by menu, by scripts/probe_menus.py.
`_menu_select` (0-based cursor, trust wMaxMenuItem) is correct for exactly one
of them, the party list. Each of the others gets its own primitive:

  party   `_menu_select`        cursor 0-based, wMaxMenuItem = count-1
  bag     `_bag_select`         cursor is a WINDOW position capped at 2; the item
                                index is wListScrollOffset + wCurrentMenuItem
  START   `_start_menu_select`  entries are built from progression flags, so no
                                fixed index names an entry; select by label
  battle  `_battle_main_select`  2x2 grid: row = wCurrentMenuItem, col =
                                wTopMenuItemX
  moves   `_move_list_select`   cursor is ONE-BASED; bounds from the move array

Battle main menu layout (measured, not read off pokered):
    FIGHT (row 0, left)   PKMN (row 0, right)
    ITEM  (row 1, left)   RUN  (row 1, right)
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
#
# wMaxMenuItem is NOT a portable item count and nothing here may treat it as one.
# Measured: party 2 mons -> 1 (count-1), START 6 entries -> 6 (count), bag 3
# items -> 2 and bag 8 items -> 2 (the window height, not the list at all).
W_CURRENT_MENU_ITEM = 0xCC26
W_MAX_MENU_ITEM = 0xCC28
W_LAST_MENU_ITEM = 0xCC2A
W_MENU_CURSOR_LOCATION = 0xCC30
W_LIST_SCROLL_OFFSET = 0xCC36
W_NUM_BAG_ITEMS = ram_map.NUM_BAG_ITEMS
LIST_WINDOW_ROWS = ram_map.LIST_WINDOW_ROWS
W_IS_IN_BATTLE = 0xD057  # 0 none / 1 wild / 2 trainer (== ram_map.IN_BATTLE)
W_TEXT_BOX_ID = 0xD125
# Battle menu geometry + the "which menu is up" discriminator live in ram_map
# (they are state reads, not action semantics). Measured live 2026-07-25; see
# ram_map.battle_menu. Two long-standing assumptions in this file died to it:
#
#   1. The battle MAIN menu is NOT a 4-item linear menu. wMaxMenuItem reads 1,
#      not 3. It is a 2x2 grid driven by TWO registers: wCurrentMenuItem is the
#      ROW (0/1) and wTopMenuItemX is the COLUMN (9 left / 15 right).
#          FIGHT (row0,left)   PKMN (row0,right)
#          ITEM  (row1,left)   RUN  (row1,right)
#      So slot -> (row = slot // 2, right = slot % 2). Driving wCurrentMenuItem
#      to 3 to reach RUN can never work: it is clamped at 1, so RUN and ITEM
#      were unreachable and PKMN silently selected ITEM.
#
#   2. The FIGHT move list cursor is ONE-BASED. Move slot 0 (the first move) is
#      wCurrentMenuItem == 1, slot 1 is 2, and so on; index 0 is unreachable and
#      the cursor simply wraps around it. Asking for 0 is what produced the
#      [1,2,1,2,...] oscillation that made battle_move fail permanently.
#
# wMaxMenuItem is NOT a usable move count either: it read 3 for a CHARMANDER
# that knew exactly two moves. The real count comes from the move-id array.
W_TOP_MENU_ITEM_Y = ram_map.TOP_MENU_ITEM_Y
W_TOP_MENU_ITEM_X = ram_map.TOP_MENU_ITEM_X
BATTLE_MAIN_COL_X = ram_map.BATTLE_MAIN_COL_X
# Current PP of the four move slots. The only unforgeable proof that the move we
# *asked* for is the move that fired: the chosen slot's PP drops by exactly 1.
BATTLE_MON_PP = ram_map.BATTLE_MON_PP

# Battle main-menu slots, in (row, column) order — see the grid above.
BATTLE_FIGHT = 0
BATTLE_PKMN = 1
BATTLE_ITEM = 2
BATTLE_RUN = 3

# How many cursor moves to attempt before giving up converging on a target.
_MENU_MAX_STEPS = 12
# How many A-presses/ticks to clear a run of text boxes back to an actionable
# state.
_TEXT_ADVANCE_PRESSES = 8
# How many A-presses to spend paging battle text before giving up on the menu
# coming back. Generous: a turn can chain attack + effect + faint + level-up text.
_BATTLE_MENU_WAIT_PRESSES = 24
# How many times to re-press FIGHT when the move list does not open.
_FIGHT_OPEN_ATTEMPTS = 3


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
    """Drive a plain 0-based menu cursor to `index` and press A.

    Correct for the PARTY list and nothing else. Measured on 2- and 6-mon
    parties: the cursor is 0-based, wMaxMenuItem is a truthful count-1, the list
    never scrolls, and asking for slot N puts mon N on the field (verified
    against wBattleMonSpecies after the switch, not against appearances).

    Do NOT point this at the bag (window-relative cursor, so it cannot reach
    item 3+), the START menu (entries shift with progression flags), the battle
    main menu (2x2 grid) or the move list (1-based). Each has its own primitive.

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


def _menu_label(emu) -> str:
    """Normalised text the menu arrow is currently drawn next to."""
    return ram_map.normalize_label(ram_map.menu_cursor_label(emu))


def _start_menu_select(emu, label: str) -> dict:
    """Select a START-menu entry BY NAME, converging on the drawn label.

    The START menu is assembled at open time from progression flags, so its
    indices are not stable and no constant can name an entry. Measured on one
    savestate, before and after setting the has-Pokédex flag:

        no Pokédex   0 POKéMON  1 ITEM  2 <NAME>  3 SAVE  4 OPTION  5 EXIT
        Pokédex      0 POKéDEX  1 POKéMON  2 ITEM  3 <NAME>  4 SAVE  5 OPTION  6 EXIT

    The old hardcoded constants ("POKEMON is START index 1", "ITEM is index 2")
    are the Pokédex row of that table. For the whole pre-Pokédex opening — which
    is exactly the stretch the SFT harvest records — index 1 is ITEM and index 2
    is the trainer card, so `switch` opened the bag and `use_item` opened the
    trainer card, both reporting success. Same silent-wrong-selection failure as
    the battle menus, from the same cause: trusting an index over the screen.
    """
    want = ram_map.normalize_label(label)
    seen = []
    for _ in range(_MENU_MAX_STEPS):
        current = _menu_label(emu)
        seen.append(current)
        if current.startswith(want):
            emu.press("a", hold=8, release=16)
            emu.tick(12)
            return {"ok": True, "selected": label,
                    "cursor": emu.read(W_CURRENT_MENU_ITEM),
                    "matched_label": current, "labels_seen": seen}
        before = emu.read(W_CURRENT_MENU_ITEM)
        emu.press("down", hold=6, release=10)
        emu.tick(4)
        if emu.read(W_CURRENT_MENU_ITEM) == before and _menu_label(emu) == current:
            return {"ok": False, "partial": True,
                    "reason": "START cursor not responding to d-pad",
                    "labels_seen": seen}
    return {"ok": False, "partial": True,
            "reason": f"{label} not on the START menu",
            "labels_seen": seen}


def _bag_item_count(emu) -> int:
    """Honest bag length, from wNumBagItems. wMaxMenuItem cannot supply this."""
    return emu.read(W_NUM_BAG_ITEMS)


def _bag_select(emu, index: int) -> dict:
    """Drive the bag list to absolute item `index` and press A.

    The bag is a SCROLLING list, and that breaks the plain cursor primitive:
    wCurrentMenuItem is the row within the 3-tall visible window, not the item.
    It pins at 2 once the window is full, and further presses move
    wListScrollOffset instead. Measured with an 8-item bag: cursor went
    0,1,2,2,2,2,2,2 while scroll went 0,0,0,1,2,3,4,5 — so `_menu_select` bails
    at "index 3 exceeds wMaxMenuItem 2" and no item past the third is reachable.

    The real position is `wListScrollOffset + wCurrentMenuItem`, which is what
    this converges on, bounded by wNumBagItems. Index == count is CANCEL.
    """
    count = _bag_item_count(emu)
    if index < 0 or index > count:
        return {"ok": False, "partial": True,
                "reason": f"bag slot {index} out of range (bag holds {count})",
                "bag_count": count}

    def position():
        return emu.read(W_LIST_SCROLL_OFFSET) + emu.read(W_CURRENT_MENU_ITEM)

    path = [position()]
    # Bound the walk by the list length, not a fixed step cap: reaching the last
    # item of a full bag takes one press per item.
    for _ in range(count + LIST_WINDOW_ROWS + 2):
        pos = position()
        if pos == index:
            break
        emu.press("down" if pos < index else "up", hold=6, release=10)
        emu.tick(4)
        new = position()
        path.append(new)
        if new == pos:
            return {"ok": False, "partial": True,
                    "reason": f"bag cursor stuck at item {pos}, wanted {index}",
                    "path": path, "bag_count": count}
    final = position()
    if final != index:
        return {"ok": False, "partial": True,
                "reason": f"could not reach bag slot {index} (stuck at {final})",
                "path": path, "bag_count": count}
    label = ram_map.menu_cursor_label(emu)
    emu.press("a", hold=8, release=16)
    return {"ok": True, "selected": index, "label": label, "path": path,
            "bag_count": count,
            "scroll": emu.read(W_LIST_SCROLL_OFFSET),
            "window_row": emu.read(W_CURRENT_MENU_ITEM)}


def _battle_menu(emu) -> str | None:
    """Which battle menu is on screen: "main", "moves", or None.

    This is the discriminator `_battle_move` used to lack, and its absence is
    what made the failure permanent: with no way to tell the two menus apart,
    every call re-ran main-menu logic against whatever was actually up.
    """
    return ram_map.battle_menu(emu)


def _wait_for_battle_menu(emu, tries: int = _BATTLE_MENU_WAIT_PRESSES):
    """Page through battle text until a battle menu is up; return which one.

    Presses A one at a time and re-reads, instead of mashing a fixed count: the
    result text between turns is variable-length (crits, stat drops, faints), and
    over-pressing past the menu opens FIGHT, which is precisely the mis-start
    this function exists to prevent. Returns None if no menu appears in `tries`.
    """
    for _ in range(tries):
        menu = _battle_menu(emu)
        if menu is not None:
            return menu
        if not _in_battle(emu):
            return None
        emu.press("a", hold=6, release=12)
        emu.tick(12)
    return _battle_menu(emu)


def _battle_moves(emu) -> list[int]:
    """The active battler's known move ids, empty slots dropped."""
    return [m for m in emu.read_range(ram_map.BATTLE_MON_MOVES, 4) if m]


def _battle_pp(emu) -> list[int]:
    """Current PP for all four move slots (0 for empty slots)."""
    return emu.read_range(BATTLE_MON_PP, 4)


def _battle_main_select(emu, slot: int) -> dict:
    """Select FIGHT/PKMN/ITEM/RUN on the battle main menu's 2x2 grid.

    Drives the row with up/down (wCurrentMenuItem) and the column with
    left/right (wTopMenuItemX), reading both back each step. `_menu_select`
    cannot do this — it drives wCurrentMenuItem alone, which is clamped at 1, so
    it can only ever reach the left column.
    """
    if _battle_menu(emu) != "main":
        return {"ok": False, "partial": True,
                "reason": "battle main menu is not up",
                "menu": _battle_menu(emu)}
    want_row, want_right = slot // 2, slot % 2
    want_x = BATTLE_MAIN_COL_X[want_right]
    for _ in range(_MENU_MAX_STEPS):
        row = emu.read(W_CURRENT_MENU_ITEM)
        if row == want_row:
            break
        emu.press("down" if row < want_row else "up", hold=6, release=10)
        if emu.read(W_CURRENT_MENU_ITEM) == row:
            return {"ok": False, "partial": True,
                    "reason": f"row cursor stuck at {row}, wanted {want_row}"}
    for _ in range(_MENU_MAX_STEPS):
        x = emu.read(W_TOP_MENU_ITEM_X)
        if x == want_x:
            break
        emu.press("right" if want_right else "left", hold=6, release=10)
        if emu.read(W_TOP_MENU_ITEM_X) == x:
            return {"ok": False, "partial": True,
                    "reason": f"column cursor stuck at x={x}, wanted {want_x}"}
    row, x = emu.read(W_CURRENT_MENU_ITEM), emu.read(W_TOP_MENU_ITEM_X)
    if (row, x) != (want_row, want_x):
        return {"ok": False, "partial": True,
                "reason": f"could not reach slot {slot} "
                          f"(row {row}, x {x}; wanted row {want_row}, x {want_x})"}
    emu.press("a", hold=8, release=16)
    return {"ok": True, "selected": slot, "row": row, "x": x}


def _move_list_select(emu, move_index: int) -> dict:
    """Drive the FIGHT move list to `move_index` (0-based) and press A.

    The list's own cursor is 1-based, so the target is `move_index + 1`. Bounds
    come from the move-id array, never from wMaxMenuItem.
    """
    known = _battle_moves(emu)
    if move_index >= len(known):
        return {"ok": False, "partial": True,
                "reason": f"move slot {move_index} empty "
                          f"(battler knows {len(known)})",
                "known_moves": known}
    want = move_index + 1
    path = [emu.read(W_CURRENT_MENU_ITEM)]
    for _ in range(_MENU_MAX_STEPS):
        cur = emu.read(W_CURRENT_MENU_ITEM)
        if cur == want:
            break
        emu.press("down" if cur < want else "up", hold=6, release=10)
        new = emu.read(W_CURRENT_MENU_ITEM)
        path.append(new)
        if new == cur:
            return {"ok": False, "partial": True,
                    "reason": "move cursor not responding to d-pad",
                    "cursor_path": path}
    final = emu.read(W_CURRENT_MENU_ITEM)
    if final != want:
        return {"ok": False, "partial": True,
                "reason": f"could not reach move {move_index} "
                          f"(cursor {final}, wanted {want})",
                "cursor_path": path}
    emu.press("a", hold=8, release=16)
    return {"ok": True, "move_index": move_index, "cursor": final,
            "cursor_path": path}


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

    Detects "open" via the menu handler populating wMaxMenuItem. Note the value
    is the entry COUNT here, not count-1 as elsewhere: measured 6 for the
    six-entry pre-Pokédex menu and 7 for the seven-entry one. It is reported for
    diagnostics only — nothing indexes off it, because the entries themselves
    move (see `_start_menu_select`). Not available mid-battle.
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
    """Fire the battler's move `move_index` (0-based), whatever menu we start on.

    Does NOT assume it begins on the battle main menu. That assumption was the
    bug: anything that mashes A during the battle intro — a model clearing text,
    or a route's own `until battle_ready` step — already sits on the move list,
    and nothing here restored the assumption, so the failure was permanent for
    the rest of the battle rather than transient.

    Success is verified against PP, not HP. A falling enemy HP bar proves only
    that *some* move fired: a stray A press lands on whichever move the cursor
    happens to sit on, which is exactly how `move_index` used to be ignored while
    everything still looked like it was working. The chosen slot's PP dropping by
    one is the only evidence that the requested move is the move that fired.
    """
    if not _in_battle(emu):
        return {"ok": False, "partial": True,
                "reason": "not in battle (wIsInBattle == 0)"}
    if not isinstance(move_index, int) or not (0 <= move_index <= 3):
        return {"ok": False, "error": "move_index must be 0-3"}

    # Normalize: get to the move list from wherever we actually are. A turn ends
    # in a run of result text ("Enemy SQUIRTLE used TACKLE!"), so page through it
    # one press at a time and re-look, rather than mashing a fixed count past the
    # menu once it reappears.
    menu = _wait_for_battle_menu(emu)
    fight = None
    # Select FIGHT, then poll for the move list rather than ticking a fixed
    # count — it takes a variable number of frames to draw. The retry is not
    # belt-and-braces: the A that opens FIGHT is occasionally swallowed when the
    # main menu has only just been drawn, leaving us sitting on 'main' with no
    # error to show for it (~1 turn in 8 measured).
    for _ in range(_FIGHT_OPEN_ATTEMPTS):
        if menu != "main":
            break
        fight = _battle_main_select(emu, BATTLE_FIGHT)
        if not fight.get("ok"):
            return {"ok": False, "partial": True,
                    "reason": f"could not select FIGHT: {fight.get('reason')}",
                    "detail": fight}
        for _ in range(_MENU_MAX_STEPS):
            menu = _battle_menu(emu)
            if menu != "main":
                break
            emu.tick(10)
    if menu != "moves":
        if not _in_battle(emu):
            return {"ok": False, "partial": True,
                    "reason": "battle ended before a move could be issued"}
        return {"ok": False, "partial": True,
                "reason": f"move list is not up (menu={menu!r})"}

    enemy_hp0 = ram_map._be16(emu, ram_map.ENEMY_MON_HP)
    pp0 = _battle_pp(emu)
    pick = _move_list_select(emu, move_index)
    if not pick.get("ok"):
        return {"ok": False, "partial": True,
                "reason": f"could not select move {move_index}: "
                          f"{pick.get('reason')}", "detail": pick}
    # Move fires. Tick first so the menu has actually closed and the attack text
    # has opened — otherwise the menu registers still read "up" for a few frames
    # and we would return before the move resolved, reading PP too early. Then
    # page back to an actionable state, stopping at the menu rather than mashing
    # a blind count past it into an unintended second move.
    emu.tick(30)
    _wait_for_battle_menu(emu)
    pp1 = _battle_pp(emu)
    enemy_hp1 = ram_map._be16(emu, ram_map.ENEMY_MON_HP)
    spent = [i for i in range(4) if pp1[i] < pp0[i]]
    # The verification that matters: exactly the requested slot spent PP.
    #
    # This decides `ok`, it does not merely annotate it. The original bug was
    # not that battle_move failed — it was that it *reported success* while a
    # stray A press fired whatever move the cursor happened to sit on, so a
    # moving HP bar looked like proof and `move_index` was silently ignored.
    # Returning ok=True alongside move_index_honoured=False rebuilds exactly
    # that trap for any caller that checks `ok` and nothing else, which is
    # every caller we have. Wrong move fired == failed call.
    honoured = spent == [move_index]
    known = _battle_moves(emu)
    result = {"ok": honoured, "move_index": move_index,
              "move_id": known[move_index] if move_index < len(known) else None,
              "pp_before": pp0, "pp_after": pp1,
              "move_index_honoured": honoured,
              "pp_spent_slots": spent,
              "enemy_hp_before": enemy_hp0, "enemy_hp_after": enemy_hp1,
              "enemy_hp_changed": enemy_hp1 != enemy_hp0,
              "still_in_battle": bool(_in_battle(emu)),
              "fight_select": fight, "move_cursor_path": pick.get("cursor_path")}
    if not honoured:
        result["partial"] = True
        result["reason"] = (
            f"move {move_index} was selected but slot(s) {spent} spent PP"
            if spent else
            f"move {move_index} was selected but no slot spent PP — "
            "the move did not fire")
    return result


def _run(emu) -> dict:
    """Battle main menu -> RUN -> A, then advance the result text."""
    if not _in_battle(emu):
        return {"ok": False, "partial": True,
                "reason": "not in battle (wIsInBattle == 0)"}
    if _battle_menu(emu) == "moves":
        # A stray A already opened FIGHT; back out to the main menu first.
        emu.press("b", hold=6, release=10)
    sel = _battle_main_select(emu, BATTLE_RUN)
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

    In battle: main menu -> ITEM. In the overworld: START -> ITEM (selected by
    label — the START menu has no fixed index for it). The bag is a scrolling
    list, so `target_index` is an absolute item position and `_bag_select`
    resolves it through wListScrollOffset; the old code could not reach anything
    past the third item. Without an item-id -> slot table (it depends on live bag
    contents) selection is still reported partial unless a concrete target_index
    is given and reached.
    """
    in_battle = _in_battle(emu)
    if in_battle:
        if _battle_menu(emu) == "moves":
            emu.press("b", hold=6, release=10)
        sel = _battle_main_select(emu, BATTLE_ITEM)
        if not sel.get("ok"):
            return {"ok": False, "partial": True,
                    "reason": f"could not open ITEM in battle: "
                              f"{sel.get('reason')}", "detail": sel}
    else:
        opened = _open_start_menu(emu)
        if not opened.get("ok"):
            return opened
        sel = _start_menu_select(emu, "ITEM")
        if not sel.get("ok"):
            return {"ok": False, "partial": True,
                    "reason": f"could not open ITEM bag: {sel.get('reason')}",
                    "detail": sel}
    emu.tick(12)
    # Report the real bag length. wMaxMenuItem reads 2 for any non-empty bag —
    # it is the window height, and surfacing it as "bag_max_item" told the agent
    # an 8-item bag held 3.
    bag_count = _bag_item_count(emu)
    result = {"opened_bag": True, "bag_count": bag_count,
              "in_battle": bool(in_battle)}
    if target_index is None:
        # Menu is open; selection deferred — not enough info to resolve an item.
        result.update({"ok": False, "partial": True,
                       "reason": "bag opened; no target_index given, "
                                 "item-id->slot resolution not implemented"})
        return result
    pick = _bag_select(emu, int(target_index))
    if not pick.get("ok"):
        result.update({"ok": False, "partial": True,
                       "reason": f"could not select bag slot {target_index}: "
                                 f"{pick.get('reason')}", "detail": pick})
        return result
    _advance_text(emu, presses=4)
    result.update({"ok": True, "selected_slot": int(target_index),
                   "selected_label": pick.get("label"), "item": item,
                   "path": pick.get("path")})
    return result


def _switch(emu, party_index: int) -> dict:
    """PKMN (battle) or POKEMON (START) -> select party slot `party_index`.

    The party list is the one menu the plain cursor primitive is right about:
    measured on 2- and 6-mon parties it is 0-based, never scrolls, and
    wMaxMenuItem is a truthful count-1. Verified end-to-end against the only
    unforgeable side effect — after switching to slot N, wBattleMonSpecies is
    mon N. Both slots of a two-mon party were honoured, so the off-by-one that
    broke the move list does not exist here.

    Reaching the list from the overworld is what was broken: the START entry was
    selected by a hardcoded index that only names POKéMON once the Pokédex has
    been obtained. See `_start_menu_select`.

    In battle this brings up the switch/summary sub-prompt; we press A once more
    to confirm SWITCH (the default top option), then advance the switch-in text.
    """
    if not isinstance(party_index, int) or not (0 <= party_index <= 5):
        return {"ok": False, "error": "party_index must be 0-5"}
    in_battle = _in_battle(emu)
    if in_battle:
        if _battle_menu(emu) == "moves":
            emu.press("b", hold=6, release=10)
        top = _battle_main_select(emu, BATTLE_PKMN)
        if not top.get("ok"):
            return {"ok": False, "partial": True,
                    "reason": f"could not open PKMN: {top.get('reason')}",
                    "detail": top}
    else:
        opened = _open_start_menu(emu)
        if not opened.get("ok"):
            return opened
        top = _start_menu_select(emu, "POKEMON")
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
