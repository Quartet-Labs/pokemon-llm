#!/usr/bin/env bash
# Boot the emulator backend: fetch the ROM (not committed), regenerate the
# overworld savestate, then serve. Idempotent — safe to re-run.
set -euo pipefail

ROM=roms/pokemon_blue.gb
ROM_URL="${POKEMON_ROM_URL:-https://archive.org/download/pokemon-blue-version-usa-europe-sgb-enhanced/Pokemon%20-%20Blue%20Version%20(USA,%20Europe)%20(SGB%20Enhanced).gb}"

if [ ! -f "$ROM" ]; then
  echo "[boot] downloading ROM…"
  curl -sSL --retry 3 --retry-delay 2 \
    -A "Mozilla/5.0 (compatible; emulator-boot/1.0)" \
    -o "$ROM" "$ROM_URL"
fi

# Verify it's the real 1MB Blue ROM before trusting it.
SIZE=$(stat -c%s "$ROM" 2>/dev/null || echo 0)
if [ "$SIZE" != "1048576" ]; then
  echo "[boot] ERROR: ROM size $SIZE != 1048576 — bad download" >&2
  exit 1
fi
echo "[boot] ROM ok ($SIZE bytes)"

# Prefer the savestate baked into the image (tied to this same ROM). Only
# regenerate if it's missing; if regen fails, emu.reset() falls back to a raw
# ROM boot into the intro.
if [ -f emulator/overworld.state ]; then
  echo "[boot] using baked-in overworld savestate"
else
  echo "[boot] generating overworld savestate…"
  python -m emulator.make_state || echo "[boot] savestate gen failed; will boot to intro"
fi

echo "[boot] starting server on port ${PORT:-3100}"
exec python -m emulator.server
