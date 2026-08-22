const MOBILE_PIXEL_RATIO_LIMIT = 1.25;
const DESKTOP_PIXEL_RATIO_LIMIT = 1.5;
const MOBILE_RENDER_FPS = 30;
const DESKTOP_RENDER_FPS = 60;

export interface PuffRenderProfileInput {
  devicePixelRatio: number;
  coarsePointer: boolean;
}

export interface PuffRenderProfile {
  pixelRatio: number;
  frameIntervalMs: number;
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
  const framesPerSecond = coarsePointer
    ? MOBILE_RENDER_FPS
    : DESKTOP_RENDER_FPS;

  return {
    pixelRatio: Math.min(safePixelRatio, pixelRatioLimit),
    frameIntervalMs: 1000 / framesPerSecond,
  };
}
