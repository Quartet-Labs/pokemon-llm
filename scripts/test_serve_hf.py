"""Pi-runnable tests for the SFT eval bridge: serve_hf's HTTP/parsing layer
(no torch — the brain is injected), the runner's --no-think-prefix flag, and
eval_compare aggregation."""
import json
import os
import sys
import threading
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import eval_compare
from serve_hf import make_handler, parse_tool_calls


# ── parse_tool_calls ─────────────────────────────────────────────────────────

def test_parse_single_tool_call():
    text = ('<tool_call>\n{"name": "submit_action", "arguments": '
            '{"type": "move", "direction": "north"}}\n</tool_call>')
    content, calls = parse_tool_calls(text)
    assert content == ""
    assert len(calls) == 1
    fn = calls[0]["function"]
    assert fn["name"] == "submit_action"
    assert fn["arguments"] == {"type": "move", "direction": "north"}


def test_parse_keeps_surrounding_content():
    text = ('heading out\n<tool_call>{"name": "submit_action", "arguments": '
            '{"type": "a"}}</tool_call>\ndone')
    content, calls = parse_tool_calls(text)
    assert "heading out" in content and "done" in content
    assert calls[0]["function"]["arguments"] == {"type": "a"}


def test_parse_multiple_and_malformed():
    text = ('<tool_call>{"name": "submit_action", "arguments": {"type": "wait"}}</tool_call>'
            "<tool_call>not json</tool_call>"
            '<tool_call>{"name": "submit_actions", "arguments": {"actions": '
            '[{"type": "move", "direction": "south"}]}}</tool_call>')
    _, calls = parse_tool_calls(text)
    assert [c["function"]["name"] for c in calls] == ["submit_action", "submit_actions"]


def test_parse_no_tool_call_passthrough():
    content, calls = parse_tool_calls('{"type": "move", "direction": "east"}')
    assert calls == []
    assert content == '{"type": "move", "direction": "east"}'


def test_parse_missing_arguments_defaults_empty():
    _, calls = parse_tool_calls('<tool_call>{"name": "submit_action"}</tool_call>')
    assert calls[0]["function"]["arguments"] == {}


# ── HTTP handler round-trip (fake brain, real server) ────────────────────────

def _serve(chat_fn):
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(chat_fn, "hf:test"))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def _post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def test_api_chat_roundtrip_matches_ollama_shape():
    seen = {}

    def fake_chat(messages, tools, options):
        seen.update(messages=messages, tools=tools, options=options)
        return ('<tool_call>{"name": "submit_action", "arguments": '
                '{"type": "move", "direction": "north"}}</tool_call>')

    server, base = _serve(fake_chat)
    try:
        body = {"model": "hf-sft", "stream": False,
                "messages": [{"role": "system", "content": "S"},
                             {"role": "user", "content": "U"}],
                "tools": [{"type": "function", "function": {"name": "submit_action"}}],
                "options": {"temperature": 0.4, "num_ctx": 4096}}
        resp = _post(f"{base}/api/chat", body)
        # The brain got exactly what the runner sent.
        assert seen["messages"][1]["content"] == "U"
        assert seen["options"]["temperature"] == 0.4
        # Ollama response shape emulator/runner.py::ollama_decide reads.
        msg = resp["message"]
        assert resp["done"] is True and msg["role"] == "assistant"
        args = msg["tool_calls"][0]["function"]["arguments"]
        assert args == {"type": "move", "direction": "north"}
    finally:
        server.shutdown()


def test_api_chat_content_only_when_no_tool_call():
    server, base = _serve(lambda m, t, o: '{"type": "wait"}')
    try:
        resp = _post(f"{base}/api/chat", {"messages": [], "tools": []})
        assert "tool_calls" not in resp["message"]
        assert resp["message"]["content"] == '{"type": "wait"}'
    finally:
        server.shutdown()


def test_api_chat_brain_error_is_500_not_hang():
    def boom(m, t, o):
        raise RuntimeError("cuda oom")
    server, base = _serve(boom)
    try:
        try:
            _post(f"{base}/api/chat", {"messages": []})
            assert False, "expected HTTPError"
        except urllib.error.HTTPError as e:
            assert e.code == 500
            assert "cuda oom" in json.load(e)["error"]
    finally:
        server.shutdown()


def test_health():
    server, base = _serve(lambda m, t, o: "")
    try:
        with urllib.request.urlopen(f"{base}/health", timeout=10) as r:
            assert json.load(r)["ok"] is True
    finally:
        server.shutdown()


# ── runner --no-think-prefix ─────────────────────────────────────────────────

