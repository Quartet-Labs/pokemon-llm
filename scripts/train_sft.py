"""QLoRA supervised fine-tune on harvested SFT rows.

Consumes the `messages` + `tools` rows emitted by `scripts/build_sft.py` and
4-bit QLoRA fine-tunes a small instruct model to answer each state prompt with
one `submit_action` tool call.

    python scripts/train_sft.py --in data/sft/sft.jsonl --out runs/sft-v1

THE PROMPT IS NOT REBUILT HERE. Rows already carry the runner's SYSTEM prompt,
the runner-format user prompt and the runner's tool schema (build_sft.py imports
them from `emulator/runner.py`). This script only applies the tokenizer's chat
template to what is already in the row, so the training text stays identical to
what the model is shown at inference.

Torch / TRL / PEFT are imported INSIDE main() on purpose: the data layer below
is pure Python so it can be unit-tested on the Pi, where torch is not installed
and must never be. Training runs on the desktop GPU.
"""

import argparse
import json
import os
import random

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Matches the ollama `qwen2.5:1.5b` pulled for this project. The HF instruct
# weights are the trainable equivalent — ollama's GGUF cannot be QLoRA'd.
DEFAULT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"

# A 1.5B 4-bit base plus LoRA and activations fits well under this, but the
# desktop also serves AC transcription. Refuse to start rather than evict it.
DEFAULT_MIN_FREE_VRAM_GB = 6.0


class RowError(ValueError):
    """A training row that does not match the live runner's shape."""


def validate_row(row, idx):
    """Reject anything that would train the model on a grammar it will never be
    asked to speak. A silently-malformed row is worse than a crash: it trains.

    Returns the action name the row teaches.
    """
    if not isinstance(row, dict):
        raise RowError(f"row {idx}: not an object")

    msgs = row.get("messages")
    if not isinstance(msgs, list) or len(msgs) != 3:
        raise RowError(f"row {idx}: expected 3 messages, got {len(msgs) if isinstance(msgs, list) else type(msgs).__name__}")

    roles = [m.get("role") for m in msgs]
    if roles != ["system", "user", "assistant"]:
        raise RowError(f"row {idx}: roles {roles} != [system, user, assistant]")

    if not row.get("tools"):
        raise RowError(f"row {idx}: no tool schema — the chat template would render "
                       f"the tools block differently than at inference")

    calls = msgs[2].get("tool_calls")
    if not isinstance(calls, list) or len(calls) != 1:
        raise RowError(f"row {idx}: assistant must make exactly one tool call")

    fn = calls[0].get("function") or {}
    if fn.get("name") != "submit_action":
        raise RowError(f"row {idx}: tool call is {fn.get('name')!r}, not 'submit_action'")

    # arguments is a JSON *string* in the OpenAI tool-call convention; a dict
    # here renders differently under the chat template.
    args = fn.get("arguments")
    if not isinstance(args, str):
        raise RowError(f"row {idx}: tool arguments must be a JSON string, got {type(args).__name__}")
    try:
        parsed = json.loads(args)
    except json.JSONDecodeError as e:
        raise RowError(f"row {idx}: tool arguments are not valid JSON: {e}")

    action = parsed.get("type")
    if not action:
        raise RowError(f"row {idx}: tool arguments carry no action 'type'")
    return action


def load_rows(path, strict=True):
    """Load and validate SFT rows. Returns (rows, action_counts).

    strict=True raises on the first bad row. strict=False drops it — but the
    drop is the caller's to report, never silent.
    """
    rows, counts, dropped = [], {}, []
    with open(path) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                action = validate_row(row, i)
            except (RowError, json.JSONDecodeError) as e:
                if strict:
                    raise
                dropped.append(str(e))
                continue
            counts[action] = counts.get(action, 0) + 1
            rows.append(row)
    return rows, counts, dropped


def split_holdout(rows, frac=0.1, seed=0):
    """Deterministic train/eval split.

    Rows arrive in play order, so a tail slice would hold out only the end of
    the route — the eval set would be all Viridian and none of the opening.
    Shuffle against a fixed seed instead.
    """
    if not 0.0 <= frac < 1.0:
        raise ValueError(f"holdout frac must be in [0, 1), got {frac}")
    shuffled = list(rows)
    random.Random(seed).shuffle(shuffled)
    n_eval = int(len(shuffled) * frac)
    return shuffled[n_eval:], shuffled[:n_eval]


