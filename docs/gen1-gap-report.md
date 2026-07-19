# pokemon-llm vs. Pokémon Red/Blue (Gen 1, international) — Exhaustive Gap Analysis

**Date:** 2026-07-19 · **Code audited:** `repos/pokemon-llm` @ `main` (engine.js 1650 ln, data files, server.js)
**Sources:** Bulbapedia (Damage, Stat, Catch rate, Status condition, Experience, Badge, Escape, Wrap, List of battle glitches in Generation I, Prize money, Viridian City, Pewter City, Celadon Department Store, Kanto Route 1, Wild Pokémon, Black out), Smogon RBY conventions.
**Severity scale:** **GD** = game-defining · **SIG** = significant · **FLV** = flavor.

---

## 1. Executive summary

This engine is a competent *battle-core miniature* of Gen 1 — the type chart (with authentic quirks), 151 species with accurate base stats/growth/catch rates, the core damage formula shape, and most single-status mechanics are right — bolted onto roughly **2% of Red's world** (5 areas of ~50+ locations, 1 of 8 badges, 5 of ~40 trainers) with **no individual variation layer** (no DVs, no stat experience), **an entire class of move effects that exist only as inert data flags** (fixed-damage, OHKO, drain, heal, recoil, self-KO, trapping semantics, Counter/Disable/Substitute/Transform/Metronome/Mirror Move/screens are all no-ops), a **Gen III catch algorithm wearing a Gen I costume**, an item roster of 13 of ~80 items with **no PP restore, no Revive, no Repel, no X-items**, and none of Gen 1's systems (Pokédex, trading, Safari Zone, Game Corner, day-care, fishing). Two outright engine bugs are worse than any fidelity gap: **purchased Poké Balls can never be thrown** (mart deposits to `bag`, `throw_ball` reads `items`), and **`forget_move` teaches any Pokémon any move in the game with zero validation**. Of the famous Gen 1 bugs-as-features, the Ghost→Psychic immunity, permanent freeze, base-Speed crits, and wasted wake-turn are in; the 1/256 miss, Focus Energy inversion, badge-boost stacking, Hyper Beam recharge quirks, and Toxic/Leech Seed counter are not.

---

## 2. What genuinely matches Gen 1 (do not re-litigate)

