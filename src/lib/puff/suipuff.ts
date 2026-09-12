/**
 * Suipuff — a Suika-style merge-physics engine where every piece is the Puff.
 *
 * Pure TypeScript, no DOM: the same hand-rolled, seeded-RNG conventions as
 * `game.ts` and `snake.ts`, so a run is fully determined by its seed plus the
 * player's aim/drop inputs. The component drives `stepSuipuffGame` at a fixed
 * 1/60 s step; larger deltas are sub-stepped here so a slow frame can never
 * tunnel a dropped Puff through the pile.
 *
 * Rules (see docs/website/plans/SUIPUFF_IMPLEMENTATION_PLAN.md):
 * - Two same-tier bodies in contact merge into the next tier at their
 *   midpoint and score the triangular value of the tier produced
 *   (+1, +3, +6, +10, +15, +21, +28 for tiers 1..7).
 * - Two tier-7 "THE PUFF"s pop each other instead: both are removed and the
 *   run scores a flat +100 jackpot.
 * - A body older than the grace window whose top edge rests above the dead
 *   line for a full second ends the run. Freshly dropped pieces pass through
 *   the line without penalty while they are young.
 */

export const SUIPUFF_TIER_COUNT = 8;
/** Tier radii in px at the 440 px reference tray width; they scale linearly. */
export const SUIPUFF_TIER_RADII = [16, 22, 30, 40, 53, 70, 92, 120] as const;
export const SUIPUFF_TIER_NAMES = [
  "Toner Speck",
  "Pufflet",
  "Puffling",
  "Puff",
  "Big Puff",
  "Mega Puff",
  "Giga Puff",
  "THE PUFF",
] as const;
/** Only the smallest five tiers enter the drop queue, like Suika. */
export const SUIPUFF_DROP_TIER_COUNT = 5;
export const SUIPUFF_TRAY_REFERENCE_WIDTH = 440;
/** Flat jackpot when two tier-7 "THE PUFF"s pop each other. */
export const SUIPUFF_TOP_TIER_JACKPOT = 100;

export const SUIPUFF_EVENT = {
  NONE: 0,
  DROPPED: 1 << 0,
  MERGED: 1 << 1,
  OVERFLOW: 1 << 2,
} as const;

export type SuipuffEventFlags = number;
/** Mirrors PuffRenderPhase: the component owns "paused", the engine the rest. */
export type SuipuffStatus = "ready" | "playing" | "paused" | "dead";

export interface SuipuffBody {
  id: number;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Seconds since the body was spawned or produced by a merge. */
  age: number;
  /** Seconds the top edge has sat above the dead line past the grace age. */
  overLineSeconds: number;
  /** 0..1 squash hint for the renderer; set by hard impacts and merges. */
  squash: number;
}

export interface SuipuffMergePop {
  x: number;
  y: number;
  /** The tier the merge produced; the tier-7 jackpot pop also reports 7. */
  tier: number;
  /** Points awarded — `score` disambiguates the +100 jackpot from +28. */
  score: number;
  /** Seconds left for the renderer to float this pop. */
  ttl: number;
}

