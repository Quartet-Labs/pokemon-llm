'use strict';
const { POKEMON, rollEncounter } = require('./data/pokemon');
const { MOVES, getEffectiveness } = require('./data/moves');
const { TMS, TM_COMPAT } = require('./data/tms.js');
const {
  AREAS, isWalkable, hasEncounter, getSurroundings,
  getAreaTile, getWarpAt, getSignAt, getNpcAt, T,
} = require('./data/areas');

// ── helpers ────────────────────────────────────────────────────────────────
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ── Poké Mart catalog (#20 #21) ───────────────────────────────────────────────
// Keys match area IDs that have marts; the clerk's `martTier` tag maps here.
// [F3] Authentic Gen I R/B stock per Bulbapedia mart pages
const MART_CATALOG = {
  viridian: [
    // Viridian: Poké Ball/Antidote/Parlyz Heal/Burn Heal (no Potion in R/B — Yellow-only)
    { item: 'poke_ball',     price: 200 },
    { item: 'antidote',      price: 100 },
    { item: 'paralyze_heal', price: 200 },
    { item: 'burn_heal',     price: 250 },
  ],
  pewter: [
    // Pewter: Poké Ball/Potion/Escape Rope/Antidote/Burn Heal/Awakening/Parlyz Heal
    { item: 'poke_ball',     price: 200 },
    { item: 'potion',        price: 300 },
    { item: 'escape_rope',   price: 550 },
    { item: 'antidote',      price: 100 },
    { item: 'burn_heal',     price: 250 },
    { item: 'awakening',     price: 250 },
    { item: 'paralyze_heal', price: 200 },
  ],
  celadon: [
    { item: 'fire_stone',    price: 2100 },
    { item: 'water_stone',   price: 2100 },
    { item: 'thunder_stone', price: 2100 },
    { item: 'leaf_stone',    price: 2100 },
    // [B10] Moon Stone is find-only in Gen I — never sold in marts
    { item: 'potion',        price: 300  },
    { item: 'super_potion',  price: 700  },
    { item: 'great_ball',    price: 600  },
    { item: 'ultra_ball',    price: 1200 },
    { item: 'tm15',          price: 7500 },  // Hyper Beam
    { item: 'tm24',          price: 5000 },  // Thunderbolt
    { item: 'tm25',          price: 5500 },  // Thunder
    { item: 'tm26',          price: 5000 },  // Earthquake
    { item: 'tm29',          price: 3500 },  // Psychic
    { item: 'tm38',          price: 5500 },  // Fire Blast
    { item: 'tm08',          price: 4000 },  // Body Slam
    { item: 'tm48',          price: 3000 },  // Rock Slide
  ],
};

// Friendly display names for items
const ITEM_NAMES = {
  poke_ball:     'Poké Ball',
  great_ball:    'Great Ball',
  ultra_ball:    'Ultra Ball',
  potion:        'Potion',
  super_potion:  'Super Potion',
  hyper_potion:  'Hyper Potion',
  max_potion:    'Max Potion',
  full_restore:  'Full Restore',
  revive:        'Revive',
  max_revive:    'Max Revive',
  rare_candy:    'Rare Candy',
  antidote:      'Antidote',
  paralyze_heal: 'Parlyz Heal',
  burn_heal:     'Burn Heal',
  awakening:     'Awakening',
  escape_rope:   'Escape Rope',
  full_heal:     'Full Heal',
  fire_stone:    'Fire Stone',
  water_stone:   'Water Stone',
  thunder_stone: 'Thunder Stone',
  leaf_stone:    'Leaf Stone',
  moon_stone:    'Moon Stone',
  // [C19] PP enhancement items
  pp_up:         'PP Up',
  pp_max:        'PP Max',
  // [A3] Vitamins
  hp_up:         'HP Up',
  protein:       'Protein',
  iron:          'Iron',
  carbos:        'Carbos',
  calcium:       'Calcium',
};

// [C8] Two-turn move definitions (charge message + invulnerability flag + optional charge buff)
// Invulnerable: target can't be hit except by Swift during the charging turn.
const TWO_TURN_MOVES = {
  'fly':        { msg: (n) => `${n} flew up high!`,              invulnerable: true  },
  'dig':        { msg: (n) => `${n} burrowed underground!`,      invulnerable: true  },
  'solar beam': { msg: (n) => `${n} absorbed light!`                                 },
  'skull bash': { msg: (n) => `${n} tucked in its head!`,        chargeBuff: { stat:'def', stages:1 } },
  'razor wind': { msg: (n) => `${n} made a whirlwind!`                               },
  'sky attack': { msg: (n) => `${n} glowed!`                                         },
};

// Resolve which mart tier is available for a given area, or null if none.
// [F3] poke_mart / pewter_mart interiors also resolve; Viridian gated by Oak's Parcel delivery.
function getMartTierForArea(areaId, state) {
  if (areaId === 'viridian_city' || areaId === 'poke_mart') {
    // Viridian mart is locked until the player has delivered Oak's Parcel (has_pokedex flag)
    if (state && !state.player.flags?.has_pokedex) return null;
    return 'viridian';
  }
  if (areaId === 'pewter_city' || areaId === 'pewter_mart') return 'pewter';
  if (areaId === 'celadon_city') return 'celadon';
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
    // [A2][A3] Recalculate all stats using DVs + stat EXP at new level
    recalcStats(pokemon);
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
          // [B5] 5th-move: queue on pokemon so driver can use forget_move
          pokemon.pendingMoves = pokemon.pendingMoves || [];
          if (!pokemon.pendingMoves.includes(mv)) {
            pokemon.pendingMoves.push(mv);
            msgs.push(`${pokemon.name} wants to learn ${mv.toUpperCase()}, but already knows 4 moves! Use forget_move with newMove: "${mv}" to replace a move.`);
          }
        }
      }
    }

    // [B4] Check for level-based evolution — queue instead of evolving mid-battle
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
      // [B4] Queue evolution to happen after battle, not mid-fight
      pokemon.pendingEvolution = candidate.species;
      msgs.push(`What? ${pokemon.name} is about to evolve! (evolution happens after battle)`);
      return true;
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

// [A3] Stat EXP bonus contribution: floor(sqrt(statExp) / 4), range 0-63 (or 64 at max 65535)
function statExpBonus(se) {
  if (!se || se <= 0) return 0;
  return Math.floor(Math.ceil(Math.sqrt(se)) / 4);
}

// [A3] Recalculate a Pokémon's stats from its species, level, DVs, and accumulated stat EXP
function recalcStats(pokemon) {
  const base = POKEMON[pokemon.species];
  if (!base) return;
  const lv = pokemon.level;
  const dvs = pokemon.dvs || { atk:0, def:0, spd:0, spc:0 };
  const hpDV = ((dvs.atk & 1) << 3) | ((dvs.def & 1) << 2) | ((dvs.spd & 1) << 1) | (dvs.spc & 1);
  const se = pokemon.statExp || { hp:0, atk:0, def:0, spd:0, spc:0 };
  const oldMaxHp = pokemon.maxHp;
  pokemon.maxHp = Math.floor(((base.hp + hpDV) * 2 + statExpBonus(se.hp)) * lv / 100) + lv + 10;
  pokemon.atk   = Math.floor(((base.atk + dvs.atk) * 2 + statExpBonus(se.atk)) * lv / 100) + 5;
  pokemon.def   = Math.floor(((base.def + dvs.def) * 2 + statExpBonus(se.def)) * lv / 100) + 5;
  pokemon.spd   = Math.floor(((base.spd + dvs.spd) * 2 + statExpBonus(se.spd)) * lv / 100) + 5;
  pokemon.spc   = Math.floor((((base.spc ?? base.atk) + dvs.spc) * 2 + statExpBonus(se.spc)) * lv / 100) + 5;
  // Adjust current HP proportionally to any HP change (don't let it go negative)
  if (oldMaxHp && pokemon.maxHp !== oldMaxHp) {
    pokemon.currentHp = Math.max(0, Math.min(pokemon.maxHp, pokemon.currentHp + (pokemon.maxHp - oldMaxHp)));
  }
}

// [B1] Gen I level-appropriate movesets: last 4 moves learned at or below `level`
function getMovesAtLevel(base, level) {
  const learnset = base.learnset;
  if (!learnset) return (base.moves || []).slice(0, 4);
  // Walk learnset in ascending level order; later entries overwrite earlier ones
  const learned = [];
  const levels = Object.keys(learnset).map(Number).sort((a, b) => a - b);
  for (const lv of levels) {
    if (lv <= level) {
      for (const mv of learnset[lv]) {
        const idx = learned.indexOf(mv);
        if (idx !== -1) learned.splice(idx, 1);  // remove old slot, re-add at end
        learned.push(mv);
      }
    }
  }
  // Fallback to static base.moves if learnset produced nothing (shouldn't happen)
  return learned.length ? learned.slice(-4) : (base.moves || []).slice(0, 4);
}

function makePokemon(speciesKey, level, opts = {}) {
  const base = POKEMON[speciesKey];
  if (!base) throw new Error(`Unknown species: ${speciesKey}`);
  // [A2] Gen I DVs: 0-15 per stat (randomly assigned unless caller supplies them)
  const dvs = opts.dvs ?? {
    atk: roll(16) - 1,
    def: roll(16) - 1,
    spd: roll(16) - 1,
    spc: roll(16) - 1,
  };
  // HP DV derived from lowest bit of each other DV
  const hpDV = ((dvs.atk & 1) << 3) | ((dvs.def & 1) << 2) | ((dvs.spd & 1) << 1) | (dvs.spc & 1);
  // [A3] Gen I stat formula with DVs + stat EXP: floor(((base+dv)*2+statExpBonus)*level/100) + 5
  const se = opts.statExp || { hp:0, atk:0, def:0, spd:0, spc:0 };
  const maxHp = Math.floor(((base.hp + hpDV) * 2 + statExpBonus(se.hp)) * level / 100) + level + 10;
  const moves = getMovesAtLevel(base, level);
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
    atk:  Math.floor(((base.atk + dvs.atk) * 2 + statExpBonus(se.atk)) * level / 100) + 5,
    def:  Math.floor(((base.def + dvs.def) * 2 + statExpBonus(se.def)) * level / 100) + 5,
    spd:  Math.floor(((base.spd + dvs.spd) * 2 + statExpBonus(se.spd)) * level / 100) + 5,
    // #17: Special stat for special moves (Gen I uses one Spc for both offence/defence)
    spc:  Math.floor((((base.spc ?? base.atk) + dvs.spc) * 2 + statExpBonus(se.spc)) * level / 100) + 5,
    dvs,        // [A2] store DVs on the Pokémon (used for breeding / display later)
    statExp: se, // [A3] accumulated stat EXP (EVs), capped at 65535 per stat
    moves,
    pp,                    // #15: PP tracking
    status: null,
    statusTurns: 0,        // sleep turns remaining
    confused: false,       // #16: confusion (separate from primary status)
    confusedTurns: 0,
    flinched: false,       // #16: per-turn flinch flag
    statStages: { atk:0, def:0, spd:0, spc:0, acc:0, eva: 0 },
    // #18: cumulative EXP; initialise to the amount for current level so level-up thresholds are correct
    growthRate: base.growthRate || 'medium_fast',
    exp: expForLevel(level, base.growthRate || 'medium_fast'),
    // [B6] Nickname / OT / ID
    nickname: null,        // null means use species name; set by nickname_pokemon action
    ot: null,              // original trainer name (set on capture)
    otId: null,            // original trainer ID (5-digit random)
    // #22: Bide multi-turn state
    bideState: null,       // { turnsLeft, damageAccum } while charging
    // #23: Bind/Wrap multi-turn state
    boundState: null,      // { turnsLeft, dmgPerTurn } while trapped
    trappingState: null,   // [A8] { move, turnsLeft } while user is locked into a trapping move
    // [C8] Two-turn move charging state (Fly/Dig/Solar Beam/Skull Bash/Razor Wind/Sky Attack)
    chargingMove: null,   // null | { move: string, invulnerable: bool }
    // [C9] Hyper Beam recharge — must skip next turn after use
    recharging: false,
    // [A12] Toxic counter — escalates N/16 each turn (resets between battles)
    toxicCounter: 0,
    // [A13] Leech Seed — volatile condition (does not block real statuses)
    leechSeeded: false,
    // [C11] Thrash/Petal Dance lock-in state
    lockinState: null,     // { move: string, turnsLeft: int } while rampaging
    // [C7] Signature move cluster volatile states
    mistTurns: 0,          // Mist: blocks stat drops for N turns
    reflectTurns: 0,       // Reflect: halves physical damage for N turns
    lightScreenTurns: 0,   // Light Screen: halves special damage for N turns
    focusEnergy: false,    // Focus Energy: Gen I bug — quartered (not quadrupled) crit rate
    substituteHp: 0,       // Substitute proxy HP (0 = no sub)
    lastDamageTaken: 0,    // Counter: tracks last physical damage received
    lastPhysicalMoveType: null, // Counter: type of last physical move (must be Normal/Fighting)
    glitchInvulnerable: false, // [H9] Fly/Dig glitch: invulnerability persists if release fails
    disabledMove: null,    // Disable: which move is disabled
    disabledTurns: 0,      // Disable: turns remaining
    lastMoveUsed: null,    // Mirror Move: opponent's last move
  };
}

function stageMultiplier(stages) {
  const TABLE = [0.25,0.28,0.33,0.40,0.50,0.66,1.0,1.5,2.0,2.5,3.0,3.5,4.0];
  return TABLE[clamp(stages + 6, 0, 12)];
}

// [A14] Reset volatile battle state — called at battle end so stat changes don't bleed across battles
function resetVolatileState(pokemon) {
  pokemon.statStages = { atk:0, def:0, spd:0, spc:0, acc:0, eva: 0 };
  pokemon.confused = false; pokemon.confusedTurns = 0;
  pokemon.flinched = false;
  pokemon.boundState = null;
  pokemon.trappingState = null;
  pokemon.bideState = null;
  pokemon.recharging = false;
  pokemon.toxicCounter = 0;
  pokemon.leechSeeded = false;
  pokemon.lockinState = null;
  pokemon.chargingMove = null;  // [C8] clear two-turn charge state between battles
  // [C7] Clear signature move volatile states
  pokemon.mistTurns = 0;
  pokemon.reflectTurns = 0;
  pokemon.lightScreenTurns = 0;
  pokemon.focusEnergy = false;
  pokemon.substituteHp = 0;
  pokemon.lastDamageTaken = 0;
  pokemon.lastPhysicalMoveType = null;
  pokemon.glitchInvulnerable = false;
  pokemon.disabledMove = null;
  pokemon.disabledTurns = 0;
  pokemon.lastMoveUsed = null;
}

