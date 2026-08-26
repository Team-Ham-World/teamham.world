import {
  MEMBER_ASSET_MIME_TYPES,
  type MemberAssetMimeType,
} from "@/lib/members/assets/types";
import {
  ASSET_MAX_BYTES,
  ASSET_MAX_DIMENSION,
} from "@/lib/members/v2/limits";

export interface PendingEditorAsset {
  assetId: string;
  status: "pending";
  mimeType: null;
  width: null;
  height: null;
  createdAt: string | null;
  readyAt: null;
  verifiedAt: null;
  pendingExpiresAt: string | null;
}

export interface ReadyEditorAsset {
  assetId: string;
  status: "ready";
  mimeType: MemberAssetMimeType;
  width: number;
  height: number;
  createdAt: string | null;
  readyAt: string | null;
  verifiedAt: string | null;
  pendingExpiresAt: string | null;
}

export type EditorAsset = PendingEditorAsset | ReadyEditorAsset;

export interface MemberAssetAllocation {
  assetId: string;
  uploadUrl: string;
  requiredContentType: MemberAssetMimeType;
  requiredByteSize: number;
  expiresAt: string;
}

export interface FinalizedEditorAsset {
  assetId: string;
  status: "ready";
  mimeType: MemberAssetMimeType;
  width: number;
  height: number;
  readyAt: string;
  verifiedAt: string;
}

export type MemberAssetApiErrorCode =
  | "invalid_request"
  | "invalid_request_origin"
  | "pending_upload_limit"
  | "upload_rate_limit"
  | "finalize_rate_limit"
  | "not_found"
  | "service_unavailable"
  | "invalid_asset"
  | "asset_quota"
  | "asset_conflict"
  | "asset_referenced"
  | "direct_upload_failed"
  | "invalid_response";

const ERROR_MESSAGES: Record<MemberAssetApiErrorCode, string> = {
  invalid_request: "That image request was not valid. Refresh the library and try again.",
  invalid_request_origin: "This upload could not be verified. Reload the editor and try again.",
  pending_upload_limit:
    "Several images are still being prepared. Wait a moment, refresh the library, then try again.",
  upload_rate_limit:
    "Uploads are moving too quickly right now. Wait a little while before trying again.",
  finalize_rate_limit:
    "Image checks are moving too quickly right now. Wait a few minutes before trying again.",
  not_found:
    "This image is no longer available to this editor. Refresh the library to see the latest state.",
  service_unavailable:
    "The image service is temporarily unavailable. Your page is unchanged; try again shortly.",
  invalid_asset:
    "The stored image could not be verified. Choose the original file and upload it again.",
  asset_quota:
    "This page already has 20 ready images. Delete an unused image before uploading another.",
  asset_conflict:
    "The image changed while this request was running. Refresh the library before trying again.",
  asset_referenced:
    "This image is still used by the saved draft or live page. The server checks both versions: remove every use, let the draft save, and publish or unpublish that change as needed before trying again.",
  direct_upload_failed:
    "The image could not reach storage. Check your connection and retry the upload.",
  invalid_response:
    "The image service returned an unexpected response. Refresh the editor before trying again.",
};

export class MemberAssetApiError extends Error {
  readonly code: MemberAssetApiErrorCode;
  readonly status: number | null;

  constructor(code: MemberAssetApiErrorCode, status: number | null = null) {
    super(ERROR_MESSAGES[code]);
    this.name = "MemberAssetApiError";
    this.code = code;
    this.status = status;
  }
}

type FetchLike = typeof fetch;

