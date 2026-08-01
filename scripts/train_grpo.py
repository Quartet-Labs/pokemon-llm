"""GRPO policy training on live emulator rollouts.

SFT-v1 taught FORMAT, not POLICY: the adapter emits valid `submit_action` JSON
and survives all 300 turns, but never leaves its starting area and finishes
walking into a wall (-163.9, reproducible across two runs and three greedy
episodes — data/pokemon-eval/eval-v3.txt). Supervised data cannot fix that; the
behaviour it clones is the behaviour that scored -163.9. This is the RL step.

    python scripts/train_grpo.py --adapter runs/sft-v1 --out runs/grpo-v1

WHY NOT trl.GRPOTrainer
-----------------------
GRPOTrainer scores G completions to ONE prompt with a pure text reward. Here the
reward is a function of what the environment DID, and turn N+1's prompt depends
on turn N's action, so a group member is a whole trajectory rather than a
completion. We keep GRPO's actual idea — no value network, advantage is the
group-relative z-score of the return — and roll the group out sequentially
against the emulator.

THE REWARD IS NOT REDEFINED HERE. `scripts/reward.py` is imported, the same
module both drivers use and the same one `eval_compare` reports, so the number
this optimises is exactly the number -163.9 was measured with. There is no
second reward definition in this repo and there must not be.

Torch/TRL/PEFT are imported INSIDE main(), and the rollout source is injected,
so everything below the model is pure Python and unit-testable on the Pi where
torch is not installed and must never be. Training runs on the desktop GPU.
"""

import argparse
import json
import math
import os
import statistics
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts"))

import reward as reward_mod  # noqa: E402  — single source of truth for reward

DEFAULT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"

# Same floor as train_sft.py: the desktop also serves AC transcription, and a
# rollout holds the policy AND a frozen reference in memory. Refuse to start
# rather than evict the transcription worker.
DEFAULT_MIN_FREE_VRAM_GB = 8.0

# Group size. GRPO's advantage is the z-score of a return WITHIN its group, so
# G is what buys the signal: G=1 has no group and no gradient, and a degenerate
# policy needs enough samples for at least one member to do something different
# from the wall. 8 is the smallest group that reliably contains a non-degenerate
# member at TEMPERATURE below; it is also 8 sequential emulator episodes per
# step, which is the real cost driver.
DEFAULT_GROUP_SIZE = 8

# Sampling temperature for rollouts. The SFT policy is close to deterministic
# (three greedy episodes returned an identical mean AND median), so greedy
# rollouts would make every group member identical, every advantage exactly 0,
# and every gradient exactly 0. Temperature is not a nicety here — it is the
# only reason the group differs at all.
DEFAULT_TEMPERATURE = 1.0

# KL penalty toward the frozen SFT reference. SFT bought valid tool-call syntax
# and nothing else; without an anchor the policy will happily trade that syntax
# away for reward and start emitting unparseable actions, which the STRICT
# parser scores as illegal — a reward-hacking spiral into noise.
DEFAULT_KL_COEF = 0.04

# Advantage denominator floor. A group whose members all did the same thing has
# std 0; dividing by it yields inf/NaN and destroys the run. GRPO papers clip
# here; we treat a zero-variance group as carrying no information and drop it
# (see group_advantages), which is stricter and louder than clipping.
ADV_STD_FLOOR = 1e-6


class RolloutError(RuntimeError):
    """A rollout that cannot be scored — never silently treated as reward 0."""


def episode_return(turn_rewards, gamma=1.0):
    """Discounted return of one trajectory.

    gamma defaults to 1.0 (undiscounted). The episode is a fixed 300-turn budget
    against a terminal objective (BADGE, +50) that is many hundreds of turns
    away, so discounting would make the badge worth less than the exploration
    noise on the way to it — exactly the trade this policy already gets wrong.
    """
    if not 0.0 < gamma <= 1.0:
        raise ValueError(f"gamma must be in (0, 1], got {gamma}")
    if gamma == 1.0:
        return float(sum(turn_rewards))
    return float(sum(r * gamma ** t for t, r in enumerate(turn_rewards)))


