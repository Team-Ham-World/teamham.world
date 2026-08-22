export const PUFF_RADIUS = 15;
export const GATE_WIDTH = 68;
export const GROUND_HEIGHT = 42;

export const GAME_EVENT = {
  NONE: 0,
  SCORED: 1 << 0,
  CRASHED: 1 << 1,
} as const;

export type GameEventFlags = number;
export type PuffGameStatus = "ready" | "playing" | "dead";

export interface PuffBird {
  x: number;
  y: number;
  velocityY: number;
  angle: number;
}

export interface TonerGate {
  id: number;
  x: number;
  gapY: number;
  gapHeight: number;
  scored: boolean;
  pattern: number;
}

export interface PuffGameState {
  width: number;
  height: number;
  elapsed: number;
  score: number;
  status: PuffGameStatus;
  bird: PuffBird;
  gates: TonerGate[];
  groundOffset: number;
  rng: number;
  nextGateId: number;
}

const GRAVITY = 1_080;
const FLAP_VELOCITY = -370;
const MAX_FALL_VELOCITY = 640;
const BASE_GATE_SPEED = 168;
const SPEED_PER_POINT = 2.6;
const MAX_SPEED_BONUS = 58;
const MIN_GATE_SPACING = 320;
const MAX_GATE_SPACING = 400;
const FIRST_GATE_DISTANCE = 250;
const MIN_GAP_HEIGHT = 150;
const MAX_GAP_HEIGHT = 180;
const EDGE_MARGIN = 23;

function nextRandom(state: PuffGameState): number {
  let value = state.rng || 0x6d2b79f5;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 0x1_0000_0000;
}

function playableBottom(state: PuffGameState): number {
  return state.height - GROUND_HEIGHT;
}

function gateSpacing(state: PuffGameState): number {
  return Math.max(
    MIN_GATE_SPACING,
    Math.min(MAX_GATE_SPACING, state.width * 0.34),
  );
}

function gateCount(state: PuffGameState): number {
  const coverage = state.width + GATE_WIDTH * 2 + 24;
  return Math.max(4, Math.ceil(coverage / gateSpacing(state)));
}

function gapHeightForScore(state: PuffGameState): number {
  const available = playableBottom(state) - EDGE_MARGIN * 2;
  const difficultyGap = MAX_GAP_HEIGHT - Math.min(30, state.score);
  return Math.min(available, Math.max(MIN_GAP_HEIGHT, difficultyGap));
}

function randomGapY(state: PuffGameState, gapHeight: number): number {
  const half = gapHeight / 2;
  const min = EDGE_MARGIN + half;
  const max = playableBottom(state) - EDGE_MARGIN - half;
  return min + nextRandom(state) * Math.max(1, max - min);
}

function createGate(state: PuffGameState, x: number): TonerGate {
  const gapHeight = gapHeightForScore(state);
  return {
    id: state.nextGateId++,
    x,
    gapY: randomGapY(state, gapHeight),
    gapHeight,
    scored: false,
    pattern: Math.floor(nextRandom(state) * 4),
  };
}

export function createPuffGame(
  width: number,
  height: number,
  seed = 0x48414d,
): PuffGameState {
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(260, height);
  const state: PuffGameState = {
    width: safeWidth,
    height: safeHeight,
    elapsed: 0,
    score: 0,
    status: "ready",
    bird: {
      x: Math.max(88, safeWidth * 0.28),
      y: (safeHeight - GROUND_HEIGHT) * 0.46,
      velocityY: 0,
      angle: 0,
    },
    gates: [],
    groundOffset: 0,
    rng: seed >>> 0 || 1,
    nextGateId: 1,
  };

  const firstX = Math.max(safeWidth * 0.68, state.bird.x + FIRST_GATE_DISTANCE);
  const spacing = gateSpacing(state);
  for (let index = 0; index < gateCount(state); index++) {
    state.gates.push(createGate(state, firstX + index * spacing));
  }
  return state;
}

/** Starts a ready run and applies the one player impulse. */
export function flapPuff(state: PuffGameState): boolean {
  if (state.status === "dead") return false;
  state.status = "playing";
  state.bird.velocityY = FLAP_VELOCITY;
  state.bird.angle = -0.35;
  return true;
}

