# Puffcade Implementation Plan

**Document Status**: APPROVED PLAN / NOT YET IMPLEMENTED
**Date**: 2026-09-01
**Target Area**: Homepage Puff easter eggs, `/puffcade`, and Flappy Puff launch flow
**Primary Existing Code**: `src/components/puff-experience.tsx` and `src/components/puff-game.tsx`

## 1. Document authority

This document is the source of truth for the first Puffcade implementation. Implementation work must follow the behavior, boundaries, sequence, and acceptance criteria below.

If implementation reveals that a decision here is unsafe or incompatible with the installed framework, update this document before changing the planned behavior. Do not silently add scope or introduce a different game architecture.

## 2. Goal

Replace the two existing direct Flappy Puff unlock paths with navigation to `/puffcade`:

- completing the Puff keyboard sequence on the homepage; and
- clicking the HAM logo five times on the homepage.

`/puffcade` is an on-theme picker for Puff-related games. The first version contains one playable game, Flappy Puff, and supports adding real games later without building speculative game infrastructure now.

## 3. Required v1 behavior

1. Completing the existing keyboard sequence on `/` navigates to `/puffcade`.
2. Completing the existing five-logo-click sequence on `/` navigates to `/puffcade`.
3. Neither trigger opens Flappy Puff directly from the homepage.
4. `/puffcade` displays one playable game card for Flappy Puff.
5. Selecting the card opens the existing `PuffGame` dialog while the visitor remains on `/puffcade`.
6. Closing the game returns focus to the Flappy Puff card.
7. The existing game engine, controls, local best score, leaderboard, and API behavior remain unchanged.
8. Future games are not displayed until they exist and have approved names and descriptions.

## 4. Product decisions

### 4.1 Puffcade remains an easter egg

Puffcade remains intentionally unlisted in v1:

- do not add it to `SiteNav`;
- do not add it to `SiteFooter`;
- do not add another homepage link; and
- set the route metadata to prevent search indexing.

The route remains directly addressable for visitors who know the URL.

### 4.2 Triggers remain homepage-only

The keyboard and logo-click listeners currently exist because `PuffExperience` is mounted on the homepage. Preserve that boundary.

On other routes, the HAM logo continues to behave as an ordinary link to `/`. Do not move the secret listeners into the root layout or shared navigation in v1.

### 4.3 Flappy Puff remains a dialog

Selecting Flappy Puff from the picker mounts the existing `PuffGame` dialog on `/puffcade`. Do not add `/puffcade/flappy-puff` or change `PuffGame` into a page in v1.

This reuses the existing dialog lifecycle, controls, responsive layout, scroll lock, leaderboard behavior, and accessible labeling.

### 4.4 No speculative game framework

Hardcode the single Flappy Puff entry in the first picker. Do not add:

- a plugin system;
- dynamic game routes;
- a component registry;
- disabled placeholder games; or
- a catalog file containing planned games.

When a second real game is ready, extract shared card metadata and decide whether games should continue opening as dialogs or receive dedicated routes. Make that decision from the second game's actual runtime needs.

## 5. Existing flow

`src/components/puff-experience.tsx` currently owns three responsibilities:

1. rendering the animated homepage Puff through `PuffScene`;
2. detecting the keyboard and five-logo-click sequences; and
3. mounting `PuffGame` after either sequence completes.

The keyboard and logo state machines live in `src/lib/puff/secret-code.ts`. Their timing and matching behavior already have unit coverage in `tests/unit/puff-secret-code.test.ts`.

`PuffGame` is a self-contained dialog in `src/components/puff-game.tsx`. Its supporting code lives under `src/lib/puff/`, and its leaderboard uses `src/app/api/puff/leaderboard/route.ts`.

## 6. Planned architecture

### 6.1 Simplify the homepage Puff experience

Modify `src/components/puff-experience.tsx`:

- use Next.js client navigation to push `/puffcade` when either sequence unlocks;
- remove the `PuffGame` import and conditional mount;
- remove `gameOpen` state;
- remove modal-only focus and scroll restoration;
- remove game-driven `PuffScene` suspension; and
- retain keyboard handling, logo-tap handling, tap progress feedback, and `PuffScene`.

Keep the existing sequence rules, timeouts, event filtering, and progress indicator unchanged.

### 6.2 Add the Puffcade route

Add `src/app/puffcade/page.tsx` as a Server Component.

The page must:

- export a Puffcade title, description, and canonical URL;
- export `robots: { index: false, follow: false }` while Puffcade remains secret;
- use the existing `max-w-5xl` page alignment;
- render the Puffcade heading and game picker; and
- render `SiteFooter`.

`SiteNav` continues to come from `src/app/layout.tsx`.

### 6.3 Add the client-side picker

Add `src/components/puffcade-game-picker.tsx`.

The component must:

