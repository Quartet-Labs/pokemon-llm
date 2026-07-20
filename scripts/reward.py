#!/usr/bin/env python3
"""Environment-reward layer for pokemon-llm RL/SFT training.

`compute_reward(prev_view, action, result_view, result_msg)` is a PURE function:
given the view the model saw (`prev_view`), the action it took, the resulting view
(`result_view`, i.e. the /action response), and the resulting message string, it
returns `(reward: float, breakdown: dict)`.

This is the single source of truth for per-turn reward. Both drivers
(ollama-runner, llm-runner) and the future GRPO/SFT trainer import it, so the
reward the trainer optimizes is exactly the reward the driver logged — no drift.

Reward v1.1. Every weight is a named constant below, heavily commented, because
these WILL be tuned. To reshape reward, edit the constants; the logic stays put.

v1.1 adds progression + novelty terms. Two kinds:

  * DETERMINISTIC (pure, prev/result only): level-up, exp gain, money gain, and
    pokédex growth. These are diffs of fields already in the view, so they stay
    inside `compute_reward` — no memory needed.
  * NOVELTY (needs memory ACROSS turns): first battle vs. a given trainer, first
    dialogue with a given NPC. A pure prev/result function can't know whether a
    trainer/NPC is "new" this episode, so these live in `RewardTracker`, which
    holds per-episode sets and wraps `compute_reward`. The driver creates ONE
    tracker per episode; on episode end it's discarded (or `.reset()`).

All new weights are SMALL relative to BADGE (+50): progression should nudge the
policy toward growth without ever competing with the terminal objective.
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
# REWARD WEIGHTS — v1.1 PROGRESSION + NOVELTY. All SMALL relative to BADGE (+50).
# ─────────────────────────────────────────────────────────────────────────────

# +LEVEL_UP per level gained by ANY party member this turn (summed across the
# party). Leveling is durable progress toward surviving Brock, and levels are
# rare (a few per episode), so a moderate per-level bonus is affordable. Compared
# element-wise on party level; a fresh evolution/new party member that appears at
# a higher level is NOT counted (see _party_levels — we only credit slots present
# in BOTH prev and result, matched by position, so adding a 6th Pokémon or a
# catch doesn't masquerade as a level-up).
LEVEL_UP = 1.0

# +EXP_GAIN per experience point gained this turn, summed across the party, then
# clamped to EXP_GAIN_CAP. Tiny per-point so it's a smooth gradient BETWEEN
# level-ups (the model gets signal from chipping a wild Pokémon even if no level
# lands), but the CAP stops a single big trainer battle (hundreds/thousands of
# exp) from spiking the turn's reward above real milestones. exp is parsed from
# the "123/456 (next lv)" string; "MAX" (level 100) contributes 0. Level
# boundaries reset the exp counter, so a level-up shows as a negative raw exp
# delta — we floor per-member exp delta at 0 and rely on LEVEL_UP for that turn.
EXP_GAIN = 0.002
EXP_GAIN_CAP = 0.5   # max total exp reward per turn (= 250 exp at full weight)

# +MONEY_GAIN per unit of net INCREASE in player.money (prize money, item sales).
# Tiny per-unit, capped, so winning a trainer's prize money is a mild positive but
# doesn't dominate. Only increases are rewarded — spending money at the mart is
# not penalized here (buying potions is legitimate), so we floor the delta at 0.
MONEY_GAIN = 0.001
MONEY_GAIN_CAP = 0.5   # max money reward per turn (= 500 money at full weight)

# +POKEDEX_SEEN per newly-seen species, +POKEDEX_CAUGHT per newly-caught species
# this turn. Derived from the DELTA of player.pokedex_seen / pokedex_caught counts
# (monotonic non-decreasing counters in the view), so "first occurrence" is
# exactly a +1 to the counter — no cross-turn species set required, the counter
# already encodes first-seen/first-caught. Caught implies a fresh seen too, so the
# two can both fire on a capture turn; that's intended (seeing AND owning a new
# species is more progress than just seeing one). Both are small.
POKEDEX_SEEN = 0.5
POKEDEX_CAUGHT = 1.0

# +NEW_TRAINER the FIRST time this episode a battle starts against a given trainer
# (keyed on battle.trainer_name). Rewards ENGAGING a new trainer, not the outcome
# — it fires on the transition into the battle regardless of whether the fight is
# later won or lost/run. Needs cross-turn memory (was this trainer fought before?)
# so it lives in RewardTracker, not the pure function.
NEW_TRAINER = 2.0

# +NEW_NPC_TALK the FIRST time this episode a dialogue STARTS with a given NPC,
# keyed on (area_id, npc_id) using view.dialogue.npc_id (exposed additively in
# getView). Best-effort: if a dialogue view lacks an npc_id we fall back to
# keying on (area_id, player_position) — the tile the player is facing/standing
# on — which is stable for a fixed NPC but WILL misfire for a wandering NPC (its
# position changes) or two NPCs reachable from the same tile. Tiny weight so the
# occasional mis-key costs almost nothing. Fires once per NPC per episode; also
# needs cross-turn memory, so it lives in RewardTracker.
NEW_NPC_TALK = 0.2


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


def _party(view):
    """The party list from a view, or [] if absent (e.g. a stop payload)."""
    party = _get(view, "player", "party")
    return party if isinstance(party, list) else []


def _party_levels(view):
    """List of party member levels (ints), positional, missing -> 0."""
    out = []
    for p in _party(view):
        lv = (p or {}).get("level")
        out.append(int(lv) if isinstance(lv, (int, float)) else 0)
    return out


def _parse_exp(exp_str):
    """Current exp from a party member's `exp` field, which the engine renders as
    "<cur>/<next> (next lv)" or "MAX" at level 100. Returns the integer <cur>, or
    None if it can't be parsed (so callers can skip rather than count a bogus 0)."""
    if not isinstance(exp_str, str):
        return None
    head = exp_str.strip().split("/", 1)[0].strip()
    if not head or not head.lstrip("-").isdigit():
        return None
    return int(head)


