# FROZEN SPEC — Badge 2 arc (#28). Both A/B arms receive exactly this text.

Implement the badge-2 world expansion in this repository, working only on the
current branch, committing as you go. Content per Gen 1 Red (Bulbapedia is
the source of truth for encounter tables, trainer parties, and dialogue).

## Areas (new, with two-way connections wired)

1. **Route 2** — proper south segment between Viridian City and the Viridian
   Forest entrance (the current direct viridian→forest connection is
   replaced), and north segment between forest exit and Pewter City.
   Encounters: Pidgey, Rattata, Caterpie, Weedle (Red rates).
2. **Route 3** — east of Pewter. Encounters: Pidgey, Spearow, Jigglypuff.
   3 trainer NPCs (Bulbapedia Route 3 trainer classes/parties, Red).
3. **Mt. Moon** — 2 floors (1F and B2F, connected by ladders). Encounters:
   Zubat, Geodude, Paras, Clefairy (Red rates per floor). 3 trainer NPCs
   including at least one Team Rocket Grunt. (No fossils — out of scope.)
4. **Route 4** — Mt. Moon exit down to Cerulean. Encounters: Rattata,
   Spearow, Ekans (Red).
5. **Cerulean City** — Pokémon Center (heal + sets lastCenter), Poké Mart
   (tier-appropriate stock via the existing mart machinery), signs.
6. **Cerulean Gym** — Jr. Trainer♀ (Bulbapedia party) then MISTY: Staryu
   L18, Starmie L21. Victory: ₽2079, **Cascade Badge**, verbatim Gen 1
   dialogue. Any species/moves these require that are missing from the data
   files must be added with Bulbapedia-accurate stats.

## Rules

- Use the machinery that already exists (areas.js patterns, encounter
  tables, trainerBattle NPCs, warps, mart tiers). The engine should need few
  or no changes — this is a content expansion.
- All data Bulbapedia Gen 1 Red accurate: base stats, movesets at level,
  encounter slots, trainer payouts.
- Two-way travel must work: Pallet → Cerulean and back without softlocks.

## Definition of done (hard gate)

Ship `scripts/playthrough-badge2.js`: seeded (`newGame(12345)`), drives the
game ONLY through public `processAction` calls (no state surgery), from
fresh start to **badges === 2** (Boulder then Cascade), printing each
milestone. It must pass when run with `node scripts/playthrough-badge2.js`.
Healing items / Centers / catching extra party members are allowed — play
however a real agent could. Also run `node --check` on every file you touch
and make sure the server still boots.

When done: commit everything on the current branch with a summary of what
was added. Do NOT push. Do NOT touch server.js, public/, or docs/.
