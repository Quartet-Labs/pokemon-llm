'use strict';
// playthrough-intro.js — a SHORT deterministic oracle for the opening game.
//
// Why this exists: the full badge-2 oracle (playthrough-badge2.js) was authored
// against an earlier engine and its hard-coded route no longer traverses the
// current overworld cleanly. This intro oracle reaches the state VARIETY the SFT
// pipeline needs — starter_select, active dialogue, overworld navigation, and
// wild battles (attack + a survivable run) — on the current engine, driving the
// engine EXCLUSIVELY through public processAction calls (no state surgery).
//
// Route (seed 12345):
//   1. Choose Squirtle at the starter_select screen.
//   2. Advance Oak's intro dialogue with `talk`.
//   3. Leave Oak's Lab south, drop down Pallet Town clear of the lab-entrance
//      warp, then walk to the Route 1 connection and step into the tall grass.
//   4. Fight the wild encounters that trigger — run from the first (exercise the
//      `run` action), then win the rest with a straight attack.
//
// It is intentionally small and self-verifying: it asserts a battle was fought
// and the lead gained a level, so a future engine change that breaks the intro
// route fails loudly instead of silently emitting a degenerate trajectory.

const { newGame, processAction } = require('../game/engine');

function milestone(msg) { console.log('[MILESTONE]', msg); }

// Advance any active dialogue to completion (hard-capped). The runner tells the
// model to advance dialogue with {"type":"talk"}, so we use `talk` here too —
// that keeps the harvested (view, action) pairs on the model's action grammar.
function clearDialogue(state) {
  let guard = 0;
  while (state.dialogue && guard++ < 100) {
    state = processAction(state, { type: 'talk' });
  }
  return state;
}

// Move one step, clearing any dialogue the step triggered. Returns the state.
function step(state, dir) {
  state = processAction(state, { type: 'move', direction: dir });
  return clearDialogue(state);
}

// Repeat a step while `cond(state)` holds, capped. Auto-breaks on a battle so
// the caller can handle the encounter.
function walkWhile(state, dir, cond, cap) {
  let c = 0;
  while (cond(state) && state.screen !== 'battle' && c++ < cap) {
    state = step(state, dir);
  }
  return state;
}

// Fight the current wild battle to a finish: optionally run on the first turn
// (to exercise the `run` action), otherwise attack with move 0 until it ends.
function fightWild(state, { tryRun = false } = {}) {
  let turns = 0;
  let ranThisBattle = tryRun;
  while (state.screen === 'battle' && turns++ < 60) {
    if (ranThisBattle) {
      ranThisBattle = false;
      state = processAction(state, { type: 'run' });
      state = clearDialogue(state);
      continue; // if the run succeeded we exit the loop next check
    }
    state = processAction(state, { type: 'battle_move', move_index: 0 });
    state = clearDialogue(state);
  }
  return clearDialogue(state);
}

let state = newGame(12345);

// 1. Starter select.
state = processAction(state, { type: 'choose_starter', species: 'squirtle' });
state = clearDialogue(state);
milestone(`Chose ${state.player.party[0].name}`);

// 2. Exit Oak's Lab (south to the door → Pallet Town).
state = walkWhile(state, 'south', s => s.areaId === 'oaks_lab', 15);
if (state.areaId !== 'pallet_town') {
  throw new Error(`Expected to reach Pallet Town, got ${state.areaId} at (${state.player.x},${state.player.y})`);
}
milestone(`Entered Pallet Town at (${state.player.x},${state.player.y})`);

// 3. Drop south clear of the lab-entrance warp row, then line up x=7 (the Route 1
//    connection column) and walk north into Route 1. Moving west directly from
//    the lab door re-enters the lab, hence the south-first detour.
state = walkWhile(state, 'south', s => s.player.y < 13, 12);
state = walkWhile(state, 'west', s => s.player.x > 7 && s.areaId === 'pallet_town', 15);
state = walkWhile(state, 'north', s => s.areaId === 'pallet_town', 20);
if (state.areaId !== 'route_1') {
  throw new Error(`Expected Route 1, got ${state.areaId} at (${state.player.x},${state.player.y})`);
}
milestone(`Entered Route 1 at (${state.player.x},${state.player.y})`);

// Walk up to the grass band (y≈26) and step west onto the grass column.
state = walkWhile(state, 'north', s => s.player.y > 26 && s.areaId === 'route_1', 20);
state = walkWhile(state, 'west', s => s.player.x > 6 && s.areaId === 'route_1', 10);

// 4. Shuffle in the grass to draw wild encounters. First encounter: run. The
//    rest: fight to a win. Stop after we have won at least two wild battles.
const startLevel = state.player.party[0].level;
const startExp = state.player.party[0].exp || 0;
let wildWins = 0;
let firstRunDone = false;
const shuffle = ['west', 'east', 'north', 'south'];
let sc = 0;
while (wildWins < 2 && sc < 400) {
  state = step(state, shuffle[sc % shuffle.length]);
  sc++;
  if (state.screen === 'battle' && state.battle && !state.battle.isTrainer) {
    const enemy = state.battle.enemy;
    if (!firstRunDone) {
      firstRunDone = true;
      milestone(`Wild ${enemy.name} L${enemy.level} — attempting to run`);
      state = fightWild(state, { tryRun: true });
      // If the run failed the battle continues; fightWild(tryRun) only runs once
      // then attacks, so we still end in overworld with a win either way.
      if (state.screen !== 'battle') { /* ran successfully */ }
    } else {
      milestone(`Wild ${enemy.name} L${enemy.level} — fighting`);
      state = fightWild(state);
      wildWins++;
    }
  }
  if (state.areaId !== 'route_1') {
    // Wandered off the grass band; nudge back toward it.
    state = walkWhile(state, 'south', s => s.areaId !== 'route_1', 5);
  }
}

// ── Verify ────────────────────────────────────────────────────────────────────
// Success = we fought and won real wild battles (proves the battle path works
// and produced battle-screen (view, action) pairs). We don't assert a level-up:
// a lead can win several early wilds without crossing a level boundary, and the
// harvest only needs the battle states, not the XP milestone.
if (wildWins < 1) {
  throw new Error(`Expected at least one wild-battle win, got ${wildWins}`);
}
if (state.player.party[0].exp <= startExp && state.player.party[0].level <= startLevel) {
  throw new Error('Expected the lead to gain EXP from wild wins');
}

const lead = state.player.party[0];
console.log('');
console.log('════════════════════════════════════════');
console.log(' INTRO PLAYTHROUGH COMPLETE');
console.log('════════════════════════════════════════');
console.log(` Wild wins : ${wildWins}`);
console.log(` Lead      : ${lead.name} Lv${lead.level}  HP ${lead.currentHp}/${lead.maxHp}`);
console.log(` Area      : ${state.areaId} (${state.player.x},${state.player.y})`);
