#!/usr/bin/env python3
"""build_sft.py — turn a harvested oracle trajectory into supervised fine-tuning rows.

Input:  a raw trajectory JSONL from scripts/harvest-oracle.js, one row per step:
          {"step", "view", "action", "result_message", "noop"}
        where `view` is the exact getView() object the live model would see and
        `action` is the engine action the oracle took.

Output: SFT chat rows, one JSON object per line, in the TRL/Unsloth "messages"
        conversational format WITH a native assistant tool call:
          {"messages": [
             {"role": "system",    "content": <runner SYSTEM>},
             {"role": "user",      "content": <runner-format prompt for this view>},
             {"role": "assistant", "content": "",
              "tool_calls": [{"type": "function",
                              "function": {"name": "submit_action",
                                           "arguments": "<json action args>"}}]}
           ],
           "tools": [<runner submit_action tool schema>]}

        This mirrors the live runner exactly: the model is shown the SYSTEM
        prompt + the compact-state user prompt and must answer with ONE
        `submit_action` tool call whose arguments are the forwarded action. The
        `tools` field is included so TRL's chat template renders the tool schema
        identically to inference (Unsloth/TRL `SFTTrainer` consumes `messages`
        and applies the tokenizer chat template; `tools` is passed through).

THE PROMPT IS NOT REIMPLEMENTED HERE. We import SYSTEM, compact_state, TOOLS and
ACTION_KEYS straight from the live runner module so there is exactly one source
of truth for what the model sees. If the runner's prompt changes, this script
tracks it automatically.

TWO SOURCES (`--source`), because there are two runners with DIFFERENT prompts:

  emulator (default) — the live stack. Prompt symbols come from
    `emulator/runner.py` (PyBoy / real Pokémon Blue). Input is a trajectory
    JSONL written by that runner's own TrajectoryLogger, so the training data is
    a recording of real play — no hand-authored oracle route to rot. This is P6
    of docs/emulator-rewrite-plan.md.

  oracle — the boxed JS engine. Prompt symbols come from
    `scripts/ollama-runner.py`; input is a harvest from scripts/harvest-oracle.js.
    Kept because the rewrite plan boxes the JS engine rather than deleting it.

The two runners do not share a SYSTEM prompt, a tool schema, an action enum, or
even a "Recent actions" render — `emulator/runner.py` shows the feedback line
alone over an 8-turn window, `ollama-runner.py` shows "did <action> -> <msg>"
over 10. Mixing them would train the wrong grammar, so the source selects the
prompt builder, the reference builder, and the reader together.

On-distribution filtering:
  - `--drop-noops` (default ON): skip rows the harvester flagged as no-ops
    (blocked moves, rejected inputs) — imitating them teaches the model to walk
    into walls.
  - Actions outside the model's tool grammar are skipped and counted. The runner
    forwards only ACTION_KEYS and only the tool enum's action `type`s
    (move/talk/choose_starter/battle_move/run/throw_ball/use_item/switch). An
    oracle action like `mart_buy` or `forget_move` cannot be emitted by the model
    as a valid submit_action call, so training on it would be off-distribution.
    `advance` is normalized to `talk` (the engine treats them identically and the
    runner instructs the model to use `talk`).

Usage:
  python3 scripts/build_sft.py \
      --source emulator \
      --in data/trajectories/<session>.jsonl \
      --out data/trajectories/sft.jsonl \
      [--history N] [--keep-noops] [--no-validate]
"""
import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# Where each source's live runner lives, and the history window it renders.
# `window` mirrors the slice in that runner's own main loop — emulator/runner.py
# uses history[-8:], ollama-runner.py uses history[-10:].
SOURCE_RUNNER = {
    "emulator": {"path": os.path.join(REPO, "emulator", "runner.py"),
                 "module": "emu_runner", "window": 8},
    "oracle":   {"path": os.path.join(HERE, "ollama-runner.py"),
                 "module": "ollama_runner", "window": 10},
}

# Cross-check for the oracle path: the action `type`s the model's submit_action
# tool can emit. Derived from TOOLS at runtime (see model_action_types) — this
# literal is retained only to assert the derivation still agrees with the set
# this script originally hardcoded.
MODEL_ACTION_TYPES = {
    "move", "talk", "choose_starter", "battle_move",
    "run", "throw_ball", "use_item", "switch",
}


