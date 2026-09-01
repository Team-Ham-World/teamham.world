# Puffcade Implementation Plan

**Document Status**: ACTIVE / ROUTE-OWNED GAME MODEL IMPLEMENTED
**Date**: 2026-09-01 (updated 2026-09-01)
**Target Area**: Homepage Puff easter eggs, `/puffcade`, and the `/puffcade/flappy-puff` game route
**Primary Existing Code**: `src/components/puff-experience.tsx` and `src/app/puffcade/flappy-puff/flappy-puff-game.tsx`

## 1. Document authority

This document is the source of truth for Puffcade implementation. Work must follow the behavior, boundaries, and acceptance criteria below.

If implementation reveals that a decision here is unsafe or incompatible with the installed framework, update this document before changing the planned behavior. Do not silently add scope or introduce a different game architecture.

## 2. Goal

Route the two Flappy Puff unlock paths through `/puffcade`:

- completing the Puff keyboard sequence on the homepage; and
- clicking the HAM logo five times on the homepage.

`/puffcade` is an on-theme picker for Puff-related games. Each game owns a dedicated route under `/puffcade`; the first is Flappy Puff at `/puffcade/flappy-puff`. The structure supports adding real games later without speculative game infrastructure.

## 3. Required v1 behavior

1. Completing the existing keyboard sequence on `/` navigates to `/puffcade`.
2. Completing the existing five-logo-click sequence on `/` navigates to `/puffcade`.
3. Neither trigger opens Flappy Puff directly from the homepage.
4. `/puffcade` displays one playable game card for Flappy Puff.
5. The card is a normal link. Selecting it navigates to `/puffcade/flappy-puff`; the catalog never imports or mounts game code.
6. Exiting the game navigates to `/puffcade` with `router.replace`, so Back never reopens a game the player explicitly left.
7. The existing game engine, controls, local best score, leaderboard, and API behavior remain unchanged.
8. Future games are not displayed until they exist and have approved names and descriptions.

## 4. Product decisions

### 4.1 Puffcade remains an easter egg

Puffcade remains intentionally unlisted:

- do not add it to `SiteNav`;
- do not add it to `SiteFooter`;
- do not add another homepage link; and
- set both route metadata blocks to prevent search indexing.

The routes remain directly addressable for visitors who know the URL.

### 4.2 Triggers remain homepage-only

The keyboard and logo-click listeners exist because `PuffExperience` is mounted on the homepage. Preserve that boundary.

On other routes, the HAM logo continues to behave as an ordinary link to `/`. Do not move the secret listeners into the root layout or shared navigation.

### 4.3 Each game owns a dedicated route

Each game lives at its own URL under `/puffcade` and renders a fullscreen shell from its route. This replaces the earlier dialog decision. The picker used to mount `PuffGame` as a `<dialog>` on `/puffcade`, which put modal state, focus restoration, and body scroll locking in the catalog where they did not belong.

Rules that follow from the route model:

- the picker imports no game implementation and holds no open/close state;
- the game owns its exit navigation and never touches the shared root layout. The header is suppressed and body scroll locked from `globals.css` while `[data-arcade-shell="fullscreen"]` is in the document; and
- browser Back behaves natively in both directions; only explicit exit uses `router.replace`.

### 4.4 No speculative game framework

Hardcode the single Flappy Puff entry in the first picker. Do not add:

- a plugin system;
- dynamic game routes;
- a component registry;
- disabled placeholder games; or
- a catalog file containing planned games.

When a second real game is ready, extract shared card metadata and design its route from that game's actual runtime needs.

## 5. Existing flow

`src/components/puff-experience.tsx` owns three responsibilities:

1. rendering the animated homepage Puff through `PuffScene`;
2. detecting the keyboard and five-logo-click sequences; and
3. navigating to `/puffcade` after either sequence completes.

The keyboard and logo state machines live in `src/lib/puff/secret-code.ts`. Their timing and matching behavior have unit coverage in `tests/unit/puff-secret-code.test.ts`.

