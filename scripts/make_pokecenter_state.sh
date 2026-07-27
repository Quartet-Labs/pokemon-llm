#!/usr/bin/env bash
# PROBE ONLY (untracked helper).
#
# Drives a fresh emulator session through the opening + a truncated Route 1 route
# and snapshots a savestate while Red is standing INSIDE the Viridian Pokemon
# Centre (map 41, tileset POKECENTER). That interior is where the walkable floor
# misdecodes as '#', and reaching it costs a full route replay -- so we pay that
# once and leave data/states/viridian-pokecenter.state behind for the classifier
# probe to reload instantly.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"
PY="$REPO/.venv/bin/python"
BASE="http://127.0.0.1:3111"
LOG=/tmp/pokecenter-probe

mkdir -p "$LOG"

echo "[probe] starting emulator server on 3111"
PORT=3111 PYTHONPATH="$REPO" "$PY" emulator/server.py >"$LOG/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for i in $(seq 1 60); do
  curl -sf "$BASE/sessions" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "$BASE/sessions" >/dev/null || { echo "[probe] server never came up"; tail -20 "$LOG/server.log"; exit 1; }
echo "[probe] server up"

echo "[probe] running opening + truncated route1 (this is the slow part)"
"$PY" scripts/harvest-emulator.py \
  --base "$BASE" \
  --script scripts/routes/opening.json \
  --script scripts/routes/probe-to-pokecenter.json \
  --out-dir "$LOG/trajectories" >"$LOG/harvest.log" 2>&1 || {
    echo "[probe] harvest failed"; tail -40 "$LOG/harvest.log"; exit 1; }

SID=$(grep -m1 '^\[harvest-emu\] session ' "$LOG/harvest.log" | awk '{print $3}')
echo "[probe] session $SID"

TOKEN=$("$PY" - "$BASE" "$SID" <<'PYEOF'
import json, sys, urllib.request
base, sid = sys.argv[1], sys.argv[2]
with urllib.request.urlopen(f"{base}/session?session={sid}") as r:
    print(json.load(r).get("token", ""))
PYEOF
)

# Confirm we actually ended up inside the Centre before snapshotting -- a state
# saved on the wrong map would send the diagnosis chasing the wrong tileset.
"$PY" - "$BASE" "$SID" <<'PYEOF'
import json, sys, urllib.request
base, sid = sys.argv[1], sys.argv[2]
with urllib.request.urlopen(f"{base}/state?session={sid}") as r:
    st = json.load(r)
pos = st.get("position") or st.get("map", {})
print("[probe] end state:", json.dumps({k: st.get(k) for k in ("area", "map", "map_id", "position")})[:300])
PYEOF

curl -sf -X POST "$BASE/debug/savestate?session=$SID&name=viridian-pokecenter" \
  -H "X-Session-Token: $TOKEN" | tee "$LOG/savestate.json"
echo
echo "[probe] done"