def test_runner_think_prefix_flag(monkeypatch):
    from emulator import runner

    captured = {}

    def fake_post(url, body, token=None, timeout=300):
        captured["user"] = body["messages"][1]["content"]
        return {"message": {"tool_calls": [{"function": {
            "name": "submit_action",
            "arguments": {"type": "move", "direction": "north"}}}]}}

    monkeypatch.setattr(runner, "http_post", fake_post)

    acts, _, _ = runner.ollama_decide("http://x", "m", "SYS", "USER", think_prefix=True)
    assert captured["user"] == "/no_think\nUSER"
    assert acts == [{"type": "move", "direction": "north"}]

    runner.ollama_decide("http://x", "m", "SYS", "USER", think_prefix=False)
    assert captured["user"] == "USER"


def test_runner_default_keeps_prefix(monkeypatch):
    """Default behavior unchanged — qwen3 callers keep the prefix."""
    from emulator import runner
    captured = {}

    def fake_post(url, body, token=None, timeout=300):
        captured["user"] = body["messages"][1]["content"]
        return {"message": {}}

    monkeypatch.setattr(runner, "http_post", fake_post)
    runner.ollama_decide("http://x", "m", "SYS", "USER")
    assert captured["user"].startswith("/no_think\n")


# ── no-action diagnosability + abort guard ───────────────────────────────────
# eval-v1's base arm (7/28) returned HTTP 200 for 40 minutes per episode while
# emitting nothing parseable. The runner logged a bare "no action t0" and looped
# without advancing `turn`, so --max-turns never fired, the launcher wall-clock
# killed the process, the wrap-up never ran, and the report showed 0 turns with
# no explanation. These pin both halves of the fix.

def test_decide_returns_raw_reply_when_unparseable(monkeypatch):
    """A no-action decision still hands back the model's actual reply."""
    from emulator import runner

    monkeypatch.setattr(runner, "http_post", lambda *a, **k: {
        "message": {"content": "I should probably go north eventually."}})

    acts, goal, raw = runner.ollama_decide("http://x", "m", "SYS", "USER")
    assert acts == [] and goal is None
    assert "go north eventually" in raw


def test_decide_raw_is_bounded(monkeypatch):
    """Raw text is truncated — a rambling model must not flood the episode log."""
    from emulator import runner

    monkeypatch.setattr(runner, "http_post", lambda *a, **k: {
        "message": {"content": "x" * 5000}})

    _, _, raw = runner.ollama_decide("http://x", "m", "SYS", "USER")
    assert len(raw) <= 600


def test_decide_returns_raw_alongside_a_good_action(monkeypatch):
    """The third element is always present, not only on the failure path."""
    from emulator import runner

    monkeypatch.setattr(runner, "http_post", lambda *a, **k: {
        "message": {"tool_calls": [{"function": {
            "name": "submit_action",
            "arguments": {"type": "move", "direction": "north"}}}]}})

    acts, _, raw = runner.ollama_decide("http://x", "m", "SYS", "USER")
    assert acts == [{"type": "move", "direction": "north"}]
    assert "move" in raw


def _drive_runner(monkeypatch, capsys, replies, extra_argv=()):
    """Run the REAL main() loop against a stub emulator and a scripted brain.

    `replies` is the sequence of raw model messages the shim "returns"; the last
    one repeats forever, so a runner that fails to terminate hangs the test rather
    than quietly passing. Returns (stdout, decisions_made).
    """
    from emulator import runner

    state = {"player": {"badges": 0, "position": {"x": 1, "y": 2}}, "map": {"id": 1}}
    calls = {"decisions": 0}

    def fake_get(url, timeout=30):
        return dict(state)

    def fake_post(url, body, token=None, timeout=300):
        if "/session" in url or "/benchmark" in url:
            return {"sessionId": "test-session", "token": "t"}
        if "/api/chat" in url:
            i = min(calls["decisions"], len(replies) - 1)
            calls["decisions"] += 1
            if calls["decisions"] > 5000:
                raise AssertionError("runner never terminated")
            return {"message": replies[i]}
        # /action — one executed step, so `turn` advances
        return {"steps": [{"action": body, "result": {}, "state": dict(state)}]}

    monkeypatch.setattr(runner, "http_get", fake_get)
    monkeypatch.setattr(runner, "http_post", fake_post)
    monkeypatch.setattr(runner, "http_delete", lambda *a, **k: None)
    monkeypatch.setattr(runner.time, "sleep", lambda *_: None)
    monkeypatch.setattr(runner.atexit, "register", lambda *a, **k: None)
    monkeypatch.setattr(sys, "argv", [
        "runner", "--sleep", "0", "--max-turns", "5", *extra_argv])

    runner.main()
    return capsys.readouterr().out, calls["decisions"]


