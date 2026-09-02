import { describe, expect, it } from "vitest";

import {
  PUFF_SNAKE_EVENT,
  PUFF_SNAKE_WORDS,
  PUFF_SNAKE_WORDS_TO_ENDLESS,
  SNAKE_GRID_COLS,
  SNAKE_GRID_ROWS,
  createPuffSnake,
  getPuffSnakeTicksPerSecond,
  startPuffSnake,
  stepPuffSnake,
  turnPuffSnake,
  type PuffSnakeObjective,
} from "@/lib/puff/snake";

type SnakeState = ReturnType<typeof createPuffSnake>;
type WordObjective = Extract<PuffSnakeObjective, { kind: "word" }>;

function wordObjective(state: SnakeState): WordObjective {
  if (state.objective.kind !== "word") {
    throw new Error("Expected a word-feed objective.");
  }
  return state.objective;
}

function advanceOneTick(state: SnakeState): number {
  return stepPuffSnake(
    state,
    1 / getPuffSnakeTicksPerSecond(state.objective),
  );
}

function completeCurrentWord(state: SnakeState): number {
  const objective = wordObjective(state);
  state.direction = "right";
  state.pendingDirection = "right";
  state.snake = [
    { x: 10, y: 8 },
    { x: 9, y: 8 },
    { x: 8, y: 8 },
    { x: 7, y: 8 },
    { x: 6, y: 8 },
    { x: 5, y: 8 },
  ];
  state.objective = {
    ...objective,
    progress: objective.word.length - 1,
  };
  state.pickup = {
    x: 11,
    y: 8,
    letter: objective.word.charAt(objective.word.length - 1),
  };
  return advanceOneTick(state);
}

