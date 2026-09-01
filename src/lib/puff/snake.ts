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

export interface PuffSnakeState {
  status: PuffSnakeStatus;
  score: number;
  snake: PuffSnakeCell[];
  direction: PuffSnakeDirection;
  pendingDirection: PuffSnakeDirection;
  pickup: PuffSnakePickup;
  word: string;
  wordProgress: number;
  tickInterval: number;
  tickAccumulator: number;
  rng: number;
}

const STARTING_LENGTH = 4;
const BASE_TICK_INTERVAL = 0.14;
const MIN_TICK_INTERVAL = 0.08;
const SPEEDUP_PER_POINT = 0.0004;
const MAX_FRAME_DELTA = 0.05;

function nextRandom(state: PuffSnakeState): number {
  let value = state.rng || 0x6d2b79f5;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 0x1_0000_0000;
}

function tickIntervalForScore(score: number): number {
  return Math.max(
    MIN_TICK_INTERVAL,
    BASE_TICK_INTERVAL - score * SPEEDUP_PER_POINT,
  );
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

function chooseNextWord(state: PuffSnakeState): string {
  let currentIndex = 0;
  for (let index = 0; index < PUFF_SNAKE_WORDS.length; index++) {
    if (PUFF_SNAKE_WORDS[index] === state.word) {
      currentIndex = index;
      break;
    }
  }

  const offset =
    1 + Math.floor(nextRandom(state) * (PUFF_SNAKE_WORDS.length - 1));
  return PUFF_SNAKE_WORDS[(currentIndex + offset) % PUFF_SNAKE_WORDS.length];
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
  state.wordProgress += 1;
  let events = PUFF_SNAKE_EVENT.ATE;

  if (state.wordProgress === state.word.length) {
    state.score += state.word.length * 5;
    const removableSegments = Math.max(
      0,
      state.snake.length - STARTING_LENGTH,
    );
    const trimCount = Math.min(state.word.length, removableSegments);
    state.snake.splice(state.snake.length - trimCount, trimCount);
    state.word = chooseNextWord(state);
    state.wordProgress = 0;
    events |= PUFF_SNAKE_EVENT.PROOF;
  }

  state.pickup = spawnPickup(
    state,
    state.word.charAt(state.wordProgress),
  );
  state.tickInterval = tickIntervalForScore(state.score);
  return events;
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
    pickup: { x: 0, y: 0, letter: "" },
    word: "",
    wordProgress: 0,
    tickInterval: BASE_TICK_INTERVAL,
    tickAccumulator: 0,
    rng: seed >>> 0 || 1,
  };

  state.word = chooseInitialWord(state);
  state.pickup = spawnPickup(state, state.word.charAt(0));
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

  state.tickAccumulator += Math.min(MAX_FRAME_DELTA, deltaSeconds);
  let events = PUFF_SNAKE_EVENT.NONE;

  while (
    state.status === "running" &&
    state.tickAccumulator >= state.tickInterval
  ) {
    state.tickAccumulator -= state.tickInterval;
    events |= advanceSnake(state);
  }

  return events;
}
