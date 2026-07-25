'use strict';
// harvest-oracle.js — turn a deterministic oracle playthrough into a raw
// (view, action) trajectory for supervised imitation learning.
//
// The oracle scripts (scripts/playthrough-*.js) win the game by calling the
// engine's processAction(state, action) directly. We do NOT rewrite their
// strategy: we monkeypatch the engine's processAction export BEFORE requiring
// the oracle, so every action the oracle takes flows through our recorder. For
// each call we snapshot getView(state) — the EXACT view the live model would be
// handed that turn — alongside the action about to be applied, then delegate to
// the real processAction and capture the resulting state.message (the runner
// stores post-action messages in its history window).
//
// Output: one JSON object per line to --out (default data/oracle-trajectory.jsonl):
//   { step, view, action, result_message }
// where `view` is the raw getView() object and `action` is the engine action.
// build_sft.py consumes this and formats the model-facing prompt using the
// live runner's own SYSTEM + compact_state so training is on-distribution.
//
// Usage:
//   node scripts/harvest-oracle.js [--oracle ./playthrough-intro.js] \
//        [--out ../data/trajectories/oracle-raw.jsonl]
//
// Paths are resolved relative to this script's directory (scripts/).

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { oracle: './playthrough-intro.js', out: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--oracle') args.oracle = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  return args;
}

// A compact signature of the state fields that a meaningful action changes.
// If it is identical before and after processAction, the action accomplished
// nothing (blocked move, rejected input) and the (view, action) pair is not
// worth imitating. Kept intentionally cheap for long trajectories.
function actionSignature(state) {
  if (!state) return 'null';
  const p = state.player || {};
  const partySig = (p.party || [])
    .map(m => `${m.species}:${m.level}:${m.currentHp}:${(m.moves || []).join(',')}`)
    .join('|');
  const bagSig = Object.entries(p.bag || {}).map(([k, v]) => `${k}=${v}`).sort().join(',');
  const enemyHp = state.battle && state.battle.enemy ? state.battle.enemy.currentHp : '';
  const dlgIdx = state.dialogue ? state.dialogue.index : '';
  // NB: state.turn is deliberately excluded — the engine bumps the turn counter
  // even on a rejected/blocked action, so including it would mask every no-op.
  return [
    state.screen, state.areaId,
    p.x, p.y, p.money, p.badges, partySig, bagSig, enemyHp, dlgIdx,
  ].join('~');
}

function main() {
  const args = parseArgs(process.argv);
  const outPath = args.out
    ? path.resolve(__dirname, args.out)
    : path.resolve(__dirname, '..', 'data', 'trajectories', 'oracle-raw.jsonl');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Require the engine and grab its real functions. We patch the module's
  // processAction export IN PLACE so the oracle's own
  //   const { processAction } = require('../game/engine')
  // destructuring (evaluated when we require the oracle below) binds to our
  // wrapper — the module object is shared/cached, so patching the property
  // before the oracle's require executes is what makes the interception work.
  const engine = require('../game/engine');
  const realProcessAction = engine.processAction;
  const { getView } = engine;

  const rows = [];
  let step = 0;

  engine.processAction = function recordingProcessAction(state, action) {
    // Snapshot the view the live model would see for THIS state, before the
    // action lands. getView mutates state.explored (records exploration) exactly
    // as the live server does on GET /state, so this matches production.
    let view = null;
    try {
      view = getView(state);
    } catch (e) {
      view = { _view_error: String(e && e.message || e) };
    }
    // Deep-clone so later in-place mutations of state can't rewrite what we
    // captured (getView returns references into state for some fields).
    const viewSnapshot = JSON.parse(JSON.stringify(view));
    const actionSnapshot = JSON.parse(JSON.stringify(action));

    // Cheap pre-action signature to detect no-op actions (e.g. an oracle
    // walking into a wall, or a `move` issued while dialogue is up which the
    // engine rejects with a "use talk to advance" message). Such rows are
    // off-distribution to imitate — build_sft filters them when
    // --drop-noops is set. We compute a small signature rather than a full
    // clone for speed across long trajectories.
    const before = actionSignature(state);
    const next = realProcessAction(state, action);
    const after = actionSignature(next);
    const noop = before === after;

    const resultMessage = (next && typeof next.message === 'string') ? next.message : '';
    rows.push({
      step: step++,
      view: viewSnapshot,
      action: actionSnapshot,
      result_message: resultMessage,
      noop,
    });
    return next;
  };

  // Run the oracle. It executes on require (top-level script, no exports). Its
  // destructured processAction now points at our recorder. If the oracle throws
  // (e.g. engine drift changed battle math so its hard-coded route black-outs),
  // we KEEP the rows harvested up to that point and mark the trajectory
  // incomplete — a partial imitation trajectory is still useful and losing it
  // to an exit(1) would be wasteful. The failure is surfaced loudly instead.
  const oraclePath = path.resolve(__dirname, args.oracle);
  let completed = true;
  let oracleError = null;
  try {
    require(oraclePath);
  } catch (e) {
    completed = false;
    oracleError = String(e && e.stack || e);
  }

  // Restore the real function (politeness; the process exits anyway).
  engine.processAction = realProcessAction;

  const fd = fs.openSync(outPath, 'w');
  for (const row of rows) {
    fs.writeSync(fd, JSON.stringify(row) + '\n');
  }
  fs.closeSync(fd);

  // Breakdown by screen + action type, for a quick sanity read at harvest time.
  const byScreen = {};
  const byType = {};
  for (const r of rows) {
    const scr = (r.view && r.view.screen) || 'unknown';
    byScreen[scr] = (byScreen[scr] || 0) + 1;
    const t = (r.action && r.action.type) || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.error(`[harvest-oracle] oracle: ${oraclePath}`);
  console.error(`[harvest-oracle] completed=${completed}${completed ? '' : ' (oracle threw mid-run; partial trajectory kept)'}`);
  console.error(`[harvest-oracle] wrote ${rows.length} (view, action) rows -> ${outPath}`);
  console.error(`[harvest-oracle] by screen: ${JSON.stringify(byScreen)}`);
  console.error(`[harvest-oracle] by action type: ${JSON.stringify(byType)}`);
  if (!completed) {
    console.error('[harvest-oracle] oracle error (route no longer wins on current engine):');
    console.error(oracleError.split('\n').slice(0, 3).map(l => '  ' + l).join('\n'));
  }
}

main();
