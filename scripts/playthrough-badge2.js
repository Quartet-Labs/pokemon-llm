'use strict';
// Seeded playthrough: fresh game → Boulder Badge → Cascade Badge.
// Drives the engine EXCLUSIVELY through public processAction calls — no state
// surgery, no fabricated badges. Seeded with newGame(12345).
//
// Strategy notes (Gen 1 Red accurate):
//  - Squirtle evolves to Wartortle at L16 via battle EXP.
//  - Misty's gym is WATER-type; Water Gun is resisted (water vs water). The lead
//    grinds to L22 on Route 3, then swaps in BITE (Normal, learned at L22) via
//    forget_move so it has a neutral-damage move for the Cascade Badge run.
//  - Grinding tolerates the occasional black-out (a free full heal that warps to
//    the Pewter Center); the script simply walks back to the grass and resumes.
const { newGame, processAction } = require('../game/engine');

function milestone(msg) {
  console.log('[MILESTONE]', msg);
}

// Advance any blocking dialogue queue to completion (hard-capped).
function clearDialogue(state) {
  let guard = 0;
  while (state.dialogue && state.dialogue.length > 0 && guard++ < 100) {
    state = processAction(state, { type: 'advance' });
  }
  return state;
}

// Choose the best attacking move index for the active Pokémon vs the current
// enemy: Bite (Normal) against WATER-type enemies (Water Gun is resisted there),
// otherwise Water Gun (super-effective vs Rock/Ground, neutral elsewhere).
function attackIndex(active, enemy) {
  const wg = active.moves.indexOf('water gun');
  const bite = active.moves.indexOf('bite');
  const tackle = active.moves.indexOf('tackle');
  const enemyWater = enemy && Array.isArray(enemy.type) && enemy.type.includes('water');
  if (enemyWater) {
    if (bite >= 0) return bite;
    if (tackle >= 0) return tackle;
  }
  if (wg >= 0) return wg;
  if (bite >= 0) return bite;
  return 0;
}

// Move n steps in a direction; auto-run wild (non-trainer) encounters. If a run
// is refused and the lead is getting low, top it up with a potion so a chain of
// failed escapes can never black us out mid-navigation (which would desync the
// hard-coded route). Stops early if a trainer battle triggers.
function move(state, dir, n = 1) {
  for (let i = 0; i < n; i++) {
    state = processAction(state, { type: 'move', direction: dir });
    let guard = 0;
    while (state.screen === 'battle' && state.battle && !state.battle.isTrainer && guard++ < 300) {
      const active = state.player.party[state.battle.playerPartyIndex || 0];
      const bag = state.player.bag || {};
      const low = active.currentHp <= Math.max(1, Math.floor(active.maxHp * 0.35));
      if (low && (bag.super_potion || 0) > 0) {
        state = processAction(state, { type: 'use_item', item: 'super_potion', target_index: 0 });
        continue;
      }
      if (low && (bag.potion || 0) > 0) {
        state = processAction(state, { type: 'use_item', item: 'potion', target_index: 0 });
        continue;
      }
      if (low) {
        // Out of heals and low: KILL the wild rather than risk a black-out from a
        // refused escape. Early wilds fall to a hit or two from Water Gun.
        state = processAction(state, { type: 'battle_move', move_index: attackIndex(active, state.battle.enemy) });
        continue;
      }
      state = processAction(state, { type: 'run' });
    }
    state = clearDialogue(state);
    if (state.screen === 'battle') break; // trainer battle — let caller handle it
  }
  return state;
}

// Fight the active battle to completion with the best attack; heal with
// super_potion (then potion) when HP drops below `healFrac` of max.
function fight(state, healFrac = 0.4) {
  let turns = 0;
  while (state.screen === 'battle') {
    const active = state.player.party[state.battle.playerPartyIndex || 0];
    const bag = state.player.bag || {};
    const threshold = Math.max(1, Math.floor(active.maxHp * healFrac));
    if (active.currentHp <= threshold && (bag.super_potion || 0) > 0) {
      state = processAction(state, { type: 'use_item', item: 'super_potion', target_index: 0 });
    } else if (active.currentHp <= threshold && (bag.potion || 0) > 0) {
      state = processAction(state, { type: 'use_item', item: 'potion', target_index: 0 });
    } else {
      state = processAction(state, { type: 'battle_move', move_index: attackIndex(active, state.battle.enemy) });
    }
    turns++;
    if (turns > 500) throw new Error('Battle took >500 turns — likely infinite loop');
  }
  return clearDialogue(state);
}

