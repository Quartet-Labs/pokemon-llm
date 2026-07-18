'use strict';
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { newGame, processAction, getView } = require('./game/engine');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

// ── Game state ──────────────────────────────────────────────────────────────
let state = newGame();
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
function getMapSnapshot() {
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

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ── REST API ────────────────────────────────────────────────────────────────
app.get('/state', (req, res) => res.json(getView(state)));

app.post('/action', (req, res) => {
  const action = req.body;
  if (!action || !action.type) return res.status(400).json({ error: 'action.type is required' });
  try {
    state = processAction(state, action);
    const view = getView(state);
    broadcast({ event: 'state_update', state: view, map: getMapSnapshot(), action });
    res.json(view);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/reset', (req, res) => {
  state = newGame();
  const view = getView(state);
  broadcast({ event: 'reset', state: view, map: getMapSnapshot() });
  res.json(view);
});

app.get('/map', (req, res) => {
  const { AREAS, getAreaTile } = require('./game/data/areas');
  const area = AREAS[state.areaId];
  if (!area) return res.json({ error: 'unknown area' });
  const tiles = [];
  for (let y = 0; y < area.height; y++) {
    const row = [];
    for (let x = 0; x < area.width; x++) row.push(getAreaTile(area, x, y));
    tiles.push(row);
  }
  res.json({ areaId: area.id, name: area.name, width: area.width, height: area.height, tiles,
    npcs: (area.npcs || []).map(n => ({ x: n.x, y: n.y, name: n.name })) });
});

app.get('/api-docs', (req, res) => res.json({
  description: 'Pokémon LLM — REST API reference',
  endpoints: {
    'GET /state': 'Get current game state',
    'POST /action': 'Submit one action',
    'POST /reset': 'Reset the game',
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

  // Send current game state + chat history
  ws.send(JSON.stringify({
    event: 'connected',
    state: getView(state),
    map: getMapSnapshot(),
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
  console.log(`🎮 Pokémon LLM running on http://localhost:${PORT}`);
});
