'use strict';
// ── Tile legend ──────────────────────────────────────────────────────────────
const T = {
  PATH:       'path',
  GRASS:      'grass',
  TALL_GRASS: 'tall_grass',
  WALL:       'wall',
  WATER:      'water',
  DOOR:       'door',
  SIGN:       'sign',
  TREE:       'tree',
  BUILDING:   'building',
  LEDGE_S:    'ledge_s',   // can jump south only
  FLOWER:     'flower',
};

const WALKABLE = new Set([T.PATH, T.GRASS, T.TALL_GRASS, T.DOOR, T.FLOWER]);
const ENCOUNTER_TILES = new Set([T.TALL_GRASS]);

// ── Pallet Town (20 wide x 18 tall) ─────────────────────────────────────────
// Main north-south path runs cols 6-7. Player's house SW, Rival's house SE,
// Oak's Lab center-east. North cols 6-7 exit to Route 1.
//
// Col:  0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19
const PALLET_TOWN = {
  id: 'pallet_town',
  name: 'Pallet Town',
  width: 20,
  height: 18,
  // P=path T=tree B=building D=door S=sign ~=water
  tiles: [
    "TTTTTTPPPPTTTTTTTTTT",  // 0  route-1 exit: cols 6-9
    "TTTTTTPPPPTTTTTTTTTT",  // 1
    "TTTTTTPPPPBBBBBBTTTT",  // 2  oak's lab (cols 10-15)
    "TTTTTTPPPPBBBBBBTTTT",  // 3
    "TTTTTTPPPPBBBBBBTTTT",  // 4
    "TTTTTTPPPPBBBBBBTTTT",  // 5
    "TTTTTTPPPPBBBBBBTTTT",  // 6
    "TTTTTTPPPPBBBBBBTTTT",  // 7
    "TTTTTTPPPPDDDDbbtttt",  // 8  lab doors cols 10-13
    "TTTTTTPPPPPPPPPPTTTT",  // 9  path widens south of lab
    "TTBBBBPPPPPPPPPPTTTT",  // 10 player's house (cols 2-5)
    "TTBBBBPPPPPPPPBBTTTT",  // 11 rival's house (cols 14-17 → using 12-15)
    "TTBBBBPPPPPPPPBBTTTT",  // 12
    "TTDDDDppppppppDDtttt",  // 13 doors
    "TTTTSSPPPPPPPPSTTTT",   // 14 signs (col 4, col 15)
    "TTTTTTPPPPPPPPTTTTTT",  // 15
    "~~~~~~~~~~~~~~~~~~~~",  // 16 water
    "~~~~~~~~~~~~~~~~~~~~",  // 17
  ],
  objects: [
    // Oak's Lab building (cols 10-15, rows 2-7)
    ...rect(10,2,6,6,'building'),
    // Lab doors (cols 10-11, row 8)
    { x:10,y:8,tile:T.DOOR }, { x:11,y:8,tile:T.DOOR },
    // Player's house (cols 2-5, rows 10-12)
    ...rect(2,10,4,3,'building'),
    // Player's house door (cols 2-3, row 13)
    { x:2,y:13,tile:T.DOOR }, { x:3,y:13,tile:T.DOOR },
    // Rival's house (cols 12-15, rows 11-12)
    ...rect(12,11,4,2,'building'),
    // Rival's house door
    { x:12,y:13,tile:T.DOOR }, { x:13,y:13,tile:T.DOOR },
    // Signs
    { x:4, y:14,tile:T.SIGN },
    { x:13,y:14,tile:T.SIGN },
  ],
  npcs: [
    { id:'oak_intro', x:8, y:9, name:'Prof. Oak', dir:'south',
      dialogue:["OAK: This world is inhabited by creatures called POKéMON! I study them as a profession. You'll encounter them in the wild. Choose your POKéMON wisely before venturing out."] },
    { id:'girl_pallet', x:9, y:12, name:'Girl', dir:'east',
      dialogue:["I wonder when PROF. OAK will be back in his lab..."] },
  ],
  signs: [
    { x:4,  y:14, text:"PALLET TOWN\nShades of your journey await!" },
    { x:13, y:14, text:"OAK POKéMON RESEARCH LABORATORY\nProf. OAK resides here." },
  ],
  warps: [
    { x:2,  y:13, dest:'players_house', destX:3, destY:4, areaName:"Player's House" },
    { x:3,  y:13, dest:'players_house', destX:4, destY:4, areaName:"Player's House" },
    { x:12, y:13, dest:'rivals_house',  destX:3, destY:4, areaName:"Rival's House"  },
    { x:13, y:13, dest:'rivals_house',  destX:4, destY:4, areaName:"Rival's House"  },
    { x:10, y:8,  dest:'oaks_lab',      destX:5, destY:8, areaName:"Oak's Lab"      },
    { x:11, y:8,  dest:'oaks_lab',      destX:6, destY:8, areaName:"Oak's Lab"      },
  ],
  connections: {
    north: { area:'route_1', entryX:7, entryY:34 },
  },
};

