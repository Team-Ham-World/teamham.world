import { describe, expect, it } from "vitest";

import {
  MAX_SUIPUFF_SCORE,
  isValidSuipuffScore,
} from "@/lib/puff/suipuff-leaderboard";

describe("Suipuff leaderboard score validation", () => {
  it("accepts any bounded safe integer — Suipuff scores are unquantised", () => {
    for (const value of [0, 1, 3, 7, 42, 999_999, MAX_SUIPUFF_SCORE]) {
      expect(isValidSuipuffScore(value)).toBe(true);
    }
  });

  it("rejects out-of-range, unsafe, and non-numeric values", () => {
    for (const value of [
      -1,
      -100,
      1.5,
      MAX_SUIPUFF_SCORE + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "25",
      null,
      undefined,
      { score: 10 },
    ]) {
      expect(isValidSuipuffScore(value)).toBe(false);
    }
  });
});
