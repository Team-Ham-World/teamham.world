import type { MemberAssetMimeType } from "@/lib/members/assets/types";
import {
  ASSET_MAX_BYTES,
  ASSET_MAX_DIMENSION,
} from "@/lib/members/v2/limits";

export type NormalizedMemberImageMimeType = Extract<
  MemberAssetMimeType,
  "image/jpeg" | "image/png" | "image/webp"
>;

export interface NormalizedMemberImage {
  blob: Blob;
  mimeType: NormalizedMemberImageMimeType;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

export type MemberImageNormalizationErrorCode =
  | "unsupported_type"
  | "gif_not_supported"
  | "svg_not_supported"
  | "mime_mismatch"
  | "decode_failed"
  | "canvas_unavailable"
  | "encode_failed"
  | "normalized_too_large";

const NORMALIZATION_MESSAGES: Record<MemberImageNormalizationErrorCode, string> = {
  unsupported_type: "Choose a JPEG, PNG, WebP, or AVIF image.",
  gif_not_supported: "GIF images are not supported. Export a still JPEG, PNG, or WebP first.",
  svg_not_supported: "SVG images are not supported. Export a JPEG, PNG, or WebP first.",
  mime_mismatch: "The file contents do not match its image type. Export it again and retry.",
  decode_failed: "This image could not be opened by the browser. Try exporting it again.",
  canvas_unavailable: "This browser cannot safely prepare images for upload.",
  encode_failed: "This browser could not create a safe static copy of the image.",
  normalized_too_large:
    "The prepared image is still larger than 5 MB. Choose a simpler or smaller image.",
};

export class MemberImageNormalizationError extends Error {
  readonly code: MemberImageNormalizationErrorCode;

  constructor(code: MemberImageNormalizationErrorCode) {
    super(NORMALIZATION_MESSAGES[code]);
    this.name = "MemberImageNormalizationError";
    this.code = code;
  }
}

type SourceMimeType = MemberAssetMimeType | "image/gif" | "image/svg+xml";

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/**
 * Creates a new static canvas encoding, so source EXIF and other metadata never
 * cross the upload boundary. Browser decoding applies image orientation before
 * the image is drawn and dimensions are capped at 4000px on either side.
 */
export async function normalizeMemberImage(
  source: Blob,
): Promise<NormalizedMemberImage> {
  const detectedType = await detectSourceMimeType(source);
  validateClaimedMimeType(source.type, detectedType);

  const decoded = await decodeOrientedImage(source);
  try {
    if (
      !Number.isFinite(decoded.width) ||
      !Number.isFinite(decoded.height) ||
      decoded.width <= 0 ||
      decoded.height <= 0
    ) {
      throw new MemberImageNormalizationError("decode_failed");
    }

    const scale = Math.min(
      1,
      ASSET_MAX_DIMENSION / decoded.width,
      ASSET_MAX_DIMENSION / decoded.height,
    );
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new MemberImageNormalizationError("canvas_unavailable");
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    try {
      context.drawImage(decoded.source, 0, 0, width, height);
    } catch {
      throw new MemberImageNormalizationError("decode_failed");
    }

    let encoded: Blob;
    try {
      encoded = await encodeWithinLimit(canvas, detectedType);
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
    return {
      blob: encoded,
      mimeType: encoded.type as NormalizedMemberImageMimeType,
      width,
      height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
    };
  } finally {
    decoded.close();
  }
}

async function detectSourceMimeType(source: Blob): Promise<SourceMimeType> {
  const bytes = new Uint8Array(await source.slice(0, 512).arrayBuffer());
  if (isJpeg(bytes)) return "image/jpeg";
  if (isPng(bytes)) return "image/png";
  if (isGif(bytes)) {
    throw new MemberImageNormalizationError("gif_not_supported");
  }
  if (isWebP(bytes)) return "image/webp";
  if (isAvif(bytes)) return "image/avif";
  if (looksLikeSvg(bytes)) {
    throw new MemberImageNormalizationError("svg_not_supported");
  }
  if (source.type.toLowerCase() === "image/gif") {
    throw new MemberImageNormalizationError("gif_not_supported");
  }
  if (source.type.toLowerCase() === "image/svg+xml") {
    throw new MemberImageNormalizationError("svg_not_supported");
  }
  throw new MemberImageNormalizationError("unsupported_type");
}

function validateClaimedMimeType(claimed: string, detected: SourceMimeType): void {
  const normalizedClaim = claimed.trim().toLowerCase();
  if (normalizedClaim === "" || normalizedClaim === "application/octet-stream") {
    return;
  }
  if (normalizedClaim === "image/jpg") {
    if (detected === "image/jpeg") return;
    throw new MemberImageNormalizationError("mime_mismatch");
  }
  if (normalizedClaim !== detected) {
    throw new MemberImageNormalizationError("mime_mismatch");
  }
}

async function decodeOrientedImage(source: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(source, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // The element fallback covers browsers whose bitmap decoder does not
      // support the format or the orientation option.
    }
  }

  if (
    typeof document === "undefined" ||
    typeof Image === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    throw new MemberImageNormalizationError("decode_failed");
  }

  const url = URL.createObjectURL(source);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new MemberImageNormalizationError("decode_failed");
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    if (error instanceof MemberImageNormalizationError) throw error;
    throw new MemberImageNormalizationError("decode_failed");
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new MemberImageNormalizationError("canvas_unavailable");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function encodeWithinLimit(
  canvas: HTMLCanvasElement,
  sourceType: SourceMimeType,
): Promise<Blob> {
  const attempts = encodingPlan(sourceType);
  let producedBlob = false;
  let producedOversizedBlob = false;

  for (const [mimeType, quality] of attempts) {
    const blob = await canvasToBlob(canvas, mimeType, quality);
    if (!blob || blob.size <= 0 || !isNormalizedMimeType(blob.type)) continue;
    producedBlob = true;
    if (blob.size <= ASSET_MAX_BYTES) return blob;
    producedOversizedBlob = true;
  }

  throw new MemberImageNormalizationError(
    producedBlob && producedOversizedBlob
      ? "normalized_too_large"
      : "encode_failed",
  );
}

function encodingPlan(
  sourceType: SourceMimeType,
): ReadonlyArray<readonly [NormalizedMemberImageMimeType, number | undefined]> {
  const jpeg = [
    ["image/jpeg", 0.9],
    ["image/jpeg", 0.8],
    ["image/jpeg", 0.68],
    ["image/jpeg", 0.55],
  ] as const;
  const webp = [
    ["image/webp", 0.9],
    ["image/webp", 0.8],
    ["image/webp", 0.68],
    ["image/webp", 0.55],
  ] as const;

  if (sourceType === "image/jpeg") return [...jpeg, ...webp];
  if (sourceType === "image/png") {
    return [["image/png", undefined], ...webp, ...jpeg];
  }
  return [...webp, ["image/png", undefined], ...jpeg];
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: NormalizedMemberImageMimeType,
  quality: number | undefined,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, mimeType, quality);
    } catch {
      resolve(null);
    }
  });
}

function isNormalizedMimeType(value: string): value is NormalizedMemberImageMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((value, index) => bytes[index] === value);
}

function isGif(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
}

function isWebP(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

function isAvif(bytes: Uint8Array): boolean {
  if (ascii(bytes, 4, 4) !== "ftyp") return false;
  for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
    const brand = ascii(bytes, offset, 4);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes)
    .replace(/^\uFEFF/u, "")
    .trimStart()
    .toLowerCase();
  return text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"));
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