export interface SuipuffGameState {
  width: number;
  height: number;
  status: SuipuffStatus;
  score: number;
  elapsed: number;
  rng: number;
  bodies: SuipuffBody[];
  nextBodyId: number;
  /** Horizontal aim of the held piece, clamped inside the tray walls. */
  aimX: number;
  /** Tier hovering at the aim point; -1 while the refill delay runs. */
  heldTier: number;
  /** Previewed tier that becomes held after the refill delay. */
  nextTier: number;
  /** Seconds until `nextTier` becomes the held piece. */
  dropCooldown: number;
  /** Y position a dropped body spawns at (held piece hovers there). */
  dropY: number;
  deadLineY: number;
  trayLeft: number;
  trayRight: number;
  trayWidth: number;
  floorY: number;
  mergePops: SuipuffMergePop[];
  /** Set by dropSuipuff, surfaced once as SUIPUFF_EVENT.DROPPED. */
  pendingDrop: boolean;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 260;
const MIN_TRAY_WIDTH = 280;
const MAX_TRAY_WIDTH = 460;
const TRAY_WIDTH_FROM_ARENA_W = 0.62;
const TRAY_WIDTH_FROM_ARENA_H = 0.72;
const FLOOR_MARGIN = 22;
const DEAD_LINE_MIN = 78;
const DEAD_LINE_RATIO = 0.16;
/** Gap between a held piece's bottom edge and the dead line. */
const DROP_GAP = 6;

const GRAVITY = 1_900;
const TERMINAL_VELOCITY = 2_000;
const AIR_DAMPING = 0.3;
const RESTITUTION = 0.08;
const RELAX_ITERATIONS = 4;
/** Positional correction per iteration (Box2D-lite style, inverse-mass split). */
const CORRECTION_PERCENT = 0.72;
const CORRECTION_SLOP = 0.02;
/** Coulomb cap on the tangential friction impulse relative to the normal one. */
const CONTACT_FRICTION = 0.35;
/** Per-iteration velocity retention on wall/floor contact (soft, not bouncy). */
const WALL_FRICTION_RETAIN = 0.99;
const FLOOR_FRICTION_RETAIN = 0.985;
/** Below this post-bounce speed the body settles instead of jittering. */
const REST_SPEED = 24;
/** Impact speed that starts to register a squash hint. */
const SQUASH_IMPACT = 160;
/** Contact slack in px for the merge pass — resolution leaves ~exact contact. */
const MERGE_CONTACT_SLOP = 0.5;
/** Upward kick a merged body gets, so merges read as a little pop. */
const MERGE_POP_VELOCITY = 70;
const MERGE_POP_SQUASH = 0.6;
const MERGE_POP_TTL = 0.8;

export const SUIPUFF_REFILL_SECONDS = 0.35;
export const SUIPUFF_OVERFLOW_GRACE_SECONDS = 0.6;
export const SUIPUFF_OVERFLOW_SECONDS = 1.0;
export const SUIPUFF_MERGE_POP_SECONDS = MERGE_POP_TTL;
export const SUIPUFF_FIXED_STEP = 1 / 60;
/** Largest single delta `stepSuipuffGame` accepts before truncating it. */
const MAX_STEP_DELTA = 0.1;

/** Points awarded when a merge produces `tier`; the 7+7 pop is the jackpot. */
export function suipuffMergeScore(tier: number): number {
  return (tier * (tier + 1)) / 2;
}

function nextRandom(state: SuipuffGameState): number {
  let value = state.rng || 0x6d2b79f5;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 0x1_0000_0000;
}

function rollDropTier(state: SuipuffGameState): number {
  return Math.floor(nextRandom(state) * SUIPUFF_DROP_TIER_COUNT);
}

interface TrayGeometry {
  trayWidth: number;
  trayLeft: number;
  trayRight: number;
  floorY: number;
  deadLineY: number;
}

function computeTrayGeometry(width: number, height: number): TrayGeometry {
  const trayWidth = Math.max(
    MIN_TRAY_WIDTH,
    Math.min(
      MAX_TRAY_WIDTH,
      Math.min(width * TRAY_WIDTH_FROM_ARENA_W, height * TRAY_WIDTH_FROM_ARENA_H),
    ),
  );
  return {
    trayWidth,
    trayLeft: (width - trayWidth) / 2,
    trayRight: (width + trayWidth) / 2,
    floorY: height - FLOOR_MARGIN,
    deadLineY: Math.max(DEAD_LINE_MIN, height * DEAD_LINE_RATIO),
  };
}

/** Tier radius in px for this state's current tray width. */
export function suipuffTierRadius(
  state: SuipuffGameState,
  tier: number,
): number {
  const base = SUIPUFF_TIER_RADII[Math.max(0, Math.min(SUIPUFF_TIER_COUNT - 1, tier))];
  return (base * state.trayWidth) / SUIPUFF_TRAY_REFERENCE_WIDTH;
}

/** The tier currently relevant for aiming: the held one, else the preview. */
function queueTier(state: SuipuffGameState): number {
  return state.heldTier >= 0 ? state.heldTier : state.nextTier;
}

function heldDropY(state: SuipuffGameState): number {
  return state.deadLineY - suipuffTierRadius(state, queueTier(state)) - DROP_GAP;
}

function clampAimX(state: SuipuffGameState, x: number): number {
  const radius = suipuffTierRadius(state, queueTier(state));
  const min = state.trayLeft + radius;
  const max = state.trayRight - radius;
  return Math.max(min, Math.min(max, x));
}

export function createSuipuffGame(
  width: number,
  height: number,
  seed = 0x48414d,
): SuipuffGameState {
  const safeWidth = Number.isFinite(width) ? Math.max(MIN_WIDTH, width) : MIN_WIDTH;
  const safeHeight = Number.isFinite(height) ? Math.max(MIN_HEIGHT, height) : MIN_HEIGHT;
  const geometry = computeTrayGeometry(safeWidth, safeHeight);
  const state: SuipuffGameState = {
    width: safeWidth,
    height: safeHeight,
    status: "ready",
    score: 0,
    elapsed: 0,
    rng: seed >>> 0 || 1,
    bodies: [],
    nextBodyId: 1,
    aimX: (geometry.trayLeft + geometry.trayRight) / 2,
    heldTier: -1,
    nextTier: -1,
    dropCooldown: 0,
    dropY: 0,
    deadLineY: geometry.deadLineY,
    trayLeft: geometry.trayLeft,
    trayRight: geometry.trayRight,
    trayWidth: geometry.trayWidth,
    floorY: geometry.floorY,
    mergePops: [],
    pendingDrop: false,
  };
  state.heldTier = rollDropTier(state);
  state.nextTier = rollDropTier(state);
  state.dropY = heldDropY(state);
  state.aimX = clampAimX(state, state.aimX);
  return state;
}

/** Starts a ready run without dropping — the held piece is already up. */
export function startSuipuff(state: SuipuffGameState): boolean {
  if (state.status !== "ready") return false;
  state.status = "playing";
  return true;
}

/** Moves the aim position, clamped so the queued piece fits inside the tray. */
export function setSuipuffAim(state: SuipuffGameState, x: number): void {
  if (!Number.isFinite(x)) return;
  state.aimX = clampAimX(state, x);
}

/**
 * Adds a live body inside the tray. Used by `dropSuipuff`; exported so tests
 * and tooling can place exact merge/overflow scenarios without simulating.
 */
export function addSuipuffBody(
  state: SuipuffGameState,
  tier: number,
  x: number,
  y: number,
): SuipuffBody {
  const radius = suipuffTierRadius(state, tier);
  const body: SuipuffBody = {
    id: state.nextBodyId++,
    tier,
    x: Math.max(state.trayLeft + radius, Math.min(state.trayRight - radius, x)),
    y: Math.min(y, state.floorY - radius),
    vx: 0,
    vy: 0,
    radius,
    age: 0,
    overLineSeconds: 0,
    squash: 0,
  };
  state.bodies.push(body);
  return body;
}

/**
 * Releases the held piece at the current aim. From "ready" this also starts
 * the run — dropping is Suipuff's one verb. Refused while refilling.
 */
export function dropSuipuff(state: SuipuffGameState): boolean {
  if (state.status === "ready") startSuipuff(state);
  if (state.status !== "playing") return false;
  if (state.heldTier < 0 || state.dropCooldown > 0) return false;

  addSuipuffBody(state, state.heldTier, state.aimX, state.dropY);
  state.heldTier = -1;
  state.dropCooldown = SUIPUFF_REFILL_SECONDS;
  state.pendingDrop = true;
  return true;
}

function applySquashImpact(body: SuipuffBody, speed: number): void {
  if (speed > SQUASH_IMPACT) {
    body.squash = Math.max(body.squash, Math.min(0.9, (speed - SQUASH_IMPACT) / 500));
  }
}

function collideWithTray(state: SuipuffGameState, body: SuipuffBody): void {
  if (body.x - body.radius < state.trayLeft) {
    body.x = state.trayLeft + body.radius;
    if (body.vx < 0) {
      applySquashImpact(body, -body.vx);
      body.vx = -body.vx * RESTITUTION;
    }
    body.vy *= WALL_FRICTION_RETAIN;
  } else if (body.x + body.radius > state.trayRight) {
    body.x = state.trayRight - body.radius;
    if (body.vx > 0) {
      applySquashImpact(body, body.vx);
      body.vx = -body.vx * RESTITUTION;
    }
    body.vy *= WALL_FRICTION_RETAIN;
  }

  if (body.y + body.radius > state.floorY) {
    body.y = state.floorY - body.radius;
    if (body.vy > 0) {
      applySquashImpact(body, body.vy);
      body.vy = -body.vy * RESTITUTION;
      if (Math.abs(body.vy) < REST_SPEED) body.vy = 0;
    }
    body.vx *= FLOOR_FRICTION_RETAIN;
  }
}

function collidePair(a: SuipuffBody, b: SuipuffBody): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const minDist = a.radius + b.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq >= minDist * minDist) return;

  const dist = Math.sqrt(distSq);
  // Perfectly concentric bodies get an arbitrary horizontal normal.
  const nx = dist > 0.0001 ? dx / dist : 1;
  const ny = dist > 0.0001 ? dy / dist : 0;
  const invA = 1 / (a.radius * a.radius);
  const invB = 1 / (b.radius * b.radius);
  const invSum = invA + invB;

  const correction =
    (Math.max(0, minDist - dist - CORRECTION_SLOP) * CORRECTION_PERCENT) / invSum;
  a.x -= nx * correction * invA;
  a.y -= ny * correction * invA;
  b.x += nx * correction * invB;
  b.y += ny * correction * invB;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;

  const impulse = (-(1 + RESTITUTION) * vn) / invSum;
  a.vx -= impulse * nx * invA;
  a.vy -= impulse * ny * invA;
  b.vx += impulse * nx * invB;
  b.vy += impulse * ny * invB;

  // Tangential friction, capped Coulomb-style by the normal impulse.
  const tx = -ny;
  const ty = nx;
  const vt = rvx * tx + rvy * ty;
  const maxFriction = impulse * CONTACT_FRICTION;
  const friction = Math.max(-maxFriction, Math.min(maxFriction, -vt / invSum));
  a.vx -= friction * tx * invA;
  a.vy -= friction * ty * invA;
  b.vx += friction * tx * invB;
  b.vy += friction * ty * invB;

  applySquashImpact(a, -vn);
  applySquashImpact(b, -vn);
}

