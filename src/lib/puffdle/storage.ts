import { isValidPuffdleStat, isValidPuffdleStats } from "./contracts";
import { createInitialPuffdleState, submitGuess, type PuffdleGameState, type PuffdleStats } from "./game";
import { isValidGuess } from "./words";

export function parseStoredStats(value: unknown): PuffdleStats | null {
  if (!isValidPuffdleStats(value) || !("guessDistribution" in value)) return null;
  const distribution = value.guessDistribution;
  if (!distribution || typeof distribution !== "object" || Array.isArray(distribution)) return null;
  const guessDistribution: Record<number, number> = {};
  for (let attempt = 1; attempt <= 6; attempt++) {
    const count = (distribution as Record<string, unknown>)[attempt];
    if (!isValidPuffdleStat(count)) return null;
    guessDistribution[attempt] = count;
  }
  if (Object.values(guessDistribution).reduce((sum, count) => sum + count, 0) !== value.gamesWon) return null;
  return { ...value, guessDistribution };
}

export function restoreDailyGame(value: unknown, daily: { word: string; dayNumber: number }): PuffdleGameState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  if (
    saved.mode !== "daily" || saved.dayNumber !== daily.dayNumber ||
    typeof saved.targetWord !== "string" || saved.targetWord.toUpperCase() !== daily.word.toUpperCase() ||
    !Array.isArray(saved.guesses) || saved.guesses.length > 6 ||
    typeof saved.currentGuess !== "string" || !/^[A-Z]{0,5}$/.test(saved.currentGuess)
  ) return null;
  let state = createInitialPuffdleState(daily.word, "daily", daily.dayNumber);
  for (const guess of saved.guesses) {
    if (typeof guess !== "string" || !isValidGuess(guess) || state.status !== "IN_PROGRESS") return null;
    state = submitGuess(state, guess).state;
  }
  // Rebuild evaluations, score, status and keyboard colors from guesses rather
  // than trusting derived fields persisted by an older or damaged client.
  return { ...state, currentGuess: state.status === "IN_PROGRESS" ? saved.currentGuess : "" };
}