def load_runner(source):
    """Import a runner as a module (hyphenated filenames -> importlib)."""
    spec_info = SOURCE_RUNNER[source]
    spec = importlib.util.spec_from_file_location(spec_info["module"],
                                                  spec_info["path"])
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # __main__ guard means main() does NOT run
    return mod


def model_action_types(runner):
    """The action `type`s the model can actually emit, read off the runner's OWN
    submit_action tool enum. Anything outside it is not reproducible as a valid
    tool call, so we don't train on it. Deriving this (instead of hardcoding)
    keeps the grammar filter on the same single source of truth as the prompt."""
    for tool in runner.TOOLS:
        fn = tool.get("function") or {}
        if fn.get("name") == "submit_action":
            return set(fn["parameters"]["properties"]["type"]["enum"])
    raise RuntimeError("runner exposes no submit_action tool")


def forward_action(action, action_keys, source):
    """Reduce an engine action to what the runner forwards to the game API and
    what the model's tool call would carry: keys in ACTION_KEYS with non-None
    values. On the oracle path `advance` is normalized to `talk` (identical
    engine effect; that runner's tool grammar only offers `talk`). The emulator
    has no `advance` type, and its trajectory actions are already `_clean_action`
    output, so no normalization applies there."""
    a = dict(action)
    if source == "oracle" and a.get("type") == "advance":
        a["type"] = "talk"
    return {k: v for k, v in a.items() if k in action_keys and v is not None}


def build_user_prompt(runner, view, history, source):
    """Reconstruct the EXACT user string the runner builds for a given view and
    history window — the same f-string, the same json.dumps(compact_state(view)),
    the same history render as that runner's main loop.

    history is a list of (forwarded_action_dict, feedback_str) in order."""
    if source == "emulator":
        # CALL the runner's own builder — no transcription, so no drift is
        # possible between training prompts and inference prompts.
        return runner.build_user_prompt(view, history)
    window = history[-SOURCE_RUNNER[source]["window"]:]
    hist_txt = "\n".join(
        f"  {i+1}. did {json.dumps(h[0])} -> {h[1]}" for i, h in enumerate(window)
    ) or "  (none yet)"
    return (f"Recent actions:\n{hist_txt}\n\n"
            f"Current state:\n{json.dumps(runner.compact_state(view))}\n\n"
            f"Call submit_action with your one action for this turn.")


def read_rows(infile, source):
    """Load the input trajectory and normalize it to the shape the emitter walks:
    {"view", "action", "result_message", "noop"}.

    oracle   — harvest-oracle.js rows already carry exactly those fields.
    emulator — TrajectoryLogger rows: keep kind=="turn", map state->view and
               feedback->result_message. A row is a no-op when the macro was
               BLOCKED by a wall or rejected outright; those are the emulator's
               equivalent of a blocked oracle move and teaching them teaches the
               model to bump into walls."""
    with open(infile) as f:
        raw = [json.loads(line) for line in f if line.strip()]

    if source == "oracle":
        return raw

    rows = []
    missing_feedback = 0
    for r in raw:
        if r.get("kind") != "turn":
            continue  # meta / summary rows
        fb = r.get("feedback")
        if fb is None:
            missing_feedback += 1
            fb = ""
        rows.append({
            "view": r.get("state") or {},
            "action": r.get("action") or {},
            "result_message": fb,
            "noop": (": BLOCKED" in fb) or (": rejected" in fb),
        })
    if missing_feedback:
        # Pre-`feedback` trajectories cannot rebuild the "Recent actions" block,
        # so every prompt after the first would be wrong. Refuse rather than
        # silently emit corrupt training data.
        raise SystemExit(
            f"[build_sft] {missing_feedback}/{len(rows)} emulator rows have no "
            f"`feedback` field — this trajectory predates feedback logging and "
            f"cannot be replayed into prompts. Re-record with the current "
            f"emulator/runner.py."
        )
    return rows


def make_sft_row(runner, system, user, forwarded_action):
    """One conversational SFT example with a native assistant tool call."""
    return {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "type": "function",
                    "function": {
                        "name": "submit_action",
                        # Arguments serialized as a JSON string, matching how
                        # Ollama/OpenAI-style tool calls carry arguments.
                        "arguments": json.dumps(forwarded_action),
                    },
                }],
            },
        ],
        "tools": runner.TOOLS,
    }


