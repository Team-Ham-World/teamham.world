export const SNAKE_GRID_COLS = 22;
export const SNAKE_GRID_ROWS = 16;

export const PUFF_SNAKE_EVENT = {
  NONE: 0,
  ATE: 1 << 0,
  PROOF: 1 << 1,
  CRASHED: 1 << 2,
} as const;

export const PUFF_SNAKE_WORDS = [
  "INK",
  "HAM",
  "ZINE",
  "PAPER",
  "PRESS",
  "STAMP",
  "TONER",
  "PROOF",
  "COPY",
] as const;

export type PuffSnakeEventFlags = number;
export type PuffSnakeDirection = "up" | "down" | "left" | "right";
export type PuffSnakeStatus = "ready" | "running" | "dead";

export interface PuffSnakeCell {
  x: number;
  y: number;
}

export interface PuffSnakePickup extends PuffSnakeCell {
  letter: string;
}

export type PuffSnakeObjective =
  | {
      kind: "word";
      word: string;
      progress: number;
      completedWords: number;
    }
  | { kind: "endless" };

export interface PuffSnakeState {
  status: PuffSnakeStatus;
  score: number;
  snake: PuffSnakeCell[];
  direction: PuffSnakeDirection;
  pendingDirection: PuffSnakeDirection;
  pickup: PuffSnakePickup;
  objective: PuffSnakeObjective;
  tickAccumulator: number;
  rng: number;
}

export const PUFF_SNAKE_WORDS_TO_ENDLESS = 6;

const STARTING_LENGTH = 4;
const START_TICK_INTERVAL_SECONDS = 0.14;
const ENDLESS_TICK_INTERVAL_SECONDS = 0.08;
const TICK_INTERVAL_DROP_PER_WORD_SECONDS = 0.01;
const MAX_CATCH_UP_TICKS = 5;
const ENDLESS_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function tickIntervalForObjective(objective: PuffSnakeObjective): number {
  if (objective.kind === "endless") return ENDLESS_TICK_INTERVAL_SECONDS;
  return Math.max(
    ENDLESS_TICK_INTERVAL_SECONDS,
    START_TICK_INTERVAL_SECONDS -
      objective.completedWords * TICK_INTERVAL_DROP_PER_WORD_SECONDS,
  );
}

export function getPuffSnakeTicksPerSecond(
  objective: PuffSnakeObjective,
): number {
  return 1 / tickIntervalForObjective(objective);
}

function nextRandom(state: PuffSnakeState): number {
  let value = state.rng || 0x6d2b79f5;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 0x1_0000_0000;
}

function cellIsOnSnake(state: PuffSnakeState, x: number, y: number): boolean {
  return state.snake.some((cell) => cell.x === x && cell.y === y);
}

function spawnPickup(state: PuffSnakeState, letter: string): PuffSnakePickup {
  const freeCellCount =
    SNAKE_GRID_COLS * SNAKE_GRID_ROWS - state.snake.length;
  let target = Math.floor(nextRandom(state) * freeCellCount);

  for (let y = 0; y < SNAKE_GRID_ROWS; y++) {
    for (let x = 0; x < SNAKE_GRID_COLS; x++) {
      if (cellIsOnSnake(state, x, y)) continue;
      if (target === 0) return { x, y, letter };
      target -= 1;
    }
  }

  return { x: 0, y: 0, letter };
}

function chooseInitialWord(state: PuffSnakeState): string {
  const index = Math.floor(nextRandom(state) * PUFF_SNAKE_WORDS.length);
  return PUFF_SNAKE_WORDS[index];
}

function chooseNextWord(state: PuffSnakeState, currentWord: string): string {
  let currentIndex = 0;
  for (let index = 0; index < PUFF_SNAKE_WORDS.length; index++) {
    if (PUFF_SNAKE_WORDS[index] === currentWord) {
      currentIndex = index;
      break;
    }
  }

  const offset =
    1 + Math.floor(nextRandom(state) * (PUFF_SNAKE_WORDS.length - 1));
  return PUFF_SNAKE_WORDS[(currentIndex + offset) % PUFF_SNAKE_WORDS.length];
}

function chooseEndlessLetter(state: PuffSnakeState): string {
  const index = Math.floor(nextRandom(state) * ENDLESS_ALPHABET.length);
  return ENDLESS_ALPHABET.charAt(index);
}

function directionsAreOpposite(
  first: PuffSnakeDirection,
  second: PuffSnakeDirection,
): boolean {
  return (
    (first === "up" && second === "down") ||
    (first === "down" && second === "up") ||
    (first === "left" && second === "right") ||
    (first === "right" && second === "left")
  );
}

function nextHead(
  head: PuffSnakeCell,
  direction: PuffSnakeDirection,
): PuffSnakeCell {
  if (direction === "up") return { x: head.x, y: head.y - 1 };
  if (direction === "down") return { x: head.x, y: head.y + 1 };
  if (direction === "left") return { x: head.x - 1, y: head.y };
  return { x: head.x + 1, y: head.y };
}