// Move one step in dir; assert a trainer battle started; fight it. Trainer tiles
// sit on the path (never grass), so the approach step cannot roll a wild
// encounter — a single step into the trainer always starts the battle.
function step_and_fight(state, dir, healFrac = 0.4) {
  state = processAction(state, { type: 'move', direction: dir });
  if (state.screen !== 'battle' || !state.battle.isTrainer) {
    const p = state.player;
    throw new Error(
      `Expected trainer battle moving ${dir} from (${p.x},${p.y}), ` +
      `got screen=${state.screen} area=${state.areaId}`
    );
  }
  return fight(state, healFrac);
}

// Walk from wherever we are back onto the Route 3 grass row (y=9). Used to
// recover after a grind black-out (which warps us to the Pewter Center). All
// loops are hard-capped so this can never hang.
function walkToRoute3Grass(state) {
  let guard = 0;
  while (state.areaId !== 'route_3' && guard++ < 200) {
    if (state.areaId === 'pewter_city') {
      // Reset onto the clear east-west corridor at y=10 (x=1..23 is open path),
      // normalising x to 1 first so the walk to the east exit is deterministic
      // regardless of where the black-out dropped us.
      { let c = 0; while (state.player.y !== 10 && c++ < 30) state = move(state, state.player.y > 10 ? 'north' : 'south', 1); }
      { let c = 0; while (state.player.x > 1 && c++ < 30) state = move(state, 'west', 1); }
      // If we still are not on y=10 (a building blocked the vertical move), drop
      // to y=17 (fully open) via x=1, then come back up on x=1.
      if (state.player.y !== 10) {
        { let c = 0; while (state.player.y < 17 && c++ < 30) state = move(state, 'south', 1); }
        { let c = 0; while (state.player.x > 1 && c++ < 30) state = move(state, 'west', 1); }
        { let c = 0; while (state.player.y !== 10 && c++ < 30) state = move(state, state.player.y > 10 ? 'north' : 'south', 1); }
      }
      { let e = 0; while (state.player.x < 23 && state.areaId === 'pewter_city' && e++ < 40) {
          const px = state.player.x;
          state = move(state, 'east', 1);
          if (state.player.x === px && state.areaId === 'pewter_city') break;
      } }
      state = move(state, 'east', 1); // cross the edge → Route 3
    } else {
      // Fallback (shouldn't happen with lastCenter=pewter): nudge toward Pewter.
      const px = state.player.x;
      state = move(state, 'east', 1);
      if (state.player.x === px) state = move(state, 'north', 1);
    }
  }
  if (state.areaId === 'route_3') {
    let c = 0;
    while (state.player.y !== 9 && c++ < 20) {
      state = move(state, state.player.y > 9 ? 'north' : 'south', 1);
    }
  }
  return state;
}

