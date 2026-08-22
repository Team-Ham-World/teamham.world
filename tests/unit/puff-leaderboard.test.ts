import { describe, expect, it } from "vitest";

import { MAX_PUFF_SCORE, isValidPuffScore } from "@/lib/puff/leaderboard";

describe("Puff leaderboard score validation", () => {
  it("accepts bounded whole-number scores", () => {
    expect(isValidPuffScore(0)).toBe(true);
    expect(isValidPuffScore(42)).toBe(true);
    expect(isValidPuffScore(MAX_PUFF_SCORE)).toBe(true);
  });

  it("rejects values that should never reach the database", () => {
    for (const value of [-1, 1.5, MAX_PUFF_SCORE + 1, Number.NaN, "12", null]) {
      expect(isValidPuffScore(value)).toBe(false);
    }
  });
});
