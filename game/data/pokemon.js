'use strict';
// Gen 1 Pokémon — base stats and learnsets sourced from Bulbapedia
// Base stat formula used: maxHp = floor(base.hp * 2 * level / 100) + level + 10
//                         stat  = floor(base.stat * 2 * level / 100) + 5
// Moves listed are what the Pokémon knows at the level it would first be encountered
const POKEMON = {
  // ── Starters ──────────────────────────────────────────────────────────────
  bulbasaur:  { id:1,  name:"BULBASAUR",  type:["grass","poison"], hp:45, atk:49, def:49, spd:45, spc:65,
                moves:["tackle","growl","leech seed","vine whip"] },
  ivysaur:    { id:2,  name:"IVYSAUR",    type:["grass","poison"], hp:60, atk:62, def:63, spd:60, spc:80,
                moves:["tackle","growl","leech seed","vine whip"] },
  venusaur:   { id:3,  name:"VENUSAUR",   type:["grass","poison"], hp:80, atk:82, def:83, spd:80, spc:100,
                moves:["tackle","growl","razor leaf","leech seed"] },
  charmander: { id:4,  name:"CHARMANDER", type:["fire"],           hp:39, atk:52, def:43, spd:65, spc:50,
                moves:["scratch","growl","ember","smokescreen"] },
  charmeleon: { id:5,  name:"CHARMELEON", type:["fire"],           hp:58, atk:64, def:58, spd:80, spc:65,
                moves:["scratch","growl","ember","smokescreen"] },
  charizard:  { id:6,  name:"CHARIZARD",  type:["fire","flying"],  hp:78, atk:84, def:78, spd:100,spc:85,
                moves:["scratch","growl","ember","flamethrower"] },
  squirtle:   { id:7,  name:"SQUIRTLE",   type:["water"],          hp:44, atk:48, def:65, spd:43, spc:50,
                moves:["tackle","tail whip","water gun","withdraw"] },
  wartortle:  { id:8,  name:"WARTORTLE",  type:["water"],          hp:59, atk:63, def:80, spd:58, spc:65,
                moves:["tackle","tail whip","water gun","withdraw"] },
  blastoise:  { id:9,  name:"BLASTOISE",  type:["water"],          hp:79, atk:83, def:100,spd:78, spc:85,
                moves:["tackle","tail whip","water gun","surf"] },

  // ── Route 1 / Viridian area ────────────────────────────────────────────────
  // Gen I: Bite was Normal type
  caterpie:   { id:10, name:"CATERPIE",   type:["bug"],            hp:45, atk:30, def:35, spd:45, spc:20,
                moves:["tackle","string shot"] },
  metapod:    { id:11, name:"METAPOD",    type:["bug"],            hp:50, atk:20, def:55, spd:30, spc:25,
                moves:["harden"] },
  butterfree: { id:12, name:"BUTTERFREE", type:["bug","flying"],   hp:60, atk:45, def:50, spd:70, spc:80,
                moves:["confusion","sleep powder","stun spore","gust"] },
  weedle:     { id:13, name:"WEEDLE",     type:["bug","poison"],   hp:35, atk:35, def:30, spd:50, spc:20,
                moves:["poison sting","string shot"] },
  kakuna:     { id:14, name:"KAKUNA",     type:["bug","poison"],   hp:45, atk:25, def:50, spd:35, spc:25,
                moves:["harden"] },
  beedrill:   { id:15, name:"BEEDRILL",   type:["bug","poison"],   hp:65, atk:80, def:40, spd:75, spc:45,
                moves:["twineedle","fury attack","poison sting","string shot"] },
  pidgey:     { id:16, name:"PIDGEY",     type:["normal","flying"],hp:40, atk:45, def:40, spd:56, spc:35,
                moves:["tackle","sand attack","gust","quick attack"] },
  pidgeotto:  { id:17, name:"PIDGEOTTO",  type:["normal","flying"],hp:63, atk:60, def:55, spd:71, spc:50,
                moves:["gust","sand attack","quick attack","whirlwind"] },
  rattata:    { id:19, name:"RATTATA",    type:["normal"],         hp:30, atk:56, def:35, spd:72, spc:25,
                moves:["tackle","tail whip","quick attack","hyper fang"] },
  raticate:   { id:20, name:"RATICATE",   type:["normal"],         hp:55, atk:81, def:60, spd:97, spc:50,
                moves:["tackle","tail whip","quick attack","hyper fang"] },
  spearow:    { id:21, name:"SPEAROW",    type:["normal","flying"],hp:40, atk:60, def:30, spd:70, spc:31,
                moves:["peck","growl","leer","fury attack"] },

  // ── Starters #25+ ─────────────────────────────────────────────────────────
  pikachu:    { id:25, name:"PIKACHU",    type:["electric"],       hp:35, atk:55, def:30, spd:90, spc:50,
                moves:["thunder shock","growl","quick attack","thunder wave"] },
  raichu:     { id:26, name:"RAICHU",     type:["electric"],       hp:60, atk:90, def:55, spd:110,spc:90,
                moves:["thunder shock","thunderbolt","quick attack","thunder wave"] },

  // ── Ground / Rock (for Brock and Pewter Gym) ──────────────────────────────
  sandshrew:  { id:27, name:"SANDSHREW",  type:["ground"],         hp:50, atk:75, def:85, spd:40, spc:30,
                moves:["scratch","sand attack","slash","defense curl"] },
  sandslash:  { id:28, name:"SANDSLASH",  type:["ground"],         hp:75, atk:100,def:110,spd:65, spc:55,
                moves:["scratch","sand attack","slash","fury attack"] },

  // ── Diglett line ──────────────────────────────────────────────────────────
  diglett:    { id:50, name:"DIGLETT",    type:["ground"],         hp:10, atk:55, def:25, spd:95, spc:45,
                moves:["scratch","growl","dig","sand attack"] },
  dugtrio:    { id:51, name:"DUGTRIO",    type:["ground"],         hp:35, atk:80, def:50, spd:120,spc:70,
                moves:["scratch","growl","dig","earthquake"] },

  // ── Common early wilds ────────────────────────────────────────────────────
  meowth:     { id:52, name:"MEOWTH",     type:["normal"],         hp:40, atk:45, def:35, spd:90, spc:40,
                moves:["scratch","growl","bite","pay day"] },
  geodude:    { id:74, name:"GEODUDE",    type:["rock","ground"],  hp:40, atk:80, def:100,spd:20, spc:30,
                moves:["tackle","defense curl","rock throw","magnitude"] },
  graveler:   { id:75, name:"GRAVELER",   type:["rock","ground"],  hp:55, atk:95, def:115,spd:35, spc:45,
                moves:["tackle","defense curl","rock throw","magnitude"] },
  onix:       { id:95, name:"ONIX",       type:["rock","ground"],  hp:35, atk:45, def:160,spd:70, spc:30,
                // Brock's Onix: Tackle, Screech, Bide (Gen I Red/Blue)
                moves:["tackle","screech","bide","bind"] },
  eevee:      { id:133,name:"EEVEE",      type:["normal"],         hp:55, atk:55, def:50, spd:55, spc:45,
                moves:["tackle","tail whip","sand attack","quick attack"] },
};

