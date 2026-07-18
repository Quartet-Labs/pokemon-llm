// Tile types
const T = {
  PATH:       'path',
  GRASS:      'grass',
  TALL_GRASS: 'tall_grass',
  WALL:       'wall',
  WATER:      'water',
  DOOR:       'door',
  SIGN:       'sign',
  TOWN:       'town',
};

// Simple starter map: 20x15 grid
// Legend: P=path, G=grass, T=tall_grass, W=wall, ~=water, D=door, S=sign, .=town
const MAP_RAW = [
  "WWWWWWWWWWWWWWWWWWWW",
  "W..................PW",
  "W.WWWWWW..WWWWWWW.PW",
  "W.WS....D.......W.PW",
  "W.W.....D.......W.PW",
  "W.WWWWWW..WWWWWWW.PW",
  "W..........GGGGG..PW",
  "WPPPPPPPPPPTTTTTPPGW",
  "W..........TTTTT..GW",
  "W.WWWWWW...GGGGG..PW",
  "W.W.....W.........PW",
  "W.W.....W.PPPPPPPPPW",
  "W.WWWWWWW.........PW",
  "W..................PW",
  "WWWWWWWWWWWWWWWWWWWW",
];

const CHAR_TO_TILE = {
  'W': T.WALL, 'P': T.PATH, 'G': T.GRASS, 'T': T.TALL_GRASS,
  '~': T.WATER, 'D': T.DOOR, 'S': T.SIGN, '.': T.TOWN,
};

const WALKABLE = new Set([T.PATH, T.GRASS, T.TALL_GRASS, T.TOWN, T.DOOR]);
const ENCOUNTER_TILES = new Set([T.GRASS, T.TALL_GRASS]);

function parseMap() {
  return MAP_RAW.map(row => row.split('').map(c => CHAR_TO_TILE[c] || T.WALL));
}

const MAP = parseMap();
const MAP_HEIGHT = MAP.length;
const MAP_WIDTH = MAP[0].length;

// Points of interest
const POI = {
  pokemon_center: { x: 4, y: 3, label: "Pokémon Center" },
  shop:           { x: 10, y: 3, label: "PokéMart" },
  start:          { x: 10, y: 7, label: "Start" },
};

function getTile(x, y) {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return T.WALL;
  return MAP[y][x];
}

function isWalkable(x, y) {
  return WALKABLE.has(getTile(x, y));
}

function hasEncounter(x, y) {
  return ENCOUNTER_TILES.has(getTile(x, y));
}

function getEncounterTerrain(x, y) {
  return getTile(x, y);
}

function getSurroundings(x, y) {
  return {
    north: getTile(x, y - 1),
    south: getTile(x, y + 1),
    east:  getTile(x + 1, y),
    west:  getTile(x - 1, y),
  };
}

module.exports = { T, MAP, MAP_WIDTH, MAP_HEIGHT, POI, getTile, isWalkable, hasEncounter, getEncounterTerrain, getSurroundings };