def _runner_reference_prompt(reference_runner, view, history, source):
    """Assemble the user prompt the runner would send, using an INDEPENDENTLY
    imported runner module (a separate object from the one build_user_prompt
    uses). This makes the equality check adversarial: if build_sft's copy of the
    runner drifts from a fresh load of the runner source — in the template OR in
    compact_state — the two prompts differ and the check fails. Each branch is a
    literal transcription of that runner's main() prompt block."""
    if source == "emulator":
        return reference_runner.build_user_prompt(view, history)
    window = history[-10:]
    hist_txt = "\n".join(
        f"  {i+1}. did {json.dumps(h[0])} -> {h[1]}" for i, h in enumerate(window)
    ) or "  (none yet)"
    return (f"Recent actions:\n{hist_txt}\n\n"
            f"Current state:\n{json.dumps(reference_runner.compact_state(view))}\n\n"
            f"Call submit_action with your one action for this turn.")


def validate_prompt_equality(runner, rows, source):
    """CRITICAL CHECK: prove the user prompt we build is byte-identical to what
    the live runner itself would produce for the same view + history.

    Adversarial design: we FRESH-import the runner a second time
    (reference_runner) and build the reference prompt from that independent
    module. build_user_prompt uses the `runner` module build_sft already loaded.
    If either the surrounding template or compact_state diverges between the two,
    the strings differ and we FAIL. (In normal operation both come from the same
    runner source, so they match — but the check would catch a hand-edited copy
    of the prompt logic in build_sft.)

    Returns (ok, checked, first_failure_or_None)."""
    reference_runner = load_runner(source)  # independent import — separate module obj
    assert reference_runner is not runner, "reference import must be a distinct module"
    checked = 0
    # Pick views spanning every screen type we harvested so the check exercises
    # overworld, dialogue, battle and starter formatting, not just one shape.
    by_screen = {}
    for r in rows:
        scr = (r.get("view") or {}).get("screen", "?")
        by_screen.setdefault(scr, []).append(r)
    sample = []
    for scr, rs in by_screen.items():
        sample.extend(rs[:5])  # up to 5 per screen type

    for r in sample:
        view = r["view"]
        # Fabricate a small, representative history window for this sample so the
        # "Recent actions" block is non-trivial in the check too.
        history = [
            ({"type": "move", "direction": "north"}, "Moved north."),
            ({"type": "talk"}, "..."),
        ]
        # (a) Reference prompt from an INDEPENDENTLY imported runner module.
        runner_user = _runner_reference_prompt(reference_runner, view, history, source)
        # (b) What our builder produces (uses the runner module build_sft loaded).
        ours = build_user_prompt(runner, view, history, source)
        checked += 1
        if ours != runner_user:
            return (False, checked, {"screen": view.get("screen"),
                                     "ours": ours, "runner": runner_user})
    return (True, checked, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=sorted(SOURCE_RUNNER), default="emulator",
                    help="Which runner/stack the data is for. emulator (default) "
                         "= live PyBoy stack, input is an emulator trajectory "
                         "JSONL. oracle = boxed JS engine, input is a "
                         "harvest-oracle.js file.")
    ap.add_argument("--in", dest="infile", default=None,
                    help="Input JSONL (default depends on --source).")
    ap.add_argument("--out", dest="outfile",
                    default=os.path.join(REPO, "data", "trajectories", "sft.jsonl"))
    ap.add_argument("--history", type=int, default=None,
                    help="Max recent actions to include (default: the source "
                         "runner's own window — emulator 8, oracle 10).")
    ap.add_argument("--keep-noops", action="store_true",
                    help="Include rows flagged as no-ops (default: drop).")
    ap.add_argument("--no-validate", action="store_true",
                    help="Skip the prompt-format equality check.")
    args = ap.parse_args()

    source = args.source
    # Default the window to whatever that runner actually renders, so the
    # reconstructed prompt matches the live one unless deliberately overridden.
    runner = load_runner(source)
    # Prefer the window the runner itself declares; SOURCE_RUNNER is the fallback
    # for the legacy runner, which has no such constant.
    history_n = args.history if args.history is not None \
        else getattr(runner, "HISTORY_WINDOW", SOURCE_RUNNER[source]["window"])
    system = runner.SYSTEM
    action_keys = runner.ACTION_KEYS
    grammar = model_action_types(runner)
    if source == "oracle":
        assert grammar == MODEL_ACTION_TYPES, (
            f"oracle tool enum drifted from the expected grammar: {grammar}")

    if args.infile:
        infile = os.path.abspath(args.infile)
    elif source == "oracle":
        infile = os.path.join(REPO, "data", "trajectories", "oracle-raw.jsonl")
    else:
        raise SystemExit("[build_sft] --in is required for --source emulator "
                         "(point it at data/trajectories/<session>.jsonl)")
    outfile = os.path.abspath(args.outfile)
    os.makedirs(os.path.dirname(outfile), exist_ok=True)

    raw = read_rows(infile, source)

    # Validate prompt-format equality BEFORE emitting anything.
    if not args.no_validate:
        ok, checked, failure = validate_prompt_equality(runner, raw, source)
        status = "PASS" if ok else "FAIL"
        print(f"[build_sft] prompt-format equality check: {status} "
              f"({checked} views, all screen types)", file=sys.stderr)
        if not ok:
            print("[build_sft] MISMATCH:", file=sys.stderr)
            print("  screen:", failure["screen"], file=sys.stderr)
            print("  ours   :", repr(failure["ours"][:200]), file=sys.stderr)
            print("  runner :", repr(failure["runner"][:200]), file=sys.stderr)
            sys.exit(1)

    # Emit SFT rows. History is chained over the actual submitted-action sequence
    # (matches how the runner's history[] accumulates one entry per real turn).
    history = []
    n_out = 0
    n_noop = 0
    n_off_grammar = 0
    off_types = {}
    fd = open(outfile, "w")
    for r in raw:
        view = r["view"]
        action = r["action"]
        forwarded = forward_action(action, action_keys, source)
        result_msg = r.get("result_message") or ""
        if source == "oracle":
            # ollama-runner.py truncates the stored message to 120 chars before
            # it reaches history[]. emulator/runner.py stores the feedback line
            # whole, so truncating there would corrupt the prompt.
            result_msg = result_msg[:120]

        if r.get("noop") and not args.keep_noops and source == "emulator":
            n_noop += 1
            # EMULATOR: drop the training row (imitating a wall-bump teaches
            # wall-bumping) but STILL chain history. emulator/runner.py appends
            # every executed sub-step to history[], blocked ones included — that
            # "south: BLOCKED (wall)" line is deliberate anti-wall-bump signal the
            # model sees at inference. Skipping it here would make the training
            # prompt's "Recent actions" block disagree with the live one.
            history.append((forwarded, result_msg))
            continue

        if r.get("noop") and not args.keep_noops:
            n_noop += 1
            # ORACLE: a no-op did not advance the live game state, so the runner's history
            # would not gain a meaningful entry either — skip it entirely.
            continue

        atype = forwarded.get("type")
        if atype not in grammar:
            n_off_grammar += 1
            off_types[atype] = off_types.get(atype, 0) + 1
            # Off-grammar action: cannot be a valid submit_action tool call. Skip
            # the training row, but STILL chain history — in a live run this turn
            # happened and would appear in the model's next "Recent actions".
            history.append((forwarded, result_msg))
            continue

        user = build_user_prompt(runner, view, history[-history_n:] if history_n else history,
                                 source)
        row = make_sft_row(runner, system, user, forwarded)
        fd.write(json.dumps(row) + "\n")
        n_out += 1
        history.append((forwarded, result_msg))
    fd.close()

    print(f"[build_sft] source={source} runner={SOURCE_RUNNER[source]['path']}",
          file=sys.stderr)
    print(f"[build_sft] read {len(raw)} raw rows from {infile}", file=sys.stderr)
    print(f"[build_sft] dropped noops: {n_noop}", file=sys.stderr)
    if n_off_grammar:
        print(f"[build_sft] skipped off-grammar actions: {n_off_grammar} {json.dumps(off_types)}",
              file=sys.stderr)
    print(f"[build_sft] wrote {n_out} SFT rows -> {outfile}", file=sys.stderr)


if __name__ == "__main__":
    main()