// ── Wild encounter tables ─────────────────────────────────────────────────────
// Rates: must sum to 100. Sourced from Bulbapedia Gen I data.
// Gen I uses 10-slot encounter tables; rates approximated from slot counts × 10%.
const ENCOUNTER_TABLES = {
  route_1: {
    // Source: Bulbapedia — Route 1 (Gen I): Pidgey 50%, Rattata 50% in Red/Blue
    tall_grass: [
      { species:'pidgey',  levelMin:2, levelMax:5, rate:50 },
      { species:'rattata', levelMin:2, levelMax:4, rate:50 },
    ],
  },
  viridian_forest: {
    // Source: Bulbapedia — Viridian Forest (Gen I, Red version)
    // Red: Caterpie heavy, Weedle also present, Pikachu rare
    tall_grass: [
      { species:'caterpie',  levelMin:3, levelMax:5, rate:35 },
      { species:'weedle',    levelMin:3, levelMax:5, rate:35 },
      { species:'metapod',   levelMin:4, levelMax:6, rate:10 },
      { species:'kakuna',    levelMin:4, levelMax:6, rate:10 },
      { species:'pidgey',    levelMin:4, levelMax:8, rate:7  },
      { species:'pikachu',   levelMin:3, levelMax:5, rate:2  },
      { species:'pidgeotto', levelMin:9, levelMax:9, rate:1  },
    ],
  },
  route_2_north: {
    tall_grass: [
      { species:'pidgey',  levelMin:5, levelMax:8, rate:50 },
      { species:'rattata', levelMin:5, levelMax:7, rate:30 },
      { species:'caterpie',levelMin:4, levelMax:6, rate:10 },
      { species:'weedle',  levelMin:4, levelMax:6, rate:10 },
    ],
  },
};

function rollEncounter(areaId, terrain) {
  const table = ENCOUNTER_TABLES[areaId]?.[terrain];
  if (!table) return null;
  const roll = Math.random() * 100;
  let cumulative = 0;
  for (const entry of table) {
    cumulative += entry.rate;
    if (roll < cumulative) {
      const level = entry.levelMin + Math.floor(Math.random() * (entry.levelMax - entry.levelMin + 1));
      return { species: entry.species, level };
    }
  }
  return null;
}

module.exports = { POKEMON, ENCOUNTER_TABLES, rollEncounter };