def _party_exps(view):
    """Positional list of current-exp ints per party member; unpardseable -> None
    so we can distinguish 'no exp info' from '0 exp'."""
    return [_parse_exp((p or {}).get("exp")) for p in _party(view)]


def _level_up_reward(prev_view, result_view):
    """Total levels gained across party slots present in BOTH views (matched by
    position). Returns (reward, total_levels_gained). Slots added in result (a
    catch, a 6th member) are ignored so they don't read as level-ups."""
    prev_lv = _party_levels(prev_view)
    new_lv = _party_levels(result_view)
    gained = 0
    for i in range(min(len(prev_lv), len(new_lv))):
        d = new_lv[i] - prev_lv[i]
        if d > 0:
            gained += d
    return LEVEL_UP * gained, gained


def _exp_gain_reward(prev_view, result_view):
    """Capped reward for total exp gained across party slots present in both views.
    A level-up resets the per-member exp counter (cur drops toward 0), which shows
    as a NEGATIVE raw delta; we floor each member's delta at 0 so a level boundary
    never subtracts here (LEVEL_UP covers that turn). Returns (reward, raw_exp)."""
    prev_e = _party_exps(prev_view)
    new_e = _party_exps(result_view)
    raw = 0
    for i in range(min(len(prev_e), len(new_e))):
        a, b = prev_e[i], new_e[i]
        if a is None or b is None:
            continue
        d = b - a
        if d > 0:
            raw += d
    return min(EXP_GAIN * raw, EXP_GAIN_CAP), raw


