# Emulator refactor — remaining work

Status after the first goal run: **an agent plays the real Pokémon Blue ROM via the API.** Emulator (PyBoy) + RAM→state adapter + movement/dialogue action macros + FastAPI server (`:3100`) + a live browser viewer at `/` are all merged and running. What's below is what's left to make it a real, trainable, fully-playable environment.

## Done
- ROM sourced + verified; PyBoy headless on the Pi (~1489 fps).
- `emulator/`: `emu.py`, `ram_map.py`, `actions.py`, `server.py`, `make_state.py`.
- API: `/state`, `/action`, `/reset`, `/session(s)`, `/benchmark`, `/screen.png`, `/` (viewer).
- Verified: LLM agent drives movement via the API; player navigates, walls report correctly.
- RAM verified live: map id, x/y, badges bitfield, party count, in-battle, money ($3000).

## Left to do (roughly priority order for the next goal run)

### 1. State completeness (biggest lever — agents are navigating half-blind)
- **Walkable/collision surroundings in `/state`** — expose which of N/S/E/W is walkable (and ideally a local tile grid) from RAM. This is the emulator equivalent of the fog-of-war map; without it agents bump walls by trial and error.
- **Explored ASCII map** — accumulate seen tiles from RAM into a fog-of-war map field (port the concept from the JS engine's `view.map`).
- **Battle state** — enemy species/level/HP, your active mon + moves/PP, so an agent can fight (currently only an `in_battle` flag).
- **Party detail** — verify species/level/HP offsets live (party is empty at the savestate start); add exp, status.
- **Pokédex counts, bag/items, dialogue text** — for the reward's novelty terms and for menu use.

### 2. Action macros (stubbed verbs return `partial:true`)
- `battle_move` (open FIGHT → select move index), `use_item`, `throw_ball`, `switch`, `run` — all require menu navigation macros.
- `choose_starter` / general menu cursor control.
- Robuster movement (handle warps, ledges, spin tiles).

### 3. Reach the overworld
- The savestate starts in the bedroom (map 38). Either extend `make_state.py` to walk out to Route 1 and save a later state, or let the agent walk out (needs #1 to do it reliably).

### 4. Port the training harness to the emulator state shape
- Point `scripts/reward.py` / `trajectory.py` at the emulator `/state`; field names differ (badges is a count not a bitfield in the view, party struct differs), so the reward's field access needs adapting + re-verifying that reward fires on real badges/money/exp.
- Write an emulator-appropriate runner + system prompt (`ollama-runner.py`'s prompt is JS-engine specific — Oak's Lab, choose-starter — and won't match the real game).

### 5. SFT data (the oracle-drift problem is gone)
- Record a real-game playthrough (scripted button macros, or human inputs replayed) → harvest `(state, action)` rows with `build_sft.py`'s formatter. No hand-authored route to rot.

### 6. Durability + viewer polish
- Make the emulator server a managed process (systemd/supervisor) so it survives reboots and unattended goal runs (currently a `nohup`).
- Viewer: action log / recent moves, overlay the agent's chosen action, reward readout.

### 7. Training env on the desktop (unchanged from the original plan)
- Unsloth QLoRA + TRL GRPO on the desktop GPU; GPU-arbitration lock so AC transcription preempts the trainer.

## Suggested next goal
"An agent gets out of the house and into the overworld, with walkable-surroundings + battle state in `/state`" — i.e. finish #1–#3 so the agent can actually make progress and fight, which is the prerequisite for meaningful training.
