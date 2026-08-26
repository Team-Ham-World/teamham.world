import { describe, expect, it } from "vitest";

import type {
  MemberAssetMimeType,
  R2StorageAdapter,
} from "@/lib/members/assets/types";
import { verifyStoredMemberAsset } from "@/lib/members/assets/verify";
import { ASSET_MAX_BYTES } from "@/lib/members/v2/limits";
import {
  syntheticAvif,
  syntheticGif,
  syntheticIcnsZeroEntry,
  syntheticJpeg,
  syntheticJxlCodestream,
  syntheticJxlContainer,
  syntheticMalformedJpegLargeZeros,
  syntheticPng,
  syntheticSvg,
  syntheticWebP,
} from "../fixtures/member-v2/images/synthetic";

function fakeStorage(
  bytes: Uint8Array,
  mimeType: string,
  options: {
    headSize?: number | null;
    rangeTotalSize?: number;
    fullBytes?: Uint8Array;
    fullByteSize?: number | null;
    rangeMimeType?: string | null;
    fullMimeType?: string | null;
    headEtag?: string | null;
    rangeEtag?: string | null;
    rangeEtags?: Array<string | null>;
    fullEtag?: string | null;
  } = {},
): R2StorageAdapter & {
  ranges: Array<[number, number]>;
  fullGets: number;
  ifMatches: Array<string | undefined>;
} {
  const ranges: Array<[number, number]> = [];
  const ifMatches: Array<string | undefined> = [];
  const storage = {
    ranges,
    fullGets: 0,
    ifMatches,
    async createPresignedPut() {
      throw new Error("not used");
    },
    async headObject() {
      return {
        byteSize: options.headSize === undefined ? bytes.byteLength : options.headSize,
        contentType: mimeType,
        etag: options.headEtag === undefined ? '"etag-1"' : options.headEtag,
        lastModified: null,
      };
    },
    async getObjectRange(
      _objectKey: string,
      start: number,
      end: number,
      getOptions?: { ifMatch?: string },
    ) {
      ranges.push([start, end]);
      ifMatches.push(getOptions?.ifMatch);
      const responseBytes = bytes.slice(start, Math.min(end + 1, bytes.byteLength));
      return {
        bytes: responseBytes,
        contentType:
          options.rangeMimeType === undefined ? mimeType : options.rangeMimeType,
        etag:
          options.rangeEtags !== undefined &&
          ranges.length - 1 < options.rangeEtags.length
            ? options.rangeEtags[ranges.length - 1]
            : options.rangeEtag === undefined
              ? "etag-1"
              : options.rangeEtag,
        contentRange: {
          start,
          end: start + responseBytes.byteLength - 1,
          totalSize: options.rangeTotalSize ?? bytes.byteLength,
        },
      };
    },
    async getObject(
      _objectKey: string,
      _maxBytes: number,
      getOptions?: { ifMatch?: string },
    ) {
      storage.fullGets += 1;
      ifMatches.push(getOptions?.ifMatch);
      const fullBytes = options.fullBytes ?? bytes;
      return {
        bytes: fullBytes,
        contentType:
          options.fullMimeType === undefined ? mimeType : options.fullMimeType,
        etag: options.fullEtag === undefined ? '"etag-1"' : options.fullEtag,
        byteSize:
          options.fullByteSize === undefined
            ? fullBytes.byteLength
            : options.fullByteSize,
      };
    },
    async deleteObject() {},
  } satisfies R2StorageAdapter & {
    ranges: Array<[number, number]>;
    fullGets: number;
    ifMatches: Array<string | undefined>;
  };
  return storage;
}

async function verify(
  bytes: Uint8Array,
  mimeType: MemberAssetMimeType,
  storage = fakeStorage(bytes, mimeType),
) {
  return verifyStoredMemberAsset({
    storage,
    objectKey: "member-pages/page/image",
    claimedMimeType: mimeType,
    now: () => new Date("2026-08-25T12:00:00.000Z"),
  });
}

