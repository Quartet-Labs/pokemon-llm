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
// sessions: Map<sessionId, { id, token, label, state, actionLog, haltFlag,
//                            createdAt, lastActionAt, rateLimitMs }>
const sessions = new Map();
const SESSIONS_FILE = process.env.SESSIONS_FILE || '/tmp/pokemon-sessions.json';
const ACTION_RATE_LIMIT_MS = parseInt(process.env.ACTION_RATE_LIMIT_MS || '500');

// Load persisted sessions on boot
if (fs.existsSync(SESSIONS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    for (const [id, data] of Object.entries(saved)) {
      sessions.set(id, { actionLog: [], ...data });
    }
    console.log(`💾 Loaded ${sessions.size} session(s) from ${SESSIONS_FILE}`);
  } catch (e) {
    console.warn(`⚠ Failed to load sessions: ${e.message}`);
  }
}

// Migrate legacy single-state file to default session
const LEGACY_STATE_FILE = process.env.STATE_FILE || '/tmp/pokemon-state.json';
if (!sessions.has('default') && fs.existsSync(LEGACY_STATE_FILE)) {
  try {
    const legacyState = JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, 'utf8'));
    sessions.set('default', {
      id: 'default', token: null, label: 'Default',
      state: legacyState, actionLog: [],
      haltFlag: false, createdAt: Date.now(), lastActionAt: 0, rateLimitMs: 0,
    });
    console.log(`💾 Migrated legacy state to default session (turn ${legacyState.turn})`);
  } catch {}
}

// Always ensure a default session exists (no auth, no rate limit, backwards compat)
if (!sessions.has('default')) {
  sessions.set('default', {
    id: 'default', token: null, label: 'Default',
    state: newGame(), actionLog: [],
    haltFlag: false, createdAt: Date.now(), lastActionAt: 0, rateLimitMs: 0,
  });
}

function saveSessions() {
  // actionLog is in-memory only (too large to serialize every call); omit it
  const obj = {};
  for (const [id, s] of sessions) {
    obj[id] = { ...s, actionLog: [] };
  }
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj)); } catch (e) {
    console.warn(`⚠ Failed to save sessions: ${e.message}`);
  }
}

function mkId(bytes) { return crypto.randomBytes(bytes).toString('hex'); }

function createSession({ seed, label } = {}) {
  const id = mkId(4);           // 8-char public id
  const token = mkId(16);       // 32-char secret token (#35)
  const session = {
    id, token, label: label || `Run ${id}`,
    state: newGame(seed !== undefined ? seed : undefined),
    actionLog: [],
    haltFlag: false,
    createdAt: Date.now(),
    lastActionAt: 0,
    rateLimitMs: ACTION_RATE_LIMIT_MS,
  };
  sessions.set(id, session);
  saveSessions();
  // Notify all spectators of the new session
  broadcastAll({ event: 'session_created', session: sessionSummary(session) });
  return session;
}

function sessionSummary(s) {
  return {
    sessionId: s.id, label: s.label,
    turn: s.state.turn, area: s.state.areaId,
    badges: s.state.player?.badges ?? 0,
    screen: s.state.screen, haltFlag: s.haltFlag,
    createdAt: s.createdAt, lastActionAt: s.lastActionAt,
  };
}

// ── Auth & rate-limit helpers (#35) ─────────────────────────────────────────

function resolveSession(req) {
  const id = req.query.session || req.headers['x-session-id'] || 'default';
  return sessions.get(id) || null;
}

function checkAuth(req, res, session) {
  if (!session.token) return true;  // null token = no auth (default session)
  const auth = req.headers['authorization'] || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (req.query.token || '');
  if (provided !== session.token) {
    res.status(401).json({ error: 'Unauthorized. Pass Authorization: Bearer <token> (from POST /session).' });
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

// ── WebSocket broadcast ───────────────────────────────────────────────────────
// Broadcast to clients subscribed to a specific session
function broadcast(sessionId, payload) {
  const msg = JSON.stringify({ sessionId, ...payload });
  wss.clients.forEach(c => {
    if (c.readyState === 1 && (!c._sessionId || c._sessionId === sessionId || c._sessionId === 'default')) {
      c.send(msg);
    }
  });
}

// Broadcast to ALL clients (for chat and session-list updates)
function broadcastAll(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ── Anon name generator ────────────────────────────────────────────────────
const ADJECTIVES = ['Brave','Swift','Calm','Bold','Keen','Wild','Wise','Zany','Odd','Cool'];
const POKEMON_NAMES = ['Pikachu','Rattata','Pidgey','Eevee','Meowth','Geodude','Bulbasaur','Squirtle','Charmander','Spearow'];
const usedNames = new Set();
function anonName() {
  for (let i = 0; i < 100; i++) {
    const name = ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)]
                + POKEMON_NAMES[Math.floor(Math.random()*POKEMON_NAMES.length)];
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
  }
  return 'Observer' + Math.floor(Math.random() * 9999);
}

const chatHistory = [];  // global chat across sessions

// ── REST API ────────────────────────────────────────────────────────────────

// Create a new isolated session (#25)
app.post('/session', (req, res) => {
  const { seed, label } = req.body || {};
  const session = createSession({ seed, label });
  res.json({
    sessionId: session.id,
    token: session.token,
    label: session.label,
    rng_seed: session.state.rngSeed,
    state: getView(session.state),
    note: 'Keep your token secret. Pass it as: Authorization: Bearer <token> on /action and /reset.',
  });
});

// List sessions (public info only — no tokens)
app.get('/sessions', (req, res) => {
  res.json([...sessions.values()].map(sessionSummary));
});

// Get state for a session
app.get('/state', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found. Use POST /session or omit ?session for default.' });
  res.json(getView(session.state));
});