// Grind the lead Pokémon in the Route 3 grass row until it reaches targetLevel.
// Sweeps east/west across x∈[minX,maxX], fighting every wild encounter to a win
// for EXP. Attacks straight through (no potion-nursing): the occasional black-out
// is a free full heal — we just walk back to the grass and continue. This keeps
// the grind fast and money-cheap.
function grindTo(state, targetLevel, opts) {
  const { minX = 1, maxX = 30, maxSteps = 30000 } = opts || {};
  let steps = 0;
  let dir = 'east';
  while (state.player.party[0].level < targetLevel && steps < maxSteps) {
    // Recover if a black-out (or anything) took us off the grass row.
    if (state.areaId !== 'route_3' || state.player.y < 4 || state.player.y > 10) {
      state = walkToRoute3Grass(state);
      if (state.areaId !== 'route_3') {
        throw new Error(`grindTo: could not return to Route 3 (stuck in ${state.areaId})`);
      }
      continue;
    }
    if (state.player.x >= maxX) dir = 'west';
    else if (state.player.x <= minX) dir = 'east';
    state = processAction(state, { type: 'move', direction: dir });
    if (state.screen === 'battle') {
      // Fight wild to a win for EXP; trainers don't sit on grass so this is wild.
      let turns = 0;
      while (state.screen === 'battle' && turns++ < 500) {
        const active = state.player.party[state.battle.playerPartyIndex || 0];
        state = processAction(state, { type: 'battle_move', move_index: attackIndex(active, state.battle.enemy) });
      }
    }
    state = clearDialogue(state);
    steps++;
  }
  if (state.player.party[0].level < targetLevel) {
    throw new Error(`grindTo: only reached Lv${state.player.party[0].level} after ${steps} steps`);
  }
  return state;
}

// ── Start ─────────────────────────────────────────────────────────────────────
let state = newGame(12345);
state = processAction(state, { type: 'choose_starter', species: 'squirtle' });
milestone('Chose Squirtle');

// ── Pallet Town → Route 1 → Viridian City ────────────────────────────────────
state = move(state, 'north', 10);   // exit Pallet Town
state = move(state, 'north', 35);   // traverse Route 1
milestone(`Entered Viridian City  area=${state.areaId}  pos=(${state.player.x},${state.player.y})`);

// Viridian: heal at PC (door x=11,y=15).
state = move(state, 'north', 12);   // (9,27)→(9,15)
state = move(state, 'south',  1);   // (9,15)→(9,16)
state = move(state, 'east',   2);   // (9,16)→(11,16)
state = move(state, 'north',  1);   // fires PC warp; player stays at (11,16)
milestone('Healed at Viridian Pokémon Center');

// Buy Potions at the Viridian Mart (door 17,11) so the low-level lead has a
// healing buffer through Viridian Forest and can't get worn down into a
// black-out (which would warp us back and desync the hard-coded route).
{ let g = 0; while (state.player.x < 17 && g++ < 30) state = move(state, 'east', 1); }   // → (17,16)
state = move(state, 'north', 1);    // (17,16)→(17,15)…walk up toward Mart door
{ let g = 0; while (state.player.y > 12 && g++ < 10) state = move(state, 'north', 1); }
state = move(state, 'north', 1);    // step onto Mart warp (17,11) — player stays put
{
  const affordable = Math.min(8, Math.floor((state.player.money - 200) / 300));
  if (affordable > 0) state = processAction(state, { type: 'mart_buy', item: 'potion', quantity: affordable });
}
milestone(`Bought Potions at Viridian  bag.potion=${state.player.bag['potion']}`);
// Return to the north-exit column (x=9) and leave toward Route 2 South.
{ let g = 0; while (state.player.y < 16 && g++ < 10) state = move(state, 'south', 1); }
{ let g = 0; while (state.player.x > 9 && g++ < 30) state = move(state, 'west', 1); }
{ let g = 0; while (state.player.y !== 16 && g++ < 10) state = move(state, state.player.y > 16 ? 'north' : 'south', 1); }
state = move(state, 'north', 17);   // (9,16)→exit north → Route 2 South

