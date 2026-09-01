import { describe, expect, it } from "vitest";

import {
  PUFFDLE_TARGET_WORDS,
  getCyclePermutation,
  getDailyWord,
  getUtcDayNumber,
  isValidGuess,
} from "@/lib/puffdle/words";

describe("Puffdle words and daily cycle", () => {
  it("contains curated unique 5-letter target words", () => {
    expect(PUFFDLE_TARGET_WORDS.length).toBeGreaterThan(1500);
    const seen = new Set<string>();
    for (const word of PUFFDLE_TARGET_WORDS) {
      expect(word).toHaveLength(5);
      expect(/^[a-z]{5}$/.test(word)).toBe(true);
      expect(seen.has(word)).toBe(false);
      seen.add(word);
    }
  });

  it("determines UTC day numbers consistently across dates", () => {
    const epochDay = getUtcDayNumber(new Date("2024-01-01T00:00:00.000Z"));
    expect(epochDay).toBe(0);

    const nextDay = getUtcDayNumber(new Date("2024-01-02T12:00:00.000Z"));
    expect(nextDay).toBe(1);

    const day100 = getUtcDayNumber(new Date("2024-04-10T00:00:00.000Z"));
    expect(day100).toBe(100);
  });

  it("produces a deterministic daily word for any date", () => {
    const testDate = new Date("2026-08-31T15:30:00.000Z");
    const result1 = getDailyWord(testDate);
    const result2 = getDailyWord(testDate);

    expect(result1.word).toBe(result2.word);
    expect(result1.dayNumber).toBe(result2.dayNumber);
    expect(result1.word).toHaveLength(5);
    expect(PUFFDLE_TARGET_WORDS).toContain(result1.word);
  });

  it("generates a full permutation where every word appears exactly once in a cycle", () => {
    const poolSize = PUFFDLE_TARGET_WORDS.length;
    const perm0 = getCyclePermutation(0, poolSize);

    expect(perm0).toHaveLength(poolSize);
    const uniqueIndices = new Set(perm0);
    expect(uniqueIndices.size).toBe(poolSize);

    for (let i = 0; i < poolSize; i += 1) {
      expect(uniqueIndices.has(i)).toBe(true);
    }
  });

  it("guarantees non-repeating words across all consecutive days within a cycle", () => {
    const poolSize = PUFFDLE_TARGET_WORDS.length;
    const wordsInCycle = new Set<string>();

    for (let day = 0; day < poolSize; day += 1) {
      // Simulate epoch + day days
      const simulatedTime = Date.UTC(2024, 0, 1) + day * 86_400_000;
      const daily = getDailyWord(simulatedTime);
      expect(wordsInCycle.has(daily.word)).toBe(false);
      wordsInCycle.add(daily.word);
    }

    expect(wordsInCycle.size).toBe(poolSize);
  });

  it("validates valid guesses and rejects invalid words", () => {
    expect(isValidGuess("cigar")).toBe(true);
    expect(isValidGuess("SPEED")).toBe(true);
    expect(isValidGuess("hello")).toBe(true);
    expect(isValidGuess("world")).toBe(true);

    // Invalid non-words or wrong lengths
    expect(isValidGuess("abcde")).toBe(false);
    expect(isValidGuess("zzzzz")).toBe(false);
    expect(isValidGuess("four")).toBe(false);
    expect(isValidGuess("toolong")).toBe(false);
    expect(isValidGuess("")).toBe(false);
    expect(isValidGuess(12345 as unknown as string)).toBe(false);
  });
});
