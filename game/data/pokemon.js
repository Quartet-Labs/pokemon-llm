'use strict';
// Gen 1 Pokémon — base stats and learnsets sourced from Bulbapedia
// Base stat formula used: maxHp = floor(base.hp * 2 * level / 100) + level + 10
//                         stat  = floor(base.stat * 2 * level / 100) + 5
// Moves listed are what the Pokémon knows at the level it would first be encountered
const POKEMON = {
  // ── #1-3 Bulbasaur line ───────────────────────────────────────────────────
  bulbasaur:  { id:1,  name:"BULBASAUR",  type:["grass","poison"], hp:45, atk:49, def:49, spd:45, spc:65,  baseExp:64,  growthRate:'medium_slow', catchRate:45,
                height:"0.7 m", weight:"6.9 kg", dexEntry:"A strange seed was planted on its back at birth. The plant sprouts and grows with this POKéMON.",
                evolvesTo:{ species:'ivysaur', level:16 },
                learnset:{ 1:['tackle','growl'], 7:['leech seed'], 13:['vine whip'], 22:['poison powder'], 29:['razor leaf'], 38:['growth'], 46:['solar beam'], 53:['sleep powder'], 62:['swords dance'] },
                moves:["tackle","growl","leech seed","vine whip"] },

  ivysaur:    { id:2,  name:"IVYSAUR",    type:["grass","poison"], hp:60, atk:62, def:63, spd:60, spc:80,  baseExp:141, growthRate:'medium_slow', catchRate:45,
                height:"1.0 m", weight:"13.0 kg", dexEntry:"When the bulb on its back grows large, it appears to lose the ability to stand on its hind legs.",
                evolvesTo:{ species:'venusaur', level:32 },
                learnset:{ 1:['tackle','growl'], 7:['leech seed'], 13:['vine whip'], 22:['poison powder'], 30:['razor leaf'], 44:['growth'], 55:['sleep powder'], 65:['solar beam'] },
                moves:["tackle","growl","leech seed","vine whip"] },

  venusaur:   { id:3,  name:"VENUSAUR",   type:["grass","poison"], hp:80, atk:82, def:83, spd:80, spc:100, baseExp:208, growthRate:'medium_slow', catchRate:45,
                height:"2.0 m", weight:"100.0 kg", dexEntry:"The plant blooms when it is absorbing solar energy. It stays on the move to seek sunlight.",
                learnset:{ 1:['tackle','growl'], 7:['leech seed'], 13:['vine whip'], 22:['poison powder'], 30:['razor leaf'], 44:['growth'], 55:['sleep powder'], 65:['solar beam'] },
                moves:["tackle","growl","razor leaf","leech seed"] },

  // ── #4-6 Charmander line ─────────────────────────────────────────────────
  charmander: { id:4,  name:"CHARMANDER", type:["fire"],           hp:39, atk:52, def:43, spd:65, spc:50,  baseExp:65,  growthRate:'medium_slow', catchRate:45,
                height:"0.6 m", weight:"8.5 kg", dexEntry:"Obviously prefers hot places. When it rains, steam is said to spout from the tip of its tail.",
                evolvesTo:{ species:'charmeleon', level:16 },
                learnset:{ 1:['scratch','growl'], 9:['ember'], 15:['leer'], 22:['rage'], 30:['slash'], 38:['flamethrower'], 46:['fire spin'] },
                moves:["scratch","growl","ember","smokescreen"] },

  charmeleon: { id:5,  name:"CHARMELEON", type:["fire"],           hp:58, atk:64, def:58, spd:80, spc:65,  baseExp:142, growthRate:'medium_slow', catchRate:45,
                height:"1.1 m", weight:"19.0 kg", dexEntry:"When it swings its burning tail, it elevates the temperature to unbearably high levels.",
                evolvesTo:{ species:'charizard', level:36 },
                learnset:{ 1:['scratch','growl'], 9:['ember'], 15:['leer'], 22:['rage'], 30:['slash'], 38:['flamethrower'], 46:['fire spin'] },
                moves:["scratch","growl","ember","smokescreen"] },

  charizard:  { id:6,  name:"CHARIZARD",  type:["fire","flying"],  hp:78, atk:84, def:78, spd:100,spc:85,  baseExp:209, growthRate:'medium_slow', catchRate:45,
                height:"1.7 m", weight:"90.5 kg", dexEntry:"Spits fire that is hot enough to melt boulders. Known to cause forest fires unintentionally.",
                learnset:{ 1:['scratch','growl'], 9:['ember'], 15:['leer'], 22:['rage'], 30:['slash'], 38:['flamethrower'], 46:['fire spin'] },
                moves:["scratch","growl","ember","flamethrower"] },

  // ── #7-9 Squirtle line ───────────────────────────────────────────────────
  squirtle:   { id:7,  name:"SQUIRTLE",   type:["water"],          hp:44, atk:48, def:65, spd:43, spc:50,  baseExp:66,  growthRate:'medium_slow', catchRate:45,
                height:"0.5 m", weight:"9.0 kg", dexEntry:"After birth, its back swells and hardens into a shell. Powerfully sprays foam from its mouth.",
                evolvesTo:{ species:'wartortle', level:16 },
                learnset:{ 1:['tackle','tail whip'], 8:['bubble'], 15:['water gun'], 22:['bite'], 28:['withdraw'], 35:['skull bash'], 42:['hydro pump'] },
                moves:["tackle","tail whip","water gun","withdraw"] },

  wartortle:  { id:8,  name:"WARTORTLE",  type:["water"],          hp:59, atk:63, def:80, spd:58, spc:65,  baseExp:143, growthRate:'medium_slow', catchRate:45,
                height:"1.0 m", weight:"22.5 kg", dexEntry:"Often hides in water to stalk unwary prey. For fast swimming, it moves its ears to maintain balance.",
                evolvesTo:{ species:'blastoise', level:36 },
                learnset:{ 1:['tackle','tail whip'], 8:['bubble'], 15:['water gun'], 22:['bite'], 28:['withdraw'], 35:['skull bash'], 42:['hydro pump'] },
                moves:["tackle","tail whip","water gun","withdraw"] },

  blastoise:  { id:9,  name:"BLASTOISE",  type:["water"],          hp:79, atk:83, def:100,spd:78, spc:85,  baseExp:210, growthRate:'medium_slow', catchRate:45,
                height:"1.6 m", weight:"85.5 kg", dexEntry:"A brutal POKéMON with pressurized water jets on its shell. They are used for high speed tackles.",
                learnset:{ 1:['tackle','tail whip'], 8:['bubble'], 15:['water gun'], 22:['bite'], 28:['withdraw'], 35:['skull bash'], 42:['hydro pump'] },
                moves:["tackle","tail whip","water gun","surf"] },

  // ── #10-12 Caterpie line ─────────────────────────────────────────────────
  caterpie:   { id:10, name:"CATERPIE",   type:["bug"],            hp:45, atk:30, def:35, spd:45, spc:20,  baseExp:53,  growthRate:'medium_fast', catchRate:255,
                height:"0.3 m", weight:"2.9 kg", dexEntry:"Its feet have suction cups designed to stick to any surface. It tenaciously climbs trees to forage.",
                evolvesTo:{ species:'metapod', level:7 },
                learnset:{ 1:['tackle','string shot'] },
                moves:["tackle","string shot"] },

  metapod:    { id:11, name:"METAPOD",    type:["bug"],            hp:50, atk:20, def:55, spd:30, spc:25,  baseExp:72,  growthRate:'medium_fast', catchRate:120,
                height:"0.7 m", weight:"9.9 kg", dexEntry:"This POKéMON is vulnerable to attack while its shell is soft, exposing its weak and tender body.",
                evolvesTo:{ species:'butterfree', level:10 },
                learnset:{ 1:['harden'] },
                moves:["harden"] },

  butterfree: { id:12, name:"BUTTERFREE", type:["bug","flying"],   hp:60, atk:45, def:50, spd:70, spc:80,  baseExp:160, growthRate:'medium_fast', catchRate:45,
                height:"1.1 m", weight:"32.0 kg", dexEntry:"In battle, it flaps its wings at great speed to release highly toxic dust into the air.",
                learnset:{ 1:['confusion'], 12:['poison powder'], 15:['stun spore'], 16:['sleep powder'], 21:['supersonic'], 26:['whirlwind'], 30:['psybeam'], 35:['gust'] },
                moves:["confusion","sleep powder","stun spore","gust"] },

  // ── #13-15 Weedle line ───────────────────────────────────────────────────
  weedle:     { id:13, name:"WEEDLE",     type:["bug","poison"],   hp:35, atk:35, def:30, spd:50, spc:20,  baseExp:52,  growthRate:'medium_fast', catchRate:255,
                height:"0.3 m", weight:"3.2 kg", dexEntry:"Often found in forests, eating leaves. It has a sharp venomous stinger on its head.",
                evolvesTo:{ species:'kakuna', level:7 },
                learnset:{ 1:['poison sting','string shot'] },
                moves:["poison sting","string shot"] },

  kakuna:     { id:14, name:"KAKUNA",     type:["bug","poison"],   hp:45, atk:25, def:50, spd:35, spc:25,  baseExp:72,  growthRate:'medium_fast', catchRate:120,
                height:"0.6 m", weight:"10.0 kg", dexEntry:"Almost incapable of moving, this POKéMON can only harden its shell to protect itself from foes.",
                evolvesTo:{ species:'beedrill', level:10 },
                learnset:{ 1:['harden'] },
                moves:["harden"] },

  beedrill:   { id:15, name:"BEEDRILL",   type:["bug","poison"],   hp:65, atk:80, def:40, spd:75, spc:45,  baseExp:159, growthRate:'medium_fast', catchRate:45,
                height:"1.0 m", weight:"29.5 kg", dexEntry:"Flies at high speed and attacks using the large venomous stingers on its forelegs and tail.",
                learnset:{ 1:['fury attack','poison sting'], 20:['twineedle'], 35:['agility'] },
                moves:["twineedle","fury attack","poison sting","string shot"] },

  // ── #16-18 Pidgey line ───────────────────────────────────────────────────
  pidgey:     { id:16, name:"PIDGEY",     type:["normal","flying"],hp:40, atk:45, def:40, spd:56, spc:35,  baseExp:55,  growthRate:'medium_fast', catchRate:255,
                height:"0.3 m", weight:"1.8 kg", dexEntry:"A common sight in forests and woods. It flaps its wings at ground level to kick up blinding sand.",
                evolvesTo:{ species:'pidgeotto', level:18 },
                learnset:{ 1:['gust'], 5:['sand attack'], 12:['quick attack'], 19:['whirlwind'], 28:['wing attack'], 36:['agility'], 44:['mirror move'] },
                moves:["gust"] },

  pidgeotto:  { id:17, name:"PIDGEOTTO",  type:["normal","flying"],hp:63, atk:60, def:55, spd:71, spc:50,  baseExp:113, growthRate:'medium_fast', catchRate:120,
                height:"1.1 m", weight:"30.0 kg", dexEntry:"Very protective of its sprawling territorial area, this POKéMON files around the perimeter of its territory.",
                evolvesTo:{ species:'pidgeot', level:36 },
                learnset:{ 1:['gust','sand attack','quick attack'], 19:['whirlwind'], 28:['wing attack'], 36:['agility'], 44:['mirror move'] },
                moves:["gust","sand attack","quick attack"] },

  pidgeot:    { id:18, name:"PIDGEOT",    type:["normal","flying"],hp:83, atk:80, def:75, spd:101,spc:70,  baseExp:172, growthRate:'medium_fast', catchRate:45,
                height:"1.5 m", weight:"39.5 kg", dexEntry:"This POKéMON flies at Mach 2 speed, seeking prey. Its large talons are feared as wicked weapons.",
                learnset:{ 1:['quick attack','whirlwind','wing attack','agility'], 44:['mirror move'] },
                moves:["wing attack","agility","quick attack","whirlwind"] },

  // ── #19-20 Rattata line ──────────────────────────────────────────────────
  rattata:    { id:19, name:"RATTATA",    type:["normal"],         hp:30, atk:56, def:35, spd:72, spc:25,  baseExp:57,  growthRate:'medium_fast', catchRate:255,
                height:"0.3 m", weight:"3.5 kg", dexEntry:"Will chew on anything with its fangs. If you see one, there are more in the area.",
                evolvesTo:{ species:'raticate', level:20 },
                learnset:{ 1:['tackle','tail whip'], 7:['quick attack'], 14:['hyper fang'], 23:['focus energy'], 34:['super fang'] },
                moves:["tackle","tail whip","quick attack","hyper fang"] },

  raticate:   { id:20, name:"RATICATE",   type:["normal"],         hp:55, atk:81, def:60, spd:97, spc:50,  baseExp:116, growthRate:'medium_fast', catchRate:127,
                height:"0.7 m", weight:"18.5 kg", dexEntry:"Its hind feet are webbed. They act as flippers, so it can swim in rivers and hunt for prey.",
                learnset:{ 1:['tackle','tail whip'], 7:['quick attack'], 14:['hyper fang'], 23:['focus energy'], 34:['super fang'] },
                moves:["tackle","tail whip","quick attack","hyper fang"] },

  // ── #21-22 Spearow line ──────────────────────────────────────────────────
  spearow:    { id:21, name:"SPEAROW",    type:["normal","flying"],hp:40, atk:60, def:30, spd:70, spc:31,  baseExp:58,  growthRate:'medium_fast', catchRate:255,
                height:"0.3 m", weight:"2.0 kg", dexEntry:"Eats bugs in grassy areas. It has to flap its short wings at high speed to stay airborne.",
                evolvesTo:{ species:'fearow', level:20 },
                learnset:{ 1:['peck','growl'], 9:['leer'], 15:['fury attack'], 22:['mirror move'], 29:['agility'], 36:['drill peck'] },
                moves:["peck","growl","leer","fury attack"] },

  fearow:     { id:22, name:"FEAROW",     type:["normal","flying"],hp:65, atk:90, def:65, spd:100,spc:61,  baseExp:162, growthRate:'medium_fast', catchRate:90,
                height:"1.2 m", weight:"38.0 kg", dexEntry:"With its huge and magnificent wings, it can keep aloft without ever having to land for rest.",
                learnset:{ 1:['peck','growl','leer','fury attack'], 29:['agility'], 36:['drill peck'] },
                moves:["peck","fury attack","agility","drill peck"] },

  // ── #23-24 Ekans line ────────────────────────────────────────────────────
  ekans:      { id:23, name:"EKANS",      type:["poison"],         hp:35, atk:60, def:44, spd:55, spc:40,  baseExp:62,  growthRate:'medium_fast', catchRate:255,
                height:"2.0 m", weight:"6.9 kg", dexEntry:"Moves silently and swiftly. Eats the eggs of birds, such as SPEAROW, whole.",
                evolvesTo:{ species:'arbok', level:22 },
                learnset:{ 1:['wrap','leer'], 9:['poison sting'], 15:['bite'], 22:['glare'], 30:['screech'], 38:['acid'] },
                moves:["wrap","leer","poison sting","bite"] },

  arbok:      { id:24, name:"ARBOK",      type:["poison"],         hp:60, atk:85, def:69, spd:80, spc:65,  baseExp:141, growthRate:'medium_fast', catchRate:90,
                height:"3.5 m", weight:"65.0 kg", dexEntry:"It is rumored that the ferocious warning markings on its belly differ from area to area.",
                learnset:{ 1:['wrap','leer','poison sting','bite'], 22:['glare'], 30:['screech'], 38:['acid'] },
                moves:["wrap","leer","poison sting","glare"] },

  // ── #25-26 Pikachu line ──────────────────────────────────────────────────
  pikachu:    { id:25, name:"PIKACHU",    type:["electric"],       hp:35, atk:55, def:30, spd:90, spc:50,  baseExp:82,  growthRate:'medium_fast', catchRate:190,
                height:"0.4 m", weight:"6.0 kg", dexEntry:"When several of these POKéMON gather, their electricity can build and cause lightning storms.",
                evolvesTo:{ species:'raichu', stone:'thunder_stone' },
                learnset:{ 1:['thunder shock','growl'], 9:['tail whip'], 16:['quick attack'], 26:['thunder wave'], 33:['slam'], 41:['thunderbolt'], 50:['agility'], 58:['thunder'] },
                moves:["thunder shock","growl","quick attack","thunder wave"] },

  raichu:     { id:26, name:"RAICHU",     type:["electric"],       hp:60, atk:90, def:55, spd:110,spc:90,  baseExp:122, growthRate:'medium_fast', catchRate:75,
                height:"0.8 m", weight:"30.0 kg", dexEntry:"Its long tail serves as a ground to protect itself from its own high-voltage power.",
                learnset:{ 1:['thunder shock','growl','tail whip','quick attack'] },
                moves:["thunder shock","thunderbolt","quick attack","thunder wave"] },

  // ── #27-28 Sandshrew line ────────────────────────────────────────────────
  sandshrew:  { id:27, name:"SANDSHREW",  type:["ground"],         hp:50, atk:75, def:85, spd:40, spc:30,  baseExp:93,  growthRate:'medium_fast', catchRate:255,
                height:"0.6 m", weight:"12.0 kg", dexEntry:"Burrows deep underground in arid locations far from water. It pops out to catch prey.",
                evolvesTo:{ species:'sandslash', level:22 },
                learnset:{ 1:['scratch'], 10:['sand attack'], 17:['slash'], 24:['poison sting'], 31:['swift'], 38:['fury swipes'] },
                moves:["scratch","sand attack","slash","defense curl"] },

  sandslash:  { id:28, name:"SANDSLASH",  type:["ground"],         hp:75, atk:100,def:110,spd:65, spc:55,  baseExp:163, growthRate:'medium_fast', catchRate:90,
                height:"1.0 m", weight:"29.5 kg", dexEntry:"Curls up into a spiny ball when threatened. It can roll while curled up to attack or escape.",
                learnset:{ 1:['scratch','sand attack'], 10:['slash'], 24:['poison sting'], 31:['swift'], 38:['fury swipes'] },
                moves:["scratch","sand attack","slash","fury attack"] },

  // ── #29-31 Nidoran♀ line ─────────────────────────────────────────────────
  nidoran_f:  { id:29, name:"NIDORAN♀", type:["poison"],      hp:55, atk:47, def:52, spd:41, spc:40,  baseExp:59,  growthRate:'medium_slow', catchRate:235,
                height:"0.4 m", weight:"7.0 kg", dexEntry:"Although it is small, its venomous barbs render this POKéMON dangerous. The female has smaller horns.",
                evolvesTo:{ species:'nidorina', level:16 },
                learnset:{ 1:['growl','tackle'], 8:['scratch'], 14:['poison sting'], 23:['tail whip'], 32:['bite'], 38:['fury swipes'], 46:['double kick'] },
                moves:["growl","tackle","scratch","poison sting"] },

  nidorina:   { id:30, name:"NIDORINA",   type:["poison"],         hp:70, atk:62, def:67, spd:56, spc:55,  baseExp:117, growthRate:'medium_slow', catchRate:120,
                height:"0.8 m", weight:"20.0 kg", dexEntry:"The horn on its head has grown larger. It becomes docile when alone, but aggressive in a group.",
                evolvesTo:{ species:'nidoqueen', stone:'moon_stone' },
                learnset:{ 1:['growl','tackle','scratch','poison sting'], 23:['tail whip'], 32:['bite'], 38:['fury swipes'], 46:['double kick'] },
                moves:["growl","tackle","poison sting","tail whip"] },

  nidoqueen:  { id:31, name:"NIDOQUEEN",  type:["poison","ground"],hp:90, atk:82, def:87, spd:76, spc:75,  baseExp:194, growthRate:'medium_slow', catchRate:45,
                height:"1.3 m", weight:"60.0 kg", dexEntry:"Its hard scales provide strong protection. It uses its hefty bulk to execute powerful moves.",
                learnset:{ 1:['tackle','scratch','tail whip','poison sting'], 23:['body slam'], 35:['double kick'] },
                moves:["tackle","body slam","double kick","poison sting"] },

  // ── #32-34 Nidoran♂ line ─────────────────────────────────────────────────
  nidoran_m:  { id:32, name:"NIDORAN♂", type:["poison"],      hp:46, atk:57, def:40, spd:50, spc:40,  baseExp:60,  growthRate:'medium_slow', catchRate:235,
                height:"0.5 m", weight:"9.0 kg", dexEntry:"Stiffens its ears to sense danger. The larger its horns, the more powerful its secreted venom.",
                evolvesTo:{ species:'nidorino', level:16 },
                learnset:{ 1:['leer','tackle'], 8:['horn attack'], 14:['poison sting'], 23:['focus energy'], 32:['horn drill'], 40:['double kick'], 50:['thrash'] },
                moves:["leer","tackle","horn attack","poison sting"] },

  nidorino:   { id:33, name:"NIDORINO",   type:["poison"],         hp:61, atk:72, def:57, spd:65, spc:55,  baseExp:118, growthRate:'medium_slow', catchRate:120,
                height:"0.9 m", weight:"19.5 kg", dexEntry:"An aggressive POKéMON that is quick to attack. The horn on its head secretes a powerful venom.",
                evolvesTo:{ species:'nidoking', stone:'moon_stone' },
                learnset:{ 1:['leer','tackle','horn attack','poison sting'], 23:['focus energy'], 32:['horn drill'], 40:['double kick'], 50:['thrash'] },
                moves:["leer","tackle","horn attack","focus energy"] },

  nidoking:   { id:34, name:"NIDOKING",   type:["poison","ground"],hp:81, atk:92, def:77, spd:85, spc:75,  baseExp:195, growthRate:'medium_slow', catchRate:45,
                height:"1.4 m", weight:"62.0 kg", dexEntry:"It uses its powerful tail in battle to smash, constrict, then break the prey's bones.",
                learnset:{ 1:['tackle','horn attack','poison sting','thrash'] },
                moves:["tackle","thrash","horn drill","double kick"] },

  // ── #35-36 Clefairy line ─────────────────────────────────────────────────
  clefairy:   { id:35, name:"CLEFAIRY",   type:["normal"],         hp:70, atk:45, def:48, spd:35, spc:60,  baseExp:68,  growthRate:'fast', catchRate:150,
                height:"0.6 m", weight:"7.5 kg", dexEntry:"Its magical and cute appeal has many admirers. It is rare and found only in certain areas.",
                evolvesTo:{ species:'clefable', stone:'moon_stone' },
                learnset:{ 1:['pound','growl'], 13:['sing'], 18:['double slap'], 24:['minimize'], 31:['metronome'], 38:['defense curl'], 44:['light screen'], 48:['soft boiled'] },
                moves:["pound","growl","sing","double slap"] },

  clefable:   { id:36, name:"CLEFABLE",   type:["normal"],         hp:95, atk:70, def:73, spd:60, spc:85,  baseExp:129, growthRate:'fast', catchRate:25,
                height:"1.3 m", weight:"40.0 kg", dexEntry:"A timid fairy POKéMON that is rarely seen. It will run and hide the moment it senses people.",
                learnset:{ 1:['sing','double slap','minimize','metronome'] },
                moves:["sing","minimize","metronome","double slap"] },

  // ── #37-38 Vulpix line ───────────────────────────────────────────────────
  vulpix:     { id:37, name:"VULPIX",     type:["fire"],           hp:38, atk:41, def:40, spd:65, spc:65,  baseExp:63,  growthRate:'medium_fast', catchRate:190,
                height:"0.6 m", weight:"9.9 kg", dexEntry:"At birth, it has one white tail. The tail separates into six as it grows older.",
                evolvesTo:{ species:'ninetales', stone:'fire_stone' },
                learnset:{ 1:['ember','tail whip'], 16:['quick attack'], 21:['roar'], 28:['confuse ray'], 35:['flamethrower'], 42:['fire spin'] },
                moves:["ember","tail whip","quick attack","roar"] },

  ninetales:  { id:38, name:"NINETALES",  type:["fire"],           hp:73, atk:76, def:75, spd:100,spc:100, baseExp:178, growthRate:'medium_fast', catchRate:75,
                height:"1.1 m", weight:"19.9 kg", dexEntry:"Very smart and very vengeful. Grabbing one of its many tails could result in a 1,000-year curse.",
                learnset:{ 1:['ember','quick attack','roar','confuse ray'] },
                moves:["ember","quick attack","confuse ray","flamethrower"] },

  // ── #39-40 Jigglypuff line ───────────────────────────────────────────────
  jigglypuff: { id:39, name:"JIGGLYPUFF", type:["normal"],         hp:115,atk:45, def:20, spd:20, spc:25,  baseExp:76,  growthRate:'fast', catchRate:170,
                height:"0.5 m", weight:"5.5 kg", dexEntry:"When its huge eyes light up, it sings a mysteriously soothing melody that lulls its enemies to sleep.",
                evolvesTo:{ species:'wigglytuff', stone:'moon_stone' },
                learnset:{ 1:['sing','pound'], 9:['disable'], 14:['defense curl'], 19:['double slap'], 29:['rest'], 39:['body slam'], 44:['double edge'] },
                moves:["sing","pound","disable","defense curl"] },

  wigglytuff: { id:40, name:"WIGGLYTUFF", type:["normal"],         hp:140,atk:70, def:45, spd:45, spc:50,  baseExp:109, growthRate:'fast', catchRate:50,
                height:"1.0 m", weight:"12.0 kg", dexEntry:"The body is soft and rubbery. When angered, it will suck in air and inflate itself to an enormous size.",
                learnset:{ 1:['sing','disable','defense curl','double slap'] },
                moves:["sing","body slam","double edge","disable"] },

  // ── #41-42 Zubat line ────────────────────────────────────────────────────
  zubat:      { id:41, name:"ZUBAT",      type:["poison","flying"],hp:40, atk:45, def:35, spd:55, spc:40,  baseExp:54,  growthRate:'medium_fast', catchRate:255,
                height:"0.8 m", weight:"7.5 kg", dexEntry:"Forms colonies in perpetually dark places. Uses ultrasonic waves to identify and approach targets.",
                evolvesTo:{ species:'golbat', level:22 },
                learnset:{ 1:['leech life','supersonic'], 15:['bite'], 21:['confuse ray'], 28:['wing attack'], 36:['haze'] },
                moves:["leech life","supersonic","bite","confuse ray"] },

  golbat:     { id:42, name:"GOLBAT",     type:["poison","flying"],hp:75, atk:80, def:70, spd:90, spc:75,  baseExp:171, growthRate:'medium_fast', catchRate:90,
                height:"1.6 m", weight:"55.0 kg", dexEntry:"Once it bites, it will not stop draining energy from the victim even if it has gotten too heavy to fly.",
                learnset:{ 1:['leech life','supersonic','bite','confuse ray'], 28:['wing attack'], 36:['haze'] },
                moves:["leech life","bite","confuse ray","wing attack"] },

  // ── #43-45 Oddish line ───────────────────────────────────────────────────
  oddish:     { id:43, name:"ODDISH",     type:["grass","poison"], hp:45, atk:50, def:55, spd:30, spc:75,  baseExp:78,  growthRate:'medium_slow', catchRate:255,
                height:"0.5 m", weight:"5.4 kg", dexEntry:"During the day, it keeps its face buried in the ground. At night, it wanders around sowing its seeds.",
                evolvesTo:{ species:'gloom', level:21 },
                learnset:{ 1:['absorb'], 15:['poison powder'], 17:['stun spore'], 19:['sleep powder'], 24:['acid'], 33:['petal dance'], 39:['solar beam'] },
                moves:["absorb","poison powder","stun spore","sleep powder"] },

  gloom:      { id:44, name:"GLOOM",      type:["grass","poison"], hp:60, atk:65, def:70, spd:40, spc:85,  baseExp:132, growthRate:'medium_slow', catchRate:120,
                height:"0.8 m", weight:"8.6 kg", dexEntry:"The fluid that oozes from its mouth isn't drool. It is a nectar that is used to attract prey.",
                evolvesTo:{ species:'vileplume', stone:'leaf_stone' },
                learnset:{ 1:['absorb','poison powder','stun spore','sleep powder'], 28:['acid'], 38:['petal dance'], 52:['solar beam'] },
                moves:["absorb","acid","stun spore","sleep powder"] },

  vileplume:  { id:45, name:"VILEPLUME",  type:["grass","poison"], hp:75, atk:80, def:85, spd:50, spc:100, baseExp:184, growthRate:'medium_slow', catchRate:45,
                height:"1.2 m", weight:"18.6 kg", dexEntry:"The larger its petals, the more toxic pollen it releases. With tainted pollen, it causes paralysis.",
                learnset:{ 1:['absorb','sleep powder','acid','petal dance'] },
                moves:["absorb","sleep powder","petal dance","acid"] },

  // ── #46-47 Paras line ────────────────────────────────────────────────────
  paras:      { id:46, name:"PARAS",      type:["bug","grass"],    hp:35, atk:70, def:55, spd:25, spc:55,  baseExp:70,  growthRate:'medium_fast', catchRate:190,
                height:"0.3 m", weight:"5.4 kg", dexEntry:"Burrows to suck tree roots. The mushrooms on its back grow by drawing nutrients from the host bug.",
                evolvesTo:{ species:'parasect', level:24 },
                learnset:{ 1:['scratch'], 13:['stun spore'], 20:['leech life'], 27:['spore'], 34:['slash'], 41:['growth'] },
                moves:["scratch","stun spore","leech life","spore"] },

  parasect:   { id:47, name:"PARASECT",   type:["bug","grass"],    hp:60, atk:95, def:80, spd:30, spc:80,  baseExp:128, growthRate:'medium_fast', catchRate:75,
                height:"1.0 m", weight:"29.5 kg", dexEntry:"A host-parasite pair in which the parasite mushroom has taken over the host bug. Moves aimlessly.",
                learnset:{ 1:['scratch','stun spore','leech life','spore'], 34:['slash'], 41:['growth'] },
                moves:["scratch","spore","leech life","slash"] },

  // ── #48-49 Venonat line ──────────────────────────────────────────────────
  venonat:    { id:48, name:"VENONAT",    type:["bug","poison"],   hp:60, atk:55, def:50, spd:45, spc:40,  baseExp:75,  growthRate:'medium_fast', catchRate:190,
                height:"1.0 m", weight:"30.0 kg", dexEntry:"Lives in the shadows of tall trees where it eats bugs. It is attracted by light at night.",
                evolvesTo:{ species:'venomoth', level:31 },
                learnset:{ 1:['tackle','disable'], 24:['poison powder'], 27:['leech life'], 30:['stun spore'], 35:['psybeam'], 38:['sleep powder'], 43:['psychic'] },
                moves:["tackle","disable","poison powder","leech life"] },

  venomoth:   { id:49, name:"VENOMOTH",   type:["bug","poison"],   hp:70, atk:65, def:60, spd:90, spc:90,  baseExp:138, growthRate:'medium_fast', catchRate:75,
                height:"1.5 m", weight:"12.5 kg", dexEntry:"The dustlike scales covering its wings are color coded to indicate the kinds of poison it has.",
                learnset:{ 1:['tackle','disable','poison powder','leech life'], 38:['sleep powder'], 43:['psybeam'], 50:['psychic'] },
                moves:["tackle","psybeam","sleep powder","psychic"] },

  // ── #50-51 Diglett line ──────────────────────────────────────────────────
  diglett:    { id:50, name:"DIGLETT",    type:["ground"],         hp:10, atk:55, def:25, spd:95, spc:45,  baseExp:81,  growthRate:'medium_fast', catchRate:255,
                height:"0.2 m", weight:"0.8 kg", dexEntry:"Lives about one yard underground where it feeds on plant roots. It sometimes appears above ground.",
                evolvesTo:{ species:'dugtrio', level:26 },
                learnset:{ 1:['scratch'], 15:['growl'], 19:['dig'], 24:['sand attack'], 31:['slash'], 40:['earthquake'], 48:['fissure'] },
                moves:["scratch","growl","dig","sand attack"] },

  dugtrio:    { id:51, name:"DUGTRIO",    type:["ground"],         hp:35, atk:80, def:50, spd:120,spc:70,  baseExp:134, growthRate:'medium_fast', catchRate:50,
                height:"0.7 m", weight:"33.3 kg", dexEntry:"A team of DIGLETT triplets. It triggers huge earthquakes by burrowing 60 miles underground.",
                learnset:{ 1:['scratch','growl','dig'], 26:['sand attack'], 31:['slash'], 40:['earthquake'], 48:['fissure'] },
                moves:["scratch","growl","dig","earthquake"] },

  // ── #52-53 Meowth line ───────────────────────────────────────────────────
  meowth:     { id:52, name:"MEOWTH",     type:["normal"],         hp:40, atk:45, def:35, spd:90, spc:40,  baseExp:69,  growthRate:'medium_fast', catchRate:255,
                height:"0.4 m", weight:"4.2 kg", dexEntry:"Adores circular objects. Wanders the streets on a nightly basis to look for dropped loose change.",
                evolvesTo:{ species:'persian', level:28 },
                learnset:{ 1:['scratch','growl'], 12:['bite'], 17:['pay day'], 24:['screech'], 33:['fury swipes'], 44:['slash'] },
                moves:["scratch","growl","bite","pay day"] },

  persian:    { id:53, name:"PERSIAN",    type:["normal"],         hp:65, atk:70, def:60, spd:115,spc:65,  baseExp:148, growthRate:'medium_fast', catchRate:90,
                height:"1.0 m", weight:"32.0 kg", dexEntry:"Although its fur has many admirers, it is tough to raise as a pet because of its fickle meanness.",
                learnset:{ 1:['scratch','growl','bite','pay day'], 35:['screech'], 42:['fury swipes'], 49:['slash'] },
                moves:["scratch","pay day","slash","fury swipes"] },

  // ── #54-55 Psyduck line ──────────────────────────────────────────────────
  psyduck:    { id:54, name:"PSYDUCK",    type:["water"],          hp:50, atk:52, def:48, spd:55, spc:50,  baseExp:80,  growthRate:'medium_fast', catchRate:190,
                height:"0.8 m", weight:"19.6 kg", dexEntry:"While lulling its enemies with its vacant look, this wily POKéMON will use psychokinetic powers.",
                evolvesTo:{ species:'golduck', level:33 },
                learnset:{ 1:['scratch'], 28:['tail whip'], 31:['disable'], 36:['confusion'], 43:['fury swipes'], 46:['hydro pump'] },
                moves:["scratch","tail whip","disable","confusion"] },

  golduck:    { id:55, name:"GOLDUCK",    type:["water"],          hp:80, atk:82, def:78, spd:85, spc:80,  baseExp:174, growthRate:'medium_fast', catchRate:75,
                height:"1.7 m", weight:"76.6 kg", dexEntry:"Often seen swimming elegantly by lake shores. It is often mistaken for the Japanese monster, Kappa.",
                learnset:{ 1:['scratch','tail whip','disable','confusion'], 46:['fury swipes'], 56:['hydro pump'] },
                moves:["scratch","confusion","disable","hydro pump"] },

  // ── #56-57 Mankey line ───────────────────────────────────────────────────
  mankey:     { id:56, name:"MANKEY",     type:["fighting"],       hp:40, atk:80, def:35, spd:70, spc:35,  baseExp:74,  growthRate:'medium_fast', catchRate:190,
                height:"0.5 m", weight:"28.0 kg", dexEntry:"Extremely quick to anger. It could be docile one moment then thrashing away the next instant.",
                evolvesTo:{ species:'primeape', level:28 },
                learnset:{ 1:['scratch','leer'], 9:['karate chop'], 15:['fury swipes'], 21:['focus energy'], 27:['seismic toss'], 33:['thrash'], 45:['submission'] },
                moves:["scratch","leer","karate chop","fury swipes"] },

  primeape:   { id:57, name:"PRIMEAPE",   type:["fighting"],       hp:65, atk:105,def:60, spd:95, spc:60,  baseExp:149, growthRate:'medium_fast', catchRate:75,
                height:"1.0 m", weight:"32.0 kg", dexEntry:"Always furious and tenacious to boot. It will not abandon chasing its quarry until it is caught.",
                learnset:{ 1:['scratch','leer','karate chop','fury swipes'], 28:['focus energy'], 33:['seismic toss'], 41:['thrash'], 53:['submission'] },
                moves:["karate chop","fury swipes","seismic toss","thrash"] },

  // ── #58-59 Growlithe line ────────────────────────────────────────────────
  growlithe:  { id:58, name:"GROWLITHE",  type:["fire"],           hp:55, atk:70, def:45, spd:60, spc:50,  baseExp:91,  growthRate:'slow', catchRate:190,
                height:"0.7 m", weight:"19.0 kg", dexEntry:"Very protective of its territory. It will bark and bite to repel intruders from its space.",
                evolvesTo:{ species:'arcanine', stone:'fire_stone' },
                learnset:{ 1:['bite','roar'], 18:['ember'], 23:['leer'], 30:['agility'], 39:['flamethrower'], 50:['fire blast'] },
                moves:["bite","roar","ember","leer"] },

  arcanine:   { id:59, name:"ARCANINE",   type:["fire"],           hp:90, atk:110,def:80, spd:95, spc:80,  baseExp:213, growthRate:'slow', catchRate:75,
                height:"1.9 m", weight:"155.0 kg", dexEntry:"A POKéMON that has been admired since the past for its beauty. It runs agilely as if on wings.",
                learnset:{ 1:['roar','ember','leer','agility'] },
                moves:["roar","flamethrower","agility","fire blast"] },

  // ── #60-62 Poliwag line ──────────────────────────────────────────────────
  poliwag:    { id:60, name:"POLIWAG",    type:["water"],          hp:40, atk:50, def:40, spd:90, spc:40,  baseExp:77,  growthRate:'medium_slow', catchRate:255,
                height:"0.6 m", weight:"12.4 kg", dexEntry:"Its newly grown legs prevent it from running. It appears to prefer swimming over trying to walk.",
                evolvesTo:{ species:'poliwhirl', level:25 },
                learnset:{ 1:['bubble'], 16:['hypnosis'], 19:['water gun'], 25:['double slap'], 31:['body slam'], 38:['amnesia'], 45:['hydro pump'] },
                moves:["bubble","hypnosis","water gun","double slap"] },

  poliwhirl:  { id:61, name:"POLIWHIRL",  type:["water"],          hp:65, atk:65, def:65, spd:90, spc:50,  baseExp:131, growthRate:'medium_slow', catchRate:120,
                height:"1.0 m", weight:"20.0 kg", dexEntry:"Capable of living in or out of water. When out of water, it sweats to keep its body slimy.",
                evolvesTo:{ species:'poliwrath', stone:'water_stone' },
                learnset:{ 1:['bubble','hypnosis','water gun','double slap'], 25:['body slam'], 31:['amnesia'], 45:['hydro pump'] },
                moves:["water gun","double slap","body slam","amnesia"] },

  poliwrath:  { id:62, name:"POLIWRATH",  type:["water","fighting"],hp:90,atk:85, def:95, spd:70, spc:70,  baseExp:185, growthRate:'medium_slow', catchRate:45,
                height:"1.3 m", weight:"54.0 kg", dexEntry:"An adept swimmer at both the front crawl and breast stroke. Easily overtakes the best human swimmers.",
                learnset:{ 1:['water gun','hypnosis','double slap','body slam'] },
                moves:["water gun","body slam","submission","amnesia"] },

  // ── #63-65 Abra line ─────────────────────────────────────────────────────
  abra:       { id:63, name:"ABRA",       type:["psychic"],        hp:25, atk:20, def:15, spd:90, spc:105, baseExp:73,  growthRate:'medium_slow', catchRate:200,
                height:"0.9 m", weight:"19.5 kg", dexEntry:"Sleeps 18 hours a day. If it senses danger, it teleports itself to safety even while asleep.",
                evolvesTo:{ species:'kadabra', level:16 },
                learnset:{ 1:['teleport'] },
                moves:["teleport"] },

  kadabra:    { id:64, name:"KADABRA",    type:["psychic"],        hp:40, atk:35, def:30, spd:105,spc:120, baseExp:145, growthRate:'medium_slow', catchRate:100,
                height:"1.3 m", weight:"56.5 kg", dexEntry:"It emits special alpha waves from its body that induce headaches just by being close to it.",
                evolvesTo:{ species:'alakazam', level:36 }, // [B3] no link-trade; level substitute
                learnset:{ 1:['teleport','confusion'], 16:['disable'], 20:['psybeam'], 27:['recover'], 31:['psywave'], 38:['amnesia'], 42:['psychic'], 48:['reflect'] },
                moves:["teleport","confusion","disable","psybeam"] },

  alakazam:   { id:65, name:"ALAKAZAM",   type:["psychic"],        hp:55, atk:50, def:45, spd:120,spc:135, baseExp:186, growthRate:'medium_slow', catchRate:50,
                height:"1.5 m", weight:"48.0 kg", dexEntry:"Its brain can outperform a supercomputer. Its intelligence quotient is said to be 5,000.",
                learnset:{ 1:['teleport','confusion','disable','psybeam'], 38:['amnesia'], 42:['psychic'], 48:['reflect'] },
                moves:["confusion","psybeam","recover","psychic"] },

  // ── #66-68 Machop line ───────────────────────────────────────────────────
  machop:     { id:66, name:"MACHOP",     type:["fighting"],       hp:70, atk:80, def:50, spd:35, spc:35,  baseExp:75,  growthRate:'medium_slow', catchRate:180,
                height:"0.8 m", weight:"19.5 kg", dexEntry:"Loves to build its muscles. It trains in all styles of martial arts to become even stronger.",
                evolvesTo:{ species:'machoke', level:28 },
                learnset:{ 1:['karate chop'], 20:['low kick'], 25:['leer'], 32:['focus energy'], 39:['seismic toss'], 46:['submission'] },
                moves:["karate chop","low kick","leer","focus energy"] },

  machoke:    { id:67, name:"MACHOKE",    type:["fighting"],       hp:80, atk:100,def:70, spd:45, spc:50,  baseExp:146, growthRate:'medium_slow', catchRate:90,
                height:"1.5 m", weight:"70.5 kg", dexEntry:"Its muscular body is so powerful, it must wear a power save belt to be able to regulate its motions.",
                evolvesTo:{ species:'machamp', level:36 }, // [B3] no link-trade; level substitute
                learnset:{ 1:['karate chop','low kick','leer','focus energy'], 39:['seismic toss'], 46:['submission'] },
                moves:["karate chop","seismic toss","leer","submission"] },

  machamp:    { id:68, name:"MACHAMP",    type:["fighting"],       hp:90, atk:130,def:80, spd:55, spc:65,  baseExp:193, growthRate:'medium_slow', catchRate:45,
                height:"1.6 m", weight:"130.0 kg", dexEntry:"Using its heavy muscles, it throws powerful punches that can send the victim clear over the horizon.",
                learnset:{ 1:['karate chop','low kick','leer','focus energy'] },
                moves:["karate chop","seismic toss","submission","strength"] },

  // ── #69-71 Bellsprout line ───────────────────────────────────────────────
  bellsprout: { id:69, name:"BELLSPROUT", type:["grass","poison"], hp:50, atk:75, def:35, spd:40, spc:70,  baseExp:84,  growthRate:'medium_slow', catchRate:255,
                height:"0.7 m", weight:"4.0 kg", dexEntry:"A carnivorous POKéMON that traps and eats bugs. It uses its root feet to soak up needed moisture.",
                evolvesTo:{ species:'weepinbell', level:21 },
                learnset:{ 1:['vine whip','growth'], 13:['wrap'], 15:['poison powder'], 18:['sleep powder'], 26:['stun spore'], 29:['acid'], 38:['razor leaf'], 48:['slam'] },
                moves:["vine whip","growth","wrap","poison powder"] },

  weepinbell: { id:70, name:"WEEPINBELL", type:["grass","poison"], hp:65, atk:90, def:50, spd:55, spc:85,  baseExp:151, growthRate:'medium_slow', catchRate:120,
                height:"1.0 m", weight:"6.4 kg", dexEntry:"It spits out POISON POWDER to immobilize the enemy and then finishes it with a spray of ACID.",
                evolvesTo:{ species:'victreebel', stone:'leaf_stone' },
                learnset:{ 1:['vine whip','growth','wrap','poison powder'], 26:['stun spore'], 29:['acid'], 38:['razor leaf'], 48:['slam'] },
                moves:["vine whip","acid","stun spore","razor leaf"] },

  victreebel: { id:71, name:"VICTREEBEL", type:["grass","poison"], hp:80, atk:105,def:65, spd:70, spc:100, baseExp:191, growthRate:'medium_slow', catchRate:45,
                height:"1.7 m", weight:"15.5 kg", dexEntry:"Said to live in huge colonies deep in jungles, although no one has ever returned from there.",
                learnset:{ 1:['vine whip','wrap','poison powder','sleep powder'] },
                moves:["vine whip","razor leaf","sleep powder","slam"] },

  // ── #72-73 Tentacool line ────────────────────────────────────────────────
  tentacool:  { id:72, name:"TENTACOOL",  type:["water","poison"], hp:40, atk:40, def:35, spd:70, spc:100, baseExp:105, growthRate:'slow', catchRate:190,
                height:"0.9 m", weight:"45.5 kg", dexEntry:"Drifts in shallow seas. Anglers who hook them by accident are often punished by its stinging acid.",
                evolvesTo:{ species:'tentacruel', level:30 },
                learnset:{ 1:['acid','constrict'], 7:['supersonic'], 18:['wrap'], 22:['poison sting'], 33:['water gun'], 37:['barrier'], 46:['hydro pump'] },
                moves:["acid","constrict","supersonic","wrap"] },

  tentacruel: { id:73, name:"TENTACRUEL", type:["water","poison"], hp:80, atk:70, def:65, spd:100,spc:120, baseExp:205, growthRate:'slow', catchRate:60,
                height:"1.6 m", weight:"55.0 kg", dexEntry:"The tentacles are normally retracted. They are extended to ensnare and immobilize prey.",
                learnset:{ 1:['acid','constrict','supersonic','wrap'], 22:['poison sting'], 33:['water gun'], 37:['barrier'], 46:['hydro pump'] },
                moves:["acid","water gun","barrier","hydro pump"] },

  // ── #74-76 Geodude line ──────────────────────────────────────────────────
  geodude:    { id:74, name:"GEODUDE",    type:["rock","ground"],  hp:40, atk:80, def:100,spd:20, spc:30,  baseExp:86,  growthRate:'medium_fast', catchRate:255,
                height:"0.4 m", weight:"20.0 kg", dexEntry:"Found in fields and mountains. Mistaking them for boulders, people often step on them and get hurt.",
                evolvesTo:{ species:'graveler', level:25 },
                // [B2] Gen I (Bulbapedia): Defense Curl @11, Rock Throw @16, Self-Destruct @21,
                //      Harden @26, Earthquake @31, Explosion @36 — previous data was shifted 5 levels early
                learnset:{ 1:['tackle'], 11:['defense curl'], 16:['rock throw'], 21:['self destruct'], 26:['harden'], 31:['earthquake'], 36:['explosion'] },
                moves:["tackle","defense curl","rock throw","earthquake"] },

  graveler:   { id:75, name:"GRAVELER",   type:["rock","ground"],  hp:55, atk:95, def:115,spd:35, spc:45,  baseExp:134, growthRate:'medium_fast', catchRate:120,
                height:"1.0 m", weight:"105.0 kg", dexEntry:"Travels by rolling down slopes. Obstacles are simply knocked aside. Loves to eat rocks.",
                evolvesTo:{ species:'golem', level:36 }, // [B3] no link-trade; level substitute
                // [B2] Inherits all Geodude moves by Lv 25; Harden/Earthquake/Explosion corrected levels
                learnset:{ 1:['tackle','defense curl','rock throw','self destruct'], 26:['harden'], 31:['earthquake'], 36:['explosion'] },
                moves:["tackle","defense curl","rock throw","earthquake"] },

  golem:      { id:76, name:"GOLEM",      type:["rock","ground"],  hp:80, atk:110,def:130,spd:45, spc:55,  baseExp:177, growthRate:'medium_fast', catchRate:45,
                height:"1.4 m", weight:"300.0 kg", dexEntry:"Its boulder-like body is extremely hard. It can easily withstand dynamite blasts without any damage.",
                learnset:{ 1:['tackle','defense curl','rock throw','self destruct'] },
                moves:["tackle","rock throw","earthquake","explosion"] },

  // ── #77-78 Ponyta line ───────────────────────────────────────────────────
  ponyta:     { id:77, name:"PONYTA",     type:["fire"],           hp:50, atk:85, def:55, spd:90, spc:65,  baseExp:152, growthRate:'medium_fast', catchRate:190,
                height:"1.0 m", weight:"30.0 kg", dexEntry:"Its hooves are 10 times harder than diamonds. It can trample anything completely flat in moments.",
                evolvesTo:{ species:'rapidash', level:40 },
                learnset:{ 1:['ember'], 30:['stomp'], 32:['growl'], 35:['fire spin'], 39:['take down'], 48:['agility'], 55:['fire blast'] },
                moves:["ember","stomp","growl","fire spin"] },

  rapidash:   { id:78, name:"RAPIDASH",   type:["fire"],           hp:65, atk:100,def:70, spd:105,spc:80,  baseExp:192, growthRate:'medium_fast', catchRate:60,
                height:"1.7 m", weight:"95.0 kg", dexEntry:"Very competitive, this POKéMON will chase anything that moves fast in hopes of racing it.",
                learnset:{ 1:['ember','stomp','growl','fire spin'], 48:['agility'], 58:['fire blast'] },
                moves:["ember","stomp","fire spin","agility"] },

  // ── #79-80 Slowpoke line ─────────────────────────────────────────────────
  slowpoke:   { id:79, name:"SLOWPOKE",   type:["water","psychic"],hp:90, atk:65, def:65, spd:15, spc:40,  baseExp:99,  growthRate:'medium_fast', catchRate:190,
                height:"1.2 m", weight:"36.0 kg", dexEntry:"Incredibly slow and dopey. It takes 5 seconds for it to feel pain when under attack.",
                evolvesTo:{ species:'slowbro', level:37 },
                learnset:{ 1:['confusion'], 18:['disable'], 22:['headbutt'], 28:['growl'], 36:['water gun'], 46:['amnesia'], 52:['psychic'] },
                moves:["confusion","disable","headbutt","growl"] },

  slowbro:    { id:80, name:"SLOWBRO",    type:["water","psychic"],hp:95, atk:75, def:110,spd:30, spc:80,  baseExp:164, growthRate:'medium_fast', catchRate:75,
                height:"1.6 m", weight:"78.5 kg", dexEntry:"The SHELLDER that latched on to SLOWPOKE's tail is said to feed on its host's left-over scraps.",
                learnset:{ 1:['confusion','disable','headbutt','growl'], 46:['amnesia'], 52:['psychic'] },
                moves:["confusion","water gun","amnesia","psychic"] },

  // ── #81-82 Magnemite line ────────────────────────────────────────────────
  magnemite:  { id:81, name:"MAGNEMITE",  type:["electric"],       hp:25, atk:35, def:70, spd:45, spc:95,  baseExp:89,  growthRate:'medium_fast', catchRate:190,
                height:"0.3 m", weight:"6.0 kg", dexEntry:"Uses anti-gravity to stay suspended. Appears without warning and uses THUNDER WAVE and similar moves.",
                evolvesTo:{ species:'magneton', level:30 },
                // [B2] @21 was duplicate Thunder Shock — Gen I teaches Sonic Boom at Lv 21
                learnset:{ 1:['tackle','thunder shock'], 21:['sonic boom'], 25:['supersonic'], 29:['thunder wave'], 35:['swift'], 41:['screech'], 51:['thunderbolt'] },
                moves:["tackle","thunder shock","supersonic","thunder wave"] },

  magneton:   { id:82, name:"MAGNETON",   type:["electric"],       hp:50, atk:60, def:95, spd:70, spc:120, baseExp:161, growthRate:'medium_fast', catchRate:60,
                height:"1.0 m", weight:"60.0 kg", dexEntry:"Formed by several MAGNEMITEs linked together. They frequently appear when sunspots flare up.",
                // [B2] Add sonic boom to inherited moves (learned by Magnemite at Lv 21, before evo at 30)
                learnset:{ 1:['tackle','thunder shock','sonic boom','supersonic','thunder wave'], 35:['swift'], 41:['screech'], 51:['thunderbolt'] },
                moves:["thunder shock","thunder wave","screech","thunderbolt"] },

  // ── #83 Farfetch'd ───────────────────────────────────────────────────────
  farfetchd:  { id:83, name:"FARFETCH'D", type:["normal","flying"],hp:52, atk:65, def:55, spd:60, spc:58,  baseExp:94,  growthRate:'medium_fast', catchRate:45,
                height:"0.8 m", weight:"15.0 kg", dexEntry:"The plant stalk it holds is its weapon and food source. Holding it makes the POKéMON feel calm.",
                learnset:{ 1:['peck','sand attack'], 25:['leer'], 30:['fury attack'], 35:['swords dance'], 40:['agility'], 45:['slash'] },
                moves:["peck","sand attack","leer","fury attack"] },

  // ── #84-85 Doduo line ────────────────────────────────────────────────────
  doduo:      { id:84, name:"DODUO",      type:["normal","flying"],hp:35, atk:85, def:45, spd:75, spc:35,  baseExp:96,  growthRate:'medium_fast', catchRate:190,
                height:"1.4 m", weight:"39.2 kg", dexEntry:"A bird that makes up for its poor flying with its fast legwork. The two heads check on each other.",
                evolvesTo:{ species:'dodrio', level:31 },
                learnset:{ 1:['peck','growl'], 20:['fury attack'], 30:['drill peck'], 40:['agility'], 50:['tri attack'] },
                moves:["peck","growl","fury attack","drill peck"] },

  dodrio:     { id:85, name:"DODRIO",     type:["normal","flying"],hp:60, atk:110,def:70, spd:100,spc:60,  baseExp:158, growthRate:'medium_fast', catchRate:45,
                height:"1.8 m", weight:"85.2 kg", dexEntry:"Uses its three brains to execute complex plans. While two heads sleep, one stays awake.",
                learnset:{ 1:['peck','growl','fury attack','drill peck'], 40:['agility'], 50:['tri attack'] },
                moves:["peck","fury attack","drill peck","tri attack"] },

  // ── #86-87 Seel line ─────────────────────────────────────────────────────
  seel:       { id:86, name:"SEEL",       type:["water"],          hp:65, atk:45, def:55, spd:45, spc:70,  baseExp:100, growthRate:'medium_fast', catchRate:190,
                height:"1.1 m", weight:"90.0 kg", dexEntry:"The protruding horn on its head is very hard. It is used for bashing through thick ice.",
                evolvesTo:{ species:'dewgong', level:34 },
                learnset:{ 1:['headbutt'], 30:['growl'], 35:['aurora beam'], 40:['rest'], 45:['take down'], 50:['ice beam'] },
                moves:["headbutt","growl","aurora beam","rest"] },

  dewgong:    { id:87, name:"DEWGONG",    type:["water","ice"],    hp:90, atk:70, def:80, spd:70, spc:95,  baseExp:176, growthRate:'medium_fast', catchRate:75,
                height:"1.7 m", weight:"120.0 kg", dexEntry:"Loves to bask and sleep on ice floes. Capable of swimming at eight knots even in intensely cold waters.",
                learnset:{ 1:['headbutt','growl','aurora beam','rest'], 44:['take down'], 50:['ice beam'] },
                moves:["aurora beam","rest","take down","ice beam"] },

  // ── #88-89 Grimer line ───────────────────────────────────────────────────
  grimer:     { id:88, name:"GRIMER",     type:["poison"],         hp:80, atk:80, def:50, spd:25, spc:40,  baseExp:90,  growthRate:'medium_fast', catchRate:190,
                height:"0.9 m", weight:"30.0 kg", dexEntry:"Appears in filthy areas. Thrives by sucking up polluted sludge that is pumped out of factories.",
                evolvesTo:{ species:'muk', level:38 },
                learnset:{ 1:['pound','disable'], 30:['poison gas'], 33:['minimize'], 37:['screech'], 42:['sludge'], 48:['harden'], 55:['acid armor'] },
                moves:["pound","disable","poison gas","minimize"] },

  muk:        { id:89, name:"MUK",        type:["poison"],         hp:105,atk:105,def:75, spd:50, spc:65,  baseExp:157, growthRate:'medium_fast', catchRate:75,
                height:"1.2 m", weight:"30.0 kg", dexEntry:"Thickly covered with a filthy, vile sludge. It is so toxic, even its footprints contain poison.",
                learnset:{ 1:['pound','disable','poison gas','minimize'], 42:['sludge'], 55:['harden'], 60:['acid armor'] },
                moves:["sludge","minimize","harden","screech"] },

  // ── #90-91 Shellder line ─────────────────────────────────────────────────
  shellder:   { id:90, name:"SHELLDER",   type:["water"],          hp:30, atk:65, def:100,spd:40, spc:45,  baseExp:97,  growthRate:'slow', catchRate:190,
                height:"0.3 m", weight:"4.0 kg", dexEntry:"Its shell is harder than diamond. Despite this, the inside is very soft. It is vulnerable when open.",
                evolvesTo:{ species:'cloyster', stone:'water_stone' },
                learnset:{ 1:['tackle','withdraw'], 18:['supersonic'], 23:['clamp'], 30:['aurora beam'], 39:['leer'], 50:['ice beam'] },
                moves:["tackle","withdraw","supersonic","clamp"] },

  cloyster:   { id:91, name:"CLOYSTER",   type:["water","ice"],    hp:50, atk:95, def:180,spd:70, spc:85,  baseExp:203, growthRate:'slow', catchRate:60,
                height:"1.5 m", weight:"132.5 kg", dexEntry:"When attacked, it will always keep its shell tightly shut. It is difficult to pry it open even with a crowbar.",
                learnset:{ 1:['tackle','withdraw','supersonic','clamp'] },
                moves:["clamp","aurora beam","spike cannon","blizzard"] },

  // ── #92-94 Gastly line ───────────────────────────────────────────────────
  gastly:     { id:92, name:"GASTLY",     type:["ghost","poison"], hp:30, atk:35, def:30, spd:80, spc:100, baseExp:95,  growthRate:'medium_slow', catchRate:190,
                height:"1.3 m", weight:"0.1 kg", dexEntry:"Almost invisible, this gaseous POKéMON cloaks the target and puts it to sleep without any notification.",
                evolvesTo:{ species:'haunter', level:25 },
                learnset:{ 1:['lick','confuse ray'], 27:['night shade'], 35:['hypnosis'] },
                moves:["lick","confuse ray","night shade","hypnosis"] },

  haunter:    { id:93, name:"HAUNTER",    type:["ghost","poison"], hp:45, atk:50, def:45, spd:95, spc:115, baseExp:126, growthRate:'medium_slow', catchRate:90,
                height:"1.6 m", weight:"0.1 kg", dexEntry:"Because of its ability to slip through block walls, it is said to be from another dimension.",
                evolvesTo:{ species:'gengar', level:36 }, // [B3] no link-trade; level substitute
                learnset:{ 1:['lick','confuse ray','night shade','hypnosis'] },
                moves:["lick","confuse ray","night shade","hypnosis"] },

  gengar:     { id:94, name:"GENGAR",     type:["ghost","poison"], hp:60, atk:65, def:60, spd:110,spc:130, baseExp:190, growthRate:'medium_slow', catchRate:45,
                height:"1.5 m", weight:"40.5 kg", dexEntry:"Under a full moon, this POKéMON likes to mimic the shadows of people and laugh at their fright.",
                learnset:{ 1:['lick','confuse ray','night shade','hypnosis'] },
                moves:["lick","confuse ray","night shade","psychic"] },

  // ── #95 Onix ─────────────────────────────────────────────────────────────
  onix:       { id:95, name:"ONIX",       type:["rock","ground"],  hp:35, atk:45, def:160,spd:70, spc:30,  baseExp:108, growthRate:'medium_fast', catchRate:45,
                height:"8.8 m", weight:"210.0 kg", dexEntry:"As it grows, the stone portions of its body harden to become similar to a diamond, albeit colored black.",
                learnset:{ 1:['tackle','screech'], 15:['bind'], 19:['rock throw'], 25:['rage'], 33:['slam'], 43:['harden'] },
                // Brock's Onix: Tackle, Screech, Bide, Bind (Gen I Red/Blue)
                moves:["tackle","screech","bide","bind"] },

  // ── #96-97 Drowzee line ──────────────────────────────────────────────────
  drowzee:    { id:96, name:"DROWZEE",    type:["psychic"],        hp:60, atk:48, def:45, spd:42, spc:43,  baseExp:102, growthRate:'medium_fast', catchRate:190,
                height:"1.0 m", weight:"32.4 kg", dexEntry:"Puts enemies to sleep then eats their dreams. Occasionally gets sick from eating bad dreams.",
                evolvesTo:{ species:'hypno', level:26 },
                learnset:{ 1:['pound','hypnosis'], 12:['disable'], 17:['confusion'], 24:['headbutt'], 29:['poison gas'], 32:['psybeam'], 37:['psychic'] },
                moves:["pound","hypnosis","disable","confusion"] },

  hypno:      { id:97, name:"HYPNO",      type:["psychic"],        hp:85, atk:73, def:70, spd:67, spc:73,  baseExp:165, growthRate:'medium_fast', catchRate:75,
                height:"1.6 m", weight:"75.6 kg", dexEntry:"When it locks eyes with an enemy, it will use a mix of PSI moves such as HYPNOSIS and CONFUSION.",
                learnset:{ 1:['pound','hypnosis','disable','confusion'], 29:['poison gas'], 32:['psybeam'], 37:['psychic'] },
                moves:["hypnosis","confusion","psybeam","psychic"] },

  // ── #98-99 Krabby line ───────────────────────────────────────────────────
  krabby:     { id:98, name:"KRABBY",     type:["water"],          hp:30, atk:105,def:90, spd:50, spc:25,  baseExp:115, growthRate:'medium_fast', catchRate:225,
                height:"0.4 m", weight:"6.5 kg", dexEntry:"Its pincers are not only powerful weapons, they are also used for balance when walking sideways.",
                evolvesTo:{ species:'kingler', level:28 },
                learnset:{ 1:['bubble','leer'], 25:['clamp'], 30:['crabhammer'], 35:['stomp'], 40:['guillotine'] },
                moves:["bubble","leer","clamp","crabhammer"] },

  kingler:    { id:99, name:"KINGLER",    type:["water"],          hp:55, atk:130,def:115,spd:75, spc:50,  baseExp:206, growthRate:'medium_fast', catchRate:60,
                height:"1.3 m", weight:"60.0 kg", dexEntry:"The large pincer has 10,000 hp of crushing power. However, it is so heavy, it is difficult to aim.",
                learnset:{ 1:['bubble','leer','clamp','crabhammer'], 40:['stomp'], 50:['guillotine'] },
                moves:["crabhammer","stomp","clamp","guillotine"] },

  // ── #100-101 Voltorb line ────────────────────────────────────────────────
  voltorb:    { id:100,name:"VOLTORB",    type:["electric"],       hp:40, atk:30, def:50, spd:100,spc:55,  baseExp:103, growthRate:'medium_fast', catchRate:190,
                height:"0.5 m", weight:"10.4 kg", dexEntry:"Usually found in power plants. Easily mistaken for a POKé BALL, they have zapped many people.",
                evolvesTo:{ species:'electrode', level:30 },
                learnset:{ 1:['tackle','screech'], 17:['sonic boom'], 22:['self destruct'], 29:['swift'], 36:['thunderbolt'], 40:['explosion'] },
                moves:["tackle","screech","sonic boom","swift"] },

  electrode:  { id:101,name:"ELECTRODE",  type:["electric"],       hp:60, atk:50, def:70, spd:140,spc:80,  baseExp:150, growthRate:'medium_fast', catchRate:60,
                height:"1.2 m", weight:"66.6 kg", dexEntry:"It stores electric energy under very high pressure. It often explodes with little or no provocation.",
                learnset:{ 1:['tackle','screech','sonic boom','swift'], 36:['thunderbolt'], 40:['explosion'] },
                moves:["swift","thunderbolt","screech","explosion"] },

  // ── #102-103 Exeggcute line ──────────────────────────────────────────────
  exeggcute:  { id:102,name:"EXEGGCUTE",  type:["grass","psychic"],hp:60, atk:40, def:80, spd:40, spc:60,  baseExp:98,  growthRate:'slow', catchRate:90,
                height:"0.4 m", weight:"2.5 kg", dexEntry:"Often mistaken for eggs. When disturbed, they quickly gather and attack in swarms.",
                evolvesTo:{ species:'exeggutor', stone:'leaf_stone' },
                learnset:{ 1:['barrage','hypnosis'], 25:['reflect'], 28:['leech seed'], 32:['stun spore'], 37:['poison powder'], 42:['solar beam'], 48:['sleep powder'] },
                moves:["barrage","hypnosis","reflect","leech seed"] },

  exeggutor:  { id:103,name:"EXEGGUTOR",  type:["grass","psychic"],hp:95, atk:95, def:85, spd:55, spc:125, baseExp:212, growthRate:'slow', catchRate:45,
                height:"2.0 m", weight:"120.0 kg", dexEntry:"Legend has it that on rare occasions, one of its heads will drop off and continue life as an EXEGGCUTE.",
                learnset:{ 1:['barrage','hypnosis','stomp'] },
                moves:["barrage","stomp","sleep powder","psychic"] },

  // ── #104-105 Cubone line ─────────────────────────────────────────────────
  cubone:     { id:104,name:"CUBONE",     type:["ground"],         hp:50, atk:50, def:95, spd:35, spc:40,  baseExp:87,  growthRate:'medium_fast', catchRate:190,
                height:"0.4 m", weight:"6.5 kg", dexEntry:"Because it never removes its skull helmet, no one has ever seen this POKéMON's real face.",
                evolvesTo:{ species:'marowak', level:28 },
                learnset:{ 1:['growl','tackle'], 25:['bone club'], 31:['headbutt'], 38:['leer'], 43:['focus energy'], 46:['thrash'], 50:['bonemerang'] },
                moves:["growl","tackle","bone club","headbutt"] },

  marowak:    { id:105,name:"MAROWAK",    type:["ground"],         hp:60, atk:80, def:110,spd:45, spc:50,  baseExp:124, growthRate:'medium_fast', catchRate:75,
                height:"1.0 m", weight:"45.0 kg", dexEntry:"The bone it holds is its key weapon. It throws the bone skillfully like a boomerang to KO targets.",
                learnset:{ 1:['growl','tackle','bone club','headbutt'], 33:['focus energy'], 41:['thrash'], 48:['bonemerang'] },
                moves:["bone club","headbutt","focus energy","bonemerang"] },

  // ── #106 Hitmonlee ───────────────────────────────────────────────────────
  hitmonlee:  { id:106,name:"HITMONLEE",  type:["fighting"],       hp:50, atk:120,def:53, spd:87, spc:35,  baseExp:139, growthRate:'medium_fast', catchRate:45,
                height:"1.5 m", weight:"49.8 kg", dexEntry:"When in a hurry, its legs lengthen progressively. It runs smoothly with extra long, loping strides.",
                learnset:{ 1:['double kick','meditate'], 33:['rolling kick'], 38:['jump kick'], 43:['focus energy'], 48:['high jump kick'], 53:['mega kick'] },
                moves:["double kick","meditate","rolling kick","jump kick"] },

  // ── #107 Hitmonchan ──────────────────────────────────────────────────────
  hitmonchan: { id:107,name:"HITMONCHAN", type:["fighting"],       hp:50, atk:105,def:79, spd:76, spc:35,  baseExp:140, growthRate:'medium_fast', catchRate:45,
                height:"1.4 m", weight:"50.2 kg", dexEntry:"While apparently doing nothing, it fires punches in lightning-fast volleys that are impossible to see.",
                learnset:{ 1:['comet punch','agility'], 33:['fire punch'], 38:['ice punch'], 43:['thunder punch'], 48:['mega punch'], 53:['submission'] },
                moves:["comet punch","agility","fire punch","ice punch"] },

  // ── #108 Lickitung ───────────────────────────────────────────────────────
  lickitung:  { id:108,name:"LICKITUNG",  type:["normal"],         hp:90, atk:55, def:75, spd:30, spc:60,  baseExp:127, growthRate:'medium_fast', catchRate:45,
                height:"1.2 m", weight:"65.5 kg", dexEntry:"Its tongue can be extended like a chameleon's. It leaves a tingling sensation when it licks enemies.",
                learnset:{ 1:['wrap','supersonic'], 7:['stomp'], 15:['disable'], 23:['defense curl'], 31:['slam'], 39:['screech'] },
                moves:["wrap","supersonic","stomp","disable"] },

  // ── #109-110 Koffing line ────────────────────────────────────────────────
  koffing:    { id:109,name:"KOFFING",    type:["poison"],         hp:40, atk:65, def:95, spd:35, spc:60,  baseExp:114, growthRate:'medium_fast', catchRate:190,
                height:"0.6 m", weight:"1.0 kg", dexEntry:"Because it stores several kinds of toxic gases in its body, it is prone to exploding without any warning.",
                evolvesTo:{ species:'weezing', level:35 },
                learnset:{ 1:['tackle','smog'], 32:['self destruct'], 37:['sludge'], 40:['smokescreen'], 45:['haze'], 50:['explosion'] },
                moves:["tackle","smog","self destruct","sludge"] },

  weezing:    { id:110,name:"WEEZING",    type:["poison"],         hp:65, atk:90, def:120,spd:60, spc:85,  baseExp:173, growthRate:'medium_fast', catchRate:60,
                height:"1.2 m", weight:"9.5 kg", dexEntry:"Where two kinds of poison gases meet, two KOFFING merge and becomeWEEZING over many years.",
                learnset:{ 1:['tackle','smog','self destruct','sludge'], 45:['haze'], 50:['explosion'] },
                moves:["sludge","smokescreen","haze","explosion"] },

  // ── #111-112 Rhyhorn line ────────────────────────────────────────────────
  rhyhorn:    { id:111,name:"RHYHORN",    type:["ground","rock"],  hp:80, atk:85, def:95, spd:25, spc:30,  baseExp:135, growthRate:'slow', catchRate:120,
                height:"1.0 m", weight:"115.0 kg", dexEntry:"Its horn can destroy a building in one charge. It is too dumb to feel pain when it crashes.",
                evolvesTo:{ species:'rhydon', level:42 },
                learnset:{ 1:['horn attack'], 30:['stomp'], 35:['tail whip'], 40:['fury attack'], 45:['horn drill'], 50:['take down'], 55:['leer'] },
                moves:["horn attack","stomp","tail whip","fury attack"] },

  rhydon:     { id:112,name:"RHYDON",     type:["ground","rock"],  hp:105,atk:130,def:120,spd:40, spc:45,  baseExp:204, growthRate:'slow', catchRate:60,
                height:"1.9 m", weight:"120.0 kg", dexEntry:"Protected by an armor-like hide, it is capable of living in molten lava of 3,600 degrees.",
                learnset:{ 1:['horn attack','stomp','tail whip','fury attack'] },
                moves:["horn attack","stomp","earthquake","rock slide"] },

  // ── #113 Chansey ─────────────────────────────────────────────────────────
  chansey:    { id:113,name:"CHANSEY",    type:["normal"],         hp:250,atk:5,  def:5,  spd:50, spc:105, baseExp:255, growthRate:'fast', catchRate:30,
                height:"1.1 m", weight:"34.6 kg", dexEntry:"A rare and elusive POKéMON that is said to bring happiness to those who manage to get it.",
                learnset:{ 1:['pound','growl'], 24:['tail whip'], 30:['sing'], 38:['egg bomb'], 44:['minimize'], 48:['defense curl'], 54:['light screen'], 60:['double edge'] },
                moves:["pound","growl","tail whip","sing"] },

  // ── #114 Tangela ─────────────────────────────────────────────────────────
  tangela:    { id:114,name:"TANGELA",    type:["grass"],          hp:65, atk:55, def:115,spd:60, spc:100, baseExp:166, growthRate:'medium_fast', catchRate:45,
                height:"1.0 m", weight:"35.0 kg", dexEntry:"The whole body is swathed with wide vines that are similar to seaweed. Its vines shake as it walks.",
                learnset:{ 1:['constrict','bind'], 29:['absorb'], 32:['vine whip'], 36:['stun spore'], 39:['poison powder'], 45:['sleep powder'], 49:['growth'] },
                moves:["constrict","bind","absorb","vine whip"] },

  // ── #115 Kangaskhan ──────────────────────────────────────────────────────
  kangaskhan: { id:115,name:"KANGASKHAN", type:["normal"],         hp:105,atk:95, def:80, spd:90, spc:40,  baseExp:175, growthRate:'medium_fast', catchRate:45,
                height:"2.2 m", weight:"80.0 kg", dexEntry:"The infant rarely ventures out of its mother's protective pouch until it is 3 years old.",
                learnset:{ 1:['comet punch','leer'], 26:['bite'], 31:['tail whip'], 36:['mega punch'], 46:['headbutt'] },
                moves:["comet punch","leer","bite","tail whip"] },

  // ── #116-117 Horsea line ─────────────────────────────────────────────────
  horsea:     { id:116,name:"HORSEA",     type:["water"],          hp:30, atk:40, def:70, spd:60, spc:70,  baseExp:83,  growthRate:'medium_fast', catchRate:225,
                height:"0.4 m", weight:"8.0 kg", dexEntry:"Known to shoot down flying bugs with precision. It builds its nest in coral reefs.",
                evolvesTo:{ species:'seadra', level:32 },
                learnset:{ 1:['bubble'], 19:['smokescreen'], 24:['leer'], 30:['water gun'], 37:['agility'], 45:['hydro pump'] },
                moves:["bubble","smokescreen","leer","water gun"] },

  seadra:     { id:117,name:"SEADRA",     type:["water"],          hp:55, atk:65, def:95, spd:85, spc:95,  baseExp:155, growthRate:'medium_fast', catchRate:75,
                height:"1.2 m", weight:"25.0 kg", dexEntry:"Capable of swimming backwards by rapidly flapping its wing-like pectoral fins and stout tail.",
                learnset:{ 1:['bubble','smokescreen','leer','water gun'], 37:['agility'], 45:['hydro pump'] },
                moves:["water gun","leer","agility","hydro pump"] },

  // ── #118-119 Goldeen line ────────────────────────────────────────────────
  goldeen:    { id:118,name:"GOLDEEN",    type:["water"],          hp:45, atk:67, def:60, spd:63, spc:50,  baseExp:111, growthRate:'medium_fast', catchRate:225,
                height:"0.6 m", weight:"15.0 kg", dexEntry:"A beautiful fish POKéMON with fins that elegantly wave. Its tail fin billows like an elegant dress.",
                evolvesTo:{ species:'seaking', level:33 },
                learnset:{ 1:['peck','tail whip'], 19:['supersonic'], 24:['horn attack'], 29:['fury attack'], 38:['waterfall'], 45:['horn drill'] },
                moves:["peck","tail whip","supersonic","horn attack"] },

  seaking:    { id:119,name:"SEAKING",    type:["water"],          hp:80, atk:92, def:65, spd:68, spc:80,  baseExp:170, growthRate:'medium_fast', catchRate:60,
                height:"1.3 m", weight:"39.0 kg", dexEntry:"In autumn, its body becomes more fatty in preparing to propose to a mate. It takes care of its eggs.",
                learnset:{ 1:['peck','tail whip','supersonic','horn attack'], 38:['waterfall'], 48:['horn drill'] },
                moves:["horn attack","fury attack","waterfall","agility"] },

  // ── #120-121 Staryu line ─────────────────────────────────────────────────
  staryu:     { id:120,name:"STARYU",     type:["water"],          hp:30, atk:45, def:55, spd:85, spc:70,  baseExp:106, growthRate:'slow', catchRate:225,
                height:"0.8 m", weight:"34.5 kg", dexEntry:"An enigmatic POKéMON that can effortlessly regenerate any appendage it loses in battle.",
                evolvesTo:{ species:'starmie', stone:'water_stone' },
                learnset:{ 1:['tackle'], 17:['water gun'], 22:['harden'], 27:['minimize'], 32:['light screen'], 37:['swift'], 44:['psychic'] },
                moves:["tackle","water gun","harden","swift"] },

  starmie:    { id:121,name:"STARMIE",    type:["water","psychic"],hp:60, atk:75, def:85, spd:115,spc:100, baseExp:207, growthRate:'slow', catchRate:60,
                height:"1.1 m", weight:"80.0 kg", dexEntry:"Its central core glows with the seven colors of the rainbow. Some people value the core as a gem.",
                learnset:{ 1:['tackle','water gun','harden','swift'] },
                moves:["water gun","swift","psychic","blizzard"] },

  // ── #122 Mr. Mime ────────────────────────────────────────────────────────
  mr_mime:    { id:122,name:"MR. MIME",   type:["psychic"],        hp:40, atk:45, def:65, spd:90, spc:100, baseExp:136, growthRate:'medium_fast', catchRate:45,
                height:"1.3 m", weight:"54.5 kg", dexEntry:"If interrupted while it is miming, it will slap around the offender with its broad hands.",
                learnset:{ 1:['confusion','barrier'], 15:['meditate'], 23:['psybeam'], 31:['substitute'], 47:['psychic'] },
                moves:["confusion","barrier","psybeam","psychic"] },

  // ── #123 Scyther ─────────────────────────────────────────────────────────
  scyther:    { id:123,name:"SCYTHER",    type:["bug","flying"],   hp:70, atk:110,def:80, spd:105,spc:55,  baseExp:187, growthRate:'medium_fast', catchRate:45,
                height:"1.5 m", weight:"56.0 kg", dexEntry:"With ninja-like agility and speed, it can create the illusion that there is more than one.",
                learnset:{ 1:['quick attack'], 17:['leer'], 20:['focus energy'], 24:['double team'], 29:['slash'], 33:['swords dance'], 38:['agility'] },
                moves:["quick attack","leer","slash","swords dance"] },

  // ── #124 Jynx ────────────────────────────────────────────────────────────
  jynx:       { id:124,name:"JYNX",       type:["ice","psychic"],  hp:65, atk:50, def:35, spd:95, spc:95,  baseExp:137, growthRate:'medium_fast', catchRate:45,
                height:"1.4 m", weight:"40.6 kg", dexEntry:"It seductively wiggles its hips as it walks. It can cause people to dance in unison with it.",
                // [B2] @23 was duplicate Lick — Gen I: Double Slap @23, Ice Punch @31, Body Slam @39
                learnset:{ 1:['pound','lick'], 18:['lovely kiss'], 23:['double slap'], 31:['ice punch'], 39:['body slam'], 47:['blizzard'], 58:['psychic'] },
                moves:["pound","lovely kiss","lick","ice punch"] },

  // ── #125 Electabuzz ──────────────────────────────────────────────────────
  electabuzz: { id:125,name:"ELECTABUZZ", type:["electric"],       hp:65, atk:83, def:57, spd:105,spc:85,  baseExp:156, growthRate:'medium_fast', catchRate:45,
                height:"1.1 m", weight:"30.0 kg", dexEntry:"Normally found near power plants, they can wander away and cause major blackouts in cities.",
                learnset:{ 1:['leer','thunder shock'], 34:['quick attack'], 37:['thunder punch'], 42:['thunder wave'], 49:['thunderbolt'], 54:['thunder'] },
                moves:["leer","thunder shock","thunder punch","thunder wave"] },

  // ── #126 Magmar ──────────────────────────────────────────────────────────
  magmar:     { id:126,name:"MAGMAR",     type:["fire"],           hp:65, atk:95, def:57, spd:93, spc:85,  baseExp:167, growthRate:'medium_fast', catchRate:45,
                height:"1.3 m", weight:"44.5 kg", dexEntry:"Its body always burns with an orange glow that enables it to hide among flames and hunt its prey.",
                learnset:{ 1:['ember','leer'], 36:['confuse ray'], 39:['fire punch'], 43:['smokescreen'], 48:['smog'], 52:['flamethrower'], 55:['fire blast'] },
                moves:["ember","leer","fire punch","confuse ray"] },

  // ── #127 Pinsir ──────────────────────────────────────────────────────────
  pinsir:     { id:127,name:"PINSIR",     type:["bug"],            hp:65, atk:125,def:100,spd:85, spc:55,  baseExp:200, growthRate:'slow', catchRate:45,
                height:"1.5 m", weight:"55.0 kg", dexEntry:"If it fails to crush the foe in its pincers, it will swing it around and toss it hard.",
                learnset:{ 1:['vice grip'], 25:['seismic toss'], 30:['guillotine'], 36:['focus energy'], 43:['harden'], 49:['slash'], 54:['swords dance'] },
                moves:["vice grip","seismic toss","guillotine","slash"] },

  // ── #128 Tauros ──────────────────────────────────────────────────────────
  tauros:     { id:128,name:"TAUROS",     type:["normal"],         hp:75, atk:100,def:95, spd:110,spc:70,  baseExp:211, growthRate:'slow', catchRate:45,
                height:"1.4 m", weight:"88.4 kg", dexEntry:"When it targets an enemy, it charges furiously while whipping its body with its three tails.",
                learnset:{ 1:['tackle'], 20:['stomp'], 25:['tail whip'], 35:['leer'], 44:['thrash'], 51:['take down'] },
                moves:["tackle","stomp","tail whip","leer"] },

  // ── #129-130 Magikarp line ───────────────────────────────────────────────
  magikarp:   { id:129,name:"MAGIKARP",   type:["water"],          hp:20, atk:10, def:55, spd:80, spc:20,  baseExp:20,  growthRate:'slow', catchRate:255,
                height:"0.9 m", weight:"10.0 kg", dexEntry:"In the distant past, it was somewhat stronger than the horribly weak descendant that exists today.",
                evolvesTo:{ species:'gyarados', level:20 },
                learnset:{ 1:['splash'], 15:['tackle'] },
                moves:["splash","tackle"] },

  gyarados:   { id:130,name:"GYARADOS",   type:["water","flying"], hp:95, atk:125,def:79, spd:81, spc:100, baseExp:214, growthRate:'slow', catchRate:45,
                height:"6.5 m", weight:"235.0 kg", dexEntry:"Once it begins to rampage, a GYARADOS will burn everything down, even in a harsh storm.",
                learnset:{ 1:['tackle'], 20:['bite'], 25:['dragon rage'], 32:['leer'], 41:['hydro pump'], 52:['hyper beam'] },
                moves:["bite","dragon rage","hydro pump","hyper beam"] },

  // ── #131 Lapras ──────────────────────────────────────────────────────────
  lapras:     { id:131,name:"LAPRAS",     type:["water","ice"],    hp:130,atk:85, def:80, spd:60, spc:95,  baseExp:219, growthRate:'slow', catchRate:45,
                height:"2.5 m", weight:"220.0 kg", dexEntry:"A POKéMON that has been overhunted almost to extinction. It can ferry people across the water.",
                learnset:{ 1:['water gun','growl'], 16:['sing'], 20:['mist'], 26:['body slam'], 32:['confuse ray'], 40:['ice beam'], 48:['hydro pump'] },
                moves:["water gun","growl","sing","mist"] },

  // ── #132 Ditto ───────────────────────────────────────────────────────────
  ditto:      { id:132,name:"DITTO",      type:["normal"],         hp:48, atk:48, def:48, spd:48, spc:48,  baseExp:61,  growthRate:'medium_fast', catchRate:35,
                height:"0.3 m", weight:"4.0 kg", dexEntry:"Capable of copying an enemy's genetic code to instantly transform itself into a duplicate of the enemy.",
                learnset:{ 1:['transform'] },
                moves:["transform"] },

  // ── #133-136 Eevee line ──────────────────────────────────────────────────
  eevee:      { id:133,name:"EEVEE",      type:["normal"],         hp:55, atk:55, def:50, spd:55, spc:45,  baseExp:92,  growthRate:'medium_fast', catchRate:45,
                height:"0.3 m", weight:"6.5 kg", dexEntry:"Its genetic code is irregular. It may mutate if it is exposed to radiation from element STONES.",
                evolvesTo:[
                  { species:'vaporeon', stone:'water_stone' },
                  { species:'jolteon',  stone:'thunder_stone' },
                  { species:'flareon',  stone:'fire_stone' },
                ],
                learnset:{ 1:['tackle','tail whip','sand attack','quick attack'], 23:['growl'], 30:['bite'] },
                moves:["tackle","tail whip","sand attack","quick attack"] },

  vaporeon:   { id:134,name:"VAPOREON",   type:["water"],          hp:130,atk:65, def:60, spd:65, spc:110, baseExp:196, growthRate:'medium_fast', catchRate:45,
                height:"1.0 m", weight:"29.0 kg", dexEntry:"Lives close to water. Its long tail is ridged with a fin which is often mistaken for a mermaid's.",
                learnset:{ 1:['tackle','tail whip','sand attack','quick attack'], 36:['water gun'], 41:['acid armor'], 46:['haze'], 51:['mist'], 56:['hydro pump'] },
                moves:["tackle","water gun","acid armor","hydro pump"] },

  jolteon:    { id:135,name:"JOLTEON",    type:["electric"],       hp:65, atk:65, def:60, spd:130,spc:110, baseExp:197, growthRate:'medium_fast', catchRate:45,
                height:"0.8 m", weight:"24.5 kg", dexEntry:"It accumulates negative ions in the atmosphere to blast out 10,000-volt lightning bolts.",
                learnset:{ 1:['tackle','tail whip','sand attack','quick attack'], 36:['thunder shock'], 41:['agility'], 46:['thunder wave'], 51:['swift'], 56:['thunder'] },
                moves:["tackle","thunder shock","thunder wave","thunderbolt"] },

  flareon:    { id:136,name:"FLAREON",    type:["fire"],           hp:65, atk:130,def:60, spd:65, spc:110, baseExp:198, growthRate:'medium_fast', catchRate:45,
                height:"0.9 m", weight:"25.0 kg", dexEntry:"When FLAREON's body temperature rises, its fur glows with a beautiful, fiery orange color.",
                learnset:{ 1:['tackle','tail whip','sand attack','quick attack'], 36:['ember'], 41:['leer'], 46:['fire spin'], 51:['smog'], 56:['flamethrower'] },
                moves:["tackle","ember","leer","flamethrower"] },

  // ── #137 Porygon ─────────────────────────────────────────────────────────
  porygon:    { id:137,name:"PORYGON",    type:["normal"],         hp:65, atk:60, def:70, spd:40, spc:75,  baseExp:130, growthRate:'medium_fast', catchRate:45,
                height:"0.8 m", weight:"36.5 kg", dexEntry:"A POKéMON that consists entirely of programming code. Capable of moving freely in cyberspace.",
                learnset:{ 1:['tackle','sharpen','conversion'], 30:['psybeam'], 35:['recover'], 40:['agility'], 45:['tri attack'] },
                moves:["tackle","sharpen","conversion","psybeam"] },

  // ── #138-139 Omanyte line ────────────────────────────────────────────────
  omanyte:    { id:138,name:"OMANYTE",    type:["rock","water"],   hp:35, atk:40, def:100,spd:35, spc:90,  baseExp:120, growthRate:'medium_fast', catchRate:45,
                height:"0.4 m", weight:"7.5 kg", dexEntry:"Although an ancient POKéMON, it is possible to restore it from a fossil. It swam with its 10 tentacles.",
                evolvesTo:{ species:'omastar', level:40 },
                learnset:{ 1:['water gun','withdraw'], 31:['horn attack'], 36:['leer'], 41:['spike cannon'], 46:['hydro pump'] },
                moves:["water gun","withdraw","horn attack","leer"] },

  omastar:    { id:139,name:"OMASTAR",    type:["rock","water"],   hp:70, atk:60, def:125,spd:55, spc:115, baseExp:199, growthRate:'medium_fast', catchRate:45,
                height:"1.0 m", weight:"35.0 kg", dexEntry:"A prehistoric POKéMON that died out when its heavy shell made it too slow to catch food.",
                learnset:{ 1:['water gun','withdraw','horn attack','leer'], 46:['spike cannon'], 53:['hydro pump'] },
                moves:["water gun","horn attack","spike cannon","hydro pump"] },

  // ── #140-141 Kabuto line ─────────────────────────────────────────────────
  kabuto:     { id:140,name:"KABUTO",     type:["rock","water"],   hp:30, atk:80, def:90, spd:55, spc:45,  baseExp:119, growthRate:'medium_fast', catchRate:45,
                height:"0.5 m", weight:"11.5 kg", dexEntry:"A POKéMON that was resurrected from a fossil found in what was once the ocean floor eons ago.",
                evolvesTo:{ species:'kabutops', level:40 },
                learnset:{ 1:['scratch','harden'], 34:['absorb'], 39:['slash'], 44:['leer'], 49:['hydro pump'] },
                moves:["scratch","harden","absorb","slash"] },

  kabutops:   { id:141,name:"KABUTOPS",   type:["rock","water"],   hp:60, atk:115,def:105,spd:80, spc:70,  baseExp:201, growthRate:'medium_fast', catchRate:45,
                height:"1.3 m", weight:"40.5 kg", dexEntry:"Its sleek shape is perfect for swimming. It slashes prey with its sharp sickles and drinks the body fluids.",
                learnset:{ 1:['scratch','harden','absorb','slash'], 44:['leer'], 49:['hydro pump'] },
                moves:["scratch","slash","leer","hydro pump"] },

  // ── #142 Aerodactyl ──────────────────────────────────────────────────────
  aerodactyl: { id:142,name:"AERODACTYL", type:["rock","flying"],  hp:80, atk:105,def:65, spd:130,spc:60,  baseExp:202, growthRate:'slow', catchRate:45,
                height:"1.8 m", weight:"59.0 kg", dexEntry:"A ferocious, prehistoric POKéMON that goes for the enemy's throat with its serrated saw-like fangs.",
                learnset:{ 1:['wing attack','agility'], 33:['supersonic'], 38:['bite'], 45:['take down'], 54:['hyper beam'] },
                moves:["wing attack","agility","supersonic","bite"] },

  // ── #143 Snorlax ─────────────────────────────────────────────────────────
  snorlax:    { id:143,name:"SNORLAX",    type:["normal"],         hp:160,atk:110,def:65, spd:30, spc:65,  baseExp:154, growthRate:'slow', catchRate:25,
                height:"2.1 m", weight:"460.0 kg", dexEntry:"Very lazy. Just eats and sleeps. As its rotund bulk builds, it becomes steadily more slothful.",
                learnset:{ 1:['headbutt'], 35:['amnesia'], 41:['rest'], 48:['body slam'], 56:['harden'] },
                moves:["headbutt","amnesia","rest","body slam"] },

  // ── #144-146 Legendary Birds ─────────────────────────────────────────────
  articuno:   { id:144,name:"ARTICUNO",   type:["ice","flying"],   hp:90, atk:85, def:100,spd:85, spc:125, baseExp:215, growthRate:'slow', catchRate:3,
                height:"1.7 m", weight:"55.4 kg", dexEntry:"A legendary bird POKéMON that can control ice. The flapping of its wings chills the air. As a result, it is said that when this POKéMON flies, snow will fall.",
                learnset:{ 1:['peck','ice beam'], 51:['blizzard'], 55:['agility'], 60:['mist'] },
                moves:["peck","ice beam","blizzard","agility"] },

  zapdos:     { id:145,name:"ZAPDOS",     type:["electric","flying"],hp:90,atk:90,def:85, spd:100,spc:125, baseExp:216, growthRate:'slow', catchRate:3,
                height:"1.6 m", weight:"52.6 kg", dexEntry:"A legendary bird POKéMON that is said to appear from clouds while dropping lightning bolts.",
                learnset:{ 1:['peck','thunder shock'], 51:['thunderbolt'], 55:['agility'], 60:['thunder'] },
                moves:["peck","thunder shock","thunderbolt","thunder"] },

  moltres:    { id:146,name:"MOLTRES",    type:["fire","flying"],  hp:90, atk:100,def:90, spd:90, spc:125, baseExp:217, growthRate:'slow', catchRate:3,
                height:"2.0 m", weight:"60.0 kg", dexEntry:"Known as the legendary bird of fire. Every flap of its wings creates a dazzling flash of flames.",
                learnset:{ 1:['peck','ember'], 51:['fire spin'], 55:['agility'], 60:['fire blast'] },
                moves:["peck","ember","fire spin","fire blast"] },

  // ── #147-149 Dratini line ────────────────────────────────────────────────
  dratini:    { id:147,name:"DRATINI",    type:["dragon"],         hp:41, atk:64, def:45, spd:50, spc:50,  baseExp:67,  growthRate:'slow', catchRate:45,
                height:"1.8 m", weight:"3.3 kg", dexEntry:"Long considered a mythical POKéMON until recently when a small colony was found living underwater.",
                evolvesTo:{ species:'dragonair', level:30 },
                learnset:{ 1:['wrap','leer'], 10:['thunder wave'], 20:['agility'], 35:['slam'], 45:['dragon rage'], 55:['hyper beam'] },
                moves:["wrap","leer","thunder wave","agility"] },

  dragonair:  { id:148,name:"DRAGONAIR",  type:["dragon"],         hp:61, atk:84, def:65, spd:70, spc:70,  baseExp:144, growthRate:'slow', catchRate:45,
                height:"4.0 m", weight:"16.5 kg", dexEntry:"A mystical POKéMON that exudes a gentle aura. Has the ability to change climate conditions.",
                evolvesTo:{ species:'dragonite', level:55 },
                learnset:{ 1:['wrap','leer','thunder wave','agility'], 35:['slam'], 45:['dragon rage'], 55:['hyper beam'] },
                moves:["wrap","thunder wave","agility","slam"] },

  dragonite:  { id:149,name:"DRAGONITE",  type:["dragon","flying"],hp:91, atk:134,def:95, spd:80, spc:100, baseExp:218, growthRate:'slow', catchRate:45,
                height:"2.2 m", weight:"210.0 kg", dexEntry:"An extremely rarely seen marine POKéMON. Its intelligence is said to match that of humans.",
                learnset:{ 1:['wrap','leer','thunder wave','agility'] },
                moves:["wrap","agility","slam","hyper beam"] },

  // ── #150-151 Mewtwo and Mew ──────────────────────────────────────────────
  mewtwo:     { id:150,name:"MEWTWO",     type:["psychic"],        hp:106,atk:110,def:90, spd:130,spc:154, baseExp:220, growthRate:'slow', catchRate:3,
                height:"2.0 m", weight:"122.0 kg", dexEntry:"It was created by a scientist after years of horrific gene splicing and DNA engineering experiments.",
                learnset:{ 1:['confusion'], 63:['disable'], 66:['swift'], 73:['psychic'], 79:['amnesia'], 85:['recover'], 90:['psywave'] },
                moves:["confusion","swift","psychic","amnesia"] },

  mew:        { id:151,name:"MEW",        type:["psychic"],        hp:100,atk:100,def:100,spd:100,spc:100, baseExp:64,  growthRate:'medium_slow', catchRate:45,
                height:"0.4 m", weight:"4.0 kg", dexEntry:"So rare that it is still said to be a mirage by many experts. Only a few people have seen it worldwide.",
                learnset:{ 1:['pound'], 10:['transform'], 20:['mega punch'], 30:['metronome'], 40:['psychic'] },
                moves:["pound","transform","metronome","psychic"] },
};

