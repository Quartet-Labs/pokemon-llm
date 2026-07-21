# Emulator backend on Railway: real Pokémon Blue in PyBoy behind the game API.
# Headless — no GPU, no display. The ROM is NOT committed; it is downloaded at
# boot (see start-emulator.sh) and the overworld savestate is regenerated.
FROM python:3.12-slim

# SDL2 runtime + curl for the boot-time ROM fetch. PyBoy runs headless
# (window='null') so no X/display is needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libsdl2-2.0-0 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY emulator/requirements.txt ./emulator/requirements.txt
RUN pip install --no-cache-dir -r emulator/requirements.txt

COPY emulator/ ./emulator/
COPY start-emulator.sh ./start-emulator.sh
RUN chmod +x start-emulator.sh && mkdir -p roms

# Railway injects $PORT; server.py honors it (default 3100).
CMD ["./start-emulator.sh"]
