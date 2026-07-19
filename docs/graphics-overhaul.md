# Graphics Overhaul — Source, Plan, Technical Approach

Branch: `amos/graphics-overhaul` (stacked on `amos/multiplayer-4p`, whose
parameterized per-cell renderers this replaces). Rendering layer only — zero
server or engine changes.

## Source

**Pokémon battle sprites: the PokeAPI sprite archive**
(github.com/PokeAPI/sprites), specifically the Generation I Red/Blue set:

```
https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/transparent/{id}.png   (enemy, front)
https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/back/{id}.png          (yours, back)
```

- Keyed by National Dex id — which `game/data/pokemon.js` already carries for
  every species, so no new data plumbing.
- These are the actual 1996 Game Boy sprites: correct era, correct silhouette
  language, transparent backgrounds. Both URL families verified live 2026-07-18.
- Loaded lazily at runtime and cached in an in-browser `Image` map; on any
  load failure the renderer falls back to the previous colored-disc look, so
  the game is never sprite-blocked.
- Licensing note: Pokémon sprite art is Nintendo IP; PokeAPI hosts it as the
  de-facto standard source for non-commercial fan projects, which this is.
  If the project ever goes public-commercial, this is the first thing to rip out.

**Overworld tiles, characters, UI chrome: procedurally drawn, no external
assets.** Every tile is authored in code as 16×16 pixel art (see approach
below). No downloads, no binary assets in the repo, no licensing exposure for
the world art, and the palette is ours.

## Plan

1. **Tile atlas** — replace flat `fillRect` tiles with a pre-rendered 16×16
   pixel-art atlas: textured path/town ground, grass with blade tufts, tall
   grass, layered conifer trees, brick wall, animated two-frame water, roofed
   buildings with doors, signposts, ledges, flowers. Drawn once at boot into
   an offscreen canvas, then blitted per frame — cheaper than the current
   per-tile fill + stroke.
2. **Characters** — GB-style pixel person for the player (tinted per couch
   slot: P1 red / P2 blue / P3 green / P4 yellow) and NPCs, with a subtle
   walk bob; replaces the anonymous squares.
3. **Battle scene** — Gen-1 layout with real sprites: enemy front sprite on
   the top-right platform, your back sprite bottom-left, proper name/level/HP
   info boxes with Gen-1 border chrome, trainer banner. Fallback discs if a
   sprite hasn't loaded.
4. **Starter select** — the three starters rendered as their actual sprites
   in the lab screen instead of text.
5. **Animation loop** — a single lightweight 500 ms ticker re-renders visible
   overworld cells for water shimmer + walk bob. No per-frame RAF burn; this
   is a spectator dashboard, not a 60 fps game.

## Technical approach

- All changes live in `public/index.html`'s render layer: `TILE_ART`
  (atlas painter), `SpriteCache` (lazy Image loader keyed by dex id + facing),
  and rewritten `drawOverworld` / `drawBattle` / `drawStarterSelect`.
- The atlas is one offscreen canvas, 16×16 cells indexed by tile name;
  `drawOverworld` computes the visible window exactly as today (camera math
  unchanged) but blits atlas cells via `drawImage`, scaled to the cell's
  tile size with `imageSmoothingEnabled = false` to keep pixels crisp.
- Two-frame tiles (water) occupy two atlas slots; the ticker flips a global
  frame bit and re-renders only cells whose player is in the overworld.
- `SPECIES_ID` map (species key → dex id, ~30 entries duplicated from
  `pokemon.js`) ships client-side so the view API doesn't need to change.
  If the view ever exposes ids, delete the map.
- Sprites draw at 2× native (112–128 px) with nearest-neighbor scaling,
  bottom-anchored to their platforms so differing sprite heights sit right.
- No build step, no new dependencies, no server round-trips beyond the
  cached sprite fetches. Degrades gracefully offline.
