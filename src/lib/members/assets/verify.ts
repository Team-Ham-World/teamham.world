import "server-only";

import {
  inspectAvifStatic,
  inspectPngStatic,
  inspectWebPStatic,
  type StaticImageClassification,
  type StaticImageDimensions,
  type StaticImageInspection,
} from "@/lib/members/assets/animation";
import { isMemberAssetMimeType } from "@/lib/members/assets/config";
import { inspectJpegHeader } from "@/lib/members/assets/dimensions";
import type {
  MemberAssetMimeType,
  R2StorageAdapter,
  VerifiedMemberAssetMetadata,
} from "@/lib/members/assets/types";
import { normalizeR2Etag } from "@/lib/members/assets/types";
import { ASSET_MAX_BYTES, ASSET_MAX_DIMENSION } from "@/lib/members/v2/limits";

export const MEMBER_ASSET_INITIAL_RANGE_BYTES: Readonly<
  Record<MemberAssetMimeType, number>
> = {
  "image/jpeg": 65_536,
  "image/png": 65_536,
  "image/webp": 65_536,
  "image/avif": 262_144,
};

export const MEMBER_ASSET_MAX_HEADER_RANGE_BYTES = 1_048_576;

export type MemberAssetVerificationReasonCode =
  | "storage_error"
  | "missing_size"
  | "invalid_size"
  | "too_large"
  | "missing_stored_mime"
  | "missing_etag"
  | "invalid_etag"
  | "identity_mismatch"
  | "unsupported_mime"
  | "mime_mismatch"
  | "unsupported_format"
  | "signature_mismatch"
  | "size_mismatch"
  | "malformed_image"
  | "animated_image"
  | "uncertain_animation"
  | "invalid_dimensions"
  | "dimensions_too_large";

export interface MemberAssetVerificationReason {
  code: MemberAssetVerificationReasonCode;
  message: string;
}

export type MemberAssetVerificationResult =
  | { success: true; metadata: VerifiedMemberAssetMetadata }
  | { success: false; reason: MemberAssetVerificationReason };

export interface VerifyStoredMemberAssetInput {
  storage: R2StorageAdapter;
  objectKey: string;
  claimedMimeType: string;
  now?: () => Date;
}

type DetectedFormat = "jpeg" | "png" | "webp" | "avif";

const EXPECTED_FORMAT: Readonly<Record<MemberAssetMimeType, DetectedFormat>> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const FORMAT_MIME: Readonly<Record<DetectedFormat, MemberAssetMimeType>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

function failure(
  code: MemberAssetVerificationReasonCode,
  message: string,
): MemberAssetVerificationResult {
  return { success: false, reason: { code, message } };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return (
    bytes.byteLength >= signature.length &&
    signature.every((byte, index) => bytes[index] === byte)
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let offset = start; offset < end; offset += 1) {
    value += String.fromCharCode(bytes[offset]);
  }
  return value;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1_000_000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function detectFormat(bytes: Uint8Array): DetectedFormat | null {
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "jpeg";
  }
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "png";
  if (
    bytes.byteLength >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (bytes.byteLength >= 16 && ascii(bytes, 4, 8) === "ftyp") {
    const ftypSize = readUint32BE(bytes, 0);
    if (
      ftypSize >= 16 &&
      ftypSize <= bytes.byteLength &&
      (ftypSize - 16) % 4 === 0 &&
      (ftypSize - 16) / 4 <= 64
    ) {
      for (let offset = 8; offset < ftypSize; offset += offset === 8 ? 8 : 4) {
        const brand = ascii(bytes, offset, offset + 4);
        if (brand === "avif" || brand === "avis") return "avif";
      }
    }
  }
  return null;
}

function looksExplicitlyUnsupported(bytes: Uint8Array): boolean {
  if (
    startsWith(bytes, [71, 73, 70, 56, 55, 97]) ||
    startsWith(bytes, [71, 73, 70, 56, 57, 97])
  ) {
    return true;
  }
  if (
    startsWith(bytes, [0x69, 0x63, 0x6e, 0x73]) ||
    startsWith(bytes, [0xff, 0x0a]) ||
    startsWith(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20])
  ) {
    return true;
  }
  const prefix = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.byteLength, 512)))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  return prefix.startsWith("<svg") || prefix.startsWith("<?xml");
}

