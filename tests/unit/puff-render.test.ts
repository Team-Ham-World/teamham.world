import { describe, it, expect } from "vitest";

import { renderPuff } from "@/lib/puff/render";
import {
  MATERIAL_EYE,
  MATERIAL_FLUFF,
  MATERIAL_SHINE,
  featureAt,
  puffSdf,
} from "@/lib/puff/model";

/*
 * The renderer is pure — a pose in, two character grids out — so it is testable
 * without a DOM. What is worth pinning here is the grid contract the component
 * relies on (the two layers must line up character for character) and the
 * marching invariant the whole image depends on: the field must never report a
 * distance longer than the real one, or rays step through the coat and drop
 * pixels out of the mascot.
 */

const REST = { time: 1.2, bob: 0, squash: 0, blink: 1 };
const CELL_ASPECT = 0.6 / 0.74;

describe("lib/puff/render", () => {
  it("returns two grids of exactly the requested shape", () => {
    const { ink, accent } = renderPuff(64, 40, CELL_ASPECT, REST, {
      yaw: 0,
      pitch: 0,
    });

    for (const layer of [ink, accent]) {
      const rows = layer.split("\n");
      expect(rows).toHaveLength(40);
      expect(new Set(rows.map((row) => row.length))).toEqual(new Set([64]));
    }
  });

  it("never puts ink and accent in the same cell", () => {
    const { ink, accent } = renderPuff(64, 40, CELL_ASPECT, REST, {
      yaw: 0.4,
      pitch: -0.1,
    });

    // The two layers are stacked, so a cell claimed by both would print one
    // glyph on top of the other.
    const overlaps = [...ink].filter(
      (char, index) => char !== " " && char !== "\n" && accent[index] !== " ",
    );
    expect(overlaps).toEqual([]);
  });

  it("draws the mascot without filling the frame", () => {
    const { ink, accent } = renderPuff(64, 40, CELL_ASPECT, REST, {
      yaw: 0,
      pitch: 0,
    });
    const drawn = [...ink, ...accent].filter((char) => char !== " " && char !== "\n");

    // Enough to be a mascot, little enough to still be a silhouette on paper.
    expect(drawn.length).toBeGreaterThan(600);
    expect(drawn.length).toBeLessThan(64 * 40);
  });

  it("keeps the red to the marker loop, above the head", () => {
    const { accent } = renderPuff(64, 40, CELL_ASPECT, REST, { yaw: 0, pitch: 0 });
    const rows = accent.split("\n");

    const marked = rows.flatMap((row, y) => (row.trim() ? [y] : []));
    expect(marked.length).toBeGreaterThan(0);
    // The loop is the only red thing on the Puff and it rides over the crown,
    // so every red cell belongs in the top half of the frame.
    expect(Math.max(...marked)).toBeLessThan(rows.length / 2);
  });

  it("opens a catchlight inside each eye", () => {
    const { ink } = renderPuff(72, 52, CELL_ASPECT, REST, { yaw: 0, pitch: 0 });
    const rows = ink.split("\n");

    /*
     * A catchlight is a blank cell with eye on both sides of it — which is also
     * the only place on the whole render where a gap can be enclosed by the
     * heaviest glyph, since blanks otherwise mean "no geometry".
     */
    const enclosedGaps = rows.flatMap((row) => {
      const found: string[] = [];
      for (let i = 1; i < row.length - 1; i++) {
        if (row[i] === " " && row[i - 1] === "@" && row[i + 1] === "@") found.push(row);
      }
      return found;
    });
    expect(enclosedGaps.length).toBeGreaterThan(0);
  });
});

describe("lib/puff/model", () => {
  it("never over-states the distance to the surface", () => {
    /*
     * Sphere tracing is only safe while the field under-estimates. The fur
     * displacement is what puts that at risk, so this walks a grid of points
     * and checks that stepping the reported distance toward the surface never
     * lands past it — approximated by confirming the field cannot change by
     * more than the step taken.
     */
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const x = -1.6 + (3.2 * i) / 11;
        const y = -1.6 + (3.2 * j) / 11;
        for (const z of [-0.9, 0, 0.6, 1.4]) {
          const here = puffSdf(x, y, z, REST);
          if (here <= 0) continue;
          // Step straight down the z axis by the reported safe distance.
          const stepped = puffSdf(x, y, z - here, REST);
          expect(stepped).toBeGreaterThan(-1e-6);
        }
      }
    }
  });

  it("paints eyes on the face and nothing on the back of the head", () => {
    // Dead centre of the right eye.
    expect(featureAt(0.32, -0.04, 0.85, REST)).toBe(MATERIAL_EYE);
    // The same coordinates behind the head must stay plain fur.
    expect(featureAt(0.32, -0.04, -0.85, REST)).toBe(MATERIAL_FLUFF);
    // Between the eyes is fur, not eye.
    expect(featureAt(0, -0.04, 0.85, REST)).toBe(MATERIAL_FLUFF);
  });

  it("puts both catchlights on the same side, as one light source would", () => {
    /*
     * The right eye sits at +0.32 and the left at -0.32, and the highlight is
     * offset -0.042 in world x. Both therefore land left-of-centre *within
     * their own eye* — mirroring the offset instead would splay them outwards
     * and read as two lights pointing in at the face.
     */
    expect(featureAt(0.32 - 0.042, -0.04 + 0.046, 0.85, REST)).toBe(MATERIAL_SHINE);
    expect(featureAt(-0.32 - 0.042, -0.04 + 0.046, 0.85, REST)).toBe(MATERIAL_SHINE);
    // The mirrored position on the left eye is eye, not highlight.
    expect(featureAt(-0.32 + 0.042, -0.04 + 0.046, 0.85, REST)).toBe(MATERIAL_EYE);
  });

  it("closes the eyes to a slit when blinking, and drops the catchlight", () => {
    const shut = { ...REST, blink: 0.14 };
    // Well inside the open eye, but outside it once the lid is down.
    expect(featureAt(0.32, 0.06, 0.85, REST)).toBe(MATERIAL_EYE);
    expect(featureAt(0.32, 0.06, 0.85, shut)).toBe(MATERIAL_FLUFF);
    // Dead centre stays an eye either way, but a shut eye has no highlight in it.
    expect(featureAt(0.32, -0.04, 0.85, shut)).toBe(MATERIAL_EYE);
    expect(featureAt(0.32 - 0.042, -0.04 + 0.046, 0.85, shut)).not.toBe(MATERIAL_SHINE);
  });

  it("grows ear tufts clear of the body", () => {
    /*
     * A point up at the ear tip. The body ellipsoid alone does not reach it —
     * that is the whole point of the tufts — so a negative distance here is
     * only possible because the ears are part of the union.
     */
    expect(puffSdf(0.5, 0.85, 0, REST)).toBeLessThan(0);
    // Straight up between the tufts stays outside.
    expect(puffSdf(0, 1.02, 0, REST)).toBeGreaterThan(0);
  });
});
