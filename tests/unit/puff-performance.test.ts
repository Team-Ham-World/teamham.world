import { describe, expect, it } from "vitest";

import {
  advancePuffRenderClock,
  getPuffRenderProfile,
  type PuffRenderCadence,
  type PuffRenderPhase,
} from "@/lib/puff/performance";

const FRAME_INTERVAL_60_FPS = 1000 / 60;
const FRAME_INTERVAL_120_HZ = 1000 / 120;
const CAPPED_60_FPS: PuffRenderCadence = {
  kind: "capped",
  frameIntervalMs: FRAME_INTERVAL_60_FPS,
};

function runRenderFrames(
  accumulatorMs: number,
  phase: PuffRenderPhase,
  frameCount: number,
) {
  let draws = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const step = advancePuffRenderClock({
      accumulatorMs,
      elapsedMs: FRAME_INTERVAL_120_HZ,
      cadence: CAPPED_60_FPS,
      phase,
      forceDraw: frame === 0,
      canDraw: true,
    });
    accumulatorMs = step.accumulatorMs;
    if (step.shouldDraw) draws += 1;
  }

  return { accumulatorMs, draws };
}

describe("Flappy Puff render profile", () => {
  it("caps mobile pixel density without sacrificing 60 FPS motion", () => {
    expect(
      getPuffRenderProfile({
        devicePixelRatio: 3,
        coarsePointer: true,
      }),
    ).toEqual({
      pixelRatio: 1.25,
      cadence: CAPPED_60_FPS,
    });
  });

  it("keeps desktop rendering crisp without following high-refresh displays", () => {
    expect(
      getPuffRenderProfile({
        devicePixelRatio: 2,
        coarsePointer: false,
      }),
    ).toEqual({
      pixelRatio: 1.5,
      cadence: CAPPED_60_FPS,
    });
  });

  it("does not upscale a one-to-one display", () => {
    expect(
      getPuffRenderProfile({
        devicePixelRatio: 1,
        coarsePointer: true,
      }).pixelRatio,
    ).toBe(1);
  });

  it("keeps replay and resume at 60 FPS after static screens", () => {
    let clock = runRenderFrames(0, "playing", 150);
    const firstRunDraws = clock.draws;

    clock = runRenderFrames(clock.accumulatorMs, "dead", 180);
    const deathScreenDraws = clock.draws;
    const deathScreenDebtMs = clock.accumulatorMs;

    clock = runRenderFrames(clock.accumulatorMs, "playing", 150);
    const replayDraws = clock.draws;

    clock = runRenderFrames(clock.accumulatorMs, "paused", 180);
    const pauseScreenDraws = clock.draws;
    const pauseScreenDebtMs = clock.accumulatorMs;

    clock = runRenderFrames(clock.accumulatorMs, "playing", 150);
    const resumedDraws = clock.draws;

    expect({
      firstRunDraws,
      deathScreenDraws,
      deathScreenDebtMs,
      replayDraws,
      pauseScreenDraws,
      pauseScreenDebtMs,
      resumedDraws,
    }).toEqual({
      firstRunDraws: 75,
      deathScreenDraws: 1,
      deathScreenDebtMs: 0,
      replayDraws: 75,
      pauseScreenDraws: 1,
      pauseScreenDebtMs: 0,
      resumedDraws: 75,
    });
  });

  it("can render every frame supplied by a high-refresh display", () => {
    let accumulatorMs = 0;
    let draws = 0;

    for (let frame = 0; frame < 144; frame += 1) {
      const step = advancePuffRenderClock({
        accumulatorMs,
        elapsedMs: 1000 / 144,
        cadence: { kind: "display" },
        phase: "playing",
        forceDraw: false,
        canDraw: true,
      });
      accumulatorMs = step.accumulatorMs;
      if (step.shouldDraw) draws += 1;
    }

    expect(draws).toBe(144);
    expect(accumulatorMs).toBe(0);
  });
});
