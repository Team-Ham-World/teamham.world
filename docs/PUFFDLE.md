# Puffdle

Puffdle lives at `/puffcade/puffdle`; `/puffdle` permanently redirects there.
Daily requires an active, eligible member session. Unlimited supports guests.

## Daily game authority

`GET /api/puffdle/daily` resumes the authenticated account's game for the
**database's current UTC date**. A canonical daily puzzle is stored once for
everyone. The account/date primary key allows exactly one daily game. Clearing
browser storage, changing devices, signing out and back in, or changing the
client clock cannot reset its guesses or outcome.

`POST /api/puffdle/daily` accepts a dictionary word, puzzle date, expected guess
count (`revision`), and expected account ID. The account ID must match the
verified session; it does not authorize access. Same-origin JSON requests are
limited to 2 KiB. An atomic conditional update appends exactly one guess and
calculates its outcome. Competing guesses at the same revision conflict; an
identical retry is idempotent. Completed games cannot be updated. A database
trigger also prevents rewriting accepted guesses or resetting progress.

Completing a game and recording its leaderboard result happen in one SQL
statement. A failure rolls back both. No daily result is accepted from browser
score or statistics fields. In-progress responses omit the answer. Daily stats
come from the account's completed daily games, including consecutive UTC-date
win streaks and guess distribution.

The browser waits for server confirmation before accepting a guess. Ambiguous
network failures retain the exact request for safe retry; reload recovers any
committed guess. Focus, visibility changes, and a 30-second interval refresh
progress across devices and at UTC rollover. A failed lookup never enables local
Daily play. Once completed, members can share the result or play Unlimited.

## Leaderboard and Unlimited

The shared leaderboard ranks the best **single game** across both modes: 600
points for a first-guess solve, down to 100 for a sixth-guess solve. A loss earns
zero. Ties use the first achievement timestamp, then account ID. Only active,
eligible members appear. Daily completion records its score automatically.

Unlimited is casual, client-reported play using the same target-word pool. Its
local statistics and authenticated `POST /api/puffdle/leaderboard` submissions
remain bounded snapshots. They are not proof of a solve. The shared board's
legacy totals combine these snapshots with new daily completions; use the Daily
statistics panel for authoritative daily history. The word list and deterministic
schedule are public code; this is replay protection, not answer secrecy or proof
that someone solved without help.

## Rollout

Apply `migrations/0010_puff_puffdle_leaderboard.sql` followed by
`migrations/0011_puffdle_daily_games.sql` before releasing this code, using
`docs/NEON_MIGRATIONS.md`. Daily fails closed if its schema is missing. Signed-out
GET responses do not verify database readiness.

Existing browser-only daily history cannot be reliably assigned to an account
or trusted for backfill. Account enforcement begins with this rollout. Old
browser storage is ignored for Daily; existing leaderboard records are retained.
Already-open old clients need a reload to use the new daily endpoint.

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`, and `AUTH_MODE=disabled npm run build`
- `npm run test:integration:vps` with exclusive use of the disposable database
- Run the local app against that test database, then
  `npm run test:e2e:vps -- tests/e2e/puffdle.e2e.ts`

Real Postgres tests cover concurrent guesses, safe retries, per-account isolation,
win/loss locking, stale days and accounts, atomic scoring, and runtime grants.
Browser tests cover separate devices, clearing storage, lost-response recovery,
client clock changes, and guest Unlimited play.
