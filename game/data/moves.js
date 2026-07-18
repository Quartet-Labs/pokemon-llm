// Move data: power, accuracy, type, category (physical/special/status), effect
const MOVES = {
  "tackle":       { power: 40,  acc: 100, type: "normal",   cat: "physical", effect: null },
  "scratch":      { power: 40,  acc: 100, type: "normal",   cat: "physical", effect: null },
  "growl":        { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "atk", target: "enemy", stages: -1 } },
  "tail whip":    { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -1 } },
  "vine whip":    { power: 45,  acc: 100, type: "grass",    cat: "special",  effect: null },
  "ember":        { power: 40,  acc: 100, type: "fire",     cat: "special",  effect: { status: "burn", chance: 10 } },
  "water gun":    { power: 40,  acc: 100, type: "water",    cat: "special",  effect: null },
  "thunder shock":{ power: 40,  acc: 100, type: "electric", cat: "special",  effect: { status: "paralysis", chance: 10 } },
  "thunder wave": { power: 0,   acc: 90,  type: "electric", cat: "status",   effect: { status: "paralysis", chance: 100 } },
  "quick attack": { power: 40,  acc: 100, type: "normal",   cat: "physical", effect: { priority: 1 } },
  "sand attack":  { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  "gust":         { power: 40,  acc: 100, type: "flying",   cat: "special",  effect: null },
  "rock throw":   { power: 50,  acc: 90,  type: "rock",     cat: "physical", effect: null },
  "magnitude":    { power: 70,  acc: 100, type: "ground",   cat: "physical", effect: null },
  "smokescreen":  { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  "withdraw":     { power: 0,   acc: 100, type: "water",    cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  "defense curl": { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  "leech seed":   { power: 0,   acc: 90,  type: "grass",    cat: "status",   effect: { status: "leech_seed", chance: 100 } },
  "hyper fang":   { power: 80,  acc: 90,  type: "normal",   cat: "physical", effect: null },
  "bite":         { power: 60,  acc: 100, type: "dark",     cat: "physical", effect: { status: "flinch", chance: 30 } },
  "pay day":      { power: 40,  acc: 100, type: "normal",   cat: "physical", effect: null },
  // Bug / Forest moves
  "string shot":  { power: 0,   acc: 95,  type: "bug",      cat: "status",   effect: { stat: "spd", target: "enemy", stages: -1 } },
  "poison sting": { power: 15,  acc: 100, type: "poison",   cat: "physical", effect: { status: "poison", chance: 30 } },
  "harden":       { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  // Rock / Ground moves
  "screech":      { power: 0,   acc: 85,  type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -2 } },
  "bind":         { power: 15,  acc: 85,  type: "normal",   cat: "physical", effect: null },
  "rock tomb":    { power: 50,  acc: 80,  type: "rock",     cat: "physical", effect: { stat: "spd", target: "enemy", stages: -1 } },
  // Flying / Normal moves
  "peck":         { power: 35,  acc: 100, type: "flying",   cat: "physical", effect: null },
  "fury attack":  { power: 15,  acc: 85,  type: "normal",   cat: "physical", effect: null },
  "leer":         { power: 0,   acc: 100, type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -1 } },
  "whirlwind":    { power: 0,   acc: 85,  type: "normal",   cat: "status",   effect: null },
  "twineedle":    { power: 25,  acc: 100, type: "bug",      cat: "physical", effect: { status: "poison", chance: 20 } },
  "bubble":       { power: 20,  acc: 100, type: "water",    cat: "special",  effect: { stat: "spd", target: "enemy", stages: -1 } },
  "confusion":    { power: 50,  acc: 100, type: "psychic",  cat: "special",  effect: null },
  "sleep powder": { power: 0,   acc: 75,  type: "grass",    cat: "status",   effect: { status: "sleep", chance: 100 } },
  "stun spore":   { power: 0,   acc: 75,  type: "grass",    cat: "status",   effect: { status: "paralysis", chance: 100 } },
};

// Type effectiveness chart (simplified Gen 1)
const TYPE_CHART = {
  fire:     { grass: 2, water: 0.5, fire: 0.5, rock: 0.5 },
  water:    { fire: 2,  grass: 0.5, water: 0.5, rock: 2 },
  grass:    { water: 2, fire: 0.5,  grass: 0.5, rock: 2, poison: 0.5 },
  electric: { water: 2, flying: 2,  electric: 0.5, ground: 0 },
  normal:   { rock: 0.5, ghost: 0 },
  rock:     { fire: 2,  flying: 2,  normal: 0.5, fighting: 0.5 },
  ground:   { fire: 2,  electric: 2, rock: 2, flying: 0 },
  flying:   { grass: 2, fighting: 2, electric: 0.5, rock: 0.5 },
  poison:   { grass: 2, poison: 0.5, bug: 2 },
  bug:      { grass: 2, poison: 0.5, fire: 0.5, flying: 0.5, psychic: 2 },
  psychic:  { poison: 2, fighting: 2, psychic: 0.5 },
  fighting: { normal: 2, rock: 2, ice: 2, poison: 0.5, bug: 0.5, flying: 0.5, psychic: 0.5 },
  ice:      { water: 0.5, grass: 2, ice: 0.5, flying: 2, ground: 2, dragon: 2 },
  ghost:    { psychic: 2, normal: 0, ghost: 2 },
};

function getEffectiveness(moveType, defenderTypes) {
  let mult = 1;
  for (const dt of defenderTypes) {
    mult *= TYPE_CHART[moveType]?.[dt] ?? 1;
  }
  return mult;
}

module.exports = { MOVES, getEffectiveness };