def group_advantages(returns, std_floor=ADV_STD_FLOOR):
    """GRPO advantage: the z-score of each return within its group.

    Returns (advantages, degenerate). `degenerate` is True when the group has no
    spread — every member did effectively the same thing — in which case the
    advantages are all 0.0 and the caller must SKIP the step rather than apply a
    zero (or, worse, a 1/0-amplified) gradient.

    This is the case that matters for a behaviour-cloned policy: at the start of
    training most groups ARE degenerate, because every member walks into the
    same wall. Reporting that honestly is how you find out temperature or group
    size is too low, instead of watching a loss curve sit flat and guessing.
    """
    n = len(returns)
    if n == 0:
        raise ValueError("cannot compute advantages for an empty group")
    if n == 1:
        # One sample is not a group. Its own return is its own mean, so the
        # advantage is 0 by construction — not a special case, just arithmetic
        # that makes the "G=1 learns nothing" failure explicit.
        return [0.0], True
    mean = statistics.fmean(returns)
    std = statistics.pstdev(returns)
    if std < std_floor:
        return [0.0] * n, True
    return [(r - mean) / std for r in returns], False


def score_trajectory(transitions, tracker=None):
    """Score one rolled-out trajectory with the SHARED reward module.

    `transitions` is the sequence the rollout actually executed:
        [{"prev_view":…, "action":…, "result_view":…, "result_msg":…}, …]

    A fresh RewardTracker per trajectory is mandatory — it holds the
    per-EPISODE novelty memory (first battle with a trainer, first talk with an
    NPC). Sharing one across a group would pay the novelty bonus to whichever
    member happened to be rolled out first and to none of the others, turning an
    ordering artefact into an advantage.
    """
    tracker = tracker if tracker is not None else reward_mod.RewardTracker()
    rewards, breakdowns = [], []
    for i, t in enumerate(transitions):
        missing = [k for k in ("prev_view", "action", "result_view") if k not in t]
        if missing:
            raise RolloutError(f"transition {i} missing {missing}")
        r, bd = tracker.step(t["prev_view"], t["action"],
                             t["result_view"], t.get("result_msg", ""))
        rewards.append(r)
        breakdowns.append(bd)
    return rewards, breakdowns


def illegal_rate(breakdowns):
    """Fraction of turns that were rejected/no-op'd.

    The headline diagnostic for this whole step: SFT-v1's was ~1.0. It is read
    off the reward breakdown rather than recounted, so it cannot disagree with
    the reward that was actually optimised.
    """
    if not breakdowns:
        return 0.0
    return sum(1 for bd in breakdowns if bd.get("illegal", 0.0) < 0) / len(breakdowns)


def summarize_group(group):
    """One line of truth per training step.

    `group` is a list of {"returns": float, "illegal_rate": float, "turns": int}.
    """
    returns = [g["returns"] for g in group]
    advs, degenerate = group_advantages(returns)
    return {
        "n": len(group),
        "return_mean": statistics.fmean(returns),
        "return_min": min(returns),
        "return_max": max(returns),
        "return_std": statistics.pstdev(returns) if len(returns) > 1 else 0.0,
        "illegal_rate_mean": statistics.fmean(g["illegal_rate"] for g in group),
        "turns_mean": statistics.fmean(g["turns"] for g in group),
        "degenerate": degenerate,
        "advantages": advs,
    }


def reward_manifest():
    """Snapshot every reward weight into the run manifest.

    reward.py's weights WILL be tuned between runs (ILLEGAL already moved
    0.5 -> 2.0 for this step). A run whose returns cannot be attributed to a
    specific weight table is not comparable to any other run, and the numbers
    quietly stop meaning anything.
    """
    return {
        name: getattr(reward_mod, name)
        for name in dir(reward_mod)
        if name.isupper() and isinstance(getattr(reward_mod, name), (int, float))
    }


