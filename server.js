'use strict';
const express = require('express');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { newGame, processAction, getView } = require('./game/engine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

// ── Session store (#25) ───────────────────────────────────────────────────────
const sessions = new Map();
const SESSIONS_FILE = process.env.SESSIONS_FILE || '/tmp/pokemon-sessions.json';
const ACTION_RATE_LIMIT_MS = parseInt(process.env.ACTION_RATE_LIMIT_MS || '500');

if (fs.existsSync(SESSIONS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    for (const [id, data] of Object.entries(saved)) {
      sessions.set(id, { actionLog: [], ...data });
    }
    console.log(`💾 Loaded ${sessions.size} session(s) from ${SESSIONS_FILE}`);
  } catch (e) { console.warn(`⚠ Failed to load sessions: ${e.message}`); }
}

const LEGACY_STATE_FILE = process.env.STATE_FILE || '/tmp/pokemon-state.json';
if (!sessions.has('default') && fs.existsSync(LEGACY_STATE_FILE)) {
  try {
    const legacyState = JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, 'utf8'));
    sessions.set('default', { id: 'default', token: null, label: 'Default', state: legacyState,
      actionLog: [], haltFlag: false, createdAt: Date.now(), lastActionAt: 0, rateLimitMs: 0 });
    console.log(`💾 Migrated legacy state to default session`);
  } catch {}
}

if (!sessions.has('default')) {
  sessions.set('default', { id: 'default', token: null, label: 'Default', state: newGame(),
    actionLog: [], haltFlag: false, createdAt: Date.now(), lastActionAt: 0, rateLimitMs: 0 });
}

function saveSessions() {
  const obj = {};
  for (const [id, s] of sessions) obj[id] = { ...s, actionLog: [] };
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj)); } catch (e) {
    console.warn(`⚠ Failed to save sessions: ${e.message}`);
  }
}

function mkId(bytes) { return crypto.randomBytes(bytes).toString('hex'); }

function createSession({ seed, label } = {}) {
  const id = mkId(4);
  const token = mkId(16);
  const session = { id, token, label: label || `Run ${id}`,
    state: newGame(seed !== undefined ? seed : undefined),
    actionLog: [], haltFlag: false, createdAt: Date.now(), lastActionAt: 0,
    rateLimitMs: ACTION_RATE_LIMIT_MS };
  sessions.set(id, session);
  saveSessions();
  broadcastAll({ event: 'session_created', session: sessionSummary(session) });
  return session;
}

function sessionSummary(s) {
  return { sessionId: s.id, label: s.label, turn: s.state.turn, area: s.state.areaId,
    badges: s.state.player?.badges ?? 0, screen: s.state.screen, haltFlag: s.haltFlag,
    createdAt: s.createdAt, lastActionAt: s.lastActionAt,
    benchmarkId: s.benchmarkId || null };
}

// ── Benchmark store (#34) ──────────────────────────────────────────────────────
const benchmarks = new Map();  // benchmarkId → BenchmarkResult
const BENCHMARKS_FILE = process.env.BENCHMARKS_FILE || '/tmp/pokemon-benchmarks.json';

if (fs.existsSync(BENCHMARKS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(BENCHMARKS_FILE, 'utf8'));
    for (const [id, data] of Object.entries(saved)) benchmarks.set(id, data);
    console.log(`🏆 Loaded ${benchmarks.size} benchmark result(s)`);
  } catch (e) { console.warn(`⚠ Failed to load benchmarks: ${e.message}`); }
}

function saveBenchmarks() {
  try { fs.writeFileSync(BENCHMARKS_FILE, JSON.stringify(Object.fromEntries(benchmarks))); } catch {}
}

function createBenchmark({ model, seed, actionBudget, label }) {
  const benchmarkId = 'bench_' + mkId(4);
  const resolvedSeed = seed !== undefined ? (seed >>> 0) : Math.floor(Math.random() * 0x7FFFFFFF);
  const resolvedBudget = Math.min(parseInt(actionBudget) || 2000, 10000);
  const session = createSession({ seed: resolvedSeed, label: label || `${model || 'unknown'} · seed=${resolvedSeed}` });
  session.benchmarkId = benchmarkId;
  session.benchmarkBudget = resolvedBudget;
  session.benchmarkActionsUsed = 0;
  session.rateLimitMs = 0;  // benchmarks have no rate limit (automated)
  const result = {
    id: benchmarkId,
    sessionId: session.id,
    model: model || 'unknown',
    seed: resolvedSeed,
    actionBudget: resolvedBudget,
    actionsUsed: 0,
    badges: 0,
    turnsToFirstBadge: null,
    outcome: 'ongoing',
    startedAt: Date.now(),
    completedAt: null,
  };
  benchmarks.set(benchmarkId, result);
  saveBenchmarks();
  return { session, result };
}