function classifyJpegComplete(bytes: Uint8Array): StaticImageClassification {
  if (bytes.byteLength > ASSET_MAX_BYTES) {
    return { kind: "uncertain", reason: "parser_limit" };
  }
  if (!startsWith(bytes, [0xff, 0xd8])) {
    return { kind: "uncertain", reason: "invalid_signature" };
  }
  let offset = 2;
  let entries = 0;
  let sawFrame = false;
  let sawScan = false;
  let inScan = false;

  while (offset < bytes.byteLength) {
    entries += 1;
    if (entries > 65_536) return { kind: "uncertain", reason: "parser_limit" };

    if (inScan) {
      while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
      if (offset >= bytes.byteLength) {
        return { kind: "uncertain", reason: "truncated" };
      }
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.byteLength) {
        return { kind: "uncertain", reason: "truncated" };
      }
      const scanMarker = bytes[offset];
      if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
        offset += 1;
        continue;
      }
      offset -= 1;
      inScan = false;
    }

    if (bytes[offset] !== 0xff) {
      return { kind: "uncertain", reason: "malformed" };
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) {
      return { kind: "uncertain", reason: "truncated" };
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) {
      return sawFrame && sawScan && offset === bytes.byteLength
        ? { kind: "static" }
        : { kind: "uncertain", reason: "malformed" };
    }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01) {
      return { kind: "uncertain", reason: "malformed" };
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      return { kind: "uncertain", reason: "malformed" };
    }
    if (offset + 2 > bytes.byteLength) {
      return { kind: "uncertain", reason: "truncated" };
    }
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) {
      return {
        kind: "uncertain",
        reason: offset + length > bytes.byteLength ? "truncated" : "malformed",
      };
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (sawFrame) return { kind: "uncertain", reason: "malformed" };
      sawFrame = true;
    }
    if (marker === 0xda) {
      sawScan = true;
      offset += length;
      inScan = true;
      continue;
    }
    offset += length;
  }
  return { kind: "uncertain", reason: "truncated" };
}

function inspectCompleteImage(
  format: DetectedFormat,
  bytes: Uint8Array,
): StaticImageInspection {
  if (format === "png") return inspectPngStatic(bytes);
  if (format === "webp") return inspectWebPStatic(bytes);
  if (format === "avif") return inspectAvifStatic(bytes);

  const classification = classifyJpegComplete(bytes);
  if (classification.kind !== "static") return classification;
  const header = inspectJpegHeader(bytes, bytes.byteLength);
  if (header.kind === "dimensions") {
    return { kind: "static", dimensions: header.dimensions };
  }
  return {
    kind: "uncertain",
    reason:
      header.kind === "need_more"
        ? "truncated"
        : header.reason === "invalid_signature"
          ? "invalid_signature"
          : header.reason,
  };
}

function validateDimensions(
  dimensions: StaticImageDimensions,
): MemberAssetVerificationResult | null {
  if (
    dimensions.width > ASSET_MAX_DIMENSION ||
    dimensions.height > ASSET_MAX_DIMENSION
  ) {
    return failure(
      "dimensions_too_large",
      "The image dimensions exceed the member asset limit.",
    );
  }
  return null;
}

function validateClassification(
  classification: StaticImageClassification,
): MemberAssetVerificationResult | null {
  if (classification.kind === "animated") {
    return failure("animated_image", "Animated member images are not allowed.");
  }
  if (classification.kind === "uncertain") {
    return failure(
      classification.reason === "unsupported_structure"
        ? "uncertain_animation"
        : "malformed_image",
      "The image could not be confidently classified as a static image.",
    );
  }
  return null;
}