describe("member V2 stored-image verification", () => {
  it.each([
    ["image/jpeg", syntheticJpeg(), 320, 200],
    ["image/png", syntheticPng(), 320, 200],
    ["image/webp", syntheticWebP(), 320, 200],
    ["image/avif", syntheticAvif(), 320, 200],
  ] as const)("accepts a strict static %s fixture", async (mime, bytes, width, height) => {
    await expect(verify(bytes, mime)).resolves.toEqual({
      success: true,
      metadata: {
        mimeType: mime,
        byteSize: bytes.byteLength,
        width,
        height,
        etag: "etag-1",
        verifiedAt: new Date("2026-08-25T12:00:00.000Z"),
      },
    });
  });

  it.each([
    ["extended VP8", syntheticWebP(321, 203), 321, 203],
    ["simple VP8", syntheticWebP(322, 204, { extended: false }), 322, 204],
    [
      "extended VP8L",
      syntheticWebP(323, 205, { encoding: "vp8l" }),
      323,
      205,
    ],
    [
      "simple VP8L",
      syntheticWebP(324, 206, { encoding: "vp8l", extended: false }),
      324,
      206,
    ],
  ] as const)("reads exact %s dimensions", async (_label, bytes, width, height) => {
    await expect(verify(bytes, "image/webp")).resolves.toMatchObject({
      success: true,
      metadata: { width, height },
    });
  });

  it("rejects MIME/signature spoofing, SVG, and GIF", async () => {
    const spoofed = await verifyStoredMemberAsset({
      storage: fakeStorage(syntheticPng(), "image/jpeg"),
      objectKey: "member-pages/page/image",
      claimedMimeType: "image/jpeg",
    });
    expect(spoofed).toMatchObject({ success: false, reason: { code: "signature_mismatch" } });

    for (const unsupported of [syntheticSvg, syntheticGif]) {
      const result = await verifyStoredMemberAsset({
        storage: fakeStorage(unsupported, "image/png"),
        objectKey: "member-pages/page/image",
        claimedMimeType: "image/png",
      });
      expect(result).toMatchObject({ success: false, reason: { code: "unsupported_format" } });
    }
  });

  it("requires exact ranged/full response MIME headers", async () => {
    for (const rangeMimeType of [null, "image/jpeg", "IMAGE/PNG"]) {
      await expect(
        verify(
          syntheticPng(),
          "image/png",
          fakeStorage(syntheticPng(), "image/png", { rangeMimeType }),
        ),
      ).resolves.toMatchObject({
        success: false,
        reason: { code: "mime_mismatch" },
      });
    }

    const png = syntheticPng(10, 10, { paddingBytes: 1_100_000 });
    await expect(
      verify(
        png,
        "image/png",
        fakeStorage(png, "image/png", { fullMimeType: null }),
      ),
    ).resolves.toMatchObject({
      success: false,
      reason: { code: "mime_mismatch" },
    });
  });

  it("normalizes a strong ETag and rejects missing, weak, or malformed identity", async () => {
    const png = syntheticPng();
    await expect(
      verify(
        png,
        "image/png",
        fakeStorage(png, "image/png", {
          headEtag: '"normalized-etag"',
          rangeEtag: "normalized-etag",
        }),
      ),
    ).resolves.toMatchObject({
      success: true,
      metadata: { etag: "normalized-etag" },
    });

    for (const [headEtag, code] of [
      [null, "missing_etag"],
      ['W/"weak"', "invalid_etag"],
      ['"unterminated', "invalid_etag"],
    ] as const) {
      await expect(
        verify(png, "image/png", fakeStorage(png, "image/png", { headEtag })),
      ).resolves.toMatchObject({ success: false, reason: { code } });
    }
  });

  it("rejects oversized byte counts and dimensions before readiness", async () => {
    const oversizedStorage = fakeStorage(syntheticPng(), "image/png", {
      headSize: ASSET_MAX_BYTES + 1,
    });
    await expect(
      verifyStoredMemberAsset({
        storage: oversizedStorage,
        objectKey: "member-pages/page/image",
        claimedMimeType: "image/png",
      }),
    ).resolves.toMatchObject({ success: false, reason: { code: "too_large" } });
    expect(oversizedStorage.ranges).toHaveLength(0);

    for (const [mime, bytes] of [
      ["image/jpeg", syntheticJpeg(4_001, 10)],
      ["image/png", syntheticPng(4_001, 10)],
      ["image/webp", syntheticWebP(4_001, 10)],
      ["image/avif", syntheticAvif(4_001, 10)],
    ] as const) {
      await expect(verify(bytes, mime)).resolves.toMatchObject({
        success: false,
        reason: { code: "dimensions_too_large" },
      });
    }
  });

  it("rejects APNG, animated WebP, and sequence/track AVIF", async () => {
    for (const [mime, bytes] of [
      ["image/png", syntheticPng(10, 10, { animated: true })],
      ["image/webp", syntheticWebP(10, 10, { animated: true })],
      ["image/avif", syntheticAvif(10, 10, { sequenceBrand: true })],
      ["image/avif", syntheticAvif(10, 10, { trackBox: true })],
    ] as const) {
      await expect(verify(bytes, mime)).resolves.toMatchObject({
        success: false,
        reason: { code: "animated_image" },
      });
    }
  });

  it("rejects malformed, truncated, and uncertain static classification", async () => {
    await expect(
      verify(syntheticJpeg(10, 10, { truncate: true }), "image/jpeg"),
    ).resolves.toMatchObject({ success: false, reason: { code: "malformed_image" } });
    await expect(
      verify(syntheticPng().slice(0, -1), "image/png"),
    ).resolves.toMatchObject({ success: false });
    await expect(
      verify(syntheticAvif(10, 10, { itemReference: true }), "image/avif"),
    ).resolves.toMatchObject({
      success: false,
      reason: { code: "uncertain_animation" },
    });
  });

  it("rejects zero AVIF ispe dimensions in initial-range and full-fetch paths", async () => {
    const initialRange = syntheticAvif(0, 200);
    const initialStorage = fakeStorage(initialRange, "image/avif");
    await expect(
      verify(initialRange, "image/avif", initialStorage),
    ).resolves.toMatchObject({
      success: false,
      reason: { code: "malformed_image" },
    });
    expect(initialStorage.fullGets).toBe(0);

    const fullFetch = syntheticAvif(320, 0, { paddingBytes: 1_100_000 });
    const fullStorage = fakeStorage(fullFetch, "image/avif");
    await expect(verify(fullFetch, "image/avif", fullStorage)).resolves.toMatchObject({
      success: false,
      reason: { code: "malformed_image" },
    });
    expect(fullStorage.ranges.at(-1)).toEqual([0, 1_048_575]);
    expect(fullStorage.fullGets).toBe(1);
  }, 2_000);

  it("rejects AVIF major-brand mismatch before trusting compatible brands", async () => {
    const bytes = syntheticAvif(320, 200, {
      majorBrand: "mif1",
      compatibleBrands: ["avif", "mif1"],
    });
    await expect(verify(bytes, "image/avif")).resolves.toMatchObject({
      success: false,
      reason: { code: "malformed_image" },
    });
  });

  it("rejects ICNS, JXL, and malformed JPEG adversarial inputs without escalation", async () => {
    for (const bytes of [
      syntheticIcnsZeroEntry,
      syntheticJxlContainer,
      syntheticJxlCodestream,
    ]) {
      const storage = fakeStorage(bytes, "image/jpeg");
      await expect(verify(bytes, "image/jpeg", storage)).resolves.toMatchObject({
        success: false,
        reason: { code: "unsupported_format" },
      });
      expect(storage.ranges).toHaveLength(1);
      expect(storage.fullGets).toBe(0);
    }

    const malformedJpeg = syntheticMalformedJpegLargeZeros(4_000_000);
    const jpegStorage = fakeStorage(malformedJpeg, "image/jpeg");
    await expect(
      verify(malformedJpeg, "image/jpeg", jpegStorage),
    ).resolves.toMatchObject({
      success: false,
      reason: { code: "malformed_image" },
    });
    expect(jpegStorage.ranges).toHaveLength(1);
    expect(jpegStorage.fullGets).toBe(0);
  }, 2_000);

  it("returns exact dimensions after range escalation for every accepted format", async () => {
    for (const [mime, bytes, width, height] of [
      ["image/jpeg", syntheticJpeg(641, 481, { paddingBytes: 100_000 }), 641, 481],
      ["image/png", syntheticPng(642, 482, { paddingBytes: 100_000 }), 642, 482],
      ["image/webp", syntheticWebP(643, 483, { paddingBytes: 100_000 }), 643, 483],
      ["image/avif", syntheticAvif(644, 484, { paddingBytes: 300_000 }), 644, 484],
    ] as const) {
      const storage = fakeStorage(bytes, mime);
      await expect(verify(bytes, mime, storage)).resolves.toMatchObject({
        success: true,
        metadata: { width, height },
      });
      expect(storage.ranges.length).toBeGreaterThan(1);
      expect(storage.fullGets).toBe(0);
    }
  });

  it("returns exact dimensions through the bounded full-fetch fallback", async () => {
    for (const [mime, bytes, width, height] of [
      ["image/jpeg", syntheticJpeg(651, 491, { paddingBytes: 1_100_000 }), 651, 491],
      ["image/png", syntheticPng(652, 492, { paddingBytes: 1_100_000 }), 652, 492],
      ["image/webp", syntheticWebP(653, 493, { paddingBytes: 1_100_000 }), 653, 493],
      ["image/avif", syntheticAvif(654, 494, { paddingBytes: 1_100_000 }), 654, 494],
    ] as const) {
      const storage = fakeStorage(bytes, mime);
      await expect(verify(bytes, mime, storage)).resolves.toMatchObject({
        success: true,
        metadata: { width, height },
      });
      expect(storage.ranges.at(-1)).toEqual([0, 1_048_575]);
      expect(storage.fullGets).toBe(1);
      expect(storage.ifMatches.every((etag) => etag === "etag-1")).toBe(true);
    }
  });

  it("fails closed when ETag changes between HEAD, ranges, or full GET", async () => {
    const small = syntheticPng();
    await expect(
      verify(
        small,
        "image/png",
        fakeStorage(small, "image/png", { rangeEtag: "etag-2" }),
      ),
    ).resolves.toMatchObject({
      success: false,
      reason: { code: "identity_mismatch" },
    });

    const preconditionStorage = fakeStorage(small, "image/png");
    preconditionStorage.getObjectRange = async () => {
      throw { status: 412 };
    };
    await expect(
      verify(small, "image/png", preconditionStorage),
    ).resolves.toMatchObject({
      success: false,
      reason: { code: "identity_mismatch" },
    });

    const growing = syntheticJpeg(640, 480, { paddingBytes: 100_000 });
    await expect(
      verify(
        growing,
        "image/jpeg",
        fakeStorage(growing, "image/jpeg", {
          rangeEtags: ["etag-1", "etag-2"],
        }),
      ),
    ).resolves.toMatchObject({
      success: false,
      reason: { code: "identity_mismatch" },
    });

    const fullFallback = syntheticPng(10, 10, { paddingBytes: 1_100_000 });
    await expect(
      verify(
        fullFallback,
        "image/png",
        fakeStorage(fullFallback, "image/png", { fullEtag: "etag-2" }),
      ),
    ).resolves.toMatchObject({
      success: false,
      reason: { code: "identity_mismatch" },
    });
  });

  it("detects HEAD mismatches and lying sizes, including an oversized full body", async () => {
    const png = syntheticPng(10, 10, { paddingBytes: 1_100_000 });
    const immediateMismatch = fakeStorage(png, "image/png", {
      headSize: png.byteLength - 1,
    });
    await expect(
      verifyStoredMemberAsset({
        storage: immediateMismatch,
        objectKey: "member-pages/page/image",
        claimedMimeType: "image/png",
      }),
    ).resolves.toMatchObject({ success: false, reason: { code: "size_mismatch" } });

    const liedThroughRanges = fakeStorage(png, "image/png", {
      headSize: png.byteLength - 1,
      rangeTotalSize: png.byteLength - 1,
    });
    await expect(
      verifyStoredMemberAsset({
        storage: liedThroughRanges,
        objectKey: "member-pages/page/image",
        claimedMimeType: "image/png",
      }),
    ).resolves.toMatchObject({ success: false, reason: { code: "size_mismatch" } });
    expect(liedThroughRanges.fullGets).toBe(1);

    const overLimitBody = new Uint8Array(ASSET_MAX_BYTES + 1);
    overLimitBody.set(png.slice(0, Math.min(png.byteLength, overLimitBody.byteLength)));
    const oversizedFull = fakeStorage(png, "image/png", {
      rangeTotalSize: png.byteLength,
      fullBytes: overLimitBody,
      fullByteSize: ASSET_MAX_BYTES,
    });
    await expect(
      verifyStoredMemberAsset({
        storage: oversizedFull,
        objectKey: "member-pages/page/image",
        claimedMimeType: "image/png",
      }),
    ).resolves.toMatchObject({ success: false, reason: { code: "too_large" } });
  });
});
