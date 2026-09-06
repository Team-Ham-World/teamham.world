import { describe, expect, it } from "vitest";
import { createDefaultStats, createInitialPuffdleState, submitGuess } from "@/lib/puffdle/game";
import { parseStoredStats, restoreDailyGame } from "@/lib/puffdle/storage";
import { parseLeaderboardPayload } from "@/lib/puffdle/contracts";

const daily = { word: "SPEED", dayNumber: 42 };

describe("Puffdle stored state", () => {
  it("reconstructs a completed daily game from valid guesses", () => {
    const won = submitGuess(createInitialPuffdleState("SPEED", "daily", 42), "SPEED").state;
    expect(restoreDailyGame({ ...won, pointsEarned: 99999, evaluations: null, keyboardStatus: [], status: "LOST" }, daily)).toEqual(won);
  });

  it("rejects malformed, wrong-day and impossible daily games", () => {
    const initial = createInitialPuffdleState("SPEED", "daily", 42);
    for (const saved of [null, [], {}, { ...initial, dayNumber: 41 }, { ...initial, targetWord: "OTHER" },
      { ...initial, guesses: null }, { ...initial, guesses: ["SPEED", "SPEED"] },
      { ...initial, guesses: ["ZZZZZ"] }, { ...initial, currentGuess: "12345" }]) {
      expect(restoreDailyGame(saved, daily)).toBeNull();
    }
  });

  it("validates all saved statistics and the distribution", () => {
    const stats = createDefaultStats();
    expect(parseStoredStats(stats)).toEqual(stats);
    for (const bad of [null, {}, { ...stats, currentStreak: -1 }, { ...stats, gamesWon: 3 },
      { ...stats, guessDistribution: {} }, { ...stats, guessDistribution: { ...stats.guessDistribution, 1: "1" } }]) {
      expect(parseStoredStats(bad)).toBeNull();
    }
  });
});

describe("Puffdle leaderboard response validation", () => {
  const valid = { authenticated: true, username: "puff", personalBest: 500,
    stats: { gamesPlayed: 1, gamesWon: 1, currentStreak: 1, maxStreak: 1 },
    scores: [{ rank: 1, username: "puff", score: 500, mine: true }] };
  it("accepts member and signed-out responses", () => {
    expect(parseLeaderboardPayload(valid)).toEqual(valid);
    expect(parseLeaderboardPayload({ authenticated: false })).toEqual({ authenticated: false, username: null });
  });
  it("rejects corrupted statistics and rankings before rendering them", () => {
    for (const bad of [{ ...valid, stats: [] }, { ...valid, stats: {} }, { ...valid, personalBest: 900 },
      { ...valid, scores: [{ ...valid.scores[0], rank: -1 }] },
      { ...valid, scores: [{ ...valid.scores[0], score: "500" }] }]) {
      expect(parseLeaderboardPayload(bad)).toBeNull();
    }
  });
});
