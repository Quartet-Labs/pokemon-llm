#!/usr/bin/env python3
"""navigate.py — turn a coordinate target into the moves that reach it.

Route authoring for the SFT harvest has one hard problem: the emulator's map
view is a **viewport**, not a map. `read_local_map` renders a 10x9 block window
around the player (trimmed of blank rows), so a route file cannot name a
sequence of button presses for a destination it cannot see yet — and a
hand-counted press list is exactly the "route rots" failure that killed
`harvest-oracle.js`.

So routes name *destinations* and this module resolves them, one viewport at a
time, against whatever the server currently reports:

  1. BFS the visible window for the goal. Reachable -> return that exact path.
  2. Not visible (or walled off inside the window) -> return the path to the
     visible walkable cell with the smallest remaining Manhattan distance to the
     goal, i.e. step to the frontier and look again.
  3. Neither -> nudge one step along the axis with the larger remaining delta,
     provided that neighbour is not a *known* obstacle.

Step 3 exists because a blank cell in the window does not reliably mean "off
map". The window is rendered from `wTileMap`, whose far rows can decode as black
padding while the room continues underneath: standing at (3,3) in Red's house,
y=5 and y=6 render as off-map, and walking there proves them walkable. Treating
blank as wall deadlocks the descent one tile short of the front door — observed,
not theorised. So blank is *unknown*, and the emulator gets to be the authority
on whether the step is legal. It answers BLOCKED if not, which costs one
recorded wall-bump (dropped from training, kept in history) and a fresh window.

The caller re-plans after every batch, so (2)+(3) form a greedy descent that
converges on Kanto's open towns/routes. It is not a general maze solver:
`plan_moves` reports when a window yields no progress at all and the caller
stops rather than looping. Steps from (1) and (2) are always legal,
non-wall-bumping moves — which matters, since each one becomes a training row.

Coordinates are the game's own 16x16 block grid (`state.player.position` and
`map.exits[].at` are already in it), so nothing here has a private coordinate
system to drift out of sync.
"""

# Glyphs from ram_map._MAP_LEGEND. Grass is walkable and deliberately so: the
# encounters it triggers are the battle rows the SFT set needs. Warps are
# walkable — stepping onto one is how you use it. 'N' (person) is NOT: an NPC
# occupies its block, and walking into one opens dialogue rather than moving,
# which the caller must do on purpose via a `talk` step, not by accident.
PASSABLE = {".", '"', ">"}

# Glyphs that definitely stop a step. Everything else — notably ' ' (off-map),
# which the window over-reports — is unknown and left to the emulator to rule on.
OBSTACLE = {"#", "N", "c"}

# (dx, dy) in block coords. north is -y: verified against the live server
# (move north from y=7 lands on y=6).
DIRECTIONS = {
    "north": (0, -1),
    "south": (0, 1),
    "east": (1, 0),
    "west": (-1, 0),
}


def parse_map(view):
    """ASCII viewport -> {(world_x, world_y): glyph}.

    The window is anchored by finding '@' and reading the player's true block
    coords off the same payload, so the trim in `read_local_map` (which drops
    blank rows and shifts every row index) cannot throw the mapping off.
    Returns ({}, None) mid-battle, where the map is empty by design.
    """
    m = view.get("map") or {}
    ascii_map = m.get("ascii") or ""
    if not ascii_map:
        return {}, None

    rows = ascii_map.split("\n")
    anchor = None
    for r, row in enumerate(rows):
        c = row.find("@")
        if c != -1:
            anchor = (c, r)
            break
    if anchor is None:
        return {}, None

    pos = m.get("position") or (view.get("player") or {}).get("position") or {}
    if "x" not in pos or "y" not in pos:
        return {}, None
    px, py = pos["x"], pos["y"]
    acol, arow = anchor

    grid = {}
    for r, row in enumerate(rows):
        for c, glyph in enumerate(row):
            grid[(px + (c - acol), py + (r - arow))] = glyph
    return grid, (px, py)


def _passable(grid, cell, goal, blocked=()):
    """The goal cell is enterable whatever sits on it — an exit ('>') is the
    normal case, and a target the caller named explicitly is one it wants to
    step onto. Everything else must be walkable terrain, and nothing the
    emulator has already refused is passable at any price."""
    if cell in blocked:
        return False
    if cell == goal:
        return cell in grid
    return grid.get(cell) in PASSABLE


