// Gen 1 Pokémon subset — stats are approximate to originals
const POKEMON = {
  bulbasaur:  { id: 1,  name: "BULBASAUR",  type: ["grass","poison"], hp: 45, atk: 49, def: 49, spd: 45, moves: ["tackle","growl","vine whip","leech seed"] },
  charmander: { id: 4,  name: "CHARMANDER", type: ["fire"],           hp: 39, atk: 52, def: 43, spd: 65, moves: ["scratch","growl","ember","smokescreen"] },
  squirtle:   { id: 7,  name: "SQUIRTLE",   type: ["water"],          hp: 44, atk: 48, def: 65, spd: 43, moves: ["tackle","tail whip","water gun","withdraw"] },
  pikachu:    { id: 25, name: "PIKACHU",    type: ["electric"],       hp: 35, atk: 55, def: 30, spd: 90, moves: ["thunder shock","growl","quick attack","thunder wave"] },
  rattata:    { id: 19, name: "RATTATA",    type: ["normal"],         hp: 30, atk: 56, def: 35, spd: 72, moves: ["tackle","tail whip","quick attack","hyper fang"] },
  pidgey:     { id: 16, name: "PIDGEY",     type: ["normal","flying"],hp: 40, atk: 45, def: 40, spd: 56, moves: ["tackle","gust","sand attack","quick attack"] },
  meowth:     { id: 52, name: "MEOWTH",     type: ["normal"],         hp: 40, atk: 45, def: 35, spd: 90, moves: ["scratch","growl","bite","pay day"] },
  geodude:    { id: 74, name: "GEODUDE",    type: ["rock","ground"],  hp: 40, atk: 80, def: 100,spd: 20, moves: ["tackle","defense curl","rock throw","magnitude"] },
};

// Wild encounter tables by terrain
const ENCOUNTERS = {
  grass:      ["rattata","pidgey","meowth"],
  tall_grass: ["rattata","pidgey","meowth","geodude","bulbasaur"],
  cave:       ["geodude"],
};

module.exports = { POKEMON, ENCOUNTERS };
