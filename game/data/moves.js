'use strict';
// Move data: power, accuracy, type, category (physical/special/status), effect
// Source: Bulbapedia Gen I move data
const MOVES = {
  // Normal
  "tackle":       { power: 40,  acc: 100, type: "normal",   cat: "physical", effect: null },
  "scratch":      { power: 40,  acc: 100, type: "normal",   cat: "physical", effect: null },
  "growl":        { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "atk", target: "enemy", stages: -1 } },
  "tail whip":    { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -1 } },
  "leer":         { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -1 } },
  "quick attack": { power: 40,  acc: 100, type: "normal",   cat: "physical", effect: { priority: 1 } },
  "hyper fang":   { power: 80,  acc: 90,  type: "normal",   cat: "physical", effect: null },
  "pay day":      { power: 40,  acc: 100, type: "normal",   cat: "physical", effect: null },
  "fury attack":  { power: 15,  acc: 85,  type: "normal",   cat: "physical", effect: null },
  "whirlwind":    { power: 0,   acc: 85,  type: "normal",   cat: "status",   effect: null },
  "smokescreen":  { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  "harden":       { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  "defense curl": { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  "bind":         { power: 15,  acc: 85,  type: "normal",   cat: "physical", effect: null },
  // Gen I: Bite is Normal type (became Dark in Gen II)
  "bite":         { power: 60,  acc: 100, type: "normal",   cat: "physical", effect: { status: "flinch", chance: 10 } },
  // Bide: simplified — user "charges" (0 dmg) for one turn; in Gen I actually 2-3 turns then 2x back
  "bide":         { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: null },
  "slash":        { power: 70,  acc: 100, type: "normal",   cat: "physical", effect: { crit_rate: 8 } },
  "sand attack":  { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  "supersonic":   { power: 0,   acc: 55,  type: "normal",   cat: "status",   effect: null },

  // Grass
  "vine whip":    { power: 45,  acc: 100, type: "grass",    cat: "special",  effect: null },
  "leech seed":   { power: 0,   acc: 90,  type: "grass",    cat: "status",   effect: { status: "leech_seed", chance: 100 } },
  "razor leaf":   { power: 55,  acc: 95,  type: "grass",    cat: "special",  effect: { crit_rate: 8 } },
  "sleep powder": { power: 0,   acc: 75,  type: "grass",    cat: "status",   effect: { status: "sleep", chance: 100 } },
  "stun spore":   { power: 0,   acc: 75,  type: "grass",    cat: "status",   effect: { status: "paralysis", chance: 100 } },

  // Fire
  "ember":        { power: 40,  acc: 100, type: "fire",     cat: "special",  effect: { status: "burn", chance: 10 } },
  "flamethrower": { power: 95,  acc: 100, type: "fire",     cat: "special",  effect: { status: "burn", chance: 10 } },

  // Water
  "water gun":    { power: 40,  acc: 100, type: "water",    cat: "special",  effect: null },
  "bubble":       { power: 20,  acc: 100, type: "water",    cat: "special",  effect: { stat: "spd", target: "enemy", stages: -1 } },
  "withdraw":     { power: 0,   acc: 100, type: "water",    cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  "surf":         { power: 95,  acc: 100, type: "water",    cat: "special",  effect: null },

  // Electric
  "thunder shock": { power: 40, acc: 100, type: "electric", cat: "special",  effect: { status: "paralysis", chance: 10 } },
  "thunder wave":  { power: 0,  acc: 90,  type: "electric", cat: "status",   effect: { status: "paralysis", chance: 100 } },
  "thunderbolt":   { power: 95, acc: 100, type: "electric", cat: "special",  effect: { status: "paralysis", chance: 10 } },

  // Flying
  "gust":         { power: 40,  acc: 100, type: "flying",   cat: "special",  effect: null },
  "peck":         { power: 35,  acc: 100, type: "flying",   cat: "physical", effect: null },

  // Poison
  "poison sting": { power: 15,  acc: 100, type: "poison",   cat: "physical", effect: { status: "poison", chance: 30 } },
  "twineedle":    { power: 25,  acc: 100, type: "bug",      cat: "physical", effect: { status: "poison", chance: 20 } },

  // Bug
  "string shot":  { power: 0,   acc: 95,  type: "bug",      cat: "status",   effect: { stat: "spd", target: "enemy", stages: -1 } },
  "leech life":   { power: 20,  acc: 100, type: "bug",      cat: "physical", effect: null },

  // Rock / Ground
  "rock throw":   { power: 50,  acc: 90,  type: "rock",     cat: "physical", effect: null },
  "rock tomb":    { power: 50,  acc: 80,  type: "rock",     cat: "physical", effect: { stat: "spd", target: "enemy", stages: -1 } },
  "magnitude":    { power: 70,  acc: 100, type: "ground",   cat: "physical", effect: null },
  "dig":          { power: 100, acc: 100, type: "ground",   cat: "physical", effect: null },
  "earthquake":   { power: 100, acc: 100, type: "ground",   cat: "physical", effect: null },
  "screech":      { power: 0,   acc: 85,  type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -2 } },

  // Psychic
  "confusion":    { power: 50,  acc: 100, type: "psychic",  cat: "special",  effect: null },
  "psychic":      { power: 90,  acc: 100, type: "psychic",  cat: "special",  effect: { stat: "spc", target: "enemy", stages: -1 } },

  // Ice
  "ice beam":     { power: 95,  acc: 100, type: "ice",      cat: "special",  effect: { status: "freeze", chance: 10 } },
  "blizzard":     { power: 120, acc: 90,  type: "ice",      cat: "special",  effect: { status: "freeze", chance: 10 } },
};

// ── Gen I Type Effectiveness Chart ────────────────────────────────────────────
// Source: Bulbapedia — matches Gen I exactly, including notable quirks:
//   Ghost → Psychic  = 0x (immune, due to Gen I programming bug)
//   Bug   → Poison   = 2x (changed to 1x in Gen II)
//   Poison → Bug     = 2x (changed to 1x in Gen II)
//   Bug   → Ghost    = 0.5x
//   Bite  is Normal  (Dark type didn't exist in Gen I)
//   Ice   → Fire     = 1x (neutral, not 0.5x)
// Format: attacking_type → { defending_type: multiplier } (only non-1.0 listed)
const TYPE_CHART = {
  normal:   { rock: 0.5, ghost: 0 },
  fighting: { normal: 2, flying: 0.5, poison: 0.5, rock: 2, bug: 0.5, ghost: 0, psychic: 0.5, ice: 2 },
  flying:   { fighting: 2, bug: 2, grass: 2, rock: 0.5, electric: 0.5 },
  poison:   { poison: 0.5, ground: 0.5, rock: 0.5, bug: 2, ghost: 0.5, grass: 2 },
  ground:   { flying: 0, poison: 2, rock: 2, bug: 0.5, fire: 2, grass: 0.5, electric: 2 },
  rock:     { fighting: 0.5, ground: 0.5, flying: 2, bug: 2, fire: 2, ice: 2 },
  bug:      { fighting: 0.5, flying: 0.5, poison: 2, ghost: 0.5, fire: 0.5, grass: 2, psychic: 2 },
  ghost:    { normal: 0, ghost: 2, psychic: 0 },
  fire:     { rock: 0.5, bug: 2, fire: 0.5, water: 0.5, grass: 2, ice: 2, dragon: 0.5 },
  water:    { ground: 2, rock: 2, fire: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
  grass:    { flying: 0.5, poison: 0.5, ground: 2, rock: 2, bug: 0.5, fire: 0.5, water: 2, grass: 0.5, dragon: 0.5 },
  electric: { flying: 2, ground: 0, water: 2, grass: 0.5, electric: 0.5, dragon: 0.5 },
  psychic:  { fighting: 2, poison: 2, psychic: 0.5 },
  ice:      { flying: 2, ground: 2, water: 0.5, grass: 2, ice: 0.5, dragon: 2 },
  dragon:   { dragon: 2 },
};

function getEffectiveness(moveType, defenderTypes) {
  let mult = 1;
  for (const dt of defenderTypes) {
    mult *= TYPE_CHART[moveType]?.[dt] ?? 1;
  }
  return mult;
}

module.exports = { MOVES, TYPE_CHART, getEffectiveness };
