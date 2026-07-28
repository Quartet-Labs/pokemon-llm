#!/usr/bin/env python3
"""Serve the SFT base model (± QLoRA adapter) behind an Ollama-compatible
/api/chat — the eval bridge between runs/sft-v1 and the live emulator loop.

WHY THIS EXISTS: the adapter from scripts/train_sft.py is a PEFT/QLoRA artifact
for HF transformers. Ollama cannot load it without a merge-to-GGUF conversion,
and a conversion is a second artifact that can silently diverge from what
training produced. Instead this shim loads the EXACT training stack — same base,
same 4-bit NF4 quantization, same tokenizer, adapter applied via PEFT — and
speaks just enough of Ollama's /api/chat for emulator/runner.py to drive it
unchanged. Point the runner's --ollama at this server and eval IS the live loop:

    # base arm
    .venv\\Scripts\\python scripts\\serve_hf.py --port 11435
    # adapter arm
    .venv\\Scripts\\python scripts\\serve_hf.py --port 11436 --adapter runs/sft-v1

    python -m emulator.runner --ollama http://localhost:11435 \
        --model hf-base --no-think-prefix --use-benchmark ...

PROMPT FIDELITY: the request's own messages + tools are passed straight into
tokenizer.apply_chat_template(..., add_generation_prompt=True) — the same call
train_sft.py used to render training text (it rendered the assistant turn too;
generation now begins exactly where the training target began). Nothing is
rebuilt or transcribed here. Run the runner with --no-think-prefix: the SFT rows
were built from the runner's raw user prompt, so the qwen3-ism "/no_think"
prefix would be off-distribution for this model.

The HTTP layer and tool-call parsing are pure Python (unit-testable on the Pi);
torch/transformers/peft load lazily inside HFBrain, desktop-GPU only.
"""
import argparse
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Same floor logic as train_sft.py: the desktop also serves AC transcription;
# refuse to start rather than evict it. A 1.5B NF4 base + KV cache is ~2 GiB.
DEFAULT_MIN_FREE_VRAM_GB = 3.0

_TOOL_CALL_RE = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)


def parse_tool_calls(text):
    """Split generated text into (content, tool_calls) — Ollama message shape.

    Qwen2.5's chat template emits tool calls as
    ``<tool_call>\\n{"name": ..., "arguments": {...}}\\n</tool_call>`` blocks.
    Each parseable block becomes ``{"function": {"name", "arguments": dict}}``
    (Ollama sends arguments as a dict, and the runner's _actions_from_args
    accepts dicts). Malformed blocks are dropped; text outside the blocks is
    returned as content so the runner's JSON-in-content fallback still works
    for a model that never learned the tag format.
    """
    calls = []
    for raw in _TOOL_CALL_RE.findall(text or ""):
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and obj.get("name"):
            calls.append({"function": {"name": obj["name"],
                                       "arguments": obj.get("arguments") or {}}})
    content = _TOOL_CALL_RE.sub("", text or "").strip()
    return content, calls


class HFBrain:
    """Lazy-loading transformers+PEFT text brain. Desktop GPU only."""

    def __init__(self, model_id, adapter=None, max_new_tokens=512,
                 min_free_vram_gb=DEFAULT_MIN_FREE_VRAM_GB, greedy=False):
        import torch
        from transformers import (AutoModelForCausalLM, AutoTokenizer,
                                  BitsAndBytesConfig)

        if not torch.cuda.is_available():
            raise SystemExit("[serve-hf] no CUDA device — this runs on the desktop GPU")
        free_gb = torch.cuda.mem_get_info()[0] / 1024 ** 3
        if free_gb < min_free_vram_gb:
            raise SystemExit(f"[serve-hf] only {free_gb:.1f} GiB free VRAM, need "
                             f"{min_free_vram_gb:.1f} — refusing to evict whatever is using it")

        self.torch = torch
        self.max_new_tokens = max_new_tokens
        self.greedy = greedy
        # The trainer saved its tokenizer into the adapter dir; prefer that copy
        # so pad/eos settings match training exactly.
        self.tok = AutoTokenizer.from_pretrained(adapter or model_id)
        self.model = AutoModelForCausalLM.from_pretrained(
            model_id,
            quantization_config=BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
                bnb_4bit_compute_dtype=torch.bfloat16,
            ),
            dtype=torch.bfloat16,
            device_map={"": 0},
        )
        if adapter:
            from peft import PeftModel
            self.model = PeftModel.from_pretrained(self.model, adapter)
        self.model.eval()

    def chat(self, messages, tools, options):
        """Render with the training-identical chat template and generate."""
        prompt = self.tok.apply_chat_template(
            messages, tools=tools, add_generation_prompt=True, tokenize=False)
        inputs = self.tok(prompt, return_tensors="pt").to(self.model.device)
        temperature = float((options or {}).get("temperature", 0.4))
        do_sample = not self.greedy and temperature > 0
        with self.torch.no_grad():
            out = self.model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=do_sample,
                temperature=temperature if do_sample else None,
                pad_token_id=self.tok.pad_token_id or self.tok.eos_token_id,
            )
        return self.tok.decode(out[0][inputs["input_ids"].shape[1]:],
                               skip_special_tokens=True)


def make_handler(chat_fn, model_name):
    """Build the request handler around any chat_fn(messages, tools, options)
    -> generated-text callable (tests inject a fake; prod injects HFBrain.chat)."""

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self._send(200, {"ok": True, "model": model_name})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/api/chat":
                self._send(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(length) or b"{}")
                text = chat_fn(req.get("messages") or [],
                               req.get("tools") or [],
                               req.get("options") or {})
                content, calls = parse_tool_calls(text)
                msg = {"role": "assistant", "content": content}
                if calls:
                    msg["tool_calls"] = calls
                self._send(200, {"model": model_name, "message": msg, "done": True})
            except Exception as e:  # surface, don't hang the runner
                self._send(500, {"error": str(e)})

        def log_message(self, fmt, *a):
            print(f"[serve-hf] {fmt % a}", flush=True)

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen2.5-1.5B-Instruct")
    ap.add_argument("--adapter", default=None,
                    help="PEFT adapter dir (e.g. runs/sft-v1). Omit for the base arm.")
    ap.add_argument("--port", type=int, default=11435)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--max-new-tokens", type=int, default=512)
    ap.add_argument("--greedy", action="store_true",
                    help="Force greedy decoding regardless of request temperature.")
    ap.add_argument("--min-free-vram-gb", type=float, default=DEFAULT_MIN_FREE_VRAM_GB)
    args = ap.parse_args()

    name = f"hf:{args.model}" + (f"+{args.adapter}" if args.adapter else "")
    print(f"[serve-hf] loading {name} ...", flush=True)
    brain = HFBrain(args.model, adapter=args.adapter,
                    max_new_tokens=args.max_new_tokens,
                    min_free_vram_gb=args.min_free_vram_gb, greedy=args.greedy)
    server = ThreadingHTTPServer((args.host, args.port),
                                 make_handler(brain.chat, name))
    print(f"[serve-hf] {name} on {args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