// [E6] Heal all party members to full (Nurse Joy / center heal)
function healParty(state) {
  for (const p of state.player.party) {
    p.currentHp = p.maxHp;
    p.status = null;
    p.statusTurns = 0;
    p.confused = false;
    p.confusedTurns = 0;
    p.flinched = false;
    p.statStages = { atk:0, def:0, spd:0, spc:0, acc:0, eva: 0 };
    for (const mv of p.moves) p.pp[mv] = MOVES[mv]?.pp ?? 20;
  }
}

// #14 + #17: damage with crits, special stat, burn penalty, badge boost
function calcDamage(attacker, moveName, defender, opts = {}) {
  const mv = MOVES[moveName];
  if (!mv || mv.power === 0) return { dmg:0, effectiveness:1, crit:false };

  const isSpecial = mv.cat === 'special';

  // #14: Critical hit — Gen I: threshold = floor(baseSpd * critMult / 2) out of 256
  // High-crit moves (Slash, Razor Leaf) have crit_rate: 8 → 8× threshold
  // #55: Gen I uses BASE Speed (not stat-modified Speed) for crit calculation
  const critMult = mv.effect?.crit_rate || 1;
  const baseSpd = POKEMON[attacker.species]?.spd ?? attacker.spd;
  let critThreshold = Math.min(255, Math.floor(baseSpd * critMult / 2));
  // [H2] Gen I Focus Energy bug: flag is supposed to ×4 crits but actually ÷4 due to bit-shift error
  if (attacker.focusEnergy) critThreshold = Math.max(1, Math.floor(critThreshold / 4));
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

  // [H3] Gen I badge-boost stacking: badge boost is baked into the stored stat, then re-applied
  // after stat-stage changes, effectively double-applying when stages are non-neutral.
  const atkBaseBoost = badgeBoost !== 1 ? Math.floor(atkBase * badgeBoost) : atkBase;
  const atkStat = atkBaseBoost * atkStage * (badgeBoost !== 1 && atkStage !== 1 ? badgeBoost : 1) * burnPenalty;
  const defStat = defBase * defStage;

  // #C3: Explosion/Self-Destruct halve the defender's effective Defense (Gen I mechanic)
  const effectiveDefStat = (moveName === 'explosion' || moveName === 'self destruct')
    ? Math.max(1, Math.floor(defStat / 2))
    : defStat;

  const eff = getEffectiveness(mv.type, defender.type);
  const stab = attacker.type.includes(mv.type) ? 1.5 : 1;
  // #3: random factor must be 217..255 inclusive; roll(39) gives 1..39 so +216 = 217..255
  const randomFactor = 216 + roll(39);
  const rand = randomFactor / 255;

  // [A7] Gen I crits double the level coefficient (4L/5+2 instead of 2L/5+2)
  const levelCoef = isCrit
    ? Math.floor(4 * attacker.level / 5 + 2)
    : Math.floor(2 * attacker.level / 5 + 2);
  const raw = Math.floor(
    Math.floor(levelCoef * atkStat * mv.power / effectiveDefStat / 50 + 2)
    * stab * eff * rand
  );

  // [C7] Reflect / Light Screen — halve incoming physical / special damage (crits bypass in Gen I)
  let screenMult = 1;
  if (!isCrit) {
    if (!isSpecial && (defender.reflectTurns ?? 0) > 0) screenMult = 0.5;
    if (isSpecial  && (defender.lightScreenTurns ?? 0) > 0) screenMult = 0.5;
  }
  return { dmg: Math.max(1, Math.floor(raw * screenMult)), effectiveness: eff, crit: isCrit };
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

  // #57: Freeze — Gen I: never thaws naturally; only fire moves thaw (handled in doAttack)
  if (pokemon.status === 'freeze') {
    msgs.push(`${pokemon.name} is frozen solid!`);
    return false;
  }

  // [C9] Recharge — must skip a turn after Hyper Beam etc.
  if (pokemon.recharging) {
    pokemon.recharging = false;  // clears after one lost turn
    msgs.push(`${pokemon.name} must recharge!`);
    return false;
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
function applyStatusEnd(pokemon, opponent) {
  const msgs = [];
  if (!pokemon || pokemon.currentHp <= 0) return msgs;
  if (pokemon.status === 'burn' || pokemon.status === 'poison') {
    const dmg = Math.max(1, Math.floor(pokemon.maxHp / 16));
    pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
    const label = pokemon.status === 'burn' ? 'its burn' : 'poison';
    msgs.push(`${pokemon.name} is hurt by ${label}! (-${dmg} HP)`);
  }
  // [A13] Leech Seed drain + heal opponent
  // [H5] Gen I quirk: if also Toxic-poisoned, Leech Seed shares the escalating counter.
  // Toxic counter is incremented once here, then both Leech Seed and Toxic use the same N.
  if (pokemon.status === 'toxic') {
    pokemon.toxicCounter = (pokemon.toxicCounter || 0) + 1;
  }
  if (pokemon.leechSeeded && pokemon.currentHp > 0) {
    const lsN = (pokemon.status === 'toxic') ? pokemon.toxicCounter : 1;
    const drainDmg = Math.max(1, Math.floor(pokemon.maxHp * lsN / 16));
    pokemon.currentHp = Math.max(0, pokemon.currentHp - drainDmg);
    msgs.push(`${pokemon.name} had its energy drained by Leech Seed! (-${drainDmg} HP)`);
    if (opponent && opponent.currentHp > 0) {
      const heal = Math.min(drainDmg, opponent.maxHp - opponent.currentHp);
      if (heal > 0) {
        opponent.currentHp += heal;
        msgs.push(`${opponent.name} absorbed ${heal} HP!`);
      }
    }
  }
  // #23 [A8] Bind/Wrap — deal repeated initial-hit damage per turn, count down, free when done
  if (pokemon.boundState) {
    pokemon.boundState.turnsLeft--;
    if (pokemon.boundState.turnsLeft <= 0) {
      pokemon.boundState = null;
      msgs.push(`${pokemon.name} was freed from the bind!`);
    } else {
      // [A8] Use stored initial damage (not 1/16 chip)
      const dmg = Math.max(1, pokemon.boundState.dmgPerTurn ?? Math.floor(pokemon.maxHp / 16));
      pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
      msgs.push(`${pokemon.name} is hurt by the bind! (-${dmg} HP)`);
    }
  }
  // [A8] Trapping lock-in — decrement on the ATTACKER's side
  if (pokemon.trappingState) {
    pokemon.trappingState.turnsLeft--;
    if (pokemon.trappingState.turnsLeft <= 0) {
      pokemon.trappingState = null;
    }
  }
  // [A12] Toxic — escalating N/16 damage per turn; counter already incremented above if leechSeeded
  if (pokemon.status === 'toxic') {
    if (!pokemon.leechSeeded) pokemon.toxicCounter = (pokemon.toxicCounter || 0) + 1;  // [H5] shared counter
    const dmg = Math.max(1, Math.floor(pokemon.maxHp * pokemon.toxicCounter / 16));
    pokemon.currentHp = Math.max(0, pokemon.currentHp - dmg);
    msgs.push(`${pokemon.name} is badly poisoned! (-${dmg} HP)`);
  }
  // [A11] Flinch — always clear at end of turn (safe to double-clear)
  pokemon.flinched = false;

  // [C7] Decrement volatile screen / disable turns
  if (pokemon.mistTurns > 0) {
    pokemon.mistTurns--;
    if (pokemon.mistTurns === 0) msgs.push(`${pokemon.name}'s MIST faded!`);
  }
  if (pokemon.reflectTurns > 0) {
    pokemon.reflectTurns--;
    if (pokemon.reflectTurns === 0) msgs.push(`${pokemon.name}'s REFLECT faded!`);
  }
  if (pokemon.lightScreenTurns > 0) {
    pokemon.lightScreenTurns--;
    if (pokemon.lightScreenTurns === 0) msgs.push(`${pokemon.name}'s LIGHT SCREEN faded!`);
  }
  if (pokemon.disabledTurns > 0) {
    pokemon.disabledTurns--;
    if (pokemon.disabledTurns === 0) {
      msgs.push(`${pokemon.name}'s ${(pokemon.disabledMove || 'move').toUpperCase()} is no longer disabled!`);
      pokemon.disabledMove = null;
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
        target.confusedTurns = 1 + roll(4);  // 2-5 turns (Gen I)
        msgs.push(`${target.name} became confused!`);
      }
    } else if (e.status === 'toxic') {
      // [A12] Toxic — badly poisoned; only applies if target has no status
      if (!target.status) {
        target.status = 'toxic';
        target.toxicCounter = 0;  // starts at 0; incremented each turn in applyStatusEnd
        msgs.push(`${target.name} was badly poisoned!`);
      }
    } else if (e.status === 'leech_seed') {
      if (!target.leechSeeded) {
        target.leechSeeded = true;
        msgs.push(`${target.name} was seeded!`);
      } else {
        msgs.push(`${target.name} is already seeded!`);
      }
    } else if (!target.status) {
      target.status = e.status;
      if (e.status === 'sleep') {
        target.statusTurns = roll(7);  // 1-7 turns (Gen I)
        msgs.push(`${target.name} fell asleep!`);
      } else if (e.status === 'freeze') {
        target.statusTurns = 0;
        msgs.push(`${target.name} was frozen solid!`);
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
      // [C7] Mist — block opponent-inflicted stat DROPS (not self-buffs, not status)
      const isOpponentDrop = tgt === target && e.stages < 0 && (target.mistTurns ?? 0) > 0;
      if (isOpponentDrop) {
        msgs.push(`${target.name} is protected by MIST! Stat drop was blocked!`);
      } else {
        tgt.statStages[e.stat] = clamp((tgt.statStages[e.stat] || 0) + e.stages, -6, 6);
        msgs.push(`${tgt.name}'s ${e.stat.toUpperCase()} ${e.stages > 0 ? 'rose' : 'fell'}!`);
      }
    }
  }

  // [C6] Recover/Soft-Boiled/Milk Drink — heal fraction of max HP
  // [H6] Gen I quirk: fails if HP deficit ≡ 0 (mod 256) and not already full
  if (e.heal) {
    const missing = source.maxHp - source.currentHp;
    if (missing > 0 && missing % 256 === 0) {
      msgs.push(`But it failed! (HP deficit is a multiple of 256)`); // [H6] Gen I quirk
    } else {
      const healAmt = Math.floor(source.maxHp / e.heal);
      source.currentHp = Math.min(source.maxHp, source.currentHp + healAmt);
      msgs.push(`${source.name} restored ${healAmt} HP!`);
    }
  }

  // [C6] Rest — full heal + sleep 2 turns; clears confusion
  if (e.rest) {
    source.currentHp = source.maxHp;
    source.status = 'sleep';
    source.statusTurns = 2;   // wakes after 2 turns (Gen I)
    source.confused = false; source.confusedTurns = 0;
    msgs.push(`${source.name} went to sleep and is fully restored!`);
  }

  // [C7] Haze — reset all stat stages for both combatants
  if (e.haze) {
    const ZERO = { atk:0, def:0, spd:0, spc:0, acc:0, eva:0 };
    source.statStages = { ...ZERO };
    target.statStages = { ...ZERO };
    source.confused = false; target.confused = false;
    msgs.push(`${source.name} used HAZE! All stat changes were eliminated!`);
  }

  // [C7] Mist — protect from stat drops for 5 turns
  if (e.mist) {
    if (source.mistTurns > 0) {
      msgs.push(`But it failed! ${source.name} is already under MIST's protection.`);
    } else {
      source.mistTurns = 5;
      msgs.push(`${source.name} became shrouded in MIST!`);
    }
  }

  // [C7] Reflect — halve incoming physical damage for 5 turns
  if (e.reflect) {
    if (source.reflectTurns > 0) {
      msgs.push(`But it failed! ${source.name} already has REFLECT.`);
    } else {
      source.reflectTurns = 5;
      msgs.push(`${source.name} is protected by REFLECT!`);
    }
  }

  // [C7] Light Screen — halve incoming special damage for 5 turns
  if (e.light_screen) {
    if (source.lightScreenTurns > 0) {
      msgs.push(`But it failed! ${source.name} already has LIGHT SCREEN.`);
    } else {
      source.lightScreenTurns = 5;
      msgs.push(`${source.name} is protected by LIGHT SCREEN!`);
    }
  }

  // [C7] Focus Energy — Gen I bug: actually QUARTERED the crit rate instead of quadrupling
  if (e.sharpen) {
    source.focusEnergy = true;
    msgs.push(`${source.name} is getting pumped! (Gen I: crit rate reduced by bug)`);
  }

  // [C7] Disable — prevent target from using their last move (1-8 turns)
  if (e.disable) {
    const lastMv = target.lastMoveUsed;
    if (!lastMv || target.disabledMove) {
      msgs.push(`${source.name} used DISABLE! But it failed!`);
    } else {
      target.disabledMove = lastMv;
      target.disabledTurns = 1 + roll(8);  // 1-8 turns (Gen I range)
      msgs.push(`${target.name}'s ${lastMv.toUpperCase()} was disabled for ${target.disabledTurns} turns!`);
    }
  }

  // [C7/H7] Counter — deal 2× the last physical damage the user received
  // Gen I restriction: only counters Normal or Fighting type physical moves
  if (e.counter) {
    const lastType = source.lastPhysicalMoveType;
    const counterDmg = 2 * (source.lastDamageTaken || 0);
    const validType = lastType === 'normal' || lastType === 'fighting';
    if (counterDmg <= 0 || !validType) {
      msgs.push(`${source.name} used COUNTER! But it failed!`);
    } else {
      target.currentHp = Math.max(0, target.currentHp - counterDmg);
      msgs.push(`${source.name} used COUNTER! (-${counterDmg} HP)!`);
    }
  }

  // [C7] Metronome — randomly pick and execute any move from the master list
  if (e.metronome) {
    const allMoves = Object.keys(MOVES).filter(m => m !== 'metronome' && m !== 'struggle');
    const pickedName = allMoves[Math.floor(roll(allMoves.length) - 1)];
    msgs.push(`${source.name} used METRONOME! It used ${pickedName.toUpperCase()}!`);
    msgs.push(...applyMoveEffect(pickedName, target, source));
  }

  // [C7] Mirror Move — use whatever the target last used
  if (e.mirror) {
    const mirrorMv = target.lastMoveUsed;
    if (!mirrorMv || mirrorMv === 'mirror move') {
      msgs.push(`${source.name} used MIRROR MOVE! But it failed!`);
    } else {
      msgs.push(`${source.name} used MIRROR MOVE! It used ${mirrorMv.toUpperCase()}!`);
      msgs.push(...applyMoveEffect(mirrorMv, target, source));
    }
  }

  return msgs;
}

function enemyMove(enemy) {
  const rand = _rng ? _rng() : Math.random();
  return enemy.moves[Math.floor(rand * enemy.moves.length)];
}

// [A10] Wild Pokémon move selector — uniform random (Gen I behaviour)
function selectWildMove(enemy) {
  // [A8] Trapping lock-in: must keep using the trap move
  if (enemy.trappingState) return enemy.trappingState.move;
  const moves = (enemy.moves || []).filter(mv => (enemy.pp?.[mv] ?? 1) > 0);
  if (!moves.length) return 'struggle';
  return moves[roll(moves.length) - 1];
}

// ── #19: Gen I catch mechanics ────────────────────────────────────────────────
// Formula: f = floor((3*maxHP - 2*currentHP) * catchRate * ballMult / (3*maxHP)) + statusBonus
// [A1] Status bonus is added AFTER the HP/catchRate division (not before). Gen I quirk.
// Ball shakes 4 times: each shake passes if roll(256)-1 <= f. Caught iff all 4 pass.
function attemptCatch(ball, target) {
  const ballMult = { poke_ball: 1, great_ball: 1.5, ultra_ball: 2, master_ball: Infinity }[ball] ?? 1;
  if (ballMult === Infinity) return { caught: true, shakes: 4 };

  const base = POKEMON[target.species];
  const catchRate = base?.catchRate ?? 45;

  // [A1] Status bonus added AFTER HP calculation (Gen I authentic order)
  let statusBonus = 0;
  if (target.status === 'sleep' || target.status === 'freeze') statusBonus = 10;
  else if (target.status === 'paralysis' || target.status === 'burn' || target.status === 'poison') statusBonus = 5;

  const f = Math.max(0, Math.min(255,
    Math.floor((3 * target.maxHp - 2 * target.currentHp) * catchRate * ballMult / (3 * target.maxHp))
    + statusBonus
  ));

  if (f >= 255) return { caught: true, shakes: 4 };

  // #54: Gen I shake check — 2-byte random vs sqrt-based threshold
  // Each shake passes if a 0..65535 uniform r < shakeThreshold
  const shakeThreshold = Math.floor(65536 / Math.pow(255 / Math.max(1, f), 0.25));

  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    // Combine two roll(256) calls to get a 0..65535 uniform random
    const r = (roll(256) - 1) * 256 + (roll(256) - 1);
    if (r >= shakeThreshold) break;
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
    areaId: 'oaks_lab',  // [D4] authentic start — player begins inside Oak's lab
    player: {
      x: 5, y: 7,    // [D4] standing near the starter Poké Balls
      facing: 'north',  // [E10] player's last move direction
      party: [],
      bag: {
        poke_ball: 5,    great_ball: 0,  ultra_ball: 0,  master_ball: 0,
        potion: 5,       super_potion: 0,  hyper_potion: 0, max_potion: 0, full_restore: 0,
        revive: 0,       max_revive: 0,    rare_candy: 0,
        antidote: 0,     paralyze_heal: 0, burn_heal: 0, awakening: 0,  full_heal: 0,
        // legacy key kept for save-state compat
        pokeball: 0,
        // evolution stones
        fire_stone: 0, water_stone: 0, thunder_stone: 0, leaf_stone: 0, moon_stone: 0,
        // [A3] vitamins (purchasable at Celadon Dept. Store; start with none)
        hp_up: 0, protein: 0, iron: 0, carbos: 0, calcium: 0,
      },
      // #19: canonical ball inventory (mirrors bag ball keys for catch mechanic)
      items: { poke_ball: 5, great_ball: 0, ultra_ball: 0, master_ball: 0 },
      money: 3000,
      badges: 0,
      steps: 0,
      flags: {},
      tms: {},  // e.g. { tm29: 1, tm15: 1 } — TMs the player owns
      pc: [],   // PC box storage — up to 240 Pokémon (Gen I: 8 boxes × 30)
    },
    battle: null,
    dialogue: null,
    npcState: {},      // { [areaId]: { [npcId]: { x, y, dir } } } — wander/spin overrides
    cuttedTrees: {},   // { [areaId]: ['x,y', ...] } — tiles cleared by CUT
    // [G1] Pokédex — keys are species names (e.g. 'bulbasaur'), values true
    pokedex: { seen: {}, caught: {} },
    // Oak's intro dialogue — verbatim from Gen I Red/Blue (Bulbapedia)
    message: "OAK: Hello there! Welcome to the world of POKéMON! My name is OAK! People call me the POKéMON PROF! This world is inhabited by creatures called POKéMON! For some people, POKéMON are pets. Others use them for fights. Myself… I study POKéMON as a profession. Now, let's choose your partner! Which POKéMON will you take?",
    log: [],
    turn: 0,
  };
}

// ── NPC position helper (accounts for wander/spin state overrides) ────────────
function getEffectiveNpcAt(area, x, y, state) {
  const overrides = state?.npcState?.[area.id] || {};
  for (const npc of (area.npcs || [])) {
    const pos = overrides[npc.id] || npc;
    if (pos.x === x && pos.y === y) return npc;
  }
  return null;
}

// ── Rival party helper ────────────────────────────────────────────────────────
function getRivalParty(state) {
  const starter = state.player.party[0]?.species || 'bulbasaur';
  // Rival picks the starter that beats yours
  const counterMap = { bulbasaur:'charmander', charmander:'squirtle', squirtle:'bulbasaur' };
  const rivalStarter = counterMap[starter] || 'charmander';
  return [
    { species: rivalStarter, level: 9 },
    { species: 'pidgey',     level: 9 },
  ];
}

// [D4] Resolve NPC dialogue, supporting flag-conditional branches.
// npc.flagDialogue is an array of branch objects:
//   { requireFlag, denyFlag, requireItem, requireCaught, lines }  — first matching branch wins
//   { default: true, lines }                                       — fallback
// Returns the resolved lines array, or null to fall through to npc.dialogue.
function resolveNpcDialogue(npc, player, state) {
  if (!Array.isArray(npc.flagDialogue)) return null;
  const caughtCount = state ? Object.keys(state.pokedex?.caught ?? {}).length : 0;
  for (const branch of npc.flagDialogue) {
    if (branch.default) return branch.lines;
    const flagOk    = !branch.requireFlag   || !!player.flags[branch.requireFlag];
    const denyOk    = !branch.denyFlag      || !player.flags[branch.denyFlag];
    const itemOk    = !branch.requireItem   || (player.bag[branch.requireItem] || 0) > 0;
    const caughtOk  = !branch.requireCaught || caughtCount >= branch.requireCaught;
    if (flagOk && denyOk && itemOk && caughtOk) return branch.lines;
  }
  return [];
}

// Returns a new state with rival battle triggered if entering route_22, or null.
function checkRivalEncounter(state) {
  if (state.areaId === 'route_22' && !state.player.flags['beat_rival_route22']) {
    const rivalParty = getRivalParty(state);
    if (rivalParty.length) {
      const [first, ...rest] = rivalParty.map(e => makePokemon(e.species, e.level));
      state.screen = 'battle';
      state.battle = {
        enemy: first, isTrainer: true,
        trainerName: 'RIVAL',
        trainerParty: rest, playerPartyIndex: 0,
        reward: 350, rewardFlag: 'beat_rival_route22',
        turn: 0,
      };
      state.message = `RIVAL: So, you want to challenge me? I've already caught 2 POKéMON! … Let's battle!`;
      return state;
    }
  }
  return null;
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
    if (state.pokedex) state.pokedex.seen[sp] = true;  // [G1] Pokédex: starter is seen
    state.screen = 'overworld';
    state.player.flags.chose_starter = sp;
    // [D4] Rival picks the counter-starter
    const counterMap = { bulbasaur:'charmander', charmander:'squirtle', squirtle:'bulbasaur' };
    const rivalSp = counterMap[sp] || 'charmander';
    const rivalName = POKEMON[rivalSp]?.name || rivalSp.toUpperCase();
    state.message = `OAK: So, you chose ${starter.name}! It's a fine choice! Take good care of it.\n\nGARY: Hmm! Then I'll take ${rivalName}! I won't lose to you!\n\nOAK: Now, head to VIRIDIAN CITY. Stop by the POKé MART and pick up the parcel being held for me — then come back here.`;
    log(`Received ${starter.name} from Prof. Oak!`);
    log(`GARY chose ${rivalName}!`);
    return state;
  }

  // ── DIALOGUE (advance conversation) ─────────────────────────────────────
  // Certain field actions work even mid-dialogue — they dismiss the dialogue and execute.
  const DIALOGUE_PASSTHROUGH = new Set(['heal','dig','teleport']);
  if (state.dialogue) {
    if (type !== 'talk' && type !== 'advance') {
      if (DIALOGUE_PASSTHROUGH.has(type)) {
        // Dismiss dialogue, fall through to the action handler below
        state.dialogue = null;
      } else {
        state.message = `[${state.dialogue.lines[state.dialogue.index]}]\n(Use {"type":"talk"} to advance dialogue)`;
        return state;
      }
    }
    if (!state.dialogue) {
      // Dialogue was dismissed — continue to overworld handler
    } else {
    const d = state.dialogue;
    const line = d.lines[d.index];
    // Process the current line's actions
    if (typeof line === 'object') {
      // Give item — optional giveIf flag condition
      // TMs/HMs go to player.tms (single-use count); everything else to player.bag
      if (line.give && (!line.giveIf || state.player.flags[line.giveIf])) {
        const giveItem = line.give;
        const giveQty  = line.qty || 1;
        if (giveItem.startsWith('tm') || giveItem.startsWith('hm')) {
          if (!state.player.tms) state.player.tms = {};
          state.player.tms[giveItem] = (state.player.tms[giveItem] || 0) + giveQty;
        } else {
          state.player.bag[giveItem] = (state.player.bag[giveItem] || 0) + giveQty;
        }
        state.player.flags[`got_${giveItem}_from_${d.npcId}`] = true;
        log(`Received ${giveQty} ${giveItem.replace(/_/g,' ').toUpperCase()}!`);
      }
      // [D4] Take item from bag (no "got" flag — just removes it)
      if (line.take) {
        state.player.bag[line.take] = Math.max(0, (state.player.bag[line.take] || 0) - 1);
        log(`Handed over ${line.take.replace(/_/g,' ').toUpperCase()}!`);
      }
      // [D4] Set a flag without giving/taking an item
      if (line.setFlag) {
        state.player.flags[line.setFlag] = true;
      }
    }
    d.index++;
    // [D4] Auto-skip consecutive action-only lines (take/setFlag with no give text)
    while (d.index < d.lines.length) {
      const next = d.lines[d.index];
      if (typeof next === 'string' || (typeof next === 'object' && next.give)) break;
      if (typeof next === 'object') {
        if (next.take)    state.player.bag[next.take] = Math.max(0, (state.player.bag[next.take] || 0) - 1);
        if (next.setFlag) state.player.flags[next.setFlag] = true;
      }
      d.index++;
    }
    if (d.index >= d.lines.length) {
      state.dialogue = null;
      state.message = '...';
    } else {
      const next = d.lines[d.index];
      state.message = typeof next === 'string' ? next : `(Received ${next.give?.replace(/_/g,' ')}!)`;
    }
    return state;
    } // closes else (dialogue advance path)
  }   // closes outer if (state.dialogue)

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
      // Helper: check requireFlag gate on a connection object
      const connBlocked = (conn) =>
        conn.requireFlag && !state.player.flags[conn.requireFlag];
      if (ny < 0) {
        const conn = area.connections?.north;
        if (conn) {
          if (connBlocked(conn)) { state.message = conn.blockMessage || "You can't go that way."; return state; }
          state.areaId = conn.area;
          state.player.x = conn.entryX;
          state.player.y = conn.entryY;
          state.message = `Heading north to ${AREAS[conn.area]?.name || conn.area}...`;
          log(state.message);
          const rivalResult = checkRivalEncounter(state);
          if (rivalResult) return rivalResult;
          return state;
        }
        state.message = "You can't go that way."; return state;
      }
      if (ny >= area.height) {
        const conn = area.connections?.south;
        if (conn) {
          if (connBlocked(conn)) { state.message = conn.blockMessage || "You can't go that way."; return state; }
          state.areaId = conn.area;
          state.player.x = conn.entryX;
          state.player.y = conn.entryY;
          state.message = `Heading south to ${AREAS[conn.area]?.name || conn.area}...`;
          log(state.message);
          const rivalResult = checkRivalEncounter(state);
          if (rivalResult) return rivalResult;
          return state;
        }
        state.message = "You can't go that way."; return state;
      }
      if (nx < 0) {
        const conn = area.connections?.west;
        if (conn) {
          if (connBlocked(conn)) { state.message = conn.blockMessage || "You can't go that way."; return state; }
          state.areaId = conn.area; state.player.x = conn.entryX; state.player.y = conn.entryY;
          state.message = `Heading west to ${AREAS[conn.area]?.name}...`;
          const rivalResult = checkRivalEncounter(state);
          if (rivalResult) return rivalResult;
          return state;
        }
        state.message = "You can't go that way."; return state;
      }
      if (nx >= area.width) {
        const conn = area.connections?.east;
        if (conn) {
          if (connBlocked(conn)) { state.message = conn.blockMessage || "You can't go that way."; return state; }
          state.areaId = conn.area; state.player.x = conn.entryX; state.player.y = conn.entryY;
          state.message = `Heading east to ${AREAS[conn.area]?.name}...`;
          const rivalResult = checkRivalEncounter(state);
          if (rivalResult) return rivalResult;
          return state;
        }
        state.message = "You can't go that way."; return state;
      }

      // NPC blocking (uses effective positions for wandering NPCs)
      const npcHere = getEffectiveNpcAt(area, nx, ny, state);
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
        // [D4] Resolve dialogue — supports flagDialogue branches or normal dialogue/afterBattle
        const flagLines = resolveNpcDialogue(npcHere, state.player, state);
        const dialogueSource = flagLines !== null
          ? flagLines
          : (npcHere.trainerBattle && state.player.flags[npcHere.trainerBattle.rewardFlag])
            ? (npcHere.dialogueAfter || npcHere.dialogue)
            : npcHere.dialogue;
        const lines = [...(dialogueSource || [])];
        state.dialogue = { lines, index:0, npcId: npcHere.id };
        state.dialogue.lines = lines.filter(l => {
          if (typeof l === 'object' && l.give) {
            // [D4] giveIf: skip give line if condition flag not set
            if (l.giveIf && !state.player.flags[l.giveIf]) return false;
            return !state.player.flags[`got_${l.give}_from_${npcHere.id}`];
          }
          return true;
        });
        if (!state.dialogue.lines.length) { state.dialogue = null; state.message = '...'; return state; }
        const firstLine = state.dialogue.lines[0];
        state.message = typeof firstLine === 'string'
          ? firstLine
          : firstLine.give ? `(Received ${firstLine.give.replace(/_/g,' ')}!)` : '...';
        return state;
      }

      // Ledge jump: moving south into a ledge_s tile jumps over it
      if (action.direction === 'south' && getAreaTile(area, nx, ny) === T.LEDGE_S) {
        const landY = ny + 1;
        if (landY < area.height && isWalkable(area, nx, landY, state)) {
          state.player.x = nx;
          state.player.y = landY;
          state.player.steps++;
          state.message = `Jumped off the ledge! (${nx},${landY})`;
          log(state.message);
          const ledgeWarp = getWarpAt(area, nx, landY);
          if (ledgeWarp) return handleWarp(state, ledgeWarp, area);
          // Ground item pickup on ledge landing
          if (area.items) {
            for (const item of area.items) {
              if (item.x === nx && item.y === landY) {
                const flagKey = `picked_up_${item.id}`;
                if (!state.player.flags[flagKey]) {
                  state.player.flags[flagKey] = true;
                  const qty = item.qty || 1;
                  const iname = item.item;
                  if (iname.startsWith('tm') || iname.startsWith('hm')) {
                    if (!state.player.tms) state.player.tms = {};
                    state.player.tms[iname] = (state.player.tms[iname] || 0) + qty;
                  } else {
                    state.player.bag[iname] = (state.player.bag[iname] || 0) + qty;
                  }
                  state.message = `Jumped off the ledge! Found a ${iname.replace(/_/g,' ').toUpperCase()}! (×${qty})`;
                  log(state.message);
                  return state;
                }
              }
            }
          }
          if (hasEncounter(area, nx, landY) && roll(100) <= (area.encounterRate ?? 20)) {
            const tile = getAreaTile(area, nx, landY);
            const terrain = tile === T.TALL_GRASS ? 'tall_grass' : 'grass';
            const encounter = rollEncounter(state.areaId, terrain, roll);  // #B9: pass seeded roll
            if (encounter) {
              const wild = makePokemon(encounter.species, encounter.level);
              state.screen = 'battle';
              state.battle = { enemy: wild, playerPartyIndex:0, turn:0 };
              if (state.pokedex) state.pokedex.seen[wild.species] = true;  // [G1] Pokédex seen
              state.message = `A wild ${wild.name} appeared! (Lv.${wild.level})`;
              log(state.message);
              return state;
            }
          }
          return state;
        }
        state.message = "Can't jump — no landing spot.";
        return state;
      }

      // Surf check: can cross water if a party member knows 'surf'
      if (getAreaTile(area, nx, ny) === T.WATER) {
        const hasSurf = state.player.party.some(p => (p.moves || []).includes('surf'));
        if (hasSurf) {
          state.player.x = nx;
          state.player.y = ny;
          state.player.steps++;
          state.message = `Surfing on the water! (${nx},${ny})`;
          log(state.message);
          if (roll(100) <= (area.encounterRate ?? 10)) {
            const encounter = rollEncounter(state.areaId, 'water', roll);  // #B9: pass seeded roll
            if (encounter) {
              const wild = makePokemon(encounter.species, encounter.level);
              state.screen = 'battle';
              state.battle = { enemy: wild, playerPartyIndex:0, turn:0 };
              if (state.pokedex) state.pokedex.seen[wild.species] = true;  // [G1] Pokédex seen
              state.message = `A wild ${wild.name} appeared! (Lv.${wild.level})`;
              log(state.message);
              return state;
            }
          }
          return state;
        }
        state.message = "You need to use SURF to cross water!";
        return state;
      }

      // Check if a tree_cut tile has been cleared by CUT
      const isCutTree = getAreaTile(area, nx, ny) === T.TREE_CUT;
      if (isCutTree) {
        const cKey = `${nx},${ny}`;
        if (!(state.cuttedTrees?.[state.areaId] || []).includes(cKey)) {
          state.message = "A tree is blocking the way! Use CUT to remove it.";
          return state;
        }
        // Tree was cut — treat as clear path, skip isWalkable check below
      }

      if (!isCutTree && !isWalkable(area, nx, ny, state)) {
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

      // Trainer sight-line check (after successful move)
      for (const npc of (area.npcs || [])) {
        if (!npc.trainerBattle) continue;
        if (state.player.flags[npc.trainerBattle.rewardFlag]) continue; // already beaten
        const sightRange = npc.sightRange || 4;
        const DIR_VECS = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };
        const npcOverride = state.npcState?.[state.areaId]?.[npc.id];
        const npcX = npcOverride?.x ?? npc.x;
        const npcY = npcOverride?.y ?? npc.y;
        const npcDir = npcOverride?.dir ?? npc.dir ?? 'south';
        const [sdx, sdy] = DIR_VECS[npcDir] || [0, 1];
        let spotted = false;
        for (let d = 1; d <= sightRange; d++) {
          const tx = npcX + sdx * d;
          const ty = npcY + sdy * d;
          if (tx === state.player.x && ty === state.player.y) {
            spotted = true;
            break;
          }
          // Stop sight-line at solid tiles
          const blocker = getAreaTile(area, tx, ty);
          if (blocker === T.WALL || blocker === T.BUILDING || blocker === T.TREE || blocker === T.TREE_CUT) break;
        }
        if (spotted) {
          const tb = npc.trainerBattle;
          const [first, ...rest] = tb.party.map(e => makePokemon(e.species, e.level));
          state.screen = 'battle';
          state.battle = {
            enemy: first, isTrainer: true,
            trainerName: tb.trainerName || npc.name,
            trainerParty: rest, playerPartyIndex: 0,
            reward: tb.reward || 0, rewardFlag: tb.rewardFlag,
            badge: tb.badge || null, turn: 0,
          };
          state.message = `${npc.name} spotted you! "${npc.dialogue?.[0] || 'Battle time!'}"`;
          log(state.message);
          return state;
        }
      }

      // NPC wander/spin tick (each move step advances NPC positions)
      if (!state.npcState) state.npcState = {};
      const npcStateArea = state.npcState[state.areaId] || {};
      for (const npc of (area.npcs || [])) {
        if (npc.spin) {
          const DIRS = ['north','east','south','west'];
          const cur = npcStateArea[npc.id]?.dir ?? npc.dir ?? 'south';
          const next = DIRS[(DIRS.indexOf(cur) + 1) % 4];
          npcStateArea[npc.id] = { ...(npcStateArea[npc.id] || {}), x: npc.x, y: npc.y, dir: next };
        }
        if (npc.wander && roll(4) === 1) {
          const WANDER_DIRS = [[0,-1],[0,1],[1,0],[-1,0]];
          const [wdx, wdy] = WANDER_DIRS[roll(4) - 1];
          const wx = (npcStateArea[npc.id]?.x ?? npc.x) + wdx;
          const wy = (npcStateArea[npc.id]?.y ?? npc.y) + wdy;
          if (wx >= 0 && wx < area.width && wy >= 0 && wy < area.height && isWalkable(area, wx, wy, state)) {
            if (!(wx === state.player.x && wy === state.player.y)) {
              npcStateArea[npc.id] = { ...(npcStateArea[npc.id] || { dir: npc.dir }), x: wx, y: wy };
            }
          }
        }
      }
      state.npcState[state.areaId] = npcStateArea;

      // Ground item auto-pickup
      if (area.items) {
        for (const item of area.items) {
          if (item.x === state.player.x && item.y === state.player.y) {
            const flagKey = `picked_up_${item.id}`;
            if (!state.player.flags[flagKey]) {
              state.player.flags[flagKey] = true;
              const qty = item.qty || 1;
              const iname = item.item;
              if (iname.startsWith('tm') || iname.startsWith('hm')) {
                if (!state.player.tms) state.player.tms = {};
                state.player.tms[iname] = (state.player.tms[iname] || 0) + qty;
              } else {
                state.player.bag[iname] = (state.player.bag[iname] || 0) + qty;
              }
              state.message = `Found a ${iname.replace(/_/g,' ').toUpperCase()}! (×${qty})`;
              log(state.message);
              return state;
            }
          }
        }
      }

      // Encounter check (variable rate via area.encounterRate)
      if (hasEncounter(area, nx, ny) && roll(100) <= (area.encounterRate ?? 20)) {
        const tile = getAreaTile(area, nx, ny);
        const terrain = tile === T.TALL_GRASS ? 'tall_grass' : 'grass';
        const encounter = rollEncounter(state.areaId, terrain, roll);  // #B9: pass seeded roll
        if (encounter) {
          const wild = makePokemon(encounter.species, encounter.level);
          state.screen = 'battle';
          state.battle = { enemy: wild, playerPartyIndex:0, turn:0 };
          if (state.pokedex) state.pokedex.seen[wild.species] = true;  // [G1] Pokédex seen
          state.message = `A wild ${wild.name} appeared! (Lv.${wild.level})`;
          log(state.message);
          return state;
        }
      }

      // [E10] Track facing direction for interact checks
      if (action.direction) state.player.facing = action.direction;
      state.message = `Moved ${action.direction}. (${nx},${ny}) — ${area.name}`;
      return state;
    }

    if (type === 'talk') {
      // [E10] Interact with the tile the player is facing, with all-direction fallback
      const FACE_DELTA = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };
      const [fdx,fdy] = FACE_DELTA[state.player.facing || 'south'] || [0,-1];
      const facedDirs = [[fdx,fdy],[0,-1],[1,0],[-1,0],[0,1]];  // faced tile first
      const dirs = [...new Set(facedDirs.map(JSON.stringify))].map(JSON.parse);
      for (const [dx,dy] of dirs) {
        const tx = state.player.x + dx, ty = state.player.y + dy;
        const npc = getNpcAt(area, tx, ty);
        if (npc) {
          // [D4] Resolve flagDialogue branches or fall through to static dialogue
          const flagLines = resolveNpcDialogue(npc, state.player, state);
          const rawLines = flagLines !== null ? flagLines : (npc.dialogue || []);
          const lines = [...rawLines].filter(l => {
            if (typeof l === 'object' && l.give) {
              if (l.giveIf && !state.player.flags[l.giveIf]) return false;
              return !state.player.flags[`got_${l.give}_from_${npc.id}`];
            }
            return true;
          });
          if (!lines.length) { state.message = `${npc.name}: ...`; return state; }
          state.dialogue = { lines, index:0, npcId: npc.id };
          const firstLine = lines[0];
          state.message = typeof firstLine === 'string'
            ? firstLine
            : firstLine.give ? `(Received ${firstLine.give.replace(/_/g,' ')}!)` : '...';
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

    // [G3] PC actions restricted to areas with a PC terminal (Pokémon Centers / Oak's Lab)
    if (type === 'pc_view' || type === 'pc_withdraw' || type === 'pc_deposit' || type === 'pc_release' || type === 'pc_switch_box') {
      const pcArea = AREAS[state.areaId];
      const hasPcTerminal = pcArea?.npcs?.some(n => n.id && n.id.includes('pc_terminal'));
      if (!hasPcTerminal) {
        state.message = "There's no PC here. Visit a POKéMON CENTER or lab to use BILL's PC.";
        return state;
      }
    }

    // [G3] Migrate legacy flat pc array to 12-box structure
    if (!state.player.pcBoxes) {
      const BOX_COUNT = 12;
      state.player.pcBoxes = Array.from({ length: BOX_COUNT }, () => []);
      state.player.currentBox = 0;
      // Migrate old flat pc into boxes sequentially
      if (state.player.pc && state.player.pc.length) {
        for (const mon of state.player.pc) {
          let placed = false;
          for (let b = 0; b < BOX_COUNT; b++) {
            if (state.player.pcBoxes[b].length < 20) {
              state.player.pcBoxes[b].push(mon);
              placed = true;
              break;
            }
          }
          if (!placed) break;  // overflow: drop (shouldn't happen with 240 cap)
        }
        delete state.player.pc;
      }
    }

    // Helper: current box
    function getBox() {
      const b = Math.max(0, Math.min(11, state.player.currentBox ?? 0));
      state.player.currentBox = b;
      return state.player.pcBoxes[b];
    }

    if (type === 'pc_view') {
      const box = getBox();
      const boxNum = state.player.currentBox + 1;
      const totalAcross = state.player.pcBoxes.reduce((s, b) => s + b.length, 0);
      if (!box.length) {
        state.message = `BOX ${boxNum} is empty. (${totalAcross}/240 stored total)\nUse pc_switch_box (box: 0-11) to change boxes.`;
      } else {
        const list = box.map((p, i) => `[${i}] ${p.name} Lv.${p.level} HP:${p.currentHp}/${p.maxHp} ${p.status || ''}`).join('\n');
        state.message = `BOX ${boxNum} (${box.length}/20):\n${list}\n\nTotal stored: ${totalAcross}/240. Use pc_switch_box (box: 0-11) to change.`;
      }
      return state;
    }

    if (type === 'pc_switch_box') {
      const newBox = action.box ?? 0;
      if (newBox < 0 || newBox > 11) {
        state.message = 'Box number must be 0-11.';
        return state;
      }
      state.player.currentBox = newBox;
      const box = getBox();
      state.message = `Switched to BOX ${newBox + 1} (${box.length}/20).`;
      return state;
    }

    if (type === 'pc_withdraw') {
      const box = getBox();
      const idx = action.index ?? 0;
      if (idx < 0 || idx >= box.length) {
        state.message = `No Pokémon at BOX ${state.player.currentBox + 1} slot ${idx}.`;
        return state;
      }
      if (state.player.party.length >= 6) {
        state.message = 'Your party is full! Deposit a Pokémon first.';
        return state;
      }
      const [pokemon] = box.splice(idx, 1);
      state.player.party.push(pokemon);
      state.message = `${pokemon.name} was withdrawn from BOX ${state.player.currentBox + 1}.`;
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
      const box = getBox();
      if (box.length >= 20) {
        state.message = `BOX ${state.player.currentBox + 1} is full (20/20)! Switch boxes first with pc_switch_box.`;
        return state;
      }
      const [pokemon] = state.player.party.splice(pIdx, 1);
      box.push(pokemon);
      state.message = `${pokemon.name} was deposited into BOX ${state.player.currentBox + 1}.`;
      return state;
    }

    if (type === 'pc_release') {
      const box = getBox();
      const idx = action.index ?? 0;
      if (idx < 0 || idx >= box.length) {
        state.message = `No Pokémon at BOX ${state.player.currentBox + 1} slot ${idx}.`;
        return state;
      }
      const [pokemon] = box.splice(idx, 1);
      state.message = `${pokemon.name} was released into the wild. Goodbye, ${pokemon.name}!`;
      return state;
    }

    if (type === 'forget_move') {
      // { type: 'forget_move', partyIndex: 0, moveIndex: 2, newMove: 'psychic' }
      const pIdx = action.partyIndex ?? 0;
      const mIdx = action.moveIndex ?? 0;
      const newMv = action.newMove;
      const pokemon = state.player.party[pIdx];
      if (!pokemon) return { ...state, message: 'No Pokémon at that slot.' };
      if (mIdx < 0 || mIdx >= (pokemon.moves || []).length) return { ...state, message: 'Invalid move index.' };
      if (!newMv || !MOVES[newMv]) return { ...state, message: `Unknown move: ${newMv}` };

      // #G11: Validate that the new move is learnable by this species
      const base = POKEMON[pokemon.species];
      const learnset = base?.learnset || {};
      const learnableMoves = new Set();
      for (const [lvStr, mvList] of Object.entries(learnset)) {
        if (parseInt(lvStr) <= pokemon.level) for (const m of mvList) learnableMoves.add(m);
      }
      // Also allow TM moves if player owns the TM and species is compatible
      const compatTms = TM_COMPAT[pokemon.species] || [];
      for (const tmKey of compatTms) {
        if ((state.player.tms?.[tmKey] ?? 0) > 0 && TMS[tmKey]?.move) {
          learnableMoves.add(TMS[tmKey].move);
        }
      }
      if (!learnableMoves.has(newMv)) {
        return { ...state, message: `${pokemon.name} can't learn ${newMv.toUpperCase()} — not in its learnset or available TMs.` };
      }

      const forgot = pokemon.moves[mIdx];
      pokemon.moves[mIdx] = newMv;
      if (pokemon.pp) {
        delete pokemon.pp[forgot];
        pokemon.pp[newMv] = MOVES[newMv].pp ?? 20;
      }
      return { ...state, message: `${pokemon.name} forgot ${forgot.toUpperCase()} and learned ${newMv.toUpperCase()}!` };
    }

    if (type === 'cut') {
      // CUT field move — removes an adjacent tree_cut tile
      const DIRS = [[0,-1],[0,1],[1,0],[-1,0]];
      const hasCut = state.player.party.some(p => (p.moves || []).includes('cut'));
      if (!hasCut) { state.message = "No Pokémon in your party knows CUT!"; return state; }
      for (const [dx, dy] of DIRS) {
        const tx = state.player.x + dx, ty = state.player.y + dy;
        if (getAreaTile(area, tx, ty) === T.TREE_CUT) {
          if (!state.cuttedTrees) state.cuttedTrees = {};
          if (!state.cuttedTrees[state.areaId]) state.cuttedTrees[state.areaId] = [];
          const key = `${tx},${ty}`;
          if (!state.cuttedTrees[state.areaId].includes(key)) {
            state.cuttedTrees[state.areaId].push(key);
            state.message = `Used CUT! The tree was cut down!`;
            log(state.message);
          } else {
            state.message = "That tree has already been cut.";
          }
          return state;
        }
      }
      state.message = "There's no tree to cut here.";
      return state;
    }

    // [E6] Heal at Nurse Joy (inside Pokémon Center interiors)
    if (type === 'heal') {
      const hasNurse = area.npcs?.some(n => n.id?.startsWith('nurse_joy'));
      if (!hasNurse) {
        state.message = "There's no POKéMON CENTER here. Find a CENTER to heal your party!";
        return state;
      }
      healParty(state);
      // Track last center for Dig/Teleport — use first exit warp, offset one step back so
      // Dig doesn't land exactly on a re-entry warp tile
      const exitWarp = area.warps?.find(w => w.dest && w.dest !== state.areaId);
      if (exitWarp) {
        const destArea = AREAS[exitWarp.dest];
        // Offset south of exit warp (away from center entrance)
        const offY = (destArea?.height && exitWarp.destY + 2 < destArea.height) ? exitWarp.destY + 2 : exitWarp.destY;
        state.player.lastCenter = { areaId: exitWarp.dest, x: exitWarp.destX, y: offY };
      }
      state.message = "NURSE JOY: We've restored your POKéMON to full health. We hope to see you again!";
      return state;
    }

    // [E6] Dig / Teleport field moves — escape dungeon, warp to last center
    if (type === 'dig' || type === 'teleport') {
      const moveName = type === 'dig' ? 'dig' : 'teleport';
      const hasMove = state.player.party.some(p => (p.moves || []).includes(moveName));
      if (!hasMove) {
        state.message = `No Pokémon in your party knows ${moveName.toUpperCase()}!`;
        return state;
      }
      const lc = state.player.lastCenter;
      if (!lc || !AREAS[lc.areaId]) {
        state.message = "You haven't visited a POKéMON CENTER yet! Can't escape.";
        return state;
      }
      state.areaId = lc.areaId;
      state.player.x = lc.x;
      state.player.y = lc.y;
      state.screen = 'overworld';
      state.dialogue = null;
      state.message = `Used ${moveName.toUpperCase()}! Returned to the last POKéMON CENTER area.`;
      log(state.message);
      return state;
    }

    // [B6] Nickname Pokémon
    if (type === 'nickname_pokemon') {
      const pIdx = action.partyIndex ?? 0;
      const pokemon = state.player.party[pIdx];
      if (!pokemon) return { ...state, message: 'No Pokémon at that slot.' };
      const nick = (action.nickname || '').trim().slice(0, 10);  // Gen I: 10 char max
      if (!nick) return { ...state, message: 'Nickname cannot be empty.' };
      const oldNick = pokemon.name;
      pokemon.name = nick;
      return { ...state, message: `${oldNick} was nicknamed ${nick}!` };
    }

    // [F4] Mart sell — half buy-price
    if (type === 'mart_sell') {
      const { item, qty = 1 } = action;
      if (!item) return { ...state, message: 'Specify an item to sell.' };
      const areaId = state.areaId;
      const martTier = getMartTierForArea(areaId, state);
      const catalog = MART_CATALOG[martTier] || [];
      const entry = catalog.find(e => e.item === item);
      const sellPrice = entry ? Math.floor(entry.price / 2) : 50;  // default 50 if not in catalog
      const ownedBag = state.player.bag?.[item] ?? 0;
      const ownedItems = state.player.items?.[item] ?? 0;
      const owned = ownedBag + ownedItems;
      if (owned < qty) return { ...state, message: `You don't have ${qty}× ${item.replace(/_/g,' ')}.` };
      let toSell = qty;
      if (ownedBag > 0) {
        const fromBag = Math.min(toSell, ownedBag);
        state.player.bag[item] -= fromBag;
        toSell -= fromBag;
      }
      if (toSell > 0 && ownedItems > 0) {
        const fromItems = Math.min(toSell, ownedItems);
        state.player.items[item] -= fromItems;
      }
      const earned = sellPrice * qty;
      state.player.money = Math.min(999999, state.player.money + earned);  // [F8] cap
      return { ...state, message: `Sold ${qty}× ${item.replace(/_/g,' ')} for ₽${earned}.` };
    }

    // [G1] Pokédex view action
    if (type === 'pokedex_view') {
      const dex = state.pokedex || { seen: {}, caught: {} };
      const seenCount = Object.keys(dex.seen).length;
      const caughtCount = Object.keys(dex.caught).length;
      const caughtList = Object.keys(dex.caught).sort();
      state.message = `POKéDEX: Seen ${seenCount} · Caught ${caughtCount}` +
        (caughtList.length ? `\nCaught: ${caughtList.map(s => s.toUpperCase()).join(', ')}` : '');
      return state;
    }

    state.message = `Unknown overworld action: ${type}. Use: move, talk, use_item, mart_view, mart_buy, mart_sell, pc_view, pc_withdraw, pc_deposit, pc_release, pc_switch_box, forget_move, cut, nickname_pokemon, pokedex_view`;
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
    // Store y+1 so Dig/Teleport lands SOUTH of the door (not on the warp tile itself)
    state.player.lastCenter = { areaId: state.areaId, x: state.player.x, y: state.player.y + 1 };
    healParty(state);
    state.message = "NURSE JOY: Welcome to the POKéMON CENTER! We've restored your POKéMON to full health. We hope to see you again!";
    return state;
  }
  if (destId === 'poke_mart') {
    // The mart tier is resolved from the city the player is in
    const tier = getMartTierForArea(state.areaId, state);
    if (tier) {
      const catalog = MART_CATALOG[tier];
      const lines = catalog.map(e => `${ITEM_NAMES[e.item] || e.item} ₽${e.price}`).join(', ');
      state.message = `CLERK: Welcome to the POKé MART! We have: ${lines}. Use mart_buy to purchase. You have ₽${state.player.money}.`;
    } else if (state.areaId === 'viridian_city' || state.areaId === 'poke_mart') {
      state.message = "CLERK: Oh, I'm sorry — I can't help you right now. Could you please bring PROF. OAK's parcel to him first?";
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

  if (item === 'potion' || item === 'super_potion' || item === 'hyper_potion') {
    const heal = item === 'potion' ? 20 : item === 'super_potion' ? 50 : 200;
    if (!(bag[item] > 0)) { state.message = `You have no ${itemName}s.`; return state; }
    if (target.currentHp <= 0) { state.message = `${target.name} has fainted!`; return state; }
    if (target.currentHp >= target.maxHp) { state.message = `${target.name}'s HP is already full!`; return state; }
    const healed = Math.min(heal, target.maxHp - target.currentHp);
    target.currentHp += healed;
    bag[item]--;
    state.message = `Used ${itemName} on ${target.name}. +${healed} HP. (${target.currentHp}/${target.maxHp})`;

  } else if (item === 'max_potion') {
    if (!(bag.max_potion > 0)) { state.message = 'You have no Max Potions.'; return state; }
    if (target.currentHp <= 0) { state.message = `${target.name} has fainted!`; return state; }
    if (target.currentHp >= target.maxHp) { state.message = `${target.name}'s HP is already full!`; return state; }
    const healed = target.maxHp - target.currentHp;
    target.currentHp = target.maxHp;
    bag.max_potion--;
    state.message = `Used Max Potion on ${target.name}. +${healed} HP. HP fully restored!`;

  } else if (item === 'full_restore') {
    if (!(bag.full_restore > 0)) { state.message = 'You have no Full Restores.'; return state; }
    if (target.currentHp <= 0) { state.message = `${target.name} has fainted!`; return state; }
    const hpHealed = target.maxHp - target.currentHp;
    target.currentHp = target.maxHp;
    const cured = target.status;
    target.status = null; target.statusTurns = 0;
    target.confused = false; target.confusedTurns = 0;
    bag.full_restore--;
    state.message = `Used Full Restore on ${target.name}. HP fully restored${cured ? ` and ${cured} cured` : ''}!`;

  } else if (item === 'revive' || item === 'max_revive') {
    if (!(bag[item] > 0)) { state.message = `You have no ${itemName}s.`; return state; }
    if (target.currentHp > 0) { state.message = `${target.name} hasn't fainted!`; return state; }
    const reviveHp = item === 'max_revive' ? target.maxHp : Math.max(1, Math.floor(target.maxHp / 2));
    target.currentHp = reviveHp;
    target.status = null; target.statusTurns = 0;
    bag[item]--;
    state.message = `Used ${itemName} on ${target.name}. ${target.name} was revived with ${reviveHp} HP!`;

  } else if (item === 'rare_candy') {
    if (!(bag.rare_candy > 0)) { state.message = 'You have no Rare Candies.'; return state; }
    if (target.level >= 100) { state.message = `${target.name} is already at Level 100!`; return state; }
    bag.rare_candy--;
    const msgs = [];
    target.level++;
    target.exp = expForLevel(target.level, target.growthRate);
    recalcStats(target);
    msgs.push(`${target.name} grew to Level ${target.level}!`);
    tryLevelUp(target, msgs, state);
    state.message = msgs.join(' ');

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

  } else if (item === 'burn_heal') {
    if (!(bag.burn_heal > 0)) { state.message = 'You have no Burn Heals.'; return state; }
    if (target.status !== 'burn') { state.message = `${target.name} is not burned.`; return state; }
    target.status = null;
    bag.burn_heal--;
    state.message = `Used Burn Heal on ${target.name}. ${target.name}'s burn was healed!`;

  } else if (item === 'awakening') {
    if (!(bag.awakening > 0)) { state.message = 'You have no Awakenings.'; return state; }
    if (target.status !== 'sleep') { state.message = `${target.name} is not asleep.`; return state; }
    target.status = null;
    target.statusTurns = 0;
    bag.awakening--;
    state.message = `Used Awakening on ${target.name}. ${target.name} woke up!`;

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

  } else if (['hp_up','protein','iron','carbos','calcium'].includes(item)) {
    // [A3] Vitamins: +2560 stat EXP to the relevant stat, capped at 25600 per vitamin
    if (!(bag[item] > 0)) { state.message = `You have no ${itemName}!`; return state; }
    const VSTAT = { hp_up:'hp', protein:'atk', iron:'def', carbos:'spd', calcium:'spc' };
    const vStat = VSTAT[item];
    if (!target.statExp) target.statExp = { hp:0, atk:0, def:0, spd:0, spc:0 };
    const cur = target.statExp[vStat] || 0;
    if (cur >= 25600) {
      state.message = `It won't have any effect. ${target.name}'s ${vStat.toUpperCase()} is at max vitamin level!`;
      return state;
    }
    target.statExp[vStat] = Math.min(25600, cur + 2560);
    recalcStats(target);
    bag[item]--;
    state.message = `Used ${itemName} on ${target.name}! ${vStat.toUpperCase()} stat EXP increased.`;

  } else if (item === 'pp_up' || item === 'pp_max') {
    // [C19] PP Up / PP Max — raise a move's maximum PP
    const pIdx = action.target_index ?? 0;
    const mIdx = action.moveIndex ?? 0;
    const pokemon = state.player.party[pIdx];
    if (!pokemon) return { ...state, message: 'No Pokémon at that slot.' };
    const mv = pokemon.moves?.[mIdx];
    if (!mv) return { ...state, message: 'No move at that slot.' };
    const ownedCount = (bag?.[item] ?? 0) + (state.player.items?.[item] ?? 0);
    if (ownedCount < 1) return { ...state, message: `You have no ${itemName}!` };
    const basePP = MOVES[mv]?.pp ?? 20;
    pokemon.ppUps = pokemon.ppUps || {};
    const ups = pokemon.ppUps[mv] || 0;
    if (ups >= 3) return { ...state, message: `${mv.toUpperCase()}'s PP is already maxed!` };
    const newUps = item === 'pp_max' ? 3 : ups + 1;
    pokemon.ppUps[mv] = newUps;
    const newMaxPP = Math.floor(basePP * (1 + newUps * 0.2));
    const currentPP = pokemon.pp?.[mv] ?? basePP;
    const gain = newMaxPP - Math.floor(basePP * (1 + ups * 0.2));
    if (pokemon.pp) pokemon.pp[mv] = Math.min(newMaxPP, currentPP + gain);
    // Deduct from bag first, then items
    if ((bag?.[item] ?? 0) > 0) bag[item]--;
    else if ((state.player.items?.[item] ?? 0) > 0) state.player.items[item]--;
    state.message = `${pokemon.name}'s ${mv.toUpperCase()} PP was raised!`;

  } else if (item.startsWith('tm') || item.startsWith('hm')) {
    // TM/HM use: { type: 'use_item', item: 'tm29', target_index: 0 }
    const tmData = TMS[item];
    if (!tmData) return { ...state, message: `Unknown TM/HM: ${item}` };
    const count = state.player.tms?.[item] ?? 0;
    if (count < 1) return { ...state, message: `You don't have ${tmData.name}!` };

    // Check compatibility
    const compat = TM_COMPAT[target.species] || [];
    if (!compat.includes(item)) {
      return { ...state, message: `${target.name} can't learn ${tmData.name} (${tmData.move.toUpperCase()}).` };
    }

    // Check move exists
    const mvName = tmData.move;
    if (!MOVES[mvName]) return { ...state, message: `Move ${mvName} not yet implemented.` };

    // Check if already knows it
    if ((target.moves || []).includes(mvName)) {
      return { ...state, message: `${target.name} already knows ${mvName.toUpperCase()}!` };
    }

    // Teach the move (or prompt to forget one if 4 moves)
    if ((target.moves || []).length < 4) {
      target.moves = [...(target.moves || []), mvName];
      if (target.pp) target.pp[mvName] = MOVES[mvName].pp ?? 20;
      // TMs are single-use (Gen I); HMs are not consumed
      if (item.startsWith('tm')) {
        state.player.tms[item] = (state.player.tms[item] || 1) - 1;
        if (state.player.tms[item] <= 0) delete state.player.tms[item];
      }
      return { ...state, message: `${target.name} learned ${mvName.toUpperCase()} from ${tmData.name}!` };
    } else {
      return { ...state, message: `${target.name} already knows 4 moves. Use forget_move to replace one first.` };
    }

  } else if (item === 'escape_rope') {
    // [F3] Escape Rope — teleport to last visited Pokémon Center area
    if (!((bag.escape_rope ?? 0) > 0)) { state.message = 'You have no Escape Ropes.'; return state; }
    const lc = state.player.lastCenter;
    if (!lc || !AREAS[lc.areaId]) {
      state.message = "Can't use Escape Rope here. You haven't visited a POKéMON CENTER yet!";
      return state;
    }
    bag.escape_rope = (bag.escape_rope || 1) - 1;
    state.areaId = lc.areaId;
    state.player.x = lc.x;
    state.player.y = lc.y;
    state.screen = 'overworld';
    state.dialogue = null;
    state.message = 'Used Escape Rope! Returned to the last POKéMON CENTER area.';
    return state;

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

    // fallback — unknown item
    state.message = `Can't use ${itemName} here. Try: potion, super_potion, hyper_potion, max_potion, full_restore, revive, max_revive, rare_candy, antidote, paralyze_heal, burn_heal, awakening, full_heal, escape_rope, or an evolution stone.`;
  }
  return state;
}

// ── Mart actions (#20 #21) ────────────────────────────────────────────────────
function martView(state) {
  const tier = getMartTierForArea(state.areaId, state);
  if (!tier) {
    const isViridian = state.areaId === 'viridian_city' || state.areaId === 'poke_mart';
    state.message = isViridian
      ? "CLERK: Sorry, we're not open for business right now. Please bring PROF. OAK's parcel to him first!"
      : "There's no Poké Mart here. Travel to Viridian City or Pewter City.";
    return state;
  }
  const catalog = MART_CATALOG[tier];
  const lines = catalog.map(e => `${ITEM_NAMES[e.item] || e.item}: ₽${e.price}`).join('\n');
  state.message = `CLERK: Here's what we stock:\n${lines}\nYou have ₽${state.player.money}. Use mart_buy to purchase.`;
  return state;
}

function martBuy(state, action) {
  const tier = getMartTierForArea(state.areaId, state);
  if (!tier) {
    const isViridian = state.areaId === 'viridian_city' || state.areaId === 'poke_mart';
    state.message = isViridian
      ? "CLERK: Sorry, we're not open for business right now. Please bring PROF. OAK's parcel to him first!"
      : "There's no Poké Mart here. Travel to Viridian City or Pewter City.";
    return state;
  }
  const { item, quantity = 1 } = action;
  if (!item) { state.message = 'Specify an item to buy. Use mart_view to see the catalog.'; return state; }
  const qty = Math.max(1, Math.floor(quantity));

  // TM/HM purchasing
  if (item.startsWith('tm') || item.startsWith('hm')) {
    const tmData = TMS[item];
    if (!tmData || tmData.price <= 0) {
      state.message = `CLERK: Sorry, ${item.toUpperCase()} is not for sale here.`;
      return state;
    }
    const catalog = MART_CATALOG[tier];
    const tmEntry = catalog.find(e => e.item === item);
    if (!tmEntry) {
      const avail = catalog.map(e => e.item).join(', ');
      state.message = `CLERK: Sorry, we don't carry ${item.toUpperCase()} here. We stock: ${avail}.`;
      return state;
    }
    const totalCost = tmData.price * qty;
    if (state.player.money < totalCost) {
      state.message = `CLERK: That costs ₽${totalCost} but you only have ₽${state.player.money}. You need ₽${totalCost - state.player.money} more.`;
      return state;
    }
    state.player.money -= totalCost;
    state.player.tms = state.player.tms || {};
    state.player.tms[item] = (state.player.tms[item] || 0) + qty;
    state.message = `CLERK: Bought ${qty}× ${tmData.name} (${tmData.move.toUpperCase()}) for ₽${totalCost}. You have ₽${state.player.money} remaining.`;
    return state;
  }

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

    // [A8] Trapping lock-in: must keep using the trap move
    if (en.trappingState) return en.trappingState.move;

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

    // [C7] Disable — blocked move can't be used this turn
    if (attacker.disabledMove && mvName === attacker.disabledMove) {
      msgs.push(`${attacker.name}'s ${mvName.toUpperCase()} is disabled!`);
      return;
    }

    // [A8] Trapping follow-up: if attacker is locked in AND defender is already bound,
    // skip the full damage path — chip via applyStatusEnd handles it
    if (attacker.trappingState && attacker.trappingState.move === mvName && defender.boundState) {
      // Deduct PP — [H10] Gen I PP rollover bug: PP at 0 wraps to 63 instead of going negative
      if (mvName !== 'struggle') {
        if (!attacker.pp) attacker.pp = {};
        const curPP = attacker.pp[mvName] ?? 0;
        attacker.pp[mvName] = curPP <= 0 ? 63 : curPP - 1;  // [H10] rollover
      }
      attacker.lastMoveUsed = mvName;
      msgs.push(`${attacker.name} keeps using ${mvName.toUpperCase()}!`);
      return;
    }

    let lastBindDmg = 0;  // [A8] capture damage for dmgPerTurn

    // [C11] Thrash/Petal Dance lock-in — override move selection if rampaging
    if (attacker.lockinState) {
      mvName = attacker.lockinState.move;
      attacker.lockinState.turnsLeft--;
      if (attacker.lockinState.turnsLeft <= 0) {
        attacker.lockinState = null;
        // Self-confuse after rampage ends
        if (!attacker.confused) {
          attacker.confused = true;
          attacker.confusedTurns = 1 + roll(4);  // 2-5 turns
          msgs.push(`${attacker.name} became confused from the rampage!`);
        }
      }
    } else {
      const mvDef = MOVES[mvName];
      if (mvDef?.effect?.lockin) {
        // Start lock-in: 2 or 3 turns (Gen I); -1 because this turn counts
        const totalTurns = 2 + (roll(2) - 1);  // 2 or 3
        attacker.lockinState = { move: mvName, turnsLeft: totalTurns - 1 };
      }
    }

    // #15: PP deduction — redirect to Struggle if this move has 0 PP
    if (mvName !== 'struggle') {
      if (!attacker.pp) attacker.pp = {};
      if ((attacker.pp[mvName] ?? 1) <= 0) {
        mvName = 'struggle';
      } else {
        attacker.pp[mvName]--;
      }
    }

    // [C7] Track last move used (after lockin override + PP redirect, before execution)
    attacker.lastMoveUsed = mvName;

    // #8: Whirlwind — ends wild battles; fails vs trainers
    // [C12] Flee moves: Whirlwind/Roar/Teleport end wild battles
    if (mvName === 'whirlwind' || mv?.effect?.flee === 'wild') {
      if (!battle.isTrainer) {
        msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! The wild ${defender.name} fled!`);
        for (const p of state.player.party) resetVolatileState(p);
        state.screen = 'overworld'; state.battle = null;
      } else {
        msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! But it failed against a trainer!`);
      }
      return;
    }

    // #22: Bide — set charging state; actual release handled in battle_move preamble
    if (mvName === 'bide') {
      attacker.bideState = { turnsLeft: 2 + (roll(2) - 1), damageAccum: 0 };  // 2-3 turns (Gen I)
      msgs.push(`${attacker.name} is biding its time!`);
      return;
    }

    // #15: Struggle — Normal-type 50-power physical, 50% recoil damage [C18]
    if (mvName === 'struggle') {
      const rand = (216 + roll(39)) / 255;  // 217..255 inclusive (#3)
      const baseDmg = Math.max(1, Math.floor(
        (Math.floor(2 * attacker.level / 5 + 2) * attacker.atk * 50 / defender.def / 50 + 2) * rand
      ));
      // [C18] Struggle is Normal-type — Ghost immune, Rock resists; recoil always applies
      const eff = getEffectiveness('normal', defender.type);
      const recoil = Math.max(1, Math.floor(baseDmg / 2));
      if (eff === 0) {
        msgs.push(`${attacker.name} used STRUGGLE! It had no effect on ${defender.name}!`);
      } else {
        const finalDmg = Math.floor(baseDmg * eff);
        defender.currentHp = Math.max(0, defender.currentHp - finalDmg);
        msgs.push(`${attacker.name} used STRUGGLE! (-${finalDmg} HP)${eff > 1 ? " It's super effective!" : eff < 1 ? " It's not very effective..." : ""}`);
      }
      attacker.currentHp = Math.max(0, attacker.currentHp - recoil);
      msgs.push(`${attacker.name} took recoil damage! (-${recoil} HP)`);
      return;
    }

    const mv = MOVES[mvName];
    if (!mv) { msgs.push('Unknown move!'); return; }

    // #57: Fire moves thaw frozen targets (Gen I mechanic)
    if (mv.type === 'fire' && defender.status === 'freeze') {
      defender.status = null;
      defender.statusTurns = 0;
      msgs.push(`${defender.name} was defrosted by the fire!`);
    }

    // #1: Accuracy check with Gen I acc/eva stage modifiers
    // Gen I: ALL moves (except always_hit like Swift) are affected by acc/eva stages.
    // The < 100 guard was incorrect — Double Team must work against Thunderbolt.
    const moveAcc = mv.acc ?? 100;
    if (!mv.effect?.always_hit) {
      const ACC_STAGES = [33, 36, 43, 50, 66, 100, 150, 200, 250, 300, 350];
      const atkStageIdx = clamp((attacker.statStages?.acc ?? 0) + 5, 0, 10);
      const defStageIdx = clamp(-(defender.statStages?.eva ?? 0) + 5, 0, 10);
      let missed = false;
      if (moveAcc < 100 || atkStageIdx !== 5 || defStageIdx !== 5) {
        const modifiedAcc = Math.min(100, Math.floor(moveAcc * ACC_STAGES[atkStageIdx] / ACC_STAGES[defStageIdx]));
        if (roll(100) > modifiedAcc) missed = true;
      } else {
        // [H1/A4] Gen I 1/256 miss — even 100% moves have 1/256 miss probability
        // In Gen I the accuracy byte for 100% moves is 255; miss if rand(0–255) >= 255
        if (roll(256) === 256) missed = true;
      }
      if (missed) {
        // [C4] Crash damage on Jump Kick / Hi Jump Kick miss
        if (mv.effect?.crash) {
          const crashDmg = mv.effect.crash;
          attacker.currentHp = Math.max(0, attacker.currentHp - crashDmg);
          msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! But it failed! (crash: -${crashDmg} HP)`);
        } else {
          msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! But it missed!`);
        }
        return;
      }
    }

    const e = mv.effect;

    // [C12] Flee moves (Roar, Teleport) — end wild battles; fail vs trainers
    if (e?.flee) {
      if (battle.isTrainer) {
        msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! But it failed in a trainer battle!`);
      } else {
        msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! The wild ${defender.name} fled!`);
        state.screen = 'overworld'; state.battle = null;
      }
      return;
    }

    // [C1] Fixed-damage moves — bypass normal formula, applied before power check
    if (e?.fixed_damage !== undefined) {
      const dmg = e.fixed_damage;
      defender.currentHp = Math.max(0, defender.currentHp - dmg);
      msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! (-${dmg} HP)`);
      return;
    }
    if (e?.level_damage) {
      const dmg = attacker.level;
      // Type immunity still applies
      const eff = getEffectiveness(mv.type, defender.type);
      if (eff === 0) {
        msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! It had no effect!`);
        return;
      }
      defender.currentHp = Math.max(0, defender.currentHp - dmg);
      msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! (-${dmg} HP)`);
      return;
    }
    if (e?.psywave) {
      // 0..1.5× user's level, uniform; minimum 1
      const maxDmg = Math.floor(attacker.level * 1.5);
      const dmg = Math.max(1, roll(maxDmg + 1) - 1);  // 0..maxDmg uniform, min 1
      defender.currentHp = Math.max(0, defender.currentHp - dmg);
      msgs.push(`${attacker.name} used PSYWAVE! (-${dmg} HP)`);
      return;
    }
    if (e?.super_fang) {
      const dmg = Math.max(1, Math.floor(defender.currentHp / 2));
      defender.currentHp = Math.max(0, defender.currentHp - dmg);
      msgs.push(`${attacker.name} used SUPER FANG! (-${dmg} HP)`);
      return;
    }

    // [C2] OHKO moves — instant KO if user speed > target speed
    if (e?.ohko) {
      const userSpd = attacker.spd * (attacker.status === 'paralysis' ? 0.25 : 1);
      const defSpd  = defender.spd * (defender.status === 'paralysis' ? 0.25 : 1);
      if (userSpd <= defSpd) {
        msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! But it failed!`);
        return;
      }
      defender.currentHp = 0;
      msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! It's a one-hit KO!`);
      return;
    }

    if (mv.power > 0) {
      // [C10] Multi-hit moves — determine hit count, then loop damage
      if (e?.multi_hit) {
        let hits;
        if (Array.isArray(e.multi_hit)) {
          // 2-5 hit distribution: 3/8 each for 2&3, 1/8 each for 4&5
          const r = roll(8);
          hits = r <= 3 ? 2 : r <= 6 ? 3 : r === 7 ? 4 : 5;
        } else {
          hits = e.multi_hit;  // fixed count (e.g. 2 for Double Kick)
        }
        let totalDmg = 0;
        const opts = isPlayer ? { badgeBoost: playerBadgeBoost } : {};
        for (let h = 0; h < hits; h++) {
          if (defender.currentHp <= 0) { hits = h; break; }
          const { dmg: hDmg } = calcDamage(attacker, mvName, defender, opts);
          defender.currentHp = Math.max(0, defender.currentHp - hDmg);
          totalDmg += hDmg;
        }
        msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! Hit ${hits} time(s)! (-${totalDmg} HP total)`);
        // Secondary effects once (e.g. Twineedle poison)
        msgs.push(...applyMoveEffect(mvName, defender, attacker));
        return;
      }

      // [C5] Drain moves — heal attacker by fraction of damage dealt
      if (e?.drain) {
        // Dream Eater fails entirely if target is not sleeping
        if (e.requires_sleep && defender.status !== 'sleep') {
          msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! But it failed — target is not asleep!`);
          return;
        }
        const opts = isPlayer ? { badgeBoost: playerBadgeBoost } : {};
        const { dmg, effectiveness, crit } = calcDamage(attacker, mvName, defender, opts);
        defender.currentHp = Math.max(0, defender.currentHp - dmg);
        const healAmt = Math.max(1, Math.floor(dmg / e.drain));
        attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healAmt);
        const effMsg = effectiveness > 1 ? " It's super effective!"
                     : effectiveness < 1 && effectiveness > 0 ? " It's not very effective..."
                     : effectiveness === 0 ? " It has no effect!" : '';
        const critMsg = crit ? ' A critical hit!' : '';
        msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! (-${dmg} HP)${critMsg}${effMsg} Drained ${healAmt} HP!`);
        return;
      }

      const opts = isPlayer ? { badgeBoost: playerBadgeBoost } : {};
      const { dmg, effectiveness, crit } = calcDamage(attacker, mvName, defender, opts);
      defender.currentHp = Math.max(0, defender.currentHp - dmg);
      lastBindDmg = dmg;  // [A8] save for trapping setup
      // [C7/H7] Counter: track last physical damage received + move type for type restriction
      const mvCat = MOVES[mvName]?.cat;
      if (mvCat === 'physical') {
        defender.lastDamageTaken = dmg;
        defender.lastPhysicalMoveType = MOVES[mvName]?.type ?? null;
      }
      const effMsg = effectiveness > 1 ? " It's super effective!"
                   : effectiveness < 1 && effectiveness > 0 ? " It's not very effective..."
                   : effectiveness === 0 ? " It has no effect!" : '';
      const critMsg = crit ? ' A critical hit!' : '';
      msgs.push(`${attacker.name} used ${mvName.toUpperCase()}! (-${dmg} HP)${critMsg}${effMsg}`);
      // #C3: Explosion/Self-Destruct faint the user
      if (mvName === 'explosion' || mvName === 'self destruct') {
        attacker.currentHp = 0;
        msgs.push(`${attacker.name} fainted from the explosion!`);
      }
      // [C4] Recoil — attacker takes fraction of damage dealt
      if (e?.recoil) {
        const recoilDmg = Math.max(1, Math.floor(dmg / e.recoil));
        attacker.currentHp = Math.max(0, attacker.currentHp - recoilDmg);
        msgs.push(`${attacker.name} was hurt by recoil! (-${recoilDmg} HP)`);
      }
      // [C9] Hyper Beam recharge — [H4] skip if the defender was KO'd (Gen I quirk)
      if (e?.recharge && defender.currentHp > 0) {
        attacker.recharging = true;
        msgs.push(`${attacker.name} must recharge!`);
      }
      // [C17] Pay Day — scatter coins into a battle accumulator
      if (e?.pay_day) {
        const coins = 2 * attacker.level;
        if (!battle.payDayGold) battle.payDayGold = 0;
        battle.payDayGold += coins;
        msgs.push(`Coins scattered everywhere! (+${coins} coins)`);
      }
      msgs.push(...applyMoveEffect(mvName, defender, attacker));
    } else {
      msgs.push(`${attacker.name} used ${mvName.toUpperCase()}!`);
      msgs.push(...applyMoveEffect(mvName, defender, attacker));
    }
    // #23 [A8] Bind/Wrap — full Gen I partial-trapping implementation
    if (mv?.effect?.bind && !defender.boundState) {
      // Ghost immunity: Wrap/Bind doesn't affect Ghost types
      if (defender.type.includes('ghost')) {
        msgs.push(`It had no effect on ${defender.name}!`);
      } else {
        // Duration distribution: 2/3/4/5 turns at 3/3/1/1 probability (out of 8)
        const r = roll(8);
        const turns = r <= 3 ? 2 : r <= 6 ? 3 : r === 7 ? 4 : 5;
        defender.boundState = { turnsLeft: turns, dmgPerTurn: Math.max(1, lastBindDmg) };
        // [A8] Lock the attacker into the trapping move for the same duration
        attacker.trappingState = { move: mvName, turnsLeft: turns };
        msgs.push(`${defender.name} was bound!`);
      }
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
      const totalExp = Math.floor((baseExp * enemy.level * (battle.isTrainer ? 1.5 : 1)) / 7);
      // [G8] Split EXP among all Pokémon that participated in this battle
      const participants = battle.expParticipants || [battle.playerPartyIndex ?? 0];
      const expShare = Math.max(1, Math.floor(totalExp / participants.length));
      // [A3] Stat EXP from the fainted enemy (each defeated Pokémon awards its base stats)
      const enemyBase = POKEMON[enemy.species] || {};
      const seAward = {
        hp: enemyBase.hp || 0,  atk: enemyBase.atk || 0, def: enemyBase.def || 0,
        spd: enemyBase.spd || 0, spc: enemyBase.spc ?? enemyBase.atk ?? 0,
      };
      const expRecipients = [];
      for (const pIdx of participants) {
        const p = state.player.party[pIdx];
        if (p && p.currentHp > 0) {
          p.exp = (p.exp || 0) + expShare;
          expRecipients.push(`${p.name} +${expShare} EXP`);
          // [A3] Accumulate stat EXP (each stat capped at 65535)
          if (!p.statExp) p.statExp = { hp:0, atk:0, def:0, spd:0, spc:0 };
          for (const k of ['hp','atk','def','spd','spc']) {
            p.statExp[k] = Math.min(65535, (p.statExp[k] || 0) + seAward[k]);
          }
          tryLevelUp(p, msgs);
          // [B4] Trigger pending evolution now that battle is ending
          if (p.pendingEvolution) {
            doEvolve(p, p.pendingEvolution, msgs);
            p.pendingEvolution = null;
          }
        }
      }
      msgs.push(`${enemy.name} fainted! ${expRecipients.join(', ')}.`);

      // Trainer battle: send out next Pokémon
      if (battle.isTrainer && battle.trainerParty && battle.trainerParty.length > 0) {
        const next = battle.trainerParty.shift();
        battle.enemy = next;
        // [A17] Shift-mode: offer free switch to player
        state.shiftOffer = true;
        msgs.push(`${battle.trainerName} sent out ${next.name}! (You may switch for free — use switch_pokemon)`);
        return true;   // end attack chain; next action will pick up the new enemy
      }

      // Wild fainted or trainer defeated
      if (battle.isTrainer) {
        msgs.push(`${battle.trainerName} is out of POKéMON! You win!`);
        // [F7] Prize money: basePrize×highestLevel×2 if basePrize defined, else flat reward
        if (battle.basePrize !== undefined) {
          const allParty = [...(battle.trainerParty || []), battle.enemy].filter(Boolean);
          const highestLv = allParty.length > 0
            ? Math.max(...allParty.map(p => p.level))
            : (battle.enemy?.level ?? 1);
          const earned = battle.basePrize * highestLv * 2;
          state.player.money = Math.min(999999, state.player.money + earned);  // [F8] cap ₽999,999
          msgs.push(`${battle.trainerName} paid ₽${earned}!`);
        } else if (battle.reward) {
          state.player.money = Math.min(999999, state.player.money + battle.reward);  // [F8] cap
          msgs.push(`Received ₽${battle.reward} from ${battle.trainerName}.`);
        }
        // [C17] Pay Day gold collected at battle end
        if (battle.payDayGold) {
          state.player.money = Math.min(999999, state.player.money + battle.payDayGold);  // [F8] cap
          msgs.push(`You picked up ${battle.payDayGold} coin(s) from Pay Day!`);
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

      // [C17] Pay Day gold for wild battles
      if (!battle.isTrainer && battle.payDayGold) {
        state.player.money = Math.min(999999, state.player.money + battle.payDayGold);  // [F8] cap
        msgs.push(`You picked up ${battle.payDayGold} coin(s) from Pay Day!`);
      }

      // [A14] Reset volatile state for all party members at battle end
      for (const p of state.player.party) resetVolatileState(p);
      state.screen = 'overworld'; state.battle = null;
      return true;
    }

    if (active.currentHp <= 0) {
      msgs.push(`${active.name} fainted!`);
      const alive = state.player.party.filter(p => p.currentHp > 0);
      if (!alive.length) {
        msgs.push("All your POKéMON fainted... Blacking out!");
        // [A14] Reset volatile state before blackout heal
        for (const p of state.player.party) resetVolatileState(p);
        state.screen = 'overworld'; state.battle = null;
        // #9: warp to last visited Pokécenter (default: Pallet)
        const center = state.player.lastCenter || { areaId: 'pallet_town', x: 8, y: 14 };
        state.areaId = center.areaId; state.player.x = center.x; state.player.y = center.y;
        // Full heal (Gen I: blacking out sends you to a Pokécenter which heals fully)
        for (const p of state.player.party) {
          p.currentHp = p.maxHp;
          p.status = null;
          p.statusTurns = 0;
          if (p.pp) for (const mv of (p.moves || [])) p.pp[mv] = MOVES[mv]?.pp ?? 20;
        }
        state.player.money = Math.floor(state.player.money / 2);  // [F5] Gen I: lose half money on blackout
        msgs.push("You were taken to a POKéMON CENTER.");
      }
      return true;
    }
    return false;
  }

  // ── BATTLE MOVE ─────────────────────────────────────────────────────────
  if (type === 'battle_move') {
    // [A17] Shift offer expired — player chose to attack instead of switching
    if (state.shiftOffer) state.shiftOffer = false;

    const active = getActive();
    const enemy  = getEnemy();
    // [C8] Two-turn move: if charging, override move choice with the stored move (turn 2)
    let moveName;
    let isReleasing = false;   // [C8] true on turn 2 of a two-turn move (skip re-charge check)
    let releaseInvulnerable = false;  // [H9] was the releasing move invulnerable?
    if (active.chargingMove) {
      moveName = active.chargingMove.move;
      releaseInvulnerable = !!active.chargingMove.invulnerable;
      active.chargingMove = null;   // clear before executing
      isReleasing = true;
      // [H9] Pre-set glitch flag; cleared only if the attack actually fires this turn
      if (releaseInvulnerable) active.glitchInvulnerable = true;
    } else {
      // Normal turn — clear any lingering glitch invulnerability
      active.glitchInvulnerable = false;
      // [A8] Player lock-in: if trapping, override move choice
      if (active.trappingState) {
        moveName = active.trappingState.move;
      } else {
        moveName = active.moves[action.move_index ?? 0];
      }
    }
    if (!moveName) { state.message = 'Invalid move index (0-3).'; return state; }
    battle.turn++;

    // [A10] Wild Pokémon use uniform random move selection; trainers use smart scorer
    const pickEnemyMove = () => battle.isTrainer ? selectEnemyMove() : selectWildMove(getEnemy());

    // #22: Active Bide — overrides normal move; accumulates damage taken
    if (active.bideState) {
      const bide = active.bideState;
      const enemyMv = pickEnemyMove();
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
        msgs.push(...applyStatusEnd(getActive(), getEnemy()));
        msgs.push(...applyStatusEnd(getEnemy(), getActive()));
        checkFaint();
      }
      state.message = msgs.filter(Boolean).join(' ');
      msgs.forEach(log);
      return state;
    }

    const mv       = MOVES[moveName];
    const enemyMv  = pickEnemyMove();
    const enemyMvD = MOVES[enemyMv];

    // #56: Bound player can't act — enemy still attacks; bound damage via applyStatusEnd
    if (active.boundState) {
      msgs.push(`${active.name} is bound and can't move!`);
      if (!getEnemy().boundState) {
        doAttack(getEnemy(), enemyMv, getActive(), false);
        checkFaint();
      }
      if (state.battle) {
        msgs.push(...applyStatusEnd(getActive(), getEnemy()));
        msgs.push(...applyStatusEnd(getEnemy(), getActive()));
        checkFaint();
      }
      state.message = msgs.filter(Boolean).join(' ');
      msgs.forEach(log);
      return state;
    }

    // [C8] Two-turn move — CHARGE TURN (turn 1): set charging state, enemy attacks, return early
    // isReleasing=true means we're already on the release turn → skip charge logic
    const twoTurnDef = !isReleasing && TWO_TURN_MOVES[moveName];
    if (twoTurnDef) {
      msgs.push(`${active.name} used ${moveName.toUpperCase()}!`);
      msgs.push(twoTurnDef.msg(active.name));
      // Optional charge-turn buff (Skull Bash: +1 Def)
      if (twoTurnDef.chargeBuff) {
        const { stat, stages } = twoTurnDef.chargeBuff;
        active.statStages[stat] = clamp((active.statStages[stat] || 0) + stages, -6, 6);
        msgs.push(`${active.name}'s ${stat.toUpperCase()} rose!`);
      }
      active.chargingMove = { move: moveName, invulnerable: !!twoTurnDef.invulnerable };
      // PP deducted on release turn (turn 2) by doAttack — net: 1 PP per use
      // Enemy attacks — miss if player is invulnerable (Swift can still hit in Gen I)
      if (twoTurnDef.invulnerable && enemyMv !== 'swift') {
        msgs.push(`${enemy.name} used ${enemyMv.toUpperCase()}!`);
        msgs.push(`But it missed!`);
      } else {
        doAttack(enemy, enemyMv, active, false);
        checkFaint();
      }
      if (state.battle) {
        msgs.push(...applyStatusEnd(getActive(), getEnemy()));
        msgs.push(...applyStatusEnd(getEnemy(), getActive()));
        checkFaint();
      }
      state.message = msgs.filter(Boolean).join(' ');
      msgs.forEach(log);
      return state;
    }

    // #13: Priority moves (Quick Attack = +1) go first regardless of speed
    const playerPri = mv?.effect?.priority || 0;
    const enemyPri  = enemyMvD?.effect?.priority || 0;

    // [A6] Effective speed accounts for speed stat stages and paralysis quartering
    function effectiveSpeed(pokemon) {
      const spdStage = stageMultiplier(pokemon.statStages?.spd ?? 0);
      const paraSlow = pokemon.status === 'paralysis' ? 0.25 : 1;
      return Math.floor(pokemon.spd * spdStage * paraSlow);
    }

    // #7: Speed ties → coin flip
    let playerFirst;
    if (playerPri !== enemyPri) {
      playerFirst = playerPri > enemyPri;
    } else {
      const playerSpd = effectiveSpeed(active);
      const enemySpd  = effectiveSpeed(enemy);
      if (playerSpd !== enemySpd) {
        playerFirst = playerSpd > enemySpd;
      } else {
        playerFirst = roll(2) === 1;   // coin flip on exact speed tie
      }
    }

    if (playerFirst) {
      doAttack(active, moveName, enemy, true);
      // [H9] If attack fired successfully, clear the glitch invulnerability
      if (!getActive().chargingMove) getActive().glitchInvulnerable = false;
      if (state.battle && !checkFaint()) {
        // #56: enemy can't act if bound
        if (!getEnemy().boundState) {
          // [H9] Gen I glitch: Fly/Dig invulnerability persists if release turn fails
          if (getActive().glitchInvulnerable && enemyMv !== 'swift') {
            msgs.push(`${getEnemy().name} used ${enemyMv.toUpperCase()}! But it missed! (target is in the ${moveName === 'fly' ? 'air' : 'ground'}!)`);
          } else {
            doAttack(getEnemy(), enemyMv, getActive(), false);
            checkFaint();
          }
        }
      }
    } else {
      // #56: enemy can't act if bound
      if (!enemy.boundState) {
        doAttack(enemy, enemyMv, active, false);
      }
      if (state.battle && !checkFaint()) {
        doAttack(getActive(), moveName, getEnemy(), true);
        // [H9] Clear glitch invulnerability after player attacks on non-playerFirst turn
        if (!getActive().chargingMove) getActive().glitchInvulnerable = false;
        if (state.battle) checkFaint();
      }
    }

    // End-of-turn status damage (only if battle still active)
    if (state.battle) {
      msgs.push(...applyStatusEnd(getActive(), getEnemy()));
      msgs.push(...applyStatusEnd(getEnemy(), getActive()));
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
    // [A9] Gen I escape formula: (playerSpd*32)/floor(enemySpd/4) + 30*runAttempts; auto-succeed ≥255
    battle.runAttempts = (battle.runAttempts || 0) + 1;
    const enemySpdDiv = Math.max(1, Math.floor(enemy.spd / 4));
    const esc = Math.floor((active.spd * 32) / enemySpdDiv) + 30 * battle.runAttempts;
    if (esc >= 255 || roll(256) < esc) {
      // [A14] Reset volatile state when running away
      for (const p of state.player.party) resetVolatileState(p);
      state.screen = 'overworld'; state.battle = null;
      state.message = 'Got away safely!'; log(state.message);
    } else {
      msgs.push("Can't escape!");
      doAttack(enemy, battle.isTrainer ? selectEnemyMove() : selectWildMove(enemy), active, false);
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
    // #F2: bag is the canonical ball store (mart_buy writes here); items is a legacy fallback
    const ballCount = (state.player.bag?.[ball] ?? 0) + (state.player.items?.[ball] ?? 0);
    if (ballCount < 1) {
      state.message = `No ${ball.replace(/_/g, ' ')} left!`;
      return state;
    }
    // Decrement from bag first, then items
    if ((state.player.bag?.[ball] ?? 0) > 0) state.player.bag[ball]--;
    else state.player.items[ball]--;

    // #19: Real Gen I catch formula
    const result = attemptCatch(ball, enemy);
    const shakeDesc = ['Oh no! It escaped!', '1 shake...', '2 shakes...', '3 shakes...', 'Gotcha!'];
    if (result.shakes > 0 && result.shakes < 4) {
      msgs.push(`The ball shook ${result.shakes} time(s)... ${enemy.name} broke free!`);
    }
    if (result.caught) {
      battle.outcome = 'caught';
      msgs.push(`${enemy.name} was caught!`);
      if (state.pokedex) {  // [G1] Mark seen + caught in Pokédex
        state.pokedex.seen[enemy.species] = true;
        state.pokedex.caught[enemy.species] = true;
      }
      const caught = JSON.parse(JSON.stringify(enemy));
      // [B6] Stamp OT and otId on capture
      caught.ot = state.player.name || 'TRAINER';
      caught.otId = 10000 + (roll(90000) - 1);  // 10000-99999
      if (state.player.party.length < 6) {
        state.player.party.push(caught);
        msgs.push(`${caught.name} was added to your party!`);
      } else {
        // [G3] Send to current PC box; fail if that box is full (20/20)
        if (!state.player.pcBoxes) {
          state.player.pcBoxes = Array.from({ length: 12 }, () => []);
          state.player.currentBox = 0;
        }
        const boxIdx = state.player.currentBox ?? 0;
        const targetBox = state.player.pcBoxes[boxIdx];
        if (targetBox.length >= 20) {
          msgs.push(`BOX ${boxIdx + 1} is FULL! ${caught.name} could not be stored. Switch boxes at a PC and try again (pc_switch_box).`);
          // Catch fails — release the Poké Ball
        } else {
          targetBox.push(caught);
          msgs.push(`${caught.name} was sent to BOX ${boxIdx + 1}!`);
        }
      }
      // [A14] Reset volatile state when battle ends via catch
      for (const p of state.player.party) resetVolatileState(p);
      state.screen = 'overworld'; state.battle = null;
    } else {
      if (result.shakes === 0) msgs.push(`${enemy.name} broke free immediately!`);
      doAttack(enemy, selectWildMove(enemy), active, false);
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

    if ((item === 'potion' || item === 'super_potion' || item === 'hyper_potion') && bag[item] > 0) {
      const heal = item === 'potion' ? 20 : item === 'super_potion' ? 50 : 200;
      if (target.currentHp > 0) {
        const healed = Math.min(heal, target.maxHp - target.currentHp);
        target.currentHp += healed;
        bag[item]--;
        msgs.push(`Used ${itemName} on ${target.name}. +${healed} HP.`);
        used = true;
      }
    } else if ((item === 'max_potion' || item === 'full_restore') && (bag[item] ?? 0) > 0 && target.currentHp > 0) {
      const hpBefore = target.currentHp;
      target.currentHp = target.maxHp;
      bag[item]--;
      if (item === 'full_restore') {
        const cured = target.status; target.status = null; target.statusTurns = 0;
        target.confused = false; target.confusedTurns = 0;
        msgs.push(`Used Full Restore on ${target.name}. HP fully restored${cured ? ` and ${cured} cured` : ''}!`);
      } else {
        msgs.push(`Used Max Potion on ${target.name}. +${target.maxHp - hpBefore} HP. HP fully restored!`);
      }
      used = true;
    } else if ((item === 'revive' || item === 'max_revive') && (bag[item] ?? 0) > 0 && target.currentHp <= 0) {
      const reviveHp = item === 'max_revive' ? target.maxHp : Math.max(1, Math.floor(target.maxHp / 2));
      target.currentHp = reviveHp;
      target.status = null; target.statusTurns = 0;
      bag[item]--;
      msgs.push(`Used ${itemName} on ${target.name}. ${target.name} was revived with ${reviveHp} HP!`);
      used = true;
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
    } else if (item === 'burn_heal' && bag.burn_heal > 0 && target.status === 'burn') {
      target.status = null;
      bag.burn_heal--;
      msgs.push(`Used Burn Heal on ${target.name}. Burn healed!`);
      used = true;
    } else if (item === 'awakening' && bag.awakening > 0 && target.status === 'sleep') {
      target.status = null; target.statusTurns = 0;
      bag.awakening--;
      msgs.push(`Used Awakening on ${target.name}. ${target.name} woke up!`);
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
      doAttack(enemy, battle.isTrainer ? selectEnemyMove() : selectWildMove(enemy), active, false);
      checkFaint();
      state.message = msgs.join(' '); msgs.forEach(log);
    } else {
      state.message = `Can't use ${itemName} right now. Check your bag and Pokémon status.`;
    }
    return state;
  }

  // ── SWITCH ────────────────────────────────────────────────────────────────
  if (type === 'switch' || type === 'switch_pokemon') {
    const active = getActive();
    const enemy  = getEnemy();
    const next = state.player.party[action.party_index];
    if (!next) { state.message = 'Invalid party slot.'; return state; }
    if (next.currentHp <= 0) { state.message = `${next.name} has fainted!`; return state; }
    if (action.party_index === battle.playerPartyIndex) { state.message = 'Already in battle!'; return state; }
    msgs.push(`Come back, ${active.name}! Go, ${next.name}!`);
    const prevPartyIndex = battle.playerPartyIndex;
    battle.playerPartyIndex = action.party_index;
    // [G8] Track EXP participants — record both the outgoing and incoming Pokémon
    if (!battle.expParticipants) {
      // First switch: seed with the outgoing Pokémon's index
      battle.expParticipants = [prevPartyIndex];
    }
    if (!battle.expParticipants.includes(action.party_index)) battle.expParticipants.push(action.party_index);
    // [A17] Shift offer: free switch after KO'ing trainer's Pokémon — no enemy attack this turn
    if (state.shiftOffer) {
      state.shiftOffer = false;
      state.message = msgs.join(' '); msgs.forEach(log);
      return state;
    }
    doAttack(enemy, battle.isTrainer ? selectEnemyMove() : selectWildMove(enemy), next, false);
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
      tms: state.player.tms || {},
      tm_count: Object.keys(state.player.tms || {}).length,
      money: state.player.money,
      badges: state.player.badges,
      pc_count: state.player.pcBoxes
        ? state.player.pcBoxes.reduce((s, b) => s + b.length, 0)
        : (state.player.pc || []).length,
      pc_current_box: (state.player.currentBox ?? 0) + 1,
      pc_box_slots_free: state.player.pcBoxes
        ? 20 - (state.player.pcBoxes[state.player.currentBox ?? 0]?.length ?? 0)
        : undefined,
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
        trapping: active.trappingState ? `locked in (${active.trappingState.move}, ${active.trappingState.turnsLeft} turn(s) left)` : undefined,
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
        // [A18] Don't expose exact HP — show percentage bar only (Gen I style)
        currentHp: undefined,
        maxHp: undefined,
        hpPct: Math.round(state.battle.enemy.currentHp / state.battle.enemy.maxHp * 100),
        status: state.battle.enemy.status, type: state.battle.enemy.type,
        bound: state.battle.enemy.boundState ? `bound (${state.battle.enemy.boundState.turnsLeft} turn(s) left)` : undefined,
      },
      // [A17] Shift offer: free switch after KO'ing trainer's Pokémon
      shift_offer: state.shiftOffer || undefined,
      // #5: no throw_ball in trainer battles
      available_actions: isTrainer
        ? ['battle_move (move_index: 0-3)', 'use_item (item: potion|super_potion|antidote|paralyze_heal|burn_heal|awakening|full_heal, target_index: 0-5)', 'switch (party_index: 0-5)', 'switch_pokemon (party_index: 0-5) — alias for switch']
        : ['battle_move (move_index: 0-3)', 'run', 'throw_ball (ball: poke_ball|great_ball|ultra_ball|master_ball)', 'use_item (item: potion|super_potion|antidote|paralyze_heal|burn_heal|awakening|full_heal, target_index: 0-5)', 'switch (party_index: 0-5)'],
    };
  }
  if (state.screen === 'overworld') {
    view.available_actions = [
      'move (direction: north|south|east|west)',
      'talk',
      'cut',
      'use_item (item: potion|super_potion|antidote|paralyze_heal|burn_heal|awakening|full_heal|pp_up|pp_max|tm##|hm##, target_index: 0-5, moveIndex: 0-3 for pp_up/pp_max)',
      'mart_view',
      'mart_buy (item: ..., quantity: N)',
      'mart_sell (item: ..., qty: N)',
      'forget_move (partyIndex: 0-5, moveIndex: 0-3, newMove: "move name")',
      'nickname_pokemon (partyIndex: 0-5, nickname: "NAME")',
      'pc_view',
      'pc_switch_box (box: 0-11)',
      'pc_withdraw (index: 0-19)',
      'pc_deposit (party_index: 0-5)',
      'pc_release (index: 0-19)',
    ];
    // Expose NPC effective positions (for wander/spin)
    if (area.npcs) {
      view.npcs = area.npcs.map(npc => {
        const override = state.npcState?.[state.areaId]?.[npc.id];
        return { id: npc.id, name: npc.name, x: override?.x ?? npc.x, y: override?.y ?? npc.y, dir: override?.dir ?? npc.dir };
      });
    }
    // Expose cut trees and uncollected ground items
    view.cut_trees_cleared = state.cuttedTrees?.[state.areaId] || [];
    view.ground_items = (area.items || [])
      .filter(item => !state.player.flags[`picked_up_${item.id}`])
      .map(i => ({ id: i.id, x: i.x, y: i.y, item: i.item }));
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
