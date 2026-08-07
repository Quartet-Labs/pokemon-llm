"""GPU-side halves of train_grpo.py: env rollout, and the policy-gradient step.

Split out of train_grpo.py so the outer loop stays importable on a box with no
torch — everything in here needs a CUDA device and a live emulator, and cannot
be exercised anywhere but the desktop.

NOTHING IN HERE DEFINES REWARD OR PROMPTS. The prompt comes from
`emulator/runner.py` (`SYSTEM`, `TOOLS`, `build_user_prompt`) by import, not by
transcription, for the same reason build_sft.py does it that way: a second copy
drifts the training distribution away from what the model is shown at inference
and nothing tells you it happened. Reward comes from `scripts/reward.py`, via
train_grpo.score_trajectory.

THE `seed` ARGUMENT CURRENTLY BUYS NOTHING, and that is a finding, not a bug
introduced here. `emulator/server.py`'s POST /reset takes no seed — it calls
`emu.reset()` and discards the request body — so the old per-(step, member)
seed this module sent was silently dropped on the floor. Every episode starts
from the same overworld savestate and group members diverge only through
sampling temperature. The argument is kept in the signature so the outer loop
and its manifest do not change shape, and so it starts working the day the
server learns to accept one. Giving the env real per-episode variation is a
research-design decision (like the strict/lenient parser question) and is
deliberately NOT made here.

STRICT parsing is deliberate. eval-v3 ran strict and produced the honest
"an untuned 1.5B cannot drive this harness" baseline of -163.9. A tool call
this module cannot parse yields NO action, the env is stepped with the model's
own no-op, and reward.py scores it illegal. Loosening the parser here would
make the numbers look better without the policy being better, and would make
this run incomparable to the baseline it exists to beat.
"""

import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "emulator"))

import runner as env_runner  # noqa: E402

# Sampled action text is short — one tool call. Capping it keeps a rollout from
# spending its budget on a model that has learned to ramble instead of act.
MAX_NEW_TOKENS = 256


def build_messages(view, history):
    """The exact chat messages the live driver would send for this state."""
    return [{"role": "system", "content": env_runner.SYSTEM},
            {"role": "user", "content": env_runner.build_user_prompt(view, history)}]


def parse_action(text):
    """Strict tool-call parse. Returns (actions, goal); ([], None) is a no-op
    turn, which reward.py will score as illegal — that is the intent."""
    import json
    import re
    # Chat templates render tool calls inside <tool_call>…</tool_call>.
    m = re.search(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.S)
    blob = m.group(1) if m else None
    if blob is None:
        m = re.search(r"\{.*\}", text, re.S)
        blob = m.group(0) if m else None
    if blob is None:
        return [], None
    try:
        call = json.loads(blob)
    except json.JSONDecodeError:
        return [], None
    args = call.get("arguments", call)
    return env_runner._actions_from_args(args)


