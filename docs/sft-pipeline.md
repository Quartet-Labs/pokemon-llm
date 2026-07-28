# SFT data pipeline — playthroughs → training rows

Turns deterministic playthroughs into supervised imitation data:
`(prompt, target-action)` pairs in the **exact shape the live model sees**, so a
small model can be QLoRA fine-tuned to play competently before any RL.

## Two sources, because there are two runners

`build_sft.py --source` picks the stack. This is not a convenience flag — the two
runners share no SYSTEM prompt, tool schema, action enum, or history render, so
building with the wrong one trains the model on a grammar it will never be asked
to speak.

| | `--source emulator` (default) | `--source oracle` |
|---|---|---|
| Stack | PyBoy / real Pokémon Blue — **live** | Boxed JS engine — legacy |
| Prompt from | `emulator/runner.py` | `scripts/ollama-runner.py` |
| Harvest with | `scripts/harvest-emulator.py` | `scripts/harvest-oracle.js` |
| History window | 8, feedback line only | 10, `did <action> -> <msg>` |
| Blocked steps | dropped as rows, **kept in history** | dropped entirely |

The emulator path is P6 of `docs/emulator-rewrite-plan.md`. The oracle path stays
because the plan boxes the JS engine rather than deleting it — but note its
committed `data/trajectories/sft.jsonl` is stale: `ollama-runner.py` has changed
since it was generated, so those rows no longer match that runner's prompt.

### Why blocked steps stay in history (emulator only)

`emulator/runner.py` appends **every** executed sub-step to `history[]`, blocked
ones included — `"south: BLOCKED (wall or facing)"` is deliberate anti-wall-bump
signal the model sees at inference. The row itself is still dropped from training
(imitating a wall-bump teaches wall-bumping), but it must remain in the *next*
prompt's "Recent actions" block or the training prompt silently disagrees with
the live one.

### No transcribed prompts

`emulator/runner.py` exposes `build_user_prompt(view, history)` and calls it from
its own main loop; `build_sft.py` **calls that same function**. There is no second
copy of the prompt template to drift. Do not inline it back into the loop.

## Emulator quickstart

```
# 1. serve the emulator (Pi)
PYTHONPATH=. python3 emulator/server.py            # PORT=3100 by default

# 2. record a scripted real-game run. --script is repeatable and the routes are
#    concatenated in order, so a leg that continues where another ends is a
#    second file rather than a copy of the first.
python3 scripts/harvest-emulator.py --base http://127.0.0.1:3100 \
    --script scripts/routes/opening.json \
    --script scripts/routes/route1-viridian.json
#    -> data/trajectories/<sessionId>.jsonl

# 3. build training rows
python3 scripts/build_sft.py --source emulator \
    --in data/trajectories/<sessionId>.jsonl --out data/trajectories/sft.jsonl
```

`harvest-emulator.py` swaps only the brain: it drives a scripted action list
through the *same* `steps` walk, `_feedback`, `RewardTracker` and
`TrajectoryLogger` the live runner uses, so its rows are indistinguishable from a
real model run's. Hand-authored routes rotted on the JS engine because the engine
kept changing; a route against a fixed ROM and a fixed savestate cannot.

With no `--script` the harvest runs an 8-row smoke route around the bedroom.
That is a wiring check, not data. The real routes are:

| Route | Covers | Shape of the rows |
|---|---|---|
| `routes/opening.json` | Red's bedroom → the rival battle | cutscene-heavy: ~7 A-presses per move |
| `routes/route1-viridian.json` | Oak's lab → Route 1 → Viridian Centre heal | almost all walking, plus the wild encounters Route 1 rolls |

They are meant to be run together, in that order. The second exists for action
balance: on the opening alone the set is `a`×126 / `move`×36, because the stretch
before the Pokédex is mostly text, and a model trained on that learns to press A.

## Routes

