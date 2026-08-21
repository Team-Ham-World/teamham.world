export const MAX_PUFF_STAMPS = 24;

export interface PuffStamp {
  /** Position within the hero, stored as ratios so resize can replay the pad. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  ghostShiftX: number;
  ghostShiftY: number;
}

function noise(index: number, lane: number): number {
  let value =
    Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(lane + 1, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

/** A repeatable, slightly imperfect print rather than a random visual jump. */
export function createPuffStamp(
  index: number,
  x: number,
  y: number,
  scaleMultiplier = 1,
  opacityMultiplier = 1,
): PuffStamp {
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    scale: (0.28 + noise(index, 0) * 0.08) * scaleMultiplier,
    rotation: ((noise(index, 1) * 12 - 6) * Math.PI) / 180,
    opacity: Math.min(
      0.72,
      (0.3 + noise(index, 2) * 0.13) * opacityMultiplier,
    ),
    ghostShiftX: noise(index, 3) * 7 - 3.5,
    ghostShiftY: noise(index, 4) * 5 - 2.5,
  };
}

/** Mutates the small display list and recycles the oldest print at the cap. */
export function appendPuffStamp(
  stamps: PuffStamp[],
  stamp: PuffStamp,
  limit = MAX_PUFF_STAMPS,
): void {
  stamps.push(stamp);
  if (stamps.length > limit) stamps.splice(0, stamps.length - limit);
}