// ── Route 1 (20 wide x 36 tall) ──────────────────────────────────────────────
const ROUTE_1 = {
  id: 'route_1',
  name: 'Route 1',
  width: 20,
  height: 36,
  tiles: buildRoute1(),
  objects: [],
  npcs: [
    { id:'youngster_r1a', x:6, y:24, name:'Youngster', dir:'south',
      dialogue:["If you're heading to VIRIDIAN CITY, watch out for wild POKéMON in the tall grass!"] },
    { id:'mart_clerk_r1', x:10, y:18, name:'Poké Mart Clerk', dir:'south',
      dialogue:["Hi! We're having a sale at the VIRIDIAN CITY POKé MART! Here, have a free POTION!", {give:'potion',qty:1}] },
  ],
  signs: [
    { x:9, y:28, text:"ROUTE 1\nPALLET TOWN ↓\nVIRIDIAN CITY ↑" },
  ],
  encounters: {
    tall_grass: [
      { species:'pidgey',  level:[2,5], rate:55 },
      { species:'rattata', level:[2,4], rate:45 },
    ],
  },
  connections: {
    north: { area:'viridian_city', entryX:9, entryY:27 },
    south: { area:'pallet_town',   entryX:7, entryY:14 },
  },
  warps: [],
};

// ── Viridian City (30 wide x 30 tall) ────────────────────────────────────────
const VIRIDIAN_CITY = {
  id: 'viridian_city',
  name: 'Viridian City',
  width: 30,
  height: 30,
  tiles: buildViridianCity(),
  objects: [],
  npcs: [
    { id:'old_man', x:9, y:6, name:'Old Man', dir:'south',
      dialogue:["ZZZ... hm? Oh! Sorry, I was napping. I haven't had my coffee yet this morning. I can't function without my morning coffee!"],
      blocksNorth: true },
    { id:'girl_viridian', x:11, y:7, name:'Girl', dir:'east',
      dialogue:["That old man sure loves his coffee... He's always dozing off there."] },
    { id:'gym_sign_npc', x:17, y:4, name:'Youngster', dir:'south',
      dialogue:["The VIRIDIAN GYM is closed. The leader has been away for quite some time..."] },
  ],
  signs: [
    { x:8,  y:10, text:"VIRIDIAN CITY\nThe Eternally Green Paradise." },
    { x:18, y:3,  text:"VIRIDIAN GYM\nGym Leader: ???\nThis Gym's LEADER is out on personal business!" },
    { x:11, y:14, text:"POKéMON CENTER\nWe restore your tired POKéMON to full health." },
    { x:17, y:10, text:"POKé MART\nVIRIDIAN CITY BRANCH" },
  ],
  warps: [
    { x:11, y:15, dest:'pokemon_center', destX:5,  destY:8,  areaName:'Pokémon Center' },
    { x:12, y:15, dest:'pokemon_center', destX:6,  destY:8,  areaName:'Pokémon Center' },
    { x:17, y:11, dest:'poke_mart',      destX:4,  destY:8,  areaName:'Poké Mart'      },
    { x:18, y:11, dest:'poke_mart',      destX:5,  destY:8,  areaName:'Poké Mart'      },
  ],
  connections: {
    south: { area:'route_1', entryX:7, entryY:0 },
    // north blocked by old man until parcel delivered
    // west → route_22 (future)
  },
  warpsSpecial: {
    pokemon_center: { healParty: true },
    poke_mart:      { shop: ['pokeball','potion','antidote'] },
  },
};

// ── Map builders ─────────────────────────────────────────────────────────────
function rect(x, y, w, h, tile) {
  const cells = [];
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      cells.push({ x: x+dx, y: y+dy, tile });
  return cells;
}

function buildRoute1() {
  // 20 wide, 36 tall
  // Path runs through center (cols 7-12), tall grass on sides
  const rows = [];
  for (let y = 0; y < 36; y++) {
    let row = '';
    for (let x = 0; x < 20; x++) {
      if (x === 0 || x === 19) { row += 'T'; continue; }
      // Path corridor
      if (x >= 7 && x <= 12) { row += 'P'; continue; }
      // Ledges at specific rows (can jump south)
      if ((y === 10 || y === 20) && x >= 7 && x <= 12) { row += 'L'; continue; }
      // Tall grass patches — S-curve pattern
      const inGrassPatch = (
        (y >= 5  && y <= 12 && x >= 2  && x <= 6) ||
        (y >= 14 && y <= 20 && x >= 13 && x <= 17) ||
        (y >= 22 && y <= 29 && x >= 2  && x <= 6) ||
        (y >= 22 && y <= 29 && x >= 14 && x <= 17)
      );
      if (inGrassPatch) { row += 'G'; continue; }
      row += 'T'; // tree/wall
    }
    rows.push(row);
  }
  // South end connects to pallet town — open up cols 7-12
  rows[35] = 'TTTTTTTPPPPPPTTTTTTT';
  rows[34] = 'TTTTTTTPPPPPPTTTTTTT';
  // North end connects to viridian — open up cols 7-12
  rows[0]  = 'TTTTTTTPPPPPPTTTTTTT';
  rows[1]  = 'TTTTTTTPPPPPPTTTTTTT';
  return rows;
}