def _money_gain_reward(prev_view, result_view):
    """Capped reward for a net INCREASE in player.money (spends floored at 0).
    Returns (reward, net_increase)."""
    prev_m = _get(prev_view, "player", "money")
    new_m = _get(result_view, "player", "money")
    if not isinstance(prev_m, (int, float)) or not isinstance(new_m, (int, float)):
        return 0.0, 0
    inc = max(0, int(new_m) - int(prev_m))
    return min(MONEY_GAIN * inc, MONEY_GAIN_CAP), inc


def _pokedex_reward(prev_view, result_view):
    """Reward for growth in the pokédex seen/caught counters (each +1 = one new
    species' first occurrence). Returns (reward, seen_delta, caught_delta)."""
    prev_seen = _get(prev_view, "player", "pokedex_seen", default=0) or 0
    new_seen = _get(result_view, "player", "pokedex_seen", default=0) or 0
    prev_caught = _get(prev_view, "player", "pokedex_caught", default=0) or 0
    new_caught = _get(result_view, "player", "pokedex_caught", default=0) or 0
    seen_d = max(0, int(new_seen) - int(prev_seen))
    caught_d = max(0, int(new_caught) - int(prev_caught))
    return POKEDEX_SEEN * seen_d + POKEDEX_CAUGHT * caught_d, seen_d, caught_d


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

    # ── level-ups (party level diff, positional) ─────────────────────────────
    lvl_r, lvl_n = _level_up_reward(prev_view, result_view)
    breakdown["level_up"] = lvl_r
    breakdown["levels_gained"] = lvl_n
    reward += lvl_r

    # ── exp gained (capped per turn) ─────────────────────────────────────────
    exp_r, exp_raw = _exp_gain_reward(prev_view, result_view)
    breakdown["exp_gain"] = exp_r
    breakdown["exp_raw"] = exp_raw
    reward += exp_r

    # ── money gained (net increase, capped) ──────────────────────────────────
    money_r, money_inc = _money_gain_reward(prev_view, result_view)
    breakdown["money_gain"] = money_r
    breakdown["money_inc"] = money_inc
    reward += money_r

    # ── pokédex: newly seen / newly caught species ───────────────────────────
    dex_r, seen_d, caught_d = _pokedex_reward(prev_view, result_view)
    breakdown["pokedex"] = dex_r
    breakdown["pokedex_seen_new"] = seen_d
    breakdown["pokedex_caught_new"] = caught_d
    reward += dex_r

    breakdown["total"] = reward
    return reward, breakdown


# ─────────────────────────────────────────────────────────────────────────────
# Per-episode novelty wrapper
# ─────────────────────────────────────────────────────────────────────────────

def _battle_started(prev_view, result_view):
    """True on the TRANSITION into a battle this turn (prev not in battle, result
    in battle). Keying on the transition means a multi-turn fight only credits its
    first turn, not every turn we're in it."""
    prev_battle = _get(prev_view, "battle")
    new_battle = _get(result_view, "battle")
    return not prev_battle and bool(new_battle)


def _dialogue_started(prev_view, result_view):
    """True on the TRANSITION into a dialogue (prev not talking, result talking)."""
    return not _get(prev_view, "dialogue_active") and bool(
        _get(result_view, "dialogue_active")
    )


def _npc_key(result_view):
    """Best-effort identity for the NPC a just-started dialogue is with.

    Prefers (area_id, npc_id) using view.dialogue.npc_id (exposed additively in
    getView). Falls back to (area_id, x, y) on the player's position when npc_id
    is absent — stable for a fixed NPC, but see NEW_NPC_TALK's caveats: a
    wandering NPC or two NPCs reachable from one tile can mis-key."""
    area = _get(result_view, "area", "id")
    npc_id = _get(result_view, "dialogue", "npc_id")
    if npc_id is not None:
        return ("npc", area, npc_id)
    pos = _map_position(result_view)
    return ("pos", area, pos)


