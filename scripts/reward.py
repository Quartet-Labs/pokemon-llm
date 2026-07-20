#!/usr/bin/env python3
"""Environment-reward layer for pokemon-llm RL/SFT training.

`compute_reward(prev_view, action, result_view, result_msg)` is a PURE function:
given the view the model saw (`prev_view`), the action it took, the resulting view
(`result_view`, i.e. the /action response), and the resulting message string, it
returns `(reward: float, breakdown: dict)`.

This is the single source of truth for per-turn reward. Both drivers
(ollama-runner, llm-runner) and the future GRPO/SFT trainer import it, so the
reward the trainer optimizes is exactly the reward the driver logged — no drift.

Reward v1. Every weight is a named constant below, heavily commented, because
these WILL be tuned. To reshape reward, edit the constants; the logic stays put.
"""

# ─────────────────────────────────────────────────────────────────────────────
# REWARD WEIGHTS — v1. TUNE THESE. All in "reward units"; the scalar is their sum.
# ─────────────────────────────────────────────────────────────────────────────

# +NEW_TILE per newly-revealed non-fog tile this turn. This is the core
# exploration signal: seeing new map = progress. Kept small because a single
# overworld step can reveal a whole strip of the 15x11 viewport at once (~10-15
# tiles), so a large weight here would dwarf everything else. Tune down if the
# agent learns to "wiggle" purely to farm fresh viewport edges.
NEW_TILE = 0.02

# +NEW_AREA when result_view.area.id != prev_view.area.id. Crossing into a new
# map (lab -> town -> route -> forest -> city) is real, hard-won progress toward
# the badge, so it dominates a turn's worth of tile reveals. Large on purpose.
NEW_AREA = 5.0

# +BADGE when result_view.player.badges increased. The terminal objective of the
# episode. Should swamp everything else so the policy will trade a lot of local
# reward for a badge. Largest weight in the table.
BADGE = 50.0

# -STEP flat per-turn penalty (time pressure). Pushes the agent to reach goals in
# fewer turns rather than dawdling. Must stay well below NEW_TILE * (a few tiles)
# so genuine exploration still nets positive; it only bites when a turn
# accomplishes nothing.
STEP = 0.05

# -ILLEGAL when the action had no effect / was rejected (walked into a wall,
# unknown direction, tree blocking, "can't go that way", or a move that left
# position unchanged). Discourages banging on walls. Stacks with -STEP.
ILLEGAL = 0.5

# -REVISIT when the player MOVED onto a tile it had already observed/explored.
# Small: revisiting is often necessary (backtracking through a route), we just
# gently prefer new ground. Not applied to non-move actions or to illegal moves
# (those already get -ILLEGAL and don't change position).
REVISIT = 0.05


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

# Glyphs in view.map.ascii that are NOT "an observed map tile":
#   '?' = fog (never observed),  '@' = the player's own cell (always present,
#   not a discovery). Everything else (terrain, doors, NPCs 'N', etc.) counts as
#   an observed tile. We diff on GLYPHS, but the real novelty signal comes from
#   the (x,y) coordinates the viewport covers — see _observed_tiles.
FOG_GLYPH = "?"
PLAYER_GLYPH = "@"

# Substrings that mark a rejected / no-op action in result_view.message. Matched
# case-insensitively. Kept as a tunable list so new engine messages are easy to
# add without touching logic.
ILLEGAL_MSG_MARKERS = (
    "can't go that way",
    "unknown direction",
    "blocking the way",       # "A tree is blocking the way! Use CUT..."
    "can't go out there",     # Oak blocking the lab exit pre-starter
    "there's no",             # generic "there's no ... that way" style rejects
)

MOVE_ACTIONS = ("move",)


def _get(view, *path, default=None):
    """Safe nested getter: _get(v, 'area', 'id') == v['area']['id'] or default."""
    cur = view or {}
    for k in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        if cur is None:
            return default
    return cur


