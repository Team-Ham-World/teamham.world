import { describe, expect, it } from "vitest";

import {
  PUFF_SNAKE_EVENT,
  PUFF_SNAKE_WORDS,
  SNAKE_GRID_COLS,
  SNAKE_GRID_ROWS,
  createPuffSnake,
  startPuffSnake,
  stepPuffSnake,
  turnPuffSnake,
} from "@/lib/puff/snake";

type SnakeState = ReturnType<typeof createPuffSnake>;

function advanceOneTick(state: SnakeState): number {
  state.tickAccumulator = state.tickInterval;
  return stepPuffSnake(state, 0.001);
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
    expect(first.wordProgress).toBe(0);
    expect(PUFF_SNAKE_WORDS).toContain(first.word);
    expect(first.pickup.letter).toBe(first.word.charAt(0));
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
    state.pickup = {
      x: head.x + 1,
      y: head.y,
      letter: state.word.charAt(0),
    };

    const events = advanceOneTick(state);

    expect(events & PUFF_SNAKE_EVENT.ATE).toBeTruthy();
    expect(events & PUFF_SNAKE_EVENT.PROOF).toBeFalsy();
    expect(state.score).toBe(10);
    expect(state.snake).toHaveLength(5);
    expect(state.wordProgress).toBe(1);
    expect(state.pickup.letter).toBe(state.word.charAt(1));
    expect(state.tickInterval).toBeLessThan(0.14);
    expect(state.tickInterval).toBeGreaterThanOrEqual(0.08);
  });

  it("emits proof, awards the bonus, trims word growth, and changes word", () => {
    const state = createPuffSnake(99);
    startPuffSnake(state);
    state.word = "INK";
    state.wordProgress = 2;
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
    expect(state.word).not.toBe("INK");
    expect(PUFF_SNAKE_WORDS).toContain(state.word);
    expect(state.wordProgress).toBe(0);
    expect(state.pickup.letter).toBe(state.word.charAt(0));
    expect(state.snake).not.toContainEqual({
      x: state.pickup.x,
      y: state.pickup.y,
    });
  });

  it("chooses the same proof word and pickup from the same state", () => {
    const first = createPuffSnake(456);
    startPuffSnake(first);
    first.word = "HAM";
    first.wordProgress = 2;
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

  it("uses a clamped fixed timestep", () => {
    const state = createPuffSnake();
    startPuffSnake(state);
    state.pickup = { x: 0, y: 0, letter: state.pickup.letter };
    const initialHead = structuredClone(state.snake[0]);

    stepPuffSnake(state, 10);
    expect(state.snake[0]).toEqual(initialHead);
    expect(state.tickAccumulator).toBeCloseTo(0.05);
    stepPuffSnake(state, 0.05);
    expect(state.snake[0]).toEqual(initialHead);
    stepPuffSnake(state, 0.05);
    expect(state.snake[0]).toEqual({ x: initialHead.x + 1, y: initialHead.y });
    expect(state.tickAccumulator).toBeCloseTo(0.01);
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
