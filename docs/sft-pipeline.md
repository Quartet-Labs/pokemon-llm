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
python3 scripts/harvest-emulator.py --base http://127.0.0.1:3100
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