function buildViridianCity() {
  const rows = [];
  for (let y = 0; y < 30; y++) {
    let row = '';
    for (let x = 0; x < 30; x++) {
      if (x === 0 || x === 29 || y === 0 || y === 29) { row += 'T'; continue; }
      row += 'P'; // default path/town
    }
    rows.push(row);
  }
  // Trees around perimeter depth 2
  for (let y = 1; y < 4; y++)
    for (let x = 1; x < 29; x++)
      if (y < 3 || x < 3 || x > 26) rows[y] = setChar(rows[y], x, 'T');

  // Pokémon Center (cols 10-14, rows 12-15)
  for (let y = 12; y <= 15; y++)
    for (let x = 10; x <= 14; x++)
      rows[y] = setChar(rows[y], x, y < 15 ? 'B' : x >= 11 && x <= 12 ? 'D' : 'B');

  // Poké Mart (cols 16-20, rows 8-11)
  for (let y = 8; y <= 11; y++)
    for (let x = 16; x <= 20; x++)
      rows[y] = setChar(rows[y], x, y < 11 ? 'B' : x >= 17 && x <= 18 ? 'D' : 'B');

  // Gym (cols 15-19, rows 2-5) — locked
  for (let y = 2; y <= 5; y++)
    for (let x = 15; x <= 19; x++)
      rows[y] = setChar(rows[y], x, 'B');

  // Old man NPC blocks north passage (cols 8-10, row 5) with tree tiles
  // (handled in NPC logic, not tiles)

  // Route 1 south exit — cols 7-12, row 29
  rows[29] = setChar(rows[29], 8,  'P');
  rows[29] = setChar(rows[29], 9,  'P');
  rows[29] = setChar(rows[29], 10, 'P');
  rows[28] = setChar(rows[28], 8,  'P');
  rows[28] = setChar(rows[28], 9,  'P');
  rows[28] = setChar(rows[28], 10, 'P');

  // Signs
  [8, 11, 17].forEach(x => { rows[10] = setChar(rows[10], x, 'S'); });
  rows[3] = setChar(rows[3], 18, 'S');

  return rows;
}

function setChar(str, idx, ch) {
  return str.slice(0, idx) + ch + str.slice(idx + 1);
}

// ── Raw tile char → tile type ─────────────────────────────────────────────────
const CHAR_TO_TILE = {
  'P': T.PATH, 'p': T.PATH,
  'G': T.TALL_GRASS, 'g': T.TALL_GRASS,
  'T': T.TREE,
  'W': T.WALL, 'w': T.WALL,
  '~': T.WATER,
  'D': T.DOOR, 'd': T.DOOR,
  'S': T.SIGN, 's': T.SIGN,
  'B': T.BUILDING, 'b': T.BUILDING,
  'L': T.LEDGE_S, 'l': T.LEDGE_S,
  'F': T.FLOWER, 'f': T.FLOWER,
  'O': T.PATH, 'o': T.PATH,
};

// ── Area registry ─────────────────────────────────────────────────────────────
const AREAS = {
  pallet_town:   PALLET_TOWN,
  route_1:       ROUTE_1,
  viridian_city: VIRIDIAN_CITY,
};

// ── Tile accessors ─────────────────────────────────────────────────────────────
function getAreaTile(area, x, y) {
  if (x < 0 || y < 0 || x >= area.width || y >= area.height) return T.WALL;
  // Check object overrides first
  if (area.objects) {
    const obj = area.objects.find(o => o.x === x && o.y === y);
    if (obj) return obj.tile;
  }
  const row = (area.tiles || [])[y] || '';
  const ch = row[x] || 'T';
  return CHAR_TO_TILE[ch] || T.WALL;
}

function isWalkable(area, x, y, gameState) {
  const tile = getAreaTile(area, x, y);
  if (!WALKABLE.has(tile)) return false;
  // Check NPC blocking
  if (area.npcs) {
    for (const npc of area.npcs) {
      if (npc.x === x && npc.y === y) return false;
      if (npc.blocksNorth && npc.x === x && npc.y === y) return false;
    }
  }
  return true;
}

function hasEncounter(area, x, y) {
  return ENCOUNTER_TILES.has(getAreaTile(area, x, y));
}

function getSurroundings(area, x, y) {
  return {
    north: getAreaTile(area, x, y-1),
    south: getAreaTile(area, x, y+1),
    east:  getAreaTile(area, x+1, y),
    west:  getAreaTile(area, x-1, y),
  };
}

function getWarpAt(area, x, y) {
  return (area.warps || []).find(w => w.x === x && w.y === y) || null;
}

function getSignAt(area, x, y) {
  // Check one tile north of player (facing north convention) or at position
  return (area.signs || []).find(s => s.x === x && s.y === y) || null;
}

function getNpcAt(area, x, y) {
  return (area.npcs || []).find(n => n.x === x && n.y === y) || null;
}

module.exports = {
  T, AREAS, WALKABLE, ENCOUNTER_TILES,
  getAreaTile, isWalkable, hasEncounter, getSurroundings,
  getWarpAt, getSignAt, getNpcAt,
};