export async function listMemberPageAssets(
  slug: string,
  fetchImpl: FetchLike = fetch,
): Promise<EditorAsset[]> {
  const response = await fetchRoute(
    fetchImpl,
    `/api/member-page-assets?slug=${encodeURIComponent(slug)}`,
    {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) await throwRouteError(response);

  const body = await readJson(response);
  if (!isExactObject(body, ["assets"]) || !Array.isArray(body.assets)) {
    throw new MemberAssetApiError("invalid_response", response.status);
  }
  const assets = body.assets.map(parseEditorAsset);
  if (assets.some((asset) => asset === null)) {
    throw new MemberAssetApiError("invalid_response", response.status);
  }
  return assets as EditorAsset[];
}

export async function allocateMemberPageAsset(
  input: { slug: string; mimeType: MemberAssetMimeType; byteSize: number },
  fetchImpl: FetchLike = fetch,
): Promise<MemberAssetAllocation> {
  if (
    !Number.isInteger(input.byteSize) ||
    input.byteSize <= 0 ||
    input.byteSize > ASSET_MAX_BYTES
  ) {
    throw new MemberAssetApiError("invalid_request");
  }
  const response = await fetchRoute(
    fetchImpl,
    "/api/member-page-assets/uploads",
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) await throwRouteError(response);

  const body = await readJson(response);
  if (
    !isExactObject(body, [
      "assetId",
      "uploadUrl",
      "requiredContentType",
      "requiredByteSize",
      "expiresAt",
    ]) ||
    !isAssetId(body.assetId) ||
    typeof body.uploadUrl !== "string" ||
    !isSafeUploadUrl(body.uploadUrl) ||
    !isMemberAssetMimeType(body.requiredContentType) ||
    body.requiredContentType !== input.mimeType ||
    body.requiredByteSize !== input.byteSize ||
    !isTimestamp(body.expiresAt)
  ) {
    throw new MemberAssetApiError("invalid_response", response.status);
  }
  return {
    assetId: body.assetId,
    uploadUrl: body.uploadUrl,
    requiredContentType: body.requiredContentType,
    requiredByteSize: body.requiredByteSize,
    expiresAt: body.expiresAt,
  };
}

/** Uploads only with the exact MIME and byte size bound into the signed request. */
export async function putMemberPageAsset(
  allocation: MemberAssetAllocation,
  blob: Blob,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (
    blob.type !== allocation.requiredContentType ||
    blob.size !== allocation.requiredByteSize
  ) {
    throw new MemberAssetApiError("invalid_request");
  }

  let response: Response;
  try {
    response = await fetchImpl(allocation.uploadUrl, {
      method: "PUT",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      // Content-Length is a forbidden browser request header. The signed value
      // is emitted by fetch from this fixed-size Blob after the exact-size check.
      headers: { "Content-Type": allocation.requiredContentType },
      body: blob,
    });
  } catch {
    throw new MemberAssetApiError("direct_upload_failed");
  }
  if (!response.ok) {
    // Storage response bodies are intentionally ignored. They are not editor
    // DTOs and may contain private implementation detail.
    throw new MemberAssetApiError("direct_upload_failed", response.status);
  }
}

export async function finalizeMemberPageAsset(
  slug: string,
  assetId: string,
  fetchImpl: FetchLike = fetch,
): Promise<FinalizedEditorAsset> {
  const response = await fetchRoute(
    fetchImpl,
    `/api/member-page-assets/${encodeURIComponent(assetId)}/finalize`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug }),
    },
  );
  if (!response.ok) await throwRouteError(response);

  const body = await readJson(response);
  if (
    !isExactObject(body, [
      "assetId",
      "status",
      "mimeType",
      "width",
      "height",
      "readyAt",
      "verifiedAt",
    ]) ||
    !isAssetId(body.assetId) ||
    body.assetId !== assetId ||
    body.status !== "ready" ||
    !isMemberAssetMimeType(body.mimeType) ||
    !isDimension(body.width) ||
    !isDimension(body.height) ||
    !isTimestamp(body.readyAt) ||
    !isTimestamp(body.verifiedAt)
  ) {
    throw new MemberAssetApiError("invalid_response", response.status);
  }
  return {
    assetId: body.assetId,
    status: "ready",
    mimeType: body.mimeType,
    width: body.width,
    height: body.height,
    readyAt: body.readyAt,
    verifiedAt: body.verifiedAt,
  };
}

export async function deleteMemberPageAsset(
  slug: string,
  assetId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const response = await fetchRoute(
    fetchImpl,
    `/api/member-page-assets/${encodeURIComponent(assetId)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug }),
    },
  );
  if (!response.ok) await throwRouteError(response);
  if (response.status !== 204) {
    throw new MemberAssetApiError("invalid_response", response.status);
  }
}

export async function uploadNormalizedMemberPageAsset(
  input: { slug: string; blob: Blob; mimeType: MemberAssetMimeType },
  options: {
    fetchImpl?: FetchLike;
    onAllocated?: (allocation: MemberAssetAllocation) => void;
  } = {},
): Promise<FinalizedEditorAsset> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const allocation = await allocateMemberPageAsset(
    {
      slug: input.slug,
      mimeType: input.mimeType,
      byteSize: input.blob.size,
    },
    fetchImpl,
  );
  options.onAllocated?.(allocation);
  await putMemberPageAsset(allocation, input.blob, fetchImpl);
  return finalizeMemberPageAsset(input.slug, allocation.assetId, fetchImpl);
}

async function throwRouteError(response: Response): Promise<never> {
  const body = await readJson(response);
  const code =
    isExactObject(body, ["error"]) && typeof body.error === "string"
      ? body.error
      : "invalid_response";
  if (isMemberAssetApiErrorCode(code)) {
    throw new MemberAssetApiError(code, response.status);
  }
  throw new MemberAssetApiError("invalid_response", response.status);
}

async function fetchRoute(
  fetchImpl: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch {
    throw new MemberAssetApiError("service_unavailable");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseEditorAsset(value: unknown): EditorAsset | null {
  if (
    !isExactObject(value, [
      "assetId",
      "status",
      "mimeType",
      "width",
      "height",
      "createdAt",
      "readyAt",
      "verifiedAt",
      "pendingExpiresAt",
    ]) ||
    !isAssetId(value.assetId) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.pendingExpiresAt)
  ) {
    return null;
  }

  if (value.status === "pending") {
    if (
      value.mimeType !== null ||
      value.width !== null ||
      value.height !== null ||
      value.readyAt !== null ||
      value.verifiedAt !== null
    ) {
      return null;
    }
    return value as unknown as PendingEditorAsset;
  }

  if (
    value.status !== "ready" ||
    !isMemberAssetMimeType(value.mimeType) ||
    !isDimension(value.width) ||
    !isDimension(value.height) ||
    !isTimestamp(value.readyAt) ||
    !isTimestamp(value.verifiedAt)
  ) {
    return null;
  }
  return value as unknown as ReadyEditorAsset;
}

function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isMemberAssetMimeType(value: unknown): value is MemberAssetMimeType {
  return (
    typeof value === "string" &&
    MEMBER_ASSET_MIME_TYPES.includes(value as MemberAssetMimeType)
  );
}

function isMemberAssetApiErrorCode(
  value: string,
): value is MemberAssetApiErrorCode {
  return Object.hasOwn(ERROR_MESSAGES, value);
}

function isAssetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= ASSET_MAX_DIMENSION
  );
}

function isSafeUploadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hostname !== ""
    );
  } catch {
    return false;
  }
}