- **Type chart** — exact Gen 1 matrix including Ghost→Psychic = 0× (the famous bug kept as feature), Bug↔Poison = 2× both ways, Ice→Fire neutral, Bite/Gust Normal-type, no Dark/Steel ([Bulbapedia: Type chart, Gen I](https://bulbapedia.bulbagarden.net/wiki/Type/Type_chart)).
- **All 151 species** with base stats, growth rates, catch rates, and base EXP yields spot-checked accurate (Chansey Atk 5, Mewtwo Spc 154, legendary birds catch rate 3, etc.). Single unified **Special** stat — correct for Gen 1.
- **Core damage formula shape**: `floor(floor(floor(2L/5+2)·A·P/D/50)+2)·STAB·eff·rand`, random factor 217–255/255 (#3 fixed correctly), STAB 1.5, crits computed from **base** Speed with ×8 high-crit moves (#55 fixed), crits ignore stat stages and burn ([Bulbapedia: Damage](https://bulbapedia.bulbagarden.net/wiki/Damage)).
- **Status basics**: burn/poison 1/16 max HP per tick, paralysis 25% full-para, freeze never thaws naturally + fire-move thaw (#57), sleep counter with the authentic wasted wake-up turn, sleep/para/frz mutually exclusive primary status ([Bulbapedia: Status condition](https://bulbapedia.bulbagarden.net/wiki/Status_condition)).
- **Stat stages** ±6 with the correct 25%→400% multiplier table; crits bypass stages.
- **EXP**: `b×L/7`, ×1.5 for trainer battles, exact four Gen 1 growth-rate formulas (fast 4n³/5, medium-fast n³, medium-slow 6n³/5−15n²+100n−140, slow 5n³/4) ([Bulbapedia: Experience](https://bulbapedia.bulbagarden.net/wiki/Experience)).
- **Move data** (power/acc/PP/type) is Gen-1-faithful where audited: Vine Whip 35 BP/10 PP, Supersonic 55, Sing 55, Hypnosis 60, Fissure 30, etc. TM01–TM50/HM01–05 → correct moves.
- **Trainer content that exists is right**: Viridian Forest's 3 Bug Catchers (Weedle 6/Caterpie 6; Weedle-Kakuna-Weedle 7; Weedle 9) and payouts 60/70/90 = 10×level; Brock Geodude 12/Onix 14, payout 1386 = 99×14, verbatim dialogue ([Bulbapedia: Prize money](https://bulbapedia.bulbagarden.net/wiki/Prize_money)).
- **Rules**: no fleeing/no ball throws in trainer battles, Whirlwind ends wild battles only, speed-tie coin flip, Quick Attack +1 priority, blackout respawns at last Center with full heal, TMs single-use / HMs reusable, stones ₽2100, starter at Lv 5, start money ₽3000, Struggle 50%-of-damage recoil, PP per move with Struggle fallback, switch costs the turn.
- Route 1 wild table 50/50 Pidgey/Rattata Lv 2–5/2–4 matches ([Bulbapedia: Route 1](https://bulbapedia.bulbagarden.net/wiki/Kanto_Route_1)); Route 1 mart clerk handing a free Potion is an authentic Gen 1 touch.

## 2b. Verification of already-tracked issues

#1, #3, #54, #55, #56, #57 are closed and their fixes are live in `engine.js` — confirmed accurate as described (with two caveats folded into the catalog: the #54 fix implements Gen II/III shake semantics rather than Gen I's, and the #1 fix skips accuracy checks entirely for 100-accuracy moves). #59's world list (interiors, sight-lines, ledges, ground items, field-move consumers, Surf, rival, missing routes, flat 20% rate, static NPCs) is all confirmed accurate — with one worse-than-reported detail: the Route 1 ledge branch in `buildRoute1()` is dead code (the path condition matches cols 7–12 first), so **no ledge tile is ever emitted anywhere**. Items below marked *[#59]* / *[#28]* are tracked; everything else is new.

---

## 3. Gap catalog

### A. Battle mechanics

| # | What Gen 1 does | What this code does | Impact |
|---|---|---|---|
| A1 | **Catch algorithm** (Gen I): roll N in 0–255 (Poké), 0–200 (Great), 0–150 (Ultra/Safari); auto-catch if N<25 (slp/frz) or N<12 (par/brn/psn); else fail if N>catchRate; else HP factor f=⌊M·255·4/(H·Ball)⌋ with Ball=8 (Great) or 12; catch if f≥roll(0–255). Wobble count is a deterministic approximation from d=⌊rate·100/Ball⌋ ([Bulbapedia: Catch rate](https://bulbapedia.bulbagarden.net/wiki/Catch_rate)). | Gen III formula `(3M−2H)·rate·ballMult/3M` with ballMult 1.5/2, additive status bonus +10/+5, and Gen II-style 4 probabilistic shake checks against a 65536/(255/f)^0.25 threshold (`attemptCatch`, engine.js:432). Practical divergences: status never auto-catches; Great Ball strictly worse than Ultra (in Gen I it beats Ultra whenever N-range matters); wobbles are random not informative. | SIG |
| A2 | **No DVs (IVs)**: each stat gets a hidden 0–15 DV, HP DV derived from the other four's LSBs — `stat=⌊((Base+DV)·2+⌊√STATEXP/4⌋)·L/100⌋+5` ([Bulbapedia: Stat](https://bulbapedia.bulbagarden.net/wiki/Stat)). | `makePokemon` uses Base only — every member of a species at a level is stat-identical. | SIG |
| A3 | **No stat experience (EVs)**: every defeated Pokémon grants stat exp equal to its base stats to all participants; vitamins add 2560; enters stats via the √/4 term (up to +63/stat). | Entirely absent — no accrual, no vitamins, no stat growth beyond level. | SIG |
| A4 | **1/256 miss**: every accuracy check uses strict `<`, so even 100%-accuracy moves miss 1/256 ([Bulbapedia: List of battle glitches in Gen I](https://bulbapedia.bulbagarden.net/wiki/List_of_battle_glitches_in_Generation_I)). Also acc/eva stages apply to *all* moves. | Accuracy check is skipped entirely when `acc ≥ 100` (engine.js:1202) — 100-acc moves can never miss AND are immune to accuracy/evasion stages. | SIG |
| A5 | **Evasion stages** are a real stat stage; Double Team/Minimize raise the *user's evasion*. | `statStages` has no `eva` key and nothing ever sets one (the accuracy formula reads a permanently-zero `eva`). Double Team raises the user's *accuracy* (helps you hit!); Minimize lowers the *enemy's* accuracy. Wrong stat, wrong target. | SIG |
| A6 | **Speed stages and paralysis affect turn order and escape**: paralysis cuts Speed to 25%; Agility/String Shot/Bubble modify effective Speed. | Turn order compares raw `spd`; damage/escape never read `statStages.spd`; paralysis has no Speed effect. **Every Speed-modifying move in the game is a complete no-op**, and Agility does nothing. | GD |
| A7 | **Crit damage** doubles the *level term*: `(2·L·2/5+2)` — slightly under ×2 at low levels, sequential integer truncation throughout ([Bulbapedia: Damage](https://bulbapedia.bulbagarden.net/wiki/Damage)). Also: computed damage of 0 displays "missed". | Flat ×2 multiplier applied with float math and a single floor; damage floored at 1 (never 0/miss). | FLV |
| A8 | **Partial trapping** (Wrap/Bind/Fire Spin/Clamp): duration 2/3/4/5 turns at 37.5/37.5/12.5/12.5%; *each turn repeats the initial hit's damage*; the **user is locked in** and auto-attacks (no move selection); target can't act the whole time; on target switch the user auto-Wraps the incoming Pokémon (extra PP, possible PP rollover to 63); can trap Ghosts damagelessly ([Bulbapedia: Wrap](https://bulbapedia.bulbagarden.net/wiki/Wrap_(move))). | Target is trapped (#56 fix) for a uniform 2–4 turns and takes **1/16 max HP** chip per turn instead of repeated hit damage; the *user* acts freely with any move; no switch interaction (switching isn't even possible for the bound side to test); no Ghost rule. | SIG |
| A9 | **Escape formula**: auto-escape if player Speed ≥ wild Speed or ⌊SpdWild/4⌋ mod 256 = 0; else odds = ⌊SpdPlayer·32/(⌊SpdWild/4⌋)⌋+30·attempts vs 0–255, attempts counter grows ([Bulbapedia: Escape](https://bulbapedia.bulbagarden.net/wiki/Escape)). | `(spd·32/enemySpd)+30` vs roll(256) — divisor not quartered, no auto-success when faster, no attempt counter. Fleeing is ~4× harder than Gen 1 and a faster Pokémon can still fail. | SIG |
| A10 | **Trainer AI**: dumb layered-modifier AI (essentially random move choice with class-specific biases, e.g. avoids status-on-statused for "good AI" classes); wild Pokémon pick uniformly at random. Trainers never account for exact KO ranges. | Custom scoring AI: power × effectiveness × STAB, ×2 if it KOs, 70% pick-best — applied to *wild Pokémon too*. Substantially smarter than Gen 1 in both cases; not parity in either direction. | SIG |
| A11 | **Flinch** cannot carry across turns (volatile cleared at turn end). | `flinched` set by a second-moving attacker persists into the *next* turn and cancels the victim's next move (engine.js:322 clears only when consumed). | FLV |
| A12 | **Toxic**: badly-poisoned N/16 escalating damage with a counter; cured/downgraded per Gen 1 rules; counter also inflates Leech Seed (glitch). | `status='toxic'` is set with a message and then **nothing ever references it again** — no damage at all, no cure item recognizes it. Toxic is strictly worse than doing nothing. | SIG |
| A13 | **Leech Seed**: volatile — stacks *on top of* a primary status; drains 1/16 to the *seeder's side*, healing it. | Stored in the primary `status` slot (mutually exclusive with poison/burn/sleep), deals 1/16 self-damage, **heals nobody**. | SIG |
| A14 | **Volatile state resets when battle ends**: stat stages, confusion, Bide, trapping all clear. | Party Pokémon carry `statStages`, `confused`, `bideState`, `boundState` out of battle and into the next one; only a Center visit or blackout clears them. Six Swords Dances persist forever. | SIG |
| A15 | **Confusion**: 2–5 turns; self-hit is a typeless 40-BP physical using own Atk/Def *with* modifiers (burn and enemy Reflect apply) ([Bulbapedia: Confusion](https://bulbapedia.bulbagarden.net/wiki/Confusion_(status_condition))). | 3–5 turns (`2+roll(3)`); self-hit ignores stat stages and burn by explicit comment. | FLV |
| A16 | Sleep lasts 1–7 turns. | `1+roll(6)` = 2–7 turns; a 1-turn nap is impossible. | FLV |
| A17 | **Shift/Set**: after KOing a trainer's Pokémon the player is told what's next and offered a free switch (Shift default). | Next enemy is sent out with no announcement-and-switch window; player switch always costs a turn. | FLV |
| A18 | Enemy HP shown as a bar only; exact values hidden. | `getView` exposes exact enemy HP numbers (and remaining trainer party count — the latter matches Gen 1's ball icons). | FLV |
| A19 | Some Gen 1 quirks around Substitute/Counter/invulnerability define high-level play (see section H). | Not applicable because the moves themselves are no-ops — see C-section. | — |
| A20 | Badge boosts: Boulder=Atk, Thunder=Def, Soul=Spd, Volcano=Special, all ×1.125 ([Bulbapedia: Badge](https://bulbapedia.bulbagarden.net/wiki/Badge)). | Boulder ×1.125 Atk implemented (#12); the other three boosts don't exist (their badges don't either — see E1); the boost correctly applies only to the player. | FLV (within current scope) |

### B. Pokémon data & stats system

| # | What Gen 1 does | What this code does | Impact |
|---|---|---|---|
| B1 | **Wild/trainer movesets** = the most recent four level-up moves *at that level* ([Bulbapedia: Wild Pokémon](https://bulbapedia.bulbagarden.net/wiki/Wild_Pok%C3%A9mon)). | Every instance gets a fixed 4-move list from `base.moves` regardless of level — a Lv 2 Pidgey knows Quick Attack (Lv 12 move); Brock's Lv 12 Geodude knows **Magnitude, a Gen 2 move** (also wrong: real Brock Geodude has Tackle/Defense Curl). Brock's Onix hand-set correctly. | SIG |
| B2 | Learnsets exact per Bulbapedia. | Data drift throughout: e.g. Geodude's whole learnset shifted one slot early (Rock Throw @11 vs real Defense Curl @11/Rock Throw @16); Magnemite has a duplicate Thunder Shock @21 where Sonic Boom belongs; Jynx duplicate Lick @23; Venusaur reuses Ivysaur's levels. Spot-check ≈1 in 4 species has at least one wrong entry. | SIG |
| B3 | **Trade evolutions**: Kadabra/Machoke/Graveler/Haunter evolve on link trade. | `trade:true` flagged in data but there is no trading — Alakazam, Machamp, Golem, Gengar are unobtainable, period. | SIG |
| B4 | Evolution happens **after** the battle ends, and can be cancelled with B. | Evolves instantly mid-battle inside `tryLevelUp` (stats change mid-fight); no cancel mechanism. | FLV |
| B5 | Learning a 5th move opens a replace-forget dialog; missed moves relearnable only via... nothing (authentic), but the choice is offered at learn time. | Move is silently skipped with a message; no way to accept it at that moment. Combined with C7 this is moot but the authentic flow is absent. | FLV |
| B6 | Nicknames at catch; original-trainer/ID data. | None. | FLV |
| B7 | Encounter species availability spans the whole region; all 151 obtainable across two versions + events. | Encounter tables exist for exactly `route_1`, `viridian_forest`, and `route_2_north` — and **`route_2_north` is not an area**, so it's dead data. ~9 species are wild-obtainable; +3 starters; everything else is data-only. | GD *(with #59/#28 world truncation)* |
| B8 | Viridian Forest table is version-asymmetric (Red: Caterpie-heavy, Weedle rare; Blue mirrored); Pikachu 5%. | Symmetric 35/35 Caterpie/Weedle + 10/10 cocoons, Pikachu 2% — matches neither version; the in-file comment claims "Red version". Separately, `areas.js` ROUTE_1 has its own `encounters` block (55/45) that is dead code diverging from the live table (50/50 — the live one is correct). | FLV |
| B9 | Wild encounter species/level rolls must come from the game's RNG. | `rollEncounter` uses raw `Math.random()`, bypassing the seeded mulberry32 — **breaks the engine's own #33 determinism/replay guarantee** for every encounter. | SIG (engine-correctness) |
| B10 | Moon Stone is find-only (Mt. Moon, etc.), never sold. | Celadon mart sells Moon Stone ₽2100. | FLV |

### C. Moves & effects (data flags with no engine handler = the move silently does ~nothing)

`engine.js` implements exactly these effect keys: `status`+`chance`, `stat`/`stages`/`statChance`, `priority`, `crit_rate`, `bind`, `always_hit`, plus name-checks for `whirlwind`, `bide`, `struggle`. **Every other flag in moves.js is inert.** Verified by grep: no handler for `drain, ohko, fixed_damage, level_damage, half_hp, heal, rest, metronome, mirror, transform, haze, mist, reflect, counter, disable, sharpen, flee` (except the Whirlwind name-check).

| # | What Gen 1 does | What this code does | Impact |
|---|---|---|---|
| C1 | **Fixed-damage moves**: Sonic Boom 20, Dragon Rage 40, Seismic Toss/Night Shade = level, Psywave = random 1–1.5×level, Super Fang = ½ current HP. | All flagged (`fixed_damage`/`level_damage`/`half_hp`) but unhandled → they run the normal formula with power 1 and deal ~1 HP. | SIG |
| C2 | **OHKO moves** (Horn Drill/Guillotine/Fissure): 30% acc, KO on hit, auto-fail vs faster targets. | `ohko` unhandled → ~1 damage on hit. | SIG |
| C3 | **Explosion/Self-Destruct**: user faints; target Defense halved in the calc (effective 500/400 BP). | No self-KO, no defense-halving — a free 250/200 BP nuke with zero cost, and the AI's scoring loves it. | GD |
| C4 | **Recoil moves** (Take Down, Double-Edge, Submission): 25% of damage dealt as recoil; Jump Kick/HJK crash damage on miss. | No recoil, no crash. | SIG |
| C5 | **Drain moves** (Absorb, Mega Drain, Leech Life, Dream Eater): heal 50% of damage; Dream Eater only works on sleeping targets. | `drain` unhandled → no healing; Dream Eater hits *awake* targets at full 100 BP. Leech Life doesn't even carry the flag. | SIG |
| C6 | **Healing/Rest**: Recover/Soft-Boiled restore ½ max HP; Rest = full heal + 2-turn sleep. | `heal`/`rest` unhandled → all three do literally nothing. | SIG |
| C7 | **Signature/utility moves**: Counter (2× last physical Normal/Fighting damage, −1 priority), Disable, Substitute, Transform, Metronome, Mirror Move, Mimic, Haze, Mist, Light Screen, Reflect (halve Special/physical damage), Focus Energy, Conversion, Rage. | All no-ops. **Ditto and (partly) Mew are non-functional** — Transform does nothing, so Ditto's only move does nothing. Light Screen's data even reuses the `reflect` flag; both are dead. | SIG |
| C8 | **Two-turn moves**: Solar Beam/Skull Bash/Sky Attack/Razor Wind charge a turn; Fly/Dig grant semi-invulnerability. | All fire instantly with no charge or invulnerable turn (Razor Wind absent entirely). Solar Beam is a free 120 BP/turn. | SIG |
| C9 | **Hyper Beam**: recharge turn after use — skipped if it KOs/misses (famous Gen 1 quirk). | No recharge at all — 150 BP every turn. | SIG |
| C10 | **Multi-hit moves** (Double Slap, Comet Punch, Fury Attack/Swipes, Pin Missile, Barrage, Spike Cannon: 2–5 hits at 37.5/37.5/12.5/12.5%; Double Kick/Bonemerang/Twineedle: exactly 2). | Single hit at listed per-hit power — these moves deal ⅕–½ of intended damage (15 BP Fury Attack is garbage). | SIG |
| C11 | **Thrash/Petal Dance**: lock in 3–4 turns then self-confuse. | Plain one-turn attacks. | FLV |
| C12 | **Roar/Teleport** end wild battles (like Whirlwind). | Data has `flee:"wild"` but only the literal name `whirlwind` is checked in `doAttack` — Roar and Teleport are no-ops. | FLV |
| C13 | **Bide**: charges 2–3 turns, releases 2× damage taken, typeless, ignores accuracy. | Implemented (#22) but charges 1–2 turns; release targeting/type fine for scope. | FLV |
| C14 | **Category by type** (Gen 1 has no per-move category): Normal/Fighting/Flying/Ground/Rock/Bug/Ghost/Poison = physical; Water/Grass/Fire/Ice/Electric/Psychic/Dragon = special. | Per-move `cat` field with ~13 violations: Gust, Swift, Tri Attack, Hyper Beam, Sonic Boom marked special (Normal ⇒ physical); Fire/Ice/Thunder Punch, Waterfall, Crabhammer marked physical (⇒ special — Hitmonchan's punches infamously run off its Spc 35, here they use Atk 105); Acid, Sludge, Smog marked special (Poison ⇒ physical); Night Shade special (Ghost ⇒ physical). | SIG |
| C15 | 165 moves exist. | 162 in data; **missing: Razor Wind, Mimic, Dizzy Punch** (TM02/TM31 reference them and break on use); **3 anachronistic extras: Magnitude (Gen 2), Whirlpool (Gen 2), Rock Tomb (Gen 3)** — and Magnitude/Rock Tomb are in live default movesets (Geodude line). | SIG |
| C16 | Supersonic: 55% accuracy, then confuses. | 55 acc **and** `chance: 55` — double-gated to ~30% net. | FLV |
| C17 | Pay Day scatters money collected after battle. | Plain 40 BP attack. | FLV |
| C18 | Struggle is Normal-type (Rock resists, Ghost immune). | Typeless raw formula, ignores type chart. | FLV |
| C19 | PP Ups raise max PP (and enable the Wrap PP-rollover quirk). | No PP Up item; max PP fixed. | FLV |

### D. Progression & story

| # | What Gen 1 does | What this code does | Impact |
|---|---|---|---|
| D1 | **8 badges, Elite Four, Champion**: Brock→Misty→Lt. Surge→Erika→Koga→Sabrina→Blaine→Giovanni, Victory Road, Lorelei/Bruno/Agatha/Lance + rival Champion. | One badge (Brock). Nothing exists past Pewter's north wall. *[#28 tracks badge 2]* | GD |
| D2 | **Rival**: named at start, battles at Oak's Lab, Route 22 (×2), Cerulean, S.S. Anne, Pokémon Tower, Silph Co., Route 22 redux, Champion — with an evolving starter-countering team. | No rival anywhere. *[#59]* | GD |
| D3 | **Team Rocket arc**: Mt. Moon, Cerulean thefts, Game Corner/Rocket Hideout (Silph Scope), Pokémon Tower (Marowak ghost, Poké Flute), Silph Co. takeover, Giovanni ×3. | Absent. | GD |
| D4 | **Opening sequence**: Oak's grass ambush → lab → starter choice with rival counter-pick → Route 1 → **Oak's Parcel** fetch-quest → **Pokédex grant** → Route 22 rival fight. | Spawn in Pallet at an outdoor "table", pick starter from a menu. No parcel, no Pokédex, no lab interior, no rival pick. | SIG |
| D5 | **Progression gates**: old man blocks Route 2 until Parcel; Cut trees gate Route 9/Gym; Snorlax ×2 (Poké Flute); Saffron guards (drinks); Silph Scope for Tower; badge checks at League gates; Cinnabar Mansion Secret Key; boulders/Strength; Seafoam currents. | The only gate mechanism is trainer-blocks-path. Nothing else exists. | GD (rolled into D1 scope) |
| D6 | Brock's victory speech includes **TM34 (Bide)** and he actually hands it over. | Dialogue promises TM34; no `{give:...}` line exists — **the TM is never granted**. | SIG |
| D7 | Museum back room: Old Amber → Aerodactyl revival; fossils at Mt. Moon → Omanyte/Kabuto revival at Cinnabar Lab ([Bulbapedia: Pewter City](https://bulbapedia.bulbagarden.net/wiki/Pewter_City)). | Museum is a façade (warp dest `pewter_museum` doesn't resolve); no fossils; Omanyte/Kabuto/Aerodactyl unobtainable. | SIG |
| D8 | Legendary encounters: Articuno (Seafoam), Zapdos (Power Plant), Moltres (Victory Road), Mewtwo (Cerulean Cave, post-E4). | Data-only; no locations, no encounters. | SIG (subset of D1) |
| D9 | Traded-Pokémon obedience tied to badges. | No trading, so moot — but no obedience system either. | FLV |

### E. World & overworld

| # | What Gen 1 does | What this code does | Impact |
|---|---|---|---|
| E1 | **Full Kanto**: 10 towns/cities, 25 routes, Viridian Forest, Mt. Moon, Rock Tunnel, Power Plant, Diglett's Cave, Pokémon Tower, Safari Zone, Seafoam Islands, Pokémon Mansion, Victory Road, Cerulean Cave, S.S. Anne, Silph Co., dozens of interiors per city. | 5 exterior areas: Pallet, Route 1, Viridian, Viridian Forest, Pewter. **No interior rooms at all** — Centers/Marts are doorstep effects, gyms are open-air. *[#59]* | GD |
| E2 | **Route 2** sits between Viridian and Pewter with gates and Diglett's Cave exits; Viridian Forest is *inside* Route 2. | Viridian City connects **directly** to Viridian Forest, which connects **directly** to Pewter — Route 2 does not exist (its ghost lives on as the dead `route_2_north` encounter table). | SIG |
| E3 | **Trainer line-of-sight**: trainers spot you crossing their sight-line, `!`, walk up, forced battle. The core route mechanic. | Bump-to-fight only; every trainer is sneakable. *[#59]* | GD |
| E4 | **Ledges**: one-way south jumps; Route 1's defining feature ([Bulbapedia: Route 1](https://bulbapedia.bulbagarden.net/wiki/Kanto_Route_1)). | `LEDGE_S` tile defined, non-walkable, no jump logic — and the Route 1 generator's ledge branch is **unreachable dead code**, so zero ledge tiles exist. *[#59, worse than reported]* | SIG |
| E5 | **Ground items + hidden items** everywhere (Potions, TMs, Rare Candies, Nugget; Itemfinder for hidden). | None. *[#59]* | SIG |
| E6 | **Field moves**: Cut (trees), Surf (water travel + water encounters), Strength (boulders), Flash (dark caves), Dig/Escape Rope (dungeon exit), Fly (fast travel), Teleport (to last Center). Badge-gated ([Bulbapedia: Badge](https://bulbapedia.bulbagarden.net/wiki/Badge)). | Zero field-move consumers; water is scenery; HMs are unobtainable anyway (no NPC gives them). *[#59]* | GD |
| E7 | **Encounter rate**: per-map rate byte vs rand(0–255) per step — grass 15–25 (≈6–10%), caves 10–15, water 5 ([Bulbapedia: Wild Pokémon](https://bulbapedia.bulbagarden.net/wiki/Wild_Pok%C3%A9mon)). | Flat `roll(100) <= 20` — 20% everywhere, 2–3× Gen 1's hottest grass. *[#59]* | SIG |
| E8 | **Fishing**: Old/Good/Super Rod give water encounter tables anywhere there's water. | Absent. | SIG |
| E9 | NPCs wander; spinner trainers rotate; the world moves. | All NPCs are statues. *[#59]* | FLV |
| E10 | Facing direction; interactions target the faced tile; signs read when faced. | No facing; `talk` scans all four neighbors; signs also trigger by bumping. | FLV |
| E11 | Bicycle (+Bike Voucher), running mechanics (none in Gen 1 — walking only) — bike doubles speed, required nowhere but Cycling Road. | No bike, no Cycling Road. | FLV |
| E12 | Wild Pokémon data per area is version-specific (Red vs Blue exclusives: Ekans/Oddish/Mankey/Growlithe/Scyther/Electabuzz vs Sandshrew/Bellsprout/Vulpix/Meowth/Pinsir/Magmar). | Single hybrid version; exclusives concept absent (moot until more areas exist). | FLV |

### F. Items & economy

| # | What Gen 1 does | What this code does | Impact |
|---|---|---|---|
| F1 | ~80-item roster: Potion line incl. **Hyper Potion/Max Potion/Full Restore**; **Revive/Max Revive**; Burn Heal/Ice Heal/Awakening; **Ether/Max Ether/Elixir/Max Elixir** (PP restore); Repel/Super/Max Repel; Escape Rope; **Rare Candy**; HP Up/Protein/Iron/Carbos/Calcium; X Attack/X Defense/X Speed/X Special/X Accuracy/Guard Spec./Dire Hit; Poké Doll; Fresh Water/Soda Pop/Lemonade; Nugget; Safari Balls; fishing rods; **Exp. All**; key items (Town Map, Oak's Parcel, Bicycle+Voucher, S.S. Ticket, Silph Scope, Poké Flute, Card Key, Lift Key, Secret Key, Gold Teeth, Dome/Helix Fossil, Old Amber, Coin Case, Itemfinder). | 13 usable items: 4 balls, 2 potions, antidote, parlyz heal, full heal, 5 stones (+TMs). **No PP restoration exists** (PP only returns at a Center), **no Revive** (fainted = Center trip), no repels, no X-items, no key items. | GD (aggregate) |
| F2 | Balls thrown in battle come from the same inventory you buy into. | **Mart purchases add balls to `player.bag`; `throw_ball` decrements `player.items`** — the two are never synced, so bought balls are unusable. Once the starting 5 Poké Balls are gone, catching is over forever. | GD (bug) |
| F3 | Mart inventories per city ([Bulbapedia: Viridian City](https://bulbapedia.bulbagarden.net/wiki/Viridian_City), [Pewter City](https://bulbapedia.bulbagarden.net/wiki/Pewter_City), [Celadon Dept. Store](https://bulbapedia.bulbagarden.net/wiki/Celadon_Department_Store)): Viridian = Poké Ball 200/Antidote 100/Parlyz Heal 200/Burn Heal 250 (Potion is Yellow-only); Pewter = Poké Ball/Potion/Escape Rope 550/Antidote/Burn Heal/Awakening/Parlyz Heal; Celadon = 6 floors (2F items+TMs 32/33/02/07/37/01/05/09/17, 4F stones+Poké Doll, 5F vitamins+X-items, roof vending machines with drink→TM13/48/49 trades). Viridian mart gated on Oak's Parcel. | 3 flat catalogs; Viridian adds Potion, Pewter invents Great Ball/Super Potion; "Celadon" (a city that doesn't exist in the world) sells an invented list — TM15/24/25/26/29/38/08/48 (none sold there in Gen 1, made-up prices) plus Moon Stone (never sold). No Oak's Parcel gate. | SIG |
| F4 | Marts **buy items back at half price**. | No sell action. | SIG |
| F5 | Blackout costs **half money on hand** ([Bulbapedia: Black out](https://bulbapedia.bulbagarden.net/wiki/Black_out)). | Flat ₽50. | SIG |
| F6 | TM distribution: gym leaders each award a TM (TM34 Brock, TM11 Misty, …), field pickups, gift NPCs (TM42 Viridian sleeping man), Game Corner prizes, roof trades. | Only source is the (nonexistent-city) Celadon mart; Brock's TM34 broken (D6); price-0 TMs/HMs are unobtainable by design. | SIG |
| F7 | Prize money = base × level of trainer's **last** Pokémon. | Formula not implemented (flat `reward` per trainer) but the hand-set values match — except Jr. Trainer♂ 231 vs correct 20×11=220. | FLV |
| F8 | Money capped at 999,999. | No cap. | FLV |

### G. Systems (Pokédex, PC, trading, Safari, etc.)

| # | What Gen 1 does | What this code does | Impact |
|---|---|---|---|
| G1 | **Pokédex device**: seen/caught tracking, per-species entries (height/weight/flavor), Oak's evaluation, given after the Parcel quest — the game's titular goal. | Does not exist in any form. | SIG |
| G2 | **Trading / Cable Club** (Center 2F): link trades, trade evolutions, in-game NPC trades (e.g. Jynx↔Poliwhirl in Cerulean), traded ×1.5 EXP, version exclusives. | Absent. Consequence: Alakazam/Machamp/Golem/Gengar plus one-per-save choices (starters, Eeveelutions, fossils, Hitmons) make a full 151 impossible even in principle. | SIG |
| G3 | **Bill's PC**: 12 boxes × 20, **manual box switching** (catching with a full box fails!), deposit/withdraw/release; player's item PC; Oak's PC; **accessible only at Center/lab PCs**. | Single flat 240-slot list, auto-overflow on catch, no release, no item storage — and `pc_view`/`pc_withdraw`/`pc_deposit` work **anywhere in the overworld**, including mid-route. (Code comment even mis-states Gen 1 as "8 boxes × 30".) | SIG |
| G4 | **Safari Zone**: ₽500 entry, 30 Safari Balls, 500-step limit, 4 zones; no battling — bait/rock manipulate catch-vs-flee (angry/eating states); exclusives (Chansey, Tauros, Kangaskhan, Scyther/Pinsir, Dratini); contains Gold Teeth + **HM03 Surf** ([Bulbapedia: Safari Zone](https://bulbapedia.bulbagarden.net/wiki/Safari_Zone)). | Absent — which also means Surf's canonical source doesn't exist. | SIG |
| G5 | **Celadon Game Corner**: slots, Coin Case, coin buying, prize Pokémon (Porygon!, Abra, Clefairy, Scyther/Pinsir, Dratini) and TM prizes; hides the Rocket Hideout switch. | Absent; Porygon has no obtainment path at all. | SIG |
| G6 | **Day-Care** (Route 5): deposit one Pokémon, gains 1 EXP/step, fee 100+100/level. | Absent. | FLV |
| G7 | Name Rater (Lavender). | Absent (no nicknames anyway). | FLV |
| G8 | **Exp. All**: party-wide EXP with Gen 1's buggy halving; EXP split `s` divisor among participants ([Bulbapedia: Experience](https://bulbapedia.bulbagarden.net/wiki/Experience)). | All EXP goes to whichever Pokémon is active at the KO; participation isn't tracked; no Exp. All. | SIG |
| G9 | Options: Set/Shift, text speed, animations. | N/A (API game) — noted for completeness. | FLV |
| G10 | Fly/Teleport/Escape Rope as overworld transport. | No fast travel of any kind. | SIG (dup of E6 scope) |
| G11 | Legitimate move-teaching limited to level-up + TM/HM compat. | **`forget_move` accepts any move name in MOVES for any party Pokémon with no learnset/TM validation** — an agent can give Magikarp Explosion + Psychic + Recover in three actions. Blows a hole through the entire progression economy. | GD (bug/exploit) |

### H. Authentic Gen 1 bugs-as-features (deliberate jank that defines RBY)

Implemented and correct: Ghost→Psychic immunity, permanent freeze, base-Speed crit rate (incl. ×8 high-crit), crits ignoring stages/burn, wasted wake-up turn, Amnesia effectively boosting both Special roles (inherent to the single Spc stat).

| # | The authentic bug | Status here | Impact |
|---|---|---|---|
| H1 | **1/256 miss** — strict `<` makes every move miss ≥1/256 ([battle glitches list](https://bulbapedia.bulbagarden.net/wiki/List_of_battle_glitches_in_Generation_I)). | Absent (100-acc moves literally cannot miss — see A4). | SIG |
| H2 | **Focus Energy glitch** — crit rate *quartered* instead of ×4. | Absent in both directions: the move is a no-op (dead `sharpen` flag). | FLV |
| H3 | **Badge-boost stacking** — the ×1.125 re-applies on every stat-stage change, stackable to 999. | Absent (boost is computed fresh per hit, never stacked). | FLV |
| H4 | **Hyper Beam recharge skip** on KO/miss; freeze-during-recharge softlock. | Absent (no recharge exists at all — C9). | FLV |
| H5 | **Toxic counter** feeding Leech Seed (and persisting for burn/poison residuals). | Absent (Toxic itself is dead — A12). | FLV |
| H6 | **Recover/Softboiled fail** when HP deficit ≡ 255 (mod 256). | Absent (healing moves dead — C6). | FLV |
| H7 | **Counter quirks** (countering non-Normal/Fighting under conditions; desyncs). | Absent (Counter dead — C7). | FLV |
| H8 | **Substitute self-damage redirection** (confusion/crash damage hits the opponent's Sub). | Absent (Substitute dead). | FLV |
| H9 | **Fly/Dig invulnerability glitch** (paralysis/confusion interrupt leaves permanent invulnerability). | Absent (no invulnerable state — C8). | FLV |
| H10 | **Partial-trap + sleep lock**, Wrap-vs-switch auto-attack, Wrap PP rollover to 63. | Absent (trapping model differs — A8). | FLV |
| H11 | **Transform PP/DV quirks** (and Ditto catch DV manipulation). | Absent (Transform dead). | FLV |
| H12 | Overworld glitches (Missingno/old man, Glitch City, Mew truck folklore). | Absent; arguably out of scope for a faithful *engine* — listed for completeness only, not counted. | — |

---

## 4. Count summary

| Category | GD | SIG | FLV | Total |
|---|---|---|---|---|
| A. Battle mechanics | 1 | 9 | 8 | 18 |
| B. Pokémon data & stats | 1 | 4 | 5 | 10 |
| C. Moves & effects | 1 | 9 | 7 | 17 |
| D. Progression & story | 4 | 4 | 1 | 9 |
| E. World & overworld | 3 | 4 | 4 | 11 |
| F. Items & economy | 2 | 4 | 2 | 8 |
| G. Systems | 1 | 7 | 3 | 11 |
| H. Bugs-as-features | 0 | 1 | 10 | 11 |
| **Total** | **13** | **42** | **40** | **95** |

*(H12 and A19 uncounted; overlaps like E6/G10 counted once each in their own rows as scoped.)*

## 5. Research coverage notes (honesty section)

- Gen 1 **trainer AI modifier layers** (the three AI routines and which classes use them) were characterized from general knowledge, not re-verified line-by-line against the disassembly this session; the direction of the gap (engine AI is smarter than Gen 1) is not in doubt.
- **Viridian Forest per-version slot percentages** were not pinned to exact numbers; flagged as drift without fake precision (B8).
- Safari Zone **bait/rock probability tables** (angry/eating counters) were not fetched in detail — the system is absent wholesale, so per-state numbers don't change the verdict (G4).
- Learnset audit (B2) is a ~15-species spot check, not a 151×full-table diff; the cited examples (Geodude, Magnemite, Jynx, Venusaur) are verified.
