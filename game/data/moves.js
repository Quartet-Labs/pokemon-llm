'use strict';
// Move data: power, accuracy, pp, type, category (physical/special/status), effect
// Source: Bulbapedia Gen I move data
// Notable Gen I quirks vs later gens:
//   Vine Whip: 35 BP (not 45 — that's Gen IV+)
//   Gust: Normal type (became Flying in Gen II)
//   No Dark/Steel type — Bite is Normal
const MOVES = {
  // Normal
  "tackle":        { power: 40,  acc: 100, pp: 35, type: "normal",   cat: "physical", effect: null },
  "scratch":       { power: 40,  acc: 100, pp: 35, type: "normal",   cat: "physical", effect: null },
  "growl":         { power: 0,   acc: 100, pp: 40, type: "normal",   cat: "status",   effect: { stat: "atk", target: "enemy", stages: -1 } },
  "tail whip":     { power: 0,   acc: 100, pp: 30, type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -1 } },
  "leer":          { power: 0,   acc: 100, pp: 30, type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -1 } },
  "quick attack":  { power: 40,  acc: 100, pp: 30, type: "normal",   cat: "physical", effect: { priority: 1 } },
  "hyper fang":    { power: 80,  acc: 90,  pp: 15, type: "normal",   cat: "physical", effect: { status: "flinch", chance: 10 } },
  "pay day":       { power: 40,  acc: 100, pp: 20, type: "normal",   cat: "physical", effect: null },
  "fury attack":   { power: 15,  acc: 85,  pp: 20, type: "normal",   cat: "physical", effect: null },
  // Whirlwind: flee effect ends wild battles (trainer battles: fails)
  "whirlwind":     { power: 0,   acc: 85,  pp: 20, type: "normal",   cat: "status",   effect: { flee: "wild" } },
  "smokescreen":   { power: 0,   acc: 100, pp: 20, type: "normal",   cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  "harden":        { power: 0,   acc: 100, pp: 30, type: "normal",   cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  "defense curl":  { power: 0,   acc: 100, pp: 40, type: "normal",   cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  // #23: Bind — traps target for 2-4 turns (bind: true signals multi-turn trap)
  "bind":          { power: 15,  acc: 85,  pp: 20, type: "normal",   cat: "physical", effect: { bind: true } },
  // Gen I: Bite is Normal type (became Dark in Gen II)
  "bite":          { power: 60,  acc: 100, pp: 25, type: "normal",   cat: "physical", effect: { status: "flinch", chance: 10 } },
  // Bide: simplified — treated as status/charge (0 dmg); Gen I actually waits 2-3 turns and returns 2× damage
  "bide":          { power: 0,   acc: 100, pp: 10, type: "normal",   cat: "status",   effect: null },
  "slash":         { power: 70,  acc: 100, pp: 20, type: "normal",   cat: "physical", effect: { crit_rate: 8 } },
  "sand attack":   { power: 0,   acc: 100, pp: 15, type: "normal",   cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  // Supersonic: 55% chance to confuse (Gen I accuracy)
  "supersonic":    { power: 0,   acc: 55,  pp: 20, type: "normal",   cat: "status",   effect: { status: "confusion", chance: 55 } },

  // New Normal moves
  "pound":         { power: 40,  acc: 100, pp: 35, type: "normal",   cat: "physical", effect: null },
  "karate chop":   { power: 50,  acc: 100, pp: 25, type: "normal",   cat: "physical", effect: { crit_rate: 8 } },
  "double slap":   { power: 15,  acc: 85,  pp: 10, type: "normal",   cat: "physical", effect: null },
  "comet punch":   { power: 18,  acc: 85,  pp: 15, type: "normal",   cat: "physical", effect: null },
  "mega punch":    { power: 80,  acc: 85,  pp: 20, type: "normal",   cat: "physical", effect: null },
  "slam":          { power: 80,  acc: 75,  pp: 20, type: "normal",   cat: "physical", effect: null },
  "stomp":         { power: 65,  acc: 100, pp: 20, type: "normal",   cat: "physical", effect: { status: "flinch", chance: 30 } },
  "mega kick":     { power: 120, acc: 75,  pp: 5,  type: "normal",   cat: "physical", effect: null },
  "headbutt":      { power: 70,  acc: 100, pp: 15, type: "normal",   cat: "physical", effect: { status: "flinch", chance: 30 } },
  "horn attack":   { power: 65,  acc: 100, pp: 25, type: "normal",   cat: "physical", effect: null },
  "horn drill":    { power: 1,   acc: 30,  pp: 5,  type: "normal",   cat: "physical", effect: { ohko: true } },
  "body slam":     { power: 85,  acc: 100, pp: 15, type: "normal",   cat: "physical", effect: { status: "paralysis", chance: 30 } },
  "wrap":          { power: 15,  acc: 85,  pp: 20, type: "normal",   cat: "physical", effect: { bind: true } },
  "take down":     { power: 90,  acc: 85,  pp: 20, type: "normal",   cat: "physical", effect: null },
  "thrash":        { power: 90,  acc: 100, pp: 20, type: "normal",   cat: "physical", effect: null },
  "double edge":   { power: 100, acc: 100, pp: 15, type: "normal",   cat: "physical", effect: null },
  "roar":          { power: 0,   acc: 100, pp: 20, type: "normal",   cat: "status",   effect: { flee: "wild" } },
  "sing":          { power: 0,   acc: 55,  pp: 15, type: "normal",   cat: "status",   effect: { status: "sleep", chance: 100 } },
  "sonic boom":    { power: 1,   acc: 90,  pp: 20, type: "normal",   cat: "special",  effect: { fixed_damage: 20 } },
  "disable":       { power: 0,   acc: 55,  pp: 20, type: "normal",   cat: "status",   effect: { disable: true } },
  "hydro pump":    { power: 120, acc: 80,  pp: 5,  type: "water",    cat: "special",  effect: null },
  "psybeam":       { power: 65,  acc: 100, pp: 20, type: "psychic",  cat: "special",  effect: { status: "confusion", chance: 10 } },
  "bubble beam":   { power: 65,  acc: 100, pp: 20, type: "water",    cat: "special",  effect: { stat: "spd", target: "enemy", stages: -1, statChance: 33 } },
  "aurora beam":   { power: 65,  acc: 100, pp: 20, type: "ice",      cat: "special",  effect: { stat: "atk", target: "enemy", stages: -1, statChance: 33 } },
  "hyper beam":    { power: 150, acc: 90,  pp: 5,  type: "normal",   cat: "special",  effect: null },
  "drill peck":    { power: 80,  acc: 100, pp: 20, type: "flying",   cat: "physical", effect: null },
  "submission":    { power: 80,  acc: 80,  pp: 25, type: "fighting", cat: "physical", effect: null },
  "low kick":      { power: 50,  acc: 90,  pp: 20, type: "fighting", cat: "physical", effect: { status: "flinch", chance: 30 } },
  "counter":       { power: 1,   acc: 100, pp: 20, type: "fighting", cat: "physical", effect: { counter: true } },
  "seismic toss":  { power: 1,   acc: 100, pp: 20, type: "fighting", cat: "physical", effect: { level_damage: true } },
  "strength":      { power: 80,  acc: 100, pp: 15, type: "normal",   cat: "physical", effect: null },
  "absorb":        { power: 20,  acc: 100, pp: 20, type: "grass",    cat: "special",  effect: { drain: 50 } },
  "mega drain":    { power: 40,  acc: 100, pp: 15, type: "grass",    cat: "special",  effect: { drain: 50 } },
  "growth":        { power: 0,   acc: 100, pp: 40, type: "normal",   cat: "status",   effect: { stat: "spc", target: "self", stages: 1 } },
  "solar beam":    { power: 120, acc: 100, pp: 10, type: "grass",    cat: "special",  effect: null },
  "poison powder": { power: 0,   acc: 75,  pp: 35, type: "poison",   cat: "status",   effect: { status: "poison", chance: 100 } },
  "spore":         { power: 0,   acc: 100, pp: 15, type: "grass",    cat: "status",   effect: { status: "sleep", chance: 100 } },
  "flash":         { power: 0,   acc: 70,  pp: 20, type: "normal",   cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  "psywave":       { power: 1,   acc: 80,  pp: 15, type: "psychic",  cat: "special",  effect: { level_damage: true } },
  "splash":        { power: 0,   acc: 100, pp: 40, type: "normal",   cat: "status",   effect: null },
  "acid armor":    { power: 0,   acc: 100, pp: 40, type: "poison",   cat: "status",   effect: { stat: "def", target: "self", stages: 2 } },
  "waterfall":     { power: 80,  acc: 100, pp: 15, type: "water",    cat: "physical", effect: null },
  "clamp":         { power: 35,  acc: 75,  pp: 10, type: "water",    cat: "physical", effect: { bind: true } },
  "swift":         { power: 60,  acc: 100, pp: 20, type: "normal",   cat: "special",  effect: { always_hit: true } },
  "skull bash":    { power: 100, acc: 100, pp: 15, type: "normal",   cat: "physical", effect: null },
  "spike cannon":  { power: 20,  acc: 100, pp: 15, type: "normal",   cat: "physical", effect: null },
  "constrict":     { power: 10,  acc: 100, pp: 35, type: "normal",   cat: "physical", effect: { stat: "spd", target: "enemy", stages: -1, statChance: 33 } },
  "amnesia":       { power: 0,   acc: 100, pp: 20, type: "psychic",  cat: "status",   effect: { stat: "spc", target: "self", stages: 2 } },
  "kinesis":       { power: 0,   acc: 65,  pp: 15, type: "psychic",  cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  "soft boiled":   { power: 0,   acc: 100, pp: 10, type: "normal",   cat: "status",   effect: { heal: 50 } },
  "high jump kick":{ power: 85,  acc: 90,  pp: 20, type: "fighting", cat: "physical", effect: null },
  "lick":          { power: 20,  acc: 100, pp: 30, type: "ghost",    cat: "physical", effect: { status: "paralysis", chance: 30 } },
  "smog":          { power: 20,  acc: 70,  pp: 20, type: "poison",   cat: "special",  effect: { status: "poison", chance: 40 } },
  "sludge":        { power: 65,  acc: 100, pp: 20, type: "poison",   cat: "special",  effect: { status: "poison", chance: 30 } },
  "bone club":     { power: 65,  acc: 85,  pp: 20, type: "ground",   cat: "physical", effect: { status: "flinch", chance: 10 } },
  "fire blast":    { power: 120, acc: 85,  pp: 5,  type: "fire",     cat: "special",  effect: { status: "burn", chance: 30 } },
  "crabhammer":    { power: 90,  acc: 85,  pp: 10, type: "water",    cat: "physical", effect: { crit_rate: 8 } },
  "explosion":     { power: 250, acc: 100, pp: 5,  type: "normal",   cat: "physical", effect: null },
  "fury swipes":   { power: 18,  acc: 80,  pp: 15, type: "normal",   cat: "physical", effect: null },
  "bonemerang":    { power: 50,  acc: 90,  pp: 10, type: "ground",   cat: "physical", effect: null },
  "rest":          { power: 0,   acc: 100, pp: 10, type: "psychic",  cat: "status",   effect: { rest: true } },
  "rock slide":    { power: 75,  acc: 90,  pp: 10, type: "rock",     cat: "physical", effect: { status: "flinch", chance: 30 } },
  "sharpen":       { power: 0,   acc: 100, pp: 30, type: "normal",   cat: "status",   effect: { stat: "atk", target: "self", stages: 1 } },
  "conversion":    { power: 0,   acc: 100, pp: 30, type: "normal",   cat: "status",   effect: null },
  "tri attack":    { power: 80,  acc: 100, pp: 10, type: "normal",   cat: "special",  effect: null },
  "super fang":    { power: 1,   acc: 90,  pp: 10, type: "normal",   cat: "physical", effect: { half_hp: true } },
  "substitute":    { power: 0,   acc: 100, pp: 10, type: "normal",   cat: "status",   effect: null },
  "struggle":      { power: 50,  acc: 100, pp: 999,type: "normal",   cat: "physical", effect: null },

  // Ghost
  "night shade":   { power: 1,   acc: 100, pp: 15, type: "ghost",    cat: "special",  effect: { level_damage: true } },
  "confuse ray":   { power: 0,   acc: 100, pp: 10, type: "ghost",    cat: "status",   effect: { status: "confusion", chance: 100 } },

  // Dragon
  "dragon rage":   { power: 1,   acc: 100, pp: 10, type: "dragon",   cat: "special",  effect: { fixed_damage: 40 } },

  // Fighting
  "double kick":   { power: 30,  acc: 100, pp: 30, type: "fighting", cat: "physical", effect: null },
  "jump kick":     { power: 70,  acc: 95,  pp: 25, type: "fighting", cat: "physical", effect: null },
  "rolling kick":  { power: 60,  acc: 85,  pp: 15, type: "fighting", cat: "physical", effect: { status: "flinch", chance: 30 } },

  // Psychic
  "meditate":      { power: 0,   acc: 100, pp: 40, type: "psychic",  cat: "status",   effect: { stat: "atk", target: "self", stages: 1 } },
  "agility":       { power: 0,   acc: 100, pp: 30, type: "psychic",  cat: "status",   effect: { stat: "spd", target: "self", stages: 2 } },
  "teleport":      { power: 0,   acc: 100, pp: 20, type: "psychic",  cat: "status",   effect: { flee: "wild" } },
  "barrier":       { power: 0,   acc: 100, pp: 30, type: "psychic",  cat: "status",   effect: { stat: "def", target: "self", stages: 2 } },
  "reflect":       { power: 0,   acc: 100, pp: 20, type: "psychic",  cat: "status",   effect: { reflect: true } },
  "metronome":     { power: 0,   acc: 100, pp: 10, type: "normal",   cat: "status",   effect: { metronome: true } },
  "minimize":      { power: 0,   acc: 100, pp: 20, type: "normal",   cat: "status",   effect: { stat: "acc", target: "enemy", stages: -1 } },
  "transform":     { power: 0,   acc: 100, pp: 10, type: "normal",   cat: "status",   effect: { transform: true } },
  "swords dance":  { power: 0,   acc: 100, pp: 30, type: "normal",   cat: "status",   effect: { stat: "atk", target: "self", stages: 2 } },
  "mirror move":   { power: 0,   acc: 100, pp: 20, type: "flying",   cat: "status",   effect: { mirror: true } },
  "haze":          { power: 0,   acc: 100, pp: 30, type: "ice",      cat: "status",   effect: { haze: true } },
  "lovely kiss":   { power: 0,   acc: 75,  pp: 10, type: "normal",   cat: "status",   effect: { status: "sleep", chance: 100 } },
  "sky attack":    { power: 140, acc: 90,  pp: 5,  type: "flying",   cat: "physical", effect: null },
  "thunder":       { power: 120, acc: 70,  pp: 10, type: "electric", cat: "special",  effect: { status: "paralysis", chance: 10 } },
  "rage":          { power: 20,  acc: 100, pp: 20, type: "normal",   cat: "physical", effect: null },
  "fissure":       { power: 1,   acc: 30,  pp: 5,  type: "ground",   cat: "physical", effect: { ohko: true } },
  "glare":         { power: 0,   acc: 75,  pp: 30, type: "normal",   cat: "status",   effect: { status: "paralysis", chance: 100 } },
  "poison gas":    { power: 0,   acc: 55,  pp: 40, type: "poison",   cat: "status",   effect: { status: "poison", chance: 100 } },
  "barrage":       { power: 15,  acc: 85,  pp: 20, type: "normal",   cat: "physical", effect: null },
  "fire spin":     { power: 15,  acc: 70,  pp: 15, type: "fire",     cat: "special",  effect: { bind: true } },
  "toxic":         { power: 0,   acc: 85,  pp: 10, type: "poison",   cat: "status",   effect: { status: "toxic", chance: 100 } },
  "petal dance":   { power: 70,  acc: 100, pp: 20, type: "grass",    cat: "special",  effect: null },
  "guillotine":    { power: 1,   acc: 30,  pp: 5,  type: "normal",   cat: "physical", effect: { ohko: true } },
  "egg bomb":      { power: 100, acc: 75,  pp: 10, type: "normal",   cat: "physical", effect: null },
  "whirlpool":     { power: 15,  acc: 70,  pp: 15, type: "water",    cat: "special",  effect: { bind: true } },
  "mist":          { power: 0,   acc: 100, pp: 30, type: "ice",      cat: "status",   effect: { mist: true } },
  "acid":          { power: 40,  acc: 100, pp: 30, type: "poison",   cat: "special",  effect: { stat: "def", target: "enemy", stages: -1, statChance: 33 } },
  "pin missile":   { power: 14,  acc: 85,  pp: 20, type: "bug",      cat: "physical", effect: null },

  // Extra moves needed by learnsets
  "focus energy":  { power: 0,   acc: 100, pp: 30, type: "normal",   cat: "status",   effect: { sharpen: true } },
  "recover":       { power: 0,   acc: 100, pp: 20, type: "normal",   cat: "status",   effect: { heal: 50 } },
  "self destruct": { power: 200, acc: 100, pp: 5,  type: "normal",   cat: "physical", effect: null },
  "hypnosis":      { power: 0,   acc: 60,  pp: 20, type: "psychic",  cat: "status",   effect: { status: "sleep", chance: 100 } },
  "vice grip":     { power: 55,  acc: 100, pp: 30, type: "normal",   cat: "physical", effect: null },
  "wing attack":   { power: 35,  acc: 100, pp: 35, type: "flying",   cat: "physical", effect: null },
  "light screen":  { power: 0,   acc: 100, pp: 30, type: "psychic",  cat: "status",   effect: { reflect: true } },
  "double team":   { power: 0,   acc: 100, pp: 15, type: "normal",   cat: "status",   effect: { stat: "acc", target: "self", stages: 1 } },
  "fire punch":    { power: 75,  acc: 100, pp: 15, type: "fire",     cat: "physical", effect: { status: "burn", chance: 10 } },
  "ice punch":     { power: 75,  acc: 100, pp: 15, type: "ice",      cat: "physical", effect: { status: "freeze", chance: 10 } },
  "thunder punch": { power: 75,  acc: 100, pp: 15, type: "electric", cat: "physical", effect: { status: "paralysis", chance: 10 } },

  // Grass
  // Vine Whip: 35 BP in Gen I (not 45 — Gen IV+); PP: 10 in Gen I
  "vine whip":     { power: 35,  acc: 100, pp: 10, type: "grass",    cat: "special",  effect: null },
  "leech seed":    { power: 0,   acc: 90,  pp: 10, type: "grass",    cat: "status",   effect: { status: "leech_seed", chance: 100 } },
  "razor leaf":    { power: 55,  acc: 95,  pp: 25, type: "grass",    cat: "special",  effect: { crit_rate: 8 } },
  "sleep powder":  { power: 0,   acc: 75,  pp: 15, type: "grass",    cat: "status",   effect: { status: "sleep", chance: 100 } },
  "stun spore":    { power: 0,   acc: 75,  pp: 30, type: "grass",    cat: "status",   effect: { status: "paralysis", chance: 100 } },

  // Fire
  "ember":         { power: 40,  acc: 100, pp: 25, type: "fire",     cat: "special",  effect: { status: "burn", chance: 10 } },
  "flamethrower":  { power: 95,  acc: 100, pp: 15, type: "fire",     cat: "special",  effect: { status: "burn", chance: 10 } },

  // Water
  "water gun":     { power: 40,  acc: 100, pp: 25, type: "water",    cat: "special",  effect: null },
  "bubble":        { power: 20,  acc: 100, pp: 30, type: "water",    cat: "special",  effect: { stat: "spd", target: "enemy", stages: -1 } },
  "withdraw":      { power: 0,   acc: 100, pp: 40, type: "water",    cat: "status",   effect: { stat: "def", target: "self", stages: 1 } },
  "surf":          { power: 95,  acc: 100, pp: 15, type: "water",    cat: "special",  effect: null },

  // Electric
  "thunder shock":  { power: 40, acc: 100, pp: 30, type: "electric", cat: "special",  effect: { status: "paralysis", chance: 10 } },
  "thunder wave":   { power: 0,  acc: 90,  pp: 20, type: "electric", cat: "status",   effect: { status: "paralysis", chance: 100 } },
  "thunderbolt":    { power: 95, acc: 100, pp: 15, type: "electric", cat: "special",  effect: { status: "paralysis", chance: 10 } },

  // Flying
  // Gust: Normal type in Gen I (became Flying in Gen II)
  "gust":          { power: 40,  acc: 100, pp: 35, type: "normal",   cat: "special",  effect: null },
  "peck":          { power: 35,  acc: 100, pp: 35, type: "flying",   cat: "physical", effect: null },

  // Poison
  "poison sting":  { power: 15,  acc: 100, pp: 35, type: "poison",   cat: "physical", effect: { status: "poison", chance: 30 } },
  "twineedle":     { power: 25,  acc: 100, pp: 20, type: "bug",      cat: "physical", effect: { status: "poison", chance: 20 } },

  // Bug
  "string shot":   { power: 0,   acc: 95,  pp: 40, type: "bug",      cat: "status",   effect: { stat: "spd", target: "enemy", stages: -1 } },
  "leech life":    { power: 20,  acc: 100, pp: 15, type: "bug",      cat: "physical", effect: null },

  // Rock / Ground
  "rock throw":    { power: 50,  acc: 90,  pp: 15, type: "rock",     cat: "physical", effect: null },
  "rock tomb":     { power: 50,  acc: 80,  pp: 10, type: "rock",     cat: "physical", effect: { stat: "spd", target: "enemy", stages: -1 } },
  "magnitude":     { power: 70,  acc: 100, pp: 30, type: "ground",   cat: "physical", effect: null },
  "dig":           { power: 100, acc: 100, pp: 10, type: "ground",   cat: "physical", effect: null },
  "earthquake":    { power: 100, acc: 100, pp: 10, type: "ground",   cat: "physical", effect: null },
  "screech":       { power: 0,   acc: 85,  pp: 40, type: "normal",   cat: "status",   effect: { stat: "def", target: "enemy", stages: -2 } },

  // Psychic
  // Confusion (move): 50 BP special + 10% chance to confuse
  "confusion":     { power: 50,  acc: 100, pp: 25, type: "psychic",  cat: "special",  effect: { status: "confusion", chance: 10 } },
  // Psychic: 33% chance to lower Special by 1 stage
  "psychic":       { power: 90,  acc: 100, pp: 10, type: "psychic",  cat: "special",  effect: { stat: "spc", target: "enemy", stages: -1, statChance: 33 } },

  // Ice
  "ice beam":      { power: 95,  acc: 100, pp: 10, type: "ice",      cat: "special",  effect: { status: "freeze", chance: 10 } },
  "blizzard":      { power: 120, acc: 90,  pp: 5,  type: "ice",      cat: "special",  effect: { status: "freeze", chance: 10 } },

  // Dream Eater (referenced in some learnsets)
  "dream eater":   { power: 100, acc: 100, pp: 15, type: "psychic",  cat: "special",  effect: { drain: 50 } },
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