`FlappyPuffGame` is the Flappy Puff client instance at `src/app/puffcade/flappy-puff/flappy-puff-game.tsx`, colocated with its CSS module. Its supporting code lives under `src/lib/puff/`, and its leaderboard uses `src/app/api/puff/leaderboard/route.ts`.

## 6. Architecture

### 6.1 Homepage Puff experience

`src/components/puff-experience.tsx`:

- uses Next.js client navigation to push `/puffcade` when either sequence unlocks;
- imports no game code and holds no game-open state; and
- retains keyboard handling, logo-tap handling, tap progress feedback, and `PuffScene`.

### 6.2 The Puffcade route

`src/app/puffcade/page.tsx` is a Server Component that:

- exports the Puffcade title, description, canonical URL, and `robots: { index: false, follow: false }`;
- uses the existing `max-w-5xl` page alignment;
- renders the Puffcade heading and game picker; and
- renders `SiteFooter`.

`SiteNav` continues to come from `src/app/layout.tsx`.

### 6.3 The picker

`src/components/puffcade-game-picker.tsx` is a Server Component that:

- renders the Flappy Puff card from local display metadata;
- uses `next/link` with `prefetch={false}` so viewing the catalog does not download the game route until the player chooses it;
- carries the accessible name `Play Flappy Puff`; and
- contains no hooks, state, or game imports.

### 6.4 The game route

`src/app/puffcade/flappy-puff/page.tsx` is a Server Component that:

- exports the Flappy Puff title, description, canonical URL, and matching `noindex, nofollow` metadata; and
- renders only `<FlappyPuffGame exitHref="/puffcade" />`.

`FlappyPuffGame` is a Client Component that:

- owns the fullscreen shell (`data-arcade-shell="fullscreen"`), labeled by its route `h1`;
- preserves the existing canvas game loop, flap/pause controls, score, and leaderboard behavior;
- exits with `router.replace(exitHref)` from its Exit controls and from Escape while ready or dead; and
- pauses on Escape while playing and resumes on Escape while paused, as before.

### 6.5 Preserved boundaries

No behavior changes are planned for:

- `src/lib/puff/game.ts`;
- `src/lib/puff/render.ts`;
- `src/lib/puff/performance.ts`;
- `src/lib/puff/leaderboard.ts`; or
- `src/app/api/puff/leaderboard/route.ts`.

Change these files only if implementation proves an incompatibility. Record the reason in this document first.

## 7. Puffcade interface

### 7.1 Page hierarchy

The catalog page uses this order:

1. a tilted eyebrow stamp reading `PUFF TRANSMISSION // ARCADE`;
2. the display heading `Puffcade`;
3. one short sentence explaining that this is where Puff-related games live; and
4. the Flappy Puff game card.

Keep the copy short and consistent with the plain language used elsewhere on the site.

### 7.2 Visual direction

Reuse the existing cut-and-paste visual system from `src/app/globals.css` and existing project cards:

- paper and surface backgrounds;
- 2px ink borders;
- hard offset shadows;
- Bricolage Grotesque display type;
- a red hand-drawn underline;
- the existing `StatusStamp` with `status="playable"`; and
- the site's established hover, pressed, and focus treatments.

Do not introduce new colors, fonts, textures, or a separate arcade design system.

### 7.3 Flappy Puff card

The card contains:

- static ASCII Puff artwork generated with the existing `renderPuff` machinery;
- a `PLAYABLE` status stamp;
- the title `Flappy Puff`;
- the detail `ASCII arcade · 1 player`;
- one short gameplay description; and
- a visible `Play →` affordance.

The artwork is decorative and must be hidden from assistive technology. Keep it static. The animated Puff remains exclusive to the homepage.

With one game, constrain the card to approximately `max-w-3xl`. Do not stretch it across the entire `max-w-5xl` page width.

### 7.4 Game shell

The Flappy Puff shell is the existing fullscreen sheet. It has the title block and stats across the top, the bordered canvas arena in the middle, and the controls footer with the always-visible Exit control underneath. Its responsive tiers, coarse-pointer adjustments, and reduced-motion rules are unchanged from the dialog-era stylesheet.

