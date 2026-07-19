# Authentication Plan (#35)

What #25 already gives us: named sessions carry a bearer token checked on
`/action` and `/reset`, benchmark sessions likewise, per-session 500 ms rate
limit on named sessions. The remaining holes, in exploit order:

## Holes

1. **The default session is wide open.** No token, no rate limit
   (`rateLimitMs: 0`). Anyone with the URL can drive it, reset it, or spam it
   sub-second — all three happened today (the blind tile-scan, the run-erasing
   reset).
2. **`POST /halt {clear:true}` is unauthenticated** on every session. The stop
   button must stay public (that's its purpose); public *resume* defeats it —
   a driver agent can just clear its own halt.
3. **`POST /session` is unauthenticated + unlimited** — session-table spam,
   and each row persists to disk.
4. **No admin identity.** Nobody can reset or clean up a token-ed session if
   its token is lost (token lives only in the creating agent's context).
5. **Driver identity in logs is binary** (`driver`/`anonymous`) — replay and
   the leaderboard can't attribute runs.

## Plan

1. **`ADMIN_TOKEN` env var** (Railway). Bearer of it passes `checkAuth` on any
   session and may clear halts, reset, and delete sessions. One env var, ~6
   lines in `checkAuth`. Mike + Amos hold it.
2. **Default session becomes playground, not backdoor:** keep it token-less
   (the couch's pass-the-controller buttons depend on it) but give it the
   same 500 ms rate limit, and require ADMIN_TOKEN for its `/reset`.
3. **Halt asymmetry:** `POST /halt` (set) stays public on every session;
   `{clear:true}` requires the session token or ADMIN_TOKEN.
4. **Session creation throttle:** in-memory per-IP bucket — max 5
   `POST /session` per hour per IP (benchmarks exempt when bearing
   ADMIN_TOKEN). ~15 lines, no deps.
5. **Driver labels:** optional `driver` string on `POST /session` /
   `POST /benchmark` (already have `model`), stamped into every action-log
   entry and session summary. Pure logging, no auth semantics.
6. **Non-goals (YAGNI):** no user accounts, no OAuth, no JWT, no per-spectator
   auth — spectating and chat stay anonymous-open. This is a sandbox with
   friends, not a product; the threat model is "a bot with the URL" and
   "a lost token", nothing more.

Order of implementation = the numbering; 1–3 close today's actual incidents,
4–5 are cheap insurance. All server.js, no schema, no deps.