// ── Route 2 South → Viridian Forest ──────────────────────────────────────────
// The low-level lead can occasionally black out to the Viridian Center on a
// forest wild-encounter crit. Wrap the Bug Catcher approach in a retry keyed on
// its defeat flag: on a black-out we re-enter the forest and re-approach.
let forestAttempts = 0;
while (!state.player.flags.beat_bug_catcher_2 && forestAttempts++ < 6) {
  // Get to the forest entry. From Viridian City reach the north-exit column
  // (x=9, y=16) then head north through Route 2 South into the forest (9,30).
  if (state.areaId === 'viridian_city') {
    { let g = 0; while (state.player.x > 9 && g++ < 30) state = move(state, 'west', 1); }
    { let g = 0; while (state.player.x < 9 && g++ < 30) state = move(state, 'east', 1); }
    { let g = 0; while (state.player.y !== 16 && g++ < 30) state = move(state, state.player.y > 16 ? 'north' : 'south', 1); }
    state = move(state, 'north', 17);   // → Route 2 South
  }
  if (state.areaId === 'route_2_south') state = move(state, 'north', 12); // → Viridian Forest
  if (state.areaId !== 'viridian_forest') continue;
  milestone(`Entered Viridian Forest  area=${state.areaId}  pos=(${state.player.x},${state.player.y})`);

  // Approach Bug Catcher 2 at (13,11) from the south.
  { let g = 0; while (state.areaId === 'viridian_forest' && state.player.x !== 9 && state.player.y > 21 && g++ < 30) state = move(state, state.player.x > 9 ? 'west' : 'east', 1); }
  state = move(state, 'north', 9);    // (9,30)→(9,21)
  state = move(state, 'east',  2);    // (9,21)→(11,21)
  state = move(state, 'north', 4);    // (11,21)→(11,17)
  state = move(state, 'east',  2);    // (11,17)→(13,17)
  state = move(state, 'north', 5);    // (13,17)→(13,12)
  if (state.areaId !== 'viridian_forest' || state.player.x !== 13 || state.player.y !== 12) continue; // blacked out mid-approach
  state = step_and_fight(state, 'north'); // Bug Catcher 2 at (13,11)
  if (state.player.flags.beat_bug_catcher_2) milestone('Defeated Bug Catcher 2 (Viridian Forest)');
}
if (!state.player.flags.beat_bug_catcher_2) throw new Error('Could not defeat Viridian Forest Bug Catcher 2');

// Navigate to the north exit (from (13,12) after the fight).
state = move(state, 'south',  5);   // (13,12)→(13,17)
state = move(state, 'west',   5);   // (13,17)→(8,17)
state = move(state, 'north', 15);   // (8,17)→(8,2)
state = move(state, 'east',   1);   // (8,2)→(9,2)
state = move(state, 'north',  3);   // →exit north → Route 2 North

// ── Route 2 North → Pewter City ──────────────────────────────────────────────
state = move(state, 'north', 12);   // traverse → Pewter City (10,22)
milestone(`Entered Pewter City  area=${state.areaId}  pos=(${state.player.x},${state.player.y})`);

// Heal at Pewter PC (door x=4,y=9) before the gym.
state = move(state, 'east',   1);   // (10,22)→(11,22)
state = move(state, 'north', 12);   // (11,22)→(11,10)
state = move(state, 'west',   7);   // (11,10)→(4,10)
state = move(state, 'north',  1);   // fires Pewter PC warp; player stays at (4,10)
milestone('Healed at Pewter Pokémon Center');

// Gym: bypass Jr. Trainer♂ at (10,6) via y=8; Brock at (12,5).
state = move(state, 'east',   6);   // (4,10)→(10,10)
state = move(state, 'north',  1);   // →(10,9)  [gym entrance]
state = move(state, 'north',  1);   // →(10,8)
state = move(state, 'east',   1);   // →(11,8)
state = move(state, 'north',  3);   // (11,8)→(11,5)
state = step_and_fight(state, 'east', 0.35); // Brock at (12,5)
milestone(`Defeated BROCK — badges=${state.player.badges}  money=₽${state.player.money}`);

// Buy Super Potions at the Pewter Mart (door x=4,y=14) for the gym runs.
state = move(state, 'south',  5);   // (11,5)→(11,10)  [exit gym]
state = move(state, 'south',  5);   // (11,10)→(11,15) [south of Mart]
state = move(state, 'west',   7);   // (11,15)→(4,15)
state = move(state, 'north',  1);   // fires Mart warp at (4,14); player stays at (4,15)
{
  const affordable = Math.min(5, Math.floor(state.player.money / 700));
  if (affordable > 0) {
    state = processAction(state, { type: 'mart_buy', item: 'super_potion', quantity: affordable });
  }
}
milestone(`Bought Super Potions at Pewter  bag.super_potion=${state.player.bag['super_potion']}`);