A route is a JSON list of steps. Raw actions still work, but a route of any
length cannot be written as raw actions, because the emulator reports a 10x9
**viewport**, not a map: a destination eight tiles away is not visible when the
route is authored. So three step kinds name an intent and resolve it live.

| Step | Does |
|---|---|
| `{"type": "a"}` | one action, as before |
| `[{...}, {...}]` | one queued `submit_actions` batch, as before |
| `{"goto": {"x": 6, "y": 2}}` | walk there, re-planning every leg |
| `{"exit_map": 37}` / `{"exit": "oak"}` | walk to the exit leading to that map |
| `{"press": A, "until": C, "max": N}` | repeat A until the world satisfies C |
| `{"_": "..."}` | comment (JSON has none) |

`until` conditions are ANDed, and an unknown key raises rather than passing —
a condition that can never be true otherwise looks exactly like one that is
always true. The vocabulary is `area`, `screen`, `in_battle`, `has_party`,
`battle_ready`, `dialogue`, `pos`, `party_healthy` (`COND_KEYS` in
`harvest-emulator.py`).

`party_healthy` is the gate for a Pokémon Centre heal, and it is the same
argument as the rest: the nurse's greeting, HEAL/CANCEL prompt and machine
animation measured 13 A-presses, nothing fixes that number, and there is no
"the nurse is finished" flag — the restored HP is the only fact the world
exposes. It is false on an empty party on purpose: `all()` over nothing is
true, which would fire the gate on the first press and skip the heal, and in
Red's bedroom it would fire before a starter existed.

`press`/`until` exists because **cutscene lengths are not constants**. Oak's
speech plus the walk to his lab measured 37 A-presses on one run; any text-speed
or routing difference moves it. A route that hard-codes the count desynchronises
silently and every waypoint after it is wrong.
`{"press": {"type":"a"}, "until": {"area": 40}}` cannot.

`press` also takes a *list*, run one action per batch — that is how the starter
is picked up: `[move east, a]` repeated until `has_party`. During the cutscene
the move is a no-op and the A advances text; once Red is free the move turns him
to face the ball table and the A takes the ball. One step, no counting.

Cycling beats sequencing wherever "the cutscene is over" has no observable. The
walk out of the lab is `[a, move south]` until `in_battle`: the A carries the
nickname prompt and the rival's speech, the south does nothing until Red is
free and then walks him into the rival's challenge.

> **Do not gate on `{"dialogue": false}` to mean "the scene ended."** It is true
> for a frame *between* two text boxes. Used as the gate for leaving Oak's lab
> it fired mid-nickname-screen; the walk-out was then spent against a menu and
> the run mashed A at the ball table for its remaining 60 cycles instead of ever
> reaching the battle. Gate on a world fact — `area`, `has_party`, `in_battle`.

### Navigation (`scripts/navigate.py`)

`goto`/`exit` plan against whatever the server currently reports: BFS the
visible window for the goal; if it is not visible, walk to the visible cell that
gets closest and look again. Two things the window gets wrong, both found by
running it:

- **Blank is not "off map."** The far rows of the window decode as black padding
  while the room continues underneath — standing at (3,3) in Red's house, y=5
  and y=6 render blank and are walkable. Treating blank as wall deadlocks one
  tile short of the front door, so blank is *unknown* and the emulator rules on
  it.
- **The sprite overlay misses NPCs.** Oak and the rival stand on cells the map
  renders as plain floor, so BFS routes straight through a body. Every refused
  move is fed back into a blocked-cell set, which is what stops the planner
  re-deriving the same illegal step — before that it burned ten identical
  wall-bumps against Oak's lab door. The harvest also gives up on a waypoint
  after two legs that move Red nowhere, and says so.

Stalling on a waypoint is often the *correct* outcome and the route says so
where it is expected: Oak intercepts before the Route 1 mouth, and the rival
blocks the lab door to start his battle. Both are triggers, not failures.

Three more things the multi-map legs forced, all of them silent while every
route stayed inside one building:

- **Refused cells are keyed by map.** `(x,y)` is a per-map coordinate and Pallet
  Town and Route 1 overlap almost completely, so a fence learned in one used to
  be believed in the other — the planner then routes around open grass and
  reports nothing, because a phantom wall is indistinguishable from terrain.
- **`goto` fights any battle it finds itself in.** Grass is walkable on purpose
  (the encounters are the battle rows the set is short of), but until an
  encounter is answered the player cannot move, so `goto` saw the position
  unchanged, counted a stall and abandoned the waypoint after two. That made
  every step through grass a coin flip and ruled out Route 1 and everything past
  it. Encounters are now fought out — `a` until `battle_ready`, `move_index` 0
  until the battle ends, then the EXP text — and the legs and stalls they consume
  are refunded, since an iteration spent in a battle reveals nothing about
  reachability and the budget for crossing Route 1 should not be set by how many
  Rattata showed up.
- **A movement block is walkable on its bottom-left tile, not on all four**
  (fixed 2026-07-26). `classify_block` asked whether all four 8x8 tiles of a
  16x16 block were in the tileset collision list. The engine never does that: a
  Gen-1 step resolves against the single tile under the sprite's feet — the
  block's bottom-left — and the other three are free to be decoration. The
  Pokémon Centre floor is the block `[0x01, 0x11, 0x0b, 0x1b]` and only the
  bottom-left `0x11` is listed, so the whole floor decoded as `#`, which
  `navigate.py` treats as a *definite* obstacle: BFS found no route and `goto`
  refused to move anywhere indoors. Red's house and Oak's lab floor every block
  with four copies of `0x01`, which is the only reason the opening route never
  hit it. Measured on a walk of the Viridian Centre against `player_walkable()`
  (which presses the d-pad, so it is ground truth): all-four agreed on 58% of
  neighbours and invented **110 false walls**; bottom-left agrees on 94% with
  **13**. `goto` now plans inside the building — to the counter, to the exit and
  around a corner — where before it returned no route to any target. The Viridian
  leg still walks blind north and gates on `pos`; that workaround is now belt and
  braces rather than the only option.

Two more, forced by the 2026-07-26 overnight re-harvest, which desynchronised
on Route 1 and then kept recording for 100+ turns:

- **A desynchronised route aborts the run** (`RouteDesync`, exit 2). A stalled
  or unroutable `goto` and an expired `until` cap used to print and *continue*;
  every step after one is a scripted player flailing against a world the script
  no longer describes. The 7/26 run stalled in the ledge pocket at (15,14),
  fell through six more steps, hopped one-way ledges into a corner and rammed
  a wall inside a battle screen for 30 cycles — 87 of its 433 rows were
  blocked/rejected, and `build_sft.py` would have eaten all of them. The
  trajectory still gets its summary row on abort, but the nonzero exit makes
  the failure a retry instead of a training set.
- **Overworld-gated `press` steps fight encounters out too.** `goto` already
  did; a `press`/`until` step interrupted by a wild battle just kept ramming
  its scripted key into the battle screen. A step whose `until` uses only
  overworld facts (`area`, `pos`, `party_healthy`, `has_party`) now resolves
  the encounter exactly as `goto` does, and the iteration is refunded. Steps
  gated on battle state (`battle_ready`, `in_battle`, `screen`) are scripting
  a battle — the rival fight — and are left alone.

The Route 1 climb itself is now staged waypoints on cells the successful
7/26 18:32 run walked, rather than one far `goto (10,0)`: aimed past the
viewport the planner wanders hunting a ledge gap it cannot see, and Route 1's
ledges read walkable northbound but only permit south, so a wrong guess is
one-way. The `(14,12)` waypoint *is* the y=14 ledge gap.