def action_mix(counts):
    """Render the action distribution — the number that gated this whole step."""
    total = sum(counts.values()) or 1
    return ", ".join(
        f"{a} {n} ({100 * n / total:.0f}%)"
        for a, n in sorted(counts.items(), key=lambda kv: -kv[1])
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile",
                    default=os.path.join(REPO, "data", "sft", "sft.jsonl"),
                    help="SFT rows from build_sft.py")
    ap.add_argument("--out", dest="outdir",
                    default=os.path.join(REPO, "runs", "sft-v1"),
                    help="adapter + manifest output directory")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--batch-size", type=int, default=4)
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-seq-len", type=int, default=4096)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    ap.add_argument("--holdout", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--min-free-vram-gb", type=float, default=DEFAULT_MIN_FREE_VRAM_GB)
    ap.add_argument("--keep-bad-rows", action="store_true",
                    help="drop malformed rows instead of failing the run")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate data, report the mix, and exit before loading torch")
    args = ap.parse_args()

    rows, counts, dropped = load_rows(args.infile, strict=not args.keep_bad_rows)
    if dropped:
        print(f"[train-sft] DROPPED {len(dropped)} malformed rows:")
        for d in dropped[:10]:
            print(f"  - {d}")
    if not rows:
        raise SystemExit(f"[train-sft] no usable rows in {args.infile}")

    train_rows, eval_rows = split_holdout(rows, args.holdout, args.seed)
    print(f"[train-sft] {len(rows)} rows -> {len(train_rows)} train / {len(eval_rows)} eval")
    print(f"[train-sft] action mix: {action_mix(counts)}")

    if args.dry_run:
        print("[train-sft] dry run — stopping before torch import")
        return

    # ---- everything below needs the GPU box -------------------------------
    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from trl import SFTConfig, SFTTrainer

    if not torch.cuda.is_available():
        raise SystemExit("[train-sft] no CUDA device — this must run on the desktop GPU, not the Pi")

    free_b, total_b = torch.cuda.mem_get_info()
    free_gb = free_b / 1024 ** 3
    print(f"[train-sft] GPU {torch.cuda.get_device_name(0)} — {free_gb:.1f}/{total_b / 1024 ** 3:.1f} GiB free")
    if free_gb < args.min_free_vram_gb:
        raise SystemExit(
            f"[train-sft] only {free_gb:.1f} GiB free, need {args.min_free_vram_gb:.1f}. "
            f"Something else is on the GPU — refusing to evict it.")

    tok = AutoTokenizer.from_pretrained(args.model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    def render(row):
        """Apply the chat template to the row AS STORED, passing its own tool
        schema through so the tools block renders exactly as it does live."""
        return {"text": tok.apply_chat_template(
            row["messages"], tools=row["tools"], tokenize=False)}

    train_ds = Dataset.from_list(train_rows).map(render, remove_columns=["messages", "tools"])
    eval_ds = (Dataset.from_list(eval_rows).map(render, remove_columns=["messages", "tools"])
               if eval_rows else None)

    print(f"[train-sft] sample rendered row:\n{train_ds[0]['text'][:600]}\n...")

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        ),
        dtype=torch.bfloat16,
        device_map={"": 0},
    )
    model.config.use_cache = False

    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
    )

    os.makedirs(args.outdir, exist_ok=True)
    trainer = SFTTrainer(
        model=model,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        peft_config=peft_config,
        args=SFTConfig(
            output_dir=args.outdir,
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=args.grad_accum,
            learning_rate=args.lr,
            max_length=args.max_seq_len,
            bf16=True,
            logging_steps=5,
            save_strategy="epoch",
            eval_strategy="epoch" if eval_ds else "no",
            optim="paged_adamw_8bit",
            lr_scheduler_type="cosine",
            warmup_ratio=0.03,
            gradient_checkpointing=True,
            report_to=[],
            seed=args.seed,
            dataset_text_field="text",
        ),
    )

    trainer.train()
    trainer.save_model(args.outdir)
    tok.save_pretrained(args.outdir)

    metrics = trainer.evaluate() if eval_ds else {}
    manifest = {
        "base_model": args.model,
        "rows_total": len(rows),
        "rows_train": len(train_rows),
        "rows_eval": len(eval_rows),
        "action_counts": counts,
        "dropped_rows": len(dropped),
        "epochs": args.epochs,
        "lora_r": args.lora_r,
        "lora_alpha": args.lora_alpha,
        "lr": args.lr,
        "seed": args.seed,
        "source": os.path.abspath(args.infile),
        "eval": {k: v for k, v in metrics.items() if isinstance(v, (int, float))},
    }
    with open(os.path.join(args.outdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[train-sft] adapter + manifest -> {args.outdir}")
    print(f"[train-sft] eval: {metrics}")


if __name__ == "__main__":
    main()