function completeBenchmark(session, outcome) {
  if (!session.benchmarkId) return;
  const result = benchmarks.get(session.benchmarkId);
  if (!result || result.outcome !== 'ongoing') return;
  result.actionsUsed = session.benchmarkActionsUsed || 0;
  result.badges = session.state.player?.badges ?? 0;
  result.outcome = outcome;
  result.completedAt = Date.now();
  if (outcome.startsWith('badge_') && result.turnsToFirstBadge === null) {
    result.turnsToFirstBadge = result.actionsUsed;
  }
  saveBenchmarks();
  broadcastAll({ event: 'benchmark_completed', result });
  console.log(`🏆 Benchmark ${session.benchmarkId} completed: ${outcome} in ${result.actionsUsed} actions`);
}

// ── Auth & rate-limit helpers (#35) ─────────────────────────────────────────

function resolveSession(req) {
  const id = req.query.session || req.headers['x-session-id'] || 'default';
  return sessions.get(id) || null;
}

function checkAuth(req, res, session) {
  if (!session.token) return true;
  const auth = req.headers['authorization'] || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.query.token || '');
  if (provided !== session.token) {
    res.status(401).json({ error: 'Unauthorized. Pass Authorization: Bearer <token> (from POST /session or POST /benchmark).' });
    return false;
  }
  return true;
}

function checkRateLimit(req, res, session) {
  if (!session.rateLimitMs) return true;
  const elapsed = Date.now() - (session.lastActionAt || 0);
  if (elapsed < session.rateLimitMs) {
    const wait = session.rateLimitMs - elapsed;
    res.status(429).json({ error: `Rate limited. Wait ${wait}ms.`, retry_after_ms: wait });
    return false;
  }
  return true;
}

function driverLabel(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? 'driver' : 'anonymous';
}

// ── Action log ──────────────────────────────────────────────────────────────
const LOG_FILE = process.env.LOG_FILE || '/tmp/pokemon-action-log.jsonl';

function appendLog(session, entry) {
  session.actionLog.push(entry);
  const line = JSON.stringify({ session: session.id, ...entry });
  console.log(JSON.stringify({ _log: true, session: session.id, ...entry }));
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ── Map snapshot ──────────────────────────────────────────────────────────────
function getMapSnapshot(state) {
  const { AREAS, getAreaTile } = require('./game/data/areas');
  const area = AREAS[state.areaId];
  if (!area) return null;
  const tiles = [];
  for (let y = 0; y < area.height; y++) {
    const row = [];
    for (let x = 0; x < area.width; x++) row.push(getAreaTile(area, x, y));
    tiles.push(row);
  }
  return { areaId: area.id, name: area.name, width: area.width, height: area.height, tiles,
    npcs: (area.npcs || []).map(n => ({ x: n.x, y: n.y, name: n.name })) };
}

// ── WebSocket helpers ──────────────────────────────────────────────────────────
function broadcast(sessionId, payload) {
  const msg = JSON.stringify({ sessionId, ...payload });
  wss.clients.forEach(c => {
    if (c.readyState === 1 && (!c._sessionId || c._sessionId === sessionId || c._sessionId === 'default')) {
      c.send(msg);
    }
  });
}

function broadcastAll(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

const ADJECTIVES = ['Brave','Swift','Calm','Bold','Keen','Wild','Wise','Zany','Odd','Cool'];
const POKEMON_NAMES = ['Pikachu','Rattata','Pidgey','Eevee','Meowth','Geodude','Bulbasaur','Squirtle','Charmander','Spearow'];
const usedNames = new Set();
function anonName() {
  for (let i = 0; i < 100; i++) {
    const name = ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)] + POKEMON_NAMES[Math.floor(Math.random()*POKEMON_NAMES.length)];
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
  }
  return 'Observer' + Math.floor(Math.random() * 9999);
}

const chatHistory = [];

// ── REST API ──────────────────────────────────────────────────────────────

app.post('/session', (req, res) => {
  const { seed, label } = req.body || {};
  const session = createSession({ seed, label });
  res.json({ sessionId: session.id, token: session.token, label: session.label,
    rng_seed: session.state.rngSeed, state: getView(session.state),
    note: 'Keep your token secret. Pass it as: Authorization: Bearer <token>' });
});

app.get('/sessions', (req, res) => {
  res.json([...sessions.values()].map(sessionSummary));
});

// ── Benchmark endpoints (#34) ───────────────────────────────────────────────────

app.post('/benchmark', (req, res) => {
  const { model, seed, actionBudget, label } = req.body || {};
  const { session, result } = createBenchmark({ model, seed, actionBudget, label });
  res.json({
    benchmarkId: result.id,
    sessionId: session.id,
    token: session.token,
    model: result.model,
    seed: result.seed,
    actionBudget: result.actionBudget,
    state: getView(session.state),
    note: 'Play normally via POST /action?session=<sessionId>. Budget and badge detection are automatic.',
    leaderboard: '/benchmarks',
    replay: `GET /logs?session=${session.id}  (replay: newGame(${result.seed}) + action sequence)`,
  });
});