Regression tests: `python3 scripts/test_block_walkable.py` — 6 tests pinning the
bottom-left rule against the real Pokémon Centre and bedroom tile values, so a
future "surely it should check more than one tile" cannot quietly re-seal every
interior. `python3 scripts/test_harvest_route.py` — 12 tests over the
`party_healthy` gate, the per-map keying of refused cells, and which `until`
gates may auto-resolve an encounter. These failures are silent: a route that
walks the wrong way and a route that abandons a waypoint each produce a full,
plausible-looking trajectory, and the only signal is in the rows — by which
point `build_sft.py` has already consumed them.

### Battle menus: what the RAM actually does (fixed 2026-07-25)

`battle_move` used to fail every call once a battle was under way, so the opening
route reached the rival fight and produced **no battle rows**. It now wins that
fight in 6 moves and the route yields battle rows. The fix came out of a live RAM
probe (`GET /debug/ram`); every assumption it started from was wrong.

| | battle main menu | FIGHT move list |
|---|---|---|
| `wTopMenuItemY` (0xCC24) | 14 | 12 |
| `wTopMenuItemX` (0xCC25) | 9 (left) / 15 (right) | 5 |
| `wMaxMenuItem` | **1** | **3** (even for a 2-move battler) |
| `wCurrentMenuItem` | row (0–1) | **1-based** move slot |
| `wTextBoxID` while up | 11 | 11 |

1. **The main menu is a 2x2 grid, not a 4-item list.** `wMaxMenuItem` is 1. The
   row is `wCurrentMenuItem`, the column is `wTopMenuItemX`; a slot maps as
   `row = slot // 2, right = slot % 2`. Driving `wCurrentMenuItem` to 3 to reach
   RUN can never work — so `run` and in-battle `use_item` were outright broken,
   and `switch` selected ITEM while asking for PKMN. All three are fixed here.
2. **The move list cursor is 1-based.** Move slot 0 is cursor value 1. Asking for
   0 chased a slot that does not exist, which is what produced the
   `[1,2,1,2,...]` oscillation and made the failure permanent for the battle.
3. **`wMaxMenuItem` is not a move count.** It read 3 for a CHARMANDER that knew
   two moves. Bounds come from the move-id array (`wBattleMonMoves`).
4. **The geometry registers go stale.** `wTopMenuItemY/X` are *not* cleared when
   a menu closes, so during result text they still describe the move list.
   `wTextBoxID` (11 = a battle menu is up and polling the d-pad, 1 = plain text)
   is the liveness half. Identity and liveness are both required.

**Success is verified against PP, not HP.** A falling HP bar proves only that
*some* move fired — a stray A press lands on whichever move the cursor sits on,
which is exactly how `move_index` was ignored while everything looked fine. The
chosen slot's PP dropping by one is the only proof. `battle_move` returns
`move_index_honoured` and `pp_spent_slots`; a status move like GROWL passes with
zero HP change and would fail any HP-based check.

A back-out-with-B-first patch was tried on 7/24 and reverted: it made damage land
more often without ever making `move_index` honoured — a quiet failure in place
of a loud one.

`battle_ready` was wrong too, and was the trigger for all of it. It tested the
**enemy**'s species, which populates during the intro — measured **15 A-presses**
before the menu is drawn on the rival fight. Every one of those presses went into
the cutscene and the last opened FIGHT, which is how `battle_move` came to start
on the wrong menu in the first place. It now requires our own mon to be out *and*
a battle menu to be up (`battle.ready` in `/state`).

Regression tests: `python3 scripts/test_battle_menu.py` — 13 tests over a fake
emulator that models the measured behaviour above, including the stale-register
and 1-based-cursor traps.

### Overworld menus: the same audit, one layer out (fixed 2026-07-25)

The battle findings raised an obvious question — the START menu, the bag and the
party list all still went through `_menu_select`, which assumes a 0-based cursor
and trusts `wMaxMenuItem`, and nobody had measured any of them. So all three were
probed the same way (`scripts/probe_menus.py`, `probe_bag_and_start.py`,
`probe_party_switch.py`). Two were broken; the third was fine.

