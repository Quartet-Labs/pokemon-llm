'use strict';
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { newGame, processAction, getView } = require('./game/engine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

// ── Persistent action log ───────────────────────────────────────────────────
const LOG_FILE = process.env.LOG_FILE || '/tmp/pokemon-action-log.jsonl';
const actionLog = [];  // in-memory copy for /logs endpoint

// Replay existing log on startup
if (fs.existsSync(LOG_FILE)) {
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try { actionLog.push(JSON.parse(line)); } catch {}
  }
  console.log(`📋 Loaded ${actionLog.length} log entries from ${LOG_FILE}`);
}

function appendLog(entry) {
  actionLog.push(entry);
  // Structured stdout so Railway log retention captures it
  console.log(JSON.stringify({ _log: true, ...entry }));
  // Append to file for persistence within deployment
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n'); } catch {}
}

// ── Game state: four couch slots ────────────────────────────────────────────
// Up to 4 simultaneous runs, old-school 4P style. Each slot is a fully
// independent game; `player` (1-4) selects the slot on every endpoint and
// DEFAULTS TO 1, so pre-4P single-player clients keep working untouched.
const MAX_PLAYERS = 4;
const sessions = {};
for (let n = 1; n <= MAX_PLAYERS; n++) sessions[n] = newGame();

function playerOf(req) {
  const raw = req.query.player ?? req.body?.player ?? 1;
  const n = parseInt(raw, 10);
  return (Number.isInteger(n) && n >= 1 && n <= MAX_PLAYERS) ? n : null;
}

const chatHistory = [];   // last 100 messages

// ── Anon username generator ─────────────────────────────────────────────────
const ADJECTIVES = ['Brave','Swift','Calm','Bold','Keen','Wild','Wise','Zany','Odd','Cool'];
const POKEMON = ['Pikachu','Rattata','Pidgey','Eevee','Meowth','Geodude','Bulbasaur','Squirtle','Charmander','Spearow'];
const usedNames = new Set();
function anonName() {
  for (let i = 0; i < 100; i++) {
    const name = ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)]
                + POKEMON[Math.floor(Math.random()*POKEMON.length)];
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
  }
  return 'Observer' + Math.floor(Math.random() * 9999);
}

// ── Map snapshot helper ─────────────────────────────────────────────────────
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
  return {
    areaId: area.id, name: area.name,
    width: area.width, height: area.height, tiles,
    npcs: (area.npcs || []).map(n => ({ x: n.x, y: n.y, name: n.name })),
  };
}

function playerSnapshot(n) {
  const state = sessions[n];
  return { state: getView(state), map: getMapSnapshot(state) };
}

function allPlayers() {
  const out = {};
  for (let n = 1; n <= MAX_PLAYERS; n++) out[n] = playerSnapshot(n);
  return out;
}

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ── REST API ────────────────────────────────────────────────────────────────
app.get('/state', (req, res) => {
  const n = playerOf(req);
  if (!n) return res.status(400).json({ error: `player must be 1-${MAX_PLAYERS}` });
  res.json({ player: n, ...getView(sessions[n]) });
});

// All four slots at once — spectator boot + agents picking a free slot.
app.get('/players', (req, res) => res.json(allPlayers()));