def _map_position(view):
    """Player's (x,y) as a tuple, from view.map.position (preferred) or
    view.player.position. Returns None if neither is present."""
    pos = _get(view, "map", "position") or _get(view, "player", "position")
    if isinstance(pos, dict) and "x" in pos and "y" in pos:
        return (pos["x"], pos["y"])
    return None


def _observed_tiles(view):
    """Return the SET of world (x,y) coordinates the player has observed as of
    `view`, derived from the fog-of-war minimap.

    The minimap (view.map) is a 15x11 viewport centered on the player: '?' is
    fog, '@' is the player's cell, anything else is a tile the engine has drawn
    because it was observed. We translate each non-fog cell's (dx,dy) offset from
    the '@' center into an absolute world coordinate using view.map.position.
    Diffing these sets across turns gives an exact "newly revealed tiles" count
    that survives the player moving (the viewport shifts, coords don't).

    Returns an empty set for non-overworld views (no map) so diffs degrade to 0.
    """
    ascii_map = _get(view, "map", "ascii")
    pos = _map_position(view)
    if not ascii_map or pos is None:
        return set()
    rows = ascii_map.split("\n")
    # Locate '@' to anchor the grid; fall back to geometric center if missing.
    cx = cy = None
    for ry, line in enumerate(rows):
        cxi = line.find(PLAYER_GLYPH)
        if cxi != -1:
            cx, cy = cxi, ry
            break
    if cx is None:
        # No '@' rendered (shouldn't happen on overworld) — center on the grid.
        cy = len(rows) // 2
        cx = (len(rows[cy]) // 2) if rows else 0
    px, py = pos
    seen = set()
    for ry, line in enumerate(rows):
        for rx, ch in enumerate(line):
            if ch == FOG_GLYPH:
                continue  # fog: not observed
            # Absolute world coord of this viewport cell (includes '@' cell; the
            # player's own tile is legitimately "observed", so we keep it).
            wx = px + (rx - cx)
            wy = py + (ry - cy)
            seen.add((wx, wy))
    return seen


def _is_illegal(action, result_msg, prev_view, result_view):
    """True if the action was rejected or had no effect.

    Two signals:
      1. result_msg contains a known rejection marker (walls, unknown dir, etc.).
      2. It was a MOVE but the player's position did not change (silently blocked
         / no-op) — a belt-and-suspenders check in case the engine ever rejects a
         move without one of the marker strings.
    """
    msg = (result_msg or "").lower()
    for marker in ILLEGAL_MSG_MARKERS:
        if marker in msg:
            return True
    if (action or {}).get("type") in MOVE_ACTIONS:
        prev_pos = _map_position(prev_view)
        new_pos = _map_position(result_view)
        if prev_pos is not None and new_pos is not None and prev_pos == new_pos:
            return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def compute_reward(prev_view, action, result_view, result_msg):
    """Compute the scalar per-turn reward and a breakdown of its components.

    Args:
        prev_view:   the full view the model saw when it chose `action`.
        action:      the action dict submitted (e.g. {"type":"move","direction":"north"}).
        result_view: the full view returned by /action after applying `action`.
        result_msg:  the resulting message string (result_view.message).

    Returns:
        (reward: float, breakdown: dict). The breakdown holds every component's
        contribution plus the raw counts that produced it, so trajectory logs are
        self-explaining and reward can be recomputed/verified offline.
    """
    breakdown = {}
    reward = 0.0

    # ── flat step penalty (time pressure) ────────────────────────────────────
    breakdown["step"] = -STEP
    reward -= STEP

    # ── illegal / no-op action ───────────────────────────────────────────────
    illegal = _is_illegal(action, result_msg, prev_view, result_view)
    breakdown["illegal"] = -ILLEGAL if illegal else 0.0
    if illegal:
        reward -= ILLEGAL

    # ── newly revealed tiles (fog-of-war diff) ───────────────────────────────
    # Only meaningful within the same area — on an area change the coordinate
    # frame resets, so we don't count "new tiles" across the boundary (the
    # NEW_AREA bonus covers that transition). This prevents a bogus full-viewport
    # tile dump every time the agent walks through a door.
    prev_area = _get(prev_view, "area", "id")
    new_area = _get(result_view, "area", "id")
    same_area = prev_area is not None and prev_area == new_area
    if same_area:
        newly = _observed_tiles(result_view) - _observed_tiles(prev_view)
        n_new = len(newly)
    else:
        n_new = 0
    breakdown["new_tiles"] = NEW_TILE * n_new
    breakdown["new_tiles_count"] = n_new
    reward += NEW_TILE * n_new

    # ── new area entered ─────────────────────────────────────────────────────
    entered_new_area = (
        prev_area is not None and new_area is not None and prev_area != new_area
    )
    breakdown["new_area"] = NEW_AREA if entered_new_area else 0.0
    breakdown["new_area_id"] = new_area if entered_new_area else None
    if entered_new_area:
        reward += NEW_AREA

    # ── badge gained ─────────────────────────────────────────────────────────
    prev_badges = _get(prev_view, "player", "badges", default=0) or 0
    new_badges = _get(result_view, "player", "badges", default=0) or 0
    badge_delta = new_badges - prev_badges
    gained_badge = badge_delta > 0
    breakdown["badge"] = BADGE * badge_delta if gained_badge else 0.0
    breakdown["badge_delta"] = badge_delta if gained_badge else 0
    if gained_badge:
        reward += BADGE * badge_delta

    # ── revisit penalty (moved onto an already-observed tile) ────────────────
    # Applied only for a legal move that actually changed position within the
    # same area, when the new tile was already in the observed set of prev_view.
    revisit = False
    if (
        (action or {}).get("type") in MOVE_ACTIONS
        and not illegal
        and same_area
    ):
        prev_pos = _map_position(prev_view)
        new_pos = _map_position(result_view)
        if prev_pos is not None and new_pos is not None and prev_pos != new_pos:
            if new_pos in _observed_tiles(prev_view):
                revisit = True
    breakdown["revisit"] = -REVISIT if revisit else 0.0
    if revisit:
        reward -= REVISIT

    breakdown["total"] = reward
    return reward, breakdown


if __name__ == "__main__":
    # Tiny self-check demonstrating each component fires. Run: python3 scripts/reward.py
    import json

    def V(area, badges, ascii_map, pos, msg=""):
        return {
            "area": {"id": area}, "message": msg,
            "player": {"badges": badges, "position": pos},
            "map": {"ascii": ascii_map, "position": pos},
        }

    # 3x3 viewports centered on '@'. Player at (5,5) sees only its own cell;
    # after moving north to (5,4) the viewport shifts and reveals fresh tiles.
    fog = "???\n?@?\n???"
    revealed = "...\n.@.\n..."           # a full 3x3 window observed post-move

    a = V("pallet_town", 0, fog, {"x": 5, "y": 5})
    b = V("pallet_town", 0, revealed, {"x": 5, "y": 4}, "Moved north. (5,4) — Pallet Town")
    r, bd = compute_reward(a, {"type": "move", "direction": "north"}, b, b["message"])
    print("new tiles:", json.dumps(bd)); assert bd["new_tiles_count"] > 0 and bd["illegal"] == 0.0

    c = V("route_1", 0, fog, {"x": 0, "y": 0})
    r, bd = compute_reward(b, {"type": "move", "direction": "north"}, c, "Moved north. (0,0) — Route 1")
    print("new area:", json.dumps(bd)); assert bd["new_area"] == NEW_AREA

    d = V("pallet_town", 0, fog, {"x": 5, "y": 5}, "You can't go that way.")
    r, bd = compute_reward(a, {"type": "move", "direction": "west"}, d, d["message"])
    print("illegal:", json.dumps(bd)); assert bd["illegal"] == -ILLEGAL

    e = V("pewter_city", 1, fog, {"x": 3, "y": 3})
    r, bd = compute_reward(V("pewter_city", 0, fog, {"x": 3, "y": 3}),
                           {"type": "talk"}, e, "You got the BOULDER BADGE!")
    print("badge:", json.dumps(bd)); assert bd["badge"] == BADGE

    print("reward.py self-check passed.")
