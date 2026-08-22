import { describe, expect, it } from "vitest";

import { getPuffRenderProfile } from "@/lib/puff/performance";

describe("Flappy Puff render profile", () => {
  it("caps coarse-pointer displays to a low-cost mobile render budget", () => {
    expect(
      getPuffRenderProfile({
        devicePixelRatio: 3,
        coarsePointer: true,
      }),
    ).toEqual({
      pixelRatio: 1.25,
      frameIntervalMs: 1000 / 30,
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
      frameIntervalMs: 1000 / 60,
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
});