| | START menu | bag list | party list |
|---|---|---|---|
| `wCurrentMenuItem` | 0-based entry | 0-based **window row**, pins at 2 | 0-based slot |
| `wMaxMenuItem` | **count** | **window height − 1** (2 for 3 items *and* for 8) | count − 1 |
| `wListScrollOffset` | unused | **part of the item index** | always 0 |
| verdict | broken | broken | **correct** |

1. **The START menu is built from progression flags, so it has no fixed
   indices.** Measured on one savestate with the has-Pokédex flag (`wd74b` bit 5)
   flipped:

   | | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
   |---|---|---|---|---|---|---|---|
   | no Pokédex | POKéMON | ITEM | \<NAME\> | SAVE | OPTION | EXIT | — |
   | Pokédex | POKéDEX | POKéMON | ITEM | \<NAME\> | SAVE | OPTION | EXIT |

   The code hardcoded "POKEMON is index 1, ITEM is index 2" — the *Pokédex* row.
   For the whole pre-Pokédex opening, which is exactly the stretch the harvest
   records, `switch` opened the **bag** and `use_item` opened the **trainer
   card**. Both returned `ok: True`. Selection is now by label, read off the
   screen at `wMenuCursorLocation`, so it holds in either layout.
2. **The bag is a scrolling list, so the cursor is not the item.** With 8 items
   the cursor went `0,1,2,2,2,2,2,2` while `wListScrollOffset` went
   `0,0,0,1,2,3,4,5`. The real position is `scroll + cursor`. `_menu_select` bailed
   at *"index 3 exceeds wMaxMenuItem 2"*, so **no item past the third was ever
   reachable**, and `use_item` reported an 8-item bag as holding 3. `_bag_select`
   drives both registers and bounds on `wNumBagItems`.
3. **`wMaxMenuItem` means something different in every menu** — count here,
   count−1 there, a window height in the bag, and pure noise in the battle menus.
   Nothing may treat it as a generic item count.
4. **The party list is correct and was left alone.** 0-based, honest `wMaxMenuItem`,
   never scrolls, verified on 2- and 6-mon parties. Selection is proven against
   the only unforgeable side effect — after switching to slot N,
   `wBattleMonSpecies` **is** mon N — not against the list looking right. The
   feared 1-based cursor does not exist there.

**Ground truth is the drawn label, not a register.** `wMenuCursorLocation` points
at the `wTileMap` cell holding the arrow, so `ram_map.menu_cursor_label()` reads
back the entry the game actually drew. Every index register in this game has now
been caught describing a menu the code merely believed it was looking at.

Regression tests: `python3 scripts/test_overworld_menus.py` — 20 tests, including
both hardcoded-index bugs reproduced against a fake that models the measured
layouts, and the party list pinned as correct so it is not "fixed".

### Debug endpoints

Diagnosing this needed a live battle, and a battle does not survive a server
restart — so the probe has to be reachable on an already-running server:

```
GET  /debug/ram?session=X&addrs=0xCC24&len=8   read WRAM + menu/battle registers
POST /debug/press?session=X&button=down&n=1    one raw button (no `move` macro)
POST /debug/savestate?session=X&name=NAME      snapshot to data/states/NAME.state
POST /debug/loadstate?session=X&name=NAME      restore it
```

`press` exists because the agent vocabulary has no bare d-pad verb: `move` is a
coordinate macro that presses up to six times and reads player x/y, which is
meaningless inside a menu.

Savestates are ROM-derived and gitignored. Regenerate the battle fixture with:

```bash
python3 -m emulator.server &
curl -sX POST localhost:3100/session -H 'content-type: application/json' -d '{"label":"p"}'
python3 scripts/harvest-emulator.py --session p1 --script scripts/routes/opening.json
# then, while the rival battle's main menu is up:
curl -sX POST 'localhost:3100/debug/savestate?session=p1&name=rival-battle-menu'
```

### Yield

