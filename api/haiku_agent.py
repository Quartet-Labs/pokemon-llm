#!/usr/bin/env python3
"""
Pokemon LLM — Haiku agent
Resets the game then drives it with claude-haiku-4-5.
"""
import json, time, sys
import anthropic
import urllib.request, urllib.error

BASE = "https://pokemon-llm-production.up.railway.app"
MODEL = "claude-haiku-4-5"
DELAY = 1.5   # seconds between actions — be a little gentle on the server

client = anthropic.Anthropic()

# Per-session auth state — set in main() after POST /session
_session_id: str | None = None
_session_token: str | None = None


def api(method: str, path: str, body=None):
    url = BASE + path
    # Attach session query param so each agent hits its own isolated game state
    if _session_id and "session=" not in path:
        sep = "&" if "?" in url else "?"
        url = url + sep + f"session={_session_id}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if _session_token:
        headers["Authorization"] = f"Bearer {_session_token}"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        print(f"  !! HTTP {e.code} on {method} {path}: {text}", file=sys.stderr)
        return None


def state_to_prompt(state: dict) -> str:
    """Summarise game state into a readable prompt for the model."""
    lines = []

    screen = state.get("screen", state.get("phase", "unknown"))
    lines.append(f"SCREEN: {screen}")

    area = state.get("area", {})
    if area:
        lines.append(f"AREA: {area.get('name', area.get('id', '?'))}")

    player = state.get("player", {})
    if player.get("position"):
        pos = player["position"]
        lines.append(f"POSITION: x={pos.get('x')}, y={pos.get('y')}")

    party = player.get("party", state.get("party", []))
    if party:
        lines.append("PARTY:")
        for p in party:
            lines.append(f"  {p.get('name','?')} Lv{p.get('level',1)} HP:{p.get('hp','?')}/{p.get('maxHp',p.get('max_hp','?'))}")

    battle = state.get("battle")
    if battle:
        lines.append("BATTLE:")
        opp = battle.get("opponent", battle.get("enemy", {}))
        lines.append(f"  Opponent: {opp.get('name','?')} Lv{opp.get('level','?')} HP:{opp.get('hp','?')}/{opp.get('maxHp',opp.get('max_hp','?'))}")
        active = battle.get("active", battle.get("player_pokemon", {}))
        moves = active.get("moves", battle.get("moves", []))
        if moves:
            lines.append("  Your moves:")
            for i, m in enumerate(moves):
                lines.append(f"    [{i}] {m.get('name','?')} pp:{m.get('pp','?')}/{m.get('maxPp',m.get('max_pp','?'))}")

    msg = state.get("message")
    if msg:
        lines.append(f"MESSAGE: {msg}")

    if state.get("dialogue_active"):
        lines.append("(dialogue is active — use {\"type\":\"talk\"} to advance)")

    starters = state.get("starter_options", [])
    if starters:
        lines.append("STARTER OPTIONS:")
        for s in starters:
            lines.append(f"  {s['species']}: {s.get('type','?')} — {s.get('desc','')}")

    log = state.get("log", [])
    if log:
        lines.append("RECENT LOG:")
        for entry in log[-5:]:
            lines.append(f"  {entry}")

    bag = player.get("bag", state.get("inventory", {}))
    if bag:
        lines.append(f"BAG: {bag}")

    hint = state.get("hint")
    if hint:
        lines.append(f"HINT: {hint}")

    return "\n".join(lines)


SYSTEM = """\
You are playing a Gen-1 Pokemon game via a REST API. Your job is to make decisions and advance the game.

You must respond with ONLY a JSON object — no markdown, no explanation. Choose from these action types:
- {"type":"choose_starter","species":"bulbasaur"} or "charmander" or "squirtle" — first action if no party
- {"type":"move","direction":"north"} (or south/east/west) — move around the map
- {"type":"talk"} — interact with NPCs or advance dialogue
- {"type":"battle_move","move_index":0} — use move 0-3 in battle
- {"type":"run"} — flee from battle
- {"type":"throw_ball","ball":"pokeball"} — try to catch
- {"type":"use_item","item":"potion","target_index":0} — use item on party member
- {"type":"switch","party_index":1} — switch to another party member

Strategy hints:
- If phase is "starter_select", choose a starter immediately
- If there's an active dialogue, use {"type":"talk"} to advance it
- In battle, use moves to fight; run if you're losing badly
- Explore the map — try to find NPCs and advance the story
- Don't get stuck: if you just moved north, try other directions if blocked
"""


def pick_action(state: dict, history: list) -> dict:
    prompt = state_to_prompt(state)
    messages = history + [{"role": "user", "content": prompt}]

    resp = client.messages.create(
        model=MODEL,
        max_tokens=256,
        system=SYSTEM,
        messages=messages,
    )

    raw = resp.content[0].text.strip()
    try:
        action = json.loads(raw)
        # Add assistant turn to history (keep last 20 turns to avoid context bloat)
        history.append({"role": "user", "content": prompt})
        history.append({"role": "assistant", "content": raw})
        if len(history) > 40:
            history[:] = history[-40:]
        return action
    except json.JSONDecodeError:
        print(f"  !! bad JSON from model: {raw!r}", file=sys.stderr)
        return {"type": "move", "direction": "north"}   # fallback


def main():
    global _session_id, _session_token

    label = sys.argv[1] if len(sys.argv) > 1 else MODEL
    print(f"🎮 Pokemon Haiku agent — model: {MODEL}")
    print(f"   Target: {BASE}")
    print()

    # Create an isolated named session so multiple agents don't clobber each other
    print("⟳  Creating session...")
    sess = api("POST", "/session")
    if not sess or "sessionId" not in sess:
        print("Session creation failed — is the server up?", file=sys.stderr)
        sys.exit(1)
    _session_id = sess["sessionId"]
    _session_token = sess["token"]
    print(f"   Session: {_session_id}  label: {sess.get('label')}")

    # Reset to get a fresh game state in this session
    print("⟳  Resetting game...")
    state = api("POST", "/reset")
    if not state:
        print("Reset failed.", file=sys.stderr)
        sys.exit(1)
    print(f"   Screen: {state.get('screen')}")
    print()

    history = []
    step = 0

    while True:
        step += 1
        screen = state.get("screen", state.get("phase", "unknown"))
        print(f"[{step:04d}] screen={screen}", end="")

        if screen in ("game_over", "win", "credits"):
            print(f"\n🏁 Game ended with screen={screen}")
            break

        action = pick_action(state, history)
        print(f"  → {json.dumps(action)}")

        result = api("POST", "/action", action)
        if result is None:
            print("  !! action failed, sleeping and retrying state...", file=sys.stderr)
            time.sleep(3)
            state = api("GET", "/state") or state
        else:
            state = result

        time.sleep(DELAY)


if __name__ == "__main__":
    main()