function cellIsOutsideGrid(cell: PuffSnakeCell): boolean {
  return (
    cell.x < 0 ||
    cell.x >= SNAKE_GRID_COLS ||
    cell.y < 0 ||
    cell.y >= SNAKE_GRID_ROWS
  );
}

function advanceSnake(state: PuffSnakeState): PuffSnakeEventFlags {
  state.direction = state.pendingDirection;
  const head = nextHead(state.snake[0], state.direction);
  const ate =
    head.x === state.pickup.x && head.y === state.pickup.y;
  const collisionLength = ate ? state.snake.length : state.snake.length - 1;
  const hitSelf = state.snake
    .slice(0, collisionLength)
    .some((cell) => cell.x === head.x && cell.y === head.y);

  if (cellIsOutsideGrid(head) || hitSelf) {
    state.status = "dead";
    return PUFF_SNAKE_EVENT.CRASHED;
  }

  state.snake.unshift(head);
  if (!ate) {
    state.snake.pop();
    return PUFF_SNAKE_EVENT.NONE;
  }

  state.score += 10;

  if (state.objective.kind === "endless") {
    state.pickup = spawnPickup(state, chooseEndlessLetter(state));
    return PUFF_SNAKE_EVENT.ATE;
  }

  const objective = state.objective;
  const nextProgress = objective.progress + 1;
  if (nextProgress < objective.word.length) {
    state.objective = { ...objective, progress: nextProgress };
    state.pickup = spawnPickup(state, objective.word.charAt(nextProgress));
    return PUFF_SNAKE_EVENT.ATE;
  }

  state.score += objective.word.length * 5;
  const removableSegments = Math.max(
    0,
    state.snake.length - STARTING_LENGTH,
  );
  const trimCount = Math.min(objective.word.length, removableSegments);
  state.snake.splice(state.snake.length - trimCount, trimCount);
  const completedWords = objective.completedWords + 1;

  if (completedWords >= PUFF_SNAKE_WORDS_TO_ENDLESS) {
    state.objective = { kind: "endless" };
    state.pickup = spawnPickup(state, chooseEndlessLetter(state));
    return PUFF_SNAKE_EVENT.ATE | PUFF_SNAKE_EVENT.PROOF;
  }

  const word = chooseNextWord(state, objective.word);
  state.objective = {
    kind: "word",
    word,
    progress: 0,
    completedWords,
  };
  state.pickup = spawnPickup(state, word.charAt(0));
  return PUFF_SNAKE_EVENT.ATE | PUFF_SNAKE_EVENT.PROOF;
}

export function createPuffSnake(seed = 0x48414d): PuffSnakeState {
  const centerX = Math.floor(SNAKE_GRID_COLS / 2);
  const centerY = Math.floor(SNAKE_GRID_ROWS / 2);
  const state: PuffSnakeState = {
    status: "ready",
    score: 0,
    snake: Array.from({ length: STARTING_LENGTH }, (_, index) => ({
      x: centerX - index,
      y: centerY,
    })),
    direction: "right",
    pendingDirection: "right",
    pickup: { x: 0, y: 0, letter: PUFF_SNAKE_WORDS[0].charAt(0) },
    objective: {
      kind: "word",
      word: PUFF_SNAKE_WORDS[0],
      progress: 0,
      completedWords: 0,
    },
    tickAccumulator: 0,
    rng: seed >>> 0 || 1,
  };

  const word = chooseInitialWord(state);
  state.objective = { kind: "word", word, progress: 0, completedWords: 0 };
  state.pickup = spawnPickup(state, word.charAt(0));
  return state;
}

export function startPuffSnake(state: PuffSnakeState): boolean {
  if (state.status !== "ready") return false;
  state.status = "running";
  return true;
}

export function turnPuffSnake(
  state: PuffSnakeState,
  direction: PuffSnakeDirection,
): boolean {
  if (
    state.status === "dead" ||
    directionsAreOpposite(state.direction, direction)
  ) {
    return false;
  }

  state.pendingDirection = direction;
  return true;
}

export function stepPuffSnake(
  state: PuffSnakeState,
  deltaSeconds: number,
): PuffSnakeEventFlags {
  if (
    state.status !== "running" ||
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return PUFF_SNAKE_EVENT.NONE;
  }

  const frameStartTickInterval = tickIntervalForObjective(state.objective);
  state.tickAccumulator += Math.min(
    frameStartTickInterval * MAX_CATCH_UP_TICKS,
    deltaSeconds,
  );
  let events = PUFF_SNAKE_EVENT.NONE;
  let ticks = 0;

  while (state.status === "running" && ticks < MAX_CATCH_UP_TICKS) {
    const tickInterval = tickIntervalForObjective(state.objective);
    if (state.tickAccumulator < tickInterval) break;
    state.tickAccumulator -= tickInterval;
    events |= advanceSnake(state);
    ticks += 1;
  }

  if (ticks === MAX_CATCH_UP_TICKS) state.tickAccumulator = 0;

  return events;
}