function normalizeStoredMime(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

function responseMimeMatches(
  value: string | null,
  expected: MemberAssetMimeType,
): boolean {
  return value === expected;
}

function validateObservedEtag(
  value: string | null,
  expected: string,
): MemberAssetVerificationResult | null {
  if (value === null) {
    return failure("missing_etag", "The stored image identity is missing.");
  }
  const normalized = normalizeR2Etag(value);
  if (normalized === null) {
    return failure("invalid_etag", "The stored image identity is invalid.");
  }
  if (normalized !== expected) {
    return failure(
      "identity_mismatch",
      "The stored image identity changed during verification.",
    );
  }
  return null;
}

function storageReadFailure(error: unknown): MemberAssetVerificationResult {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 412
  ) {
    return failure(
      "identity_mismatch",
      "The stored image identity changed during verification.",
    );
  }
  return failure("storage_error", "The stored image bytes could not be read.");
}

export async function verifyStoredMemberAsset(
  input: VerifyStoredMemberAssetInput,
): Promise<MemberAssetVerificationResult> {
  let head;
  try {
    head = await input.storage.headObject(input.objectKey);
  } catch {
    return failure("storage_error", "The stored image metadata could not be read.");
  }

  if (head.byteSize === null) {
    return failure("missing_size", "The stored image size is missing.");
  }
  if (!Number.isSafeInteger(head.byteSize) || head.byteSize <= 0) {
    return failure("invalid_size", "The stored image size is invalid.");
  }
  if (head.byteSize > ASSET_MAX_BYTES) {
    return failure("too_large", "The stored image exceeds the member asset limit.");
  }

  if (head.etag === null) {
    return failure("missing_etag", "The stored image identity is missing.");
  }
  const headEtag = normalizeR2Etag(head.etag);
  if (headEtag === null) {
    return failure("invalid_etag", "The stored image identity is invalid.");
  }

  const storedMime = normalizeStoredMime(head.contentType);
  if (storedMime === null) {
    return failure("missing_stored_mime", "The stored image MIME type is missing.");
  }
  if (!isMemberAssetMimeType(storedMime)) {
    return failure("unsupported_mime", "The stored image MIME type is unsupported.");
  }
  if (!isMemberAssetMimeType(input.claimedMimeType)) {
    return failure("unsupported_mime", "The claimed image MIME type is unsupported.");
  }
  if (storedMime !== input.claimedMimeType) {
    return failure("mime_mismatch", "The stored and claimed MIME types do not match.");
  }

  const expectedFormat = EXPECTED_FORMAT[storedMime];
  let rangeSize = Math.min(
    head.byteSize,
    MEMBER_ASSET_INITIAL_RANGE_BYTES[storedMime],
  );
  let lastBytes: Uint8Array | null = null;

  while (true) {
    let ranged;
    try {
      ranged = await input.storage.getObjectRange(
        input.objectKey,
        0,
        rangeSize - 1,
        { ifMatch: headEtag },
      );
    } catch (error) {
      return storageReadFailure(error);
    }
    if (ranged.contentRange.totalSize !== head.byteSize) {
      return failure(
        ranged.contentRange.totalSize > ASSET_MAX_BYTES
          ? "too_large"
          : "size_mismatch",
        "The stored image size changed during verification.",
      );
    }
    if (!responseMimeMatches(ranged.contentType, storedMime)) {
      return failure("mime_mismatch", "The stored image MIME metadata is inconsistent.");
    }
    const rangeIdentityFailure = validateObservedEtag(ranged.etag, headEtag);
    if (rangeIdentityFailure) return rangeIdentityFailure;

    lastBytes = ranged.bytes;
    const detected = detectFormat(lastBytes);
    if (detected === null) {
      return failure(
        looksExplicitlyUnsupported(lastBytes)
          ? "unsupported_format"
          : "signature_mismatch",
        "The image signature does not match an accepted static image format.",
      );
    }
    if (detected !== expectedFormat || FORMAT_MIME[detected] !== storedMime) {
      return failure(
        "signature_mismatch",
        "The image signature does not match its MIME type.",
      );
    }

    const complete = lastBytes.byteLength === head.byteSize;
    if (!complete && detected === "jpeg") {
      const header = inspectJpegHeader(lastBytes, head.byteSize);
      if (header.kind === "invalid") {
        return failure(
          "malformed_image",
          "The image could not be confidently classified as a static image.",
        );
      }
    }
    if (complete) {
      const inspection = inspectCompleteImage(detected, lastBytes);
      const invalidClassification = validateClassification(inspection);
      if (invalidClassification) return invalidClassification;
      if (inspection.kind !== "static") {
        return failure("invalid_dimensions", "The image dimensions are invalid.");
      }
      const invalidDimensions = validateDimensions(inspection.dimensions);
      if (invalidDimensions) return invalidDimensions;
      return {
        success: true,
        metadata: {
          mimeType: storedMime,
          byteSize: head.byteSize,
          width: inspection.dimensions.width,
          height: inspection.dimensions.height,
          etag: headEtag,
          verifiedAt: input.now?.() ?? new Date(),
        },
      };
    }

    if (rangeSize >= head.byteSize || rangeSize >= MEMBER_ASSET_MAX_HEADER_RANGE_BYTES) {
      break;
    }
    rangeSize = Math.min(
      head.byteSize,
      MEMBER_ASSET_MAX_HEADER_RANGE_BYTES,
      rangeSize * 2,
    );
  }

  let full;
  try {
    full = await input.storage.getObject(input.objectKey, ASSET_MAX_BYTES, {
      ifMatch: headEtag,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 412
    ) {
      return failure(
        "identity_mismatch",
        "The stored image identity changed during verification.",
      );
    }
    return failure(
      error instanceof Error && error.name === "R2ResponseTooLargeError"
        ? "too_large"
        : "storage_error",
      "The complete stored image could not be read safely.",
    );
  }
  if (full.bytes.byteLength > ASSET_MAX_BYTES) {
    return failure("too_large", "The stored image exceeds the member asset limit.");
  }
  if (
    full.bytes.byteLength !== head.byteSize ||
    (full.byteSize !== null && full.byteSize !== full.bytes.byteLength)
  ) {
    return failure("size_mismatch", "The stored image size changed during verification.");
  }
  if (!responseMimeMatches(full.contentType, storedMime)) {
    return failure("mime_mismatch", "The stored image MIME metadata is inconsistent.");
  }
  const fullIdentityFailure = validateObservedEtag(full.etag, headEtag);
  if (fullIdentityFailure) return fullIdentityFailure;

  const detected = detectFormat(full.bytes);
  if (detected === null) {
    return failure(
      looksExplicitlyUnsupported(full.bytes)
        ? "unsupported_format"
        : "signature_mismatch",
      "The image signature does not match an accepted static image format.",
    );
  }
  if (detected !== expectedFormat || FORMAT_MIME[detected] !== storedMime) {
    return failure("signature_mismatch", "The image signature does not match its MIME type.");
  }
  const inspection = inspectCompleteImage(detected, full.bytes);
  const invalidClassification = validateClassification(inspection);
  if (invalidClassification) return invalidClassification;
  if (inspection.kind !== "static") {
    return failure("invalid_dimensions", "The image dimensions are invalid.");
  }
  const invalidDimensions = validateDimensions(inspection.dimensions);
  if (invalidDimensions) return invalidDimensions;

  return {
    success: true,
    metadata: {
      mimeType: storedMime,
      byteSize: full.bytes.byteLength,
      width: inspection.dimensions.width,
      height: inspection.dimensions.height,
      etag: headEtag,
      verifiedAt: input.now?.() ?? new Date(),
    },
  };
}

export const verifyStoredMemberImage = verifyStoredMemberAsset;
