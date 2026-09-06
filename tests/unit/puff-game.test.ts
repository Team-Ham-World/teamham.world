import { describe, expect, it } from "vitest";

import {
  GAME_EVENT,
  GATE_WIDTH,
  GROUND_HEIGHT,
  PUFF_RADIUS,
  createPuffGame,
  flapPuff,
  resizePuffGame,
  stepPuffGame,
} from "@/lib/puff/game";

function expectedGateSpeed(score: number): number {
  return 168 + Math.min(58, score * 2.6);
}

type GameState = ReturnType<typeof createPuffGame>;
type Gate = GameState["gates"][number];

function displacementAfterFlap(time: number): number {
  const timeToMaxFall = (640 - -370) / 1_080;
  const acceleratingTime = Math.min(time, timeToMaxFall);
  return (
    -370 * acceleratingTime +
    (1_080 * acceleratingTime ** 2) / 2 +
    640 * Math.max(0, time - timeToMaxFall)
  );
}

function expectFeasibleTransition(
  state: GameState,
  predecessor: Gate,
  successor: Gate,
  forecastScore: number,
): void {
  const playableBottom = state.height - GROUND_HEIGHT;
  const travelTime =
    Math.max(
      0,
      successor.x - predecessor.x - GATE_WIDTH - PUFF_RADIUS * 2,
    ) / expectedGateSpeed(forecastScore);
  const predecessorClearance = predecessor.gapHeight / 2 - PUFF_RADIUS;
  const successorClearance = successor.gapHeight / 2 - PUFF_RADIUS;
  const reachableTop = Math.max(
    PUFF_RADIUS,
    Math.min(
      playableBottom - PUFF_RADIUS,
      predecessor.gapY - predecessorClearance - 370 * travelTime,
    ),
  );
  const reachableBottom = Math.max(
    PUFF_RADIUS,
    Math.min(
      playableBottom - PUFF_RADIUS,
      predecessor.gapY +
        predecessorClearance +
        displacementAfterFlap(travelTime),
    ),
  );

  expect(successor.gapY + successorClearance).toBeGreaterThanOrEqual(
    reachableTop,
  );
  expect(successor.gapY - successorClearance).toBeLessThanOrEqual(
    reachableBottom,
  );
}

