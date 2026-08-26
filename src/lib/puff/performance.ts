const MOBILE_PIXEL_RATIO_LIMIT = 1.25;
const DESKTOP_PIXEL_RATIO_LIMIT = 1.5;
const RENDER_FPS = 60;
const RENDER_EARLY_TOLERANCE_MS = 1.5;

export type PuffRenderPhase = "ready" | "playing" | "paused" | "dead";

export interface PuffRenderProfileInput {
  devicePixelRatio: number;
  coarsePointer: boolean;
}

export interface PuffRenderProfile {
  pixelRatio: number;
  frameIntervalMs: number;
}

export interface PuffRenderClockInput {
  accumulatorMs: number;
  elapsedMs: number;
  frameIntervalMs: number;
  phase: PuffRenderPhase;
  forceDraw: boolean;
  canDraw: boolean;
}

export interface PuffRenderClockStep {
  accumulatorMs: number;
  shouldDraw: boolean;
}

/** Keep game physics precise while bounding the canvas work per display frame. */
export function getPuffRenderProfile({
  devicePixelRatio,
  coarsePointer,
}: PuffRenderProfileInput): PuffRenderProfile {
  const safePixelRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const pixelRatioLimit = coarsePointer
    ? MOBILE_PIXEL_RATIO_LIMIT
    : DESKTOP_PIXEL_RATIO_LIMIT;
  return {
    pixelRatio: Math.min(safePixelRatio, pixelRatioLimit),
    frameIntervalMs: 1000 / RENDER_FPS,
  };
}

/** Schedule canvas work without carrying idle time into the next moving phase. */
export function advancePuffRenderClock({
  accumulatorMs,
  elapsedMs,
  frameIntervalMs,
  phase,
  forceDraw,
  canDraw,
}: PuffRenderClockInput): PuffRenderClockStep {
  const sceneIsMoving = phase === "playing" || phase === "ready";
  let nextAccumulatorMs = sceneIsMoving
    ? accumulatorMs + elapsedMs
    : 0;
  const shouldDraw =
    canDraw &&
    (forceDraw ||
      (sceneIsMoving &&
        nextAccumulatorMs + RENDER_EARLY_TOLERANCE_MS >= frameIntervalMs));

  if (shouldDraw && sceneIsMoving) {
    nextAccumulatorMs = Math.max(
      0,
      nextAccumulatorMs - frameIntervalMs,
    );
  }

  return { accumulatorMs: nextAccumulatorMs, shouldDraw };
}
