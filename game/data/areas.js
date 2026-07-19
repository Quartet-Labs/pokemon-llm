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
  TREE_CUT:   'tree_cut',  // cuttable tree (field move CUT)
  ITEM_BALL:  'item_ball', // ground item (walkable)
};

const WALKABLE = new Set([T.PATH, T.GRASS, T.TALL_GRASS, T.DOOR, T.FLOWER, T.ITEM_BALL]);
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
    { id:'girl_pallet', x:9, y:12, name:'Girl', dir:'east', wander: true,
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
  encounterRate: 10,
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
  items: [
    { id:'r1_potion', x:9, y:11, item:'potion', qty:1 },
  ],
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
  encounterRate: 0,
  tiles: buildViridianCity(),
  objects: [],
  npcs: [
    { id:'old_man', x:5, y:5, name:'Old Man', dir:'south', spin: true,
      dialogue:["Ahhh, finally had my morning coffee! I feel like a new man! Heading to PEWTER CITY? Take the north path through VIRIDIAN FOREST — but watch out for BUG POKéMON!"] },
    { id:'girl_viridian', x:11, y:7, name:'Girl', dir:'east', wander: true,
      dialogue:["That old man sure loves his coffee... He's always dozing off there."] },
    { id:'gym_sign_npc', x:17, y:4, name:'Youngster', dir:'south',
      dialogue:["The VIRIDIAN GYM is closed. The leader has been away for quite some time..."] },
    { id:'viridian_mart_clerk', x:19, y:10, name:'POKé MART Clerk', dir:'south',
      dialogue:["Welcome to the VIRIDIAN CITY POKé MART! We stock Poké Balls (₽200), Potions (₽300), Antidotes (₽100), and Parlyz Heals (₽200). Use mart_view for the catalog, mart_buy to purchase!"] },
  ],
  signs: [
    { x:8,  y:10, text:"VIRIDIAN CITY\nThe Eternally Green Paradise." },
    { x:18, y:3,  text:"VIRIDIAN GYM\nGym Leader: ???\nThis Gym's LEADER is out on personal business!" },
    { x:11, y:14, text:"POKéMON CENTER\nWe restore your tired POKéMON to full health." },
    { x:17, y:10, text:"POKé MART\nVIRIDIAN CITY BRANCH" },
    { x:9,  y:2,  text:"VIRIDIAN FOREST →\nPEWTER CITY beyond!" },
  ],
  warps: [
    { x:11, y:15, dest:'pokemon_center', destX:5,  destY:6,  areaName:'Pokémon Center' },
    { x:12, y:15, dest:'pokemon_center', destX:6,  destY:6,  areaName:'Pokémon Center' },
    { x:17, y:11, dest:'poke_mart',      destX:3,  destY:5,  areaName:'Poké Mart'      },
    { x:18, y:11, dest:'poke_mart',      destX:4,  destY:5,  areaName:'Poké Mart'      },
  ],
  connections: {
    south: { area:'route_1',   entryX:7,  entryY:0  },
    north: { area:'route_2',   entryX:7,  entryY:22 },  // [E2] now goes through Route 2
    west:  { area:'route_22',  entryX:19, entryY:7  },
  },
};

// ── Viridian Forest (20 wide x 32 tall) ──────────────────────────────────────
const VIRIDIAN_FOREST = {
  id: 'viridian_forest',
  name: 'Viridian Forest',
  width: 20,
  height: 32,
  encounterRate: 25,
  tiles: buildViridianForest(),
  objects: [
    // Cut tree blocking a shortcut through the forest
    { x:5, y:28, tile:T.TREE_CUT },
  ],
  // Source: Bulbapedia — Viridian Forest trainers (Gen I Red/Blue)
  // Bug Catcher 1: Weedle Lv6, Caterpie Lv6 — reward ₽60
  // Bug Catcher 2: Weedle Lv7, Kakuna Lv7, Weedle Lv7 — reward ₽70
  // Bug Catcher 3: Weedle Lv9 — reward ₽90
  npcs: [
    { id:'bug_catcher_1', x:7, y:22, name:'BUG CATCHER', dir:'south', sightRange: 4,
      dialogue:["BUG CATCHER: I like bugs! Do you? Wanna battle?"],
      trainerBattle: {
        trainerName: 'BUG CATCHER',
        party: [
          { species:'weedle',   level:6 },
          { species:'caterpie', level:6 },
        ],
        reward: 60,
        rewardFlag: 'beat_bug_catcher_1',
      },
      dialogueAfter: ["BUG CATCHER: Aw, I lost! Your POKéMON are amazing!"],
    },
    { id:'bug_catcher_2', x:13, y:11, name:'BUG CATCHER', dir:'west', sightRange: 4,
      dialogue:["BUG CATCHER: Bugs are the greatest! My three POKéMON will prove it!"],
      trainerBattle: {
        trainerName: 'BUG CATCHER',
        party: [
          { species:'weedle',  level:7 },
          { species:'kakuna',  level:7 },
          { species:'weedle',  level:7 },
        ],
        reward: 70,
        rewardFlag: 'beat_bug_catcher_2',
      },
      dialogueAfter: ["BUG CATCHER: Your POKéMON are way better than mine!"],
    },
    { id:'bug_catcher_3', x:9, y:8, name:'BUG CATCHER', dir:'south', sightRange: 4,
      dialogue:["BUG CATCHER: My Weedle is the toughest in the forest! Prepare yourself!"],
      trainerBattle: {
        trainerName: 'BUG CATCHER',
        party: [
          { species:'weedle', level:9 },
        ],
        reward: 90,
        rewardFlag: 'beat_bug_catcher_3',
      },
      dialogueAfter: ["BUG CATCHER: You're good! I need to train more!"],
    },
  ],
  signs: [
    { x:9,  y:31, text:"Weaken POKéMON before attempting capture!\nWhen healthy, they may escape!" },
    { x:9,  y:1,  text:"ROUTE 2\nPEWTER CITY beyond." },
  ],
  items: [
    { id:'vforest_antidote', x:5,  y:15, item:'antidote', qty:1 },
    { id:'vforest_pokeball', x:11, y:20, item:'poke_ball', qty:1 },
    { id:'vforest_tm45',     x:3,  y:5,  item:'tm45',      qty:1 },
  ],
  connections: {
    south: { area:'route_2',     entryX:7,  entryY:1  },  // [E2] now exits to Route 2
    north: { area:'pewter_city', entryX:10, entryY:22 },
  },
  warps: [],
};

