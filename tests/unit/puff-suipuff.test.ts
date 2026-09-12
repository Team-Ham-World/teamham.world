import { describe, expect, it } from "vitest";

import {
  SUIPUFF_DROP_TIER_COUNT,
  SUIPUFF_EVENT,
  SUIPUFF_FIXED_STEP,
  SUIPUFF_OVERFLOW_SECONDS,
  SUIPUFF_REFILL_SECONDS,
  SUIPUFF_TIER_COUNT,
  SUIPUFF_TOP_TIER_JACKPOT,
  addSuipuffBody,
  createSuipuffGame,
  dropSuipuff,
  resizeSuipuffGame,
  setSuipuffAim,
  startSuipuff,
  stepSuipuffGame,
  suipuffMergeScore,
  suipuffTierRadius,
  type SuipuffGameState,
} from "@/lib/puff/suipuff";

const WIDTH = 800;
const HEIGHT = 500;
const STEP = SUIPUFF_FIXED_STEP;
const TRAY_EPSILON = 0.5;

function makeGame(seed = 0x1234_abcd): SuipuffGameState {
  const game = createSuipuffGame(WIDTH, HEIGHT, seed);
  startSuipuff(game);
  return game;
}

/** Simulates `steps` fixed steps, OR-ing every event flag raised on the way. */
function run(game: SuipuffGameState, steps: number): number {
  let events = SUIPUFF_EVENT.NONE;
  for (let i = 0; i < steps; i += 1) {
    events |= stepSuipuffGame(game, STEP);
  }
  return events;
}

/** Stops the drop queue so placement-style tests are not photobombed. */
function silenceQueue(game: SuipuffGameState): void {
  game.heldTier = -1;
  game.nextTier = -1;
  game.dropCooldown = Number.POSITIVE_INFINITY;
}

function trayCenter(game: SuipuffGameState): number {
  return (game.trayLeft + game.trayRight) / 2;
}

function snapshot(game: SuipuffGameState): unknown {
  return {
    score: game.score,
    status: game.status,
    heldTier: game.heldTier,
    nextTier: game.nextTier,
    bodies: [...game.bodies]
      .sort((a, b) => a.id - b.id)
      .map((body) => [
        body.tier,
        Math.round(body.x * 1000),
        Math.round(body.y * 1000),
        Math.round(body.vx * 100),
        Math.round(body.vy * 100),
      ]),
  };
}

describe("suipuffMergeScore", () => {
  it("awards the triangular value of the tier produced", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(suipuffMergeScore)).toEqual([
      1, 3, 6, 10, 15, 21, 28,
    ]);
  });
});

describe("createSuipuffGame", () => {
  it("builds a walled tray sized off the arena", () => {
    const game = createSuipuffGame(WIDTH, HEIGHT, 7);
    expect(game.trayWidth).toBeGreaterThanOrEqual(280);
    expect(game.trayWidth).toBeLessThanOrEqual(460);
    expect(game.trayLeft).toBeCloseTo((WIDTH - game.trayWidth) / 2, 5);
    expect(game.trayRight).toBeCloseTo((WIDTH + game.trayWidth) / 2, 5);
    expect(game.floorY).toBeLessThan(HEIGHT);
    expect(game.deadLineY).toBeGreaterThan(0);
    expect(game.deadLineY).toBeLessThan(game.floorY);
    expect(game.status).toBe("ready");
    expect(game.heldTier).toBeGreaterThanOrEqual(0);
    expect(game.heldTier).toBeLessThan(SUIPUFF_DROP_TIER_COUNT);
    expect(game.nextTier).toBeGreaterThanOrEqual(0);
    expect(game.nextTier).toBeLessThan(SUIPUFF_DROP_TIER_COUNT);
    // The held piece hovers just above the dead line.
    expect(game.dropY).toBeLessThan(game.deadLineY);
  });
});

