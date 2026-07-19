'use strict';
// Gen 1 Pokémon — base stats and learnsets sourced from Bulbapedia
// Base stat formula used: maxHp = floor(base.hp * 2 * level / 100) + level + 10
//                         stat  = floor(base.stat * 2 * level / 100) + 5
// Moves listed are what the Pokémon knows at the level it would first be encountered
const POKEMON = {
  // ── #1-3 Bulbasaur line ───────────────────────────────────────────────────
  bulbasaur:  { id:1,  name:"BULBASAUR",  type:["grass","poison"], hp:45, atk:49, def:49, spd:45, spc:65,  baseExp:64,  growthRate:'medium_slow', catchRate:45,
                evolvesTo:{ species:'ivysaur', level:16 },
                learnset:{ 1:['tackle','growl'], 7:['leech seed'], 13:['vine whip'], 22:['poison powder'], 29:['razor leaf'], 38:['growth'], 46:['solar beam'], 53:['sleep powder'], 62:['swords dance'] },
                moves:["tackle","growl","leech seed","vine whip"] },

  ivysaur:    { id:2,  name:"IVYSAUR",    type:["grass","poison"], hp:60, atk:62, def:63, spd:60, spc:80,  baseExp:141, growthRate:'medium_slow', catchRate:45,
                evolvesTo:{ species:'venusaur', level:32 },
                learnset:{ 1:['tackle','growl'], 7:['leech seed'], 13:['vine whip'], 22:['poison powder'], 30:['razor leaf'], 44:['growth'], 55:['sleep powder'], 65:['solar beam'] },
                moves:["tackle","growl","leech seed","vine whip"] },

  venusaur:   { id:3,  name:"VENUSAUR",   type:["grass","poison"], hp:80, atk:82, def:83, spd:80, spc:100, baseExp:208, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['tackle','growl'], 7:['leech seed'], 13:['vine whip'], 22:['poison powder'], 30:['razor leaf'], 44:['growth'], 55:['sleep powder'], 65:['solar beam'] },
                moves:["tackle","growl","razor leaf","leech seed"] },

  // ── #4-6 Charmander line ─────────────────────────────────────────────────
  charmander: { id:4,  name:"CHARMANDER", type:["fire"],           hp:39, atk:52, def:43, spd:65, spc:50,  baseExp:65,  growthRate:'medium_slow', catchRate:45,
                evolvesTo:{ species:'charmeleon', level:16 },
                learnset:{ 1:['scratch','growl'], 9:['ember'], 15:['leer'], 22:['rage'], 30:['slash'], 38:['flamethrower'], 46:['fire spin'] },
                moves:["scratch","growl","ember","smokescreen"] },

  charmeleon: { id:5,  name:"CHARMELEON", type:["fire"],           hp:58, atk:64, def:58, spd:80, spc:65,  baseExp:142, growthRate:'medium_slow', catchRate:45,
                evolvesTo:{ species:'charizard', level:36 },
                learnset:{ 1:['scratch','growl'], 9:['ember'], 15:['leer'], 22:['rage'], 30:['slash'], 38:['flamethrower'], 46:['fire spin'] },
                moves:["scratch","growl","ember","smokescreen"] },

  charizard:  { id:6,  name:"CHARIZARD",  type:["fire","flying"],  hp:78, atk:84, def:78, spd:100,spc:85,  baseExp:209, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['scratch','growl'], 9:['ember'], 15:['leer'], 22:['rage'], 30:['slash'], 38:['flamethrower'], 46:['fire spin'] },
                moves:["scratch","growl","ember","flamethrower"] },

  // ── #7-9 Squirtle line ───────────────────────────────────────────────────
  squirtle:   { id:7,  name:"SQUIRTLE",   type:["water"],          hp:44, atk:48, def:65, spd:43, spc:50,  baseExp:66,  growthRate:'medium_slow', catchRate:45,
                evolvesTo:{ species:'wartortle', level:16 },
                learnset:{ 1:['tackle','tail whip'], 8:['bubble'], 15:['water gun'], 22:['bite'], 28:['withdraw'], 35:['skull bash'], 42:['hydro pump'] },
                moves:["tackle","tail whip","water gun","withdraw"] },

  wartortle:  { id:8,  name:"WARTORTLE",  type:["water"],          hp:59, atk:63, def:80, spd:58, spc:65,  baseExp:143, growthRate:'medium_slow', catchRate:45,
                evolvesTo:{ species:'blastoise', level:36 },
                learnset:{ 1:['tackle','tail whip'], 8:['bubble'], 15:['water gun'], 22:['bite'], 28:['withdraw'], 35:['skull bash'], 42:['hydro pump'] },
                moves:["tackle","tail whip","water gun","withdraw"] },

  blastoise:  { id:9,  name:"BLASTOISE",  type:["water"],          hp:79, atk:83, def:100,spd:78, spc:85,  baseExp:210, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['tackle','tail whip'], 8:['bubble'], 15:['water gun'], 22:['bite'], 28:['withdraw'], 35:['skull bash'], 42:['hydro pump'] },
                moves:["tackle","tail whip","water gun","surf"] },

  // ── #10-12 Caterpie line ─────────────────────────────────────────────────
  caterpie:   { id:10, name:"CATERPIE",   type:["bug"],            hp:45, atk:30, def:35, spd:45, spc:20,  baseExp:53,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'metapod', level:7 },
                learnset:{ 1:['tackle','string shot'] },
                moves:["tackle","string shot"] },

  metapod:    { id:11, name:"METAPOD",    type:["bug"],            hp:50, atk:20, def:55, spd:30, spc:25,  baseExp:72,  growthRate:'medium_fast', catchRate:120,
                evolvesTo:{ species:'butterfree', level:10 },
                learnset:{ 1:['harden'] },
                moves:["harden"] },

  butterfree: { id:12, name:"BUTTERFREE", type:["bug","flying"],   hp:60, atk:45, def:50, spd:70, spc:80,  baseExp:160, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['confusion'], 12:['poison powder'], 15:['stun spore'], 16:['sleep powder'], 21:['supersonic'], 26:['whirlwind'], 30:['psybeam'], 35:['gust'] },
                moves:["confusion","sleep powder","stun spore","gust"] },

  // ── #13-15 Weedle line ───────────────────────────────────────────────────
  weedle:     { id:13, name:"WEEDLE",     type:["bug","poison"],   hp:35, atk:35, def:30, spd:50, spc:20,  baseExp:52,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'kakuna', level:7 },
                learnset:{ 1:['poison sting','string shot'] },
                moves:["poison sting","string shot"] },

  kakuna:     { id:14, name:"KAKUNA",     type:["bug","poison"],   hp:45, atk:25, def:50, spd:35, spc:25,  baseExp:72,  growthRate:'medium_fast', catchRate:120,
                evolvesTo:{ species:'beedrill', level:10 },
                learnset:{ 1:['harden'] },
                moves:["harden"] },

  beedrill:   { id:15, name:"BEEDRILL",   type:["bug","poison"],   hp:65, atk:80, def:40, spd:75, spc:45,  baseExp:159, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['fury attack','poison sting'], 20:['twineedle'], 35:['agility'] },
                moves:["twineedle","fury attack","poison sting","string shot"] },

  // ── #16-18 Pidgey line ───────────────────────────────────────────────────
  pidgey:     { id:16, name:"PIDGEY",     type:["normal","flying"],hp:40, atk:45, def:40, spd:56, spc:35,  baseExp:55,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'pidgeotto', level:18 },
                learnset:{ 1:['tackle','sand attack'], 5:['gust'], 12:['quick attack'], 19:['whirlwind'], 28:['wing attack'], 36:['agility'], 44:['mirror move'] },
                moves:["tackle","sand attack","gust","quick attack"] },

  pidgeotto:  { id:17, name:"PIDGEOTTO",  type:["normal","flying"],hp:63, atk:60, def:55, spd:71, spc:50,  baseExp:113, growthRate:'medium_fast', catchRate:120,
                evolvesTo:{ species:'pidgeot', level:36 },
                learnset:{ 1:['tackle','sand attack'], 5:['gust'], 12:['quick attack'], 19:['whirlwind'], 28:['wing attack'], 36:['agility'], 44:['mirror move'] },
                moves:["gust","sand attack","quick attack","whirlwind"] },

  pidgeot:    { id:18, name:"PIDGEOT",    type:["normal","flying"],hp:83, atk:80, def:75, spd:101,spc:70,  baseExp:172, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['tackle','sand attack'], 5:['gust'], 12:['quick attack'], 19:['whirlwind'], 28:['wing attack'], 36:['agility'], 44:['mirror move'] },
                moves:["wing attack","agility","quick attack","mirror move"] },

  // ── #19-20 Rattata line ──────────────────────────────────────────────────
  rattata:    { id:19, name:"RATTATA",    type:["normal"],         hp:30, atk:56, def:35, spd:72, spc:25,  baseExp:57,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'raticate', level:20 },
                learnset:{ 1:['tackle','tail whip'], 7:['quick attack'], 14:['hyper fang'], 23:['focus energy'], 34:['super fang'] },
                moves:["tackle","tail whip","quick attack","hyper fang"] },

  raticate:   { id:20, name:"RATICATE",   type:["normal"],         hp:55, atk:81, def:60, spd:97, spc:50,  baseExp:116, growthRate:'medium_fast', catchRate:127,
                learnset:{ 1:['tackle','tail whip'], 7:['quick attack'], 14:['hyper fang'], 23:['focus energy'], 34:['super fang'] },
                moves:["tackle","tail whip","quick attack","hyper fang"] },

  // ── #21-22 Spearow line ──────────────────────────────────────────────────
  spearow:    { id:21, name:"SPEAROW",    type:["normal","flying"],hp:40, atk:60, def:30, spd:70, spc:31,  baseExp:58,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'fearow', level:20 },
                learnset:{ 1:['peck','growl'], 9:['leer'], 15:['fury attack'], 22:['mirror move'], 29:['agility'], 36:['drill peck'] },
                moves:["peck","growl","leer","fury attack"] },

  fearow:     { id:22, name:"FEAROW",     type:["normal","flying"],hp:65, atk:90, def:65, spd:100,spc:61,  baseExp:162, growthRate:'medium_fast', catchRate:90,
                learnset:{ 1:['peck','growl','leer','fury attack'], 29:['agility'], 36:['drill peck'] },
                moves:["peck","fury attack","agility","drill peck"] },

  // ── #23-24 Ekans line ────────────────────────────────────────────────────
  ekans:      { id:23, name:"EKANS",      type:["poison"],         hp:35, atk:60, def:44, spd:55, spc:40,  baseExp:62,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'arbok', level:22 },
                learnset:{ 1:['wrap','leer'], 9:['poison sting'], 15:['bite'], 22:['glare'], 30:['screech'], 38:['acid'] },
                moves:["wrap","leer","poison sting","bite"] },

  arbok:      { id:24, name:"ARBOK",      type:["poison"],         hp:60, atk:85, def:69, spd:80, spc:65,  baseExp:141, growthRate:'medium_fast', catchRate:90,
                learnset:{ 1:['wrap','leer','poison sting','bite'], 22:['glare'], 30:['screech'], 38:['acid'] },
                moves:["wrap","leer","poison sting","glare"] },

  // ── #25-26 Pikachu line ──────────────────────────────────────────────────
  pikachu:    { id:25, name:"PIKACHU",    type:["electric"],       hp:35, atk:55, def:30, spd:90, spc:50,  baseExp:82,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'raichu', stone:'thunder_stone' },
                learnset:{ 1:['thunder shock','growl'], 9:['tail whip'], 16:['quick attack'], 26:['thunder wave'], 33:['slam'], 41:['thunderbolt'], 50:['agility'], 58:['thunder'] },
                moves:["thunder shock","growl","quick attack","thunder wave"] },

  raichu:     { id:26, name:"RAICHU",     type:["electric"],       hp:60, atk:90, def:55, spd:110,spc:90,  baseExp:122, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['thunder shock','growl','tail whip','quick attack'] },
                moves:["thunder shock","thunderbolt","quick attack","thunder wave"] },

  // ── #27-28 Sandshrew line ────────────────────────────────────────────────
  sandshrew:  { id:27, name:"SANDSHREW",  type:["ground"],         hp:50, atk:75, def:85, spd:40, spc:30,  baseExp:93,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'sandslash', level:22 },
                learnset:{ 1:['scratch'], 10:['sand attack'], 17:['slash'], 24:['poison sting'], 31:['swift'], 38:['fury swipes'] },
                moves:["scratch","sand attack","slash","defense curl"] },

  sandslash:  { id:28, name:"SANDSLASH",  type:["ground"],         hp:75, atk:100,def:110,spd:65, spc:55,  baseExp:163, growthRate:'medium_fast', catchRate:90,
                learnset:{ 1:['scratch','sand attack'], 10:['slash'], 24:['poison sting'], 31:['swift'], 38:['fury swipes'] },
                moves:["scratch","sand attack","slash","fury attack"] },

  // ── #29-31 Nidoran♀ line ─────────────────────────────────────────────────
  nidoran_f:  { id:29, name:"NIDORAN♀", type:["poison"],      hp:55, atk:47, def:52, spd:41, spc:40,  baseExp:59,  growthRate:'medium_slow', catchRate:235,
                evolvesTo:{ species:'nidorina', level:16 },
                learnset:{ 1:['growl','tackle'], 8:['scratch'], 14:['poison sting'], 23:['tail whip'], 32:['bite'], 38:['fury swipes'], 46:['double kick'] },
                moves:["growl","tackle","scratch","poison sting"] },

  nidorina:   { id:30, name:"NIDORINA",   type:["poison"],         hp:70, atk:62, def:67, spd:56, spc:55,  baseExp:117, growthRate:'medium_slow', catchRate:120,
                evolvesTo:{ species:'nidoqueen', stone:'moon_stone' },
                learnset:{ 1:['growl','tackle','scratch','poison sting'], 23:['tail whip'], 32:['bite'], 38:['fury swipes'], 46:['double kick'] },
                moves:["growl","tackle","poison sting","tail whip"] },

  nidoqueen:  { id:31, name:"NIDOQUEEN",  type:["poison","ground"],hp:90, atk:82, def:87, spd:76, spc:75,  baseExp:194, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['tackle','scratch','tail whip','poison sting'], 23:['body slam'], 35:['double kick'] },
                moves:["tackle","body slam","double kick","poison sting"] },

  // ── #32-34 Nidoran♂ line ─────────────────────────────────────────────────
  nidoran_m:  { id:32, name:"NIDORAN♂", type:["poison"],      hp:46, atk:57, def:40, spd:50, spc:40,  baseExp:60,  growthRate:'medium_slow', catchRate:235,
                evolvesTo:{ species:'nidorino', level:16 },
                learnset:{ 1:['leer','tackle'], 8:['horn attack'], 14:['poison sting'], 23:['focus energy'], 32:['horn drill'], 40:['double kick'], 50:['thrash'] },
                moves:["leer","tackle","horn attack","poison sting"] },

  nidorino:   { id:33, name:"NIDORINO",   type:["poison"],         hp:61, atk:72, def:57, spd:65, spc:55,  baseExp:118, growthRate:'medium_slow', catchRate:120,
                evolvesTo:{ species:'nidoking', stone:'moon_stone' },
                learnset:{ 1:['leer','tackle','horn attack','poison sting'], 23:['focus energy'], 32:['horn drill'], 40:['double kick'], 50:['thrash'] },
                moves:["leer","tackle","horn attack","focus energy"] },

  nidoking:   { id:34, name:"NIDOKING",   type:["poison","ground"],hp:81, atk:92, def:77, spd:85, spc:75,  baseExp:195, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['tackle','horn attack','poison sting','thrash'] },
                moves:["tackle","thrash","horn drill","double kick"] },

  // ── #35-36 Clefairy line ─────────────────────────────────────────────────
  clefairy:   { id:35, name:"CLEFAIRY",   type:["normal"],         hp:70, atk:45, def:48, spd:35, spc:60,  baseExp:68,  growthRate:'fast', catchRate:150,
                evolvesTo:{ species:'clefable', stone:'moon_stone' },
                learnset:{ 1:['pound','growl'], 13:['sing'], 18:['double slap'], 24:['minimize'], 31:['metronome'], 38:['defense curl'], 44:['light screen'], 48:['soft boiled'] },
                moves:["pound","growl","sing","double slap"] },

  clefable:   { id:36, name:"CLEFABLE",   type:["normal"],         hp:95, atk:70, def:73, spd:60, spc:85,  baseExp:129, growthRate:'fast', catchRate:25,
                learnset:{ 1:['sing','double slap','minimize','metronome'] },
                moves:["sing","minimize","metronome","double slap"] },

  // ── #37-38 Vulpix line ───────────────────────────────────────────────────
  vulpix:     { id:37, name:"VULPIX",     type:["fire"],           hp:38, atk:41, def:40, spd:65, spc:65,  baseExp:63,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'ninetales', stone:'fire_stone' },
                learnset:{ 1:['ember','tail whip'], 16:['quick attack'], 21:['roar'], 28:['confuse ray'], 35:['flamethrower'], 42:['fire spin'] },
                moves:["ember","tail whip","quick attack","roar"] },

  ninetales:  { id:38, name:"NINETALES",  type:["fire"],           hp:73, atk:76, def:75, spd:100,spc:100, baseExp:178, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['ember','quick attack','roar','confuse ray'] },
                moves:["ember","quick attack","confuse ray","flamethrower"] },

  // ── #39-40 Jigglypuff line ───────────────────────────────────────────────
  jigglypuff: { id:39, name:"JIGGLYPUFF", type:["normal"],         hp:115,atk:45, def:20, spd:20, spc:25,  baseExp:76,  growthRate:'fast', catchRate:170,
                evolvesTo:{ species:'wigglytuff', stone:'moon_stone' },
                learnset:{ 1:['sing','pound'], 9:['disable'], 14:['defense curl'], 19:['double slap'], 29:['rest'], 39:['body slam'], 44:['double edge'] },
                moves:["sing","pound","disable","defense curl"] },

  wigglytuff: { id:40, name:"WIGGLYTUFF", type:["normal"],         hp:140,atk:70, def:45, spd:45, spc:50,  baseExp:109, growthRate:'fast', catchRate:50,
                learnset:{ 1:['sing','disable','defense curl','double slap'] },
                moves:["sing","body slam","double edge","disable"] },

  // ── #41-42 Zubat line ────────────────────────────────────────────────────
  zubat:      { id:41, name:"ZUBAT",      type:["poison","flying"],hp:40, atk:45, def:35, spd:55, spc:40,  baseExp:54,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'golbat', level:22 },
                learnset:{ 1:['leech life','supersonic'], 15:['bite'], 21:['confuse ray'], 28:['wing attack'], 36:['haze'] },
                moves:["leech life","supersonic","bite","confuse ray"] },

  golbat:     { id:42, name:"GOLBAT",     type:["poison","flying"],hp:75, atk:80, def:70, spd:90, spc:75,  baseExp:171, growthRate:'medium_fast', catchRate:90,
                learnset:{ 1:['leech life','supersonic','bite','confuse ray'], 28:['wing attack'], 36:['haze'] },
                moves:["leech life","bite","confuse ray","wing attack"] },

  // ── #43-45 Oddish line ───────────────────────────────────────────────────
  oddish:     { id:43, name:"ODDISH",     type:["grass","poison"], hp:45, atk:50, def:55, spd:30, spc:75,  baseExp:78,  growthRate:'medium_slow', catchRate:255,
                evolvesTo:{ species:'gloom', level:21 },
                learnset:{ 1:['absorb'], 15:['poison powder'], 17:['stun spore'], 19:['sleep powder'], 24:['acid'], 33:['petal dance'], 39:['solar beam'] },
                moves:["absorb","poison powder","stun spore","sleep powder"] },

  gloom:      { id:44, name:"GLOOM",      type:["grass","poison"], hp:60, atk:65, def:70, spd:40, spc:85,  baseExp:132, growthRate:'medium_slow', catchRate:120,
                evolvesTo:{ species:'vileplume', stone:'leaf_stone' },
                learnset:{ 1:['absorb','poison powder','stun spore','sleep powder'], 28:['acid'], 38:['petal dance'], 52:['solar beam'] },
                moves:["absorb","acid","stun spore","sleep powder"] },

  vileplume:  { id:45, name:"VILEPLUME",  type:["grass","poison"], hp:75, atk:80, def:85, spd:50, spc:100, baseExp:184, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['absorb','sleep powder','acid','petal dance'] },
                moves:["absorb","sleep powder","petal dance","acid"] },

  // ── #46-47 Paras line ────────────────────────────────────────────────────
  paras:      { id:46, name:"PARAS",      type:["bug","grass"],    hp:35, atk:70, def:55, spd:25, spc:55,  baseExp:70,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'parasect', level:24 },
                learnset:{ 1:['scratch'], 13:['stun spore'], 20:['leech life'], 27:['spore'], 34:['slash'], 41:['growth'] },
                moves:["scratch","stun spore","leech life","spore"] },

  parasect:   { id:47, name:"PARASECT",   type:["bug","grass"],    hp:60, atk:95, def:80, spd:30, spc:80,  baseExp:128, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['scratch','stun spore','leech life','spore'], 34:['slash'], 41:['growth'] },
                moves:["scratch","spore","leech life","slash"] },

  // ── #48-49 Venonat line ──────────────────────────────────────────────────
  venonat:    { id:48, name:"VENONAT",    type:["bug","poison"],   hp:60, atk:55, def:50, spd:45, spc:40,  baseExp:75,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'venomoth', level:31 },
                learnset:{ 1:['tackle','disable'], 24:['poison powder'], 27:['leech life'], 30:['stun spore'], 35:['psybeam'], 38:['sleep powder'], 43:['psychic'] },
                moves:["tackle","disable","poison powder","leech life"] },

  venomoth:   { id:49, name:"VENOMOTH",   type:["bug","poison"],   hp:70, atk:65, def:60, spd:90, spc:90,  baseExp:138, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['tackle','disable','poison powder','leech life'], 38:['sleep powder'], 43:['psybeam'], 50:['psychic'] },
                moves:["tackle","psybeam","sleep powder","psychic"] },

  // ── #50-51 Diglett line ──────────────────────────────────────────────────
  diglett:    { id:50, name:"DIGLETT",    type:["ground"],         hp:10, atk:55, def:25, spd:95, spc:45,  baseExp:81,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'dugtrio', level:26 },
                learnset:{ 1:['scratch'], 15:['growl'], 19:['dig'], 24:['sand attack'], 31:['slash'], 40:['earthquake'], 48:['fissure'] },
                moves:["scratch","growl","dig","sand attack"] },

  dugtrio:    { id:51, name:"DUGTRIO",    type:["ground"],         hp:35, atk:80, def:50, spd:120,spc:70,  baseExp:134, growthRate:'medium_fast', catchRate:50,
                learnset:{ 1:['scratch','growl','dig'], 26:['sand attack'], 31:['slash'], 40:['earthquake'], 48:['fissure'] },
                moves:["scratch","growl","dig","earthquake"] },

  // ── #52-53 Meowth line ───────────────────────────────────────────────────
  meowth:     { id:52, name:"MEOWTH",     type:["normal"],         hp:40, atk:45, def:35, spd:90, spc:40,  baseExp:69,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'persian', level:28 },
                learnset:{ 1:['scratch','growl'], 12:['bite'], 17:['pay day'], 24:['screech'], 33:['fury swipes'], 44:['slash'] },
                moves:["scratch","growl","bite","pay day"] },

  persian:    { id:53, name:"PERSIAN",    type:["normal"],         hp:65, atk:70, def:60, spd:115,spc:65,  baseExp:148, growthRate:'medium_fast', catchRate:90,
                learnset:{ 1:['scratch','growl','bite','pay day'], 35:['screech'], 42:['fury swipes'], 49:['slash'] },
                moves:["scratch","pay day","slash","fury swipes"] },

  // ── #54-55 Psyduck line ──────────────────────────────────────────────────
  psyduck:    { id:54, name:"PSYDUCK",    type:["water"],          hp:50, atk:52, def:48, spd:55, spc:50,  baseExp:80,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'golduck', level:33 },
                learnset:{ 1:['scratch'], 28:['tail whip'], 31:['disable'], 36:['confusion'], 43:['fury swipes'], 46:['hydro pump'] },
                moves:["scratch","tail whip","disable","confusion"] },

  golduck:    { id:55, name:"GOLDUCK",    type:["water"],          hp:80, atk:82, def:78, spd:85, spc:80,  baseExp:174, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['scratch','tail whip','disable','confusion'], 46:['fury swipes'], 56:['hydro pump'] },
                moves:["scratch","confusion","disable","hydro pump"] },

  // ── #56-57 Mankey line ───────────────────────────────────────────────────
  mankey:     { id:56, name:"MANKEY",     type:["fighting"],       hp:40, atk:80, def:35, spd:70, spc:35,  baseExp:74,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'primeape', level:28 },
                learnset:{ 1:['scratch','leer'], 9:['karate chop'], 15:['fury swipes'], 21:['focus energy'], 27:['seismic toss'], 33:['thrash'], 45:['submission'] },
                moves:["scratch","leer","karate chop","fury swipes"] },

  primeape:   { id:57, name:"PRIMEAPE",   type:["fighting"],       hp:65, atk:105,def:60, spd:95, spc:60,  baseExp:149, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['scratch','leer','karate chop','fury swipes'], 28:['focus energy'], 33:['seismic toss'], 41:['thrash'], 53:['submission'] },
                moves:["karate chop","fury swipes","seismic toss","thrash"] },

  // ── #58-59 Growlithe line ────────────────────────────────────────────────
  growlithe:  { id:58, name:"GROWLITHE",  type:["fire"],           hp:55, atk:70, def:45, spd:60, spc:50,  baseExp:91,  growthRate:'slow', catchRate:190,
                evolvesTo:{ species:'arcanine', stone:'fire_stone' },
                learnset:{ 1:['bite','roar'], 18:['ember'], 23:['leer'], 30:['agility'], 39:['flamethrower'], 50:['fire blast'] },
                moves:["bite","roar","ember","leer"] },

  arcanine:   { id:59, name:"ARCANINE",   type:["fire"],           hp:90, atk:110,def:80, spd:95, spc:80,  baseExp:213, growthRate:'slow', catchRate:75,
                learnset:{ 1:['roar','ember','leer','agility'] },
                moves:["roar","flamethrower","agility","fire blast"] },

  // ── #60-62 Poliwag line ──────────────────────────────────────────────────
  poliwag:    { id:60, name:"POLIWAG",    type:["water"],          hp:40, atk:50, def:40, spd:90, spc:40,  baseExp:77,  growthRate:'medium_slow', catchRate:255,
                evolvesTo:{ species:'poliwhirl', level:25 },
                learnset:{ 1:['bubble'], 16:['hypnosis'], 19:['water gun'], 25:['double slap'], 31:['body slam'], 38:['amnesia'], 45:['hydro pump'] },
                moves:["bubble","hypnosis","water gun","double slap"] },

  poliwhirl:  { id:61, name:"POLIWHIRL",  type:["water"],          hp:65, atk:65, def:65, spd:90, spc:50,  baseExp:131, growthRate:'medium_slow', catchRate:120,
                evolvesTo:{ species:'poliwrath', stone:'water_stone' },
                learnset:{ 1:['bubble','hypnosis','water gun','double slap'], 25:['body slam'], 31:['amnesia'], 45:['hydro pump'] },
                moves:["water gun","double slap","body slam","amnesia"] },

  poliwrath:  { id:62, name:"POLIWRATH",  type:["water","fighting"],hp:90,atk:85, def:95, spd:70, spc:70,  baseExp:185, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['water gun','hypnosis','double slap','body slam'] },
                moves:["water gun","body slam","submission","amnesia"] },

  // ── #63-65 Abra line ─────────────────────────────────────────────────────
  abra:       { id:63, name:"ABRA",       type:["psychic"],        hp:25, atk:20, def:15, spd:90, spc:105, baseExp:73,  growthRate:'medium_slow', catchRate:200,
                evolvesTo:{ species:'kadabra', level:16 },
                learnset:{ 1:['teleport'] },
                moves:["teleport"] },

  kadabra:    { id:64, name:"KADABRA",    type:["psychic"],        hp:40, atk:35, def:30, spd:105,spc:120, baseExp:145, growthRate:'medium_slow', catchRate:100,
                evolvesTo:{ species:'alakazam', trade:true },
                learnset:{ 1:['teleport','confusion'], 16:['disable'], 20:['psybeam'], 27:['recover'], 31:['psywave'], 38:['amnesia'], 42:['psychic'], 48:['reflect'] },
                moves:["teleport","confusion","disable","psybeam"] },

  alakazam:   { id:65, name:"ALAKAZAM",   type:["psychic"],        hp:55, atk:50, def:45, spd:120,spc:135, baseExp:186, growthRate:'medium_slow', catchRate:50,
                learnset:{ 1:['teleport','confusion','disable','psybeam'], 38:['amnesia'], 42:['psychic'], 48:['reflect'] },
                moves:["confusion","psybeam","recover","psychic"] },

  // ── #66-68 Machop line ───────────────────────────────────────────────────
  machop:     { id:66, name:"MACHOP",     type:["fighting"],       hp:70, atk:80, def:50, spd:35, spc:35,  baseExp:75,  growthRate:'medium_slow', catchRate:180,
                evolvesTo:{ species:'machoke', level:28 },
                learnset:{ 1:['karate chop'], 20:['low kick'], 25:['leer'], 32:['focus energy'], 39:['seismic toss'], 46:['submission'] },
                moves:["karate chop","low kick","leer","focus energy"] },

  machoke:    { id:67, name:"MACHOKE",    type:["fighting"],       hp:80, atk:100,def:70, spd:45, spc:50,  baseExp:146, growthRate:'medium_slow', catchRate:90,
                evolvesTo:{ species:'machamp', trade:true },
                learnset:{ 1:['karate chop','low kick','leer','focus energy'], 39:['seismic toss'], 46:['submission'] },
                moves:["karate chop","seismic toss","leer","submission"] },

  machamp:    { id:68, name:"MACHAMP",    type:["fighting"],       hp:90, atk:130,def:80, spd:55, spc:65,  baseExp:193, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['karate chop','low kick','leer','focus energy'] },
                moves:["karate chop","seismic toss","submission","strength"] },

  // ── #69-71 Bellsprout line ───────────────────────────────────────────────
  bellsprout: { id:69, name:"BELLSPROUT", type:["grass","poison"], hp:50, atk:75, def:35, spd:40, spc:70,  baseExp:84,  growthRate:'medium_slow', catchRate:255,
                evolvesTo:{ species:'weepinbell', level:21 },
                learnset:{ 1:['vine whip','growth'], 13:['wrap'], 15:['poison powder'], 18:['sleep powder'], 26:['stun spore'], 29:['acid'], 38:['razor leaf'], 48:['slam'] },
                moves:["vine whip","growth","wrap","poison powder"] },

  weepinbell: { id:70, name:"WEEPINBELL", type:["grass","poison"], hp:65, atk:90, def:50, spd:55, spc:85,  baseExp:151, growthRate:'medium_slow', catchRate:120,
                evolvesTo:{ species:'victreebel', stone:'leaf_stone' },
                learnset:{ 1:['vine whip','growth','wrap','poison powder'], 26:['stun spore'], 29:['acid'], 38:['razor leaf'], 48:['slam'] },
                moves:["vine whip","acid","stun spore","razor leaf"] },

  victreebel: { id:71, name:"VICTREEBEL", type:["grass","poison"], hp:80, atk:105,def:65, spd:70, spc:100, baseExp:191, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['vine whip','wrap','poison powder','sleep powder'] },
                moves:["vine whip","razor leaf","sleep powder","slam"] },

  // ── #72-73 Tentacool line ────────────────────────────────────────────────
  tentacool:  { id:72, name:"TENTACOOL",  type:["water","poison"], hp:40, atk:40, def:35, spd:70, spc:100, baseExp:105, growthRate:'slow', catchRate:190,
                evolvesTo:{ species:'tentacruel', level:30 },
                learnset:{ 1:['acid','constrict'], 7:['supersonic'], 18:['wrap'], 22:['poison sting'], 33:['water gun'], 37:['barrier'], 46:['hydro pump'] },
                moves:["acid","constrict","supersonic","wrap"] },

  tentacruel: { id:73, name:"TENTACRUEL", type:["water","poison"], hp:80, atk:70, def:65, spd:100,spc:120, baseExp:205, growthRate:'slow', catchRate:60,
                learnset:{ 1:['acid','constrict','supersonic','wrap'], 22:['poison sting'], 33:['water gun'], 37:['barrier'], 46:['hydro pump'] },
                moves:["acid","water gun","barrier","hydro pump"] },

  // ── #74-76 Geodude line ──────────────────────────────────────────────────
  geodude:    { id:74, name:"GEODUDE",    type:["rock","ground"],  hp:40, atk:80, def:100,spd:20, spc:30,  baseExp:86,  growthRate:'medium_fast', catchRate:255,
                evolvesTo:{ species:'graveler', level:25 },
                learnset:{ 1:['tackle','defense curl'], 11:['rock throw'], 16:['self destruct'], 21:['harden'], 26:['earthquake'], 31:['explosion'] },
                moves:["tackle","defense curl","rock throw","magnitude"] },

  graveler:   { id:75, name:"GRAVELER",   type:["rock","ground"],  hp:55, atk:95, def:115,spd:35, spc:45,  baseExp:134, growthRate:'medium_fast', catchRate:120,
                evolvesTo:{ species:'golem', trade:true },
                learnset:{ 1:['tackle','defense curl','rock throw','self destruct'], 21:['harden'], 26:['earthquake'], 31:['explosion'] },
                moves:["tackle","defense curl","rock throw","magnitude"] },

  golem:      { id:76, name:"GOLEM",      type:["rock","ground"],  hp:80, atk:110,def:130,spd:45, spc:55,  baseExp:177, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['tackle','defense curl','rock throw','self destruct'] },
                moves:["tackle","rock throw","earthquake","explosion"] },

  // ── #77-78 Ponyta line ───────────────────────────────────────────────────
  ponyta:     { id:77, name:"PONYTA",     type:["fire"],           hp:50, atk:85, def:55, spd:90, spc:65,  baseExp:152, growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'rapidash', level:40 },
                learnset:{ 1:['ember'], 30:['stomp'], 32:['growl'], 35:['fire spin'], 39:['take down'], 48:['agility'], 55:['fire blast'] },
                moves:["ember","stomp","growl","fire spin"] },

  rapidash:   { id:78, name:"RAPIDASH",   type:["fire"],           hp:65, atk:100,def:70, spd:105,spc:80,  baseExp:192, growthRate:'medium_fast', catchRate:60,
                learnset:{ 1:['ember','stomp','growl','fire spin'], 48:['agility'], 58:['fire blast'] },
                moves:["ember","stomp","fire spin","agility"] },

  // ── #79-80 Slowpoke line ─────────────────────────────────────────────────
  slowpoke:   { id:79, name:"SLOWPOKE",   type:["water","psychic"],hp:90, atk:65, def:65, spd:15, spc:40,  baseExp:99,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'slowbro', level:37 },
                learnset:{ 1:['confusion'], 18:['disable'], 22:['headbutt'], 28:['growl'], 36:['water gun'], 46:['amnesia'], 52:['psychic'] },
                moves:["confusion","disable","headbutt","growl"] },

  slowbro:    { id:80, name:"SLOWBRO",    type:["water","psychic"],hp:95, atk:75, def:110,spd:30, spc:80,  baseExp:164, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['confusion','disable','headbutt','growl'], 46:['amnesia'], 52:['psychic'] },
                moves:["confusion","water gun","amnesia","psychic"] },

  // ── #81-82 Magnemite line ────────────────────────────────────────────────
  magnemite:  { id:81, name:"MAGNEMITE",  type:["electric"],       hp:25, atk:35, def:70, spd:45, spc:95,  baseExp:89,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'magneton', level:30 },
                learnset:{ 1:['tackle','thunder shock'], 21:['thunder shock'], 25:['supersonic'], 29:['thunder wave'], 35:['swift'], 41:['screech'], 51:['thunderbolt'] },
                moves:["tackle","thunder shock","supersonic","thunder wave"] },

  magneton:   { id:82, name:"MAGNETON",   type:["electric"],       hp:50, atk:60, def:95, spd:70, spc:120, baseExp:161, growthRate:'medium_fast', catchRate:60,
                learnset:{ 1:['tackle','thunder shock','supersonic','thunder wave'], 35:['swift'], 41:['screech'], 51:['thunderbolt'] },
                moves:["thunder shock","thunder wave","screech","thunderbolt"] },

  // ── #83 Farfetch'd ───────────────────────────────────────────────────────
  farfetchd:  { id:83, name:"FARFETCH'D", type:["normal","flying"],hp:52, atk:65, def:55, spd:60, spc:58,  baseExp:94,  growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['peck','sand attack'], 25:['leer'], 30:['fury attack'], 35:['swords dance'], 40:['agility'], 45:['slash'] },
                moves:["peck","sand attack","leer","fury attack"] },

  // ── #84-85 Doduo line ────────────────────────────────────────────────────
  doduo:      { id:84, name:"DODUO",      type:["normal","flying"],hp:35, atk:85, def:45, spd:75, spc:35,  baseExp:96,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'dodrio', level:31 },
                learnset:{ 1:['peck','growl'], 20:['fury attack'], 30:['drill peck'], 40:['agility'], 50:['tri attack'] },
                moves:["peck","growl","fury attack","drill peck"] },

  dodrio:     { id:85, name:"DODRIO",     type:["normal","flying"],hp:60, atk:110,def:70, spd:100,spc:60,  baseExp:158, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['peck','growl','fury attack','drill peck'], 40:['agility'], 50:['tri attack'] },
                moves:["peck","fury attack","drill peck","tri attack"] },

  // ── #86-87 Seel line ─────────────────────────────────────────────────────
  seel:       { id:86, name:"SEEL",       type:["water"],          hp:65, atk:45, def:55, spd:45, spc:70,  baseExp:100, growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'dewgong', level:34 },
                learnset:{ 1:['headbutt'], 30:['growl'], 35:['aurora beam'], 40:['rest'], 45:['take down'], 50:['ice beam'] },
                moves:["headbutt","growl","aurora beam","rest"] },

  dewgong:    { id:87, name:"DEWGONG",    type:["water","ice"],    hp:90, atk:70, def:80, spd:70, spc:95,  baseExp:176, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['headbutt','growl','aurora beam','rest'], 44:['take down'], 50:['ice beam'] },
                moves:["aurora beam","rest","take down","ice beam"] },

  // ── #88-89 Grimer line ───────────────────────────────────────────────────
  grimer:     { id:88, name:"GRIMER",     type:["poison"],         hp:80, atk:80, def:50, spd:25, spc:40,  baseExp:90,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'muk', level:38 },
                learnset:{ 1:['pound','disable'], 30:['poison gas'], 33:['minimize'], 37:['screech'], 42:['sludge'], 48:['harden'], 55:['acid armor'] },
                moves:["pound","disable","poison gas","minimize"] },

  muk:        { id:89, name:"MUK",        type:["poison"],         hp:105,atk:105,def:75, spd:50, spc:65,  baseExp:157, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['pound','disable','poison gas','minimize'], 42:['sludge'], 55:['harden'], 60:['acid armor'] },
                moves:["sludge","minimize","harden","screech"] },

  // ── #90-91 Shellder line ─────────────────────────────────────────────────
  shellder:   { id:90, name:"SHELLDER",   type:["water"],          hp:30, atk:65, def:100,spd:40, spc:45,  baseExp:97,  growthRate:'slow', catchRate:190,
                evolvesTo:{ species:'cloyster', stone:'water_stone' },
                learnset:{ 1:['tackle','withdraw'], 18:['supersonic'], 23:['clamp'], 30:['aurora beam'], 39:['leer'], 50:['ice beam'] },
                moves:["tackle","withdraw","supersonic","clamp"] },

  cloyster:   { id:91, name:"CLOYSTER",   type:["water","ice"],    hp:50, atk:95, def:180,spd:70, spc:85,  baseExp:203, growthRate:'slow', catchRate:60,
                learnset:{ 1:['tackle','withdraw','supersonic','clamp'] },
                moves:["clamp","aurora beam","spike cannon","blizzard"] },

  // ── #92-94 Gastly line ───────────────────────────────────────────────────
  gastly:     { id:92, name:"GASTLY",     type:["ghost","poison"], hp:30, atk:35, def:30, spd:80, spc:100, baseExp:95,  growthRate:'medium_slow', catchRate:190,
                evolvesTo:{ species:'haunter', level:25 },
                learnset:{ 1:['lick','confuse ray'], 27:['night shade'], 35:['hypnosis'] },
                moves:["lick","confuse ray","night shade","hypnosis"] },

  haunter:    { id:93, name:"HAUNTER",    type:["ghost","poison"], hp:45, atk:50, def:45, spd:95, spc:115, baseExp:126, growthRate:'medium_slow', catchRate:90,
                evolvesTo:{ species:'gengar', trade:true },
                learnset:{ 1:['lick','confuse ray','night shade','hypnosis'] },
                moves:["lick","confuse ray","night shade","hypnosis"] },

  gengar:     { id:94, name:"GENGAR",     type:["ghost","poison"], hp:60, atk:65, def:60, spd:110,spc:130, baseExp:190, growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['lick','confuse ray','night shade','hypnosis'] },
                moves:["lick","confuse ray","night shade","psychic"] },

  // ── #95 Onix ─────────────────────────────────────────────────────────────
  onix:       { id:95, name:"ONIX",       type:["rock","ground"],  hp:35, atk:45, def:160,spd:70, spc:30,  baseExp:108, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['tackle','screech'], 15:['bind'], 19:['rock throw'], 25:['rage'], 33:['slam'], 43:['harden'] },
                // Brock's Onix: Tackle, Screech, Bide, Bind (Gen I Red/Blue)
                moves:["tackle","screech","bide","bind"] },

  // ── #96-97 Drowzee line ──────────────────────────────────────────────────
  drowzee:    { id:96, name:"DROWZEE",    type:["psychic"],        hp:60, atk:48, def:45, spd:42, spc:43,  baseExp:102, growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'hypno', level:26 },
                learnset:{ 1:['pound','hypnosis'], 12:['disable'], 17:['confusion'], 24:['headbutt'], 29:['poison gas'], 32:['psybeam'], 37:['psychic'] },
                moves:["pound","hypnosis","disable","confusion"] },

  hypno:      { id:97, name:"HYPNO",      type:["psychic"],        hp:85, atk:73, def:70, spd:67, spc:73,  baseExp:165, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['pound','hypnosis','disable','confusion'], 29:['poison gas'], 32:['psybeam'], 37:['psychic'] },
                moves:["hypnosis","confusion","psybeam","psychic"] },

  // ── #98-99 Krabby line ───────────────────────────────────────────────────
  krabby:     { id:98, name:"KRABBY",     type:["water"],          hp:30, atk:105,def:90, spd:50, spc:25,  baseExp:115, growthRate:'medium_fast', catchRate:225,
                evolvesTo:{ species:'kingler', level:28 },
                learnset:{ 1:['bubble','leer'], 25:['clamp'], 30:['crabhammer'], 35:['stomp'], 40:['guillotine'] },
                moves:["bubble","leer","clamp","crabhammer"] },

  kingler:    { id:99, name:"KINGLER",    type:["water"],          hp:55, atk:130,def:115,spd:75, spc:50,  baseExp:206, growthRate:'medium_fast', catchRate:60,
                learnset:{ 1:['bubble','leer','clamp','crabhammer'], 40:['stomp'], 50:['guillotine'] },
                moves:["crabhammer","stomp","clamp","guillotine"] },

  // ── #100-101 Voltorb line ────────────────────────────────────────────────
  voltorb:    { id:100,name:"VOLTORB",    type:["electric"],       hp:40, atk:30, def:50, spd:100,spc:55,  baseExp:103, growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'electrode', level:30 },
                learnset:{ 1:['tackle','screech'], 17:['sonic boom'], 22:['self destruct'], 29:['swift'], 36:['thunderbolt'], 40:['explosion'] },
                moves:["tackle","screech","sonic boom","swift"] },

  electrode:  { id:101,name:"ELECTRODE",  type:["electric"],       hp:60, atk:50, def:70, spd:140,spc:80,  baseExp:150, growthRate:'medium_fast', catchRate:60,
                learnset:{ 1:['tackle','screech','sonic boom','swift'], 36:['thunderbolt'], 40:['explosion'] },
                moves:["swift","thunderbolt","screech","explosion"] },

  // ── #102-103 Exeggcute line ──────────────────────────────────────────────
  exeggcute:  { id:102,name:"EXEGGCUTE",  type:["grass","psychic"],hp:60, atk:40, def:80, spd:40, spc:60,  baseExp:98,  growthRate:'slow', catchRate:90,
                evolvesTo:{ species:'exeggutor', stone:'leaf_stone' },
                learnset:{ 1:['barrage','hypnosis'], 25:['reflect'], 28:['leech seed'], 32:['stun spore'], 37:['poison powder'], 42:['solar beam'], 48:['sleep powder'] },
                moves:["barrage","hypnosis","reflect","leech seed"] },

  exeggutor:  { id:103,name:"EXEGGUTOR",  type:["grass","psychic"],hp:95, atk:95, def:85, spd:55, spc:125, baseExp:212, growthRate:'slow', catchRate:45,
                learnset:{ 1:['barrage','hypnosis','stomp'] },
                moves:["barrage","stomp","sleep powder","psychic"] },

  // ── #104-105 Cubone line ─────────────────────────────────────────────────
  cubone:     { id:104,name:"CUBONE",     type:["ground"],         hp:50, atk:50, def:95, spd:35, spc:40,  baseExp:87,  growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'marowak', level:28 },
                learnset:{ 1:['growl','tackle'], 25:['bone club'], 31:['headbutt'], 38:['leer'], 43:['focus energy'], 46:['thrash'], 50:['bonemerang'] },
                moves:["growl","tackle","bone club","headbutt"] },

  marowak:    { id:105,name:"MAROWAK",    type:["ground"],         hp:60, atk:80, def:110,spd:45, spc:50,  baseExp:124, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['growl','tackle','bone club','headbutt'], 33:['focus energy'], 41:['thrash'], 48:['bonemerang'] },
                moves:["bone club","headbutt","focus energy","bonemerang"] },

  // ── #106 Hitmonlee ───────────────────────────────────────────────────────
  hitmonlee:  { id:106,name:"HITMONLEE",  type:["fighting"],       hp:50, atk:120,def:53, spd:87, spc:35,  baseExp:139, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['double kick','meditate'], 33:['rolling kick'], 38:['jump kick'], 43:['focus energy'], 48:['high jump kick'], 53:['mega kick'] },
                moves:["double kick","meditate","rolling kick","jump kick"] },

  // ── #107 Hitmonchan ──────────────────────────────────────────────────────
  hitmonchan: { id:107,name:"HITMONCHAN", type:["fighting"],       hp:50, atk:105,def:79, spd:76, spc:35,  baseExp:140, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['comet punch','agility'], 33:['fire punch'], 38:['ice punch'], 43:['thunder punch'], 48:['mega punch'], 53:['submission'] },
                moves:["comet punch","agility","fire punch","ice punch"] },

  // ── #108 Lickitung ───────────────────────────────────────────────────────
  lickitung:  { id:108,name:"LICKITUNG",  type:["normal"],         hp:90, atk:55, def:75, spd:30, spc:60,  baseExp:127, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['wrap','supersonic'], 7:['stomp'], 15:['disable'], 23:['defense curl'], 31:['slam'], 39:['screech'] },
                moves:["wrap","supersonic","stomp","disable"] },

  // ── #109-110 Koffing line ────────────────────────────────────────────────
  koffing:    { id:109,name:"KOFFING",    type:["poison"],         hp:40, atk:65, def:95, spd:35, spc:60,  baseExp:114, growthRate:'medium_fast', catchRate:190,
                evolvesTo:{ species:'weezing', level:35 },
                learnset:{ 1:['tackle','smog'], 32:['self destruct'], 37:['sludge'], 40:['smokescreen'], 45:['haze'], 50:['explosion'] },
                moves:["tackle","smog","self destruct","sludge"] },

  weezing:    { id:110,name:"WEEZING",    type:["poison"],         hp:65, atk:90, def:120,spd:60, spc:85,  baseExp:173, growthRate:'medium_fast', catchRate:60,
                learnset:{ 1:['tackle','smog','self destruct','sludge'], 45:['haze'], 50:['explosion'] },
                moves:["sludge","smokescreen","haze","explosion"] },

  // ── #111-112 Rhyhorn line ────────────────────────────────────────────────
  rhyhorn:    { id:111,name:"RHYHORN",    type:["ground","rock"],  hp:80, atk:85, def:95, spd:25, spc:30,  baseExp:135, growthRate:'slow', catchRate:120,
                evolvesTo:{ species:'rhydon', level:42 },
                learnset:{ 1:['horn attack'], 30:['stomp'], 35:['tail whip'], 40:['fury attack'], 45:['horn drill'], 50:['take down'], 55:['leer'] },
                moves:["horn attack","stomp","tail whip","fury attack"] },

  rhydon:     { id:112,name:"RHYDON",     type:["ground","rock"],  hp:105,atk:130,def:120,spd:40, spc:45,  baseExp:204, growthRate:'slow', catchRate:60,
                learnset:{ 1:['horn attack','stomp','tail whip','fury attack'] },
                moves:["horn attack","stomp","earthquake","rock slide"] },

  // ── #113 Chansey ─────────────────────────────────────────────────────────
  chansey:    { id:113,name:"CHANSEY",    type:["normal"],         hp:250,atk:5,  def:5,  spd:50, spc:105, baseExp:255, growthRate:'fast', catchRate:30,
                learnset:{ 1:['pound','growl'], 24:['tail whip'], 30:['sing'], 38:['egg bomb'], 44:['minimize'], 48:['defense curl'], 54:['light screen'], 60:['double edge'] },
                moves:["pound","growl","tail whip","sing"] },

  // ── #114 Tangela ─────────────────────────────────────────────────────────
  tangela:    { id:114,name:"TANGELA",    type:["grass"],          hp:65, atk:55, def:115,spd:60, spc:100, baseExp:166, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['constrict','bind'], 29:['absorb'], 32:['vine whip'], 36:['stun spore'], 39:['poison powder'], 45:['sleep powder'], 49:['growth'] },
                moves:["constrict","bind","absorb","vine whip"] },

  // ── #115 Kangaskhan ──────────────────────────────────────────────────────
  kangaskhan: { id:115,name:"KANGASKHAN", type:["normal"],         hp:105,atk:95, def:80, spd:90, spc:40,  baseExp:175, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['comet punch','leer'], 26:['bite'], 31:['tail whip'], 36:['mega punch'], 46:['headbutt'] },
                moves:["comet punch","leer","bite","tail whip"] },

  // ── #116-117 Horsea line ─────────────────────────────────────────────────
  horsea:     { id:116,name:"HORSEA",     type:["water"],          hp:30, atk:40, def:70, spd:60, spc:70,  baseExp:83,  growthRate:'medium_fast', catchRate:225,
                evolvesTo:{ species:'seadra', level:32 },
                learnset:{ 1:['bubble'], 19:['smokescreen'], 24:['leer'], 30:['water gun'], 37:['agility'], 45:['hydro pump'] },
                moves:["bubble","smokescreen","leer","water gun"] },

  seadra:     { id:117,name:"SEADRA",     type:["water"],          hp:55, atk:65, def:95, spd:85, spc:95,  baseExp:155, growthRate:'medium_fast', catchRate:75,
                learnset:{ 1:['bubble','smokescreen','leer','water gun'], 37:['agility'], 45:['hydro pump'] },
                moves:["water gun","leer","agility","hydro pump"] },

  // ── #118-119 Goldeen line ────────────────────────────────────────────────
  goldeen:    { id:118,name:"GOLDEEN",    type:["water"],          hp:45, atk:67, def:60, spd:63, spc:50,  baseExp:111, growthRate:'medium_fast', catchRate:225,
                evolvesTo:{ species:'seaking', level:33 },
                learnset:{ 1:['peck','tail whip'], 19:['supersonic'], 24:['horn attack'], 29:['fury attack'], 38:['waterfall'], 45:['horn drill'] },
                moves:["peck","tail whip","supersonic","horn attack"] },

  seaking:    { id:119,name:"SEAKING",    type:["water"],          hp:80, atk:92, def:65, spd:68, spc:80,  baseExp:170, growthRate:'medium_fast', catchRate:60,
                learnset:{ 1:['peck','tail whip','supersonic','horn attack'], 38:['waterfall'], 48:['horn drill'] },
                moves:["horn attack","fury attack","waterfall","agility"] },

  // ── #120-121 Staryu line ─────────────────────────────────────────────────
  staryu:     { id:120,name:"STARYU",     type:["water"],          hp:30, atk:45, def:55, spd:85, spc:70,  baseExp:106, growthRate:'slow', catchRate:225,
                evolvesTo:{ species:'starmie', stone:'water_stone' },
                learnset:{ 1:['tackle'], 17:['water gun'], 22:['harden'], 27:['minimize'], 32:['light screen'], 37:['swift'], 44:['psychic'] },
                moves:["tackle","water gun","harden","swift"] },

  starmie:    { id:121,name:"STARMIE",    type:["water","psychic"],hp:60, atk:75, def:85, spd:115,spc:100, baseExp:207, growthRate:'slow', catchRate:60,
                learnset:{ 1:['tackle','water gun','harden','swift'] },
                moves:["water gun","swift","psychic","blizzard"] },

  // ── #122 Mr. Mime ────────────────────────────────────────────────────────
  mr_mime:    { id:122,name:"MR. MIME",   type:["psychic"],        hp:40, atk:45, def:65, spd:90, spc:100, baseExp:136, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['confusion','barrier'], 15:['meditate'], 23:['psybeam'], 31:['substitute'], 47:['psychic'] },
                moves:["confusion","barrier","psybeam","psychic"] },

  // ── #123 Scyther ─────────────────────────────────────────────────────────
  scyther:    { id:123,name:"SCYTHER",    type:["bug","flying"],   hp:70, atk:110,def:80, spd:105,spc:55,  baseExp:187, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['quick attack'], 17:['leer'], 20:['focus energy'], 24:['double team'], 29:['slash'], 33:['swords dance'], 38:['agility'] },
                moves:["quick attack","leer","slash","swords dance"] },

  // ── #124 Jynx ────────────────────────────────────────────────────────────
  jynx:       { id:124,name:"JYNX",       type:["ice","psychic"],  hp:65, atk:50, def:35, spd:95, spc:95,  baseExp:137, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['pound','lick'], 18:['lovely kiss'], 23:['lick'], 31:['double slap'], 39:['ice punch'], 47:['blizzard'], 58:['psychic'] },
                moves:["pound","lovely kiss","lick","ice punch"] },

  // ── #125 Electabuzz ──────────────────────────────────────────────────────
  electabuzz: { id:125,name:"ELECTABUZZ", type:["electric"],       hp:65, atk:83, def:57, spd:105,spc:85,  baseExp:156, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['leer','thunder shock'], 34:['quick attack'], 37:['thunder punch'], 42:['thunder wave'], 49:['thunderbolt'], 54:['thunder'] },
                moves:["leer","thunder shock","thunder punch","thunder wave"] },

  // ── #126 Magmar ──────────────────────────────────────────────────────────
  magmar:     { id:126,name:"MAGMAR",     type:["fire"],           hp:65, atk:95, def:57, spd:93, spc:85,  baseExp:167, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['ember','leer'], 36:['confuse ray'], 39:['fire punch'], 43:['smokescreen'], 48:['smog'], 52:['flamethrower'], 55:['fire blast'] },
                moves:["ember","leer","fire punch","confuse ray"] },

  // ── #127 Pinsir ──────────────────────────────────────────────────────────
  pinsir:     { id:127,name:"PINSIR",     type:["bug"],            hp:65, atk:125,def:100,spd:85, spc:55,  baseExp:200, growthRate:'slow', catchRate:45,
                learnset:{ 1:['vice grip'], 25:['seismic toss'], 30:['guillotine'], 36:['focus energy'], 43:['harden'], 49:['slash'], 54:['swords dance'] },
                moves:["vice grip","seismic toss","guillotine","slash"] },

  // ── #128 Tauros ──────────────────────────────────────────────────────────
  tauros:     { id:128,name:"TAUROS",     type:["normal"],         hp:75, atk:100,def:95, spd:110,spc:70,  baseExp:211, growthRate:'slow', catchRate:45,
                learnset:{ 1:['tackle'], 20:['stomp'], 25:['tail whip'], 35:['leer'], 44:['thrash'], 51:['take down'] },
                moves:["tackle","stomp","tail whip","leer"] },

  // ── #129-130 Magikarp line ───────────────────────────────────────────────
  magikarp:   { id:129,name:"MAGIKARP",   type:["water"],          hp:20, atk:10, def:55, spd:80, spc:20,  baseExp:20,  growthRate:'slow', catchRate:255,
                evolvesTo:{ species:'gyarados', level:20 },
                learnset:{ 1:['splash'], 15:['tackle'] },
                moves:["splash","tackle"] },

  gyarados:   { id:130,name:"GYARADOS",   type:["water","flying"], hp:95, atk:125,def:79, spd:81, spc:100, baseExp:214, growthRate:'slow', catchRate:45,
                learnset:{ 1:['tackle'], 20:['bite'], 25:['dragon rage'], 32:['leer'], 41:['hydro pump'], 52:['hyper beam'] },
                moves:["bite","dragon rage","hydro pump","hyper beam"] },

  // ── #131 Lapras ──────────────────────────────────────────────────────────
  lapras:     { id:131,name:"LAPRAS",     type:["water","ice"],    hp:130,atk:85, def:80, spd:60, spc:95,  baseExp:219, growthRate:'slow', catchRate:45,
                learnset:{ 1:['water gun','growl'], 16:['sing'], 20:['mist'], 26:['body slam'], 32:['confuse ray'], 40:['ice beam'], 48:['hydro pump'] },
                moves:["water gun","growl","sing","mist"] },

  // ── #132 Ditto ───────────────────────────────────────────────────────────
  ditto:      { id:132,name:"DITTO",      type:["normal"],         hp:48, atk:48, def:48, spd:48, spc:48,  baseExp:61,  growthRate:'medium_fast', catchRate:35,
                learnset:{ 1:['transform'] },
                moves:["transform"] },

  // ── #133-136 Eevee line ──────────────────────────────────────────────────
  eevee:      { id:133,name:"EEVEE",      type:["normal"],         hp:55, atk:55, def:50, spd:55, spc:45,  baseExp:92,  growthRate:'medium_fast', catchRate:45,
                evolvesTo:[
                  { species:'vaporeon', stone:'water_stone' },
                  { species:'jolteon',  stone:'thunder_stone' },
                  { species:'flareon',  stone:'fire_stone' },
                ],
                learnset:{ 1:['tackle','tail whip','sand attack','quick attack'], 23:['growl'], 30:['bite'] },
                moves:["tackle","tail whip","sand attack","quick attack"] },

  vaporeon:   { id:134,name:"VAPOREON",   type:["water"],          hp:130,atk:65, def:60, spd:65, spc:110, baseExp:196, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['tackle','tail whip','sand attack','quick attack'], 36:['water gun'], 41:['acid armor'], 46:['haze'], 51:['mist'], 56:['hydro pump'] },
                moves:["tackle","water gun","acid armor","hydro pump"] },

  jolteon:    { id:135,name:"JOLTEON",    type:["electric"],       hp:65, atk:65, def:60, spd:130,spc:110, baseExp:197, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['tackle','tail whip','sand attack','quick attack'], 36:['thunder shock'], 41:['agility'], 46:['thunder wave'], 51:['swift'], 56:['thunder'] },
                moves:["tackle","thunder shock","thunder wave","thunderbolt"] },

  flareon:    { id:136,name:"FLAREON",    type:["fire"],           hp:65, atk:130,def:60, spd:65, spc:110, baseExp:198, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['tackle','tail whip','sand attack','quick attack'], 36:['ember'], 41:['leer'], 46:['fire spin'], 51:['smog'], 56:['flamethrower'] },
                moves:["tackle","ember","leer","flamethrower"] },

  // ── #137 Porygon ─────────────────────────────────────────────────────────
  porygon:    { id:137,name:"PORYGON",    type:["normal"],         hp:65, atk:60, def:70, spd:40, spc:75,  baseExp:130, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['tackle','sharpen','conversion'], 30:['psybeam'], 35:['recover'], 40:['agility'], 45:['tri attack'] },
                moves:["tackle","sharpen","conversion","psybeam"] },

  // ── #138-139 Omanyte line ────────────────────────────────────────────────
  omanyte:    { id:138,name:"OMANYTE",    type:["rock","water"],   hp:35, atk:40, def:100,spd:35, spc:90,  baseExp:120, growthRate:'medium_fast', catchRate:45,
                evolvesTo:{ species:'omastar', level:40 },
                learnset:{ 1:['water gun','withdraw'], 31:['horn attack'], 36:['leer'], 41:['spike cannon'], 46:['hydro pump'] },
                moves:["water gun","withdraw","horn attack","leer"] },

  omastar:    { id:139,name:"OMASTAR",    type:["rock","water"],   hp:70, atk:60, def:125,spd:55, spc:115, baseExp:199, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['water gun','withdraw','horn attack','leer'], 46:['spike cannon'], 53:['hydro pump'] },
                moves:["water gun","horn attack","spike cannon","hydro pump"] },

  // ── #140-141 Kabuto line ─────────────────────────────────────────────────
  kabuto:     { id:140,name:"KABUTO",     type:["rock","water"],   hp:30, atk:80, def:90, spd:55, spc:45,  baseExp:119, growthRate:'medium_fast', catchRate:45,
                evolvesTo:{ species:'kabutops', level:40 },
                learnset:{ 1:['scratch','harden'], 34:['absorb'], 39:['slash'], 44:['leer'], 49:['hydro pump'] },
                moves:["scratch","harden","absorb","slash"] },

  kabutops:   { id:141,name:"KABUTOPS",   type:["rock","water"],   hp:60, atk:115,def:105,spd:80, spc:70,  baseExp:201, growthRate:'medium_fast', catchRate:45,
                learnset:{ 1:['scratch','harden','absorb','slash'], 44:['leer'], 49:['hydro pump'] },
                moves:["scratch","slash","leer","hydro pump"] },

  // ── #142 Aerodactyl ──────────────────────────────────────────────────────
  aerodactyl: { id:142,name:"AERODACTYL", type:["rock","flying"],  hp:80, atk:105,def:65, spd:130,spc:60,  baseExp:202, growthRate:'slow', catchRate:45,
                learnset:{ 1:['wing attack','agility'], 33:['supersonic'], 38:['bite'], 45:['take down'], 54:['hyper beam'] },
                moves:["wing attack","agility","supersonic","bite"] },

  // ── #143 Snorlax ─────────────────────────────────────────────────────────
  snorlax:    { id:143,name:"SNORLAX",    type:["normal"],         hp:160,atk:110,def:65, spd:30, spc:65,  baseExp:154, growthRate:'slow', catchRate:25,
                learnset:{ 1:['headbutt'], 35:['amnesia'], 41:['rest'], 48:['body slam'], 56:['harden'] },
                moves:["headbutt","amnesia","rest","body slam"] },

  // ── #144-146 Legendary Birds ─────────────────────────────────────────────
  articuno:   { id:144,name:"ARTICUNO",   type:["ice","flying"],   hp:90, atk:85, def:100,spd:85, spc:125, baseExp:215, growthRate:'slow', catchRate:3,
                learnset:{ 1:['peck','ice beam'], 51:['blizzard'], 55:['agility'], 60:['mist'] },
                moves:["peck","ice beam","blizzard","agility"] },

  zapdos:     { id:145,name:"ZAPDOS",     type:["electric","flying"],hp:90,atk:90,def:85, spd:100,spc:125, baseExp:216, growthRate:'slow', catchRate:3,
                learnset:{ 1:['peck','thunder shock'], 51:['thunderbolt'], 55:['agility'], 60:['thunder'] },
                moves:["peck","thunder shock","thunderbolt","thunder"] },

  moltres:    { id:146,name:"MOLTRES",    type:["fire","flying"],  hp:90, atk:100,def:90, spd:90, spc:125, baseExp:217, growthRate:'slow', catchRate:3,
                learnset:{ 1:['peck','ember'], 51:['fire spin'], 55:['agility'], 60:['fire blast'] },
                moves:["peck","ember","fire spin","fire blast"] },

  // ── #147-149 Dratini line ────────────────────────────────────────────────
  dratini:    { id:147,name:"DRATINI",    type:["dragon"],         hp:41, atk:64, def:45, spd:50, spc:50,  baseExp:67,  growthRate:'slow', catchRate:45,
                evolvesTo:{ species:'dragonair', level:30 },
                learnset:{ 1:['wrap','leer'], 10:['thunder wave'], 20:['agility'], 35:['slam'], 45:['dragon rage'], 55:['hyper beam'] },
                moves:["wrap","leer","thunder wave","agility"] },

  dragonair:  { id:148,name:"DRAGONAIR",  type:["dragon"],         hp:61, atk:84, def:65, spd:70, spc:70,  baseExp:144, growthRate:'slow', catchRate:45,
                evolvesTo:{ species:'dragonite', level:55 },
                learnset:{ 1:['wrap','leer','thunder wave','agility'], 35:['slam'], 45:['dragon rage'], 55:['hyper beam'] },
                moves:["wrap","thunder wave","agility","slam"] },

  dragonite:  { id:149,name:"DRAGONITE",  type:["dragon","flying"],hp:91, atk:134,def:95, spd:80, spc:100, baseExp:218, growthRate:'slow', catchRate:45,
                learnset:{ 1:['wrap','leer','thunder wave','agility'] },
                moves:["wrap","agility","slam","hyper beam"] },

  // ── #150-151 Mewtwo and Mew ──────────────────────────────────────────────
  mewtwo:     { id:150,name:"MEWTWO",     type:["psychic"],        hp:106,atk:110,def:90, spd:130,spc:154, baseExp:220, growthRate:'slow', catchRate:3,
                learnset:{ 1:['confusion'], 63:['disable'], 66:['swift'], 73:['psychic'], 79:['amnesia'], 85:['recover'], 90:['psywave'] },
                moves:["confusion","swift","psychic","amnesia"] },

  mew:        { id:151,name:"MEW",        type:["psychic"],        hp:100,atk:100,def:100,spd:100,spc:100, baseExp:64,  growthRate:'medium_slow', catchRate:45,
                learnset:{ 1:['pound'], 10:['transform'], 20:['mega punch'], 30:['metronome'], 40:['psychic'] },
                moves:["pound","transform","metronome","psychic"] },
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
