# Puffdle

Puffdle lives at `/puffcade/puffdle`; `/puffdle` permanently redirects there.
The daily puzzle uses a UTC day and a deterministic word-list permutation.
The page renders at request time, and an open daily game refreshes when the UTC
day changes. Unlimited games use the same target-word pool.

## Member leaderboard

The leaderboard ranks the member's best **single game**, across both modes:
600 points for a first-guess solve, then 500, 400, 300, 200, or 100. A loss is
worth zero. Equal scores are ordered by when the high score was first achieved,
then account ID. Only active, eligible members appear; only authenticated
members can read the board or submit scores.

`GET` and `POST /api/puffdle/leaderboard` use the normal member session cookie.
POST requires a same-origin JSON request and accepts at most 2 KiB. The API and
Postgres constrain scores to multiples of 100 from 0 to 600. Statistics are
bounded nonnegative integers with wins <= games played and current streak <=
maximum streak <= wins.

The game remains a casual, client-reported leaderboard. These checks reject
impossible values; they do not prove a player solved a puzzle without looking
up its answer. Statistics are snapshots of this browser's play history, not
an authoritative count of games across devices. The database keeps the maximum
reported totals and only advances the current-streak snapshot when games played
increases. A stale retry cannot undo a later loss or move a tie timestamp.

The browser queues a result while member authentication is loading, serializes
saves, and keeps a failed result available for an explicit retry while the page
remains open. Wins and losses both submit statistics. Navigation or closing the
page discards an unsaved request; the error message tells the player to keep the
page open. Guest play works without membership services. Local storage is
best-effort, and saved daily games are rebuilt from validated guesses.

## Database setup

The table and runtime-role grants are in
`migrations/0010_puff_puffdle_leaderboard.sql`. Follow `docs/NEON_MIGRATIONS.md`
for a Neon rehearsal and production execution. Apply this migration before
releasing Puffdle. Do not infer availability from a signed-out GET: that response
deliberately does not query member data.

The real-Postgres integration setup includes migration 0010 and exercises the
actual Puffdle queries and HTTP handlers using the restricted runtime role.

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`
- `npm run test:integration:vps` with exclusive use of the disposable database
- Start the local app using `npm run dev:vps`, then run
  `npm run test:e2e:vps -- tests/e2e/puffdle.e2e.ts`

The browser suite covers authenticated save/readback after reload, a failed
request followed by retry, a loss, and malformed stored-game recovery. The
Postgres suite also checks concurrent saves, stable ties, stale snapshots,
top-ten ordering, eligibility filtering, constraints, and restricted grants.
