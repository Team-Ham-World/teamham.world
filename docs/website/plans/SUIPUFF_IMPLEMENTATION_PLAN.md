# Suipuff Implementation Plan

**Document Status**: PROPOSED
**Date**: 2026-09-11
**Target Area**: New Puffcade game route `/puffcade/suipuff`, its engine, leaderboard stack, and catalog entry
**Primary Existing Code**: `src/app/puffcade/flappy-puff/flappy-puff-game.tsx`, `src/lib/puff/game.ts`, `src/lib/puff/print-run-leaderboard.ts`, `src/components/puffcade-game-picker.tsx`

## 1. Document authority

This document is the source of truth for Suipuff implementation. Work must follow the behavior, boundaries, and acceptance criteria below.

If implementation reveals that a decision here is unsafe or incompatible with the installed framework, update this document before changing the planned behavior. Do not silently add scope or introduce a different game architecture.

## 2. Goal

Add a fourth Puffcade game: **Suipuff**, a Suika Game recreation with the Puff mascot as every mergeable piece. The player drops small Puffs into a tray; two same-tier Puffs that touch merge into the next larger tier and score; a pile that settles above the tray's top line ends the run.

The game uses the established Puffcade architecture unchanged: a pure deterministic engine in `src/lib/puff/`, a fullscreen route-owned canvas shell, a session-gated member leaderboard backed by its own Neon table, and a catalog card in the existing picker.

## 3. Product decisions

### 3.1 Name and theme

