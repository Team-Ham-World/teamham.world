import { describe, expect, it } from "vitest";
import {
  isValidPufftonScore,
  isValidPufftonStat,
  MAX_PUFFTON_SCORE,
  PUFFTON_LEADERBOARD_SIZE,
} from "@/lib/puffton/leaderboard";

describe("puffton leaderboard validators and constants", () => {
  it("enforces max score and leaderboard size boundaries", () => {
    expect(MAX_PUFFTON_SCORE).toBe(1_000_000);
    expect(PUFFTON_LEADERBOARD_SIZE).toBe(10);
  });

  it("validates valid score integers", () => {
    expect(isValidPufftonScore(0)).toBe(true);
    expect(isValidPufftonScore(100)).toBe(true);
    expect(isValidPufftonScore(1_000_000)).toBe(true);

    expect(isValidPufftonScore(-1)).toBe(false);
    expect(isValidPufftonScore(1_000_001)).toBe(false);
    expect(isValidPufftonScore(3.14)).toBe(false);
    expect(isValidPufftonScore("100")).toBe(false);
    expect(isValidPufftonScore(null)).toBe(false);
    expect(isValidPufftonScore(undefined)).toBe(false);
  });

  it("validates stat integers", () => {
    expect(isValidPufftonStat(0)).toBe(true);
    expect(isValidPufftonStat(50)).toBe(true);
    expect(isValidPufftonStat(-5)).toBe(false);
    expect(isValidPufftonStat("10")).toBe(false);
  });
});
