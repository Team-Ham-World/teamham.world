export type TileEvaluation = "correct" | "present" | "absent";
export type GameStatus = "IN_PROGRESS" | "WON" | "LOST";
export type GameMode = "daily" | "unlimited";

export const WORD_LENGTH = 5;
export const MAX_ATTEMPTS = 6;

export interface PuffdleStats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: Record<number, number>; // 1 to 6 -> count
}

export interface PuffdleGameState {
  mode: GameMode;
  targetWord: string;
  dayNumber: number;
  guesses: string[];
  evaluations: TileEvaluation[][];
  status: GameStatus;
  currentGuess: string;
  keyboardStatus: Record<string, TileEvaluation>;
  pointsEarned: number;
}

/**
 * Evaluates a 5-letter guess against the target word according to standard Wordle rules,
 * correctly handling duplicate letters and letter frequencies.
 */
export function evaluateGuess(targetWord: string, guessWord: string): TileEvaluation[] {
  const target = targetWord.toUpperCase();
  const guess = guessWord.toUpperCase();
  const result: TileEvaluation[] = new Array(WORD_LENGTH).fill("absent");
  const targetCounts: Record<string, number> = {};

  for (let i = 0; i < WORD_LENGTH; i += 1) {
    const char = target[i];
    targetCounts[char] = (targetCounts[char] || 0) + 1;
  }

  // Pass 1: exact matches
  for (let i = 0; i < WORD_LENGTH; i += 1) {
    if (guess[i] === target[i]) {
      result[i] = "correct";
      targetCounts[guess[i]] -= 1;
    }
  }

  // Pass 2: present matches for remaining unmatched letters
  for (let i = 0; i < WORD_LENGTH; i += 1) {
    if (result[i] !== "correct") {
      const char = guess[i];
      if (targetCounts[char] && targetCounts[char] > 0) {
        result[i] = "present";
        targetCounts[char] -= 1;
      }
    }
  }

  return result;
}

/**
 * Calculates score points for a solved Puffdle game based on attempt number (1-6).
 * 1st guess: 600, 2nd: 500, 3rd: 400, 4th: 300, 5th: 200, 6th: 100.
 */
export function calculatePuffdlePoints(attempts: number): number {
  if (attempts >= 1 && attempts <= MAX_ATTEMPTS) {
    return (7 - attempts) * 100;
  }
  return 0;
}

/**
 * Updates keyboard key statuses with new evaluations from a row.
 * Priority: "correct" > "present" > "absent".
 */
export function updateKeyboardStatus(
  current: Record<string, TileEvaluation>,
  guess: string,
  evaluation: TileEvaluation[],
): Record<string, TileEvaluation> {
  const next = { ...current };
  const upperGuess = guess.toUpperCase();

  for (let i = 0; i < WORD_LENGTH; i += 1) {
    const letter = upperGuess[i];
    const status = evaluation[i];
    const existing = next[letter];

    if (!existing) {
      next[letter] = status;
    } else if (existing === "present" && status === "correct") {
      next[letter] = "correct";
    } else if (existing === "absent" && (status === "correct" || status === "present")) {
      next[letter] = status;
    }
  }
  return next;
}

/**
 * Creates a clean initial Puffdle game state.
 */
export function createInitialPuffdleState(
  targetWord: string,
  mode: GameMode,
  dayNumber = 0,
): PuffdleGameState {
  return {
    mode,
    targetWord: targetWord.toUpperCase(),
    dayNumber,
    guesses: [],
    evaluations: [],
    status: "IN_PROGRESS",
    currentGuess: "",
    keyboardStatus: {},
    pointsEarned: 0,
  };
}

/**
 * Submits a valid guess into the game state and returns the updated state.
 */
export function submitGuess(
  state: PuffdleGameState,
  guess: string,
): { state: PuffdleGameState; error?: string } {
  const upperGuess = guess.trim().toUpperCase();

  if (state.status !== "IN_PROGRESS") {
    return { state, error: "Game is already finished." };
  }
  if (upperGuess.length !== WORD_LENGTH) {
    return { state, error: "Guess must be 5 letters." };
  }
  if (state.guesses.length >= MAX_ATTEMPTS) {
    return { state, error: "No attempts remaining." };
  }

  const evaluation = evaluateGuess(state.targetWord, upperGuess);
  const nextGuesses = [...state.guesses, upperGuess];
  const nextEvaluations = [...state.evaluations, evaluation];
  const isWon = upperGuess === state.targetWord;
  const isLost = !isWon && nextGuesses.length >= MAX_ATTEMPTS;
  const nextStatus: GameStatus = isWon ? "WON" : isLost ? "LOST" : "IN_PROGRESS";
  const points = isWon ? calculatePuffdlePoints(nextGuesses.length) : 0;
  const nextKeyboard = updateKeyboardStatus(state.keyboardStatus, upperGuess, evaluation);

  return {
    state: {
      ...state,
      guesses: nextGuesses,
      evaluations: nextEvaluations,
      status: nextStatus,
      currentGuess: "",
      keyboardStatus: nextKeyboard,
      pointsEarned: points,
    },
  };
}

/**
 * Generates the spoiler-free emoji share text grid for a completed game.
 */
export function generateShareGrid(state: PuffdleGameState): string {
  const header =
    state.mode === "daily"
      ? `PUFFDLE #${state.dayNumber} ${state.status === "WON" ? state.guesses.length : "X"}/${MAX_ATTEMPTS}`
      : `PUFFDLE UNLIMITED ${state.status === "WON" ? state.guesses.length : "X"}/${MAX_ATTEMPTS}`;

  const rows = state.evaluations.map((row) =>
    row
      .map((tile) => {
        switch (tile) {
          case "correct":
            return "🟩";
          case "present":
            return "🟨";
          case "absent":
          default:
            return "⬛";
        }
      })
      .join(""),
  );

  return `${header}\n\n${rows.join("\n")}\n\nhttps://teamham.world/puffdle`;
}

/**
 * Updates stats given game outcome.
 */
export function recordGameResult(
  currentStats: PuffdleStats,
  isWon: boolean,
  attempts: number,
): PuffdleStats {
  const gamesPlayed = currentStats.gamesPlayed + 1;
  const gamesWon = isWon ? currentStats.gamesWon + 1 : currentStats.gamesWon;
  const currentStreak = isWon ? currentStats.currentStreak + 1 : 0;
  const maxStreak = Math.max(currentStats.maxStreak, currentStreak);
  const guessDistribution = { ...currentStats.guessDistribution };

  if (isWon && attempts >= 1 && attempts <= MAX_ATTEMPTS) {
    guessDistribution[attempts] = (guessDistribution[attempts] || 0) + 1;
  }

  return {
    gamesPlayed,
    gamesWon,
    currentStreak,
    maxStreak,
    guessDistribution,
  };
}

export function createDefaultStats(): PuffdleStats {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    guessDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  };
}