// Return to the Pewter Center and heal, so the grind's black-out respawn (which
// warps to lastCenter) is at Pewter and the walk-back is short.
state = move(state, 'east',   7);   // (4,15)→(11,15)
state = move(state, 'north',  5);   // (11,15)→(11,10)
state = move(state, 'west',   7);   // (11,10)→(4,10)
state = move(state, 'north',  1);   // Pewter PC warp — sets lastCenter=pewter
milestone('Re-healed at Pewter (lastCenter=pewter)');

// Walk east to Route 3 via Pewter's east exit (x=23, y=10).
state = move(state, 'east',   6);   // (4,10)→(10,10)
state = move(state, 'east',  13);   // (10,10)→(23,10)
state = move(state, 'east',   1);   // →exit east → Route 3 (0,7)
milestone(`Entered Route 3  area=${state.areaId}  pos=(${state.player.x},${state.player.y})`);

// ── Route 3: grind Squirtle → Wartortle L22, then equip BITE for Misty ───────
state = move(state, 'south', 2);    // (0,7)→(0,9)  [into grass row y=9]
state = grindTo(state, 26, { minX: 1, maxX: 30 });
milestone(`Grinded to Lv${state.player.party[0].level} (${state.player.party[0].name})`);

// Equip BITE (Normal; learned at L22) by swapping out a non-damaging move, so
// the lead has a neutral attack for Misty's water-resistant team.
{
  const lead = state.player.party[0];
  if (!lead.moves.includes('bite')) {
    let swapIdx = lead.moves.indexOf('tail whip');
    if (swapIdx < 0) swapIdx = lead.moves.indexOf('withdraw');
    if (swapIdx < 0) swapIdx = 1;
    state = processAction(state, { type: 'forget_move', partyIndex: 0, moveIndex: swapIdx, newMove: 'bite' });
  }
}
milestone(`Equipped BITE  moves=${state.player.party[0].moves.join('/')}`);

// Heal (full HP + PP) at the Pewter Center before the trainer gauntlet, so the
// long grind's Water-Gun PP is restored. Get to the Route 3 west edge first
// (grass row y=9, x=0), then cross into Pewter and walk to the PC.
state = walkToRoute3Grass(state);   // lands on Route 3 grass row (y=9)
{ let g = 0; while (state.areaId === 'route_3' && state.player.x > 0 && g++ < 40) state = move(state, 'west', 1); }
state = move(state, 'west', 1);     // (0,9)→ cross west edge → Pewter (22,10)
{ let g = 0; while (state.areaId === 'pewter_city' && state.player.y !== 10 && g++ < 30) state = move(state, state.player.y > 10 ? 'north' : 'south', 1); }
{ let g = 0; while (state.areaId === 'pewter_city' && state.player.x > 4 && g++ < 30) state = move(state, 'west', 1); }
{ let g = 0; while (state.areaId === 'pewter_city' && state.player.x < 4 && g++ < 30) state = move(state, 'east', 1); }
state = move(state, 'north', 1);    // Pewter PC warp — full heal + PP restore
milestone('Healed at Pewter before gauntlet');

// Back to Route 3 to start the trainer run. Enter at (0,7) on the path row.
state = move(state, 'east', 6);     // (4,10)→(10,10)
{ let g = 0; while (state.areaId === 'pewter_city' && state.player.x < 23 && g++ < 30) state = move(state, 'east', 1); }
state = move(state, 'east', 1);     // → Route 3 (0,7)
{ let g = 0; while (state.areaId === 'route_3' && state.player.y !== 7 && g++ < 20) state = move(state, state.player.y > 7 ? 'north' : 'south', 1); }
// Player is at the far-west of Route 3 on the path row (x=0, y=7).