// Submit action
app.post('/action', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (!checkAuth(req, res, session)) return;
  if (!checkRateLimit(req, res, session)) return;
  if (session.haltFlag) {
    return res.json({ halted: true, message: 'Run halted by spectator — stop playing.' });
  }
  const action = req.body;
  if (!action || !action.type) return res.status(400).json({ error: 'action.type is required' });
  try {
    session.state = processAction(session.state, action);
    session.lastActionAt = Date.now();
    const view = getView(session.state);
    broadcast(session.id, { event: 'state_update', state: view, map: getMapSnapshot(session.state), action });
    appendLog(session, {
      ts: new Date().toISOString(),
      driver: driverLabel(req),
      action, area: view.area?.id, screen: view.screen,
      log: view.log ? view.log.slice(-3) : [],
      party: (view.player?.party || []).map(p => ({ name: p.name, hp: p.hp, level: p.level })),
    });
    saveSessions();
    res.json(view);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset a session (only affects THIS session, not others)
app.post('/reset', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  if (!checkAuth(req, res, session)) return;
  const seed = req.body?.seed;
  session.haltFlag = false;
  appendLog(session, { ts: new Date().toISOString(), action: { type: 'reset', seed }, area: null, screen: null, log: ['— game reset —'], party: [] });
  session.state = newGame(seed);
  session.lastActionAt = 0;
  saveSessions();
  const view = getView(session.state);
  broadcast(session.id, { event: 'reset', state: view, map: getMapSnapshot(session.state) });
  res.json(view);
});

// Halt endpoints
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

// Action log for a session
app.get('/logs', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
  const log = session.actionLog;
  const offset = Math.max(0, log.length - limit);
  res.json({ sessionId: session.id, total: log.length, returned: Math.min(limit, log.length), entries: log.slice(offset) });
});

// Map
app.get('/map', (req, res) => {
  const session = resolveSession(req);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const snap = getMapSnapshot(session.state);
  if (!snap) return res.json({ error: 'unknown area' });
  res.json(snap);
});

app.get('/api-docs', (req, res) => res.json({
  description: 'Pokémon LLM — REST API reference',
  sessions: {
    'POST /session': 'Create a new session. Body: {seed?, label?}. Returns: {sessionId, token, state, rng_seed}.',
    'GET /sessions': 'List all active sessions (public info, no tokens).',
    note: 'All endpoints accept ?session=<id> or X-Session-Id header. Omit for backwards-compat default session.',
  },
  auth: {
    note: 'Named sessions require Authorization: Bearer <token> on POST /action and POST /reset.',
    'default session': 'No auth required (backwards compatible with existing drivers).',
  },
  rate_limiting: {
    note: `POST /action is rate-limited to 1 action per ${ACTION_RATE_LIMIT_MS}ms per named session.`,
    response: '429 with {retry_after_ms} on violation.',
    default_session: 'No rate limit.',
    override: 'Set ACTION_RATE_LIMIT_MS env var to change.',
  },
  endpoints: {
    'GET /state': 'Current game state',
    'POST /action': 'Submit one action. Returns {halted:true,message} if run is halted.',
    'POST /reset': 'Reset the game. Body: {seed?} for a specific seed. Only resets the requested session.',
    'GET /halt': '{halted: bool}',
    'POST /halt': 'Body {} to halt, {clear:true} to resume.',
    'GET /logs': 'Action log for session (?limit=N, max 5000)',
    'GET /map': 'Current area tile map',
  },
  action_types: {
    choose_starter: { species: 'bulbasaur|charmander|squirtle' },
    move: { direction: 'north|south|east|west' },
    talk: {}, battle_move: { move_index: '0-3' },
    run: {}, throw_ball: { ball: 'pokeball|great_ball' },
    use_item: { item: 'potion', target_index: '0-5' },
    switch: { party_index: '0-5' },
  },
}));

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  ws._name = anonName();

  // Subscribe to a session via URL: ws://host/?session=X
  const url = new URL(req.url || '/', `http://localhost`);
  const requestedId = url.searchParams.get('session') || 'default';
  ws._sessionId = sessions.has(requestedId) ? requestedId : 'default';
  const session = sessions.get(ws._sessionId);

  ws.send(JSON.stringify({
    event: 'connected',
    sessionId: ws._sessionId,
    sessions: [...sessions.values()].map(sessionSummary),
    state: session ? getView(session.state) : null,
    map: session ? getMapSnapshot(session.state) : null,
    myName: ws._name,
    chatHistory,
    halted: session?.haltFlag ?? false,
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

    // Switch session subscription without reconnecting
    if (data.type === 'subscribe' && typeof data.sessionId === 'string') {
      const s = sessions.get(data.sessionId);
      if (!s) { ws.send(JSON.stringify({ event: 'error', message: 'Session not found.' })); return; }
      ws._sessionId = data.sessionId;
      ws.send(JSON.stringify({
        event: 'subscribed',
        sessionId: data.sessionId,
        state: getView(s.state),
        map: getMapSnapshot(s.state),
        halted: s.haltFlag,
      }));
    }
  });

  ws.on('close', () => {
    usedNames.delete(ws._name);
    const leaveMsg = { ts: Date.now(), user: '—', text: `${ws._name} left` };
    chatHistory.push(leaveMsg); if (chatHistory.length > 100) chatHistory.shift();
    broadcastAll({ event: 'chat', msg: leaveMsg });
  });
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Pokémon LLM running on http://localhost:${PORT}`);
  console.log(`📊 ${sessions.size} session(s) loaded. Default session requires no auth.`);
});
