'use strict';
const { POKEMON, ENCOUNTERS } = require('./data/pokemon');
const { MOVES, getEffectiveness } = require('./data/moves');
const { isWalkable, hasEncounter, getEncounterTerrain, getSurroundings, POI, MAP_WIDTH, MAP_HEIGHT } = require('./data/map');

// ── helpers ────────────────────────────────────────────────────────────────

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function roll(n) { return Math.floor(Math.random() * n) + 1; } // 1..n

function makePokemon(speciesKey, level = 5) {
  const base = POKEMON[speciesKey];
  if (!base) throw new Error(`Unknown species: ${speciesKey}`);
  const maxHp = Math.floor((base.hp * 2 * level) / 100) + level + 10;
  return {
    species:  speciesKey,
    name:     base.name,
    type:     base.type,
    level,
    maxHp,
    currentHp: maxHp,
    atk:  Math.floor((base.atk * 2 * level) / 100) + 5,
    def:  Math.floor((base.def * 2 * level) / 100) + 5,
    spd:  Math.floor((base.spd * 2 * level) / 100) + 5,
    moves: base.moves.slice(0, 4),
    status: null,      // burn|paralysis|poison|sleep|freeze|leech_seed
    statStages: { atk: 0, def: 0, spd: 0, acc: 0 },
    exp: 0,
  };
}

