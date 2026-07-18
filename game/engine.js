'use strict';
const { POKEMON, rollEncounter } = require('./data/pokemon');
const { MOVES, getEffectiveness } = require('./data/moves');
const {
  AREAS, isWalkable, hasEncounter, getSurroundings,
  getAreaTile, getWarpAt, getSignAt, getNpcAt, T,
} = require('./data/areas');

// ── helpers ────────────────────────────────────────────────────────────────
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function roll(n) { return Math.floor(Math.random() * n) + 1; }

function makePokemon(speciesKey, level) {
  const base = POKEMON[speciesKey];
  if (!base) throw new Error(`Unknown species: ${speciesKey}`);
  const maxHp = Math.floor((base.hp * 2 * level) / 100) + level + 10;
  return {
    species: speciesKey,
    name: base.name,
    type: base.type,
    level,
    maxHp,
    currentHp: maxHp,
    atk:  Math.floor((base.atk * 2 * level) / 100) + 5,
    def:  Math.floor((base.def * 2 * level) / 100) + 5,
    spd:  Math.floor((base.spd * 2 * level) / 100) + 5,
    moves: base.moves.slice(0, 4),
    status: null,
    statStages: { atk:0, def:0, spd:0, acc:0 },
    exp: 0,
  };
}

function stageMultiplier(stages) {
  const TABLE = [0.25,0.28,0.33,0.40,0.50,0.66,1.0,1.5,2.0,2.5,3.0,3.5,4.0];
  return TABLE[clamp(stages + 6, 0, 12)];
}

function calcDamage(attacker, moveName, defender) {
  const mv = MOVES[moveName];
  if (!mv || mv.power === 0) return { dmg:0, effectiveness:1 };
  const atkStat = attacker.atk * stageMultiplier(attacker.statStages.atk);
  const defStat = defender.def * stageMultiplier(defender.statStages.def);
  const eff = getEffectiveness(mv.type, defender.type);
  const stab = attacker.type.includes(mv.type) ? 1.5 : 1;
  const rand = (roll(39) + 217) / 255;
  const raw = Math.floor(
    Math.floor(Math.floor(2 * attacker.level / 5 + 2) * atkStat * mv.power / defStat / 50 + 2)
    * stab * eff * rand
  );
  return { dmg: Math.max(1, raw), effectiveness: eff };
}

function applyStatusEnd(pokemon) {
  const msgs = [];
  if (!pokemon || pokemon.currentHp <= 0) return msgs;
  if (pokemon.status === 'burn' || pokemon.status === 'poison' || pokemon.status === 'leech_seed') {
    const dmg = Math.max(1, Math.floor(pokemon.maxHp / 8));
    pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
    const label = pokemon.status === 'burn' ? 'its burn' : pokemon.status === 'poison' ? 'poison' : 'Leech Seed';
    msgs.push(`${pokemon.name} is hurt by ${label}! (-${dmg} HP)`);
  }
  return msgs;
}

function applyMoveEffect(moveName, target, source) {
  const mv = MOVES[moveName];
  if (!mv?.effect) return [];
  const msgs = [];
  const e = mv.effect;
  if (e.status && roll(100) <= (e.chance || 0) && !target.status) {
    target.status = e.status;
    msgs.push(`${target.name} is now ${e.status.replace('_',' ')}!`);
  }
  if (e.stat) {
    const tgt = e.target === 'self' ? source : target;
    tgt.statStages[e.stat] = clamp((tgt.statStages[e.stat] || 0) + e.stages, -6, 6);
    msgs.push(`${tgt.name}'s ${e.stat.toUpperCase()} ${e.stages > 0 ? 'rose' : 'fell'}!`);
  }
  return msgs;
}

function enemyMove(enemy) {
  return enemy.moves[Math.floor(Math.random() * enemy.moves.length)];
}

// ── initial state ─────────────────────────────────────────────────────────────
const STARTERS = {
  bulbasaur:  { species:'bulbasaur',  name:'BULBASAUR',  type:'Grass/Poison', desc:'A strange seed was planted on its back at birth.' },
  charmander: { species:'charmander', name:'CHARMANDER', type:'Fire',          desc:'The flame at the tip of its tail makes a sound as it burns.' },
  squirtle:   { species:'squirtle',   name:'SQUIRTLE',   type:'Water',         desc:'After birth, its back swells and hardens into a shell.' },
};