describe("Puff Print Run engine", () => {
  it("creates a deterministic ready game with valid initial invariants", () => {
    const first = createPuffSnake(1234);
    const second = createPuffSnake(1234);

    expect(first).toEqual(second);
    expect(first.status).toBe("ready");
    expect(first.score).toBe(0);
    expect(first.snake).toHaveLength(4);
    expect(first.direction).toBe("right");
    expect(first.pendingDirection).toBe("right");
    const objective = wordObjective(first);
    expect(objective.progress).toBe(0);
    expect(objective.completedWords).toBe(0);
    expect(PUFF_SNAKE_WORDS).toContain(objective.word);
    expect(first.pickup.letter).toBe(objective.word.charAt(0));
    expect(getPuffSnakeTicksPerSecond(first.objective)).toBeCloseTo(7.1, 1);
    expect(first.pickup.x).toBeGreaterThanOrEqual(0);
    expect(first.pickup.x).toBeLessThan(SNAKE_GRID_COLS);
    expect(first.pickup.y).toBeGreaterThanOrEqual(0);
    expect(first.pickup.y).toBeLessThan(SNAKE_GRID_ROWS);
    expect(first.snake).not.toContainEqual({
      x: first.pickup.x,
      y: first.pickup.y,
    });
  });

  it("starts only a ready run and otherwise leaves it still", () => {
    const state = createPuffSnake();
    const readySnapshot = structuredClone(state);

    expect(stepPuffSnake(state, 1)).toBe(PUFF_SNAKE_EVENT.NONE);
    expect(state).toEqual(readySnapshot);
    expect(startPuffSnake(state)).toBe(true);
    expect(state.status).toBe("running");
    expect(startPuffSnake(state)).toBe(false);

    state.status = "dead";
    expect(startPuffSnake(state)).toBe(false);
    expect(turnPuffSnake(state, "up")).toBe(false);
  });

  it("queues legal turns and rejects direct reversals", () => {
    const state = createPuffSnake();
    startPuffSnake(state);

    expect(turnPuffSnake(state, "left")).toBe(false);
    expect(state.pendingDirection).toBe("right");
    expect(turnPuffSnake(state, "up")).toBe(true);
    expect(state.direction).toBe("right");
    expect(state.pendingDirection).toBe("up");
    expect(turnPuffSnake(state, "left")).toBe(false);

    advanceOneTick(state);
    expect(state.direction).toBe("up");
    expect(turnPuffSnake(state, "left")).toBe(true);
  });

  it("moves one contiguous cell per tick without growing", () => {
    const state = createPuffSnake();
    startPuffSnake(state);
    state.pickup = { x: 0, y: 0, letter: state.pickup.letter };
    const before = structuredClone(state.snake);

    expect(advanceOneTick(state)).toBe(PUFF_SNAKE_EVENT.NONE);
    expect(state.snake).toHaveLength(4);
    expect(state.snake[0]).toEqual({ x: before[0].x + 1, y: before[0].y });
    expect(state.snake.slice(1)).toEqual(before.slice(0, -1));
  });

  it("grows and scores when it collects the required letter", () => {
    const state = createPuffSnake(7);
    startPuffSnake(state);
    const head = state.snake[0];
    const objective = wordObjective(state);
    state.pickup = {
      x: head.x + 1,
      y: head.y,
      letter: objective.word.charAt(0),
    };

    const events = advanceOneTick(state);

    expect(events & PUFF_SNAKE_EVENT.ATE).toBeTruthy();
    expect(events & PUFF_SNAKE_EVENT.PROOF).toBeFalsy();
    expect(state.score).toBe(10);
    expect(state.snake).toHaveLength(5);
    const nextObjective = wordObjective(state);
    expect(nextObjective.progress).toBe(1);
    expect(state.pickup.letter).toBe(nextObjective.word.charAt(1));
  });

  it("emits proof, awards the bonus, trims word growth, and changes word", () => {
    const state = createPuffSnake(99);
    startPuffSnake(state);
    state.objective = {
      kind: "word",
      word: "INK",
      progress: 2,
      completedWords: 0,
    };
    state.score = 20;
    state.snake = [
      { x: 10, y: 8 },
      { x: 9, y: 8 },
      { x: 8, y: 8 },
      { x: 7, y: 8 },
      { x: 6, y: 8 },
      { x: 5, y: 8 },
    ];
    state.pickup = { x: 11, y: 8, letter: "K" };

    const events = advanceOneTick(state);

    expect(events & PUFF_SNAKE_EVENT.ATE).toBeTruthy();
    expect(events & PUFF_SNAKE_EVENT.PROOF).toBeTruthy();
    expect(state.score).toBe(45);
    expect(state.snake).toHaveLength(4);
    const objective = wordObjective(state);
    expect(objective.word).not.toBe("INK");
    expect(PUFF_SNAKE_WORDS).toContain(objective.word);
    expect(objective.progress).toBe(0);
    expect(objective.completedWords).toBe(1);
    expect(state.pickup.letter).toBe(objective.word.charAt(0));
    expect(getPuffSnakeTicksPerSecond(state.objective)).toBeCloseTo(7.7, 1);
    expect(state.snake).not.toContainEqual({
      x: state.pickup.x,
      y: state.pickup.y,
    });
  });

  it("chooses the same proof word and pickup from the same state", () => {
    const first = createPuffSnake(456);
    startPuffSnake(first);
    first.objective = {
      kind: "word",
      word: "HAM",
      progress: 2,
      completedWords: 0,
    };
    first.snake = [
      { x: 10, y: 8 },
      { x: 9, y: 8 },
      { x: 8, y: 8 },
      { x: 7, y: 8 },
      { x: 6, y: 8 },
      { x: 5, y: 8 },
    ];
    first.pickup = { x: 11, y: 8, letter: "M" };
    const second = structuredClone(first);

    advanceOneTick(first);
    advanceOneTick(second);

    expect(first).toEqual(second);
  });

  it("ends the run on a wall collision", () => {
    const state = createPuffSnake();
    startPuffSnake(state);
    state.snake = [
      { x: SNAKE_GRID_COLS - 1, y: 4 },
      { x: SNAKE_GRID_COLS - 2, y: 4 },
      { x: SNAKE_GRID_COLS - 3, y: 4 },
      { x: SNAKE_GRID_COLS - 4, y: 4 },
    ];
    state.pickup = { x: 0, y: 0, letter: state.pickup.letter };

    expect(advanceOneTick(state) & PUFF_SNAKE_EVENT.CRASHED).toBeTruthy();
    expect(state.status).toBe("dead");
    expect(state.snake[0]).toEqual({ x: SNAKE_GRID_COLS - 1, y: 4 });
  });

  it("ends the run on a self collision", () => {
    const state = createPuffSnake();
    startPuffSnake(state);
    state.direction = "down";
    state.pendingDirection = "down";
    state.snake = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
    ];
    state.pickup = { x: 0, y: 0, letter: state.pickup.letter };

    expect(advanceOneTick(state) & PUFF_SNAKE_EVENT.CRASHED).toBeTruthy();
    expect(state.status).toBe("dead");
  });

  it("allows moving into the tail cell when the tail moves away", () => {
    const state = createPuffSnake();
    startPuffSnake(state);
    state.direction = "down";
    state.pendingDirection = "down";
    state.snake = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
    ];
    state.pickup = { x: 0, y: 0, letter: state.pickup.letter };

    expect(advanceOneTick(state)).toBe(PUFF_SNAKE_EVENT.NONE);
    expect(state.status).toBe("running");
    expect(state.snake).toEqual([
      { x: 5, y: 6 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
    ]);
  });

  it("accelerates only after completed words and enters endless at 12.5 TPS", () => {
    const state = createPuffSnake();
    startPuffSnake(state);
    const expectedRates = [7.7, 8.3, 9.1, 10, 11.1, 12.5];

    for (let index = 0; index < PUFF_SNAKE_WORDS_TO_ENDLESS; index += 1) {
      expect(completeCurrentWord(state) & PUFF_SNAKE_EVENT.PROOF).toBeTruthy();
      expect(getPuffSnakeTicksPerSecond(state.objective)).toBeCloseTo(
        expectedRates[index],
        1,
      );
    }

    expect(state.objective).toEqual({ kind: "endless" });
    expect(state.pickup.letter).toMatch(/^[A-Z]$/);
  });

  it("keeps every random-letter segment in endless mode", () => {
    const state = createPuffSnake();
    startPuffSnake(state);
    for (let index = 0; index < PUFF_SNAKE_WORDS_TO_ENDLESS; index += 1) {
      completeCurrentWord(state);
    }
    const head = state.snake[0];
    const length = state.snake.length;
    state.pickup = { x: head.x + 1, y: head.y, letter: "Q" };

    const events = advanceOneTick(state);

    expect(events).toBe(PUFF_SNAKE_EVENT.ATE);
    expect(state.objective).toEqual({ kind: "endless" });
    expect(state.snake).toHaveLength(length + 1);
    expect(state.pickup.letter).toMatch(/^[A-Z]$/);
  });

  it("caps a stalled frame at five catch-up ticks", () => {
    const state = createPuffSnake();
    startPuffSnake(state);
    state.pickup = { x: 0, y: 0, letter: state.pickup.letter };
    const initialHead = structuredClone(state.snake[0]);

    stepPuffSnake(state, 10);
    expect(state.snake[0]).toEqual({ x: initialHead.x + 5, y: initialHead.y });
    expect(state.tickAccumulator).toBeCloseTo(0);
  });

  it("ignores non-positive and non-finite deltas", () => {
    const invalidDeltas = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];

    for (const delta of invalidDeltas) {
      const state = createPuffSnake();
      startPuffSnake(state);
      const snapshot = structuredClone(state);
      expect(stepPuffSnake(state, delta)).toBe(PUFF_SNAKE_EVENT.NONE);
      expect(state).toEqual(snapshot);
    }
  });
});
