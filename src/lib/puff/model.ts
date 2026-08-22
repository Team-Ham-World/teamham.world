/**
 * The Puff — HAM's mascot, written as a signed distance field.
 *
 * A round fluffball: two ink-dot eyes, a tongue, two stubby feet, and a marker
 * loop curling off the top of its head. The loop is the point — it is the same
 * hand-drawn gesture the HAM wordmark is made of, which is what makes this
 * read as HAM's mascot rather than as a generic cute blob.
 *
 * Only three things here are geometry: the coat, the feet, and the marker
 * loop. The eyes and the tongue are *painted* on wherever a ray lands (see
 * `featureAt`) instead of being modelled as solids. Modelling them would push
 * two dark spheres out through the coat and read as googly eyes at any
 * resolution; painting them keeps the features flat against the fur, costs no
 * marching steps at all, and makes a blink a change of one radius rather than
 * a change of geometry.
 *
 * Everything is in model space: +x right, +y up, +z toward the camera. The
 * renderer rotates the *ray* rather than the model, so nothing below ever
 * needs to know which way the Puff is facing.
 */

/** Fur. Shaded from the surface normal, drawn in ink. */
export const MATERIAL_FLUFF = 0;
/** The marker loop. The one thing on the Puff drawn in the decorative red. */
export const MATERIAL_ACCENT = 1;
/** An eye. Always the heaviest glyph in the ramp, whatever the lighting. */
export const MATERIAL_EYE = 2;
/**
 * The catchlight inside an eye. Always left as bare paper, so the page itself
 * shows through the ink of the eye around it.
 *
 * It is one or two characters and it does more work than anything else on the
 * model: an eye rendered flat dark with no highlight reads as a hole rather
 * than as something looking back, which is most of the distance between
 * endearing and unsettling.
 */
export const MATERIAL_SHINE = 3;

/** Radius of the sphere that encloses the whole mascot, centred on BOUND_Y. */
export const BOUND_RADIUS = 1.62;
/** The model sits high in its own bounds — the marker loop overhangs the head. */
export const BOUND_Y = 0.2;

/* Coat. A very slightly squashed ellipsoid; the fur displacement below is what
   turns it from a ball into an animal. */
const BODY_RX = 0.9;
const BODY_RY = 0.84;
const BODY_RZ = 0.88;

/*
 * Ear tufts. Squashed spheres, mirrored through x = 0 and blended hard into the
 * crown so they read as tufts of the same coat rather than as bolted-on ears.
 * They are what makes the silhouette say "creature" before the face is legible
 * at all — without them the mascot is just a ball until you are close enough to
 * see that it has a face.
 */
const EAR_X = 0.5;
const EAR_Y = 0.72;
const EAR_R = 0.2;
const EAR_SX = 0.72;
const EAR_SY = 1.3;
const EAR_SZ = 0.66;
const EAR_BLEND = 0.1;

/* Stubby feet, mirrored through x = 0 so one distance call produces both. */
const FOOT_X = 0.36;
const FOOT_Y = -0.86;
const FOOT_Z = 0.2;
const FOOT_R = 0.19;
/** Feet are squashed vertically, so they read as feet rather than as balls. */
const FOOT_FLATTEN = 1.7;
const FOOT_BLEND = 0.14;

/*
 * Fur: two octaves of product-of-sines displacement pushed into the coat.
 *
 * The second octave is evaluated on mixed axes (x+z, y+x, z+y) on purpose. Both
 * octaves on the same axes would line their lattices up and the coat would
 * visibly ripple in a grid as it turns; skewing the second one breaks that up
 * into something that reads as fur.
 */
const FUR_LOW_FREQ = 7;
const FUR_LOW_AMP = 0.029;
const FUR_HIGH_FREQ = 16;
const FUR_HIGH_AMP = 0.0096;

/*
 * Texture frequency for `furShade`. Far higher than the geometric octaves
 * above, because it is free to be — it never touches the surface normal.
 */
const PILE_FREQ = 27;
/** The largest the displacement can ever be. Load-bearing — see `puffSdf`. */
const FUR_MAX = FUR_LOW_AMP + FUR_HIGH_AMP;
/**
 * How close a ray must be before the fur is worth evaluating. Above this the
 * SDF returns a cheap conservative bound instead, which keeps six `Math.sin`
 * calls out of the great majority of marching steps.
 */
const FUR_NEAR = 0.18;

/* The marker loop: a short stem off the crown, then a loop, both one stroke
   width thick. Set off to one side so the silhouette is not symmetrical. */
const STEM_AX = 0.05;
const STEM_AY = 0.7;
const STEM_AZ = 0.16;
const STEM_BX = 0.22;
const STEM_BY = 1.02;
const STEM_BZ = 0.02;
const LOOP_X = 0.34;
const LOOP_Y = 1.19;
const LOOP_Z = -0.08;
const LOOP_MAJOR = 0.17;
const STROKE_R = 0.052;
/* Tilt of the loop, so it presents as an ellipse rather than as a flat ring.
   Resolved to sines and cosines once, up here: they are constants, but they sit
   inside the distance function, which runs a few hundred thousand times a
   frame, and `Math.cos` of a constant does not get folded away for us. */