def train_loop(rollout_fn, steps, group_size, apply_update,
               on_step=None, gamma=1.0):
    """The GRPO outer loop, with the model behind two callables.

    rollout_fn(step, member) -> transitions      (one episode against the env)
    apply_update(samples)    -> None             (the policy-gradient step)

    `samples` is a list of {"transitions", "advantage", "returns"} for one
    group, with degenerate groups already dropped. Splitting it this way is not
    decoration: it means the advantage arithmetic, the degenerate-group rule and
    the per-trajectory tracker isolation are all testable on a box with no GPU,
    against a fake environment, which is the only part of this that can be
    verified anywhere but the desktop.
    """
    history = []
    for step in range(steps):
        group, member_transitions = [], []
        for member in range(group_size):
            transitions = rollout_fn(step, member)
            rewards, breakdowns = score_trajectory(transitions)
            member_transitions.append(transitions)
            group.append({
                "returns": episode_return(rewards, gamma=gamma),
                "illegal_rate": illegal_rate(breakdowns),
                "turns": len(rewards),
            })

        summary = summarize_group(group)
        summary["step"] = step
        if summary["degenerate"]:
            # Every member did the same thing. There is no "which of these was
            # better" to learn from, and applying the zero advantages anyway
            # would just log a step that taught nothing as if it had.
            summary["skipped"] = "degenerate group — no spread to learn from"
        else:
            apply_update([
                {"transitions": tr, "advantage": adv, "returns": g["returns"]}
                for tr, adv, g in zip(member_transitions,
                                      summary["advantages"], group)
            ])
            summary["skipped"] = None

        history.append(summary)
        if on_step:
            on_step(summary)
    return history


def format_step(summary):
    """Human-readable progress line."""
    tag = "SKIP" if summary["degenerate"] else "step"
    return (f"[train-grpo] {tag} {summary['step']:4d}  "
            f"return {summary['return_mean']:+8.2f} "
            f"[{summary['return_min']:+.1f}, {summary['return_max']:+.1f}] "
            f"sd {summary['return_std']:6.2f}  "
            f"illegal {summary['illegal_rate_mean']:.0%}  "
            f"turns {summary['turns_mean']:.0f}")


def build_parser():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", default=os.path.join(REPO, "runs", "sft-v1"),
                    help="SFT adapter to initialise the policy from")
    ap.add_argument("--out", dest="outdir",
                    default=os.path.join(REPO, "runs", "grpo-v1"))
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--steps", type=int, default=200)
    ap.add_argument("--group-size", type=int, default=DEFAULT_GROUP_SIZE)
    ap.add_argument("--max-turns", type=int, default=300,
                    help="episode budget; matches the eval harness")
    ap.add_argument("--temperature", type=float, default=DEFAULT_TEMPERATURE)
    ap.add_argument("--kl-coef", type=float, default=DEFAULT_KL_COEF)
    ap.add_argument("--gamma", type=float, default=1.0)
    ap.add_argument("--lr", type=float, default=1e-6)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--min-free-vram-gb", type=float,
                    default=DEFAULT_MIN_FREE_VRAM_GB)
    ap.add_argument("--dry-run", action="store_true",
                    help="report config + reward table and exit before torch")
    return ap


def validate_args(args):
    """Fail on a config that cannot learn, before an hour of rollouts proves it."""
    if args.group_size < 2:
        raise SystemExit(
            f"[train-grpo] --group-size {args.group_size} has no group: GRPO's "
            f"advantage is relative to the other members, so G=1 is a zero "
            f"gradient by construction, not a slow one.")
    if args.temperature <= 0:
        raise SystemExit(
            f"[train-grpo] --temperature {args.temperature} is greedy sampling. "
            f"The SFT policy is near-deterministic, so every group member would "
            f"be identical and every advantage exactly 0.")
    if args.kl_coef < 0:
        raise SystemExit(f"[train-grpo] --kl-coef must be >= 0, got {args.kl_coef}")
    if not 0.0 < args.gamma <= 1.0:
        raise SystemExit(f"[train-grpo] --gamma must be in (0, 1], got {args.gamma}")
    if args.max_turns < 1:
        raise SystemExit(f"[train-grpo] --max-turns must be >= 1, got {args.max_turns}")