Blocked and rejected rows are dropped from training (they are the emulator's
wall-bump signal) but kept in the history window, so a route's usable row count
is lower than its recorded turn count. The deliberate "face the counter" moves
in the starter pickup are recorded as BLOCKED and dropped along with real
wall-bumps — the feedback string cannot tell them apart. Read the harvest's
final `wrote N rows (M blocked/rejected)` line for the split.

Trajectories written before `feedback` logging existed are **rejected** rather
than silently used — without those strings the "Recent actions" block of every
prompt after the first cannot be reconstructed.

## Two stages (oracle path)

### 1. `scripts/harvest-oracle.js` (Node)

Runs an oracle playthrough and records the raw trajectory. It monkeypatches the
engine's `processAction` export **before** requiring the oracle, so every action
the oracle takes flows through a recorder — the oracle's *strategy is never
rewritten*, only instrumented. For each step it snapshots `getView(state)` (the
exact view the live server returns from `GET /state`) **before** the action lands.

Output — one JSON row per step to `data/trajectories/oracle-raw.jsonl`:

```json
{"step": 0, "view": { ...getView() output... }, "action": {"type":"move","direction":"north"},
 "result_message": "Moved north. (5,6) — Oak's Lab", "noop": false}
```

- `view` — raw `getView()` object (full, uncompacted).
- `action` — the engine action the oracle applied this step.
- `result_message` — `state.message` after the action (the runner stores this in
  its `history` window, truncated to 120 chars).
- `noop` — `true` if the action did not change meaningful game state (a blocked
  move, a rejected input). Imitating these teaches the model to walk into walls,
  so `build_sft.py` drops them by default.

If the oracle throws mid-run (e.g. engine drift breaks its hard-coded route), the
partial trajectory harvested up to that point is **kept** and the failure is
reported; the harvest is not lost to an `exit(1)`.

```
node scripts/harvest-oracle.js [--oracle ./playthrough-intro.js] [--out ../data/trajectories/oracle-raw.jsonl]
```

### 2. `scripts/build_sft.py` (Python)

Reads the raw trajectory and emits final SFT rows. It **imports** `SYSTEM`,
`compact_state`, `TOOLS` and `ACTION_KEYS` directly from
`scripts/ollama-runner.py` (the live driver) — there is exactly **one source of
truth** for the model-facing prompt. Nothing about the prompt is reimplemented.

```
python3 scripts/build_sft.py [--in data/trajectories/oracle-raw.jsonl] [--out data/trajectories/sft.jsonl]
                             [--history 10] [--keep-noops] [--no-validate]
```

## Output format

TRL/Unsloth **conversational `messages`** format with a native assistant tool
call, one JSON object per line:

```json
{
  "messages": [
    {"role": "system", "content": "<ollama-runner SYSTEM>"},
    {"role": "user", "content": "Recent actions:\n  ...\n\nCurrent state:\n{...compact_state...}\n\nCall submit_action with your one action for this turn."},
    {"role": "assistant", "content": "",
     "tool_calls": [{"type": "function",
                     "function": {"name": "submit_action",
                                  "arguments": "{\"type\": \"battle_move\", \"move_index\": 0}"}}]}
  ],
  "tools": [ { ...ollama-runner submit_action schema... } ]
}
```

- **system** = the runner's `SYSTEM` constant, verbatim.
- **user** = the runner's exact prompt for that view: the same f-string, the same
  `json.dumps(compact_state(view))`, and a `Recent actions` window rebuilt from
  the oracle's prior forwarded actions + their result messages (`history[-10:]`,
  matching the runner).
- **assistant** = one `submit_action` tool call whose arguments are the oracle's
  action reduced to `ACTION_KEYS` (exactly what the runner forwards to the game
  API and what a valid model tool call carries).
- **tools** = the runner's `TOOLS` schema, so TRL renders the tool definition at
  train time identically to inference.