const LOOP_TILT_X = -0.34;
const LOOP_TILT_Y = 0.52;
const LOOP_COS_X = Math.cos(LOOP_TILT_X);
const LOOP_SIN_X = Math.sin(LOOP_TILT_X);
const LOOP_COS_Y = Math.cos(LOOP_TILT_Y);
const LOOP_SIN_Y = Math.sin(LOOP_TILT_Y);

/* Painted features, all stamped through the front of the face (z > FACE_Z). */
const FACE_Z = 0.25;
const EYE_X = 0.32;
/*
 * Below the middle of the face, not above it. Eyes set high are adult
 * proportions; a low-set pair under a big cranium is the strongest single cue
 * of infancy there is, and this mascot lives or dies on reading as a baby
 * animal rather than as a small adult one.
 */
const EYE_Y = -0.04;
const EYE_R = 0.162;

/* Offset of the catchlight from its eye's centre, and its radius. Held well
   inside the eye: nearer the rim it eats the dark crescent on that side and
   reads as a notch bitten out of the eye rather than as a highlight in it. */
const SHINE_DX = -0.042;
const SHINE_DY = 0.046;
const SHINE_R = 0.052;
/** Below this the lid is far enough down that a highlight makes no sense. */
const SHINE_MIN_BLINK = 0.6;

/**
 * Material of the surface the last `puffSdf` call was nearest to.
 *
 * Read it immediately after the call that landed the hit and before estimating
 * the normal, because the four extra probes that estimate a normal each
 * overwrite it.
 */
export let sdfMaterial = MATERIAL_FLUFF;

/** How the Puff is posed for one frame. Angles are radians. */
export interface PuffPose {
  /** Seconds since the animation started. Drives the float and the fur drift. */
  time: number;
  /** Vertical float offset applied to the whole body. */
  bob: number;
  /** 0 = at rest, 1 = fully squashed. Set by a poke, then decays. */
  squash: number;
  /** 1 = eyes open, near 0 = eyes shut. */
  blink: number;
  /** Horizontal eye offset across the face, in model-space units. */
  gazeX?: number;
  /** Vertical eye offset across the face, in model-space units. */
  gazeY?: number;
}

function sdSphere(x: number, y: number, z: number, r: number): number {
  return Math.sqrt(x * x + y * y + z * z) - r;
}

/**
 * Union that rounds the seam instead of creasing it, so the feet grow out of
 * the body rather than being parked against it.
 */