describe("stepSuipuffGame determinism", () => {
  it("replays identical runs for identical seeds and inputs", () => {
    const script = (game: SuipuffGameState) => {
      startSuipuff(game);
      for (let i = 0; i < 30; i += 1) {
        setSuipuffAim(game, 140 + ((i * 173) % 5) * 90);
        run(game, 32);
        dropSuipuff(game);
      }
      run(game, 600);
    };
    const a = createSuipuffGame(WIDTH, HEIGHT, 0xfeed_beef);
    const b = createSuipuffGame(WIDTH, HEIGHT, 0xfeed_beef);
    script(a);
    script(b);
    expect(snapshot(b)).toEqual(snapshot(a));
  });

  it("keeps the drop queue inside the five smallest tiers", () => {
    const game = makeGame(99);
    const seen = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      setSuipuffAim(game, game.trayLeft + 30 + (i % 4) * 60);
      dropSuipuff(game);
      run(game, 30);
      if (game.heldTier >= 0) seen.add(game.heldTier);
      seen.add(game.nextTier);
    }
    for (const tier of seen) {
      expect(tier).toBeGreaterThanOrEqual(0);
      expect(tier).toBeLessThan(SUIPUFF_DROP_TIER_COUNT);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("drop cadence", () => {
  it("surfaces DROPPED, then refuses until the refill delay elapses", () => {
    const game = makeGame(11);
    const firstTier = game.heldTier;

    expect(dropSuipuff(game)).toBe(true);
    expect(game.heldTier).toBe(-1);
    expect(stepSuipuffGame(game, STEP) & SUIPUFF_EVENT.DROPPED).toBeTruthy();

    // Refused while the refill delay runs.
    expect(dropSuipuff(game)).toBe(false);
    run(game, Math.ceil((SUIPUFF_REFILL_SECONDS - 0.05) / STEP));
    expect(dropSuipuff(game)).toBe(false);

    // Refilled shortly after the delay.
    let refilled = game.heldTier >= 0;
    for (let i = 0; i < 30 && !refilled; i += 1) {
      stepSuipuffGame(game, STEP);
      refilled = game.heldTier >= 0;
    }
    expect(refilled).toBe(true);
    expect(dropSuipuff(game)).toBe(true);
    expect(game.bodies.length).toBeGreaterThanOrEqual(1);
    expect(firstTier).toBeGreaterThanOrEqual(0);
  });

  it("spawns the dropped body inside the tray at the aim point", () => {
    const game = makeGame(23);
    setSuipuffAim(game, game.trayLeft - 500); // clamp inside the left wall
    dropSuipuff(game);
    const body = game.bodies[0];
    expect(body.x - body.radius).toBeGreaterThanOrEqual(
      game.trayLeft - TRAY_EPSILON,
    );
    expect(body.x + body.radius).toBeLessThanOrEqual(
      game.trayRight + TRAY_EPSILON,
    );
    expect(body.y).toBeLessThan(game.deadLineY);
  });
});

describe("merging", () => {
  it("merges a touching same-tier pair into the next tier and scores it", () => {
    const game = makeGame(5);
    silenceQueue(game);
    const mid = trayCenter(game);
    const radius = suipuffTierRadius(game, 0);
    addSuipuffBody(game, 0, mid - radius + 2, game.floorY - radius);
    addSuipuffBody(game, 0, mid + radius - 2, game.floorY - radius);

    const events = run(game, 3);
    expect(events & SUIPUFF_EVENT.MERGED).toBeTruthy();
    expect(game.score).toBe(suipuffMergeScore(1));
    expect(game.bodies).toHaveLength(1);
    expect(game.bodies[0].tier).toBe(1);
    expect(game.bodies[0].x).toBeCloseTo(mid, 0);
    expect(game.mergePops.map((pop) => pop.score)).toEqual([1]);
  });

  it("does not merge while the run is still in ready", () => {
    const game = createSuipuffGame(WIDTH, HEIGHT, 5);
    silenceQueue(game);
    const mid = trayCenter(game);
    const radius = suipuffTierRadius(game, 0);
    addSuipuffBody(game, 0, mid - radius + 2, game.floorY - radius);
    addSuipuffBody(game, 0, mid + radius - 2, game.floorY - radius);
    run(game, 5);
    expect(game.bodies).toHaveLength(2);
    expect(game.score).toBe(0);
  });

  it("gives each body at most one merge per step", () => {
    const game = makeGame(6);
    silenceQueue(game);
    const mid = trayCenter(game);
    const radius = suipuffTierRadius(game, 0);
    // Three overlapping specks: step one merges exactly one pair.
    addSuipuffBody(game, 0, mid - radius - 4, game.floorY - radius);
    addSuipuffBody(game, 0, mid, game.floorY - radius);
    addSuipuffBody(game, 0, mid + radius + 4, game.floorY - radius);

    run(game, 1);
    expect(game.bodies).toHaveLength(2);
    expect(game.score).toBe(suipuffMergeScore(1));
    expect(game.bodies.filter((body) => body.tier === 1)).toHaveLength(1);
  });

  it("chains a fresh merge product into a further merge on later steps", () => {
    const game = makeGame(8);
    silenceQueue(game);
    const mid = trayCenter(game);
    const r0 = suipuffTierRadius(game, 0);
    addSuipuffBody(game, 0, mid - r0 + 2, game.floorY - r0);
    addSuipuffBody(game, 0, mid + r0 - 2, game.floorY - r0);

    run(game, 2);
    expect(game.bodies).toHaveLength(1);
    const merged = game.bodies[0];
    expect(merged.tier).toBe(1);

    // A Pufflet touching the fresh Pufflet chains onward into a Puffling.
    addSuipuffBody(game, 1, merged.x + 2 * merged.radius - 8, merged.y);
    const events = run(game, 3);
    expect(events & SUIPUFF_EVENT.MERGED).toBeTruthy();
    expect(game.score).toBe(suipuffMergeScore(1) + suipuffMergeScore(2));
    expect(game.bodies).toHaveLength(1);
    expect(game.bodies[0].tier).toBe(2);
  });

  it("never merges different tiers that are in contact", () => {
    const game = makeGame(9);
    silenceQueue(game);
    const mid = trayCenter(game);
    const r0 = suipuffTierRadius(game, 0);
    const r1 = suipuffTierRadius(game, 1);
    addSuipuffBody(game, 0, mid - 8, game.floorY - r0);
    addSuipuffBody(game, 1, mid + 8, game.floorY - r1);
    run(game, 30);
    expect(game.bodies).toHaveLength(2);
    expect(game.score).toBe(0);
    expect(r1).toBeGreaterThan(r0);
  });

  it("pops two THE PUFFs for the jackpot and removes both", () => {
    const game = makeGame(10);
    silenceQueue(game);
    const mid = trayCenter(game);
    const r7 = suipuffTierRadius(game, SUIPUFF_TIER_COUNT - 1);
    addSuipuffBody(game, 7, mid, game.floorY - r7);
    addSuipuffBody(game, 7, mid, game.floorY - 3 * r7 + 10);

    const events = run(game, 3);
    expect(events & SUIPUFF_EVENT.MERGED).toBeTruthy();
    expect(game.score).toBe(SUIPUFF_TOP_TIER_JACKPOT);
    expect(game.bodies).toHaveLength(0);
    expect(game.mergePops.at(-1)?.score).toBe(SUIPUFF_TOP_TIER_JACKPOT);
  });
});

describe("tray containment", () => {
  it("never ends a step outside the walls or under the floor", () => {
    const game = makeGame(77);
    silenceQueue(game);
    // A packed cross-section: pile pressure shoves edge bodies against the
    // walls every step; the end-of-step tray pass must leave nobody proud.
    const mid = trayCenter(game);
    let slot = 0;
    for (const tier of [7, 6, 7, 6, 7]) {
      const r = suipuffTierRadius(game, tier);
      addSuipuffBody(
        game,
        tier,
        mid + (slot % 2 === 0 ? -1 : 1) * (slot + 1) * 4,
        game.floorY - r - slot * 12,
      );
      slot += 1;
    }
    for (let i = 0; i < 240; i += 1) {
      stepSuipuffGame(game, STEP);
      for (const body of game.bodies) {
        expect(body.x - body.radius).toBeGreaterThanOrEqual(game.trayLeft);
        expect(body.x + body.radius).toBeLessThanOrEqual(game.trayRight);
        expect(body.y + body.radius).toBeLessThanOrEqual(game.floorY);
      }
      if (game.status !== "playing") break;
    }
    // Merges and tier-7 pops may consume the whole pile — containment is the
    // assertion, not survival.
    for (const body of game.bodies) {
      expect(Number.isFinite(body.x)).toBe(true);
      expect(Number.isFinite(body.y)).toBe(true);
    }
  });

  it("keeps every dropped body inside the walls and on the floor", () => {
    const game = makeGame(77);
    for (let i = 0; i < 14; i += 1) {
      // Slam the aim against both walls; the clamp keeps drops in-bounds.
      setSuipuffAim(
        game,
        i % 2 === 0 ? game.trayLeft - 400 : game.trayRight + 400,
      );
      dropSuipuff(game);
      run(game, 26);
    }
    run(game, 600);

    expect(game.bodies.length).toBeGreaterThan(0);
    for (const body of game.bodies) {
      expect(Number.isFinite(body.x)).toBe(true);
      expect(Number.isFinite(body.y)).toBe(true);
      expect(body.x - body.radius).toBeGreaterThanOrEqual(
        game.trayLeft - TRAY_EPSILON,
      );
      expect(body.x + body.radius).toBeLessThanOrEqual(
        game.trayRight + TRAY_EPSILON,
      );
      expect(body.y + body.radius).toBeLessThanOrEqual(
        game.floorY + TRAY_EPSILON,
      );
    }
  });
});

describe("dead line", () => {
  /**
   * A vertical column of alternating big tiers: neighbouring bodies differ,
   * so nothing merges, and the perfectly vertical contact normals keep the
   * column standing. The top body's upper edge clears the dead line.
   */
  function buildOverflowColumn(game: SuipuffGameState) {
    const mid = trayCenter(game);
    const r7 = suipuffTierRadius(game, 7);
    const r6 = suipuffTierRadius(game, 6);
    addSuipuffBody(game, 7, mid, game.floorY - r7);
    addSuipuffBody(game, 6, mid, game.floorY - 2 * r7 - r6);
    return addSuipuffBody(game, 7, mid, game.floorY - 2 * r7 - 2 * r6 - r7);
  }

  it("ends the run after a settled body rests above the line", () => {
    const game = makeGame(41);
    silenceQueue(game);
    const top = buildOverflowColumn(game);
    expect(top.y - top.radius).toBeLessThan(game.deadLineY);

    const events = run(game, 150);
    expect(events & SUIPUFF_EVENT.OVERFLOW).toBeTruthy();
    expect(game.status).toBe("dead");
  });

  it("ignores freshly dropped pieces passing through the line", () => {
    const game = makeGame(42);
    // Drops spawn above the dead line and fall through it — none may trip it.
    for (let i = 0; i < 10; i += 1) {
      setSuipuffAim(
        game,
        game.trayLeft + 40 + (i % 3) * ((game.trayWidth - 80) / 2),
      );
      dropSuipuff(game);
      run(game, 30);
    }
    run(game, 240);
    expect(game.status).toBe("playing");
  });

  it("grants young bodies the grace window before timing them", () => {
    const game = makeGame(43);
    silenceQueue(game);
    const top = buildOverflowColumn(game);
    // The top body sits above the line but is newborn — no early overflow.
    run(game, 20); // ~0.33 s, inside the ~0.6 s grace window
    expect(game.status).toBe("playing");
    expect(top.overLineSeconds).toBe(0);
    // After the grace window plus the full dead-line budget it must end.
    run(game, 150);
    expect(game.status).toBe("dead");
    expect(
      top.overLineSeconds === 0 ||
        top.overLineSeconds > SUIPUFF_OVERFLOW_SECONDS,
    ).toBe(true);
  });
});

describe("resizeSuipuffGame", () => {
  it("reprojects positions, radii, aim, and the dead line proportionally", () => {
    const game = makeGame(55);
    silenceQueue(game);
    const mid = trayCenter(game);
    const r2 = suipuffTierRadius(game, 2);
    const x0 = mid - 40;
    const y0 = game.floorY - 120;
    addSuipuffBody(game, 2, x0, y0);
    setSuipuffAim(game, mid + 30);
    const aim0 = game.aimX;

    const oldTray = game.trayWidth;
    resizeSuipuffGame(game, 400, 260);
    const scaleX = 400 / WIDTH;
    const scaleY = 260 / HEIGHT;

    expect(game.width).toBe(400);
    expect(game.height).toBe(260);
    expect(game.trayWidth).not.toBe(oldTray);
    const body = game.bodies[0];
    // Positions scale with the arena, radii with the tray width.
    expect(body.x).toBeCloseTo(x0 * scaleX, 5);
    expect(body.y).toBeCloseTo(y0 * scaleY, 5);
    expect(body.radius).toBeCloseTo((r2 * game.trayWidth) / oldTray, 5);
    expect(body.radius).toBeCloseTo(suipuffTierRadius(game, 2), 5);
    expect(game.aimX).toBeCloseTo(aim0 * scaleX, 5);
    expect(game.deadLineY).toBeLessThan(game.floorY);
    expect(game.dropY).toBeLessThan(game.deadLineY);
  });

  it("falls back to the minimum arena on non-finite dimensions", () => {
    const game = createSuipuffGame(Number.NaN, Number.NaN, 1);
    expect(game.width).toBe(320);
    expect(game.height).toBe(260);
    for (const value of [
      game.trayWidth,
      game.trayLeft,
      game.trayRight,
      game.floorY,
      game.deadLineY,
      game.dropY,
      game.aimX,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }

    resizeSuipuffGame(game, Number.NaN, Number.NEGATIVE_INFINITY);
    expect(game.width).toBe(320);
    expect(game.height).toBe(260);
    expect(Number.isFinite(game.trayLeft)).toBe(true);
  });

  it("scales body velocities with the arena so the pile keeps its pace", () => {
    const game = makeGame(55);
    silenceQueue(game);
    const mid = trayCenter(game);
    const body = addSuipuffBody(game, 2, mid, game.floorY - 200);
    body.vx = 120;
    body.vy = 300;

    resizeSuipuffGame(game, 1600, 1000);
    expect(body.vx).toBeCloseTo(240, 5);
    expect(body.vy).toBeCloseTo(600, 5);
  });
});
