import { describe, expect, it } from "vitest";

import {
  MAX_PUFFDLE_SCORE,
  MAX_PUFFDLE_STAT,
  isValidPuffdleScore,
  isValidPuffdleStat,
} from "@/lib/puffdle/leaderboard";

describe("Puffdle leaderboard score and stat validation", () => {
  it("accepts valid bounded whole-number scores", () => {
    expect(isValidPuffdleScore(0)).toBe(true);
    expect(isValidPuffdleScore(600)).toBe(true);
    expect(isValidPuffdleScore(MAX_PUFFDLE_SCORE)).toBe(true);
  });

  it("rejects invalid score values", () => {
    for (const value of [-1, 1.5, MAX_PUFFDLE_SCORE + 1, Number.NaN, "600", null, undefined, {}]) {
      expect(isValidPuffdleScore(value)).toBe(false);
    }
  });

  it("accepts valid bounded stat numbers", () => {
    expect(isValidPuffdleStat(0)).toBe(true);
    expect(isValidPuffdleStat(100)).toBe(true);
    expect(isValidPuffdleStat(MAX_PUFFDLE_STAT)).toBe(true);
  });

  it("rejects invalid stat values", () => {
    for (const value of [-1, 2.5, MAX_PUFFDLE_STAT + 1, Number.NaN, "10", null, undefined]) {
      expect(isValidPuffdleStat(value)).toBe(false);
    }
  });
});