/**
 * Same-tier contacts merge once per body per step. Chain reactions resume on
 * the next step — the freshly produced body is not eligible in the pass that
 * created it, which keeps the "one merge per body per step" rule exact.
 */
function mergePass(state: SuipuffGameState): SuipuffEventFlags {
  const bodies = state.bodies;
  const consumed = new Set<number>();
  const spawned: SuipuffBody[] = [];
  let events = SUIPUFF_EVENT.NONE;

  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    if (consumed.has(a.id)) continue;
    for (let j = i + 1; j < bodies.length; j += 1) {
      const b = bodies[j];
      if (b.tier !== a.tier || consumed.has(b.id)) continue;
      const reach = a.radius + b.radius + MERGE_CONTACT_SLOP;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx * dx + dy * dy >= reach * reach) continue;

      consumed.add(a.id);
      consumed.add(b.id);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;

      if (a.tier >= SUIPUFF_TIER_COUNT - 1) {
        state.score += SUIPUFF_TOP_TIER_JACKPOT;
        state.mergePops.push({
          x: midX,
          y: midY,
          tier: a.tier,
          score: SUIPUFF_TOP_TIER_JACKPOT,
          ttl: MERGE_POP_TTL,
        });
      } else {
        const tier = a.tier + 1;
        const radius = suipuffTierRadius(state, tier);
        const x = Math.max(
          state.trayLeft + radius,
          Math.min(state.trayRight - radius, midX),
        );
        const y = Math.min(midY, state.floorY - radius);
        const score = suipuffMergeScore(tier);
        state.score += score;
        spawned.push({
          id: state.nextBodyId++,
          tier,
          x,
          y,
          vx: (a.vx + b.vx) / 2,
          vy: (a.vy + b.vy) / 2 - MERGE_POP_VELOCITY,
          radius,
          age: 0,
          overLineSeconds: 0,
          squash: MERGE_POP_SQUASH,
        });
        state.mergePops.push({ x, y, tier, score, ttl: MERGE_POP_TTL });
      }
      events |= SUIPUFF_EVENT.MERGED;
      break;
    }
  }

  if (consumed.size > 0) {
    state.bodies = bodies.filter((body) => !consumed.has(body.id));
    state.bodies.push(...spawned);
  }
  return events;
}