def main(argv=None):
    args = build_parser().parse_args(argv)
    validate_args(args)

    weights = reward_manifest()
    print(f"[train-grpo] reward weights (scripts/reward.py): "
          f"ILLEGAL={weights.get('ILLEGAL')} STEP={weights.get('STEP')} "
          f"NEW_TILE={weights.get('NEW_TILE')} NEW_AREA={weights.get('NEW_AREA')} "
          f"BADGE={weights.get('BADGE')}")
    print(f"[train-grpo] {args.steps} steps x G={args.group_size} x "
          f"{args.max_turns} turns = "
          f"{args.steps * args.group_size * args.max_turns:,} env turns")

    if args.dry_run:
        print("[train-grpo] dry run — stopping before torch import")
        return 0

    # ---- everything below needs the GPU box -------------------------------
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    if not torch.cuda.is_available():
        raise SystemExit("[train-grpo] no CUDA device — this must run on the "
                         "desktop GPU, not the Pi")
    free_b, total_b = torch.cuda.mem_get_info()
    free_gb = free_b / 1024 ** 3
    print(f"[train-grpo] GPU {torch.cuda.get_device_name(0)} — "
          f"{free_gb:.1f}/{total_b / 1024 ** 3:.1f} GiB free")
    if free_gb < args.min_free_vram_gb:
        raise SystemExit(
            f"[train-grpo] only {free_gb:.1f} GiB free, need "
            f"{args.min_free_vram_gb:.1f}. Something else is on the GPU — "
            f"refusing to evict it.")

    torch.manual_seed(args.seed)
    tok = AutoTokenizer.from_pretrained(args.adapter)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    quant = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16,
    )
    base = AutoModelForCausalLM.from_pretrained(
        args.model, quantization_config=quant, dtype=torch.bfloat16,
        device_map={"": 0})
    # The policy starts AT the SFT adapter and the reference is a frozen copy of
    # the same weights, so KL is measured against what SFT actually bought
    # (valid tool-call syntax) rather than against the untuned base.
    policy = PeftModel.from_pretrained(base, args.adapter, is_trainable=True)
    reference = PeftModel.from_pretrained(
        AutoModelForCausalLM.from_pretrained(
            args.model, quantization_config=quant, dtype=torch.bfloat16,
            device_map={"": 0}),
        args.adapter, is_trainable=False)
    reference.eval()
    for p in reference.parameters():
        p.requires_grad_(False)

    from grpo_rollout import make_emulator_rollout, make_policy_update

    rollout_fn = make_emulator_rollout(
        policy, tok, max_turns=args.max_turns, temperature=args.temperature,
        seed=args.seed)
    apply_update = make_policy_update(
        policy, reference, tok, lr=args.lr, kl_coef=args.kl_coef)

    os.makedirs(args.outdir, exist_ok=True)
    history = train_loop(rollout_fn, args.steps, args.group_size,
                         apply_update, on_step=lambda s: print(format_step(s)),
                         gamma=args.gamma)

    policy.save_pretrained(args.outdir)
    tok.save_pretrained(args.outdir)
    manifest = {
        "base_model": args.model,
        "init_adapter": os.path.abspath(args.adapter),
        "steps": args.steps,
        "group_size": args.group_size,
        "max_turns": args.max_turns,
        "temperature": args.temperature,
        "kl_coef": args.kl_coef,
        "gamma": args.gamma,
        "lr": args.lr,
        "seed": args.seed,
        "reward_weights": weights,
        "degenerate_steps": sum(1 for h in history if h["degenerate"]),
        "history": [{k: v for k, v in h.items() if k != "advantages"}
                    for h in history],
    }
    with open(os.path.join(args.outdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[train-grpo] adapter + manifest -> {args.outdir}")
    if manifest["degenerate_steps"]:
        print(f"[train-grpo] WARNING: {manifest['degenerate_steps']}/{args.steps} "
              f"steps were skipped as degenerate — the group never disagreed. "
              f"Raise --temperature or --group-size before reading the result "
              f"as 'GRPO did not help'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
