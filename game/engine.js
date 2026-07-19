'use strict';
const { POKEMON, rollEncounter } = require('./data/pokemon');
const { MOVES, getEffectiveness } = require('./data/moves');
const {
  AREAS, isWalkable, hasEncounter, getSurroundings,
  getAreaTile, getWarpAt, getSignAt, getNpcAt, T,
} = require('./data/areas');

// ── helpers ────────────────────────────────────────────────────────────────
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ── Poké Mart catalog (#20 #21) ───────────────────────────────────────────────
// Keys match area IDs that have marts; the clerk's `martTier` tag maps here.
const MART_CATALOG = {
  viridian: [
    { item: 'poke_ball',     price: 200 },
    { item: 'potion',        price: 300 },
    { item: 'antidote',      price: 100 },
    { item: 'paralyze_heal', price: 200 },
  ],
  pewter: [
    { item: 'poke_ball',     price: 200 },
    { item: 'great_ball',    price: 600 },
    { item: 'potion',        price: 300 },
    { item: 'super_potion',  price: 700 },
    { item: 'antidote',      price: 100 },
  ],
  celadon: [
    { item: 'fire_stone',    price: 2100 },
    { item: 'water_stone',   price: 2100 },
    { item: 'thunder_stone', price: 2100 },
    { item: 'leaf_stone',    price: 2100 },
    { item: 'moon_stone',    price: 2100 },
    { item: 'potion',        price: 300  },
    { item: 'super_potion',  price: 700  },
    { item: 'great_ball',    price: 600  },
    { item: 'ultra_ball',    price: 1200 },
  ],
};

// Friendly display names for items
const ITEM_NAMES = {
  poke_ball:     'Poké Ball',
  great_ball:    'Great Ball',
  ultra_ball:    'Ultra Ball',
  potion:        'Potion',
  super_potion:  'Super Potion',
  antidote:      'Antidote',
  paralyze_heal: 'Parlyz Heal',
  full_heal:     'Full Heal',
  fire_stone:    'Fire Stone',
  water_stone:   'Water Stone',
  thunder_stone: 'Thunder Stone',
  leaf_stone:    'Leaf Stone',
  moon_stone:    'Moon Stone',
};

// Resolve which mart tier is available for a given area, or null if none.
function getMartTierForArea(areaId) {
  if (areaId === 'viridian_city') return 'viridian';
  if (areaId === 'pewter_city')   return 'pewter';
  if (areaId === 'celadon_city')  return 'celadon';
  return null;
}

// ── Seeded PRNG (#33) ───────────────────────────────────────────────────────
// mulberry32 — fast, good statistical quality, reproducible from a uint32 seed.
function mulberry32Rng(seed) {
  let s = seed >>> 0;
  return function() {
    s += 0x6D2B79F5; s >>>= 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Module-level RNG — replaced at the top of every processAction call when
// state.rngSeed is defined. Node.js is single-threaded so no concurrent clobber.
let _rng = null;

function roll(n) { return Math.floor((_rng ? _rng() : Math.random()) * n) + 1; }

// ── #18: EXP thresholds and level-up ─────────────────────────────────────────
function expForLevel(level, growthRate) {
  if (level <= 1) return 0;
  const n = level;
  switch (growthRate || 'medium_fast') {
    case 'medium_fast': return n * n * n;
    case 'medium_slow': return Math.max(0, Math.floor(6/5 * n*n*n) - 15*n*n + 100*n - 140);
    case 'fast':        return Math.floor(4/5 * n*n*n);
    case 'slow':        return Math.floor(5/4 * n*n*n);
    default:            return n * n * n;
  }
}

function tryLevelUp(pokemon, msgs) {
  const base = POKEMON[pokemon.species];
  if (!base) return;
  const gr = pokemon.growthRate || base.growthRate || 'medium_fast';
  while (pokemon.level < 100 && pokemon.exp >= expForLevel(pokemon.level + 1, gr)) {
    pokemon.level++;
    const lv = pokemon.level;
    const oldMaxHp = pokemon.maxHp;
    pokemon.maxHp = Math.floor((base.hp  * 2 * lv) / 100) + lv + 10;
    pokemon.atk   = Math.floor((base.atk * 2 * lv) / 100) + 5;
    pokemon.def   = Math.floor((base.def * 2 * lv) / 100) + 5;
    pokemon.spd   = Math.floor((base.spd * 2 * lv) / 100) + 5;
    pokemon.spc   = Math.floor(((base.spc ?? base.atk) * 2 * lv) / 100) + 5;
    // Heal HP gained from the stat increase
    pokemon.currentHp = Math.min(pokemon.maxHp, pokemon.currentHp + (pokemon.maxHp - oldMaxHp));
    msgs.push(`${pokemon.name} grew to Lv.${pokemon.level}!`);

    // Learn new moves from learnset at this level
    const learnset = base.learnset || {};
    const newMoves = learnset[pokemon.level] || [];
    for (const mv of newMoves) {
      if (!(pokemon.moves || []).includes(mv) && MOVES[mv]) {
        if ((pokemon.moves || []).length < 4) {
          pokemon.moves = [...(pokemon.moves || []), mv];
          if (pokemon.pp) pokemon.pp[mv] = MOVES[mv]?.pp ?? 20;
          msgs.push(`${pokemon.name} learned ${mv.toUpperCase()}!`);
        } else {
          msgs.push(`${pokemon.name} wants to learn ${mv.toUpperCase()}, but already knows 4 moves!`);
        }
      }
    }

    // Check for level-based evolution
    tryEvolve(pokemon, msgs);
  }
}

function tryEvolve(pokemon, msgs) {
  const base = POKEMON[pokemon.species];
  if (!base) return false;
  const evo = base.evolvesTo;
  if (!evo) return false;

  // Handle array (Eevee) or single object
  const candidates = Array.isArray(evo) ? evo : [evo];

  for (const candidate of candidates) {
    // Only auto-evolve on level for level-based evolutions
    if (!candidate.level) continue;
    if (pokemon.level >= candidate.level) {
      return doEvolve(pokemon, candidate.species, msgs);
    }
  }
  return false;
}

function doEvolve(pokemon, targetSpecies, msgs) {
  const newBase = POKEMON[targetSpecies];
  if (!newBase) return false;

  const oldName = pokemon.name;
  const lv = pokemon.level;

  // Update species and name
  pokemon.species = targetSpecies;
  pokemon.name = newBase.name;
  pokemon.types = newBase.type;
  pokemon.type  = newBase.type;
  pokemon.growthRate = newBase.growthRate || 'medium_fast';

  // Recalculate stats at current level
  pokemon.maxHp = Math.floor((newBase.hp  * 2 * lv) / 100) + lv + 10;
  pokemon.atk   = Math.floor((newBase.atk * 2 * lv) / 100) + 5;
  pokemon.def   = Math.floor((newBase.def * 2 * lv) / 100) + 5;
  pokemon.spd   = Math.floor((newBase.spd * 2 * lv) / 100) + 5;
  pokemon.spc   = Math.floor(((newBase.spc ?? newBase.atk) * 2 * lv) / 100) + 5;
  // HP bonus from stat increase
  const hpGain = pokemon.maxHp - (pokemon.currentHp || 0);
  pokemon.currentHp = Math.min(pokemon.maxHp, (pokemon.currentHp || 0) + Math.max(0, hpGain));

  // Carry over learned moves; also learn any moves the new species learns at
  // level 1 that aren't already known
  const newLearnset = newBase.learnset || {};
  const evo1Moves = newLearnset[1] || [];
  for (const mv of evo1Moves) {
    if (!(pokemon.moves || []).includes(mv)) {
      if ((pokemon.moves || []).length < 4) {
        pokemon.moves = [...(pokemon.moves || []), mv];
        if (pokemon.pp) pokemon.pp[mv] = MOVES[mv]?.pp ?? 20;
      }
    }
  }

  msgs.push(`Congratulations! ${oldName} evolved into ${newBase.name}!`);
  return true;
}

function makePokemon(speciesKey, level) {
  const base = POKEMON[speciesKey];
  if (!base) throw new Error(`Unknown species: ${speciesKey}`);
  const maxHp = Math.floor((base.hp * 2 * level) / 100) + level + 10;
  const moves = base.moves.slice(0, 4);
  // Build PP map from move data (default 20 if not defined)
  const pp = {};
  for (const mv of moves) pp[mv] = MOVES[mv]?.pp ?? 20;
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
    // #17: Special stat for special moves (Gen I uses one Spc for both offence/defence)
    spc:  Math.floor(((base.spc ?? base.atk) * 2 * level) / 100) + 5,
    moves,
    pp,                    // #15: PP tracking
    status: null,
    statusTurns: 0,        // sleep turns remaining
    confused: false,       // #16: confusion (separate from primary status)
    confusedTurns: 0,
    flinched: false,       // #16: per-turn flinch flag
    statStages: { atk:0, def:0, spd:0, spc:0, acc:0 },
    // #18: cumulative EXP; initialise to the amount for current level so level-up thresholds are correct
    growthRate: base.growthRate || 'medium_fast',
    exp: expForLevel(level, base.growthRate || 'medium_fast'),
    // #22: Bide multi-turn state
    bideState: null,       // { turnsLeft, damageAccum } while charging
    // #23: Bind/Wrap multi-turn state
    boundState: null,      // { turnsLeft } while trapped
  };
}

function stageMultiplier(stages) {
  const TABLE = [0.25,0.28,0.33,0.40,0.50,0.66,1.0,1.5,2.0,2.5,3.0,3.5,4.0];
  return TABLE[clamp(stages + 6, 0, 12)];
}

// #14 + #17: damage with crits, special stat, burn penalty, badge boost
function calcDamage(attacker, moveName, defender, opts = {}) {
  const mv = MOVES[moveName];
  if (!mv || mv.power === 0) return { dmg:0, effectiveness:1, crit:false };

  const isSpecial = mv.cat === 'special';

  // #14: Critical hit — Gen I: threshold = floor(attacker.spd * critMult / 2) out of 256
  // High-crit moves (Slash, Razor Leaf) have crit_rate: 8 → 8× threshold
  const critMult = mv.effect?.crit_rate || 1;
  const critThreshold = Math.min(255, Math.floor(attacker.spd * critMult / 2));
  const isCrit = (roll(256) - 1) < critThreshold;

  // #17: Special moves use spc/spc; physical use atk/def
  const atkBase = isSpecial ? (attacker.spc ?? attacker.atk) : attacker.atk;
  const defBase = isSpecial ? (defender.spc ?? defender.def) : defender.def;

  // Crits bypass stat stages (Gen I behaviour)
  const atkStage = isCrit ? 1 : stageMultiplier(isSpecial ? (attacker.statStages.spc ?? 0) : attacker.statStages.atk);
  const defStage = isCrit ? 1 : stageMultiplier(isSpecial ? (defender.statStages.spc ?? 0) : defender.statStages.def);

  // Burn halves physical ATK (crits bypass this in Gen I)
  const burnPenalty = (!isCrit && attacker.status === 'burn' && !isSpecial) ? 0.5 : 1;

  // #12: Boulder Badge → +12.5% ATK on physical moves for the player
  const badgeBoost = isSpecial ? 1 : (opts.badgeBoost || 1);

  const atkStat = atkBase * atkStage * burnPenalty * badgeBoost;
  const defStat = defBase * defStage;

  const eff = getEffectiveness(mv.type, defender.type);
  const stab = attacker.type.includes(mv.type) ? 1.5 : 1;
  const rand = (roll(39) + 217) / 255;

  const raw = Math.floor(
    Math.floor(Math.floor(2 * attacker.level / 5 + 2) * atkStat * mv.power / defStat / 50 + 2)
    * stab * eff * rand
    * (isCrit ? 2 : 1)
  );
  return { dmg: Math.max(1, raw), effectiveness: eff, crit: isCrit };
}

// #6 + #16: Check if a pokemon can act this turn; pushes messages to msgs array
function checkCanAct(pokemon, msgs) {
  if (pokemon.currentHp <= 0) return false;

  // #6: Player (and enemy) paralysis — 25% fully paralyzed
  if (pokemon.status === 'paralysis' && roll(4) === 1) {
    msgs.push(`${pokemon.name} is paralyzed! It can't move!`);
    return false;
  }

  // #16: Sleep — can't act; decrement counter; wake up when it hits 0
  if (pokemon.status === 'sleep') {
    if (pokemon.statusTurns > 0) pokemon.statusTurns--;
    if (pokemon.statusTurns === 0) {
      pokemon.status = null;
      msgs.push(`${pokemon.name} woke up!`);
      // Woke this turn: still can't act (Gen I behaviour — wake-up turn is wasted)
      return false;
    }
    msgs.push(`${pokemon.name} is fast asleep!`);
    return false;
  }

  // #16: Freeze — 10% thaw chance each turn; otherwise locked
  if (pokemon.status === 'freeze') {
    if (roll(10) === 1) {
      pokemon.status = null;
      msgs.push(`${pokemon.name} thawed out!`);
    } else {
      msgs.push(`${pokemon.name} is frozen solid!`);
      return false;
    }
  }

  // #16: Flinch — set by previous attack this turn; clears automatically
  if (pokemon.flinched) {
    pokemon.flinched = false;
    msgs.push(`${pokemon.name} flinched!`);
    return false;
  }

  // #16: Confusion — 50% self-hit chance; typeless 40-power damage to self
  if (pokemon.confused) {
    if (pokemon.confusedTurns > 0) pokemon.confusedTurns--;
    if (pokemon.confusedTurns <= 0) {
      pokemon.confused = false;
      msgs.push(`${pokemon.name} snapped out of its confusion!`);
    } else if (roll(2) === 1) {
      // Hit self: typeless physical, 40 BP, ignore stat stages for simplicity
      const selfDmg = Math.max(1, Math.floor(
        (Math.floor(2 * pokemon.level / 5 + 2) * pokemon.atk * 40 / pokemon.def / 50) + 2
      ));
      pokemon.currentHp = Math.max(0, pokemon.currentHp - selfDmg);
      msgs.push(`${pokemon.name} is confused and hurt itself! (-${selfDmg} HP)`);
      return false;
    } else {
      msgs.push(`${pokemon.name} is confused!`);
    }
  }

  return true;
}

// #4: Status end-of-turn damage — Gen I: 1/16 maxHP (was incorrectly 1/8)
function applyStatusEnd(pokemon) {
  const msgs = [];
  if (!pokemon || pokemon.currentHp <= 0) return msgs;
  if (pokemon.status === 'burn' || pokemon.status === 'poison' || pokemon.status === 'leech_seed') {
    const dmg = Math.max(1, Math.floor(pokemon.maxHp / 16));
    pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
    const label = pokemon.status === 'burn' ? 'its burn'
                : pokemon.status === 'poison' ? 'poison' : 'Leech Seed';
    msgs.push(`${pokemon.name} is hurt by ${label}! (-${dmg} HP)`);
  }
  // #23: Bind/Wrap — deal 1/16 per turn, count down, free when done
  if (pokemon.boundState) {
    pokemon.boundState.turnsLeft--;
    if (pokemon.boundState.turnsLeft <= 0) {
      pokemon.boundState = null;
      msgs.push(`${pokemon.name} was freed from the bind!`);
    } else {
      const dmg = Math.max(1, Math.floor(pokemon.maxHp / 16));
      pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
      msgs.push(`${pokemon.name} is hurt by the bind! (-${dmg} HP)`);
    }
  }
  return msgs;
}

// #16: Apply move secondary effects — handles flinch/confusion/sleep/freeze properly
function applyMoveEffect(moveName, target, source) {
  const mv = MOVES[moveName];
  if (!mv?.effect) return [];
  const msgs = [];
  const e = mv.effect;

  // Status effects (primary and volatile)
  if (e.status && roll(100) <= (e.chance || 0)) {
    if (e.status === 'flinch') {
      // Flinch doesn't overwrite primary status; sets a per-turn flag instead
      target.flinched = true;
      // message shown when the flinched pokemon tries to act
    } else if (e.status === 'confusion') {
      if (!target.confused) {
        target.confused = true;
        target.confusedTurns = 2 + roll(3);  // 2-4 turns remaining after this
        msgs.push(`${target.name} became confused!`);
      }
    } else if (!target.status) {
      target.status = e.status;
      if (e.status === 'sleep') {
        target.statusTurns = 1 + roll(6);  // 1-7 turns (Gen I range)
        msgs.push(`${target.name} fell asleep!`);
      } else if (e.status === 'freeze') {
        target.statusTurns = 0;
        msgs.push(`${target.name} was frozen solid!`);
      } else if (e.status === 'leech_seed') {
        msgs.push(`${target.name} was seeded!`);
      } else {
        msgs.push(`${target.name} is now ${e.status.replace(/_/g, ' ')}!`);
      }
    }
  }

  // Stat stage changes (with optional per-move chance)
  if (e.stat) {
    const applyChance = e.statChance ? roll(100) <= e.statChance : true;
    if (applyChance) {
      const tgt = e.target === 'self' ? source : target;
      tgt.statStages[e.stat] = clamp((tgt.statStages[e.stat] || 0) + e.stages, -6, 6);
      msgs.push(`${tgt.name}'s ${e.stat.toUpperCase()} ${e.stages > 0 ? 'rose' : 'fell'}!`);
    }
  }

  return msgs;
}

function enemyMove(enemy) {
  const rand = _rng ? _rng() : Math.random();
  return enemy.moves[Math.floor(rand * enemy.moves.length)];
}

// ── #19: Gen I catch mechanics ────────────────────────────────────────────────
// Formula: f = floor((3*maxHP - 2*currentHP) * effectiveCatchRate * ballMult / (3*maxHP))
// Ball shakes 4 times: each shake passes if roll(256)-1 <= f. Caught iff all 4 pass.
function attemptCatch(ball, target) {
  const ballMult = { poke_ball: 1, great_ball: 1.5, ultra_ball: 2, master_ball: Infinity }[ball] ?? 1;
  if (ballMult === Infinity) return { caught: true, shakes: 4 };

  const base = POKEMON[target.species];
  const catchRate = base?.catchRate ?? 45;

  let statusBonus = 0;
  if (target.status === 'sleep' || target.status === 'freeze') statusBonus = 10;
  else if (target.status === 'paralysis' || target.status === 'burn' || target.status === 'poison') statusBonus = 5;

  const effectiveCatchRate = Math.min(255, catchRate + statusBonus);

  const f = Math.max(0, Math.min(255,
    Math.floor((3 * target.maxHp - 2 * target.currentHp) * effectiveCatchRate * ballMult / (3 * target.maxHp))
  ));

  if (f >= 255) return { caught: true, shakes: 4 };

  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    const r = roll(256) - 1;  // roll(n) returns 1..n, so -1 gives 0..255
    if (r > f) break;
    shakes++;
  }
  return { caught: shakes === 4, shakes };
}

// ── initial state ─────────────────────────────────────────────────────────────
const STARTERS = {
  bulbasaur:  { species:'bulbasaur',  name:'BULBASAUR',  type:'Grass/Poison', desc:'A strange seed was planted on its back at birth.' },
  charmander: { species:'charmander', name:'CHARMANDER', type:'Fire',          desc:'The flame at the tip of its tail makes a sound as it burns.' },
  squirtle:   { species:'squirtle',   name:'SQUIRTLE',   type:'Water',         desc:'After birth, its back swells and hardens into a shell.' },
};

// newGame(seed?) — pass an integer seed for a deterministic run (#33).
// If omitted, a random seed is chosen and stored so the run can be replayed.
function newGame(seed) {
  const rngSeed = (seed !== undefined && seed !== null)
    ? (seed >>> 0)
    : Math.floor(Math.random() * 0x7FFFFFFF);
  return {
    rngSeed,
    rngCounter: 0,
    screen: 'starter_select',
    areaId: 'pallet_town',
    player: {
      x: 8, y: 9,    // standing in front of Oak's table
      party: [],
      bag: {
        poke_ball: 5,    great_ball: 0,  ultra_ball: 0,  master_ball: 0,
        potion: 5,       super_potion: 0,
        antidote: 0,     paralyze_heal: 0, full_heal: 0,
        // legacy key kept for save-state compat
        pokeball: 0,
        // evolution stones
        fire_stone: 0, water_stone: 0, thunder_stone: 0, leaf_stone: 0, moon_stone: 0,
      },
      // #19: canonical ball inventory (mirrors bag ball keys for catch mechanic)
      items: { poke_ball: 5, great_ball: 0, ultra_ball: 0, master_ball: 0 },
      money: 3000,
      badges: 0,
      steps: 0,
      flags: {},
      pc: [],   // PC box storage — up to 240 Pokémon (Gen I: 8 boxes × 30)
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

  // ── Set up deterministic RNG for this action (#33) ──────────────────────
  // Each action gets a fresh mulberry32 seeded from (gameSeed XOR counter*phi).
  // Same seed + same action sequence → same results. Enables replay verification:
  //   const s = newGame(seed); for (const a of actionLog) processAction(s, a);
  if (state.rngSeed !== undefined) {
    state.rngCounter = (state.rngCounter || 0) + 1;
    // Knuth multiplicative hash to spread consecutive counters across seed space
    const actionSeed = (state.rngSeed ^ Math.imul(state.rngCounter, 0x9e3779b9)) >>> 0;
    _rng = mulberry32Rng(actionSeed);
  } else {
    _rng = null;  // legacy states without a seed fall back to Math.random()
  }

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

    if (type === 'mart_view') {
      return martView(state);
    }

    if (type === 'mart_buy') {
      return martBuy(state, action);
    }

    if (type === 'pc_view') {
      const pc = state.player.pc || [];
      if (!pc.length) {
        state.message = 'The PC is empty.';
      } else {
        const list = pc.map((p, i) => `[${i}] ${p.name} Lv.${p.level} HP:${p.currentHp}/${p.maxHp}`).join('\n');
        state.message = `PC Storage:\n${list}`;
      }
      return state;
    }

    if (type === 'pc_withdraw') {
      const pc = state.player.pc || [];
      const idx = action.index ?? 0;
      if (idx < 0 || idx >= pc.length) {
        state.message = 'No Pokémon at that PC slot.';
        return state;
      }
      if (state.player.party.length >= 6) {
        state.message = 'Your party is full! Deposit a Pokémon first.';
        return state;
      }
      const pokemon = pc[idx];
      state.player.pc = pc.filter((_, i) => i !== idx);
      state.player.party.push(pokemon);
      state.message = `${pokemon.name} was withdrawn from the PC.`;
      return state;
    }

    if (type === 'pc_deposit') {
      const pIdx = action.partyIndex ?? action.party_index ?? 0;
      if (pIdx < 0 || pIdx >= state.player.party.length) {
        state.message = 'No Pokémon at that party slot.';
        return state;
      }
      if (state.player.party.length <= 1) {
        state.message = "Can't deposit your last Pokémon!";
        return state;
      }
      if ((state.player.pc || []).length >= 240) {
        state.message = 'PC storage is full!';
        return state;
      }
      const pokemon = state.player.party[pIdx];
      state.player.party = state.player.party.filter((_, i) => i !== pIdx);
      state.player.pc = [...(state.player.pc || []), pokemon];
      state.message = `${pokemon.name} was deposited into the PC.`;
      return state;
    }

    state.message = `Unknown overworld action: ${type}. Use: move, talk, use_item, mart_view, mart_buy, pc_view, pc_withdraw, pc_deposit`;
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
    // #9: remember this Pokécenter as the blackout respawn point
    state.player.lastCenter = { areaId: state.areaId, x: state.player.x, y: state.player.y };
    // Heal all party
    for (const p of state.player.party) {
      p.currentHp = p.maxHp;
      p.status = null;
      p.statusTurns = 0;
      p.confused = false;
      p.confusedTurns = 0;
      p.flinched = false;
      p.statStages = { atk:0, def:0, spd:0, spc:0, acc:0 };
      // Restore PP
      for (const mv of p.moves) p.pp[mv] = MOVES[mv]?.pp ?? 20;
    }
    state.message = "NURSE JOY: Welcome to the POKéMON CENTER! We've restored your POKéMON to full health. We hope to see you again!";
    return state;
  }
  if (destId === 'poke_mart') {
    // The mart tier is resolved from the city the player is in
    const tier = getMartTierForArea(state.areaId);
    if (tier) {
      const catalog = MART_CATALOG[tier];
      const lines = catalog.map(e => `${ITEM_NAMES[e.item] || e.item} ₽${e.price}`).join(', ');
      state.message = `CLERK: Welcome to the POKé MART! We have: ${lines}. Use mart_buy to purchase. You have ₽${state.player.money}.`;
    } else {
      state.message = "CLERK: Welcome to the POKé MART! Use mart_view to see what's available.";
    }
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
  const { item, target_index: targetIndex = 0 } = action;
  const target = state.player.party[targetIndex];
  if (!target) { state.message = 'No Pokémon at that party slot.'; return state; }

  const bag = state.player.bag;
  const itemName = ITEM_NAMES[item] || item;

  if (item === 'potion' || item === 'super_potion') {
    const heal = item === 'potion' ? 20 : 50;
    if (!(bag[item] > 0)) { state.message = `You have no ${itemName}s.`; return state; }
    if (target.currentHp <= 0) { state.message = `${target.name} has fainted!`; return state; }
    if (target.currentHp >= target.maxHp) { state.message = `${target.name}'s HP is already full!`; return state; }
    const healed = Math.min(heal, target.maxHp - target.currentHp);
    target.currentHp += healed;
    bag[item]--;
    state.message = `Used ${itemName} on ${target.name}. +${healed} HP. (${target.currentHp}/${target.maxHp})`;

  } else if (item === 'antidote') {
    if (!(bag.antidote > 0)) { state.message = 'You have no Antidotes.'; return state; }
    if (target.status !== 'poison') { state.message = `${target.name} is not poisoned.`; return state; }
    target.status = null;
    bag.antidote--;
    state.message = `Used Antidote on ${target.name}. ${target.name} is cured of poison!`;

  } else if (item === 'paralyze_heal') {
    if (!(bag.paralyze_heal > 0)) { state.message = 'You have no Parlyz Heals.'; return state; }
    if (target.status !== 'paralysis') { state.message = `${target.name} is not paralyzed.`; return state; }
    target.status = null;
    bag.paralyze_heal--;
    state.message = `Used Parlyz Heal on ${target.name}. ${target.name} is cured of paralysis!`;

  } else if (item === 'full_heal') {
    if (!(bag.full_heal > 0)) { state.message = 'You have no Full Heals.'; return state; }
    if (!target.status && !target.confused) { state.message = `${target.name} has no status condition.`; return state; }
    const cured = target.status || (target.confused ? 'confusion' : '');
    target.status = null;
    target.statusTurns = 0;
    target.confused = false;
    target.confusedTurns = 0;
    bag.full_heal--;
    state.message = `Used Full Heal on ${target.name}. Cured ${cured}!`;

  } else {
    // Stone evolution items
    const STONE_MAP = {
      fire_stone:    'fire_stone',
      water_stone:   'water_stone',
      thunder_stone: 'thunder_stone',
      leaf_stone:    'leaf_stone',
      moon_stone:    'moon_stone',
    };

    if (STONE_MAP[item]) {
      const stone = item;
      const stoneTarget = state.player.party[targetIndex ?? 0];
      if (!stoneTarget) return { ...state, message: 'No Pokémon at that party slot.' };
      const count = state.player.bag?.[stone] ?? state.player.items?.[stone] ?? 0;
      if (count < 1) return { ...state, message: `No ${stone.replace(/_/g, ' ')} left!` };

      const base = POKEMON[stoneTarget.species];
      const evo = base?.evolvesTo;
      const candidates = Array.isArray(evo) ? evo : evo ? [evo] : [];
      const match = candidates.find(c => c.stone === stone);
      if (!match) return { ...state, message: `${stoneTarget.name} can't evolve with that stone.` };

      // Deduct stone
      if (state.player.bag?.[stone] !== undefined) state.player.bag[stone]--;
      else if (state.player.items?.[stone] !== undefined) state.player.items[stone]--;

      const msgs = [];
      doEvolve(stoneTarget, match.species, msgs);
      return { ...state, message: msgs.join(' ') };
    }

    state.message = `Can't use ${itemName} here. Try: potion, super_potion, antidote, paralyze_heal, full_heal, or an evolution stone.`;
  }
  return state;
}

// ── Mart actions (#20 #21) ────────────────────────────────────────────────────
function martView(state) {
  const tier = getMartTierForArea(state.areaId);
  if (!tier) {
    state.message = "There's no Poké Mart here. Travel to Viridian City or Pewter City.";
    return state;
  }
  const catalog = MART_CATALOG[tier];
  const lines = catalog.map(e => `${ITEM_NAMES[e.item] || e.item}: ₽${e.price}`).join('\n');
  state.message = `CLERK: Here's what we stock:\n${lines}\nYou have ₽${state.player.money}. Use mart_buy to purchase.`;
  return state;
}

function martBuy(state, action) {
  const tier = getMartTierForArea(state.areaId);
  if (!tier) {
    state.message = "There's no Poké Mart here. Travel to Viridian City or Pewter City.";
    return state;
  }
  const { item, quantity = 1 } = action;
  if (!item) { state.message = 'Specify an item to buy. Use mart_view to see the catalog.'; return state; }
  const qty = Math.max(1, Math.floor(quantity));

  const catalog = MART_CATALOG[tier];
  const entry = catalog.find(e => e.item === item);
  if (!entry) {
    const avail = catalog.map(e => e.item).join(', ');
    state.message = `CLERK: Sorry, we don't carry ${item}. We stock: ${avail}.`;
    return state;
  }

  const total = entry.price * qty;
  if (state.player.money < total) {
    state.message = `CLERK: That costs ₽${total} but you only have ₽${state.player.money}. You need ₽${total - state.player.money} more.`;
    return state;
  }

  state.player.money -= total;
  state.player.bag[item] = (state.player.bag[item] || 0) + qty;
  const displayName = ITEM_NAMES[item] || item;
  state.message = `CLERK: Bought ${qty}× ${displayName} for ₽${total}. You have ₽${state.player.money} remaining.`;
  return state;
}

function processBattleAction(state, action, log) {
  const battle = state.battle;
  const msgs = [];
  const { type } = action;

  // Live references — enemy can change mid-turn when trainer sends out next pokemon
  const getActive = () => state.player.party[battle.playerPartyIndex];
  const getEnemy  = () => battle.enemy;

  // #12: Boulder Badge → +12.5% ATK on player's physical moves
  const playerBadgeBoost = state.player.flags?.badge_boulder_badge ? 1.125 : 1;

  // Pick an enemy move with PP remaining using type-aware scoring (#30)
  function selectEnemyMove() {
    const en = getEnemy();
    const active = getActive();

    // Collect moves with PP remaining (fall back to legacy random if no PP tracking)
    if (!en.pp) return enemyMove(en);
    const moves = en.moves.filter(mv => (en.pp[mv] ?? 1) > 0);
    if (!moves.length) return 'struggle';

    // Resolve defender types (array of lowercase strings)
    const playerTypes = POKEMON[active.species]?.type || ['normal'];

    // Resolve attacker types for STAB
    const enemyTypes = POKEMON[en.species]?.type || ['normal'];

    // Score each available move
    const scores = moves.map(mvName => {
      const mv = MOVES[mvName];
      if (!mv || mv.cat === 'status' || !mv.power) {
        // Status moves: give a modest flat score — useful if nothing else works,
        // but deprioritised vs damaging moves (trainer AI is aggressive).
        // Note: if ALL of the enemy's damaging moves score 0x effectiveness here,
        // a future improvement could trigger a Pokemon switch instead.
        return { mv: mvName, score: 20 };
      }

      // Base score from move power
      let score = mv.power;

      // Type effectiveness vs player's active Pokemon
      const eff = getEffectiveness(mv.type, playerTypes);
      score *= eff;

      // STAB bonus (Same-Type Attack Bonus)
      if (enemyTypes.includes(mv.type)) score *= 1.5;

      // KO weight: if the move could finish the player's active Pokemon, heavily prefer it
      if (score >= active.currentHp) score *= 2;

      return { mv: mvName, score };
    });

    // Sort descending by score
    scores.sort((a, b) => b.score - a.score);

    // 70% pick the best move; 30% weighted-random among top 3 to keep AI beatable
    const r = roll(10);
    if (r <= 7 || scores.length === 1) return scores[0].mv;

    const pool = scores.slice(0, Math.min(3, scores.length));
    const totalScore = pool.reduce((s, x) => s + x.score, 0);
    // Fall back to best move if all scores are zero (e.g. full immunity)
    if (totalScore <= 0) return scores[0].mv;
    let rnd = roll(Math.ceil(totalScore)) - 1;
    for (const entry of pool) {
      rnd -= entry.score;
      if (rnd <= 0) return entry.mv;
    }
    return pool[0].mv;
  }

  // Core attack function used by player and enemy
  function doAttack(attacker, mvName, defender, isPlayer) {
    if (!state.battle) return;            // battle already ended (whirlwind etc.)
    if (!checkCanAct(attacker, msgs)) return;  // paralysis / sleep / freeze / flinch / confusion

    // #15: PP deduction — redirect to Struggle if this move has 0 PP
    if (mvName !== 'struggle') {
      if (!attacker.pp) attacker.pp = {};
      if ((attacker.pp[mvName] ?? 1) <= 0) {
        mvName = 'struggle';
      } else {
        attacker.pp[mvName]--;
      }
    }

    // #8: Whirlwind — ends wild battles; fails vs trainers
    if (mvName === 'whirlwind') {
      if (!battle.isTrainer) {
        msgs.push(`${attacker.name} used WHIRLWIND! The wild ${defender.name} fled!`);
        state.screen = 'overworld'; state.battle = null;
      } else {
        msgs.push(`${attacker.name} used WHIRLWIND! But it failed against a trainer!`);
      }
      return;
    }

    // #22: Bide — set charging state; actual release handled in battle_move preamble
    if (mvName === 'bide') {
      attacker.bideState = { turnsLeft: 1 + (roll(2) - 1), damageAccum: 0 };
      msgs.push(`${attacker.name} is biding its time!`);
      return;
    }

    // #15: Struggle — typeless 50-power physical, 50% recoil damage
    if (mvName === 'struggle') {
      const rand = (roll(39) + 217) / 255;
      const dmg = Math.max(1, Math.floor(
        (Math.floor(2 * attacker.level / 5 + 2) * attacker.atk * 50 / defender.def / 50 + 2) * rand
      ));
      const recoil = Math.max(1, Math.floor(dmg / 2));
      defender.currentHp = Math.max(0, defender.currentHp - dmg);
      attacker.currentHp = Math.max(0, attacker.currentHp - recoil);
      msgs.push(`${attacker.name} has no PP left and used STRUGGLE! (-${dmg} HP) Recoil: -${recoil} HP!`);
      return;
    }

    const mv = MOVES[mvName];
    if (!mv) { msgs.push('Unknown move!'); return; }

    // Accuracy check (100 acc moves always hit; otherwise roll)
    if ((mv.acc || 100) < 100 && roll(100) > mv.acc) {
      msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! But it missed!`);
      return;
    }

    if (mv.power > 0) {
      const opts = isPlayer ? { badgeBoost: playerBadgeBoost } : {};
      const { dmg, effectiveness, crit } = calcDamage(attacker, mvName, defender, opts);
      defender.currentHp = Math.max(0, defender.currentHp - dmg);
      const effMsg = effectiveness > 1 ? " It's super effective!"
                   : effectiveness < 1 && effectiveness > 0 ? " It's not very effective..."
                   : effectiveness === 0 ? " It has no effect!" : '';
      const critMsg = crit ? ' A critical hit!' : '';
      msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! (-${dmg} HP)${critMsg}${effMsg}`);
      msgs.push(...applyMoveEffect(mvName, defender, attacker));
    } else {
      msgs.push(`${attacker.name} used ${mvName.toUpperCase()}!`);
      msgs.push(...applyMoveEffect(mvName, defender, attacker));
    }
    // #23: Bind/Wrap — trap if move has bind effect and target not already bound
    if (mv?.effect?.bind && !defender.boundState) {
      defender.boundState = { turnsLeft: 2 + roll(3) };  // 2-4 turns
      msgs.push(`${defender.name} was bound!`);
    }
  }

  // Returns true if the battle ended (faint, whirlwind, etc.)
  function checkFaint() {
    if (!state.battle) return true;   // already ended
    const active = getActive();
    const enemy  = getEnemy();

    if (enemy.currentHp <= 0) {
      // #11: use per-species baseExp; #18: trainer battles give 1.5× EXP
      const baseExp = POKEMON[enemy.species]?.baseExp || 50;
      const exp = Math.floor((baseExp * enemy.level * (battle.isTrainer ? 1.5 : 1)) / 7);
      active.exp = (active.exp || 0) + exp;
      msgs.push(`${enemy.name} fainted! ${active.name} gained ${exp} EXP.`);
      tryLevelUp(active, msgs);

      // Trainer battle: send out next Pokémon
      if (battle.isTrainer && battle.trainerParty && battle.trainerParty.length > 0) {
        const next = battle.trainerParty.shift();
        battle.enemy = next;
        msgs.push(`${battle.trainerName} sent out ${next.name}!`);
        return true;   // end attack chain; next action will pick up the new enemy
      }

      // Wild fainted or trainer defeated
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
        state.screen = 'overworld'; state.battle = null;
        // #9: warp to last visited Pokécenter (default: Pallet)
        const center = state.player.lastCenter || { areaId: 'pallet_town', x: 8, y: 14 };
        state.areaId = center.areaId; state.player.x = center.x; state.player.y = center.y;
        // Full heal (Gen I: blacking out sends you to a Pokécenter which heals fully)
        for (const p of state.player.party) {
          p.currentHp = p.maxHp;
          p.status = null;
          p.statusTurns = 0;
          p.confused = false;
          p.confusedTurns = 0;
          p.flinched = false;
          p.bideState = null;
          p.boundState = null;
          p.statStages = { atk:0, def:0, spd:0, spc:0, acc:0 };
          if (p.pp) for (const mv of (p.moves || [])) p.pp[mv] = MOVES[mv]?.pp ?? 20;
        }
        state.player.money = Math.max(0, state.player.money - 50);
        msgs.push("You were taken to a POKéMON CENTER.");
      }
      return true;
    }
    return false;
  }

  // ── BATTLE MOVE ─────────────────────────────────────────────────────────
  if (type === 'battle_move') {
    const active = getActive();
    const enemy  = getEnemy();
    const moveName = active.moves[action.move_index ?? 0];
    if (!moveName) { state.message = 'Invalid move index (0-3).'; return state; }
    battle.turn++;

    // #22: Active Bide — overrides normal move; accumulates damage taken
    if (active.bideState) {
      const bide = active.bideState;
      const enemyMv = selectEnemyMove();
      if (bide.turnsLeft > 0) {
        bide.turnsLeft--;
        msgs.push(`${active.name} is biding its time!`);
        const hpBefore = active.currentHp;
        doAttack(getEnemy(), enemyMv, active, false);
        const dmgTaken = Math.max(0, hpBefore - getActive().currentHp);
        if (getActive().bideState) getActive().bideState.damageAccum += dmgTaken;
        checkFaint();
      } else {
        // Release — deal 2× accumulated damage, then enemy attacks
        const releaseDmg = Math.max(1, bide.damageAccum * 2);
        active.bideState = null;
        msgs.push(`${active.name} unleashed its stored energy! (${releaseDmg} HP to ${enemy.name}!)`);
        enemy.currentHp = Math.max(0, enemy.currentHp - releaseDmg);
        if (!checkFaint()) {
          doAttack(getEnemy(), enemyMv, getActive(), false);
          checkFaint();
        }
      }
      if (state.battle) {
        msgs.push(...applyStatusEnd(getActive()));
        msgs.push(...applyStatusEnd(getEnemy()));
        checkFaint();
      }
      state.message = msgs.filter(Boolean).join(' ');
      msgs.forEach(log);
      return state;
    }

    const mv       = MOVES[moveName];
    const enemyMv  = selectEnemyMove();
    const enemyMvD = MOVES[enemyMv];

    // #13: Priority moves (Quick Attack = +1) go first regardless of speed
    const playerPri = mv?.effect?.priority || 0;
    const enemyPri  = enemyMvD?.effect?.priority || 0;

    // #7: Speed ties → coin flip
    let playerFirst;
    if (playerPri !== enemyPri) {
      playerFirst = playerPri > enemyPri;
    } else if (active.spd !== enemy.spd) {
      playerFirst = active.spd > enemy.spd;
    } else {
      playerFirst = roll(2) === 1;   // coin flip on exact speed tie
    }

    if (playerFirst) {
      doAttack(active, moveName, enemy, true);
      if (state.battle && !checkFaint()) {
        doAttack(getEnemy(), enemyMv, getActive(), false);
        checkFaint();
      }
    } else {
      doAttack(enemy, enemyMv, active, false);
      if (state.battle && !checkFaint()) {
        doAttack(getActive(), moveName, getEnemy(), true);
        if (state.battle) checkFaint();
      }
    }

    // End-of-turn status damage (only if battle still active)
    if (state.battle) {
      msgs.push(...applyStatusEnd(getActive()));
      msgs.push(...applyStatusEnd(getEnemy()));
      // Check for status-damage KOs
      checkFaint();
    }

    state.message = msgs.filter(Boolean).join(' ');
    msgs.forEach(log);
    return state;
  }

  // ── RUN ─────────────────────────────────────────────────────────────────
  if (type === 'run') {
    const active = getActive();
    const enemy  = getEnemy();
    if (battle.isTrainer) {
      state.message = "Can't escape from a trainer battle!";
      return state;
    }
    const esc = Math.floor((active.spd * 32) / (enemy.spd || 1)) + 30;
    if (roll(256) < esc) {
      state.screen = 'overworld'; state.battle = null;
      state.message = 'Got away safely!'; log(state.message);
    } else {
      msgs.push("Can't escape!");
      doAttack(enemy, selectEnemyMove(), active, false);
      checkFaint();
      state.message = msgs.join(' '); msgs.forEach(log);
    }
    return state;
  }

  // ── THROW BALL ──────────────────────────────────────────────────────────
  if (type === 'throw_ball') {
    // #5 / #19: Block ball-throwing in trainer battles
    if (battle.isTrainer) {
      state.message = "Can't catch trainer's Pokémon!";
      return state;
    }
    const active = getActive();
    const enemy  = getEnemy();
    const ball = action.ball || 'poke_ball';
    if ((state.player.items?.[ball] ?? 0) < 1) {
      state.message = `No ${ball.replace(/_/g, ' ')} left!`;
      return state;
    }
    state.player.items[ball]--;

    // #19: Real Gen I catch formula
    const result = attemptCatch(ball, enemy);
    const shakeDesc = ['Oh no! It escaped!', '1 shake...', '2 shakes...', '3 shakes...', 'Gotcha!'];
    if (result.shakes > 0 && result.shakes < 4) {
      msgs.push(`The ball shook ${result.shakes} time(s)... ${enemy.name} broke free!`);
    }
    if (result.caught) {
      battle.outcome = 'caught';
      msgs.push(`${enemy.name} was caught!`);
      const caught = JSON.parse(JSON.stringify(enemy));
      if (state.player.party.length < 6) {
        state.player.party.push(caught);
        msgs.push(`${caught.name} was added to your party!`);
      } else if ((state.player.pc || []).length < 240) {
        state.player.pc = [...(state.player.pc || []), caught];
        msgs.push(`${caught.name} was sent to the PC!`);
      } else {
        msgs.push(`PC storage is full! ${caught.name} was released.`);
      }
      state.screen = 'overworld'; state.battle = null;
    } else {
      if (result.shakes === 0) msgs.push(`${enemy.name} broke free immediately!`);
      doAttack(enemy, selectEnemyMove(), active, false);
      checkFaint();
    }
    state.message = msgs.filter(Boolean).join(' '); msgs.forEach(log);
    return state;
  }

  // ── USE ITEM ─────────────────────────────────────────────────────────────
  if (type === 'use_item') {
    const active = getActive();
    const enemy  = getEnemy();
    const { item, target_index: targetIdx = battle.playerPartyIndex } = action;
    const target = state.player.party[targetIdx];
    if (!target) { state.message = 'No Pokémon at that slot.'; return state; }

    const bag = state.player.bag;
    const itemName = ITEM_NAMES[item] || item;
    let used = false;

    if ((item === 'potion' || item === 'super_potion') && bag[item] > 0) {
      const heal = item === 'potion' ? 20 : 50;
      if (target.currentHp > 0) {
        const healed = Math.min(heal, target.maxHp - target.currentHp);
        target.currentHp += healed;
        bag[item]--;
        msgs.push(`Used ${itemName} on ${target.name}. +${healed} HP.`);
        used = true;
      }
    } else if (item === 'antidote' && bag.antidote > 0 && target.status === 'poison') {
      target.status = null;
      bag.antidote--;
      msgs.push(`Used Antidote on ${target.name}. Cured poison!`);
      used = true;
    } else if (item === 'paralyze_heal' && bag.paralyze_heal > 0 && target.status === 'paralysis') {
      target.status = null;
      bag.paralyze_heal--;
      msgs.push(`Used Parlyz Heal on ${target.name}. Cured paralysis!`);
      used = true;
    } else if (item === 'full_heal' && bag.full_heal > 0 && (target.status || target.confused)) {
      const cured = target.status || 'confusion';
      target.status = null; target.statusTurns = 0;
      target.confused = false; target.confusedTurns = 0;
      bag.full_heal--;
      msgs.push(`Used Full Heal on ${target.name}. Cured ${cured}!`);
      used = true;
    }

    if (used) {
      doAttack(enemy, selectEnemyMove(), active, false);
      checkFaint();
      state.message = msgs.join(' '); msgs.forEach(log);
    } else {
      state.message = `Can't use ${itemName} right now. Check your bag and Pokémon status.`;
    }
    return state;
  }

  // ── SWITCH ────────────────────────────────────────────────────────────────
  if (type === 'switch') {
    const active = getActive();
    const enemy  = getEnemy();
    const next = state.player.party[action.party_index];
    if (!next) { state.message = 'Invalid party slot.'; return state; }
    if (next.currentHp <= 0) { state.message = `${next.name} has fainted!`; return state; }
    if (action.party_index === battle.playerPartyIndex) { state.message = 'Already in battle!'; return state; }
    msgs.push(`Come back, ${active.name}! Go, ${next.name}!`);
    battle.playerPartyIndex = action.party_index;
    doAttack(enemy, selectEnemyMove(), next, false);
    checkFaint();
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
    rng_seed: state.rngSeed,  // expose so drivers can record the seed for replay (#33)
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
      pc_count: (state.player.pc || []).length,
      party: state.player.party.map(p => {
        const gr = p.growthRate || 'medium_fast';
        const nextLvExp = p.level < 100 ? expForLevel(p.level + 1, gr) : null;
        return {
          name: p.name, species: p.species, level: p.level,
          hp: `${p.currentHp}/${p.maxHp}`, status: p.status,
          confused: p.confused || undefined,
          // #18: show EXP progress toward next level
          exp: nextLvExp !== null ? `${p.exp || 0}/${nextLvExp} (next lv)` : 'MAX',
          moves: p.moves,
        };
      }),
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
        confused: active.confused || undefined,
        biding: active.bideState ? `charging (${active.bideState.turnsLeft} turn(s) left)` : undefined,
        bound: active.boundState ? `bound (${active.boundState.turnsLeft} turn(s) left)` : undefined,
        // #15: show PP per move
        moves: active.moves.map((m,i) => ({
          index: i,
          name: m,
          ...(MOVES[m] || {}),
          pp: `${active.pp?.[m] ?? '?'}/${MOVES[m]?.pp ?? '?'}`,
        })),
      },
      enemy: {
        name: state.battle.enemy.name, species: state.battle.enemy.species,
        level: state.battle.enemy.level,
        hp: `${state.battle.enemy.currentHp}/${state.battle.enemy.maxHp}`,
        status: state.battle.enemy.status, type: state.battle.enemy.type,
        bound: state.battle.enemy.boundState ? `bound (${state.battle.enemy.boundState.turnsLeft} turn(s) left)` : undefined,
      },
      // #5: no throw_ball in trainer battles
      available_actions: isTrainer
        ? ['battle_move (move_index: 0-3)', 'use_item (item: potion|super_potion|antidote|paralyze_heal|full_heal, target_index: 0-5)', 'switch (party_index: 0-5)']
        : ['battle_move (move_index: 0-3)', 'run', 'throw_ball (ball: poke_ball|great_ball|ultra_ball|master_ball)', 'use_item (item: potion|super_potion|antidote|paralyze_heal|full_heal, target_index: 0-5)', 'switch (party_index: 0-5)'],
    };
  }
  if (state.screen === 'overworld') {
    view.available_actions = [
      'move (direction: up|down|left|right)',
      'talk',
      'use_item (item: potion|super_potion|antidote|paralyze_heal|full_heal, target_index: 0-5)',
      'mart_view',
      'mart_buy (item: ..., quantity: N)',
      'pc_view',
      'pc_withdraw (index: 0-N)',
      'pc_deposit (party_index: 0-5)',
    ];
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