function newGame() {
  return {
    screen: 'starter_select',
    areaId: 'pallet_town',
    player: {
      x: 8, y: 9,    // standing in front of Oak's table
      party: [],
      bag: { pokeball:5, potion:1 },
      money: 3000,
      badges: 0,
      steps: 0,
      flags: {},
    },
    battle: null,
    dialogue: null,
    // Oak's intro dialogue — verbatim from Gen I Red/Blue (Bulbapedia)
    message: "OAK: Hello there! Welcome to the world of POKéMON! My name is OAK! People call me the POKéMON PROF! This world is inhabited by creatures called POKéMON! For some people, POKéMON are pets. Others use them for fights. Myself… I study POKéMON as a profession. Now, let's choose your partner! Which POKéMON will you take?",
    log: [],
    turn: 0,
  };
}

// ── action processor ──────────────────────────────────────────────────────────
function processAction(state, action) {
  state = JSON.parse(JSON.stringify(state));
  state.turn++;
  const log = (m) => { state.log.unshift(m); state.log = state.log.slice(0, 20); };

  const area = AREAS[state.areaId];
  if (!area) { state.message = `Unknown area: ${state.areaId}`; return state; }

  const { type } = action;

  // ── STARTER SELECT ───────────────────────────────────────────────────────
  if (state.screen === 'starter_select') {
    if (type !== 'choose_starter') {
      state.message = "OAK: Choose your POKéMON! Use {\"type\":\"choose_starter\", \"species\":\"bulbasaur|charmander|squirtle\"}";
      return state;
    }
    const sp = (action.species || '').toLowerCase();
    if (!STARTERS[sp]) {
      state.message = `OAK: Hmm, that's not one of the choices. Choose bulbasaur, charmander, or squirtle.`;
      return state;
    }
    const starter = makePokemon(sp, 5);
    state.player.party = [starter];
    state.screen = 'overworld';
    state.player.flags.chose_starter = sp;
    state.message = `OAK: So, you chose ${starter.name}! It's a fine choice! Take good care of it. Now, ${starter.name} — your new trainer awaits! Head north through PALLET TOWN to begin your journey.`;
    log(`Received ${starter.name} from Prof. Oak!`);
    return state;
  }

  // ── DIALOGUE (advance conversation) ─────────────────────────────────────
  if (state.dialogue) {
    if (type !== 'talk' && type !== 'advance') {
      state.message = `[${state.dialogue.lines[state.dialogue.index]}]\n(Use {"type":"talk"} to advance dialogue)`;
      return state;
    }
    const d = state.dialogue;
    const line = d.lines[d.index];
    // Check for item give
    if (typeof line === 'object' && line.give) {
      state.player.bag[line.give] = (state.player.bag[line.give] || 0) + line.qty;
      state.player.flags[`got_${line.give}_from_${d.npcId}`] = true;
      log(`Received ${line.qty} ${line.give.toUpperCase()}!`);
    }
    d.index++;
    if (d.index >= d.lines.length) {
      state.dialogue = null;
      state.message = '...';
    } else {
      const next = d.lines[d.index];
      state.message = typeof next === 'string' ? next : `(Received ${next.give}!)`;
    }
    return state;
  }

  // ── OVERWORLD ────────────────────────────────────────────────────────────
  if (state.screen === 'overworld') {
    // Guard: no party = shouldn't be in overworld, redirect
    if (!state.player.party.length) {
      state.screen = 'starter_select';
      state.message = "OAK: Wait! You can't go out there without a POKéMON! Choose one first!";
      return state;
    }
    if (type === 'move') {
      const DIR = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };
      const [dx, dy] = DIR[action.direction] || [0,0];
      if (!dx && !dy) { state.message = 'Unknown direction. Use north/south/east/west.'; return state; }

      const nx = state.player.x + dx;
      const ny = state.player.y + dy;

      // Check area connections (walking off edge)
      if (ny < 0) {
        const conn = area.connections?.north;
        if (conn) {
          state.areaId = conn.area;
          state.player.x = conn.entryX;
          state.player.y = conn.entryY;
          state.message = `Heading north to ${AREAS[conn.area]?.name || conn.area}...`;
          log(state.message);
          return state;
        }
        state.message = "You can't go that way."; return state;
      }
      if (ny >= area.height) {
        const conn = area.connections?.south;
        if (conn) {
          state.areaId = conn.area;
          state.player.x = conn.entryX;
          state.player.y = conn.entryY;
          state.message = `Heading south to ${AREAS[conn.area]?.name || conn.area}...`;
          log(state.message);
          return state;
        }
        state.message = "You can't go that way."; return state;
      }
      if (nx < 0) {
        const conn = area.connections?.west;
        if (conn) {
          state.areaId = conn.area; state.player.x = conn.entryX; state.player.y = conn.entryY;
          state.message = `Heading west to ${AREAS[conn.area]?.name}...`; return state;
        }
        state.message = "You can't go that way."; return state;
      }
      if (nx >= area.width) {
        const conn = area.connections?.east;
        if (conn) {
          state.areaId = conn.area; state.player.x = conn.entryX; state.player.y = conn.entryY;
          state.message = `Heading east to ${AREAS[conn.area]?.name}...`; return state;
        }
        state.message = "You can't go that way."; return state;
      }

      // NPC blocking
      const npcHere = getNpcAt(area, nx, ny);
      if (npcHere) {
        // Trainer battle check
        if (npcHere.trainerBattle && !state.player.flags[npcHere.trainerBattle.rewardFlag]) {
          const tb = npcHere.trainerBattle;
          const [first, ...rest] = tb.party.map(e => makePokemon(e.species, e.level));
          state.screen = 'battle';
          state.battle = {
            enemy: first,
            isTrainer: true,
            trainerName: tb.trainerName || npcHere.name,
            trainerParty: rest,
            playerPartyIndex: 0,
            reward: tb.reward || 0,
            rewardFlag: tb.rewardFlag,
            badge: tb.badge || null,
            turn: 0,
          };
          const opener = (npcHere.dialogue || [])[0] || `${npcHere.name} wants to fight!`;
          state.message = opener;
          log(state.message);
          return state;
        }
        // Regular dialogue (or after-battle dialogue for defeated trainer)
        const dialogueSource = (npcHere.trainerBattle && state.player.flags[npcHere.trainerBattle.rewardFlag])
          ? (npcHere.dialogueAfter || npcHere.dialogue)
          : npcHere.dialogue;
        const lines = [...(dialogueSource || [])];
        state.dialogue = { lines, index:0, npcId: npcHere.id };
        state.dialogue.lines = lines.filter(l => {
          if (typeof l === 'object' && l.give) {
            return !state.player.flags[`got_${l.give}_from_${npcHere.id}`];
          }
          return true;
        });
        if (!state.dialogue.lines.length) { state.dialogue = null; state.message = '...'; return state; }
        state.message = typeof state.dialogue.lines[0] === 'string'
          ? state.dialogue.lines[0]
          : `(Received ${state.dialogue.lines[0].give}!)`;
        return state;
      }

      if (!isWalkable(area, nx, ny, state)) {
        // Check if it's a sign (interact from south facing north)
        const sign = getSignAt(area, nx, ny);
        if (sign) { state.message = sign.text; return state; }
        // Check for door/warp
        const warp = getWarpAt(area, nx, ny);
        if (warp) {
          return handleWarp(state, warp, area);
        }
        state.message = "You can't go that way."; return state;
      }

      // Warp check on destination tile
      const warp = getWarpAt(area, nx, ny);
      if (warp) { return handleWarp(state, warp, area); }

      state.player.x = nx;
      state.player.y = ny;
      state.player.steps++;

      // Encounter check
      if (hasEncounter(area, nx, ny) && roll(100) <= 20) {
        const tile = getAreaTile(area, nx, ny);
        const terrain = tile === T.TALL_GRASS ? 'tall_grass' : 'grass';
        const encounter = rollEncounter(state.areaId, terrain);
        if (encounter) {
          const wild = makePokemon(encounter.species, encounter.level);
          state.screen = 'battle';
          state.battle = { enemy: wild, playerPartyIndex:0, turn:0 };
          state.message = `A wild ${wild.name} appeared! (Lv.${wild.level})`;
          log(state.message);
          return state;
        }
      }

      state.message = `Moved ${action.direction}. (${nx},${ny}) — ${area.name}`;
      return state;
    }

    if (type === 'talk') {
      // Interact with NPC/sign one tile north (or in all directions)
      const dirs = [[0,-1],[1,0],[-1,0],[0,1]];
      for (const [dx,dy] of dirs) {
        const tx = state.player.x + dx, ty = state.player.y + dy;
        const npc = getNpcAt(area, tx, ty);
        if (npc) {
          const lines = [...npc.dialogue].filter(l => {
            if (typeof l === 'object' && l.give) return !state.player.flags[`got_${l.give}_from_${npc.id}`];
            return true;
          });
          if (!lines.length) { state.message = `${npc.name}: ...`; return state; }
          state.dialogue = { lines, index:0, npcId: npc.id };
          state.message = typeof lines[0] === 'string' ? lines[0] : `(Received ${lines[0].give}!)`;
          return state;
        }
        const sign = getSignAt(area, tx, ty);
        if (sign) { state.message = sign.text; return state; }
      }
      state.message = "There's nothing to interact with nearby.";
      return state;
    }

    if (type === 'use_item') {
      return useItemOverworld(state, action);
    }

    state.message = `Unknown overworld action: ${type}. Use: move, talk, use_item`;
    return state;
  }

  // ── BATTLE ────────────────────────────────────────────────────────────────
  if (state.screen === 'battle') {
    return processBattleAction(state, action, log);
  }

  state.message = 'Unknown game state.';
  return state;
}

