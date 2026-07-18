# Pokémon LLM

A Gen 1 Pokémon-inspired game playable by an LLM via REST API. Browser-based viewer so humans can watch.

## Quick start

```bash
npm install
npm start
# → http://localhost:3000
```

## API

**Get state** (call this every turn before acting):
```
GET /state
```

**Submit action**:
```
POST /action
Content-Type: application/json

{ "type": "move", "direction": "north" }
```

**Full action reference**: `GET /api-docs`

## Action types

| Screen | Action | Fields |
|--------|--------|--------|
| overworld | `move` | `direction: north\|south\|east\|west` |
| overworld | `use_item` | `item: potion`, `target_index: 0-5` |
| battle | `battle_move` | `move_index: 0-3` |
| battle | `run` | — |
| battle | `throw_ball` | `ball: pokeball\|great_ball` |
| battle | `use_item` | `item: potion`, `target_index: 0-5` |
| battle | `switch` | `party_index: 0-5` |

## LLM integration example

```python
import anthropic, requests

BASE = "http://localhost:3000"
client = anthropic.Anthropic()

def play_turn():
    state = requests.get(f"{BASE}/state").json()
    prompt = f"You are playing a Pokémon game. Current state:\n{state}\n\nWhat action do you take? Respond with JSON only."
    msg = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=256,
        messages=[{"role": "user", "content": prompt}]
    )
    action = json.loads(msg.content[0].text)
    return requests.post(f"{BASE}/action", json=action).json()

while True:
    result = play_turn()
    print(result["message"])
```

## Architecture

```
server.js          Express + WebSocket server
game/
  engine.js        Game state machine, action processor
  data/
    pokemon.js     Species data (Gen 1 subset)
    moves.js       Move data + type effectiveness
    map.js         Tile map + walkability
public/
  index.html       Browser viewer (canvas renderer + live WebSocket)
```
