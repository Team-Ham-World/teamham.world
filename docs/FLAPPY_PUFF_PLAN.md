# Flappy Puff

Status: implemented

Entry code: `ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight KeyA KeyB Enter`

## Experience

The classic code opens a full-screen paper terminal and launches an ASCII
Flappy Bird-style game starring Puff. `A` and `B` are matched with
`KeyboardEvent.code`, so upper- and lowercase input both work.

Puff flies at a fixed horizontal position while patterned toner stacks move
from right to left. The player flaps with `Space`, `ArrowUp`, `W`, click, or
tap. Each cleared stack is one point. Touching a stack, the ceiling, or the
copier-feed floor ends the run. `Escape` pauses, and `Space` immediately starts
a new run from the scorecard.

The rendering stays inside the site's established newsprint language:

- Puff is pre-rendered from the existing ASCII `renderPuff()` module.
- Toner stacks are composed from `#`, `%`, `H`, and `:` glyphs with red ASCII
  gap markers.
- The ground is a moving `__/\\__HAM__` paper-feed strip.
- Score, controls, modal state, and results remain real DOM content for
  accessibility while Canvas2D handles the playfield.

The simulation is a small deterministic module in `src/lib/puff/game.ts`. It
uses a fixed 60 Hz step, capped catch-up, a seeded gate generator, circle/box
collision, and responsive coordinate reprojection. The home page still sees a
single `PuffExperience` boundary; code detection, hero suspension, game state,
focus restoration, and modal lifecycle remain internal.

## Scores and member privacy

Every browser keeps a local best under `ham:flappy-puff:best:v1`.

When the existing member session is valid, the game also loads and saves the
member's best through `/api/puff/leaderboard`:

- Anonymous visitors may play but receive no leaderboard names or scores.
- `GET` returns rankings only after the normal session-cookie verification.
- `POST` additionally requires an exact same-origin request and accepts one
  bounded integer score field.
- The database upsert uses `GREATEST`, so a lower later score cannot erase a
  personal best.
- Rankings include active, eligible members only, with one row per account.
- Responses are private and `no-store`.

Migration `0004_puff_flappy_leaderboard.sql` creates the score table, ranking
index, foreign key, score bounds, and least-privilege runtime grants. It must be
applied by the owner before the shared board is available in an existing
environment. The production setup wizard now detects and offers that migration.

The endpoint authenticates submissions, but it does not claim tournament-grade
anti-cheat: a determined signed-in user can still forge client-reported scores.
Server-authoritative replays would be a separate system if competitive prizes
are ever attached.

## Acceptance checks

- The full eleven-key sequence opens the game; shifted `A` and `B` work.
- Flap controls work on keyboard, mouse, and touch.
- Pause, exit, crash, restart, local best, resizing, and reduced-motion styles
  work without resetting the underlying Puff hero state.
- A signed-out player never receives the member ranking.
- A signed-in member's higher score persists while later lower scores do not
  replace it.
- The game model, secret code, endpoint, validation, database adapter, lint,
  typecheck, tests, build, and local browser flow are verified before handoff.