function handleWarp(state, warp, area) {
  const destId = warp.dest;
  // Special destinations
  if (destId === 'pokemon_center') {
    // Heal all party
    for (const p of state.player.party) {
      p.currentHp = p.maxHp;
      p.status = null;
      p.statStages = { atk:0, def:0, spd:0, acc:0 };
    }
    state.message = "NURSE JOY: Welcome to the POKéMON CENTER! We've restored your POKéMON to full health. We hope to see you again!";
    return state;
  }
  if (destId === 'poke_mart') {
    state.message = "CLERK: Welcome! We have POKéBalls ¥200, Potions ¥300. (Shop not yet interactive — use use_item to manage inventory)";
    return state;
  }
  // Area warps
  if (AREAS[destId]) {
    state.areaId = destId;
    state.player.x = warp.destX;
    state.player.y = warp.destY;
    state.message = `Entered ${warp.areaName || AREAS[destId].name}.`;
    return state;
  }
  state.message = `Building: ${warp.areaName || destId}`;
  return state;
}

function useItemOverworld(state, action) {
  const { item, target_index = 0 } = action;
  const target = state.player.party[target_index];
  if (!target) { state.message = 'No Pokémon at that party slot.'; return state; }
  if (item === 'potion') {
    if (!(state.player.bag.potion > 0)) { state.message = 'You have no Potions.'; return state; }
    const healed = Math.min(20, target.maxHp - target.currentHp);
    target.currentHp += healed;
    state.player.bag.potion--;
    state.message = `Used POTION on ${target.name}. +${healed} HP.`;
  } else {
    state.message = `Can't use ${item} here.`;
  }
  return state;
}