def bfs(grid, start, goal, blocked=()):
    """Shortest path start -> goal within the window. [] if unreachable.

    Breadth-first, so the first arrival is a shortest path; directions are
    visited in a fixed order, so the same viewport always yields the same route
    and a replayed harvest is byte-identical.
    """
    if start == goal:
        return []
    seen = {start}
    queue = [(start, [])]
    while queue:
        cell, path = queue.pop(0)
        for name in ("north", "south", "east", "west"):
            dx, dy = DIRECTIONS[name]
            nxt = (cell[0] + dx, cell[1] + dy)
            if nxt in seen or nxt not in grid:
                continue
            if not _passable(grid, nxt, goal, blocked):
                continue
            seen.add(nxt)
            if nxt == goal:
                return path + [name]
            queue.append((nxt, path + [name]))
    return []


def _nudge(grid, pos, goal, blocked=()):
    """One step toward the goal through terrain the window can't vouch for.

    Candidates are ordered by how much of the remaining gap they close (larger
    axis first). A *known* obstacle is never attempted, and neither is anything
    already in `blocked` — so this degrades to an empty list, and the caller
    stops, when the way really is walled. Unknown (blank) cells are attempted,
    because the window under-reports the room.
    """
    dx, dy = goal[0] - pos[0], goal[1] - pos[1]
    candidates = []
    if dx:
        candidates.append((abs(dx), "east" if dx > 0 else "west"))
    if dy:
        candidates.append((abs(dy), "south" if dy > 0 else "north"))
    candidates.sort(reverse=True)

    for _, name in candidates:
        ddx, ddy = DIRECTIONS[name]
        nxt = (pos[0] + ddx, pos[1] + ddy)
        if grid.get(nxt) in OBSTACLE or nxt in blocked:
            continue
        return [{"type": "move", "direction": name}]
    return []


def plan_moves(view, target, max_steps=24, blocked=()):
    """Moves toward `target` from the current viewport.

    `blocked` is the set of world cells the emulator has already refused this
    run. It exists because the window's walkability is not authoritative: NPCs
    are missed by the sprite overlay (Oak and the rival stand on cells the map
    renders as plain floor), so BFS will happily route through a body. Feeding
    refusals back turns each wasted bump into information instead of a loop —
    without it the planner re-derives the same illegal step every cycle, which
    cost ten identical wall-bumps against Oak's lab door before it was added.

    Returns (actions, arrived). `arrived` is True only when `target` is the
    player's current cell. An empty action list with arrived=False means this
    window offers no move that reduces the distance — the caller should stop,
    not retry, because re-planning on an unchanged view returns the same
    nothing.
    """
    grid, pos = parse_map(view)
    if pos is None:
        return [], False
    goal = (target["x"], target["y"])
    if pos == goal:
        return [], True

    path = bfs(grid, pos, goal, blocked)
    if not path:
        # Goal outside the window (or walled off within it): walk to the
        # reachable cell that gets closest, then look again from there.
        best, best_d = None, abs(pos[0] - goal[0]) + abs(pos[1] - goal[1])
        for cell in grid:
            if grid.get(cell) not in PASSABLE or cell in blocked:
                continue
            d = abs(cell[0] - goal[0]) + abs(cell[1] - goal[1])
            if d >= best_d:
                continue
            leg = bfs(grid, pos, cell, blocked)
            if leg:
                best, best_d = leg, d
        if not best:
            return _nudge(grid, pos, goal, blocked), False
        path = best

    path = path[:max_steps]
    return [{"type": "move", "direction": d} for d in path], False


def blocked_cell(pos, action, result):
    """The world cell a refused move proves is impassable, or None.

    Call on every executed step and feed the result into `plan_moves(blocked=)`.
    Only a `move` that reported `moved: false` is evidence — a rejected or
    errored action says nothing about the terrain.
    """
    if (action or {}).get("type") != "move":
        return None
    result = result or {}
    if not result.get("ok") or result.get("moved") is not False:
        return None
    delta = DIRECTIONS.get(action.get("direction"))
    if delta is None or not pos:
        return None
    return (pos[0] + delta[0], pos[1] + delta[1])


def find_exit(view, to_map_id=None, to_name=None):
    """The `map.exits` entry matching a destination map, by id or by name
    substring. Returns its {"x","y"} or None. Name match is case-insensitive
    and substring-based so a route can say "oak" rather than transcribing the
    server's full label."""
    for ex in (view.get("map") or {}).get("exits") or []:
        if to_map_id is not None and ex.get("to_map_id") == to_map_id:
            return ex.get("at")
        if to_name is not None:
            name = (ex.get("to") or "").lower()
            if to_name.lower() in name:
                return ex.get("at")
    return None