class RewardTracker:
    """Wraps `compute_reward` with per-EPISODE novelty memory.

    The deterministic terms in `compute_reward` are pure (prev/result only). The
    novelty terms — first battle vs. a trainer, first dialogue with an NPC —
    inherently need to remember what's been encountered THIS episode, so they live
    here. Create ONE tracker per episode; call `.step(...)` each turn in place of
    `compute_reward`. It returns the same `(reward, breakdown)` shape, with the
    novelty contributions folded into both the scalar and the breakdown.

    The pure function stays importable and testable on its own; nothing about the
    deterministic reward depends on this class.
    """

    def __init__(self):
        self.reset()

    def reset(self):
        self.fought_trainers = set()   # trainer_name values already engaged
        self.talked_npcs = set()       # _npc_key() values already talked to

    def step(self, prev_view, action, result_view, result_msg):
        reward, breakdown = compute_reward(prev_view, action, result_view, result_msg)

        # ── first battle vs. a given trainer (reward engaging, not outcome) ───
        new_trainer = 0.0
        trainer_name = _get(result_view, "battle", "trainer_name")
        if (
            _battle_started(prev_view, result_view)
            and trainer_name
            and trainer_name not in self.fought_trainers
        ):
            self.fought_trainers.add(trainer_name)
            new_trainer = NEW_TRAINER
        breakdown["new_trainer"] = new_trainer
        breakdown["new_trainer_name"] = trainer_name if new_trainer else None
        reward += new_trainer

        # ── first dialogue with a given NPC ──────────────────────────────────
        new_npc = 0.0
        npc_key = None
        if _dialogue_started(prev_view, result_view):
            npc_key = _npc_key(result_view)
            if npc_key not in self.talked_npcs:
                self.talked_npcs.add(npc_key)
                new_npc = NEW_NPC_TALK
        breakdown["new_npc_talk"] = new_npc
        breakdown["new_npc_key"] = list(npc_key) if new_npc and npc_key else None
        reward += new_npc

        breakdown["total"] = reward
        return reward, breakdown