function advanceSuipuff(
  state: SuipuffGameState,
  delta: number,
): SuipuffEventFlags {
  state.elapsed += delta;

  if (state.dropCooldown > 0) {
    state.dropCooldown -= delta;
    if (state.dropCooldown <= 0 && state.heldTier < 0) {
      state.heldTier = state.nextTier;
      state.nextTier = rollDropTier(state);
      state.dropY = heldDropY(state);
      state.aimX = clampAimX(state, state.aimX);
    }
  }

  for (const pop of state.mergePops) pop.ttl -= delta;
  state.mergePops = state.mergePops.filter((pop) => pop.ttl > 0);

  const damping = Math.exp(-AIR_DAMPING * delta);
  for (const body of state.bodies) {
    body.age += delta;
    body.vy = Math.min(TERMINAL_VELOCITY, body.vy + GRAVITY * delta);
    body.vx *= damping;
    body.vy *= damping;
    body.x += body.vx * delta;
    body.y += body.vy * delta;
    body.squash = Math.max(0, body.squash - delta * 4);
  }

  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration += 1) {
    for (const body of state.bodies) collideWithTray(state, body);
    for (let i = 0; i < state.bodies.length; i += 1) {
      for (let j = i + 1; j < state.bodies.length; j += 1) {
        collidePair(state.bodies[i], state.bodies[j]);
      }
    }
  }
  // Pair impulses get the last word inside the loop and can press a body a
  // fraction of a pixel through a wall or the floor. One final tray pass —
  // idempotent for bodies already inside — ends every step in bounds.
  for (const body of state.bodies) collideWithTray(state, body);

  let events = mergePass(state);

  for (const body of state.bodies) {
    if (
      body.y - body.radius < state.deadLineY &&
      body.age >= SUIPUFF_OVERFLOW_GRACE_SECONDS
    ) {
      body.overLineSeconds += delta;
    } else {
      body.overLineSeconds = 0;
    }
    if (body.overLineSeconds > SUIPUFF_OVERFLOW_SECONDS) {
      state.status = "dead";
      events |= SUIPUFF_EVENT.OVERFLOW;
      return events;
    }
  }

  return events;
}

