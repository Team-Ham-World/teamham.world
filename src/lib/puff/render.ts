/**
 * Sphere-traced ASCII renderer for the Puff.
 *
 * Renders one frame into two character grids of identical size — one for ink
 * and one for the decorative red — which the component stacks as two `<pre>`
 * layers. Splitting by colour here is what lets a frame reach the DOM as two
 * text-node writes instead of a few thousand coloured `<span>`s.
 *
 * Rays are rotated into model space rather than the model being rotated into
 * world space, so `model.ts` never needs to know which way the Puff is facing
 * and the per-frame trigonometry is four `Math.cos`/`Math.sin` calls total.
 */

import {
  BOUND_RADIUS,
  BOUND_Y,
  featureAt,
  furShade,
  MATERIAL_ACCENT,
  MATERIAL_EYE,
  MATERIAL_SHINE,
  puffSdf,
  sdfMaterial,
  type PuffPose,
} from "./model";

/**
 * Glyphs from lightest to heaviest.
 *
 * The order is inverted from the usual ASCII-art ramp on purpose. This runs on
 * paper, not on a terminal: a heavy glyph lays down more ink and therefore
 * reads *darker*, so lit surfaces take the sparse end of the ramp and let the
 * paper show through.
 *
 * Short on purpose too. A longer ramp is not a finer ramp — the light end of
 * the usual sixty-glyph ones is a run of apostrophes, commas and colons that
 * all lay down about the same amount of ink, so the mid-tones collapse into a
 * single flat tone and the form goes with them. Ten glyphs that are actually
 * distinguishable band a little, which on a zine reads as intent.
 */
const RAMP = " .:-=+*#%@";
const DARKEST = RAMP.length - 1;

/** Camera sits on +z looking back down the axis at the model's centre. */
const CAM_DIST = 3.4;
/**
 * Height the camera aims at. Not the same as the bounding sphere's centre: the
 * marker loop overhangs the head, so the bounds run higher than the mass does,
 * and framing on them would leave the Puff sitting high with dead paper below.
 */
const CAM_TARGET_Y = 0.19;

/*
 * Half-extents of the box the mascot is framed into, in world units, measured
 * about CAM_TARGET_Y. The model is a little over a unit wide and a little over
 * 1.2 tall — the marker loop is what makes it taller than it is wide — and
 * these carry roughly a tenth of that again as margin.
 */
const FRAME_HALF_W = 1.08;
const FRAME_HALF_H = 1.33;

const MAX_STEPS = 56;
const SURFACE_EPS = 0.0035;
/**
 * Fraction of the reported distance actually stepped. The fur displacement
 * makes the field over-state distance slightly near the coat, so a full step
 * can tunnel through a tuft and drop the pixel.
 */
const STEP_SCALE = 0.8;
/** Offset used for the tetrahedral normal estimate. */
const NORMAL_H = 0.018;
/** Distance the ambient-occlusion probe walks along the normal. */
const AO_DIST = 0.07;

/**
 * Glyph dither.
 *
 * Neighbouring cells of near-equal brightness otherwise pick the same glyph,
 * and a column of identical glyphs at this line height chains into a visible
 * vertical rule — the coat comes out ruled rather than furry. A fraction of a
 * full ramp step of per-cell noise scatters those ties, which turns the banding
 * into grain and reads, on paper, as a halftone.
 */
const DITHER = 0.05;

/* Key light, in world space: above, to the left, and in front. */
const LIGHT_X = -0.42;
const LIGHT_Y = 0.55;
const LIGHT_Z = 0.72;

/* Fill, from low and in front: the light a pale animal picks up off the floor
   it is standing on. Without it the underside collapses into solid ink and
   takes the feet with it. */
const FILL_X = 0.3;
const FILL_Y = -0.62;
const FILL_Z = 0.72;
const FILL_STRENGTH = 0.15;

/** Strength of the specular patch where the coat faces the key light. */
const SHEEN = 0.13;

/**
 * Per-cell hash in 0..1.
 *
 * An integer bit-mix rather than the usual `fract(sin(dot(p, k)) * big)` trick.
 * That one is written for texture coordinates in 0..1; fed raw column and row
 * indices it is not a hash at all — stepping one row advances the sine by a
 * fixed 78.233 radians, which is 2.8 radians modulo a turn, so the "noise"
 * repeats every 2.2 rows and lays down its own vertical pattern on top of the
 * one it was added to break up.
 */