- Public name: **Suipuff**. Route: `/puffcade/suipuff`. Shell title: `SUIPUFF.EXE`.
- Merge chain is **all-Puff growth**: every piece is the Puff rendered by `renderPuff` at a different size with a distinct pose. No fruit, no hand-drawn per-tier art.
- The chain ends at **THE PUFF**. Two top-tier Puffs merge into a pop that clears both (Suika's double-watermelon rule) and awards a jackpot.

### 3.2 No new dependencies

The physics engine is hand-rolled in `src/lib/puff/suipuff.ts`, the same way `game.ts` and `snake.ts` are hand-rolled: pure TypeScript, no DOM, seeded xorshift32 RNG, fixed 1/60 step. This keeps determinism for unit tests and lets e2e pin seeds via `Date.now`, and avoids adding a physics library to a repo that has none.

### 3.3 Preserved boundaries

- Puffcade stays an unlisted easter egg: `noindex, nofollow` metadata, no SiteNav/SiteFooter links, no new homepage triggers.
- The picker gains one card; it still imports no game code.
- Shared infra is untouched: `render.ts`, `model.ts`, `performance.ts`, `leaderboard.ts`, auth/db helpers, `globals.css` (the `data-arcade-shell="fullscreen"` rules already cover the new shell).
- Next.js 16 differs from training data: read `node_modules/next/dist/docs/` before writing route or component code, per `AGENTS.md`.

## 4. Game rules

### 4.1 The tray

- The play area is a vertical tray centered in the arena: floor plus left/right walls, open top.
- Tray width scales with the arena: `clamp(280, min(arenaWidth * 0.62, arenaHeight * 0.72), 460)` CSS px.
- A dashed **dead line** sits near the tray top. A held piece hovers just above it at the aim position.

### 4.2 Tiers

Eight tiers. Radius is the physical size; the score column is awarded when a merge *produces* that tier (triangular numbers, Suika-style).

| Tier | Name         | Radius (px, 440 px tray) | Merge score |
|-----:|--------------|--------------------------|------------:|
| 0    | Toner Speck  | 16                       | —           |
| 1    | Pufflet      | 22                       | 1           |
| 2    | Puffling     | 30                       | 3           |
| 3    | Puff         | 40                       | 6           |
| 4    | Big Puff     | 53                       | 10          |
| 5    | Mega Puff    | 70                       | 15          |
| 6    | Giga Puff    | 92                       | 21          |
| 7    | THE PUFF     | 120                      | 28          |

- Tier 7 + tier 7 → both removed, +100 jackpot.
- Radii scale linearly with tray width; the tray is never narrower than 280 px so the largest tier stays under ~0.43× tray width.
- Only tiers 0–4 enter the drop queue (Suika drops its smallest five pieces). `current` and `next` are drawn from the seeded RNG, so a seed fully determines a run.

### 4.3 Dropping

- `aimX` follows the pointer over the arena; ←/→ or A/D nudge at ~260 px/s while held.
- Drop on pointer release/click, Space, or Enter. The held piece becomes a live body at `(aimX, dropY)` with zero initial velocity.
- After a drop there is a ~0.35 s refill delay before the next held piece appears at the current aim. A dotted guide runs from the held piece down to the pile.

### 4.4 Physics

Fixed-step `stepSuipuffGame(state, 1/60)`:

1. Gravity (~1,900 px/s², tuned in implementation), mild air damping.
2. Wall/floor contact: positional correction, restitution ≈ 0.08, tangential friction — Puffs are soft, not bouncy.
3. Circle–circle: O(n²) pairs (body count is bounded by the overflow rule, realistically ≤ ~120), impulse + positional correction weighted by inverse mass (`m ∝ r²`), 3–4 relaxation iterations per step for pile stability.
4. Merge pass: two same-tier bodies in contact merge once per step at their midpoint; the new body inherits averaged velocity plus a small upward pop. Each merge appends a `{ x, y, tier, ttl }` entry to `state.mergePops` for the renderer.
5. Overflow: a live body whose top edge sits above the dead line accumulates `overLineSeconds`; any body's accumulator passing ~1.0 s ends the run. Bodies younger than ~0.6 s are exempt so a falling drop can pass through the line.

### 4.5 Scoring

- Score is the sum of merge values (§4.2) plus the tier-7 jackpot. No points for drops or time survived.
- `isValidSuipuffScore` reuses the flappy bound: safe integer `0..1_000_000`.

## 5. Architecture

### 5.1 Engine — `src/lib/puff/suipuff.ts`

Pure TypeScript, no DOM. Mirrors `game.ts`/`snake.ts` conventions:

- `createSuipuffGame(width, height, seed)`, `stepSuipuffGame(state, dt)`, `resizeSuipuffGame(state, w, h)`, `setSuipuffAim(state, x)`, `dropSuipuff(state)`.
- `SUIPUFF_EVENT = { NONE, DROPPED, MERGED, OVERFLOW }` flags returned by `stepSuipuffGame`; merge detail rides on `state.mergePops`.
- Statuses reuse `PuffRenderPhase` semantics: `ready | playing | paused | dead`.

### 5.2 Route and shell — `src/app/puffcade/suipuff/`

- `page.tsx`: server component, title `Suipuff`, canonical `/puffcade/suipuff`, `robots: { index: false, follow: false }`, renders `<SuipuffGame exitHref="/puffcade" />`.
- `suipuff-game.tsx`: client component following `flappy-puff-game.tsx` — fullscreen `data-arcade-shell`, header stats (Score / Best / member state), canvas arena, ready/pause/results overlays, local best under `ham:suipuff:best:v1`, sr-only live announcements, `router.replace(exitHref)` on exit.
- `suipuff-game.module.css`: cloned from the flappy sheet; only tray/dead-line-specific additions.
- Esc: playing → paused, paused → playing, ready/dead → exit (flappy's contract).

### 5.3 Rendering

- Pre-rendered sprite atlas per tier via `renderPuff` (the `makePuffSprite` technique): each tier gets its own pose — varied yaw/pitch, gaze, blink, and a squash hint — so tiers read as distinct characters, not rescaled copies.
- Per frame: paper background, tray walls/floor in ink with the ground motif, dashed red dead line, held piece + dotted guide at aim, bodies sorted by tier, next-tier preview drawn inside the arena's top corner.
- Merge pops draw `+N` text from a glyph texture atlas pre-rendered at startup — no per-frame `fillText` on a connected canvas (the flappy e2e asserts this and it stays true).
- Squish: a body that landed or merged hard gets a brief vertical squash in `drawImage`, leaning on the mascot's softness. Visual only.
- Render cadence via `getPuffRenderProfile`/`advancePuffRenderClock`, unchanged.

### 5.4 Leaderboard stack

- `src/lib/puff/suipuff-leaderboard.ts`: mirror of `print-run-leaderboard.ts` — `saveSuipuffHighScore`, `getSuipuffLeaderboard`, membership-gated `INSERT ... SELECT` (active + eligible + checked within 24 h), `GREATEST` upsert, ranked snapshot reusing `PuffLeaderboardEntry`/`PuffLeaderboardSnapshot`.
- `src/app/api/puff/suipuff/leaderboard/route.ts`: mirror of the print-run route — GET returns snapshot or the signed-out payload; POST accepts exactly `{ score }`, validates with `isValidSuipuffScore`, 401 on save `null`.
- `migrations/0012_puff_suipuff_leaderboard.sql`: `public.puff_suipuff_scores` — `account_id` PK → `accounts(id) ON DELETE CASCADE`, `high_score` CHECK `0..1_000_000`, `achieved_at`, `updated_at`, `updated_at >= achieved_at` check, ranking index on `(high_score DESC, achieved_at ASC, account_id ASC)`, `REVOKE ALL` from PUBLIC and `app_runtime_role`, then `GRANT SELECT`, column-scoped `INSERT`, column-scoped `UPDATE` to `app_runtime_role`.
- Applied per `docs/NEON_MIGRATIONS.md`: rehearsal branch first; production apply requires an explicit maintainer request.

### 5.5 Catalog

One new `GAME_LISTINGS` entry in `puffcade-game-picker.tsx`: title `Suipuff`, detail `ASCII arcade · 1 player`, one-line description, static `renderPuff` card art (squashed, looking-up pose).

## 6. Accessibility

Same contract as the other games: the route `h1` labels the shell; canvas has a descriptive `aria-label`; controls are listed in the footer; score and phase changes announce through a polite live region; `Esc` and the exit button both leave the game; decorative art is `aria-hidden`; reduced-motion media query honored.

## 7. Affected files

New:

- `src/lib/puff/suipuff.ts`
- `src/lib/puff/suipuff-leaderboard.ts`
- `src/app/api/puff/suipuff/leaderboard/route.ts`
- `src/app/puffcade/suipuff/page.tsx`
- `src/app/puffcade/suipuff/suipuff-game.tsx`
- `src/app/puffcade/suipuff/suipuff-game.module.css`
- `migrations/0012_puff_suipuff_leaderboard.sql`
- `tests/unit/puff-suipuff.test.ts` — engine: deterministic seeds, drop cadence, merge correctness incl. one-merge-per-step and the tier-7 pop, wall/floor containment, overflow timing, resize scaling
- `tests/unit/puff-suipuff-leaderboard.test.ts` — score validation
- `tests/integration/puff-suipuff-leaderboard.test.ts` — save/rank/eligibility against the test database
- e2e coverage in `tests/e2e/puffcade.e2e.ts` (new `Suipuff` describe: catalog card, route metadata + shell, start/exit, no live `fillText`)

Modified:

- `src/components/puffcade-game-picker.tsx` — one listing entry

Expected to remain unchanged:

- `src/lib/puff/render.ts`, `model.ts`, `performance.ts`, `game.ts`, `snake.ts`, `leaderboard.ts`, `print-run-leaderboard.ts`
- existing API routes, `globals.css`, `next.config.ts`

## 8. Acceptance criteria

- `/puffcade` shows a Suipuff card that links to `/puffcade/suipuff` and imports no game code.
- `/puffcade/suipuff` serves a fullscreen `data-arcade-shell` game with `noindex, nofollow` and canonical metadata.
- Same-tier Puffs merge on contact into the next tier with the specified scores; two THE PUFFs pop for +100.
- A pile settling above the dead line ends the run after the grace window; passing drops do not trigger it.
- Signed-in members' best scores persist to `puff_suipuff_scores` and appear on the member board; signed-out play keeps a local best only.
- Runs are deterministic per seed; engine unit tests pass without DOM.
- No per-frame `fillText` on the connected canvas; render cadence stays capped.
- `npm run test:unit`, `test:integration`, `typecheck`, `lint`, `build`, and the Suipuff e2e block pass.
- The migration is committed, rehearsed on a Neon branch, and applied to production only on explicit request.

## 9. Verification commands

```bash
npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

## 10. Out of scope

- Combo multipliers, hold/swap slots, or special power pieces — v1 is faithful Suika.
- Sound, gamepad input, shareable replays.
- A second leaderboard axis (e.g. fastest THE PUFF) — the table stores one `high_score` like its siblings.