app.get('/benchmarks', (req, res) => {
  let results = [...benchmarks.values()];
  if (req.query.model) results = results.filter(r => r.model === req.query.model);
  if (req.query.seed) results = results.filter(r => r.seed === parseInt(req.query.seed));
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  results.sort((a, b) => {
    if (a.outcome === 'ongoing' && b.outcome !== 'ongoing') return 1;
    if (a.outcome !== 'ongoing' && b.outcome === 'ongoing') return -1;
    if (b.badges !== a.badges) return b.badges - a.badges;
    if (a.actionsUsed !== b.actionsUsed) return a.actionsUsed - b.actionsUsed;
    return (a.startedAt || 0) - (b.startedAt || 0);
  });
  res.json({ total: results.length, results: results.slice(0, limit) });
});

app.get('/benchmarks/:id', (req, res) => {
  const result = benchmarks.get(req.params.id);
  if (!result) return res.status(404).json({ error: 'Benchmark not found.' });
  res.json({
    ...result,
    replay: {
      seed: result.seed,
      instructions: `const { newGame, processAction } = require('./game/engine');\nlet state = newGame(${result.seed});\n// replay actions from GET /logs?session=${result.sessionId}`,
      logs_url: `/logs?session=${result.sessionId}`,
      spectate_url: `/?session=${result.sessionId}`,
    },
  });
});

app.get('/state', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json(getView(session.state));
});

app.post('/action', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (!checkAuth(req, res, session)) return;
  if (!checkRateLimit(req, res, session)) return;
  if (session.haltFlag) return res.json({ halted: true, message: 'Run halted by spectator — stop playing.' });

  if (session.benchmarkId) {
    session.benchmarkActionsUsed = (session.benchmarkActionsUsed || 0) + 1;
    if (session.benchmarkActionsUsed > session.benchmarkBudget) {
      completeBenchmark(session, 'budget_exhausted');
      return res.json({
        budgetExhausted: true,
        message: `Action budget of ${session.benchmarkBudget} exhausted — benchmark complete.`,
        benchmarkId: session.benchmarkId,
        result: benchmarks.get(session.benchmarkId),
      });
    }
  }

  const action = req.body;
  if (!action || !action.type) return res.status(400).json({ error: 'action.type is required' });
  try {
    const prevBadges = session.state.player?.badges ?? 0;
    session.state = processAction(session.state, action);
    session.lastActionAt = Date.now();
    const view = getView(session.state);
    const newBadges = view.player?.badges ?? 0;

    if (session.benchmarkId && newBadges > prevBadges) {
      const benchResult = benchmarks.get(session.benchmarkId);
      if (benchResult) {
        benchResult.badges = newBadges;
        if (benchResult.turnsToFirstBadge === null) benchResult.turnsToFirstBadge = session.benchmarkActionsUsed;
        completeBenchmark(session, `badge_${newBadges}`);
      }
    }

    broadcast(session.id, { event: 'state_update', state: view, map: getMapSnapshot(session.state), action });
    appendLog(session, {
      ts: new Date().toISOString(), driver: driverLabel(req), action,
      area: view.area?.id, screen: view.screen,
      log: view.log ? view.log.slice(-3) : [],
      party: (view.player?.party || []).map(p => ({ name: p.name, hp: p.hp, level: p.level })),
      benchmark: session.benchmarkId ? { id: session.benchmarkId, action: session.benchmarkActionsUsed } : undefined,
    });
    saveSessions();
    res.json(view);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/reset', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (!checkAuth(req, res, session)) return;
  if (session.benchmarkId) {
    const result = benchmarks.get(session.benchmarkId);
    if (result && result.outcome === 'ongoing') completeBenchmark(session, 'reset_abandoned');
  }
  session.haltFlag = false;
  const seed = req.body?.seed;
  appendLog(session, { ts: new Date().toISOString(), action: { type: 'reset', seed }, area: null, screen: null, log: ['— game reset —'], party: [] });
  session.state = newGame(seed);
  session.lastActionAt = 0;
  saveSessions();
  const view = getView(session.state);
  broadcast(session.id, { event: 'reset', state: view, map: getMapSnapshot(session.state) });
  res.json(view);
});

app.get('/halt', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json({ halted: session.haltFlag });
});

app.post('/halt', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (req.body?.clear) {
    session.haltFlag = false;
    broadcast(session.id, { event: 'halted', halted: false });
    return res.json({ halted: false });
  }
  session.haltFlag = true;
  broadcast(session.id, { event: 'halted', halted: true });
  res.json({ halted: true, message: 'Run halted by spectator — stop playing.' });
});

