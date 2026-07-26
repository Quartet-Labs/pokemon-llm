#!/usr/bin/env python3
"""Ways to ask the local `claude` CLI for one game action.

Two knobs, independent, both measurable (see scripts/bench_cli_latency.py):

  factory settings  `--strict-mcp-config` with an empty MCP config. The CLI
                    otherwise walks up from the cwd, finds the household
                    `.mcp.json` + `CLAUDE.md` at the workspace root, and loads
                    the whole household tool surface to decide whether to press
                    a button in Pokemon. Measured cost: ~4s per turn.

  persistent        one long-lived process spoken to over stream-json instead of
                    a fresh `claude -p` per turn. Boot is paid once. Measured
                    cost of NOT doing this: ~4s per turn on top of the above.

Stacked, they take Sonnet from ~9.3s/turn to ~1.1s/turn, which is the difference
between Sonnet being unusable as a brain here and being the obvious default.
"""
import json
import os
import subprocess
import tempfile
import time


def _empty_mcp_config():
    """Write a servers-less MCP config and return its path. Caller unlinks it."""
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump({"mcpServers": {}}, f)
    f.close()
    return f.name


def _factory_flags(cfg_path):
    return ["--strict-mcp-config", "--mcp-config", cfg_path]


class ColdClaude:
    """A fresh `claude -p` per turn — the original behaviour, kept as a fallback.

    Same ask()/close() shape as PersistentClaude so the runner can hold either
    one without caring which.
    """

    def __init__(self, model, system, factory=False, timeout=180):
        self.model = model
        self.system = system
        self.factory = factory
        self.timeout = timeout
        self.generation = 0

    def ask(self, prompt, include_history=None):
        cmd = ["claude", "-p", "--model", self.model,
               "--append-system-prompt", self.system]
        cfg = None
        if self.factory:
            cfg = _empty_mcp_config()
            cmd += _factory_flags(cfg)
        try:
            proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True,
                                  timeout=self.timeout)
        finally:
            if cfg:
                try:
                    os.unlink(cfg)
                except OSError:
                    pass
        if proc.returncode != 0:
            raise RuntimeError(f"claude cli rc={proc.returncode}: {proc.stderr[:200]}")
        return proc.stdout

    # A cold process has no memory, so every prompt must carry its own history.
    needs_history_every_turn = True

    def close(self):
        pass


class PersistentClaude:
    """One `claude -p` process driven over stream-json for many turns.

    The process keeps the conversation, so history does not need to be re-sent —
    but that same property means context grows without bound over a 4000-turn
    game. `recycle_turns` bounds it by retiring the process and starting a fresh
    one; the runner re-seeds the new generation with recent history, so the only
    cost of a recycle is one boot.

    Always runs with factory settings. A long-lived process that had loaded the
    household MCP servers would hold those connections open for the entire run,
    which is worse than paying for them per turn.
    """

    def __init__(self, model, system, recycle_turns=200, timeout=180):
        self.model = model
        self.system = system
        self.recycle_turns = recycle_turns
        self.timeout = timeout
        self.proc = None
        self._cfg = None
        self._turns_this_gen = 0
        self.generation = 0
        self.boot_seconds = []

    needs_history_every_turn = False

    def _start(self):
        self._cfg = _empty_mcp_config()
        # --verbose is mandatory alongside --output-format stream-json in print
        # mode; the CLI refuses to start without it.
        cmd = ["claude", "-p", "--model", self.model,
               "--input-format", "stream-json", "--output-format", "stream-json",
               "--verbose", *_factory_flags(self._cfg),
               "--append-system-prompt", self.system]
        t0 = time.monotonic()
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, bufsize=1)
        self.boot_seconds.append(time.monotonic() - t0)
        self._turns_this_gen = 0
        self.generation += 1

    def _stop(self):
        if self.proc:
            try:
                self.proc.stdin.close()
            except Exception:
                pass
            try:
                self.proc.wait(timeout=10)
            except Exception:
                self.proc.kill()
            self.proc = None
        if self._cfg:
            try:
                os.unlink(self._cfg)
            except OSError:
                pass
            self._cfg = None

    def needs_reseed(self):
        """True when the next ask() will run against a process with no history.

        That includes the turn that *triggers* a recycle, not just the turn after
        it: ask() retires the process and starts a fresh one before sending the
        prompt, so by the time the caller could notice the generation changed, the
        un-seeded prompt has already gone out. Answer for the process that will
        actually receive this turn, not the one currently alive.
        """
        if self.proc is None or self._turns_this_gen == 0:
            return True
        return bool(self.recycle_turns) and self._turns_this_gen >= self.recycle_turns

    def ask(self, prompt, include_history=None):
        if self.proc is None:
            self._start()
        elif self.recycle_turns and self._turns_this_gen >= self.recycle_turns:
            # Context has grown enough to start costing latency. Retire this
            # generation; the caller re-seeds the next one with recent history.
            self._stop()
            self._start()
        try:
            return self._ask_once(prompt)
        except (RuntimeError, TimeoutError, BrokenPipeError, OSError):
            # A dead or wedged process must not end a 4000-turn run. Retire it and
            # give the turn exactly one more shot on a fresh generation, which the
            # runner will re-seed on the following turn.
            self._stop()
            self._start()
            return self._ask_once(prompt)

    def _ask_once(self, prompt):
        msg = {"type": "user",
               "message": {"role": "user",
                           "content": [{"type": "text", "text": prompt}]}}
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                err = ""
                if self.proc.stderr:
                    try:
                        err = self.proc.stderr.read()[:400]
                    except Exception:
                        pass
                raise RuntimeError(f"persistent claude exited: {err}")
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "result":
                if ev.get("is_error"):
                    raise RuntimeError(f"claude result error: {str(ev)[:300]}")
                self._turns_this_gen += 1
                return ev.get("result", "")
        raise TimeoutError(f"no result line within {self.timeout}s")

    def close(self):
        self._stop()


def make_brain(model, system, persistent=False, factory=False, recycle_turns=200,
               timeout=180):
    """Build the brain the runner will drive. Persistent implies factory settings."""
    if persistent:
        return PersistentClaude(model, system, recycle_turns=recycle_turns,
                                timeout=timeout)
    return ColdClaude(model, system, factory=factory, timeout=timeout)