`SFTTrainer` consumes `messages` via the tokenizer chat template; `tools` is
passed through so the rendered prompt includes the tool schema.

### On-distribution filtering

- **No-ops dropped** by default (`--keep-noops` to retain).
- **Off-grammar actions skipped.** The model's `submit_action` tool enum is
  `move | talk | choose_starter | battle_move | run | throw_ball | use_item |
  switch`. An oracle action like `mart_buy` or `forget_move` can't be emitted as
  a valid tool call, so no training row is written for it — but it still advances
  the reconstructed `history` (in a live run that turn happened and would appear
  in the next "Recent actions"). `advance` is normalized to `talk` (identical
  engine effect; the runner instructs the model to use `talk`).

## Validation — byte-identical prompt (critical)

`build_sft.py` runs an **adversarial** equality check before emitting anything:
it FRESH-imports the runner a second time and rebuilds the reference prompt from
that independent module, then asserts it is byte-identical to what the builder
produces — across a sample spanning every screen type (overworld, dialogue,
battle, starter_select). If either the surrounding template or `compact_state`
drifted, the strings differ and the build fails (`exit 1`). The check has a
verified negative case: perturbing the builder's runner copy is detected.

```
[build_sft] prompt-format equality check: PASS (N views, all screen types)
```

## Oracles

- `scripts/playthrough-intro.js` — short deterministic oracle for the opening
  game: starter select → Oak dialogue → overworld navigation → wild battles
  (run + attack). Reaches the state variety the SFT set needs on the **current**
  engine, driving via `processAction` only. This is the default harvest target.
- `scripts/playthrough-badge2.js` — the full Boulder→Cascade oracle. NOTE: its
  hard-coded route was authored against an earlier engine and no longer traverses
  the current overworld (the Pallet/Oak's-Lab warp layout re-enters the lab on a
  west/north step). Harvest it with `--oracle ./playthrough-badge2.js` once that
  route is repaired; it currently yields a short partial trajectory.

## Reproduce

```
node   scripts/harvest-oracle.js            # -> data/trajectories/oracle-raw.jsonl
python3 scripts/build_sft.py                # -> data/trajectories/sft.jsonl
```

Trajectory/SFT JSONL live under `data/trajectories/` and are gitignored run
artifacts (reproducible from the scripts above), not committed source.

## Eval — adapter vs base on the live runner

`runs/sft-v1` is a PEFT/QLoRA adapter; Ollama can't load it without a
merge-to-GGUF conversion that could silently diverge from what training
produced. `scripts/serve_hf.py` skips the conversion: it loads the exact
training stack (same base, same 4-bit NF4 quant, tokenizer from the adapter
dir, adapter via PEFT) and speaks enough of Ollama's `/api/chat` for
`emulator/runner.py` to drive it unchanged — so the eval loop IS the live loop.

On the desktop (training venv), one shim per arm:

```
.venv\Scripts\python scripts\serve_hf.py --port 11435                       # base
.venv\Scripts\python scripts\serve_hf.py --port 11436 --adapter runs/sft-v1 # SFT
```

Then run episodes against each (note `--no-think-prefix`: the SFT rows carry
the runner's raw user prompt, so the qwen3 `/no_think` prefix would be
off-distribution):

```
python -m emulator.runner --ollama http://localhost:11435 --model hf-base \
    --no-think-prefix --use-benchmark --max-turns 300
python -m emulator.runner --ollama http://localhost:11436 --model hf-sft \
    --no-think-prefix --use-benchmark --max-turns 300
```

Each episode writes a trajectory JSONL; compare arms with:

```
python3 scripts/eval_compare.py base=data/trajectories/<b1>.jsonl \
    base=data/trajectories/<b2>.jsonl sft=data/trajectories/<s1>.jsonl ...
```

which reports per-arm episodes, mean/median reward, turns, distinct areas,
badges and goal-reached rate. Episodes that crashed before their summary row
are reconstructed from turn rows and flagged, not dropped.