app.get('/logs', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
  const log = session.actionLog;
  const offset = Math.max(0, log.length - limit);
  res.json({ sessionId: session.id, total: log.length, returned: Math.min(limit, log.length), entries: log.slice(offset) });
});

app.get('/map', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const snap = getMapSnapshot(session.state);
  if (!snap) return res.json({ error: 'unknown area' });
  res.json(snap);
});

app.get('/api-docs', (req, res) => res.json({
  description: 'Pokémon LLM — REST API reference',
  benchmark: {
    'POST /benchmark': 'Create a benchmark run. Body: {model, seed?, actionBudget?, label?}.',
    'GET /benchmarks': 'Leaderboard. Sorted by badges desc, actionsUsed asc. Query: ?model=X&seed=N&limit=N.',
    'GET /benchmarks/:id': 'Single result + replay instructions.',
    scoring: 'Badges earned (higher better), then actions to first badge (lower better).',
    replay: 'newGame(seed) + replay action log from GET /logs?session=X → deterministic reproduction.',
  },
  sessions: {
    'POST /session': 'Create session. Body: {seed?, label?}. Returns: {sessionId, token}.',
    'GET /sessions': 'List all active sessions.',
  },
  auth: { note: 'Named/benchmark sessions require Authorization: Bearer <token> on write endpoints.' },
  rate_limiting: { note: 'Default 500ms per named session (ACTION_RATE_LIMIT_MS env). Benchmark/default: no limit.' },
  endpoints: {
    'GET /state': 'Game state (?session=X)',
    'POST /action': 'Submit action. Returns {budgetExhausted:true} when benchmark budget runs out.',
    'POST /reset': 'Reset (?session=X). Body: {seed?}.',
    'GET /halt': 'Halt status. POST /halt to halt, {clear:true} to resume.',
    'GET /logs': 'Action log (?session=X&limit=N)',
    'GET /map': 'Area tile map (?session=X)',
    'GET /leaderboard.html': 'Visual leaderboard page',
  },
  action_types: {
    choose_starter: { species: 'bulbasaur|charmander|squirtle' },
    move: { direction: 'north|south|east|west' },
    talk: {}, battle_move: { move_index: '0-3' }, run: {},
    throw_ball: { ball: 'pokeball|great_ball' },
    use_item: { item: 'potion', target_index: '0-5' },
    switch: { party_index: '0-5' },
  },
}));

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  ws._name = anonName();
  const url = new URL(req.url || '/', 'http://localhost');
  const requestedId = url.searchParams.get('session') || 'default';
  ws._sessionId = sessions.has(requestedId) ? requestedId : 'default';
  const session = sessions.get(ws._sessionId);

  ws.send(JSON.stringify({
    event: 'connected', sessionId: ws._sessionId,
    sessions: [...sessions.values()].map(sessionSummary),
    benchmarks: [...benchmarks.values()].slice(-20),
    state: session ? getView(session.state) : null,
    map: session ? getMapSnapshot(session.state) : null,
    myName: ws._name, chatHistory, halted: session?.haltFlag ?? false,
  }));

  const joinMsg = { ts: Date.now(), user: '—', text: `${ws._name} joined` };
  chatHistory.push(joinMsg); if (chatHistory.length > 100) chatHistory.shift();
  broadcastAll({ event: 'chat', msg: joinMsg });

  ws.on('message', (raw) => {
    let data; try { data = JSON.parse(raw); } catch { return; }
    if (data.type === 'chat' && typeof data.text === 'string') {
      const text = data.text.trim().slice(0, 200);
      if (!text) return;
      const msg = { ts: Date.now(), user: ws._name, text };
      chatHistory.push(msg); if (chatHistory.length > 100) chatHistory.shift();
      broadcastAll({ event: 'chat', msg });
    }
    if (data.type === 'subscribe' && typeof data.sessionId === 'string') {
      const s = sessions.get(data.sessionId);
      if (!s) { ws.send(JSON.stringify({ event: 'error', message: 'Session not found.' })); return; }
      ws._sessionId = data.sessionId;
      ws.send(JSON.stringify({ event: 'subscribed', sessionId: data.sessionId,
        state: getView(s.state), map: getMapSnapshot(s.state), halted: s.haltFlag }));
    }
  });

  ws.on('close', () => {
    usedNames.delete(ws._name);
    const leaveMsg = { ts: Date.now(), user: '—', text: `${ws._name} left` };
    chatHistory.push(leaveMsg); if (chatHistory.length > 100) chatHistory.shift();
    broadcastAll({ event: 'chat', msg: leaveMsg });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Pokémon LLM running on http://localhost:${PORT}`);
  console.log(`📊 ${sessions.size} session(s), 🏆 ${benchmarks.size} benchmark result(s)`);
});