- render the Flappy Puff card;
- use a semantic `<button>` for the card because it opens a dialog rather than navigating;
- store whether the game is open;
- mount `<PuffGame>` only after selection;
- pass an exit callback to `PuffGame`; and
- restore focus to the card after exit.

Do not duplicate game logic or leaderboard requests in the picker.

### 6.4 Preserve existing game boundaries

No behavior changes are planned for:

- `src/components/puff-game.tsx`;
- `src/lib/puff/game.ts`;
- `src/lib/puff/render.ts`;
- `src/lib/puff/performance.ts`;
- `src/lib/puff/leaderboard.ts`; or
- `src/app/api/puff/leaderboard/route.ts`.

Change these files only if implementation proves that the existing dialog cannot be mounted from `/puffcade`. Record the reason in this document first.

## 7. Puffcade interface

### 7.1 Page hierarchy

The page uses this order:

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

### 7.4 Responsive behavior

- Below the small breakpoint, stack artwork above the card copy.
- On wider screens, place artwork and copy side by side.
- Keep the whole card as one large pointer target and one keyboard tab stop.
- Preserve the existing game dialog's responsive behavior.
- Add no continuous picker animation.

## 8. Accessibility requirements

- Use correct heading order and semantic page regions.
- Give the game card a clear accessible name such as `Play Flappy Puff`.
- Keep the playable card as one tab stop.
- Mark decorative ASCII artwork with `aria-hidden="true"`.
- Do not open the game automatically when `/puffcade` loads.
- Preserve `PuffGame` dialog labeling and live score announcements.
- Restore focus to the game card after closing the dialog.
- Honor the existing reduced-motion rules.
- Do not use color alone to communicate playable status.

## 9. Affected files

### Modify

- `src/components/puff-experience.tsx`

### Add

- `src/app/puffcade/page.tsx`
- `src/components/puffcade-game-picker.tsx`
- a colocated CSS module only if the existing global utilities cannot express the required static artwork or layout cleanly
- a focused Puffcade browser test under `tests/e2e/`

### Expected to remain unchanged

- `src/components/puff-game.tsx`
- `src/components/site-nav.tsx`
- `src/components/site-footer.tsx`
- `src/lib/puff/secret-code.ts`
- Puff physics, rendering, performance, leaderboard, and API files

## 10. Implementation sequence

### Phase 0: confirm framework guidance

Read `AGENTS.md` and the relevant installed Next.js guides under `node_modules/next/dist/docs/` before changing application code. Confirm the current guidance for route metadata, client navigation, and Server Component to Client Component boundaries.

### Phase 1: build the Puffcade destination

1. Add `/puffcade` metadata and page structure.
2. Add the Flappy Puff card and static artwork.
3. Mount the existing game dialog from the picker.
4. Restore focus when the dialog closes.
5. Verify direct navigation to `/puffcade` and the full game lifecycle.

### Phase 2: redirect the easter eggs

1. Replace the homepage game-opening callback with navigation to `/puffcade`.
2. Remove modal-only state and cleanup code from `PuffExperience`.
3. Keep both sequence state machines and their feedback unchanged.
4. Confirm that the homepage no longer mounts `PuffGame`.

### Phase 3: add regression coverage

Add a focused Playwright test that proves:

1. the keyboard sequence navigates from `/` to `/puffcade`;
2. five HAM logo clicks navigate from `/` to `/puffcade`;
3. selecting Flappy Puff opens the game dialog;
4. closing the dialog restores focus to the card; and
5. the HAM logo remains an ordinary home link on non-home routes.

### Phase 4: final verification

Run targeted tests first, followed by repository checks and browser inspection at mobile and desktop sizes.

## 11. Acceptance criteria

Implementation is complete only when all of these statements are true:

- Completing the keyboard sequence on `/` lands on `/puffcade`.
- Clicking the HAM logo five times on `/` lands on `/puffcade`.
- Partial logo clicks retain the existing progress feedback.
- Neither homepage trigger mounts the game dialog.
- The HAM logo remains a normal home link outside the homepage.
- `/puffcade` loads directly without authentication.
- `/puffcade` is not exposed through the main navigation or footer.
- `/puffcade` requests that search engines do not index or follow it.
- Flappy Puff is the only listed game.
- Selecting Flappy Puff opens the existing game and leaderboard behavior.
- Exiting the game returns focus to its card.
- The picker works at mobile and desktop widths.
- Keyboard and assistive-technology behavior remains usable.
- Existing Puff unit and integration tests remain green.
- Type checking, linting, and production build pass.

## 12. Verification commands

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

## 13. Future expansion boundary

The second implemented Puff game is the trigger for revisiting the one-game structure. At that point:

1. extract shared game metadata into `src/data/puffcade.ts`;
2. extract a reusable card if the second card shares the same behavior;
3. choose dialog launch or dedicated game routes based on both games' real needs;
4. add only approved games and factual statuses; and
5. preserve `/puffcade` as the picker entry point.

Do not complete this future work as part of v1.
