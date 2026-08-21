import { describe, it, expect } from "vitest";

import { renderPuff } from "@/lib/puff/render";
import {
  appendPuffStamp,
  createPuffStamp,
  type PuffStamp,
} from "@/lib/puff/stamp";
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

    const overlaps = [...ink].filter(
      (char, index) =>
        char !== " " && char !== "\n" && accent[index] !== " ",
    );
    expect(overlaps).toEqual([]);
  });

  it("draws the mascot without filling the frame", () => {
    const { ink, accent } = renderPuff(64, 40, CELL_ASPECT, REST, {
      yaw: 0,
      pitch: 0,
    });
    const drawn = [...ink, ...accent].filter(
      (char) => char !== " " && char !== "\n",
    );

    expect(drawn.length).toBeGreaterThan(600);
    expect(drawn.length).toBeLessThan(64 * 40);
  });

  it("keeps the red to the marker loop, above the head", () => {
    const { accent } = renderPuff(64, 40, CELL_ASPECT, REST, {
      yaw: 0,
      pitch: 0,
    });
    const rows = accent.split("\n");

    const marked = rows.flatMap((row, y) => (row.trim() ? [y] : []));
    expect(marked.length).toBeGreaterThan(0);
    expect(Math.max(...marked)).toBeLessThan(rows.length / 2);
  });

  it("opens a catchlight inside each eye", () => {
    const { ink } = renderPuff(72, 52, CELL_ASPECT, REST, {
      yaw: 0,
      pitch: 0,
    });
    const rows = ink.split("\n");

    const enclosedGaps = rows.flatMap((row) => {
      const found: string[] = [];
      for (let i = 1; i < row.length - 1; i++) {
        if (row[i] === " " && row[i - 1] === "@" && row[i + 1] === "@") {
          found.push(row);
        }
      }
      return found;
    });
    expect(enclosedGaps.length).toBeGreaterThan(0);
  });
});

describe("Puff's stamp pad", () => {
  it("recycles the oldest print after the 24-stamp cap", () => {
    const stamps: PuffStamp[] = [];
    for (let index = 0; index < 25; index++) {
      appendPuffStamp(stamps, createPuffStamp(index, 0.5, 0.5));
    }

    expect(stamps).toHaveLength(24);
    expect(stamps[0]).toEqual(createPuffStamp(1, 0.5, 0.5));
    expect(stamps.at(-1)).toEqual(createPuffStamp(24, 0.5, 0.5));
  });
});

describe("lib/puff/model", () => {
  it("never over-states the distance to the surface", () => {
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const x = -1.6 + (3.2 * i) / 11;
        const y = -1.6 + (3.2 * j) / 11;
        for (const z of [-0.9, 0, 0.6, 1.4]) {
          const here = puffSdf(x, y, z, REST);
          if (here <= 0) continue;
          const stepped = puffSdf(x, y, z - here, REST);
          expect(stepped).toBeGreaterThan(-1e-6);
        }
      }
    }
  });

  it("paints eyes on the face and nothing on the back of the head", () => {
    expect(featureAt(0.32, -0.04, 0.85, REST)).toBe(MATERIAL_EYE);
    expect(featureAt(0.32, -0.04, -0.85, REST)).toBe(MATERIAL_FLUFF);
    expect(featureAt(0, -0.04, 0.85, REST)).toBe(MATERIAL_FLUFF);
  });

  it("puts both catchlights on the same side, as one light source would", () => {
    expect(featureAt(0.32 - 0.042, -0.04 + 0.046, 0.85, REST)).toBe(
      MATERIAL_SHINE,
    );
    expect(featureAt(-0.32 - 0.042, -0.04 + 0.046, 0.85, REST)).toBe(
      MATERIAL_SHINE,
    );
    expect(featureAt(-0.32 + 0.042, -0.04 + 0.046, 0.85, REST)).toBe(
      MATERIAL_EYE,
    );
  });

  it("closes the eyes to a slit when blinking, and drops the catchlight", () => {
    const shut = { ...REST, blink: 0.14 };
    expect(featureAt(0.32, 0.06, 0.85, REST)).toBe(MATERIAL_EYE);
    expect(featureAt(0.32, 0.06, 0.85, shut)).toBe(MATERIAL_FLUFF);
    expect(featureAt(0.32, -0.04, 0.85, shut)).toBe(MATERIAL_EYE);
    expect(
      featureAt(0.32 - 0.042, -0.04 + 0.046, 0.85, shut),
    ).not.toBe(MATERIAL_SHINE);
  });

  it("grows ear tufts clear of the body", () => {
    expect(puffSdf(0.5, 0.85, 0, REST)).toBeLessThan(0);
    expect(puffSdf(0, 1.02, 0, REST)).toBeGreaterThan(0);
  });
});