def make_emulator_rollout(policy, tok, max_turns=300, temperature=1.0, seed=0,
                          base_url=None, token=None):
    """Return rollout_fn(step, member) -> transitions.

    Each call plays ONE episode from a fresh env reset and returns the
    transition list train_grpo.score_trajectory expects, with the sampled token
    ids and their log-probs attached so the update step does not have to
    re-run the forward pass it already paid for.
    """
    import torch

    base_url = base_url or os.environ.get("POKEMON_ENV_URL", "http://127.0.0.1:8080")

    def rollout(step, member):
        # Every request to this server selects its session with `?session=`, and
        # there is NO implicit `default` session — POST /benchmark is the only
        # way to get one. Driving the bare paths 404s "unknown session 'default'"
        # on the very first call, which is exactly how the 8/06 smoke run died.
        # This mirrors scripts/llm-runner.py rather than reinventing it.
        bench = env_runner.http_post(
            f"{base_url}/benchmark",
            {"label": f"grpo-s{step}-m{member}", "model": "grpo-policy"},
            token=token)
        sid = bench["sessionId"]
        # Each session mints its own token; fall back to the caller's for a
        # future server that gates /benchmark itself.
        sess_token = bench.get("token") or token

        # /benchmark resets the emulator as it creates the session and hands
        # back that opening view, so a separate /reset would only re-pay for a
        # reset we already have. The `seed` argument is threaded no further:
        # POST /reset takes no seed and this server has no way to accept one
        # (see the note in the module docstring).
        view = bench.get("state") or env_runner.http_get(
            f"{base_url}/state?session={sid}")
        history, transitions = [], []

        try:
            for _ in range(max_turns):
                messages = build_messages(view, history)
                prompt_ids = tok.apply_chat_template(
                    messages, tools=env_runner.TOOLS,
                    add_generation_prompt=True, return_tensors="pt",
                ).to(policy.device)

                with torch.no_grad():
                    out = policy.generate(
                        prompt_ids, max_new_tokens=MAX_NEW_TOKENS,
                        do_sample=True, temperature=temperature,
                        pad_token_id=tok.pad_token_id,
                        return_dict_in_generate=True, output_scores=True,
                    )
                completion_ids = out.sequences[0, prompt_ids.shape[-1]:]
                text = tok.decode(completion_ids, skip_special_tokens=True)
                actions, goal = parse_action(text)

                result = env_runner.http_post(
                    f"{base_url}/action?session={sid}",
                    {"actions": actions, "goal": goal}, token=sess_token)
                prev_view, view = view, result.get("state", view)
                msg = result.get("message", "") or ""

                transitions.append({
                    "prev_view": prev_view,
                    "action": actions[0] if actions else {"type": "noop"},
                    "result_view": view,
                    "result_msg": msg,
                    # Kept for the update step; score_trajectory ignores extra keys.
                    "prompt_ids": prompt_ids[0].detach().cpu(),
                    "completion_ids": completion_ids.detach().cpu(),
                })
                history.append((actions[0] if actions else None,
                                env_runner._feedback(actions[0] if actions else None,
                                                     result)))
                if result.get("done"):
                    break
        finally:
            # The server caps the registry at 4 sessions and a benchmark session
            # is never reaped on its own, so an episode that leaks its slot makes
            # the FIFTH episode of any run die on a 409 — long after the mistake.
            # In `finally` because a crashed episode leaks exactly the same slot.
            env_runner.http_delete(f"{base_url}/session?session={sid}",
                                   token=sess_token)
        return transitions

    return rollout


def make_policy_update(policy, reference, tok, lr=1e-6, kl_coef=0.04):
    """Return apply_update(samples) -> None.

    One REINFORCE-with-group-baseline step: the advantage is the group-relative
    z-score train_grpo already computed, applied uniformly to every sampled
    token of that trajectory, plus a KL pull toward the frozen SFT reference.

    The advantage is a TRAJECTORY-level scalar, not a per-token credit
    assignment. That is the honest shape of the signal here — the reward is a
    property of the episode the actions produced, and there is no value network
    to say which turn earned it. It is also why the KL term matters: with a
    coarse gradient, the fastest way to raise return is to drift off the
    tool-call grammar SFT bought, and the anchor is what stops that.
    """
    import torch

    optim = torch.optim.AdamW(
        [p for p in policy.parameters() if p.requires_grad], lr=lr)

    def _logprobs(model, prompt_ids, completion_ids):
        ids = torch.cat([prompt_ids, completion_ids]).unsqueeze(0).to(model.device)
        logits = model(ids).logits[0, :-1]
        targets = ids[0, 1:]
        logp = torch.log_softmax(logits.float(), dim=-1)
        picked = logp.gather(-1, targets.unsqueeze(-1)).squeeze(-1)
        # Only the sampled completion is the policy's own choice; the prompt
        # tokens are the environment talking and carry no gradient signal.
        return picked[-completion_ids.shape[0]:]

    def apply_update(samples):
        optim.zero_grad()
        total = 0.0
        for sample in samples:
            adv = sample["advantage"]
            for t in sample["transitions"]:
                if "completion_ids" not in t or t["completion_ids"].numel() == 0:
                    continue
                pi = _logprobs(policy, t["prompt_ids"], t["completion_ids"])
                with torch.no_grad():
                    ref = _logprobs(reference, t["prompt_ids"], t["completion_ids"])
                # k3 estimator: non-negative, lower variance than (pi - ref).
                log_ratio = ref - pi
                kl = (log_ratio.exp() - log_ratio - 1).mean()
                loss = -(adv * pi.mean()) + kl_coef * kl
                loss.backward()
                total += float(loss.detach())
        torch.nn.utils.clip_grad_norm_(
            [p for p in policy.parameters() if p.requires_grad], 1.0)
        optim.step()
        return total

    return apply_update
