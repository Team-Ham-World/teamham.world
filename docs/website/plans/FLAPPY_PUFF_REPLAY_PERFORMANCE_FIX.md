# Flappy Puff Replay Performance Fix

**Document Status**: DIAGNOSED / IMPLEMENTATION DEFERRED
**Date Diagnosed**: 2026-08-25
**Primary Code**: `src/components/puff-game.tsx`
**Test Seam**: `src/lib/puff/performance.ts` and `tests/unit/puff-performance.test.ts`

## 1. Purpose and scope

Use this document after the current repository work is complete to fix the confirmed Flappy Puff replay performance regression. Reinspect the named files before implementation because concurrent work may have moved or changed the code described here.

This fix covers the canvas render scheduler when a run resumes from a static phase:

- starting another run from the game-over screen;
- resuming after a pause; and
- preserving the existing 60 FPS canvas cap on high-refresh displays.

Keep game physics, sprite generation, pixel-density limits, leaderboard behavior, controls, and visual design unchanged. The fix requires no new dependency, API, database, or schema work.

## 2. Confirmed regression

The game targets a 60 FPS canvas cadence through `getPuffRenderProfile()`. The first run respects that cap. After Puff dies, time spent on the results screen is incorrectly retained as render debt. The next run then paints at the display's full refresh rate until that debt drains.

A browser lifecycle probe on a 120 Hz display produced:

| Scenario | Canvas paints | Active span | Mean paint interval |
| --- | ---: | ---: | ---: |
| First run | 75 | 1.233 s | 16.66 ms |
| Immediate replay | 74 | 1.217 s | 16.67 ms |
| Replay after 1.5 s on results screen | 149 | 1.232 s | 8.33 ms |

The delayed replay therefore performs approximately twice the intended canvas work. Lower-powered devices can present that extra main-thread and raster work as visible lag.

The same probe found no duplicate animation loop on immediate replay, no game-canvas size or attribute mutations during delayed replay, and no replay network requests. Resize churn and leaderboard traffic are not causes of this regression.

## 3. Root cause

In the empty-dependency canvas effect inside `PuffGame`, the frame callback currently:

1. adds every animation-frame interval to `renderAccumulatorMs`;
2. treats only `ready` and `playing` as moving phases;
3. draws the first frame after entering `dead` or `paused` because the phase changed;
4. stops drawing subsequent static frames; and
5. resets `renderAccumulatorMs` only inside the drawing branch.

After the transition draw, each `dead` or `paused` animation frame continues increasing `renderAccumulatorMs`, but no drawing branch runs to clear it. Returning to `playing` exposes the accumulated value to `movingFrameIsDue`, so every `requestAnimationFrame` callback qualifies for a paint.

On a 120 Hz display, each replay frame adds about 8.33 ms and a paint subtracts only the 16.67 ms target interval. The scheduler consequently paints at 120 FPS while the stale accumulator drains. The length of the over-rendering burst tracks the time spent on the static screen.

## 4. Required behavior

The implementation is complete only when all of these invariants hold:

- `ready` and `playing` target the configured 60 FPS render cadence regardless of display refresh rate.
- `dead` and `paused` retain no render debt.
- A phase transition or resize may request one immediate redraw.
- Starting or resuming after any static dwell begins with a fresh render clock.
- Fixed-step physics and its separate `accumulator` retain their current behavior.
- The animation frame and `ResizeObserver` cleanup behavior remains intact.
- Canvas dimensions and the pixel-ratio profile remain unchanged.

## 5. Preferred implementation

Keep the change inside the render scheduler. Determine whether the scene is moving before advancing the render accumulator, then retain elapsed render time only for moving phases:

```ts
const sceneIsMoving = currentPhase === "playing" || currentPhase === "ready";
renderAccumulatorMs = sceneIsMoving
  ? renderAccumulatorMs + elapsedMs
  : 0;
```

Continue using `phaseChanged` and `needsRedraw` to permit the one required static redraw. After a moving frame is painted, continue subtracting one configured frame interval as the scheduler does today.

Apply this behavior at the scheduler level instead of resetting only in `createFreshRun()`. A replay-only reset would leave pause/resume with the same defect. Do not change `getPuffRenderProfile()` to follow the display refresh rate; its 60 FPS cap is intentional.

## 6. Regression test

Extend the pure performance seam so the scheduling rule can be tested without browser timing or a mocked canvas. The component must consume the same exported scheduling logic the unit test exercises; a test-only duplicate of the algorithm is not sufficient.

Add deterministic 120 Hz sequences covering:

1. a first moving run, which paints at approximately 60 FPS;
2. at least 1.5 seconds in `dead`, during which render debt remains zero;
3. a replay, which has the same paint count and cadence as the first run;
4. at least 1.5 seconds in `paused`; and
5. a resumed run, which also returns immediately to the 60 FPS cadence.

Assert the scheduling behavior and accumulator state, not wall-clock execution speed. Preserve the existing render-profile tests.

## 7. Verification

Run the targeted model and performance tests, then the repository checks:

```bash
npm test -- --run tests/unit/puff-game.test.ts tests/unit/puff-performance.test.ts
npm run typecheck
npm run lint
```

Repeat the browser lifecycle probe on a 120 Hz display or equivalent high-refresh test environment:

1. Unlock Flappy Puff and start a run with one flap.
2. Let Puff die without further input.
3. Wait at least 1.5 seconds on the results screen.
4. Start the next run and count one stable canvas operation per painted frame.
5. Repeat after pausing for at least 1.5 seconds and resuming.

Acceptance criteria:

- The first run, delayed replay, and resumed run each average about 16.67 ms between canvas paints.
- Replay and resume paint counts are within 10% of the first-run count over the same active duration.
- Neither replay nor resume produces an initial 8.33 ms paint burst on a 120 Hz display.
- The results and pause screens remain static after their transition redraw.
- All targeted tests, type checking, and linting pass.

## 8. Delivery boundary

Keep the implementation limited to the scheduler, its shared pure test seam, and regression coverage. If the current code no longer matches the root-cause sequence in section 3, rerun the lifecycle probe before changing it; a different measurement requires a new diagnosis rather than carrying this fix forward by analogy.