function stageMultiplier(stages) {
  // Gen 1 stat stage table (±6)
  const TABLE = [0.25, 0.28, 0.33, 0.40, 0.50, 0.66, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
  return TABLE[clamp(stages + 6, 0, 12)];
}

function calcDamage(attacker, move, defender) {
  const mvData = MOVES[move];
  if (!mvData || mvData.power === 0) return 0;
  const atkStat = attacker.atk * stageMultiplier(attacker.statStages.atk);
  const defStat = defender.def * stageMultiplier(defender.statStages.def);
  const effectiveness = getEffectiveness(mvData.type, defender.type);
  const stab = attacker.type.includes(mvData.type) ? 1.5 : 1;
  const random = (roll(39) + 217) / 255; // Gen 1 random factor
  const dmg = Math.floor(
    Math.floor(Math.floor(2 * attacker.level / 5 + 2) * atkStat * mvData.power / defStat / 50 + 2)
    * stab * effectiveness * random
  );
  return { dmg: Math.max(1, dmg), effectiveness };
}

// ── initial state factory ──────────────────────────────────────────────────

function newGame() {
  return {
    screen: 'overworld',        // 'overworld' | 'battle' | 'gameover'
    player: {
      x: POI.start.x,
      y: POI.start.y,
      party: [makePokemon('pikachu', 5)],
      bag: { pokeball: 5, potion: 3 },
      money: 500,
      badges: 0,
      steps: 0,
    },
    battle: null,               // populated during battle
    message: "Your adventure begins! Use the API to explore.",
    log: [],                    // recent event log (last 20 entries)
    turn: 0,
  };
}

// ── action handlers ────────────────────────────────────────────────────────

function applyStatusEffects(pokemon) {
  const msgs = [];
  if (pokemon.status === 'burn') {
    const dmg = Math.max(1, Math.floor(pokemon.maxHp / 8));
    pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
    msgs.push(`${pokemon.name} is hurt by its burn! (-${dmg} HP)`);
  }
  if (pokemon.status === 'poison') {
    const dmg = Math.max(1, Math.floor(pokemon.maxHp / 8));
    pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
    msgs.push(`${pokemon.name} is hurt by poison! (-${dmg} HP)`);
  }
  if (pokemon.status === 'leech_seed') {
    const dmg = Math.max(1, Math.floor(pokemon.maxHp / 8));
    pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
    msgs.push(`${pokemon.name}'s HP is sapped by Leech Seed! (-${dmg} HP)`);
  }
  return msgs;
}

function tryApplyMoveEffect(move, target, source) {
  const mvData = MOVES[move];
  if (!mvData?.effect) return [];
  const msgs = [];
  const eff = mvData.effect;

  if (eff.status && roll(100) <= (eff.chance || 0)) {
    if (!target.status) {
      target.status = eff.status;
      msgs.push(`${target.name} is now ${eff.status.replace('_',' ')}!`);
    }
  }
  if (eff.stat) {
    const tgt = eff.target === 'self' ? source : target;
    tgt.statStages[eff.stat] = clamp((tgt.statStages[eff.stat] || 0) + eff.stages, -6, 6);
    const dir = eff.stages > 0 ? 'rose' : 'fell';
    msgs.push(`${tgt.name}'s ${eff.stat.toUpperCase()} ${dir}!`);
  }
  return msgs;
}

function enemyChooseMove(enemy) {
  // Simple AI: random move (upgrade later)
  return enemy.moves[Math.floor(Math.random() * enemy.moves.length)];
}

function spawnWildEncounter(terrain) {
  const pool = ENCOUNTERS[terrain] || ENCOUNTERS.grass;
  const species = pool[Math.floor(Math.random() * pool.length)];
  const level = Math.max(2, roll(5) + 2);
  return makePokemon(species, level);
}

// ── main action processor ─────────────────────────────────────────────────

function processAction(state, action) {
  state = JSON.parse(JSON.stringify(state)); // deep clone — no mutation of input
  state.turn++;
  const logMsg = (m) => { state.log.unshift(m); state.log = state.log.slice(0, 20); };
  state.message = '';

  const { type } = action;

  // ── OVERWORLD ──────────────────────────────────────────────────────────
  if (state.screen === 'overworld') {
    if (type === 'move') {
      const DIR = { north: [0,-1], south: [0,1], east: [1,0], west: [-1,0] };
      const [dx, dy] = DIR[action.direction] || [0, 0];
      const nx = state.player.x + dx;
      const ny = state.player.y + dy;

      if (!dx && !dy) {
        state.message = "Unknown direction. Use north/south/east/west.";
        return state;
      }
      if (!isWalkable(nx, ny)) {
        state.message = "You can't go that way.";
        return state;
      }

      state.player.x = nx;
      state.player.y = ny;
      state.player.steps++;

      // Encounter check in tall grass / grass
      if (hasEncounter(nx, ny) && roll(100) <= 20) {
        const terrain = getEncounterTerrain(nx, ny);
        const wild = spawnWildEncounter(terrain);
        state.screen = 'battle';
        state.battle = {
          enemy: wild,
          playerPartyIndex: 0,
          escaped: false,
          caught: false,
          turn: 0,
        };
        state.message = `A wild ${wild.name} appeared! (Lv.${wild.level})`;
        logMsg(state.message);
      } else {
        state.message = `Moved ${action.direction}.`;
      }
      return state;
    }

    if (type === 'use_item') {
      const { item, target_index = 0 } = action;
      const pokemon = state.player.party[target_index];
      if (!pokemon) { state.message = "No Pokémon at that party index."; return state; }

      if (item === 'potion') {
        if (!state.player.bag.potion || state.player.bag.potion <= 0) {
          state.message = "You have no Potions left."; return state;
        }
        const healed = Math.min(20, pokemon.maxHp - pokemon.currentHp);
        pokemon.currentHp += healed;
        state.player.bag.potion--;
        state.message = `Used Potion on ${pokemon.name}. Restored ${healed} HP.`;
        logMsg(state.message);
      } else {
        state.message = `You don't have any ${item}.`;
      }
      return state;
    }

    state.message = `Unknown overworld action: ${type}`;
    return state;
  }

  // ── BATTLE ────────────────────────────────────────────────────────────
  if (state.screen === 'battle') {
    const battle = state.battle;
    const playerPokemon = state.player.party[battle.playerPartyIndex];
    const enemy = battle.enemy;
    const msgs = [];

    if (type === 'battle_move') {
      const moveIndex = action.move_index ?? 0;
      const moveName = playerPokemon.moves[moveIndex];
      if (!moveName) { state.message = "Invalid move index."; return state; }

      battle.turn++;

      // Speed check for turn order
      const playerFirst = playerPokemon.spd >= enemy.spd;

      function doPlayerAttack() {
        const mvData = MOVES[moveName];
        if (!mvData) { msgs.push("Move data missing!"); return; }
        if (mvData.power > 0) {
          const { dmg, effectiveness } = calcDamage(playerPokemon, moveName, enemy);
          enemy.currentHp = Math.max(0, enemy.currentHp - dmg);
          let eff = '';
          if (effectiveness > 1) eff = " It's super effective!";
          if (effectiveness < 1 && effectiveness > 0) eff = " It's not very effective...";
          if (effectiveness === 0) eff = " It has no effect!";
          msgs.push(`${playerPokemon.name} used ${moveName.toUpperCase()}! (-${dmg} HP)${eff}`);
        } else {
          msgs.push(`${playerPokemon.name} used ${moveName.toUpperCase()}!`);
        }
        msgs.push(...tryApplyMoveEffect(moveName, enemy, playerPokemon));
      }

      function doEnemyAttack() {
        if (enemy.currentHp <= 0) return;
        if (enemy.status === 'paralysis' && roll(100) <= 25) {
          msgs.push(`${enemy.name} is paralyzed and can't move!`); return;
        }
        const eMove = enemyChooseMove(enemy);
        const eMvData = MOVES[eMove];
        if (eMvData?.power > 0) {
          const { dmg, effectiveness } = calcDamage(enemy, eMove, playerPokemon);
          playerPokemon.currentHp = Math.max(0, playerPokemon.currentHp - dmg);
          msgs.push(`${enemy.name} used ${eMove.toUpperCase()}! (-${dmg} HP)`);
        } else {
          msgs.push(`${enemy.name} used ${eMove.toUpperCase()}!`);
          msgs.push(...tryApplyMoveEffect(eMove, playerPokemon, enemy));
        }
      }

      if (playerFirst) { doPlayerAttack(); doEnemyAttack(); }
      else             { doEnemyAttack(); doPlayerAttack(); }

      // End-of-turn status
      msgs.push(...applyStatusEffects(playerPokemon));
      msgs.push(...applyStatusEffects(enemy));

      // Check faint
      if (enemy.currentHp <= 0) {
        const expGain = Math.floor((enemy.level * 50) / 7);
        playerPokemon.exp += expGain;
        msgs.push(`${enemy.name} fainted! ${playerPokemon.name} gained ${expGain} EXP.`);
        state.screen = 'overworld';
        state.battle = null;
      } else if (playerPokemon.currentHp <= 0) {
        msgs.push(`${playerPokemon.name} fainted!`);
        // Check if any party members remain
        const alive = state.player.party.filter(p => p.currentHp > 0);
        if (alive.length === 0) {
          msgs.push("All your Pokémon have fainted. Game over...");
          state.screen = 'gameover';
          state.battle = null;
        } else {
          msgs.push("You need to switch Pokémon (switch action).");
        }
      }

      state.message = msgs.join(' ');
      msgs.forEach(logMsg);
      return state;
    }

    if (type === 'run') {
      // Gen 1 escape formula (simplified)
      const escapeChance = Math.floor((playerPokemon.spd * 32) / (enemy.spd || 1)) + 30;
      if (roll(256) < escapeChance) {
        msgs.push("Got away safely!");
        state.screen = 'overworld';
        state.battle = null;
      } else {
        msgs.push("Can't escape!");
        // Enemy still attacks
        const eMove = enemyChooseMove(enemy);
        const eMvData = MOVES[eMove];
        if (eMvData?.power > 0) {
          const { dmg } = calcDamage(enemy, eMove, playerPokemon);
          playerPokemon.currentHp = Math.max(0, playerPokemon.currentHp - dmg);
          msgs.push(`${enemy.name} used ${eMove.toUpperCase()}! (-${dmg} HP)`);
        }
      }
      state.message = msgs.join(' ');
      msgs.forEach(logMsg);
      return state;
    }

    if (type === 'throw_ball') {
      const ball = action.ball || 'pokeball';
      if (!state.player.bag[ball] || state.player.bag[ball] <= 0) {
        state.message = `You have no ${ball}s left.`; return state;
      }
      state.player.bag[ball]--;

      // Gen 1 catch formula (simplified)
      const hpFraction = enemy.currentHp / enemy.maxHp;
      const catchRate = Math.floor((255 - hpFraction * 200) / (ball === 'great_ball' ? 1.5 : 1));
      if (roll(255) <= catchRate) {
        msgs.push(`Caught ${enemy.name}!`);
        if (state.player.party.length < 6) state.player.party.push(enemy);
        state.screen = 'overworld';
        state.battle = null;
        state.battle = null;
      } else {
        msgs.push(`${enemy.name} broke free!`);
        // Enemy attacks back
        const eMove = enemyChooseMove(enemy);
        const eMvData = MOVES[eMove];
        if (eMvData?.power > 0) {
          const { dmg } = calcDamage(enemy, eMove, playerPokemon);
          playerPokemon.currentHp = Math.max(0, playerPokemon.currentHp - dmg);
          msgs.push(`${enemy.name} used ${eMove.toUpperCase()}! (-${dmg} HP)`);
        }
      }
      state.message = msgs.join(' ');
      msgs.forEach(logMsg);
      return state;
    }

    if (type === 'use_item') {
      const { item, target_index = battle.playerPartyIndex } = action;
      const target = state.player.party[target_index];
      if (!target) { state.message = "No Pokémon at that party index."; return state; }
      if (item === 'potion') {
        if (!state.player.bag.potion || state.player.bag.potion <= 0) {
          state.message = "No Potions left."; return state;
        }
        const healed = Math.min(20, target.maxHp - target.currentHp);
        target.currentHp += healed;
        state.player.bag.potion--;
        state.message = `Used Potion on ${target.name}. +${healed} HP. Enemy attacks!`;
        // Enemy still gets a turn
        const eMove = enemyChooseMove(enemy);
        const eMvData = MOVES[eMove];
        if (eMvData?.power > 0) {
          const { dmg } = calcDamage(enemy, eMove, playerPokemon);
          playerPokemon.currentHp = Math.max(0, playerPokemon.currentHp - dmg);
          state.message += ` ${enemy.name} used ${eMove.toUpperCase()}! (-${dmg} HP)`;
        }
        logMsg(state.message);
      } else {
        state.message = `Can't use ${item} right now.`;
      }
      return state;
    }

    if (type === 'switch') {
      const idx = action.party_index;
      const next = state.player.party[idx];
      if (!next) { state.message = "No Pokémon at that index."; return state; }
      if (next.currentHp <= 0) { state.message = `${next.name} has fainted and can't battle!`; return state; }
      if (idx === battle.playerPartyIndex) { state.message = "That Pokémon is already in battle!"; return state; }
      const prev = playerPokemon;
      battle.playerPartyIndex = idx;
      msgs.push(`Go, ${next.name}! Come back, ${prev.name}!`);
      // Enemy attacks on switch
      const eMove = enemyChooseMove(enemy);
      const eMvData = MOVES[eMove];
      if (eMvData?.power > 0) {
        const { dmg } = calcDamage(enemy, eMove, next);
        next.currentHp = Math.max(0, next.currentHp - dmg);
        msgs.push(`${enemy.name} used ${eMove.toUpperCase()}! (-${dmg} HP)`);
      }
      state.message = msgs.join(' ');
      msgs.forEach(logMsg);
      return state;
    }

    state.message = `Unknown battle action: ${type}`;
    return state;
  }

  state.message = `Game over. Start a new game.`;
  return state;
}

// ── public state view (what the LLM sees) ─────────────────────────────────

function getView(state) {
  const { player, screen, battle, message, log, turn } = state;
  const activePokemon = player.party[battle?.playerPartyIndex ?? 0];

  const view = {
    turn,
    screen,
    message,
    log: log.slice(0, 10),
    player: {
      position: { x: player.x, y: player.y },
      surroundings: screen === 'overworld' ? getSurroundings(player.x, player.y) : undefined,
      bag: player.bag,
      money: player.money,
      party: player.party.map(p => ({
        name: p.name,
        species: p.species,
        level: p.level,
        hp: `${p.currentHp}/${p.maxHp}`,
        status: p.status,
        moves: p.moves,
      })),
    },
  };

  if (screen === 'battle' && battle) {
    const active = player.party[battle.playerPartyIndex];
    view.battle = {
      your_active: {
        name: active.name,
        level: active.level,
        hp: `${active.currentHp}/${active.maxHp}`,
        status: active.status,
        moves: active.moves.map((m, i) => ({ index: i, name: m, ...MOVES[m] })),
      },
      enemy: {
        name: battle.enemy.name,
        level: battle.enemy.level,
        hp: `${battle.enemy.currentHp}/${battle.enemy.maxHp}`,
        status: battle.enemy.status,
        type: battle.enemy.type,
      },
      available_actions: [
        "battle_move (move_index: 0-3)",
        "run",
        "throw_ball (ball: pokeball|great_ball)",
        "use_item (item: potion, target_index: 0-5)",
        "switch (party_index: 0-5)",
      ],
    };
  }

  return view;
}

module.exports = { newGame, processAction, getView, makePokemon };