### 7.5 Responsive behavior

- Below the small breakpoint, stack card artwork above the card copy.
- On wider screens, place artwork and copy side by side.
- Keep the whole card as one large pointer target and one keyboard tab stop.
- The game's Exit control must stay reachable at every supported width, including narrow and coarse-pointer screens.
- Add no continuous picker animation.

## 8. Accessibility requirements

- Use correct heading order and semantic page regions; the game route's `h1` is its `FLAPPY PUFF.EXE` title.
- Give the game card a clear accessible name such as `Play Flappy Puff`.
- Keep the playable card as one tab stop.
- Mark decorative ASCII artwork with `aria-hidden="true"`.
- Do not open the game automatically when `/puffcade` loads.
- Preserve the game shell's labeling (`aria-labelledby` / `aria-describedby`) and live score announcements.
- Landing back on `/puffcade` follows normal page-navigation focus; no card-level focus restoration is required.
- Honor the existing reduced-motion rules.
- Do not use color alone to communicate playable status.

## 9. Affected files

### The route-owned game model

- `src/components/puffcade-game-picker.tsx` contains the Server Component link card.
- `src/app/puffcade/page.tsx` contains the catalog route.
- `src/app/puffcade/flappy-puff/page.tsx` contains the Flappy Puff route.
- `src/app/puffcade/flappy-puff/flappy-puff-game.tsx` contains the game client moved from `src/components/puff-game.tsx`.
- `src/app/puffcade/flappy-puff/flappy-puff-game.module.css` contains the game styles moved from `src/components/puff-game.module.css`.
- `src/app/globals.css` contains header suppression, nav-height zeroing, and body scroll lock for fullscreen arcade shells.
- `tests/e2e/puffcade.e2e.ts` contains Puffcade browser coverage.
- `src/components/puff-experience.tsx` contains the homepage triggers.

### Expected to remain unchanged

- `src/components/site-nav.tsx`
- `src/components/site-footer.tsx`
- `src/lib/puff/secret-code.ts`
- Puff physics, rendering, performance, leaderboard, and API files

## 10. Acceptance criteria

Implementation is complete only when all of these statements are true:

- Completing the keyboard sequence on `/` lands on `/puffcade`.
- Clicking the HAM logo five times on `/` lands on `/puffcade`.
- Partial logo clicks retain the existing progress feedback.
- Neither homepage trigger mounts game code.
- The HAM logo remains a normal home link outside the homepage.
- `/puffcade` loads directly without authentication.
- `/puffcade` is not exposed through the main navigation or footer.
- `/puffcade` and `/puffcade/flappy-puff` both request that search engines do not index or follow them.
- Flappy Puff is the only listed game.
- The catalog imports no game implementation.
- Selecting the Flappy Puff card navigates to `/puffcade/flappy-puff`, which renders the existing game and leaderboard behavior fullscreen.
- Exiting the game returns to `/puffcade`; Back from there does not reopen the game.
- The shared site header is hidden while the game is on screen, and the Exit control stays reachable at narrow widths.
- The picker works at mobile and desktop widths.
- Keyboard and assistive-technology behavior remains usable.
- Existing Puff unit and integration tests remain green.
- Type checking, linting, and production build pass.

## 11. Verification commands

Run:

```bash
npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

If the full integration or browser suite requires unavailable external services, run the focused Puffcade and Puff tests locally, record the environmental limitation, and complete the full suite in the configured VPS test environment before deployment.

## 12. Future expansion boundary

The second implemented Puff game is the trigger for revisiting the one-game structure. At that point:

1. extract shared game metadata into a data module;
2. extract a reusable card if the second card shares the same behavior;
3. give the game its own route under `/puffcade`, designed from that game's real runtime needs;
4. add only approved games and factual statuses; and
5. preserve `/puffcade` as the picker entry point.

Do not complete this future work before the second game exists.
