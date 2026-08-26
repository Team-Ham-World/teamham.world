import { describe, expect, it } from "vitest";

import {
  classifyAvifStatic,
  classifyPngStatic,
  classifyWebPStatic,
  inspectAvifStatic,
  inspectPngStatic,
  inspectWebPStatic,
} from "@/lib/members/assets/animation";
import {
  syntheticAvif,
  syntheticPng,
  syntheticWebP,
} from "../fixtures/member-v2/images/synthetic";

describe("member V2 static animation classifiers", () => {
  it("accepts bounded, clearly static PNG, WebP, and AVIF structures", () => {
    expect(classifyPngStatic(syntheticPng())).toEqual({ kind: "static" });
    expect(classifyWebPStatic(syntheticWebP())).toEqual({ kind: "static" });
    expect(classifyAvifStatic(syntheticAvif())).toEqual({ kind: "static" });
  });

  it("returns exact dimensions only after complete static classification", () => {
    expect(inspectPngStatic(syntheticPng(301, 201))).toEqual({
      kind: "static",
      dimensions: { width: 301, height: 201 },
    });
    expect(inspectWebPStatic(syntheticWebP(302, 202))).toEqual({
      kind: "static",
      dimensions: { width: 302, height: 202 },
    });
    expect(
      inspectWebPStatic(
        syntheticWebP(303, 203, { encoding: "vp8l", extended: false }),
      ),
    ).toEqual({
      kind: "static",
      dimensions: { width: 303, height: 203 },
    });
    expect(inspectAvifStatic(syntheticAvif(304, 204))).toEqual({
      kind: "static",
      dimensions: { width: 304, height: 204 },
    });
  });

  it("rejects APNG and every WebP animation signal", () => {
    expect(classifyPngStatic(syntheticPng(10, 10, { animated: true }))).toEqual({
      kind: "animated",
      reason: "apng",
    });
    expect(classifyWebPStatic(syntheticWebP(10, 10, { animated: true }))).toEqual({
      kind: "animated",
      reason: "animated_webp",
    });
    expect(
      classifyWebPStatic(syntheticWebP(10, 10, { animationChunk: true })),
    ).toEqual({ kind: "animated", reason: "animated_webp" });
  });

  it("rejects AVIF sequence brands, tracks, and uncertain item references", () => {
    expect(classifyAvifStatic(syntheticAvif(10, 10, { sequenceBrand: true }))).toEqual({
      kind: "animated",
      reason: "avif_sequence",
    });
    expect(classifyAvifStatic(syntheticAvif(10, 10, { trackBox: true }))).toEqual({
      kind: "animated",
      reason: "avif_sequence",
    });
    expect(classifyAvifStatic(syntheticAvif(10, 10, { itemReference: true }))).toEqual({
      kind: "uncertain",
      reason: "unsupported_structure",
    });
    expect(
      classifyAvifStatic(
        syntheticAvif(10, 10, {
          majorBrand: "mif1",
          compatibleBrands: ["avif", "mif1"],
        }),
      ),
    ).toEqual({ kind: "uncertain", reason: "invalid_signature" });
  });

  it("fails closed on malformed/truncated data", () => {
    expect(classifyPngStatic(syntheticPng().slice(0, -1)).kind).toBe("uncertain");
    expect(classifyWebPStatic(syntheticWebP().slice(0, -1)).kind).toBe("uncertain");
    expect(classifyAvifStatic(syntheticAvif().slice(0, -1)).kind).toBe("uncertain");
    expect(classifyAvifStatic(syntheticAvif(0, 10))).toEqual({
      kind: "uncertain",
      reason: "malformed",
    });

    const zeroSizeBox = syntheticAvif(10, 10, { paddingBytes: 1 }).slice();
    zeroSizeBox.fill(0, 28, 32);
    expect(classifyAvifStatic(zeroSizeBox)).toEqual({
      kind: "uncertain",
      reason: "malformed",
    });

    const corruptPng = syntheticPng().slice();
    corruptPng[corruptPng.byteLength - 1] ^= 1;
    expect(classifyPngStatic(corruptPng)).toEqual({
      kind: "uncertain",
      reason: "malformed",
    });
  });

  it("terminates deterministically at the container-entry bound", () => {
    expect(classifyPngStatic(syntheticPng(10, 10, { chunkCount: 4_100 }))).toEqual({
      kind: "uncertain",
      reason: "parser_limit",
    });
  });
});