// ── Pewter City (24 wide x 24 tall) ──────────────────────────────────────────
const PEWTER_CITY = {
  id: 'pewter_city',
  name: 'Pewter City',
  width: 24,
  height: 24,
  encounterRate: 0,
  tiles: buildPewterCity(),
  objects: [],
  // Source: Bulbapedia — Pewter City (Gen I Red/Blue)
  npcs: [
    { id:'gym_guide_pewter', x:7, y:8, name:'Gym Guide', dir:'east',
      dialogue:["GYM GUIDE: BROCK uses ROCK-type POKéMON! WATER or GRASS moves are very effective! His first partner is GEODUDE; his ace is ONIX at level 14."] },
    { id:'youngster_pewter', x:16, y:14, name:'Youngster', dir:'south',
      dialogue:["Yo! Did you come from VIRIDIAN FOREST? I heard someone in there beat all the BUG CATCHERS!"] },
    { id:'scientist_pewter', x:5, y:16, name:'Scientist', dir:'east',
      dialogue:["The PEWTER MUSEUM of SCIENCE is great! We have a fossilized OLD AMBER on display — they say it contains the DNA of an ancient POKéMON!"] },
    { id:'flint_pewter', x:10, y:21, name:'FLINT', dir:'north',
      dialogue:["I'm FLINT! I sell rocks for a living... Business isn't going so well. Have you beaten BROCK yet? He's my son, you know."] },
    { id:'pewter_mart_clerk', x:6, y:13, name:'POKé MART Clerk', dir:'south',
      dialogue:["Welcome to the PEWTER CITY POKé MART! We carry Poké Balls (₽200), Great Balls (₽600), Potions (₽300), Super Potions (₽700), and Antidotes (₽100). Use mart_view for the catalog, mart_buy to purchase!"] },
    { id:'gym_sign_npc', x:11, y:4, name:'Youngster at Gym', dir:'south',
      dialogue:["BROCK is the GYM LEADER here! He uses ROCK-type POKéMON. Enter through those doors!"] },
  ],
  signs: [
    { x:10, y:22, text:"PEWTER CITY\nA Stone Gray City." },
    { x:5,  y:5,  text:"POKéMON CENTER\nWe restore your tired POKéMON to full health!" },
    { x:17, y:5,  text:"PEWTER MUSEUM of SCIENCE\nKnowledge for all ages." },
    { x:5,  y:13, text:"POKé MART\nPEWTER CITY BRANCH" },
    { x:11, y:4,  text:"PEWTER GYM\nGym Leader: BROCK\nSpecialty: ROCK-type\nBOULDER BADGE awarded here." },
  ],
  items: [
    { id:'pewter_potion', x:5, y:18, item:'potion', qty:1 },
  ],
  warps: [
    { x:4,  y:9,  dest:'pewter_pokecenter', destX:4, destY:6, areaName:'Pokémon Center'   },
    { x:5,  y:9,  dest:'pewter_pokecenter', destX:5, destY:6, areaName:'Pokémon Center'   },
    { x:4,  y:14, dest:'pewter_mart',       destX:3, destY:5, areaName:'Poké Mart'        },
    { x:5,  y:14, dest:'pewter_mart',       destX:4, destY:5, areaName:'Poké Mart'        },
    { x:17, y:9,  dest:'pewter_museum',     destX:5, destY:6, areaName:'Pewter Museum'    },
    { x:18, y:9,  dest:'pewter_museum',     destX:6, destY:6, areaName:'Pewter Museum'    },
    { x:10, y:9,  dest:'pewter_gym',        destX:5, destY:8, areaName:'Pewter City Gym'  },
    { x:11, y:9,  dest:'pewter_gym',        destX:6, destY:8, areaName:'Pewter City Gym'  },
  ],
  connections: {
    south: { area:'viridian_forest', entryX:9, entryY:1 },
    // east → Route 3 (future)
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
      // [E4] Ledges at specific rows (must come before path check — was dead code)
      if ((y === 10 || y === 20) && x >= 7 && x <= 12) { row += 'L'; continue; }
      // Path corridor
      if (x >= 7 && x <= 12) { row += 'P'; continue; }
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

function buildViridianForest() {
  // 20 wide x 32 tall. Dense trees with a winding path and tall-grass patches.
  // Path: south entry cols 8-11 → winds left → center → winds right → north exit cols 8-11
  const rows = [];
  for (let y = 0; y < 32; y++) {
    let row = '';
    for (let x = 0; x < 20; x++) {
      if (x === 0 || x === 19) { row += 'T'; continue; }
      // Path definition: winding corridor
      const inPath = (
        (x >= 8 && x <= 11 && y >= 0  && y <= 7)  ||   // south entry straight
        (x >= 5 && x <= 11 && y >= 7  && y <= 10) ||   // veer left
        (x >= 5 && x <= 8  && y >= 10 && y <= 14) ||   // left corridor
        (x >= 5 && x <= 14 && y >= 14 && y <= 17) ||   // cross right
        (x >= 11 && x <= 14 && y >= 17 && y <= 21)||   // right corridor
        (x >= 8  && x <= 14 && y >= 21 && y <= 25)||   // veer back left
        (x >= 8  && x <= 11 && y >= 25 && y <= 32)    // north exit
      );
      // Tall grass: off the path but not at the very edge
      const inGrass = !inPath && x >= 2 && x <= 17 && (
        (y >= 3  && y <= 6  && x >= 2  && x <= 7) ||
        (y >= 11 && y <= 14 && x >= 9  && x <= 17)||
        (y >= 17 && y <= 21 && x >= 2  && x <= 9) ||
        (y >= 23 && y <= 27 && x >= 12 && x <= 17)
      );
      if (inPath) row += 'P';
      else if (inGrass) row += 'G';
      else row += 'T';
    }
    rows.push(row);
  }
  // Ensure clean entry/exit rows
  rows[31] = 'TTTTTTTTTPPPPTTTTTTT';
  rows[30] = 'TTTTTTTTTPPPPTTTTTTT';
  rows[0]  = 'TTTTTTTTTPPPPTTTTTTT';
  rows[1]  = 'TTTTTTTTTPPPPTTTTTTT';
  return rows;
}

function buildPewterCity() {
  // 24 wide x 24 tall
  const rows = [];
  for (let y = 0; y < 24; y++) {
    let row = '';
    for (let x = 0; x < 24; x++) {
      if (x === 0 || x === 23 || y === 0 || y === 23) row += 'T';
      else row += 'P';
    }
    rows.push(row);
  }

  // Perimeter trees depth 1-2
  for (let x = 1; x <= 22; x++) {
    rows[1] = setChar(rows[1], x, 'T');
    rows[2] = setChar(rows[2], x, x < 10 || x > 12 ? 'T' : 'P'); // north exit open cols 10-12
  }

  // Pokémon Center (cols 2-8, rows 5-9)
  for (let y = 5; y <= 9; y++)
    for (let x = 2; x <= 8; x++)
      rows[y] = setChar(rows[y], x, y < 9 ? 'B' : (x === 4 || x === 5) ? 'D' : 'B');

  // Poké Mart (cols 2-8, rows 11-14)
  for (let y = 11; y <= 14; y++)
    for (let x = 2; x <= 8; x++)
      rows[y] = setChar(rows[y], x, y < 14 ? 'B' : (x === 4 || x === 5) ? 'D' : 'B');

  // Museum (cols 15-21, rows 5-9)
  for (let y = 5; y <= 9; y++)
    for (let x = 15; x <= 21; x++)
      rows[y] = setChar(rows[y], x, y < 9 ? 'B' : (x === 17 || x === 18) ? 'D' : 'B');

  // Pewter Gym (cols 9-14, rows 3-9)
  // Outer walls solid building; door at (10,9) and (11,9)
  for (let y = 3; y <= 9; y++) {
    for (let x = 9; x <= 14; x++) {
      if (y === 9) {
        rows[y] = setChar(rows[y], x, (x === 10 || x === 11) ? 'D' : 'B');
      } else if (y === 3 || x === 9 || x === 14) {
        rows[y] = setChar(rows[y], x, 'B'); // outer walls
      } else {
        rows[y] = setChar(rows[y], x, 'P'); // walkable interior columns (unused in overworld)
      }
    }
  }
  // Gym sign on top wall
  rows[3] = setChar(rows[3], 11, 'S');

  // House 1 (cols 15-21, rows 11-16)
  for (let y = 11; y <= 16; y++)
    for (let x = 15; x <= 21; x++)
      rows[y] = setChar(rows[y], x, y < 16 ? 'B' : (x === 17 || x === 18) ? 'D' : 'B');

  // Sign tiles
  rows[5]  = setChar(rows[5],  5,  'S'); // Pokémon center sign
  rows[5]  = setChar(rows[5],  17, 'S'); // Museum sign
  rows[11] = setChar(rows[11], 5,  'S'); // Poké mart sign
  rows[3]  = setChar(rows[3],  11, 'S'); // Gym sign

  // South exit (cols 9-12) at y=23
  rows[23] = setChar(rows[23], 9,  'P');
  rows[23] = setChar(rows[23], 10, 'P');
  rows[23] = setChar(rows[23], 11, 'P');
  rows[22] = setChar(rows[22], 9,  'P');
  rows[22] = setChar(rows[22], 10, 'P');
  rows[22] = setChar(rows[22], 11, 'P');

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
  // Trees around perimeter depth 2, leave north path open at cols 8-10
  for (let y = 1; y < 4; y++)
    for (let x = 1; x < 29; x++)
      if (y < 3 || x < 3 || x > 26) {
        // Keep north path open
        if (y <= 2 && x >= 8 && x <= 10) continue;
        rows[y] = setChar(rows[y], x, 'T');
      }

  // North exit to Viridian Forest: the perimeter loop above walls row 0 as trees,
  // and the "keep north path open" clause only reopened rows 1-2 — so the exit
  // column (connections.north.entryX = 9) was walled at the top row and the player
  // could never step onto the edge to trigger the transition. Reopen row 0 at the
  // exit cols so the north path actually leads out.
  rows[0] = setChar(rows[0], 8,  'P');
  rows[0] = setChar(rows[0], 9,  'P');
  rows[0] = setChar(rows[0], 10, 'P');

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

  // West exit to Route 22 — cols 0, rows 6-8
  rows[6] = setChar(rows[6], 0, 'P');
  rows[7] = setChar(rows[7], 0, 'P');
  rows[8] = setChar(rows[8], 0, 'P');
  rows[6] = setChar(rows[6], 1, 'P');
  rows[7] = setChar(rows[7], 1, 'P');
  rows[8] = setChar(rows[8], 1, 'P');

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

// ── Interior: Player's House ──────────────────────────────────────────────────
// 8 wide x 6 tall simple interior
const PLAYERS_HOUSE = {
  id: 'players_house',
  name: "Player's House",
  width: 8,
  height: 6,
  tiles: [
    "WWWWWWWW",   // 0 north wall
    "WPPPPPPW",   // 1
    "WPPPPPPW",   // 2
    "WPPPPPPW",   // 3
    "WPPPPPPW",   // 4
    "WWWDDWWW",   // 5 south wall with door at cols 3-4
  ],
  objects: [],
  npcs: [
    { id:'mom', x:4, y:2, name:'Mom', dir:'south',
      dialogue:["MOM: Now, don't forget to heal your POKéMON at the POKéMON CENTER before venturing too far!"] },
  ],
  items: [
    { id:'players_house_potion', x:3, y:1, item:'potion', qty:1 },
  ],
  signs: [],
  warps: [
    { x:3, y:5, dest:'pallet_town', destX:2,  destY:13, areaName:'Pallet Town' },
    { x:4, y:5, dest:'pallet_town', destX:3,  destY:13, areaName:'Pallet Town' },
  ],
};

// ── Interior: Rival's House ───────────────────────────────────────────────────
const RIVALS_HOUSE = {
  id: 'rivals_house',
  name: "Rival's House",
  width: 8,
  height: 6,
  tiles: [
    "WWWWWWWW",
    "WPPPPPPW",
    "WPPPPPPW",
    "WPPPPPPW",
    "WPPPPPPW",
    "WWWDDWWW",   // door at cols 3-4
  ],
  objects: [],
  npcs: [
    { id:'gary_sister', x:4, y:2, name:"Gary's Sister", dir:'south',
      dialogue:["DAISY: Hi! My brother Gary went to get his first POKéMON already. He's always so impatient!"] },
  ],
  signs: [],
  warps: [
    { x:3, y:5, dest:'pallet_town', destX:12, destY:13, areaName:'Pallet Town' },
    { x:4, y:5, dest:'pallet_town', destX:13, destY:13, areaName:'Pallet Town' },
  ],
};

// ── Interior: Oak's Lab ───────────────────────────────────────────────────────
// 10 wide x 10 tall
const OAKS_LAB = {
  id: 'oaks_lab',
  name: "Oak's Lab",
  width: 10,
  height: 10,
  tiles: [
    "WWWWWWWWWW",  // 0 north wall
    "WPPPPPPPPW",  // 1
    "WPPPPPPPPW",  // 2
    "WPPPPPPPPW",  // 3
    "WPPPPPPPPW",  // 4
    "WPPPPPPPPW",  // 5
    "WPPPPPPPPW",  // 6
    "WPPPPPPPPW",  // 7
    "WPPPPPPPPW",  // 8
    "WWWWDDWWWW",  // 9 south wall with exit
  ],
  objects: [],
  npcs: [
    { id:'oak_lab', x:5, y:3, name:'Prof. Oak', dir:'south',
      // [D4] Flag-conditional dialogue: parcel return → Pokédex; post-starter hint; default welcome
      flagDialogue: [
        // Player brings Oak's Parcel back → grant Pokédex
        { requireItem: 'oaks_parcel', denyFlag: 'has_pokedex',
          lines: [
            "OAK: Oh! My parcel from the VIRIDIAN CITY POKé MART! You carried it all this way — thank you!",
            { take: 'oaks_parcel' },
            "OAK: Ah, this reminds me — I was going to give you something anyway.",
            "OAK: Here, take this device. It's called a POKéDEX! It automatically records data on any POKéMON you've seen or caught. It's a hi-tech encyclopedia!",
            { setFlag: 'has_pokedex' },
            "OAK: Your very own POKéDEX! Fill it up — there are 151 POKéMON in the world. I know you can do it!",
          ]
        },
        // Already has Pokédex
        { requireFlag: 'has_pokedex',
          lines: [
            "OAK: You already have the POKéDEX! Go out there and complete it. There are 151 POKéMON in the world. Can you find them all?",
          ]
        },
        // Has starter, not yet got parcel
        { requireFlag: 'chose_starter', denyFlag: 'has_pokedex',
          lines: [
            "OAK: Ah, you've made your choice! Now, head north to VIRIDIAN CITY. Visit the POKé MART — they're holding a parcel for me. Bring it back and I'll have a gift for you!",
          ]
        },
        // Default: pre-starter
        { default: true,
          lines: [
            "OAK: Ah, welcome! This is my lab. Those 3 Poké Balls on the table each contain a starter POKéMON. Use the starter_select action to choose one!",
          ]
        },
      ],
    },
    { id:'oak_lab_aide', x:8, y:6, name:"Oak's Aide", dir:'west',
      dialogue:["OAK'S AIDE: The PROFESSOR is studying POKéMON distribution. Ask him about starting your journey!"] },
  ],
  signs: [
    { x:3, y:4, text:"BULBASAUR — The Seed POKéMON" },
    { x:5, y:4, text:"CHARMANDER — The Lizard POKéMON" },
    { x:7, y:4, text:"SQUIRTLE — The Tiny Turtle POKéMON" },
  ],
  warps: [
    { x:4, y:9, dest:'pallet_town', destX:10, destY:8, areaName:'Pallet Town' },
    { x:5, y:9, dest:'pallet_town', destX:11, destY:8, areaName:'Pallet Town' },
  ],
};

// ── Interior: Pokémon Center (Viridian — generic center id) ──────────────────
// 10 wide x 8 tall
const POKEMON_CENTER = {
  id: 'pokemon_center',
  name: 'Pokémon Center',
  width: 10,
  height: 8,
  tiles: [
    "WWWWWWWWWW",  // 0
    "WPPPPPPPPW",  // 1
    "WPPPPPPPPW",  // 2
    "WPPPPPPPPW",  // 3
    "WPPPPPPPPW",  // 4
    "WPPPPPPPPW",  // 5
    "WPPPPPPPPW",  // 6
    "WWWWDDWWWW",  // 7 exit south
  ],
  objects: [],
  npcs: [
    { id:'nurse_joy', x:5, y:2, name:'Nurse Joy', dir:'south',
      dialogue:["NURSE JOY: Welcome to our POKéMON CENTER! We restore your tired POKéMON to full health. Use the heal action to restore your party!"] },
    { id:'pc_terminal', x:3, y:2, name:'PC Terminal', dir:'south',
      dialogue:["A PC terminal. Use pc_deposit and pc_withdraw to manage your Pokémon storage."] },
  ],
  signs: [],
  warps: [
    { x:4, y:7, dest:'viridian_city', destX:11, destY:15, areaName:'Viridian City' },
    { x:5, y:7, dest:'viridian_city', destX:12, destY:15, areaName:'Viridian City' },
  ],
};

// ── Interior: Poké Mart (Viridian — generic mart id) ─────────────────────────
// 8 wide x 7 tall
const POKE_MART = {
  id: 'poke_mart',
  name: 'Poké Mart',
  width: 8,
  height: 7,
  tiles: [
    "WWWWWWWW",  // 0
    "WPPPPPPW",  // 1
    "WPPPPPPW",  // 2
    "WPPPPPPW",  // 3
    "WPPPPPPW",  // 4
    "WPPPPPPW",  // 5
    "WWWDDWWW",  // 6 exit south
  ],
  objects: [],
  npcs: [
    { id:'viridian_mart_clerk_inside', x:4, y:2, name:'POKé MART Clerk', dir:'south',
      // [D4] Gives Oak's Parcel once the player has picked a starter
      flagDialogue: [
        { requireFlag: 'chose_starter',
          denyFlag: 'got_oaks_parcel_from_viridian_mart_clerk_inside',
          lines: [
            "CLERK: Oh! Are you from PALLET TOWN? PROF. OAK asked us to hold this parcel for him — would you please bring it to him?",
            { give: 'oaks_parcel', qty: 1 },
            "CLERK: Please make sure PROF. OAK gets that! Now, is there anything else I can help you with?",
            "CLERK: Welcome to the VIRIDIAN CITY POKé MART! Use mart_view to see items, mart_buy to purchase.",
          ]
        },
        { default: true,
          lines: ["CLERK: Welcome to the VIRIDIAN CITY POKé MART! Use mart_view to see items, mart_buy to purchase."]
        },
      ],
    },
  ],
  signs: [],
  warps: [
    { x:3, y:6, dest:'viridian_city', destX:17, destY:11, areaName:'Viridian City' },
    { x:4, y:6, dest:'viridian_city', destX:18, destY:11, areaName:'Viridian City' },
  ],
};

// ── Interior: Pewter Pokémon Center ──────────────────────────────────────────
const PEWTER_POKECENTER = {
  id: 'pewter_pokecenter',
  name: 'Pewter Pokémon Center',
  width: 10,
  height: 8,
  tiles: [
    "WWWWWWWWWW",
    "WPPPPPPPPW",
    "WPPPPPPPPW",
    "WPPPPPPPPW",
    "WPPPPPPPPW",
    "WPPPPPPPPW",
    "WPPPPPPPPW",
    "WWWWDDWWWW",
  ],
  objects: [],
  npcs: [
    { id:'nurse_joy_pewter', x:5, y:2, name:'Nurse Joy', dir:'south',
      dialogue:["NURSE JOY: Welcome to our POKéMON CENTER! We restore your tired POKéMON to full health. Use the heal action to restore your party!"] },
    { id:'pc_terminal_pewter', x:3, y:2, name:'PC Terminal', dir:'south',
      dialogue:["A PC terminal. Use pc_deposit and pc_withdraw to manage your Pokémon storage."] },
  ],
  signs: [],
  warps: [
    { x:4, y:7, dest:'pewter_city', destX:4, destY:9, areaName:'Pewter City' },
    { x:5, y:7, dest:'pewter_city', destX:5, destY:9, areaName:'Pewter City' },
  ],
};

// ── Interior: Pewter Poké Mart ────────────────────────────────────────────────
const PEWTER_MART = {
  id: 'pewter_mart',
  name: 'Pewter Poké Mart',
  width: 8,
  height: 7,
  tiles: [
    "WWWWWWWW",
    "WPPPPPPW",
    "WPPPPPPW",
    "WPPPPPPW",
    "WPPPPPPW",
    "WPPPPPPW",
    "WWWDDWWW",
  ],
  objects: [],
  npcs: [
    { id:'pewter_mart_clerk_inside', x:4, y:2, name:'POKé MART Clerk', dir:'south',
      dialogue:["Welcome to the PEWTER CITY POKé MART! Use mart_view to see items, mart_buy to purchase."] },
  ],
  signs: [],
  warps: [
    { x:3, y:6, dest:'pewter_city', destX:4, destY:14, areaName:'Pewter City' },
    { x:4, y:6, dest:'pewter_city', destX:5, destY:14, areaName:'Pewter City' },
  ],
};

// ── Interior: Pewter Gym ──────────────────────────────────────────────────────
// Brock and Jr Trainer moved here from Pewter City overworld.
const PEWTER_GYM = {
  id: 'pewter_gym',
  name: 'Pewter City Gym',
  width: 12,
  height: 10,
  tiles: [
    "WWWWWWWWWWWW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WWWWWDDWWWWW",
  ],
  objects: [],
  npcs: [
    { id:'gym_guide_interior', x:6, y:8, name:'GYM GUIDE', dir:'north',
      dialogue:["GYM GUIDE: BROCK uses ROCK-type POKéMON! WATER or GRASS moves are very effective! His ace is ONIX at level 14."] },
    { id:'jr_trainer_pewter', x:5, y:5, name:'JR. TRAINER♂', dir:'south',
      sightRange: 3,
      dialogue:["JR. TRAINER♂: You need to get past me to face BROCK! Go!"],
      trainerBattle: {
        trainerName: 'JR. TRAINER♂',
        party: [{ species:'diglett', level:11 }, { species:'sandshrew', level:11 }],
        reward: 231,
        rewardFlag: 'beat_jr_trainer_pewter',
      },
      dialogueAfter: ["JR. TRAINER♂: I lost! Go on..."],
    },
    { id:'brock', x:6, y:2, name:'BROCK', dir:'south',
      sightRange: 0,
      dialogue:[
        "I'm BROCK! I'm PEWTER's GYM LEADER!",
        "I believe in rock hard defense and determination!",
        "That's why my POKéMON are all the ROCK type!",
        "Do you still want to challenge me?",
        "Fine then! Show me your best!",
      ],
      trainerBattle: {
        trainerName: 'BROCK',
        party: [{ species:'geodude', level:12 }, { species:'onix', level:14 }],
        reward: 1386,
        rewardFlag: 'beat_brock',
        badge: 'boulder_badge',
      },
      dialogueAfter:[
        "I took you for granted.",
        "As proof of your victory, here's the BOULDERBADGE!",
        "That's an official POKéMON LEAGUE BADGE!",
        "Its bearer's POKéMON become more powerful!",
        "The technique FLASH can now be used any time!",
        "Wait! Take this with you! TM34 contains BIDE.",
        { give: 'tm34', qty: 1 },
        "There are all kinds of trainers in the world! Go to the GYM in CERULEAN and test your abilities!",
      ],
    },
  ],
  signs: [
    { x:6, y:1, text:"PEWTER GYM\nGym Leader: BROCK\nSpecialty: ROCK-type POKéMON" },
  ],
  warps: [
    { x:5, y:9, dest:'pewter_city', destX:10, destY:9, areaName:'Pewter City' },
    { x:6, y:9, dest:'pewter_city', destX:11, destY:9, areaName:'Pewter City' },
  ],
};

// ── Interior: Pewter Museum ───────────────────────────────────────────────────
const PEWTER_MUSEUM = {
  id: 'pewter_museum',
  name: 'Pewter Museum',
  width: 12,
  height: 8,
  tiles: [
    "WWWWWWWWWWWW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WPPPPPPPPPPW",
    "WWWWWDDWWWWW",
  ],
  objects: [],
  npcs: [
    { id:'museum_guide', x:6, y:2, name:'Museum Guide', dir:'south',
      dialogue:["Welcome to PEWTER MUSEUM! The DOME FOSSIL can restore KABUTO. The HELIX FOSSIL can restore OMANYTE. These are the mysteries of ancient POKéMON!"] },
    { id:'fossil_amber', x:4, y:3, name:'Display Case', dir:'south',
      dialogue:["OLD AMBER: Scientists say a POKéMON is encased inside... (AERODACTYL)"] },
  ],
  signs: [
    { x:3, y:2, text:"DOME FOSSIL\nFrom the ancient sea..." },
    { x:9, y:2, text:"HELIX FOSSIL\nA rare fossil..." },
  ],
  warps: [
    { x:5, y:7, dest:'pewter_city', destX:17, destY:9, areaName:'Pewter City' },
    { x:6, y:7, dest:'pewter_city', destX:18, destY:9, areaName:'Pewter City' },
  ],
};

// ── Route 22 (20 wide x 15 tall) — west of Viridian, rival encounter ──────────
function buildRoute22() {
  const rows = [];
  for (let y = 0; y < 15; y++) {
    let row = '';
    for (let x = 0; x < 20; x++) {
      // Perimeter trees
      if (y === 0 || y === 14) { row += 'T'; continue; }
      // Path corridor runs west-east through rows 5-9
      if (y >= 5 && y <= 9 && x >= 2 && x <= 17) { row += 'P'; continue; }
      // Tall grass patches north and south of path
      const inGrass = (
        (y >= 1 && y <= 4  && x >= 3 && x <= 16) ||
        (y >= 10 && y <= 13 && x >= 3 && x <= 16)
      );
      if (inGrass) { row += 'G'; continue; }
      row += 'T';
    }
    rows.push(row);
  }
  // East connection to Viridian City at x=19, rows 6-8
  rows[6]  = setChar(rows[6],  19, 'P');
  rows[7]  = setChar(rows[7],  19, 'P');
  rows[8]  = setChar(rows[8],  19, 'P');
  // West terminus (blocked by League gate — just trees for now)
  return rows;
}

const ROUTE_22 = {
  id: 'route_22',
  name: 'Route 22',
  width: 20,
  height: 15,
  encounterRate: 10,
  tiles: buildRoute22(),
  objects: [],
  npcs: [
    { id:'rival_route22', x:10, y:7, name:'RIVAL', dir:'east',
      sightRange: 0,
      dialogue:["RIVAL: So, you finally decided to leave PALLET TOWN. I've already caught 2 POKéMON! Let's battle — I'll show you how it's done!"],
      trainerBattle: {
        trainerName: 'RIVAL',
        party: [
          { species:'charmander', level:9 },
          { species:'pidgey',     level:9 },
        ],
        reward: 350,
        rewardFlag: 'beat_rival_route22',
      },
      dialogueAfter: ["RIVAL: WHAT?! I lost?! Humph! I'll train harder and beat you next time! Just you wait!"],
    },
  ],
  signs: [
    { x:3, y:12, text:"ROUTE 22\nVIRIDIAN CITY →\nPOKéMON LEAGUE Gate ahead..." },
  ],
  encounters: {
    tall_grass: [
      { species:'nidoran_m', levelMin:3, levelMax:7, rate:45 },
      { species:'nidoran_f', levelMin:3, levelMax:7, rate:45 },
      { species:'mankey',    levelMin:3, levelMax:6, rate:10 },
    ],
  },
  connections: {
    east:  { area:'viridian_city', entryX:1, entryY:7  },
    north: { area:'route_23',      entryX:10, entryY:9 },
  },
};

// ── Route 23 (20 wide x 10 tall) — stub, leads toward Victory Road ────────────
function buildRoute23() {
  const rows = [];
  for (let y = 0; y < 10; y++) {
    let row = '';
    for (let x = 0; x < 20; x++) {
      if (x === 0 || x === 19 || y === 0) { row += 'T'; continue; }
      // Central path cols 8-11
      if (x >= 8 && x <= 11) { row += 'P'; continue; }
      // Sparse tall grass on the sides
      const inGrass = (
        (y >= 3 && y <= 7 && x >= 2 && x <= 6) ||
        (y >= 3 && y <= 7 && x >= 13 && x <= 17)
      );
      if (inGrass) { row += 'G'; continue; }
      row += 'T';
    }
    rows.push(row);
  }
  // South connection to Route 22
  rows[9] = setChar(rows[9], 9,  'P');
  rows[9] = setChar(rows[9], 10, 'P');
  rows[9] = setChar(rows[9], 11, 'P');
  return rows;
}

const ROUTE_23 = {
  id: 'route_23',
  name: 'Route 23',
  width: 20,
  height: 10,
  encounterRate: 15,
  tiles: buildRoute23(),
  objects: [],
  npcs: [],
  signs: [
    { x:10, y:1, text:"ROUTE 23\nVICTORY ROAD lies ahead.\nOnly trainers with all 8 badges may pass!" },
  ],
  encounters: {
    tall_grass: [
      { species:'rattata', levelMin:15, levelMax:20, rate:50 },
      { species:'spearow', levelMin:13, levelMax:18, rate:50 },
    ],
  },
  connections: {
    south: { area:'route_22', entryX:10, entryY:14 },
  },
};

// ── Route 2 (15 wide x 24 tall) — [E2] between Viridian City and Viridian Forest ──
// Red/Blue: tall grass with Pidgey/Rattata/Caterpie/Weedle; gatehouse in the middle
const ROUTE_2 = {
  id: 'route_2',
  name: 'Route 2',
  width: 15,
  height: 24,
  encounterRate: 15,
  tiles: (() => {
    const rows = [];
    for (let y = 0; y < 24; y++) {
      let row = '';
      for (let x = 0; x < 15; x++) {
        if (x === 0 || x === 14) { row += 'T'; continue; }
        // Central path cols 6-8
        if (x >= 6 && x <= 8) { row += 'P'; continue; }
        // Tall grass in north half (y 0-10) and south half (y 14-23)
        const inGrass = (y >= 1 && y <= 10 && x >= 2 && x <= 5) ||
                        (y >= 1 && y <= 10 && x >= 9 && x <= 12) ||
                        (y >= 14 && y <= 22 && x >= 2 && x <= 5) ||
                        (y >= 14 && y <= 22 && x >= 9 && x <= 12);
        if (inGrass) { row += 'G'; continue; }
        // Gatehouse area (rows 11-12) — solid building across the path
        if (y >= 11 && y <= 12) { row += (x >= 6 && x <= 8) ? 'P' : 'B'; continue; }
        row += 'T';
      }
      rows.push(row);
    }
    return rows;
  })(),
  objects: [],
  npcs: [
    { id:'youngster_r2', x:3, y:5, name:'Youngster', dir:'east',
      dialogue:["I'm training my POKéMON to get stronger before I challenge BROCK!"] },
    { id:'lass_r2', x:11, y:16, name:'Lass', dir:'south',
      dialogue:["There's a secret path through here that leads to a special item! If only I could Cut that tree..."] },
  ],
  signs: [
    { x:7, y:1,  text:"ROUTE 2\nVIRIDIAN CITY ↓   VIRIDIAN FOREST ↑" },
    { x:7, y:22, text:"ROUTE 2\nVIRIDIAN CITY ↓   VIRIDIAN FOREST ↑" },
  ],
  items: [
    { id:'r2_antidote', x:2, y:18, item:'antidote', qty:1 },
    { id:'r2_tm45',     x:12, y:3, item:'tm45',     qty:1 },  // TM45 Thunderwave from pickup
  ],
  encounters: {
    tall_grass: [
      { species:'pidgey',   level:[3,5], rate:45 },
      { species:'rattata',  level:[3,4], rate:30 },
      { species:'caterpie', level:[3,4], rate:13 },
      { species:'weedle',   level:[3,4], rate:12 },
    ],
  },
  connections: {
    north: { area:'viridian_forest', entryX:9,  entryY:30 },
    south: { area:'viridian_city',   entryX:9,  entryY:1  },
  },
  warps: [],
};

// ── Area registry ─────────────────────────────────────────────────────────────
const AREAS = {
  pallet_town:      PALLET_TOWN,
  route_1:          ROUTE_1,
  route_2:          ROUTE_2,
  viridian_city:    VIRIDIAN_CITY,
  viridian_forest:  VIRIDIAN_FOREST,
  pewter_city:      PEWTER_CITY,
  players_house:    PLAYERS_HOUSE,
  rivals_house:     RIVALS_HOUSE,
  oaks_lab:         OAKS_LAB,
  pokemon_center:   POKEMON_CENTER,
  poke_mart:        POKE_MART,
  pewter_pokecenter: PEWTER_POKECENTER,
  pewter_mart:      PEWTER_MART,
  pewter_gym:       PEWTER_GYM,
  pewter_museum:    PEWTER_MUSEUM,
  route_22:         ROUTE_22,
  route_23:         ROUTE_23,
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