function smoothUnion(a: number, b: number, k: number): number {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function sdCapsule(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
): number {
  const pax = px - ax;
  const pay = py - ay;
  const paz = pz - az;
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const t = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz);
  const h = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

function fur(px: number, py: number, pz: number, time: number): number {
  const drift = time * 0.25;
  return (
    FUR_LOW_AMP *
      Math.sin(FUR_LOW_FREQ * px + drift) *
      Math.sin(FUR_LOW_FREQ * py) *
      Math.sin(FUR_LOW_FREQ * pz - drift) +
    FUR_HIGH_AMP *
      Math.sin(FUR_HIGH_FREQ * (px + pz)) *
      Math.sin(FUR_HIGH_FREQ * (py + px)) *
      Math.sin(FUR_HIGH_FREQ * (pz + py))
  );
}

/**
 * Fur texture, as a *shading* term rather than a displacement.
 *
 * Fur is fine enough that carving it into the geometry is self-defeating: at a
 * frequency high enough to read as fur, the displacement's own gradient swamps
 * the gradient of the ball underneath it, the estimated normals become noise,
 * and the mascot shades like television static instead of like a sphere. So
 * the geometry only carries tufts big enough to matter to the silhouette, and
 * the pile is painted on afterwards, where it costs three `Math.sin` calls per
 * *visible* pixel and cannot disturb the form at all.
 *
 * A weighted *sum* of three waves, not a product of them. A product of sines
 * spends nearly all of its time close to zero — multiply three numbers that are
 * usually small and the result is almost always negligible — so a pile built
 * that way contributes no visible variation across the coat at all, and the fur
 * shades out flat. A sum is spread across its whole range, so the coat actually
 * gets a texture.
 *
 * Returns -1..1.
 */
export function furShade(px: number, py: number, pz: number, time: number): number {
  /* Each factor is sampled on its own skewed axis, at its own frequency.
     Sampling them on x, y and z would put a beat exactly along the screen's
     own axes, and the coat would show a lattice of vertical bars rather than
     a pile. */
  return (
    Math.sin(PILE_FREQ * (px * 0.91 + py * 0.34 + pz * 0.24) + time * 0.4) * 0.5 +
    Math.sin(PILE_FREQ * 0.85 * (py * 0.87 - pz * 0.42 + px * 0.28)) * 0.3 +
    Math.sin(PILE_FREQ * 1.15 * (pz * 0.9 + px * 0.31 - py * 0.22)) * 0.2
  );
}

/** The marker loop: stem plus loop, as one distance. */
function markerLoop(px: number, py: number, pz: number): number {
  const stem = sdCapsule(
    px, py, pz,
    STEM_AX, STEM_AY, STEM_AZ,
    STEM_BX, STEM_BY, STEM_BZ,
    STROKE_R,
  );

  /* Into the loop's own frame: translate, then tilt about x and about y. The
     loop itself is a torus around the z axis, i.e. a circle drawn on the page. */
  let qx = px - LOOP_X;
  let qy = py - LOOP_Y;
  let qz = pz - LOOP_Z;

  const ty = qy * LOOP_COS_X - qz * LOOP_SIN_X;
  const tz = qy * LOOP_SIN_X + qz * LOOP_COS_X;
  qy = ty;
  qz = tz;

  const tx = qx * LOOP_COS_Y + qz * LOOP_SIN_Y;
  qz = -qx * LOOP_SIN_Y + qz * LOOP_COS_Y;
  qx = tx;

  const ring = Math.sqrt(qx * qx + qy * qy) - LOOP_MAJOR;
  const loop = Math.sqrt(ring * ring + qz * qz) - STROKE_R;

  return Math.min(stem, loop);
}

/**
 * Distance from a point to the Puff, and — via `sdfMaterial` — what it is
 * nearest to.
 *
 * The squash is a non-uniform scale of the sample point, so the returned
 * distance is scaled back by the smallest axis to keep it an under-estimate.
 * A sphere-tracing march is only safe while the field never over-states how
 * far away the surface is.
 */
export function puffSdf(px: number, py: number, pz: number, pose: PuffPose): number {
  const stretch = 1 + pose.squash * 0.16;
  const flatten = 1 - pose.squash * 0.22;

  /* Body space: undo the float, then undo the squash. */
  const bx = px / stretch;
  const by = (py - pose.bob) / flatten;
  const bz = pz / stretch;

  const ex = bx / BODY_RX;
  const ey = by / BODY_RY;
  const ez = bz / BODY_RZ;
  const coat = (Math.sqrt(ex * ex + ey * ey + ez * ez) - 1) * BODY_RY;

  const feet =
    sdSphere(
      Math.abs(bx) - FOOT_X,
      (by - FOOT_Y) * FOOT_FLATTEN,
      bz - FOOT_Z,
      FOOT_R,
    ) / FOOT_FLATTEN;

  let body = smoothUnion(coat, feet, FOOT_BLEND);

  const ax = (Math.abs(bx) - EAR_X) / EAR_SX;
  const ay = (by - EAR_Y) / EAR_SY;
  const az = bz / EAR_SZ;
  const ears =
    (Math.sqrt(ax * ax + ay * ay + az * az) - EAR_R) *
    Math.min(EAR_SX, EAR_SY, EAR_SZ);
  body = smoothUnion(body, ears, EAR_BLEND);

  /* Far from the surface the exact displacement does not matter, only that we
     never over-shoot it — so subtract the largest it could be and skip the
     trigonometry entirely. */
  body =
    body > FUR_NEAR ? body - FUR_MAX : body - fur(bx, by, bz, pose.time);
  body *= Math.min(stretch, flatten);

  const loop = markerLoop(px, py - pose.bob * 0.6, pz);

  if (loop < body) {
    sdfMaterial = MATERIAL_ACCENT;
    return loop;
  }
  sdfMaterial = MATERIAL_FLUFF;
  return body;
}

/**
 * The painted features. Given a point on the coat, reports whether it falls
 * inside an eye, or inside that eye's catchlight.
 *
 * Stamped straight through the front of the face rather than wrapped onto the
 * surface, which is exact enough at a resolution where an eye is seven
 * characters across, and stays perfectly crisp while the fur moves under it.
 */
export function featureAt(
  px: number,
  py: number,
  pz: number,
  pose: PuffPose,
): number {
  if (pz < FACE_Z) {
    return MATERIAL_FLUFF;
  }

  const y = py - pose.bob;
  const gazeX = pose.gazeX ?? 0;
  const gazeY = pose.gazeY ?? 0;

  /*
   * Signed rather than mirrored through |x|. Mirroring would put each
   * catchlight on the outer side of its own eye, which is what two lights
   * pointing inwards would do; there is one light in this room, so both
   * highlights have to land on the same side.
   */
  const side = px < 0 ? -1 : 1;
  const dx = px - (side * EYE_X + gazeX);
  const dy = y - (EYE_Y + gazeY);
  const lidded = dy / pose.blink;

  if (dx * dx + lidded * lidded < EYE_R * EYE_R) {
    if (pose.blink > SHINE_MIN_BLINK) {
      const sx = dx - SHINE_DX;
      const sy = dy - SHINE_DY;
      if (sx * sx + sy * sy < SHINE_R * SHINE_R) {
        return MATERIAL_SHINE;
      }
    }
    return MATERIAL_EYE;
  }

  return MATERIAL_FLUFF;
}
