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
    { id:'old_man', x:5, y:5, name:'Old Man', dir:'south',
      dialogue:["Ahhh, finally had my morning coffee! I feel like a new man! Heading to PEWTER CITY? Take the north path through VIRIDIAN FOREST — but watch out for BUG POKéMON!"] },
    { id:'girl_viridian', x:11, y:7, name:'Girl', dir:'east',
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
    { x:11, y:15, dest:'pokemon_center', destX:5,  destY:8,  areaName:'Pokémon Center' },
    { x:12, y:15, dest:'pokemon_center', destX:6,  destY:8,  areaName:'Pokémon Center' },
    { x:17, y:11, dest:'poke_mart',      destX:4,  destY:8,  areaName:'Poké Mart'      },
    { x:18, y:11, dest:'poke_mart',      destX:5,  destY:8,  areaName:'Poké Mart'      },
  ],
  connections: {
    south: { area:'route_1',       entryX:7, entryY:0  },
    north: { area:'viridian_forest', entryX:9, entryY:30 },
  },
};

// ── Viridian Forest (20 wide x 32 tall) ──────────────────────────────────────
const VIRIDIAN_FOREST = {
  id: 'viridian_forest',
  name: 'Viridian Forest',
  width: 20,
  height: 32,
  tiles: buildViridianForest(),
  objects: [],
  // Source: Bulbapedia — Viridian Forest trainers (Gen I Red/Blue)
  // Bug Catcher 1: Weedle Lv6, Caterpie Lv6 — reward ₽60
  // Bug Catcher 2: Weedle Lv7, Kakuna Lv7, Weedle Lv7 — reward ₽70
  // Bug Catcher 3: Weedle Lv9 — reward ₽90
  npcs: [
    { id:'bug_catcher_1', x:7, y:22, name:'BUG CATCHER', dir:'south',
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
    { id:'bug_catcher_2', x:13, y:11, name:'BUG CATCHER', dir:'west',
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
    { id:'bug_catcher_3', x:9, y:8, name:'BUG CATCHER', dir:'south',
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
  connections: {
    south: { area:'viridian_city',   entryX:9, entryY:1  },
    north: { area:'pewter_city',      entryX:10, entryY:22 },
  },
  warps: [],
};

// ── Pewter City (24 wide x 24 tall) ──────────────────────────────────────────
const PEWTER_CITY = {
  id: 'pewter_city',
  name: 'Pewter City',
  width: 24,
  height: 24,
  tiles: buildPewterCity(),
  objects: [],
  // Source: Bulbapedia — Pewter Gym (Gen I Red/Blue)
  // Jr. Trainer♂: Diglett Lv11, Sandshrew Lv11
  // BROCK: Geodude Lv12, Onix Lv14
  // Brock dialogue verbatim from Bulbapedia /wiki/Brock/Quotes
  npcs: [
    { id:'jr_trainer_pewter', x:10, y:6, name:'JR. TRAINER♂', dir:'south',
      dialogue:["JR. TRAINER♂: You need to get past me to face BROCK! Go!"],
      trainerBattle: {
        trainerName: 'JR. TRAINER♂',
        party: [
          { species:'diglett',   level:11 },
          { species:'sandshrew', level:11 },
        ],
        reward: 231,
        rewardFlag: 'beat_jr_trainer_pewter',
      },
      dialogueAfter: ["JR. TRAINER♂: I lost! Go on... BROCK is waiting for you."],
    },
    { id:'brock', x:12, y:5, name:'BROCK', dir:'south',
      // Verbatim pre-battle dialogue from Gen I Red/Blue (Bulbapedia)
      dialogue:[
        "I'm BROCK! I'm PEWTER's GYM LEADER!",
        "I believe in rock hard defense and determination!",
        "That's why my POKéMON are all the ROCK type!",
        "Do you still want to challenge me?",
        "Fine then! Show me your best!",
      ],
      trainerBattle: {
        trainerName: 'BROCK',
        party: [
          { species:'geodude', level:12 },
          { species:'onix',    level:14 },
        ],
        reward: 1386,
        rewardFlag: 'beat_brock',
        badge: 'Boulder Badge',
      },
      // Verbatim post-battle dialogue from Gen I Red/Blue (Bulbapedia)
      dialogueAfter:[
        "I took you for granted.",
        "As proof of your victory, here's the BOULDERBADGE!",
        "That's an official POKéMON LEAGUE BADGE!",
        "Its bearer's POKéMON become more powerful!",
        "The technique FLASH can now be used any time!",
        "Wait! Take this with you! TM34 contains BIDE.",
        "There are all kinds of trainers in the world! Go to the GYM in CERULEAN and test your abilities!",
      ],
    },
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
  ],
  signs: [
    { x:10, y:22, text:"PEWTER CITY\nA Stone Gray City." },
    { x:5,  y:5,  text:"POKéMON CENTER\nWe restore your tired POKéMON to full health!" },
    { x:17, y:5,  text:"PEWTER MUSEUM of SCIENCE\nKnowledge for all ages." },
    { x:5,  y:13, text:"POKé MART\nPEWTER CITY BRANCH" },
    { x:11, y:4,  text:"PEWTER GYM\nGym Leader: BROCK\nSpecialty: ROCK-type\nBOULDER BADGE awarded here." },
  ],
  warps: [
    { x:4,  y:9,  dest:'pokemon_center', destX:5, destY:8, areaName:'Pokémon Center' },
    { x:5,  y:9,  dest:'pokemon_center', destX:6, destY:8, areaName:'Pokémon Center' },
    { x:4,  y:14, dest:'poke_mart',      destX:5, destY:8, areaName:'Poké Mart'      },
    { x:5,  y:14, dest:'poke_mart',      destX:6, destY:8, areaName:'Poké Mart'      },
    { x:17, y:9,  dest:'pewter_museum',  destX:3, destY:6, areaName:'Pewter Museum'  },
    { x:18, y:9,  dest:'pewter_museum',  destX:4, destY:6, areaName:'Pewter Museum'  },
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
  // Outer walls solid building; interior (cols 10-13, rows 4-8) walkable path
  for (let y = 3; y <= 9; y++) {
    for (let x = 9; x <= 14; x++) {
      if (y === 3 || x === 9 || x === 14) {
        rows[y] = setChar(rows[y], x, 'B'); // outer walls
      } else {
        rows[y] = setChar(rows[y], x, 'P'); // walkable interior
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
  pallet_town:      PALLET_TOWN,
  route_1:          ROUTE_1,
  viridian_city:    VIRIDIAN_CITY,
  viridian_forest:  VIRIDIAN_FOREST,
  pewter_city:      PEWTER_CITY,
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
