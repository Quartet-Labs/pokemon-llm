// Gen 1 Pokémon — expanded set covering Pallet → Viridian + starters
const POKEMON = {
  // Starters
  bulbasaur:  { id:1,  name:"BULBASAUR",  type:["grass","poison"], hp:45, atk:49, def:49, spd:45, spc:65, moves:["tackle","growl","vine whip","leech seed"] },
  ivysaur:    { id:2,  name:"IVYSAUR",    type:["grass","poison"], hp:60, atk:62, def:63, spd:60, spc:80, moves:["tackle","growl","vine whip","leech seed"] },
  charmander: { id:4,  name:"CHARMANDER", type:["fire"],           hp:39, atk:52, def:43, spd:65, spc:50, moves:["scratch","growl","ember","smokescreen"] },
  charmeleon: { id:5,  name:"CHARMELEON", type:["fire"],           hp:58, atk:64, def:58, spd:80, spc:65, moves:["scratch","growl","ember","smokescreen"] },
  squirtle:   { id:7,  name:"SQUIRTLE",   type:["water"],          hp:44, atk:48, def:65, spd:43, spc:50, moves:["tackle","tail whip","water gun","withdraw"] },
  wartortle:  { id:8,  name:"WARTORTLE",  type:["water"],          hp:59, atk:63, def:80, spd:58, spc:65, moves:["tackle","tail whip","water gun","withdraw"] },

  // Route 1 wilds
  pidgey:     { id:16, name:"PIDGEY",     type:["normal","flying"],hp:40, atk:45, def:40, spd:56, spc:35, moves:["tackle","gust","sand attack","quick attack"] },
  pidgeotto:  { id:17, name:"PIDGEOTTO",  type:["normal","flying"],hp:63, atk:60, def:55, spd:71, spc:50, moves:["gust","sand attack","quick attack","whirlwind"] },
  rattata:    { id:19, name:"RATTATA",    type:["normal"],         hp:30, atk:56, def:35, spd:72, spc:25, moves:["tackle","tail whip","quick attack","hyper fang"] },
  raticate:   { id:20, name:"RATICATE",   type:["normal"],         hp:55, atk:81, def:60, spd:97, spc:50, moves:["tackle","tail whip","quick attack","hyper fang"] },

  // Oak's lab / player starter
  pikachu:    { id:25, name:"PIKACHU",    type:["electric"],       hp:35, atk:55, def:30, spd:90, spc:50, moves:["thunder shock","growl","quick attack","thunder wave"] },
  raichu:     { id:26, name:"RAICHU",     type:["electric"],       hp:60, atk:90, def:55, spd:110,spc:90, moves:["thunder shock","thunder","quick attack","thunder wave"] },

  // Common early wilds (for variety)
  spearow:    { id:21, name:"SPEAROW",    type:["normal","flying"],hp:40, atk:60, def:30, spd:70, spc:31, moves:["peck","growl","leer","fury attack"] },
  meowth:     { id:52, name:"MEOWTH",     type:["normal"],         hp:40, atk:45, def:35, spd:90, spc:40, moves:["scratch","growl","bite","pay day"] },
  geodude:    { id:74, name:"GEODUDE",    type:["rock","ground"],  hp:40, atk:80, def:100,spd:20, spc:30, moves:["tackle","defense curl","rock throw","magnitude"] },
  eevee:      { id:133,name:"EEVEE",      type:["normal"],         hp:55, atk:55, def:50, spd:55, spc:45, moves:["tackle","tail whip","sand attack","quick attack"] },
};

// Wild encounter tables per terrain + area
const ENCOUNTER_TABLES = {
  route_1: {
    tall_grass: [
      { species:'pidgey',  levelMin:2, levelMax:5, rate:55 },
      { species:'rattata', levelMin:2, levelMax:4, rate:45 },
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
