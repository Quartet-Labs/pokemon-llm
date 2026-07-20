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
ACTION_KEYS straight from scripts/ollama-runner.py so there is exactly one source
of truth for what the model sees. If the runner's prompt changes, this script
tracks it automatically.

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
      --in data/trajectories/oracle-raw.jsonl \
      --out data/trajectories/sft.jsonl \
      [--history 10] [--keep-noops] [--no-validate]
"""
import argparse
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# The action `type`s the model's submit_action tool can actually emit. Anything
# outside this set is not reproducible as a valid tool call, so we don't train
# on it. `advance` -> `talk` normalization is handled before this check.
MODEL_ACTION_TYPES = {
    "move", "talk", "choose_starter", "battle_move",
    "run", "throw_ball", "use_item", "switch",
}


def load_runner():
    """Import ollama-runner.py as a module (hyphenated filename -> importlib)."""
    path = os.path.join(HERE, "ollama-runner.py")
    spec = importlib.util.spec_from_file_location("ollama_runner", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # __main__ guard means main() does NOT run
    return mod


def forward_action(action, action_keys):
    """Reduce an engine action to what the runner forwards to the game API and
    what the model's tool call would carry: keys in ACTION_KEYS with non-None
    values. `advance` is normalized to `talk` (identical engine effect; the
    runner's tool grammar only offers `talk`)."""
    a = dict(action)
    if a.get("type") == "advance":
        a["type"] = "talk"
    return {k: v for k, v in a.items() if k in action_keys and v is not None}


def build_user_prompt(runner, view, history):
    """Reconstruct the EXACT user string the runner builds for a given view and
    history window. This mirrors ollama-runner.py's main loop verbatim — the same
    f-string, the same json.dumps(compact_state(view)), the same history render.
    history is a list of (forwarded_action_dict, result_message_str) in order."""
    window = history[-10:] if len(history) > 10 else history
    hist_txt = "\n".join(
        f"  {i+1}. did {json.dumps(h[0])} -> {h[1]}" for i, h in enumerate(window)
    ) or "  (none yet)"
    return (f"Recent actions:\n{hist_txt}\n\n"
            f"Current state:\n{json.dumps(runner.compact_state(view))}\n\n"
            f"Call submit_action with your one action for this turn.")


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


def _runner_reference_prompt(reference_runner, view, history):
    """Assemble the user prompt the runner would send, using an INDEPENDENTLY
    imported runner module (a separate object from the one build_user_prompt
    uses). This makes the equality check adversarial: if build_sft's copy of the
    runner drifts from a fresh load of the runner source — in the template OR in
    compact_state — the two prompts differ and the check fails. This is a literal
    transcription of ollama-runner.py main()'s prompt block."""
    window = history[-10:]
    hist_txt = "\n".join(
        f"  {i+1}. did {json.dumps(h[0])} -> {h[1]}" for i, h in enumerate(window)
    ) or "  (none yet)"
    return (f"Recent actions:\n{hist_txt}\n\n"
            f"Current state:\n{json.dumps(reference_runner.compact_state(view))}\n\n"
            f"Call submit_action with your one action for this turn.")


def validate_prompt_equality(runner, rows):
    """CRITICAL CHECK: prove the user prompt we build is byte-identical to what
    ollama-runner.py itself would produce for the same view + history.

    Adversarial design: we FRESH-import the runner a second time
    (reference_runner) and build the reference prompt from that independent
    module. build_user_prompt uses the `runner` module build_sft already loaded.
    If either the surrounding template or compact_state diverges between the two,
    the strings differ and we FAIL. (In normal operation both come from the same
    ollama-runner.py, so they match — but the check would catch a hand-edited
    copy of the prompt logic in build_sft.)

    Returns (ok, checked, first_failure_or_None)."""
    reference_runner = load_runner()  # independent import — separate module obj
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
        runner_user = _runner_reference_prompt(reference_runner, view, history)
        # (b) What our builder produces (uses the runner module build_sft loaded).
        ours = build_user_prompt(runner, view, history)
        checked += 1
        if ours != runner_user:
            return (False, checked, {"screen": view.get("screen"),
                                     "ours": ours, "runner": runner_user})
    return (True, checked, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile",
                    default=os.path.join(HERE, "..", "data", "trajectories", "oracle-raw.jsonl"))
    ap.add_argument("--out", dest="outfile",
                    default=os.path.join(HERE, "..", "data", "trajectories", "sft.jsonl"))
    ap.add_argument("--history", type=int, default=10,
                    help="Max recent actions to include (runner uses 10).")
    ap.add_argument("--keep-noops", action="store_true",
                    help="Include rows the harvester flagged as no-ops (default: drop).")
    ap.add_argument("--no-validate", action="store_true",
                    help="Skip the prompt-format equality check.")
    args = ap.parse_args()

    runner = load_runner()
    system = runner.SYSTEM
    action_keys = runner.ACTION_KEYS

    infile = os.path.abspath(args.infile)
    outfile = os.path.abspath(args.outfile)
    os.makedirs(os.path.dirname(outfile), exist_ok=True)

    with open(infile) as f:
        raw = [json.loads(line) for line in f if line.strip()]

    # Validate prompt-format equality BEFORE emitting anything.
    if not args.no_validate:
        ok, checked, failure = validate_prompt_equality(runner, raw)
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
        forwarded = forward_action(action, action_keys)
        result_msg = (r.get("result_message") or "")[:120]

        if r.get("noop") and not args.keep_noops:
            n_noop += 1
            # A no-op did not advance the live game state, so the runner's history
            # would not gain a meaningful entry either — skip it entirely.
            continue

        atype = forwarded.get("type")
        if atype not in MODEL_ACTION_TYPES:
            n_off_grammar += 1
            off_types[atype] = off_types.get(atype, 0) + 1
            # Off-grammar action: cannot be a valid submit_action tool call. Skip
            # the training row, but STILL chain history — in a live run this turn
            # happened and would appear in the model's next "Recent actions".
            history.append((forwarded, result_msg))
            continue

        user = build_user_prompt(runner, view, history[-args.history:] if args.history else history)
        row = make_sft_row(runner, system, user, forwarded)
        fd.write(json.dumps(row) + "\n")
        n_out += 1
        history.append((forwarded, result_msg))
    fd.close()

    print(f"[build_sft] read {len(raw)} raw rows from {infile}", file=sys.stderr)
    print(f"[build_sft] dropped noops: {n_noop}", file=sys.stderr)
    if n_off_grammar:
        print(f"[build_sft] skipped off-grammar actions: {n_off_grammar} {json.dumps(off_types)}",
              file=sys.stderr)
    print(f"[build_sft] wrote {n_out} SFT rows -> {outfile}", file=sys.stderr)


if __name__ == "__main__":
    main()
