import { describe, expect, it } from "vitest";

import {
  MAX_PRINT_RUN_SCORE,
  isValidPrintRunScore,
} from "@/lib/puff/print-run-leaderboard";

describe("Puff Print Run leaderboard score validation", () => {
  it("accepts bounded safe integers divisible by five", () => {
    for (const value of [0, 5, 25, MAX_PRINT_RUN_SCORE]) {
      expect(isValidPrintRunScore(value)).toBe(true);
    }
  });

  it("rejects boundaries, unsafe values, and nonmultiples of five", () => {
    for (const value of [
      -5,
      -1,
      1,
      4,
      6,
      1.5,
      MAX_PRINT_RUN_SCORE - 1,
      MAX_PRINT_RUN_SCORE + 5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "25",
      null,
      undefined,
    ]) {
      expect(isValidPrintRunScore(value)).toBe(false);
    }
  });
});
