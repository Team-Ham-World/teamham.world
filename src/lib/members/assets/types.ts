export const MEMBER_ASSET_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export type MemberAssetMimeType = (typeof MEMBER_ASSET_MIME_TYPES)[number];

const NORMALIZED_R2_ETAG_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:+/=-]{0,255}$/;

/** Returns a strong, unquoted ETag suitable for persistence and comparison. */
export function normalizeR2Etag(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "" || /^W\//i.test(trimmed)) return null;

  const startsQuoted = trimmed.startsWith('"');
  const endsQuoted = trimmed.endsWith('"');
  if (startsQuoted !== endsQuoted) return null;
  const normalized = startsQuoted ? trimmed.slice(1, -1) : trimmed;
  return NORMALIZED_R2_ETAG_PATTERN.test(normalized) ? normalized : null;
}

export function formatR2IfMatch(value: string): string | null {
  const normalized = normalizeR2Etag(value);
  return normalized === null ? null : `"${normalized}"`;
}

export interface R2PresignedPutInput {
  objectKey: string;
  contentType: MemberAssetMimeType;
  /** Exact Blob size bound through the signed Content-Length header. */
  byteSize: number;
  expiresInSeconds: number;
}

export interface R2PresignedPut {
  method: "PUT";
  url: string;
  /** Includes signed Content-Length; browsers derive it from the checked Blob. */
  headers: Headers;
  expiresAt: Date;
}

export interface R2HeadMetadata {
  byteSize: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

export interface R2ContentRange {
  start: number;
  end: number;
  totalSize: number;
}

export interface R2RangedObject {
  bytes: Uint8Array;
  contentType: string | null;
  etag: string | null;
  contentRange: R2ContentRange;
}

export interface R2FullObject {
  bytes: Uint8Array;
  contentType: string | null;
  etag: string | null;
  byteSize: number | null;
}

export interface R2ConditionalGetOptions {
  /** Strong ETag recorded for the verified object, without surrounding quotes. */
  ifMatch?: string;
}

export type R2DeleteOptions = R2ConditionalGetOptions;

/**
 * Private storage boundary. Object keys are accepted only as operation inputs;
 * no returned metadata/DTO shape exposes them.
 *
 * Serving routes must always use `If-Match` with the persisted verified ETag.
 * A precondition/object-identity mismatch must be treated as unavailable (404)
 * and scheduled for guarded cleanup. Conditional reads bind serving to the
 * verified object; they do not make upload URL replay impossible.
 */
export interface R2StorageAdapter {
  createPresignedPut(input: R2PresignedPutInput): Promise<R2PresignedPut>;
  headObject(objectKey: string): Promise<R2HeadMetadata>;
  getObjectRange(
    objectKey: string,
    start: number,
    endInclusive: number,
    options?: R2ConditionalGetOptions,
  ): Promise<R2RangedObject>;
  getObject(
    objectKey: string,
    maxBytes: number,
    options?: R2ConditionalGetOptions,
  ): Promise<R2FullObject>;
  deleteObject(objectKey: string, options?: R2DeleteOptions): Promise<void>;
}

export interface VerifiedMemberAssetMetadata {
  mimeType: MemberAssetMimeType;
  byteSize: number;
  width: number;
  height: number;
  /** Strong, normalized R2 object identity used for all later conditional reads. */
  etag: string;
  verifiedAt: Date;
}
