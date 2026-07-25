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

# 2. record a scripted real-game run
python3 scripts/harvest-emulator.py --base http://127.0.0.1:3100 \
    --script scripts/routes/opening.json
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
That is a wiring check, not data. `scripts/routes/opening.json` is the real one.

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
`battle_ready`, `dialogue`, `pos` (`COND_KEYS` in `harvest-emulator.py`).

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

### Known blocker: `battle_move` cannot reach the move list

`scripts/routes/opening.json` walks the whole opening and reaches the rival
battle, but produces **no battle rows**, because `emulator/actions.py`
`_battle_move` fails every call once a battle is under way. Found while
harvesting; reproduces on a clean run.

`_battle_move` assumes it starts on the battle main menu and nothing ever
restores that assumption. Anything that mashes A — a model clearing the battle
intro text, or the harvest's own `until battle_ready` step — lands on FIGHT and
opens the move list. `_menu_select` then drives the move list's cursor while
believing it is on FIGHT/PKMN/ITEM/RUN, oscillates between two slots
(`cursor_path: [1,2,1,2,...]`, `max_item: 3`) and gives up. Every later call
repeats it, so **the agent can never deliberately attack again for the rest of
the battle** — the failure is permanent, not transient.

It is worse than it looks from the HP bar. Damage does still land, because the A
press intended to select FIGHT falls through onto whichever move the cursor
happens to be on — so the battle progresses while **`move_index` is silently
ignored**. A green-looking battle is not evidence this works.

Fixing it needs a reliable "which menu is open" discriminator. `wMaxMenuItem` is
not one: it reads 3 for the battle main menu *and* for the move list of a
four-move battler, and it still read 3 immediately after a successful-looking
FIGHT selection. A back-out-with-B-first patch was tried and reverted — it made
damage land more often without ever making `move_index` honoured, which is a
more dangerous failure than the loud one.

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