function circleHitsRect(
  circleX: number,
  circleY: number,
  radius: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  const closestX = Math.max(left, Math.min(circleX, right));
  const closestY = Math.max(top, Math.min(circleY, bottom));
  const dx = circleX - closestX;
  const dy = circleY - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function hitsGate(state: PuffGameState, gate: TonerGate): boolean {
  const left = gate.x;
  const right = gate.x + GATE_WIDTH;
  const gapTop = gate.gapY - gate.gapHeight / 2;
  const gapBottom = gate.gapY + gate.gapHeight / 2;
  const { x, y } = state.bird;

  return (
    circleHitsRect(x, y, PUFF_RADIUS, left, 0, right, gapTop) ||
    circleHitsRect(
      x,
      y,
      PUFF_RADIUS,
      left,
      gapBottom,
      right,
      playableBottom(state),
    )
  );
}

function recycleGate(state: PuffGameState, gate: TonerGate): void {
  const furthestX = Math.max(...state.gates.map((candidate) => candidate.x));
  const gapHeight = gapHeightForScore(state);
  gate.x = Math.max(
    state.width + GATE_WIDTH,
    furthestX + gateSpacing(state),
  );
  gate.gapHeight = gapHeight;
  gate.gapY = randomGapY(state, gapHeight);
  gate.scored = false;
  gate.pattern = Math.floor(nextRandom(state) * 4);
}

export function stepPuffGame(
  state: PuffGameState,
  deltaSeconds: number,
): GameEventFlags {
  if (state.status !== "playing" || deltaSeconds <= 0) return GAME_EVENT.NONE;

  const delta = Math.min(0.05, deltaSeconds);
  const speed =
    BASE_GATE_SPEED + Math.min(MAX_SPEED_BONUS, state.score * SPEED_PER_POINT);
  state.elapsed += delta;
  state.groundOffset += speed * delta;

  state.bird.velocityY = Math.min(
    MAX_FALL_VELOCITY,
    state.bird.velocityY + GRAVITY * delta,
  );
  state.bird.y += state.bird.velocityY * delta;
  state.bird.angle = Math.min(
    0.82,
    state.bird.angle + (state.bird.velocityY > 0 ? 1.7 : 0.72) * delta,
  );

  let events = GAME_EVENT.NONE;
  for (const gate of state.gates) {
    gate.x -= speed * delta;

    if (!gate.scored && gate.x + GATE_WIDTH < state.bird.x - PUFF_RADIUS) {
      gate.scored = true;
      state.score += 1;
      events |= GAME_EVENT.SCORED;
    }

    if (hitsGate(state, gate)) {
      state.status = "dead";
      state.bird.angle = 0.95;
      return events | GAME_EVENT.CRASHED;
    }
  }

  for (const gate of state.gates) {
    if (gate.x + GATE_WIDTH < -12) recycleGate(state, gate);
  }

  if (
    state.bird.y - PUFF_RADIUS <= 0 ||
    state.bird.y + PUFF_RADIUS >= playableBottom(state)
  ) {
    state.status = "dead";
    state.bird.y = Math.max(
      PUFF_RADIUS,
      Math.min(playableBottom(state) - PUFF_RADIUS, state.bird.y),
    );
    state.bird.angle = 0.95;
    events |= GAME_EVENT.CRASHED;
  }

  return events;
}

export function resizePuffGame(
  state: PuffGameState,
  width: number,
  height: number,
): void {
  const safeWidth = Math.max(320, width);
  const safeHeight = Math.max(260, height);
  const scaleX = safeWidth / state.width;
  const oldPlayableHeight = Math.max(1, state.height - GROUND_HEIGHT);
  const newPlayableHeight = safeHeight - GROUND_HEIGHT;
  const scaleY = newPlayableHeight / oldPlayableHeight;

  state.width = safeWidth;
  state.height = safeHeight;
  state.bird.x = Math.max(88, safeWidth * 0.28);
  state.bird.y = Math.max(
    PUFF_RADIUS,
    Math.min(newPlayableHeight - PUFF_RADIUS, state.bird.y * scaleY),
  );
  for (const gate of state.gates) {
    gate.x *= scaleX;
    gate.gapY *= scaleY;
    gate.gapHeight = Math.min(
      newPlayableHeight - EDGE_MARGIN * 2,
      gate.gapHeight * scaleY,
    );
  }
}