function processBattleAction(state, action, log) {
  const battle = state.battle;
  const active = state.player.party[battle.playerPartyIndex];
  const enemy = battle.enemy;
  const msgs = [];
  const { type } = action;

  function doPlayerAttack(moveName) {
    const mv = MOVES[moveName];
    if (!mv) { msgs.push('Unknown move!'); return; }
    if (mv.power > 0) {
      const { dmg, effectiveness } = calcDamage(active, moveName, enemy);
      enemy.currentHp = Math.max(0, enemy.currentHp - dmg);
      let eff = effectiveness > 1 ? " It's super effective!" : effectiveness < 1 && effectiveness > 0 ? " It's not very effective..." : effectiveness === 0 ? " It has no effect!" : '';
      msgs.push(`${active.name} used ${moveName.toUpperCase()}! (-${dmg} HP)${eff}`);
    } else {
      msgs.push(`${active.name} used ${moveName.toUpperCase()}!`);
    }
    msgs.push(...applyMoveEffect(moveName, enemy, active));
  }

  function doEnemyAttack() {
    if (enemy.currentHp <= 0) return;
    if (enemy.status === 'paralysis' && roll(100) <= 25) { msgs.push(`${enemy.name} is paralyzed!`); return; }
    const mv = enemyMove(enemy);
    const mvData = MOVES[mv];
    if (mvData?.power > 0) {
      const { dmg } = calcDamage(enemy, mv, active);
      active.currentHp = Math.max(0, active.currentHp - dmg);
      msgs.push(`${enemy.name} used ${mv.toUpperCase()}! (-${dmg} HP)`);
    } else {
      msgs.push(`${enemy.name} used ${mv.toUpperCase()}!`);
      msgs.push(...applyMoveEffect(mv, active, enemy));
    }
  }

  function checkFaint() {
    if (enemy.currentHp <= 0) {
      const exp = Math.floor((enemy.level * 50) / 7);
      active.exp += exp;
      msgs.push(`${enemy.name} fainted! ${active.name} gained ${exp} EXP.`);

      // Trainer battle: more Pokémon?
      if (battle.isTrainer && battle.trainerParty && battle.trainerParty.length > 0) {
        const next = battle.trainerParty.shift();
        battle.enemy = next;
        msgs.push(`${battle.trainerName} sent out ${next.name}!`);
        // Return true to END this round's attack chain — `enemy` local ref is stale.
        // Next call to processBattleAction will capture `battle.enemy` = Onix fresh.
        return true;
      }

      // Trainer defeated (or wild fainted)
      if (battle.isTrainer) {
        msgs.push(`${battle.trainerName} is out of POKéMON! You win!`);
        if (battle.reward) {
          state.player.money += battle.reward;
          msgs.push(`Received ₽${battle.reward} from ${battle.trainerName}.`);
        }
        if (battle.rewardFlag) state.player.flags[battle.rewardFlag] = true;
        if (battle.badge) {
          state.player.badges++;
          const bkey = battle.badge.toLowerCase().replace(/\s+/g, '_');
          state.player.flags[`badge_${bkey}`] = true;
          msgs.push(`${battle.trainerName} awarded you the ${battle.badge.toUpperCase()}!`);
          msgs.push(`${state.player.badges} badge(s) earned so far. Head to the next GYM!`);
        }
      }

      state.screen = 'overworld'; state.battle = null;
      return true;
    }
    if (active.currentHp <= 0) {
      msgs.push(`${active.name} fainted!`);
      const alive = state.player.party.filter(p => p.currentHp > 0);
      if (!alive.length) {
        msgs.push("All your POKéMON fainted... Blacking out!");
        // Reset to last Pokémon Center (pallet town)
        state.screen = 'overworld'; state.battle = null;
        state.areaId = 'pallet_town'; state.player.x = 8; state.player.y = 14;
        for (const p of state.player.party) { p.currentHp = Math.max(1, Math.floor(p.maxHp / 2)); p.status = null; }
        state.player.money = Math.max(0, state.player.money - 50);
        msgs.push("You were taken to a POKéMON CENTER.");
      }
      return true;
    }
    return false;
  }

  if (type === 'battle_move') {
    const moveName = active.moves[action.move_index ?? 0];
    if (!moveName) { state.message = 'Invalid move index (0-3).'; return state; }
    battle.turn++;
    if (active.spd >= enemy.spd) { doPlayerAttack(moveName); if (!checkFaint()) { doEnemyAttack(); checkFaint(); } }
    else                         { doEnemyAttack(); if (!checkFaint()) { doPlayerAttack(moveName); checkFaint(); } }
    msgs.push(...applyStatusEnd(active));
    msgs.push(...applyStatusEnd(enemy));
    state.message = msgs.join(' ');
    msgs.forEach(log);
    return state;
  }

  if (type === 'run') {
    if (battle.isTrainer) {
      state.message = "Can't escape from a trainer battle!";
      return state;
    }
    const esc = Math.floor((active.spd * 32) / (enemy.spd || 1)) + 30;
    if (roll(256) < esc) {
      state.screen = 'overworld'; state.battle = null;
      state.message = 'Got away safely!'; log(state.message);
    } else {
      msgs.push("Can't escape!"); doEnemyAttack(); checkFaint();
      state.message = msgs.join(' '); msgs.forEach(log);
    }
    return state;
  }

  if (type === 'throw_ball') {
    const ball = action.ball || 'pokeball';
    if (!(state.player.bag[ball] > 0)) { state.message = `No ${ball}s left.`; return state; }
    state.player.bag[ball]--;
    const hpFrac = enemy.currentHp / enemy.maxHp;
    const catchRate = Math.floor((255 - hpFrac * 200) / (ball === 'great_ball' ? 1.5 : 1));
    if (roll(255) <= catchRate) {
      msgs.push(`Caught ${enemy.name}!`);
      if (state.player.party.length < 6) state.player.party.push(JSON.parse(JSON.stringify(enemy)));
      state.screen = 'overworld'; state.battle = null;
    } else {
      msgs.push(`${enemy.name} broke free!`); doEnemyAttack(); checkFaint();
    }
    state.message = msgs.join(' '); msgs.forEach(log);
    return state;
  }

  if (type === 'use_item') {
    const { item, target_index = battle.playerPartyIndex } = action;
    const target = state.player.party[target_index];
    if (!target) { state.message = 'No Pokémon at that slot.'; return state; }
    if (item === 'potion' && state.player.bag.potion > 0) {
      const healed = Math.min(20, target.maxHp - target.currentHp);
      target.currentHp += healed;
      state.player.bag.potion--;
      msgs.push(`Used POTION on ${target.name}. +${healed} HP.`);
      doEnemyAttack(); checkFaint();
      state.message = msgs.join(' '); msgs.forEach(log);
    } else {
      state.message = `Can't use ${item}.`;
    }
    return state;
  }

  if (type === 'switch') {
    const next = state.player.party[action.party_index];
    if (!next) { state.message = 'Invalid party slot.'; return state; }
    if (next.currentHp <= 0) { state.message = `${next.name} has fainted!`; return state; }
    if (action.party_index === battle.playerPartyIndex) { state.message = 'Already in battle!'; return state; }
    msgs.push(`Come back, ${active.name}! Go, ${next.name}!`);
    battle.playerPartyIndex = action.party_index;
    doEnemyAttack(); checkFaint();
    state.message = msgs.join(' '); msgs.forEach(log);
    return state;
  }

  state.message = `Unknown battle action: ${type}. Use: battle_move, run, throw_ball, use_item, switch`;
  return state;
}