_NOTHING = {"content": "I should probably go north eventually."}
_MOVE = {"tool_calls": [{"function": {
    "name": "submit_action", "arguments": {"type": "move", "direction": "north"}}}]}


def test_runner_aborts_instead_of_spinning_on_no_action(monkeypatch, capsys):
    """The eval-v1 failure: 200s with nothing parseable, forever. Must now stop."""
    out, decisions = _drive_runner(
        monkeypatch, capsys, [_NOTHING], extra_argv=["--max-no-action", "25"])

    assert decisions == 25, f"spun {decisions} times instead of bailing at 25"
    assert "ABORT" in out
    assert "DONE" in out, "must exit through the wrap-up so a summary row lands"


def test_runner_logs_the_models_actual_reply(monkeypatch, capsys):
    """A no-action turn is diagnosable — the raw reply reaches the episode log."""
    out, _ = _drive_runner(
        monkeypatch, capsys, [_NOTHING], extra_argv=["--max-no-action", "3"])

    assert "go north eventually" in out


def test_runner_no_action_counter_resets_on_a_good_turn(monkeypatch, capsys):
    """A model that recovers is not punished for earlier misses."""
    replies = ([_NOTHING] * 2) + [_MOVE] + ([_NOTHING] * 2) + [_MOVE]
    out, _ = _drive_runner(
        monkeypatch, capsys, replies, extra_argv=["--max-no-action", "3"])

    assert "ABORT" not in out
    assert "ended after 5 turns" in out, out[-300:]


def test_runner_no_action_guard_disabled_by_zero(monkeypatch, capsys):
    """0 turns the guard off; --max-turns is then the only bound (and can't fire
    on a pure no-action stream), so this is opt-in rope."""
    out, decisions = _drive_runner(
        monkeypatch, capsys, [_NOTHING] * 40 + [_MOVE] * 10,
        extra_argv=["--max-no-action", "0"])

    assert "ABORT" not in out
    assert decisions > 25, "guard must not fire when disabled"


# ── eval_compare ─────────────────────────────────────────────────────────────

def _write_traj(path, rewards, areas, badges=0, summary=True, reached=False):
    with open(path, "w") as f:
        f.write(json.dumps({"kind": "meta", "session_id": "s", "model": "m"}) + "\n")
        for i, r in enumerate(rewards):
            f.write(json.dumps({
                "kind": "turn", "turn": i + 1, "reward": r,
                "state": {"area": {"id": areas[min(i, len(areas) - 1)]},
                          "player": {"badges": badges}},
                "action": {"type": "wait"}, "reward_breakdown": {}, "done": False,
            }) + "\n")
        if summary:
            f.write(json.dumps({
                "kind": "summary", "total_reward": sum(rewards),
                "turns": len(rewards), "areas_visited": list(dict.fromkeys(areas)),
                "max_area": areas[-1], "max_badges": badges,
                "goal_reached": reached,
            }) + "\n")


def test_eval_compare_two_arms(tmp_path):
    a1, a2 = str(tmp_path / "b1.jsonl"), str(tmp_path / "b2.jsonl")
    s1 = str(tmp_path / "s1.jsonl")
    _write_traj(a1, [1.0, 2.0], ["pallet"], summary=True)
    _write_traj(a2, [0.0, 1.0], ["pallet", "route1"], summary=True)
    _write_traj(s1, [5.0, 5.0], ["pallet", "route1", "viridian"],
                badges=1, summary=True, reached=True)
    reports = eval_compare.main([f"base={a1}", f"base={a2}", f"sft={s1}", "--json"])
    by_arm = {r["arm"]: r for r in reports}
    assert by_arm["base"]["episodes"] == 2
    assert by_arm["base"]["reward_mean"] == 2.0   # (3.0 + 1.0) / 2
    assert by_arm["base"]["distinct_areas"] == 2
    assert by_arm["sft"]["max_badges"] == 1
    assert by_arm["sft"]["goal_reached"] == "1/1"


def test_eval_compare_reconstructs_missing_summary(tmp_path):
    p = str(tmp_path / "crash.jsonl")
    _write_traj(p, [1.5, 0.5], ["pallet", "route1"], summary=False)
    reports = eval_compare.main([f"crashed={p}", "--json"])
    r = reports[0]
    assert r["reconstructed_episodes"] == 1
    assert r["reward_mean"] == 2.0
    assert r["distinct_areas"] == 2