app.post('/action', (req, res) => {
  const n = playerOf(req);
  if (!n) return res.status(400).json({ error: `player must be 1-${MAX_PLAYERS}` });
  const action = req.body;
  if (!action || !action.type) return res.status(400).json({ error: 'action.type is required' });
  try {
    sessions[n] = processAction(sessions[n], action);
    const view = getView(sessions[n]);
    broadcast({ event: 'state_update', player: n, state: view, map: getMapSnapshot(sessions[n]), action });
    appendLog({
      ts: new Date().toISOString(),
      player: n,
      action,
      area: view.area?.id,
      screen: view.screen,
      log: (view.log || []).slice(0, 3),
      party: (view.player?.party || []).map(p => ({ name: p.name, hp: p.hp, level: p.level })),
    });
    res.json({ player: n, ...view });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-slot reset only — one player wiping the whole couch is not a feature.
app.post('/reset', (req, res) => {
  const n = playerOf(req);
  if (!n) return res.status(400).json({ error: `player must be 1-${MAX_PLAYERS}` });
  appendLog({ ts: new Date().toISOString(), player: n, action: { type: 'reset' }, area: null, screen: null, log: ['— game reset —'], party: [] });
  sessions[n] = newGame();
  const view = getView(sessions[n]);
  broadcast({ event: 'reset', player: n, state: view, map: getMapSnapshot(sessions[n]) });
  res.json({ player: n, ...view });
});

app.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
  const pf = req.query.player ? parseInt(req.query.player, 10) : null;
  // Pre-4P entries have no player field — treat them as player 1.
  const pool = pf ? actionLog.filter(e => (e.player || 1) === pf) : actionLog;
  const offset = Math.max(0, pool.length - limit);
  res.json({
    total: pool.length,
    returned: Math.min(limit, pool.length),
    entries: pool.slice(offset),
  });
});

app.get('/map', (req, res) => {
  const n = playerOf(req);
  if (!n) return res.status(400).json({ error: `player must be 1-${MAX_PLAYERS}` });
  const snap = getMapSnapshot(sessions[n]);
  if (!snap) return res.json({ error: 'unknown area' });
  res.json({ player: n, ...snap });
});

app.get('/api-docs', (req, res) => res.json({
  description: 'Pokémon LLM — REST API reference (4-player couch mode)',
  players: `Every endpoint takes ?player=1-${MAX_PLAYERS} (or "player" in the POST body). ` +
           'Omitted = player 1, so single-player clients work unchanged. Each slot is an ' +
           'independent game. GET /players shows all slots — pick an idle one (turn 0, no party).',
  endpoints: {
    'GET /state?player=N': 'Get one slot\'s game state',
    'GET /players': 'All 4 slots (state + map) at once',
    'POST /action': 'Submit one action ({player: N, type: ...})',
    'POST /reset?player=N': 'Reset ONE slot (never the whole couch)',
    'GET /logs?player=N': 'Action log, optionally filtered by slot',
    'GET /map?player=N': 'Current area map for a slot',
  },
  action_types: {
    choose_starter: { species: 'bulbasaur|charmander|squirtle', note: 'Required first action — no party until this is called' },
    move: { direction: 'north|south|east|west' },
    talk: { note: 'Interact with adjacent NPC/sign OR advance active dialogue' },
    battle_move: { move_index: '0-3' },
    run: {}, throw_ball: { ball: 'pokeball|great_ball' },
    use_item: { item: 'potion', target_index: '0-5' },
    switch: { party_index: '0-5' },
  },
}));

// ── WebSocket: game state + chat ────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws._name = anonName();

  // Send all four slots + chat history
  ws.send(JSON.stringify({
    event: 'connected',
    players: allPlayers(),
    myName: ws._name,
    chatHistory,
  }));

  // Announce join
  const joinMsg = { ts: Date.now(), user: '—', text: `${ws._name} joined` };
  chatHistory.push(joinMsg);
  if (chatHistory.length > 100) chatHistory.shift();
  broadcast({ event: 'chat', msg: joinMsg });

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (data.type === 'chat' && typeof data.text === 'string') {
      const text = data.text.trim().slice(0, 200);
      if (!text) return;
      const msg = { ts: Date.now(), user: ws._name, text };
      chatHistory.push(msg);
      if (chatHistory.length > 100) chatHistory.shift();
      broadcast({ event: 'chat', msg });
    }
  });

  ws.on('close', () => {
    usedNames.delete(ws._name);
    const leaveMsg = { ts: Date.now(), user: '—', text: `${ws._name} left` };
    chatHistory.push(leaveMsg);
    if (chatHistory.length > 100) chatHistory.shift();
    broadcast({ event: 'chat', msg: leaveMsg });
  });
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Pokémon LLM (4P couch) running on http://localhost:${PORT}`);
});