if __name__ == "__main__":
    # Tiny self-check demonstrating each component fires. Run: python3 scripts/reward.py
    import json

    def V(area, badges, ascii_map, pos, msg="", party=None, money=0,
          seen=0, caught=0, battle=None, dialogue=None):
        v = {
            "area": {"id": area}, "message": msg,
            "player": {"badges": badges, "position": pos, "money": money,
                       "pokedex_seen": seen, "pokedex_caught": caught,
                       "party": party if party is not None else []},
            "map": {"ascii": ascii_map, "position": pos},
        }
        if battle is not None:
            v["battle"] = battle
        if dialogue is not None:
            v["dialogue_active"] = True
            v["dialogue"] = dialogue
        return v

    def mon(level, cur_exp, next_exp=100000):
        return {"species": "squirtle", "level": level,
                "exp": f"{cur_exp}/{next_exp} (next lv)"}

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

    # ── v1.1 deterministic terms ─────────────────────────────────────────────
    # Exp gain (no level change): cur exp 100 -> 180 = +80 exp * 0.002 = 0.16.
    p0 = V("route_1", 0, fog, {"x": 2, "y": 2}, party=[mon(5, 100)])
    p1 = V("route_1", 0, fog, {"x": 2, "y": 2}, party=[mon(5, 180)])
    r, bd = compute_reward(p0, {"type": "battle_move"}, p1, "")
    print("exp:", json.dumps(bd)); assert bd["exp_raw"] == 80 and abs(bd["exp_gain"] - 0.16) < 1e-9

    # Exp cap: a huge exp jump clamps to EXP_GAIN_CAP.
    p1big = V("route_1", 0, fog, {"x": 2, "y": 2}, party=[mon(5, 999999)])
    r, bd = compute_reward(p0, {"type": "battle_move"}, p1big, "")
    assert bd["exp_gain"] == EXP_GAIN_CAP, bd

    # Level up: level 5 -> 6 (exp counter reset to a small value) = +LEVEL_UP,
    # and the negative raw exp delta is floored (no negative exp reward).
    p2 = V("route_1", 0, fog, {"x": 2, "y": 2}, party=[mon(6, 10)])
    r, bd = compute_reward(p0, {"type": "battle_move"}, p2, "")
    print("level:", json.dumps(bd))
    assert bd["level_up"] == LEVEL_UP and bd["levels_gained"] == 1 and bd["exp_gain"] == 0.0

    # Money gain: +300 money * 0.001 = 0.3. Spending is NOT penalized.
    m0 = V("pewter_city", 0, fog, {"x": 1, "y": 1}, money=1000)
    m1 = V("pewter_city", 0, fog, {"x": 1, "y": 1}, money=1300)
    r, bd = compute_reward(m0, {"type": "talk"}, m1, "")
    print("money:", json.dumps(bd)); assert abs(bd["money_gain"] - 0.3) < 1e-9 and bd["money_inc"] == 300
    mspend = V("pewter_city", 0, fog, {"x": 1, "y": 1}, money=700)
    r, bd = compute_reward(m0, {"type": "mart_buy"}, mspend, "")
    assert bd["money_gain"] == 0.0, bd

    # Pokédex: +1 seen and +1 caught (a capture turn credits both).
    d0 = V("route_1", 0, fog, {"x": 2, "y": 2}, seen=1, caught=1)
    d1 = V("route_1", 0, fog, {"x": 2, "y": 2}, seen=2, caught=2)
    r, bd = compute_reward(d0, {"type": "throw_ball"}, d1, "")
    print("pokedex:", json.dumps(bd))
    assert bd["pokedex_seen_new"] == 1 and bd["pokedex_caught_new"] == 1
    assert abs(bd["pokedex"] - (POKEDEX_SEEN + POKEDEX_CAUGHT)) < 1e-9

    # ── v1.1 novelty terms (RewardTracker, cross-turn memory) ────────────────
    tr = RewardTracker()
    over = V("route_1", 0, fog, {"x": 4, "y": 4})
    in_battle = V("route_1", 0, fog, {"x": 4, "y": 4},
                  battle={"is_trainer": True, "trainer_name": "Youngster Joey"})
    # First engagement fires NEW_TRAINER...
    r, bd = tr.step(over, {"type": "move"}, in_battle, "")
    print("new_trainer:", json.dumps(bd)); assert bd["new_trainer"] == NEW_TRAINER
    # ...the same trainer next battle does not (already fought this episode).
    r, bd = tr.step(over, {"type": "move"}, in_battle, "")
    assert bd["new_trainer"] == 0.0, bd
    # A staying-in-battle transition (prev already in battle) never fires it.
    r, bd = tr.step(in_battle, {"type": "battle_move"}, in_battle, "")
    assert bd["new_trainer"] == 0.0, bd

    # First dialogue with an NPC (keyed on area+npc_id) fires NEW_NPC_TALK once.
    talk = V("pallet_town", 0, fog, {"x": 5, "y": 5}, dialogue={"npc_id": "oak"})
    r, bd = tr.step(over, {"type": "talk"}, talk, "")
    print("new_npc:", json.dumps(bd)); assert bd["new_npc_talk"] == NEW_NPC_TALK
    r, bd = tr.step(over, {"type": "talk"}, talk, "")   # same NPC again -> nothing
    assert bd["new_npc_talk"] == 0.0, bd
    # Fallback keying when npc_id is absent (position-based).
    talk2 = V("viridian_city", 0, fog, {"x": 8, "y": 3}, dialogue={"text": "Hi"})
    r, bd = tr.step(over, {"type": "talk"}, talk2, "")
    assert bd["new_npc_talk"] == NEW_NPC_TALK, bd

    # Sanity: every new weight is small relative to BADGE.
    for w in (LEVEL_UP, EXP_GAIN_CAP, MONEY_GAIN_CAP, POKEDEX_SEEN,
              POKEDEX_CAUGHT, NEW_TRAINER, NEW_NPC_TALK):
        assert w < BADGE, w

    print("reward.py self-check passed.")