/**
 * Advances the run. The caller drives this at a fixed 1/60 s; larger deltas
 * are sub-stepped internally so slow frames cannot tunnel bodies through the
 * pile or the floor.
 */
export function stepSuipuffGame(
  state: SuipuffGameState,
  deltaSeconds: number,
): SuipuffEventFlags {
  if (
    state.status !== "playing" ||
    !Number.isFinite(deltaSeconds) ||
    deltaSeconds <= 0
  ) {
    return SUIPUFF_EVENT.NONE;
  }

  let events = SUIPUFF_EVENT.NONE;
  if (state.pendingDrop) {
    events |= SUIPUFF_EVENT.DROPPED;
    state.pendingDrop = false;
  }

  let remaining = Math.min(MAX_STEP_DELTA, deltaSeconds);
  while (remaining > 1e-9 && state.status === "playing") {
    const step = Math.min(remaining, SUIPUFF_FIXED_STEP);
    remaining -= step;
    events |= advanceSuipuff(state, step);
  }
  return events;
}

/**
 * Reprojects a live run onto a new arena: positions scale with the arena,
 * radii with the tray width, and the aim/dead line are recomputed so nothing
 * is left stranded outside the tray.
 */
export function resizeSuipuffGame(
  state: SuipuffGameState,
  width: number,
  height: number,
): void {
  const safeWidth = Number.isFinite(width) ? Math.max(MIN_WIDTH, width) : MIN_WIDTH;
  const safeHeight = Number.isFinite(height) ? Math.max(MIN_HEIGHT, height) : MIN_HEIGHT;
  const rawScaleX = safeWidth / state.width;
  const rawScaleY = safeHeight / state.height;
  const scaleX = Number.isFinite(rawScaleX) && rawScaleX > 0 ? rawScaleX : 1;
  const scaleY = Number.isFinite(rawScaleY) && rawScaleY > 0 ? rawScaleY : 1;
  const geometry = computeTrayGeometry(safeWidth, safeHeight);

  state.width = safeWidth;
  state.height = safeHeight;
  state.trayWidth = geometry.trayWidth;
  state.trayLeft = geometry.trayLeft;
  state.trayRight = geometry.trayRight;
  state.floorY = geometry.floorY;
  state.deadLineY = geometry.deadLineY;

  for (const body of state.bodies) {
    body.x *= scaleX;
    body.y *= scaleY;
    // Velocities carry the arena's px/s units — scale them too so a resize
    // does not change how fast the pile visibly moves.
    body.vx *= scaleX;
    body.vy *= scaleY;
    body.radius = suipuffTierRadius(state, body.tier);
  }
  for (const pop of state.mergePops) {
    pop.x *= scaleX;
    pop.y *= scaleY;
  }
  state.aimX = clampAimX(state, state.aimX * scaleX);
  state.dropY = heldDropY(state);
}