// ── public view ─────────────────────────────────────────────────────────────
function getView(state) {
  const area = AREAS[state.areaId] || {};
  const active = state.battle ? state.player.party[state.battle.playerPartyIndex]
                              : (state.player.party[0] || null);
  const view = {
    turn: state.turn,
    screen: state.screen,
    area: { id: state.areaId, name: area.name },
    message: state.message,
    log: state.log.slice(0, 10),
    dialogue_active: !!state.dialogue,
    player: {
      position: { x: state.player.x, y: state.player.y },
      surroundings: state.screen === 'overworld'
        ? getSurroundings(area, state.player.x, state.player.y)
        : undefined,
      bag: state.player.bag,
      money: state.player.money,
      badges: state.player.badges,
      party: state.player.party.map(p => ({
        name: p.name, species: p.species, level: p.level,
        hp: `${p.currentHp}/${p.maxHp}`, status: p.status, moves: p.moves,
      })),
    },
  };
  if (state.screen === 'battle' && state.battle) {
    const isTrainer = !!state.battle.isTrainer;
    view.battle = {
      is_trainer: isTrainer,
      trainer_name: isTrainer ? state.battle.trainerName : null,
      trainer_remaining: isTrainer ? (state.battle.trainerParty || []).length : null,
      your_active: {
        name: active.name, species: active.species, level: active.level,
        hp: `${active.currentHp}/${active.maxHp}`, status: active.status,
        moves: active.moves.map((m,i) => ({ index:i, name:m, ...(MOVES[m]||{}) })),
      },
      enemy: {
        name: state.battle.enemy.name, species: state.battle.enemy.species,
        level: state.battle.enemy.level,
        hp: `${state.battle.enemy.currentHp}/${state.battle.enemy.maxHp}`,
        status: state.battle.enemy.status, type: state.battle.enemy.type,
      },
      available_actions: isTrainer
        ? ['battle_move (move_index: 0-3)', 'throw_ball (ball: pokeball|great_ball)', 'use_item (item: potion, target_index: 0-5)', 'switch (party_index: 0-5)']
        : ['battle_move (move_index: 0-3)', 'run', 'throw_ball (ball: pokeball|great_ball)', 'use_item (item: potion, target_index: 0-5)', 'switch (party_index: 0-5)'],
    };
  }
  if (state.dialogue) {
    view.dialogue = {
      text: state.dialogue.lines[state.dialogue.index],
      remaining: state.dialogue.lines.length - state.dialogue.index - 1,
      hint: 'Use {"type":"talk"} to advance.',
    };
  }
  if (state.screen === 'starter_select') {
    view.starter_options = Object.values(STARTERS);
    view.hint = 'Use {"type":"choose_starter","species":"bulbasaur|charmander|squirtle"}';
  }
  return view;
}

module.exports = { newGame, processAction, getView, makePokemon, STARTERS };