function cellNoise(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Two same-sized character grids, newline separated, ready for `textContent`. */
export interface PuffFrame {
  ink: string;
  accent: string;
}

/** Where the camera is looking from, as an orientation of the model. */
export interface PuffView {
  yaw: number;
  pitch: number;
}

/* Row scratch, reused across frames so a 60fps loop is not allocating ~6000
   single-character strings every frame. Grown on demand, never shrunk. */
let inkCells: string[] = [];
let accentCells: string[] = [];

export function renderPuff(
  cols: number,
  rows: number,
  /** Physical width of one character cell divided by its height. */
  cellAspect: number,
  pose: PuffPose,
  view: PuffView,
): PuffFrame {
  if (inkCells.length < cols) {
    inkCells = new Array<string>(cols);
    accentCells = new Array<string>(cols);
  }

  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);

  /*
   * Inverse of the model's own rotation (yaw about y, then pitch about x),
   * applied to anything that needs to cross from world space into model space:
   * the camera, every ray, and the key light.
   */
  const toModel = (x: number, y: number, z: number): [number, number, number] => {
    const y1 = y * cp + z * sp;
    const z1 = -y * sp + z * cp;
    return [x * cy - z1 * sy, y1, x * sy + z1 * cy];
  };

  const [ox, oy, oz] = toModel(0, CAM_TARGET_Y, CAM_DIST);
  const [lx, ly, lz] = toModel(LIGHT_X, LIGHT_Y, LIGHT_Z);
  const [fx, fy, fz] = toModel(FILL_X, FILL_Y, FILL_Z);

  /*
   * Frame the model to whatever shape the grid turned out to be.
   *
   * Solved per frame rather than fixed as a focal length: a fixed lens has to
   * be short enough for the worst aspect the stage can take, which leaves the
   * mascot small in every other one — it was surrendering about a fifth of its
   * width on the two-column desktop layout. Growing whichever axis has room to
   * spare instead keeps the model at the same size on screen and lets the
   * surplus fall outside the frame, where it costs nothing but blank paper.
   */
  const gridAspect = (cols / rows) * cellAspect;
  let halfW: number;
  let halfH: number;
  if (gridAspect >= 1) {
    halfH = Math.max(FRAME_HALF_H, FRAME_HALF_W / gridAspect);
    halfW = halfH * gridAspect;
  } else {
    halfW = Math.max(FRAME_HALF_W, FRAME_HALF_H * gridAspect);
    halfH = halfW / gridAspect;
  }

  const inkRows: string[] = new Array<string>(rows);
  const accentRows: string[] = new Array<string>(rows);

  for (let row = 0; row < rows; row++) {
    const v = (1 - (2 * (row + 0.5)) / rows) * halfH;

    for (let col = 0; col < cols; col++) {
      const u = ((2 * (col + 0.5)) / cols - 1) * halfW;

      const [rdx, rdy, rdz] = toModel(u, v, -CAM_DIST);
      const invLen = 1 / Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz);
      const dx = rdx * invLen;
      const dy = rdy * invLen;
      const dz = rdz * invLen;

      /* Ray against the bounding sphere first. Most cells in the grid are empty
         paper, and this retires each of them in about a dozen operations
         instead of a full march that finds nothing. */
      const ocy = oy - BOUND_Y;
      const b = ox * dx + ocy * dy + oz * dz;
      const c = ox * ox + ocy * ocy + oz * oz - BOUND_RADIUS * BOUND_RADIUS;
      const disc = b * b - c;

      inkCells[col] = " ";
      accentCells[col] = " ";

      if (disc < 0) {
        continue;
      }

      const h = Math.sqrt(disc);
      const tFar = -b + h;
      if (tFar < 0) {
        continue;
      }

      let t = Math.max(-b - h, 0);
      let hit = false;

      for (let step = 0; step < MAX_STEPS; step++) {
        const d = puffSdf(ox + dx * t, oy + dy * t, oz + dz * t, pose);

        if (d < SURFACE_EPS) {
          hit = true;
          break;
        }
        t += d * STEP_SCALE;
        if (t > tFar) {
          break;
        }
      }

      if (!hit) {
        continue;
      }

      const px = ox + dx * t;
      const py = oy + dy * t;
      const pz = oz + dz * t;

      /* Read the material now: the four normal probes below each overwrite it. */
      let material = sdfMaterial;

      const e = NORMAL_H;
      const nA = puffSdf(px + e, py - e, pz - e, pose);
      const nB = puffSdf(px - e, py - e, pz + e, pose);
      const nC = puffSdf(px - e, py + e, pz - e, pose);
      const nD = puffSdf(px + e, py + e, pz + e, pose);
      let nx = nA - nB - nC + nD;
      let ny = -nA - nB + nC + nD;
      let nz = -nA + nB - nC + nD;
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      if (material !== MATERIAL_ACCENT) {
        material = featureAt(px, py, pz, pose);
      }

      /* Wrapped diffuse: fur scatters, so the terminator is soft rather than a
         hard line, and the unlit side never goes to solid black. */
      const nl = nx * lx + ny * ly + nz * lz;
      let lum = 0.42 + 0.58 * nl;

      /* A sheen where the coat faces the key light square on. One bright patch
         is most of what tells the eye this is a ball and not a disc. */
      const towardKey = nl > 0 ? nl : 0;
      lum += SHEEN * towardKey ** 6;

      /* Fill, from low and in front. Without it the whole underside sits below
         the terminator at once and closes up into one mass, taking the feet
         with it — they read as feet only because there is a shadow *under*
         them, which needs the surfaces above them to be lighter than black. */
      const nf = nx * fx + ny * fy + nz * fz;
      lum += FILL_STRENGTH * (nf > 0 ? nf : 0);

      /* One occlusion probe along the normal. Between fur tufts the field comes
         back much shorter than the probe, which is what darkens the crevices
         and stops the coat reading as a smooth ball. */
      const occlusion = puffSdf(
        px + nx * AO_DIST,
        py + ny * AO_DIST,
        pz + nz * AO_DIST,
        pose,
      );
      const ao = Math.min(1, Math.max(0, occlusion / AO_DIST));
      lum *= 0.76 + 0.24 * ao;

      /* The pile itself. Applied to the coat only — a marker stroke has no fur. */
      if (material !== MATERIAL_ACCENT) {
        lum += 0.11 * furShade(px, py, pz, pose.time);
      }

      /* Darken toward the silhouette so the shape closes with a contour line,
         the way it would if someone had drawn it. Without this the mascot
         dissolves into the paper exactly where its outline should be. */
      const facing = -(nx * dx + ny * dy + nz * dz);
      const rim = 1 - Math.min(1, Math.max(0, facing));
      lum -= rim * rim * rim * 0.95;

      /* Lift the floor before clamping. Fur is a pale coat lit by a room, not a
         billiard ball in a void; letting the shadow side reach zero would fill
         a third of the mascot with solid ink and bury the feet in it. */
      lum = 0.06 + 0.94 * lum;

      lum += (cellNoise(col, row) - 0.5) * DITHER;
      lum = lum < 0 ? 0 : lum > 1 ? 1 : lum;

      /* Index 1 rather than 0 at the bright end: a lit patch should be the
         faintest speckle of ink, never bare paper. Blank cells are reserved for
         "no geometry here", which is the only thing that keeps the silhouette
         readable against the page. */
      const shade = Math.round(1 + (1 - lum) * (DARKEST - 1));

      if (material === MATERIAL_EYE) {
        inkCells[col] = RAMP[DARKEST];
      } else if (material === MATERIAL_SHINE) {
        /* Left as paper. A highlight is an absence of ink, not a lighter ink. */
        inkCells[col] = RAMP[0];
      } else if (material === MATERIAL_ACCENT) {
        /*
         * The red layer is a thin stroke against paper, so it is floored well up
         * the ramp — a marker line that faded to "." would just vanish. The
         * floor has to rise with resolution, too: the stroke is a fixed
         * thickness in world units, so a finer grid spreads the same ink over
         * more characters and lightens every one of them until the loop reads as
         * wireframe rather than as marker.
         */
        accentCells[col] = RAMP[Math.max(shade, 8)];
      } else {
        inkCells[col] = RAMP[shade];
      }
    }

    inkRows[row] = inkCells.slice(0, cols).join("");
    accentRows[row] = accentCells.slice(0, cols).join("");
  }

  return { ink: inkRows.join("\n"), accent: accentRows.join("\n") };
}
