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

/**
 * GET /state
 * Returns the current game view — everything the LLM needs to make a decision.
 */
app.get('/state', (req, res) => {
  res.json(getView(state));
});

/**
 * POST /action
 * Submit one action. Body is JSON.
 *
 * Overworld actions:
 *   { "type": "move", "direction": "north"|"south"|"east"|"west" }
 *   { "type": "use_item", "item": "potion", "target_index": 0 }
 *
 * Battle actions:
 *   { "type": "battle_move", "move_index": 0 }
 *   { "type": "run" }
 *   { "type": "throw_ball", "ball": "pokeball" }
 *   { "type": "use_item", "item": "potion", "target_index": 0 }
 *   { "type": "switch", "party_index": 1 }
 *
 * Returns: updated game view
 */
app.post('/action', (req, res) => {
  const action = req.body;
  if (!action || !action.type) {
    return res.status(400).json({ error: 'action.type is required' });
  }
  try {
    state = processAction(state, action);
    const view = getView(state);
    broadcast({ event: 'state_update', state: view, map: getMapSnapshot(), action });
    res.json(view);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /reset
 * Start a fresh game.
 */
app.post('/reset', (req, res) => {
  state = newGame();
  const view = getView(state);
  broadcast({ event: 'reset', state: view });
  res.json(view);
});

/**
 * GET /map
 * Returns the current area's tile grid + dimensions for the browser renderer.
 */
app.get('/map', (req, res) => {
  const { AREAS, getAreaTile, T } = require('./game/data/areas');
  const area = AREAS[state.areaId];
  if (!area) return res.json({ error: 'unknown area' });
  const tiles = [];
  for (let y = 0; y < area.height; y++) {
    const row = [];
    for (let x = 0; x < area.width; x++) {
      row.push(getAreaTile(area, x, y));
    }
    tiles.push(row);
  }
  res.json({
    areaId: area.id,
    name: area.name,
    width: area.width,
    height: area.height,
    tiles,
    npcs: (area.npcs || []).map(n => ({ x: n.x, y: n.y, name: n.name })),
    signs: (area.signs || []).map(s => ({ x: s.x, y: s.y })),
    player: { x: state.player.x, y: state.player.y },
  });
});

/**
 * GET /api-docs
 * Quick reference for the LLM.
 */
app.get('/api-docs', (req, res) => {
  res.json({
    description: "Pokémon LLM — REST API reference",
    endpoints: {
      "GET /state":   "Get current game state (start here every turn)",
      "POST /action": "Submit one action (see action_types below)",
      "POST /reset":  "Reset the game to a fresh state",
    },
    action_types: {
      move:         { direction: "north|south|east|west" },
      battle_move:  { move_index: "0-3 (index into your_active.moves array)" },
      run:          {},
      throw_ball:   { ball: "pokeball|great_ball" },
      use_item:     { item: "potion", target_index: "0-5 (party slot)" },
      switch:       { party_index: "0-5 (party slot)" },
    },
    tips: [
      "Always GET /state before deciding your action.",
      "In battle, check battle.your_active.moves for available moves.",
      "Surroundings in overworld tell you what tiles are adjacent.",
      "Tall grass has higher encounter rate than regular grass.",
    ],
  });
});

// ── WebSocket ───────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  // Send current state immediately on connect
  ws.send(JSON.stringify({ event: 'connected', state: getView(state), map: getMapSnapshot() }));
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Pokémon LLM server running on http://localhost:${PORT}`);
  console.log(`📖 API docs: http://localhost:${PORT}/api-docs`);
  console.log(`🌐 Browser viewer: http://localhost:${PORT}`);
});
