# Ponytail A/B Experiment — issue #28 as the testbed

Approved by Mike 2026-07-18. Two identical agents build the badge-2 world
expansion; one runs the [ponytail](https://github.com/DietrichGebert/ponytail)
ruleset at `full`, one runs bare. We keep the better implementation, so the
experiment ships #28 either way.

## Why this task

Ponytail's own (unusually honest) benchmarks show ~4% LOC difference on plain
agentic tasks — a competent agent is already near-minimal. The gains
concentrate on tasks with an **over-build trap** (60–94% there). #28 is
exactly that: content-heavy world expansion where map editors, data pipelines,
tile DSLs, and "reusable area generators" all beckon, and the lazy-correct
answer is more rows in `areas.js` + encounter tables using machinery that
already exists.

## Protocol

1. **Common base:** one commit on `main`; both arms branch from it
   (`ab/bare-28`, `ab/ponytail-28`), each in its own git worktree.
2. **Identical spec prompt** (written before either run, committed to this
   doc's directory as `ponytail-ab-spec.md`): implement #28 — Route 2 south
   segment, Mt. Moon (2 floors), Cerulean City, Misty's gym (Staryu L18 /
   Starmie L21, Cascade Badge, TM11), encounter tables per Bulbapedia Gen 1
   (Red), trainer NPCs, warps/connections wired. Definition of done: a
   scripted playthrough reaches Misty and wins badge 2.
3. **Arms:** detached headless Claude Code sessions, same model, same budget.
   Arm P gets the ponytail skill installed at `full`; arm B runs bare. No
   other differences — `--setting-sources` isolated per worktree.
4. **Judging (blind where possible):**
   - Correctness: the scripted Brock→Misty playthrough passes (hard gate).
   - Size: source LOC added, files touched, deps added.
   - Over-engineering: my review of each diff hunting speculative
     abstraction (ponytail-review's own tags make a decent rubric).
   - Session cost/tokens from transcripts.
   - Data accuracy spot-check vs Bulbapedia (moves/stats/encounters).
5. **Outcome:** winner merges as the #28 implementation (loser's genuinely
   better pieces may be grafted). Results written up in
   `docs/ponytail-ab-results.md`; if ponytail earns its keep, adopt it for
   sandbox-repo work — household agents stay unmodified either way.

## Guardrails

- Both arms run in worktrees against a scratch server port — prod untouched.
- The spec freezes BEFORE either arm starts; no mid-run prompt edits.
- If both arms fail the playthrough gate, no winner — findings only.