describe("Flappy Puff game model", () => {
  it("creates a deterministic ready run with generous toner-gate spacing", () => {
    const first = createPuffGame(1280, 600, 1234);
    const second = createPuffGame(1280, 600, 1234);

    expect(first).toEqual(second);
    expect(first.status).toBe("ready");
    expect(first.score).toBe(0);
    expect(first.gates.length).toBeGreaterThanOrEqual(4);
    expect(first.gates[1].x - first.gates[0].x).toBeGreaterThanOrEqual(320);
    expect(first.gates[1].x - first.gates[0].x).toBeLessThanOrEqual(400);
    expect(first.gates[0].gapHeight).toBeGreaterThanOrEqual(170);
  });

  it("keeps initial gate centers legal and passable intervals feasible", () => {
    const state = createPuffGame(320, 600, 1);

    for (const gate of state.gates) {
      const halfGap = gate.gapHeight / 2;
      expect(gate.gapY).toBeGreaterThanOrEqual(23 + halfGap);
      expect(gate.gapY).toBeLessThanOrEqual(
        state.height - GROUND_HEIGHT - 23 - halfGap,
      );
    }

    for (let index = 1; index < state.gates.length; index++) {
      expectFeasibleTransition(
        state,
        state.gates[index - 1],
        state.gates[index],
        index,
      );
    }
  });

  it("keeps a recycled gate legal and physically feasible at high speed", () => {
    const state = createPuffGame(320, 600, 1234);
    flapPuff(state);
    state.score = 100;
    state.bird.y = 279;
    state.bird.velocityY = 0;

    const [recycled, ...remaining] = state.gates;
    recycled.x = -GATE_WIDTH - 20;
    recycled.scored = true;
    remaining.forEach((gate, index) => {
      gate.x = 400 + index * 320;
      gate.scored = false;
    });
    const predecessor = remaining.at(-1)!;

    stepPuffGame(state, 1 / 60);

    const halfGap = recycled.gapHeight / 2;
    expect(recycled.gapY).toBeGreaterThanOrEqual(23 + halfGap);
    expect(recycled.gapY).toBeLessThanOrEqual(
      state.height - GROUND_HEIGHT - 23 - halfGap,
    );
    expectFeasibleTransition(
      state,
      predecessor,
      recycled,
      state.score + remaining.length,
    );
  });

  it("allows a fixed-seed transition beyond the old conservative limit", () => {
    const state = createPuffGame(320, 600, 1);
    const [first, second] = state.gates;

    expect(Math.abs(second.gapY - first.gapY)).toBeGreaterThan(189);
    expectFeasibleTransition(state, first, second, 1);
  });

  it("starts on the first flap and applies upward velocity", () => {
    const state = createPuffGame(800, 500);

    expect(flapPuff(state)).toBe(true);
    expect(state.status).toBe("playing");
    expect(state.bird.velocityY).toBeLessThan(0);

    const before = state.bird.y;
    stepPuffGame(state, 1 / 60);
    expect(state.bird.y).toBeLessThan(before);
  });

  it("does not move a ready or dead run", () => {
    const ready = createPuffGame(800, 500);
    const readySnapshot = structuredClone(ready);
    expect(stepPuffGame(ready, 1)).toBe(GAME_EVENT.NONE);
    expect(ready).toEqual(readySnapshot);

    ready.status = "dead";
    expect(flapPuff(ready)).toBe(false);
  });

  it("awards one point exactly once after Puff clears a gate", () => {
    const state = createPuffGame(800, 500);
    flapPuff(state);
    const gate = state.gates[0];
    gate.gapY = state.bird.y;
    gate.gapHeight = 200;
    gate.x = state.bird.x - GATE_WIDTH - PUFF_RADIUS - 2;

    const firstEvents = stepPuffGame(state, 1 / 60);
    const secondEvents = stepPuffGame(state, 1 / 60);

    expect(firstEvents & GAME_EVENT.SCORED).toBeTruthy();
    expect(secondEvents & GAME_EVENT.SCORED).toBeFalsy();
    expect(state.score).toBe(1);
  });

  it("ends the run when Puff touches a toner gate", () => {
    const state = createPuffGame(800, 500);
    flapPuff(state);
    const gate = state.gates[0];
    gate.x = state.bird.x - GATE_WIDTH / 2;
    gate.gapY = 320;
    gate.gapHeight = 120;
    state.bird.y = 80;
    state.bird.velocityY = 0;

    const events = stepPuffGame(state, 1 / 60);

    expect(events & GAME_EVENT.CRASHED).toBeTruthy();
    expect(state.status).toBe("dead");
  });

  it("ends the run at the ceiling and floor", () => {
    const ceiling = createPuffGame(800, 500);
    flapPuff(ceiling);
    ceiling.bird.y = PUFF_RADIUS;
    ceiling.bird.velocityY = -100;
    expect(stepPuffGame(ceiling, 1 / 60) & GAME_EVENT.CRASHED).toBeTruthy();

    const floor = createPuffGame(800, 500);
    flapPuff(floor);
    floor.bird.y = floor.height - GROUND_HEIGHT - PUFF_RADIUS;
    floor.bird.velocityY = 100;
    expect(stepPuffGame(floor, 1 / 60) & GAME_EVENT.CRASHED).toBeTruthy();
  });

  it("keeps the same cadence when the gate ring recycles", () => {
    const state = createPuffGame(1280, 600);
    flapPuff(state);
    const spacing = state.gates[1].x - state.gates[0].x;
    const recycled = state.gates[0];
    for (const [index, gate] of state.gates.entries()) {
      gate.x = -GATE_WIDTH - 20 + index * spacing;
      gate.gapY = state.bird.y;
    }
    const previousFurthest = Math.max(...state.gates.slice(1).map((gate) => gate.x));

    stepPuffGame(state, 1 / 60);

    expect(recycled.x).toBeGreaterThanOrEqual(state.width + GATE_WIDTH);
    expect(recycled.x - (previousFurthest - 168 / 60)).toBeCloseTo(spacing);
    expect(recycled.scored).toBe(false);
  });

  it("keeps the paper-feed offset moving forward across motif boundaries", () => {
    const state = createPuffGame(800, 500);
    flapPuff(state);
    state.groundOffset = 95;
    state.gates.forEach((gate) => {
      gate.x = state.width + 200;
    });

    stepPuffGame(state, 0.02);

    expect(state.groundOffset).toBeGreaterThan(95);
  });

  it("reprojects the live run when the arena resizes", () => {
    const state = createPuffGame(800, 500);
    const oldGateX = state.gates[0].x;

    resizePuffGame(state, 400, 300);

    expect(state.width).toBe(400);
    expect(state.height).toBe(300);
    expect(state.bird.x).toBeCloseTo(112);
    expect(state.gates[0].x).toBeCloseTo(oldGateX / 2);
    expect(state.bird.y).toBeLessThan(300 - GROUND_HEIGHT);
  });
});
