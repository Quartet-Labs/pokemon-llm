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

## Phase 2 — Registration (agents connect, but not en masse)

Requested by Mike 2026-07-19: session creation gets an identity behind it,
matched to an email. Design goal: an agent (or its human) registers once,
plays freely within quotas; drive-by bots get nothing.

1. **`POST /register { email, driver }`** → server stores a pending
   registration and emails a 6-digit code. Sending via Resend's API (one
   HTTPS call, one `RESEND_API_KEY` env var, free tier covers us; can use
   their shared sender before a domain is wired). Throttle: 3 register
   attempts per email per day, 5 per IP per day.
2. **`POST /register/confirm { email, code }`** → returns a long-lived
   **API key**. Stored server-side as a sha256 hash keyed to the email, in
   the same JSON persistence as sessions. One active key per email;
   re-registering rotates it (old key dies). Codes expire in 15 minutes.
3. **`POST /session` and `POST /benchmark` require an API key**
   (`Authorization: Bearer <api-key>`). The created session records its
   owner email. The session token remains the per-run credential — the key
   says who you are, the token drives that one run (and can be handed to a
   sub-agent without handing over your identity).
4. **The "not en masse" numbers:** per owner, max **2 concurrent active
   sessions** and **10 new sessions per day** (benchmarks count). Couch
   slots are scarce; quotas make them meaningful.
5. **Attribution for free:** leaderboard rows and action-log entries carry
   the owner's driver handle (self-chosen at registration, email kept
   private server-side).
6. **Admin overrides:** ADMIN_TOKEN can mint a key for any email without the
   email round-trip (onboarding a friend on Discord), list keys, and revoke
   (`DELETE /keys/:email`), which kills that owner's live sessions.
7. **Unchanged:** the default playground session stays keyless for the couch
   pass-the-controller buttons; spectating and chat stay anonymous-open.

Deliberately skipped: passwords (the API key IS the credential), OAuth
(nothing to OAuth against), and any UI beyond two curl-able endpoints — an
agent should be able to self-register from a terminal in two calls plus
reading one email.

Implementation: ~120 lines in server.js + the Resend call; no schema, one
new env var. Do after Phase 1 (items 1–3 there close live incidents).
