# Emulator Rewrite Plan — real ROM via PyBoy, same API

## Decision
Replace the hand-built JS game engine with a **real Pokémon Blue ROM running in PyBoy** (headless Game Boy emulator). Keep the HTTP API contract, the viewer, and the entire training half. Box the JS engine behind a flag — do not delete it.

Why: the JS engine caps at badge 2, someone has to hand-author every map/mechanic, and its own oracle already drifted out of validity (~7k lines of change broke the badge route). The real ROM gives all of Kanto for free, can't drift, and is the substrate the proven community projects (PyBoy; Whidden's PokemonRedExperiments) already use.

**ROM: Blue.** Red and Blue share the identical codebase (the `pokered` disassembly is literally both), so all community RAM maps and reward examples apply unchanged. Only Red-specific reference config (a hardcoded ROM filename) needs a one-line swap.

## Where things run
- **Emulator + FastAPI server + viewer → the Pi** (light CPU, always-on, exactly like today's game server). PyBoy does NOT need the GPU.
- **Model inference + SFT/GRPO training → the desktop GPU.**
- They talk over the same HTTP API, so env and trainer split across machines cleanly — same topology as now (server one place, model another, runner orchestrating).

## What carries over untouched
`scripts/reward.py`, `scripts/trajectory.py`, the runner loop, `scripts/build_sft.py` format logic, and the whole SFT→GRPO training architecture (Unsloth QLoRA + TRL GRPO). They talk HTTP `/state`+`/action` and don't care what's behind them.

## What is new — the two adapters + the server layer
1. **Emulator core** — PyBoy load ROM headless: `reset() / step(button) / screen()`. Solved; thin wrapper.
2. **RAM→state adapter** *(the real work)* — read documented memory addresses into the SAME state shape the current API returns: `screen`, `area`, `player{position, badges, party[], money, pokedex}`, `battle{...}`, `dialogue`. Lift address maps from the `pokered` disassembly + PokemonRedExperiments; do not reinvent. RAM is cleaner ground truth than parsing the JS engine (badges/money/exp are direct reads).
3. **Action macro layer** — translate the existing high-level action vocabulary (`move north`, `talk`, `battle_move 0`, `use_item`, `throw_ball`, `switch`, `choose_starter`) into button-press sequences with frame-stepping and menu navigation. Keeps the LLM's clean semantic interface instead of raw frame-level button mashing.
4. **Python server + viewer** — FastAPI exposing the identical endpoints (`/state`, `/action`, `/session`, `/benchmark`, `/halt`, `/map`, `/map-legend`, `/help`) + WS broadcast; stream the emulator screen. Reuse the existing viewer HTML (ports nearly as-is; now shows the real Game Boy screen, not ASCII). The Node/Express server is retired for play — the JS engine is boxed as a reference/fallback.
5. **Fog-of-war map for the agent** — derive the explored ASCII map from RAM tile data (the map-memory concept ports; the human viewer just shows pixels).

## Phases / sequencing
- **P0 — ROM**: acquire Pokémon Blue, place on the Pi. (In progress — Amos sourcing.)
- **P1 — Emulator core**: PyBoy wrapper on the Pi; boot Blue, step frames, dump a screenshot. Verify.
- **P2 — RAM state adapter**: address map → structured state matching the current view shape. Verify against known values (start position, 0 badges, starter party).
- **P3 — Action macros**: high-level action → button sequence; verify move/talk/battle each change the right RAM.
- **P4 — FastAPI server + viewer**: same endpoints + screen streaming; point the runner at it, confirm a model plays via tool calls.
- **P5 — Port harness**: reward/trajectory against RAM-derived state; verify reward fires on real badges/money/exp.
- **P6 — SFT data**: harvest from a scripted or recorded real-game run (no hand-authored route to rot), then SFT→GRPO per the training plan.

## Open items
- ROM sourcing (Amos).
- Repo layout: same repo (`emulator/` backend + boxed JS engine) vs new repo — lean same-repo to reuse the viewer and history.
- GPU arbitration with AC transcription (unchanged from the earlier plan — shared GPU lock; trainer yields on claim).