// ── Wild encounter tables ─────────────────────────────────────────────────────
// Rates: must sum to 100. Sourced from Bulbapedia Gen I data.
// Gen I uses 10-slot encounter tables; rates approximated from slot counts × 10%.
const ENCOUNTER_TABLES = {
  route_1: {
    // [B8] Source: Bulbapedia — Route 1 (Gen I Red): Pidgey 55%, Rattata 45%
    tall_grass: [
      { species:'pidgey',  levelMin:2, levelMax:5, rate:55 },
      { species:'rattata', levelMin:2, levelMax:5, rate:45 },
    ],
  },
  viridian_forest: {
    // [B8] Source: Bulbapedia — Viridian Forest (Gen I Red): Caterpie-heavy, no Pikachu in Red
    tall_grass: [
      { species:'caterpie',  levelMin:3, levelMax:5, rate:45 },
      { species:'metapod',   levelMin:4, levelMax:7, rate:20 },
      { species:'weedle',    levelMin:3, levelMax:5, rate:25 },
      { species:'kakuna',    levelMin:4, levelMax:7, rate:10 },
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
  route_22: {
    // Source: Bulbapedia — Route 22 (Gen I Red/Blue)
    tall_grass: [
      { species:'nidoran_m', levelMin:3, levelMax:7, rate:45 },
      { species:'nidoran_f', levelMin:3, levelMax:7, rate:45 },
      { species:'mankey',    levelMin:3, levelMax:6, rate:10 },
    ],
  },
  route_23: {
    // Source: Bulbapedia — Route 23 (Gen I Red/Blue) — post-League approach
    tall_grass: [
      { species:'rattata', levelMin:15, levelMax:20, rate:50 },
      { species:'spearow', levelMin:13, levelMax:18, rate:50 },
    ],
  },
  route_2: {
    // Route 2 south section (between Viridian City and Viridian Forest gate) — Red version
    tall_grass: [
      { species:'pidgey',   levelMin:3, levelMax:5, rate:45 },
      { species:'rattata',  levelMin:3, levelMax:4, rate:30 },
      { species:'caterpie', levelMin:3, levelMax:4, rate:13 },
      { species:'weedle',   levelMin:3, levelMax:4, rate:12 },
    ],
  },
  route_3: {
    // Source: Bulbapedia Route 3 (Red)
    tall_grass: [
      { species:'spearow',   levelMin:6, levelMax:8, rate:55 },
      { species:'jigglypuff',levelMin:3, levelMax:8, rate:20 },
      { species:'sandshrew', levelMin:6, levelMax:7, rate:15 }, // Blue only, Red has nidoran
      { species:'nidoran_f', levelMin:6, levelMax:8, rate:5  },
      { species:'nidoran_m', levelMin:6, levelMax:8, rate:5  },
    ],
    water: [
      { species:'magikarp', levelMin:5, levelMax:15, rate:100 },
    ],
  },
  route_4: {
    // Source: Bulbapedia Route 4 (Red)
    tall_grass: [
      { species:'spearow',   levelMin:13, levelMax:15, rate:35 },
      { species:'rattata',   levelMin:13, levelMax:15, rate:30 },
      { species:'ekans',     levelMin:13, levelMax:15, rate:20 },
      { species:'sandshrew', levelMin:13, levelMax:15, rate:15 },
    ],
    water: [
      { species:'magikarp', levelMin:5, levelMax:15, rate:100 },
    ],
  },
  mt_moon_1f: {
    // Source: Bulbapedia Mt. Moon 1F (Red)
    tall_grass: [
      { species:'zubat',   levelMin:6,  levelMax:8,  rate:51 },
      { species:'geodude', levelMin:8,  levelMax:10, rate:39 },
      { species:'paras',   levelMin:8,  levelMax:10, rate:10 },
    ],
  },
  mt_moon_b1f: {
    tall_grass: [
      { species:'zubat',    levelMin:8,  levelMax:12, rate:51 },
      { species:'geodude',  levelMin:8,  levelMax:12, rate:35 },
      { species:'paras',    levelMin:10, levelMax:13, rate:5  },
      { species:'clefairy', levelMin:8,  levelMax:12, rate:9  },
    ],
  },
  mt_moon_b2f: {
    tall_grass: [
      { species:'zubat',    levelMin:8,  levelMax:12, rate:51 },
      { species:'geodude',  levelMin:8,  levelMax:12, rate:35 },
      { species:'clefairy', levelMin:8,  levelMax:12, rate:9  },
      { species:'paras',    levelMin:10, levelMax:13, rate:5  },
    ],
  },
  route_24: {
    // Nugget Bridge
    tall_grass: [
      { species:'caterpie', levelMin:13, levelMax:17, rate:35 },
      { species:'metapod',  levelMin:13, levelMax:17, rate:30 },
      { species:'oddish',   levelMin:13, levelMax:17, rate:25 },
      { species:'abra',     levelMin:8,  levelMax:15, rate:10 },
    ],
    water: [
      { species:'goldeen',  levelMin:10, levelMax:30, rate:90 },
      { species:'poliwag',  levelMin:10, levelMax:25, rate:10 },
    ],
  },
  route_25: {
    tall_grass: [
      { species:'caterpie', levelMin:13, levelMax:17, rate:35 },
      { species:'metapod',  levelMin:13, levelMax:17, rate:30 },
      { species:'oddish',   levelMin:13, levelMax:17, rate:25 },
      { species:'abra',     levelMin:8,  levelMax:15, rate:10 },
    ],
    water: [
      { species:'goldeen',  levelMin:10, levelMax:30, rate:90 },
      { species:'poliwag',  levelMin:10, levelMax:25, rate:10 },
    ],
  },
  route_5: {
    tall_grass: [
      { species:'oddish',  levelMin:13, levelMax:15, rate:35 },
      { species:'meowth',  levelMin:10, levelMax:15, rate:35 },
      { species:'mankey',  levelMin:13, levelMax:15, rate:20 },
      { species:'pidgey',  levelMin:13, levelMax:15, rate:10 },
    ],
  },
  route_6: {
    tall_grass: [
      { species:'oddish',  levelMin:13, levelMax:15, rate:35 },
      { species:'meowth',  levelMin:10, levelMax:15, rate:35 },
      { species:'mankey',  levelMin:13, levelMax:15, rate:20 },
      { species:'pidgey',  levelMin:13, levelMax:15, rate:10 },
    ],
    water: [
      { species:'poliwag',  levelMin:15, levelMax:25, rate:90 },
      { species:'goldeen',  levelMin:15, levelMax:25, rate:10 },
    ],
  },
  route_7: {
    tall_grass: [
      { species:'vulpix',    levelMin:18, levelMax:22, rate:5  },
      { species:'growlithe', levelMin:18, levelMax:22, rate:20 },
      { species:'oddish',    levelMin:22, levelMax:24, rate:20 },
      { species:'pidgey',    levelMin:22, levelMax:24, rate:25 },
      { species:'meowth',    levelMin:18, levelMax:22, rate:20 },
      { species:'abra',      levelMin:15, levelMax:20, rate:10 },
    ],
  },
  route_8: {
    tall_grass: [
      { species:'growlithe', levelMin:20, levelMax:25, rate:25 },
      { species:'meowth',    levelMin:20, levelMax:25, rate:25 },
      { species:'pidgey',    levelMin:20, levelMax:25, rate:20 },
      { species:'abra',      levelMin:15, levelMax:22, rate:10 },
      { species:'drowzee',   levelMin:20, levelMax:23, rate:20 },
    ],
  },
  route_9: {
    tall_grass: [
      { species:'nidoran_f', levelMin:17, levelMax:20, rate:25 },
      { species:'nidoran_m', levelMin:17, levelMax:20, rate:25 },
      { species:'oddish',    levelMin:17, levelMax:20, rate:20 },
      { species:'rattata',   levelMin:17, levelMax:20, rate:15 },
      { species:'ekans',     levelMin:17, levelMax:20, rate:15 },
    ],
  },
  route_10: {
    tall_grass: [
      { species:'voltorb',   levelMin:20, levelMax:25, rate:35 },
      { species:'magnemite', levelMin:20, levelMax:25, rate:35 },
      { species:'rattata',   levelMin:20, levelMax:25, rate:20 },
      { species:'ekans',     levelMin:20, levelMax:25, rate:10 },
    ],
    water: [
      { species:'poliwag',   levelMin:20, levelMax:35, rate:90 },
      { species:'poliwhirl', levelMin:25, levelMax:35, rate:10 },
    ],
  },
  rock_tunnel_1f: {
    tall_grass: [
      { species:'zubat',   levelMin:16, levelMax:22, rate:35 },
      { species:'geodude', levelMin:16, levelMax:22, rate:35 },
      { species:'machop',  levelMin:16, levelMax:22, rate:20 },
      { species:'onix',    levelMin:15, levelMax:22, rate:10 },
    ],
  },
  rock_tunnel_b1f: {
    tall_grass: [
      { species:'zubat',   levelMin:18, levelMax:24, rate:35 },
      { species:'geodude', levelMin:16, levelMax:22, rate:35 },
      { species:'machop',  levelMin:16, levelMax:22, rate:15 },
      { species:'onix',    levelMin:16, levelMax:23, rate:15 },
    ],
  },
  route_11: {
    tall_grass: [
      { species:'ekans',   levelMin:12, levelMax:15, rate:45 },
      { species:'spearow', levelMin:13, levelMax:17, rate:35 },
      { species:'drowzee', levelMin:11, levelMax:15, rate:20 },
    ],
  },
  route_12: {
    tall_grass: [
      { species:'snorlax', levelMin:30, levelMax:30, rate:5  }, // static encounter, usually
      { species:'ekans',   levelMin:20, levelMax:25, rate:35 },
      { species:'oddish',  levelMin:20, levelMax:25, rate:35 },
      { species:'pidgey',  levelMin:20, levelMax:25, rate:25 },
    ],
    water: [
      { species:'tentacool',  levelMin:15, levelMax:35, rate:95 },
      { species:'tentacruel', levelMin:30, levelMax:40, rate:5  },
    ],
  },
  route_13: {
    tall_grass: [
      { species:'ekans',   levelMin:20, levelMax:25, rate:30 },
      { species:'oddish',  levelMin:20, levelMax:25, rate:30 },
      { species:'ditto',   levelMin:20, levelMax:25, rate:20 },
      { species:'venonat', levelMin:20, levelMax:25, rate:20 },
    ],
    water: [
      { species:'tentacool',  levelMin:15, levelMax:35, rate:95 },
      { species:'tentacruel', levelMin:30, levelMax:40, rate:5  },
    ],
  },
  route_14: {
    tall_grass: [
      { species:'ekans',   levelMin:22, levelMax:27, rate:30 },
      { species:'oddish',  levelMin:22, levelMax:27, rate:30 },
      { species:'ditto',   levelMin:22, levelMax:27, rate:20 },
      { species:'venonat', levelMin:22, levelMax:27, rate:20 },
    ],
  },
  route_15: {
    tall_grass: [
      { species:'ekans',   levelMin:22, levelMax:27, rate:30 },
      { species:'oddish',  levelMin:22, levelMax:27, rate:30 },
      { species:'ditto',   levelMin:22, levelMax:27, rate:20 },
      { species:'venonat', levelMin:22, levelMax:27, rate:20 },
    ],
  },
  route_16: {
    tall_grass: [
      { species:'spearow', levelMin:20, levelMax:25, rate:45 },
      { species:'rattata', levelMin:20, levelMax:25, rate:35 },
      { species:'fearow',  levelMin:22, levelMax:26, rate:20 },
    ],
  },
  route_17: {
    // Cycling Road
    tall_grass: [
      { species:'spearow', levelMin:20, levelMax:25, rate:40 },
      { species:'rattata', levelMin:20, levelMax:25, rate:35 },
      { species:'fearow',  levelMin:22, levelMax:26, rate:25 },
    ],
  },
  route_18: {
    tall_grass: [
      { species:'spearow', levelMin:20, levelMax:25, rate:45 },
      { species:'rattata', levelMin:20, levelMax:25, rate:35 },
      { species:'fearow',  levelMin:22, levelMax:26, rate:20 },
    ],
  },
  route_19: {
    water: [
      { species:'tentacool',  levelMin:15, levelMax:40, rate:95 },
      { species:'tentacruel', levelMin:30, levelMax:40, rate:5  },
    ],
  },
  route_20: {
    water: [
      { species:'tentacool',  levelMin:15, levelMax:40, rate:95 },
      { species:'tentacruel', levelMin:30, levelMax:40, rate:5  },
    ],
  },
  route_21: {
    tall_grass: [
      { species:'pidgey',    levelMin:30, levelMax:35, rate:35 },
      { species:'rattata',   levelMin:30, levelMax:35, rate:25 },
      { species:'tangela',   levelMin:28, levelMax:35, rate:25 },
      { species:'pidgeotto', levelMin:30, levelMax:35, rate:15 },
    ],
    water: [
      { species:'tentacool',  levelMin:15, levelMax:40, rate:95 },
      { species:'tentacruel', levelMin:30, levelMax:40, rate:5  },
    ],
  },
  seafoam_islands_1f: {
    tall_grass: [
      { species:'zubat',   levelMin:28, levelMax:35, rate:35 },
      { species:'krabby',  levelMin:28, levelMax:35, rate:25 },
      { species:'psyduck', levelMin:28, levelMax:35, rate:20 },
      { species:'seel',    levelMin:28, levelMax:35, rate:20 },
    ],
    water: [
      { species:'seel',      levelMin:30, levelMax:40, rate:50 },
      { species:'dewgong',   levelMin:35, levelMax:45, rate:20 },
      { species:'tentacool', levelMin:25, levelMax:35, rate:30 },
    ],
  },
  seafoam_islands_b1f: {
    tall_grass: [
      { species:'zubat',     levelMin:28, levelMax:35, rate:40 },
      { species:'psyduck',   levelMin:28, levelMax:35, rate:20 },
      { species:'slowpoke',  levelMin:28, levelMax:35, rate:20 },
      { species:'seel',      levelMin:28, levelMax:35, rate:20 },
    ],
    water: [
      { species:'articuno', levelMin:50, levelMax:50, rate:100 }, // static in real game, but stub here
    ],
  },
  pokemon_mansion_1f: {
    tall_grass: [
      { species:'ponyta',  levelMin:30, levelMax:35, rate:40 },
      { species:'grimer',  levelMin:30, levelMax:35, rate:30 },
      { species:'koffing', levelMin:30, levelMax:35, rate:30 },
    ],
  },
  pokemon_mansion_2f: {
    tall_grass: [
      { species:'ponyta',  levelMin:32, levelMax:36, rate:35 },
      { species:'grimer',  levelMin:32, levelMax:36, rate:30 },
      { species:'koffing', levelMin:32, levelMax:36, rate:25 },
      { species:'muk',     levelMin:32, levelMax:36, rate:10 },
    ],
  },
  power_plant: {
    tall_grass: [
      { species:'voltorb',    levelMin:24, levelMax:35, rate:40 },
      { species:'magnemite',  levelMin:24, levelMax:35, rate:25 },
      { species:'magneton',   levelMin:24, levelMax:35, rate:10 },
      { species:'electabuzz', levelMin:33, levelMax:40, rate:20 },
      { species:'pikachu',    levelMin:22, levelMax:28, rate:5  },
    ],
  },
  victory_road_1f: {
    tall_grass: [
      { species:'geodude', levelMin:36, levelMax:40, rate:35 },
      { species:'onix',    levelMin:34, levelMax:40, rate:25 },
      { species:'zubat',   levelMin:36, levelMax:40, rate:30 },
      { species:'machoke', levelMin:34, levelMax:40, rate:10 },
    ],
  },
  victory_road_2f: {
    tall_grass: [
      { species:'geodude',  levelMin:36, levelMax:40, rate:30 },
      { species:'graveler', levelMin:36, levelMax:40, rate:20 },
      { species:'zubat',    levelMin:36, levelMax:40, rate:25 },
      { species:'machoke',  levelMin:34, levelMax:40, rate:15 },
      { species:'venomoth', levelMin:36, levelMax:40, rate:10 },
    ],
  },
  cerulean_cave_1f: {
    tall_grass: [
      { species:'golbat',    levelMin:46, levelMax:55, rate:30 },
      { species:'parasect',  levelMin:46, levelMax:55, rate:20 },
      { species:'kadabra',   levelMin:46, levelMax:55, rate:15 },
      { species:'ditto',     levelMin:46, levelMax:55, rate:15 },
      { species:'rhydon',    levelMin:46, levelMax:55, rate:10 },
      { species:'electrode', levelMin:46, levelMax:55, rate:10 },
    ],
    water: [
      { species:'golduck',  levelMin:46, levelMax:55, rate:50 },
      { species:'slowbro',  levelMin:46, levelMax:55, rate:30 },
      { species:'psyduck',  levelMin:46, levelMax:55, rate:20 },
    ],
  },
  cerulean_cave_b1f: {
    tall_grass: [
      { species:'mewtwo', levelMin:70, levelMax:70, rate:100 }, // static in real game
    ],
  },
  safari_zone_center: {
    tall_grass: [
      { species:'nidoran_f',  levelMin:22, levelMax:28, rate:20 },
      { species:'nidoran_m',  levelMin:22, levelMax:28, rate:20 },
      { species:'parasect',   levelMin:30, levelMax:36, rate:15 },
      { species:'venonat',    levelMin:22, levelMax:28, rate:15 },
      { species:'scyther',    levelMin:23, levelMax:25, rate:5  }, // Red
      { species:'pinsir',     levelMin:23, levelMax:25, rate:5  }, // Blue
      { species:'kangaskhan', levelMin:28, levelMax:32, rate:15 },
      { species:'rhyhorn',    levelMin:20, levelMax:25, rate:5  },
    ],
  },
  safari_zone_east: {
    tall_grass: [
      { species:'nidoran_f', levelMin:22, levelMax:28, rate:20 },
      { species:'nidoran_m', levelMin:22, levelMax:28, rate:20 },
      { species:'exeggcute', levelMin:25, levelMax:30, rate:20 },
      { species:'venomoth',  levelMin:30, levelMax:36, rate:15 },
      { species:'paras',     levelMin:28, levelMax:35, rate:15 },
      { species:'chansey',   levelMin:28, levelMax:32, rate:4  },
      { species:'tauros',    levelMin:28, levelMax:32, rate:6  },
    ],
  },
  safari_zone_north: {
    tall_grass: [
      { species:'nidorina',  levelMin:28, levelMax:33, rate:20 },
      { species:'nidorino',  levelMin:28, levelMax:33, rate:20 },
      { species:'exeggcute', levelMin:28, levelMax:33, rate:15 },
      { species:'rhyhorn',   levelMin:25, levelMax:30, rate:15 },
      { species:'chansey',   levelMin:28, levelMax:32, rate:4  },
      { species:'tauros',    levelMin:28, levelMax:32, rate:11 },
      { species:'scyther',   levelMin:23, levelMax:25, rate:5  },
      { species:'dratini',   levelMin:15, levelMax:15, rate:5  },
    ],
    water: [
      { species:'goldeen',  levelMin:15, levelMax:30, rate:90 },
      { species:'seaking',  levelMin:25, levelMax:40, rate:10 },
    ],
  },
  safari_zone_west: {
    tall_grass: [
      { species:'nidoran_f', levelMin:22, levelMax:28, rate:20 },
      { species:'nidoran_m', levelMin:22, levelMax:28, rate:20 },
      { species:'psyduck',   levelMin:22, levelMax:28, rate:20 },
      { species:'slowpoke',  levelMin:25, levelMax:30, rate:20 },
      { species:'chansey',   levelMin:28, levelMax:32, rate:4  },
      { species:'tauros',    levelMin:28, levelMax:32, rate:11 },
      { species:'pinsir',    levelMin:22, levelMax:28, rate:5  },
    ],
    water: [
      { species:'psyduck',   levelMin:20, levelMax:35, rate:90 },
      { species:'slowpoke',  levelMin:20, levelMax:35, rate:10 },
    ],
  },
};

// #B9: rollFn(n) mirrors the engine's roll(n) — returns 1..n — for seeded RNG support.
// Callers in engine.js pass the seeded roll() function; defaults to Math.random() fallback.
function rollEncounter(areaId, terrain, rollFn) {
  const table = ENCOUNTER_TABLES[areaId]?.[terrain];
  if (!table) return null;
  const rng = rollFn || ((n) => Math.floor(Math.random() * n) + 1);
  const pct = rng(100);  // 1..100
  let cumulative = 0;
  for (const entry of table) {
    cumulative += entry.rate;
    if (pct <= cumulative) {
      const range = entry.levelMax - entry.levelMin;
      const level = entry.levelMin + (range > 0 ? rng(range + 1) - 1 : 0);
      return { species: entry.species, level };
    }
  }
  return null;
}

module.exports = { POKEMON, ENCOUNTER_TABLES, rollEncounter };
