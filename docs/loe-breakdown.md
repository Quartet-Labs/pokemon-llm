# Gen 1 Gap — Level of Effort Breakdown

All open issues from the 2026-07-19 exhaustive audit (#60), bucketed by implementation effort.
Reference the [gap report](./gen1-gap-report.md) for full descriptions.

**Tiers:** XS (<2h) · S (~half day) · M (1–3 days) · L (3–7 days) · XL (1–2 weeks) · Epic (months)

---

## XS — Trivial (data fix or single-line change)

| Code | Issue | Change |
|------|-------|--------|
| A11 | #168 | Clear flinch flag at turn end (currently set by second-mover, persists into next turn) |
| A16 | #172 | Fix sleep duration: `1+roll(6)` → `roll(7)` to allow 1-turn sleep |
| A18 | #174 | Remove exact enemy HP from `getView` output — show bar only |
| B8  | #180 | Fix Viridian Forest encounter table to match Red version (data-only) |
| B10 | #181 | Remove Moon Stone from Celadon mart (find-only item — data fix) |
| C12 | #192 | Extend wild-battle flee check beyond literal `"whirlwind"` to cover Roar/Teleport |
| C13 | #193 | Fix Bide charge duration: `roll(2)` → `2+roll(2)` |
| C16 | #196 | Supersonic: remove the redundant `chance:55` gate (accuracy is sufficient) |
| C17 | #197 | Pay Day: scatter money equal to 2× user level after battle (currently plain attack) |
| C18 | #198 | Struggle: set type to Normal in data (Ghost immune, Rock resists) |
| D6  | #202 | Brock victory dialogue: add `{give: "TM34"}` line — promised but missing |
| F7  | #213 | Prize money: implement `base × level_of_last_pokemon` formula |
| F8  | #212 | Clamp player money to 999,999 |
| G7  | #216 | Name Rater stub (moot without nicknames; trivial placeholder if desired) |

---

## S — Small (~half day, isolated behavior)

| Code | Issue | Change |
|------|-------|--------|
| F2 (bug) | #160 | Unify `player.bag` / `player.items` so bought Poké Balls are throwable |
| C3 (bug) | #162 | Explosion/Self-Destruct: set user HP to 0 and trigger faint flow post-damage |
| B9 (bug) | #163 | Replace `Math.random()` in `rollEncounter` with project seeded RNG (mulberry32) |
| A10 | #167 | Wild AI: use uniform random move selection for wild Pokémon (keep scorer for trainers) |
| A12 | #169 | Toxic: add N/16 escalating damage step to turn processing; current `status='toxic'` is inert |
| C4  | #184 | Recoil: add 25% of damage dealt as self-damage after Take Down/Double-Edge/Submission; crash on Jump Kick miss |
| C9  | #189 | Hyper Beam: add recharge flag — skip next turn unless the hit KOs or misses (Gen 1 quirk) |
| C11 | #191 | Thrash/Petal Dance: lock user in for 3–4 turns, then inflict self-confusion |
| E9  | #207 | NPCs: add random-interval step timer so they wander instead of standing still |
| E12 | #209 | Version exclusives: add version flag to encounter entries (data-only; moot until more areas exist) |
| F4  | #210 | Marts: add sell action returning items at half buy price |

---

## M — Medium (1–3 days, new system component)

| Code | Issue | Change |
|------|-------|--------|
| G11 (bug) | #161 | `forget_move`: validate against learnset + TM compatibility before writing move |
| A3  | #164 | Stat experience: accrue base stats of defeated Pokémon to participants; apply via √/4 term |
| A5  | #165 | Evasion stages: add `eva` key to `statStages`; wire into accuracy formula |
| A6  | #166 | Speed stages + paralysis: wire `statStages.spd` into turn-order comparison and escape calc; paralysis cuts Speed to 25% |
| A13 | #170 | Leech Seed: move to volatile slot; drain 1/16 to seeder's side each turn; fix self-damage |
| A14 | #171 | Clear volatile state (stat stages, confusion, Bide, trapping) on battle end |
| A17 | #173 | Shift/Set: after KOing a trainer's Pokémon, announce next enemy and offer free switch |
| B4  | #176 | Move `tryLevelUp` / evolution trigger to post-battle flow (currently fires mid-battle) |
| B5  | #177 | 5th-move learn: show replace/skip dialog instead of silently discarding |
| B6  | #178 | Nicknames at catch; OT name + ID field on Pokémon data |
| C1  | #182 | Fixed-damage moves: add handler for `fixed_damage` / `level_damage` / `half_hp` flags (Sonic Boom, Dragon Rage, Seismic Toss, Night Shade, Psywave, Super Fang) |
| C2  | #183 | OHKO moves: 30% acc, instant KO on hit, auto-fail if user is slower |
| C5  | #185 | Drain moves: heal attacker by 50% of damage dealt; Dream Eater only on sleeping targets |
| C6  | #186 | Recover/Soft-Boiled: restore ½ max HP; Rest: full heal + set 2-turn sleep |
| C10 | #190 | Multi-hit moves: roll 2–5 hits (37.5/37.5/12.5/12.5%) or exactly 2 for Double Kick/Bonemerang/Twineedle |
| C14 | #194 | Fix ~13 per-move `cat` errors (all should follow Gen 1 type-based category rule, not per-move field) |
| C15 | #195 | Add Razor Wind, Mimic, Dizzy Punch; remove Magnitude/Whirlpool/Rock Tomb from data and any live movesets |
| C19 | #199 | PP Ups: add item; add `maxPp` field to moves; let PP Ups increase it |
| D4  | #200 | Opening sequence: Oak's grass ambush → lab → starter pick with rival counter-pick → parcel fetch → Pokédex grant |
| E10 | #208 | Facing direction: track player facing; target faced tile for interactions; signs only respond when faced |

---

## L — Large (3–7 days, significant feature)

| Code | Issue | Change |
|------|-------|--------|
| —   | #35  | Auth + rate limiting: token-gate `/action` and `/reset`; per-driver identity; action-rate cap |
| C7  | #187 | Implement Counter, Disable, Substitute, Transform, Metronome, Mirror Move, Mimic, Haze, Mist, Light Screen, Reflect, Focus Energy, Conversion, Rage (10+ independent handlers; Ditto becomes functional) |
| C8  | #188 | Two-turn moves: charge turn + invulnerable state for Solar Beam/Skull Bash/Sky Attack/Fly/Dig |
| B7  | #179 | Expand encounter tables: fill dead `route_2_north` and future area tables; ~100+ species need wild paths |
| E2  | #204 | Route 2: add area between Viridian and Forest, restore `route_2_north` encounter table |
| E3  | #205 | Trainer line-of-sight: sight vectors, `!` approach animation, forced battle on crossing |
| E5  | #206 | Ground items + hidden items: place pickups in areas; add Itemfinder mechanic |
| D8  | #203 | Legendary encounters: depends on Seafoam Islands (Articuno), Power Plant (Zapdos), Victory Road (Moltres), Cerulean Cave post-E4 (Mewtwo) — areas must exist first |
| F1  | #211 | Item roster: add ~67 missing items (Revive, PP restore, Repel line, X-items, key items) |
| G1  | #214 | Pokédex: seen/caught tracking, per-species entries (height/weight/flavor), Oak completion evaluation |
| G3  | #215 | PC overhaul: Center/lab-only access; proper 12-box × 20 structure; item storage; manual box switching |

---

## XL — Extra Large (1–2 weeks, major system)

| Code | Issue | Change |
|------|-------|--------|
| D5  | #201 | Progression gates: old man (Route 2), Cut tree tiles, Snorlax × 2 (Poké Flute), Saffron guards, badge level checks at League, Cinnabar Secret Key, boulder/Strength, Seafoam currents |
| D7  | #112 | Museum back room + fossil revival: Pewter Museum interior, Mt. Moon fossil choice, Cinnabar Lab revival for Omanyte/Kabuto/Aerodactyl |
| E8  | #121 | Fishing: Old/Good/Super Rod items; water encounter tables keyed to rod tier; rod NPC locations |
| E11 | #124 | Bicycle + Bike Voucher + Cycling Road area |
| F6  | #129 | TM distribution: gym-leader post-victory awards, field pickup TMs, gift NPCs (Viridian sleeping man, etc.), Game Corner prizes |
| G2  | #133 | Trading/Cable Club: link trade mechanics, trade evolutions, in-game NPC trades, ×1.5 EXP for traded mons |
| G4  | #135 | Safari Zone: ₽500 entry, 30 Safari Balls, 500-step limit, 4 zones, bait/rock catch mechanics, exclusives, Gold Teeth + HM03 |
| G5  | #136 | Game Corner: slot machine, Coin Case, coin purchase, prize Pokémon (Porygon, Abra, Clefairy, etc.) and TM prizes; Rocket Hideout switch |
| G6  | #137 | Day-Care (Route 5): deposit/withdraw, 1 EXP/step accrual, fee = 100 + 100 × levels gained |
| B3  | #175 | Trade evolutions: trigger Alakazam/Machamp/Golem/Gengar evolution on trade (depends on G2) |
| G10 | #217 | Fast travel: Fly (destination map), Teleport (last Center), Escape Rope (dungeon exit) — depends on E6 field moves |

---

## Epic — Content Volume / Game-Wide Systems (months)

| Code | Issue | Change |
|------|-------|--------|
| —   | #28  | Badge 2 arc: Route 2 south, Mt. Moon, Cerulean City, Misty's gym |
| D1  | #107 | Badges 3–8 + Victory Road + Elite Four + Champion: the rest of the game (Surge, Erika, Koga, Sabrina, Blaine, Giovanni, Lorelei, Bruno, Agatha, Lance, rival Champion) |
| D2  | #108 | Rival: 9 scripted battles with evolving starter-counter team across the full game world |
| D3  | #109 | Team Rocket arc: Mt. Moon → Rocket Hideout → Pokémon Tower → Silph Co. → Giovanni × 3 |
| D9  | #113 | Traded-Pokémon obedience by badge count (depends on G2 trading) |
| E1  | #114 | Interior spaces: every building in every city/town (Centers, Marts, gyms, homes, labs, towers, ships) |
| E6  | #119 | Field-move layer: HM consumers throughout the world (Cut trees, Surf water, Strength boulders, Flash dark caves, Dig escape) + badge gating |

---

## Blocked — Gen 1 Bugs-as-Features (H-section)

All H-section items are flavor-tier and blocked pending their underlying gap fix. Once the dependency is resolved, each is XS–S effort.

| Code | Issue | Depends on |
|------|-------|------------|
| H2 | #218 | Focus Energy glitch (crit quartered not ×4) | A6 stat stages |
| H3 | #219 | Badge-boost stacking (×1.125 per stage change) | stat stage system |
| H4 | #220 | Hyper Beam recharge-skip on KO/miss | C9 |
| H5 | #221 | Toxic counter feeding Leech Seed | A12 |
| H6 | #222 | Recover fail (HP deficit ≡ 255 mod 256) | C6 |
| H7 | #223 | Counter quirks | C7 |
| H8 | #224 | Substitute self-damage redirection | C7 |
| H9 | #225 | Fly/Dig invulnerability glitch | C8 |
| H10 | #226 | Partial-trap + sleep lock, Wrap PP rollover | trapping overhaul |
| H11 | #227 | Transform PP/DV quirks | C7 |

---

_Generated 2026-07-19. All issue numbers reference Quartet-Labs/pokemon-llm. Parent tracking issue: #60._