// ── Route 3 (3 trainers at x=8,16,24, y=7) ───────────────────────────────────
state = move(state, 'east', 7);                         // →(7,7)
state = step_and_fight(state, 'east');                  // Bug Catcher at (8,7)
milestone('Defeated Bug Catcher 1 (Route 3)');
state = move(state, 'north', 1); state = move(state, 'east', 2); state = move(state, 'south', 1);
state = move(state, 'east', 6);                         // →(15,7)
state = step_and_fight(state, 'east');                  // Lass at (16,7)
milestone('Defeated Lass (Route 3)');
state = move(state, 'north', 1); state = move(state, 'east', 2); state = move(state, 'south', 1);
state = move(state, 'east', 6);                         // →(23,7)
state = step_and_fight(state, 'east');                  // Bug Catcher at (24,7)
milestone('Defeated Bug Catcher 2 (Route 3)');
state = move(state, 'north', 1); state = move(state, 'east', 2); state = move(state, 'south', 1);
state = move(state, 'east', 6);                         // →(31,7)
state = move(state, 'east', 1);                         // exit east → Mt. Moon 1F (0,7)
milestone(`Entered Mt. Moon 1F  area=${state.areaId}  pos=(${state.player.x},${state.player.y})`);

// ── Mt. Moon 1F (Super Nerds at x=8,16, y=7; stair warp at x=22,y=7) ─────────
state = move(state, 'east', 7);                         // →(7,7)
state = step_and_fight(state, 'east');                  // Super Nerd 1 at (8,7)
milestone('Defeated Super Nerd 1 (Mt. Moon 1F)');
state = move(state, 'north', 1); state = move(state, 'east', 2); state = move(state, 'south', 1);
state = move(state, 'east', 6);                         // →(15,7)
state = step_and_fight(state, 'east');                  // Super Nerd 2 at (16,7)
milestone('Defeated Super Nerd 2 (Mt. Moon 1F)');
state = move(state, 'north', 1); state = move(state, 'east', 2); state = move(state, 'south', 1);
state = move(state, 'east', 5);                         // →(22,7) — stair warp to B2F
milestone(`Entered Mt. Moon B2F  area=${state.areaId}  pos=(${state.player.x},${state.player.y})`);

// ── Mt. Moon B2F (Rocket Grunt at x=12,y=7; east exit at x=23) ───────────────
state = move(state, 'east', 9);                         // (2,7)→(11,7)
state = step_and_fight(state, 'east');                  // Rocket Grunt at (12,7)
milestone('Defeated Rocket Grunt (Mt. Moon B2F)');
state = move(state, 'north', 1); state = move(state, 'east', 2); state = move(state, 'south', 1);
state = move(state, 'east', 10);                        // (13,7)→(23,7)
state = move(state, 'east', 1);                         // exit east → Route 4 (0,5)
milestone(`Entered Route 4  area=${state.areaId}  pos=(${state.player.x},${state.player.y})`);

// ── Route 4 → Cerulean City ───────────────────────────────────────────────────
state = move(state, 'east', 20);                        // (0,5)→exit east → Cerulean City (0,10)
milestone(`Entered Cerulean City  area=${state.areaId}  pos=(${state.player.x},${state.player.y})`);

// ── Cerulean Gym run (retry-safe) ─────────────────────────────────────────────
// From the Cerulean west entrance / the Center door, heal + stock potions, then
// clear Jr. Trainer♀ and Misty. If the lead ever blacks out (warps back to the
// Cerulean Center), we simply retry the whole run — a black-out is a free full
// heal, and the defeated-trainer flag means Jr. Trainer is skipped on retry.
function ceruleanGymRun(state) {
  // Heal at Cerulean PC (door 5,16). Reset onto the clear x=1 corridor first
  // (x=0 is the map edge and not reliably walkable), so the path is
  // deterministic whether we arrive fresh at (0,10) or via a black-out warp.
  { let g = 0; while (state.player.x < 1 && g++ < 30) state = move(state, 'east', 1); }
  { let g = 0; while (state.player.x > 1 && g++ < 30) state = move(state, 'west', 1); }
  { let g = 0; while (state.player.y !== 10 && g++ < 30) state = move(state, state.player.y > 10 ? 'north' : 'south', 1); }
  // At (1,10). Down x=1 (clear of all buildings) to y=17, east to the PC door column, heal.
  { let g = 0; while (state.player.y < 17 && g++ < 30) state = move(state, 'south', 1); }
  { let g = 0; while (state.player.x < 5 && g++ < 30) state = move(state, 'east', 1); }
  state = move(state, 'north', 1);    // (5,16) PC door — full heal + PP; sets lastCenter=cerulean
  // Stock Super Potions at the Mart (door 14,16).
  { let g = 0; while (state.player.x < 14 && g++ < 30) state = move(state, 'east', 1); }
  state = move(state, 'north', 1);    // (14,16) Mart door
  {
    const have = state.player.bag['super_potion'] || 0;
    const want = 10;
    const affordable = Math.min(Math.max(0, want - have), Math.floor(state.player.money / 700));
    if (affordable > 0) state = processAction(state, { type: 'mart_buy', item: 'super_potion', quantity: affordable });
  }
  // Navigate to (11,7) inside the gym, one tile east of Jr. Trainer♀ (10,7).
  // The gym's south wall (y=9) is open for cols 4-19; enter at x=14 then walk in.
  { let g = 0; while (state.player.x > 1 && g++ < 30) state = move(state, 'west', 1); }
  { let g = 0; while (state.player.y !== 10 && g++ < 30) state = move(state, state.player.y > 10 ? 'north' : 'south', 1); }
  { let g = 0; while (state.player.x < 14 && g++ < 30) state = move(state, 'east', 1); }
  { let g = 0; while (state.player.y > 7 && g++ < 30) state = move(state, 'north', 1); }   // into gym, up to y=7
  { let g = 0; while (state.player.x !== 11 && g++ < 30) state = move(state, state.player.x > 11 ? 'west' : 'east', 1); } // to (11,7)

  // Jr. Trainer♀ at (10,7) — skip if already beaten (retry case).
  if (!state.player.flags.beat_jr_trainer_cerulean) {
    state = step_and_fight(state, 'west', 0.5); // both her Pokémon are WATER → BITE
    if (state.areaId !== 'cerulean_city') return state; // blacked out — caller retries
    milestone('Defeated Jr. Trainer♀ (Cerulean Gym)');
  }

  // Reach Misty at (13,4).
  { let g = 0; while (state.player.x !== 11 && state.areaId === 'cerulean_city' && g++ < 20) state = move(state, state.player.x > 11 ? 'west' : 'east', 1); }
  { let g = 0; while (state.player.y > 4 && g++ < 20) state = move(state, 'north', 1); }
  state = move(state, 'east', 1);     // (11,4)→(12,4)
  state = step_and_fight(state, 'east', 0.6); // MISTY — Staryu L18, Starmie L21
  return state;
}

let ceruleanAttempts = 0;
while (state.player.badges < 2 && ceruleanAttempts++ < 8) {
  state = ceruleanGymRun(state);
  if (state.player.badges >= 2) break;
  milestone(`Cerulean gym attempt ${ceruleanAttempts} did not finish (badges=${state.player.badges}) — retrying`);
}
milestone(`Defeated MISTY — badges=${state.player.badges}  money=₽${state.player.money}`);

// ── Verify ────────────────────────────────────────────────────────────────────
if (state.player.badges !== 2) {
  throw new Error(`Expected badges=2, got ${state.player.badges}`);
}
if (!state.player.flags.beat_brock) throw new Error('beat_brock flag missing');
if (!state.player.flags.beat_misty) throw new Error('beat_misty flag missing');

const w = state.player.party[0];
console.log('');
console.log('════════════════════════════════════════');
console.log(' PLAYTHROUGH COMPLETE — 2 BADGES EARNED');
console.log('════════════════════════════════════════');
console.log(` Badges : ${state.player.badges} (Boulder Badge + Cascade Badge)`);
console.log(` Party  : ${w.name} Lv${w.level}  HP ${w.currentHp}/${w.maxHp}`);
console.log(` Money  : ₽${state.player.money}`);
console.log(` Steps  : ${state.player.steps}`);
console.log(` Area   : ${state.areaId}  (${state.player.x},${state.player.y})`);
