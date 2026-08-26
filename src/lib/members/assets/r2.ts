import "server-only";

import { AwsClient } from "aws4fetch";

import {
  buildPrivateR2ObjectUrl,
  isValidR2ObjectKey,
  type MemberPageR2Config,
} from "@/lib/members/assets/config";
import type {
  R2ConditionalGetOptions,
  R2DeleteOptions,
  R2FullObject,
  R2HeadMetadata,
  R2PresignedPut,
  R2PresignedPutInput,
  R2RangedObject,
  R2StorageAdapter,
} from "@/lib/members/assets/types";
import {
  formatR2IfMatch,
  normalizeR2Etag,
} from "@/lib/members/assets/types";
import { ASSET_MAX_BYTES } from "@/lib/members/v2/limits";

export const R2_DEFAULT_PRESIGN_EXPIRY_SECONDS = 300;
export const R2_MAX_PRESIGN_EXPIRY_SECONDS = 900;

type AwsSignInit = RequestInit & {
  aws?: {
    service?: string;
    region?: string;
    datetime?: string;
    signQuery?: boolean;
    allHeaders?: boolean;
  };
};

export interface AwsClientLike {
  sign(
    input: Request | { toString(): string },
    init?: AwsSignInit | null,
  ): Promise<Request>;
}

export type R2Fetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface R2AdapterDependencies {
  awsClient?: AwsClientLike;
  fetch?: R2Fetch;
  now?: () => Date;
}

export type R2Operation = "presign" | "head" | "range" | "get" | "delete";

export class R2StorageError extends Error {
  readonly operation: R2Operation;
  readonly status: number | null;

  constructor(operation: R2Operation, status: number | null = null) {
    super(
      status === null
        ? `R2 ${operation} operation failed.`
        : `R2 ${operation} operation failed with status ${status}.`,
    );
    this.name = "R2StorageError";
    this.operation = operation;
    this.status = status;
  }
}

export class R2ResponseTooLargeError extends R2StorageError {
  constructor(operation: "range" | "get") {
    super(operation);
    this.name = "R2ResponseTooLargeError";
  }
}

function formatAwsDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function requireValidObjectKey(objectKey: string): void {
  if (!isValidR2ObjectKey(objectKey)) throw new R2StorageError("presign");
}

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseContentRange(value: string | null): {
  start: number;
  end: number;
  totalSize: number;
} | null {
  if (value === null) return null;
  const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const totalSize = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(totalSize) ||
    start < 0 ||
    end < start ||
    totalSize <= end
  ) {
    return null;
  }
  return { start, end, totalSize };
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already being discarded; cancellation failure is inert.
  }
}

async function readBodyBounded(
  response: Response,
  maxBytes: number,
  operation: "range" | "get",
): Promise<Uint8Array> {
  const rawLength = response.headers.get("content-length");
  const declaredLength = parseNonNegativeInteger(rawLength);
  if (rawLength !== null && declaredLength === null) {
    await discardBody(response);
    throw new R2StorageError(operation);
  }
  if (declaredLength !== null && declaredLength > maxBytes) {
    await discardBody(response);
    throw new R2ResponseTooLargeError(operation);
  }
  if (!response.body) throw new R2StorageError(operation);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new R2ResponseTooLargeError(operation);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof R2StorageError) throw error;
    try {
      await reader.cancel();
    } catch {
      // Preserve the sanitized storage failure below.
    }
    throw new R2StorageError(operation);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validateSignedRequest(
  request: Request,
  expectedUrl: string,
  method: string,
  operation: R2Operation,
  requireRedirectError = true,
): void {
  const actual = new URL(request.url);
  const expected = new URL(expectedUrl);
  if (
    request.method !== method ||
    actual.origin !== expected.origin ||
    actual.pathname !== expected.pathname ||
    (operation !== "presign" && actual.search !== expected.search) ||
    (requireRedirectError && request.redirect !== "error")
  ) {
    throw new R2StorageError(operation);
  }
}

function conditionalGetHeaders(
  operation: "range" | "get",
  base: HeadersInit | undefined,
  options: R2ConditionalGetOptions | undefined,
): Headers {
  const headers = new Headers(base);
  if (options?.ifMatch !== undefined) {
    const ifMatch = formatR2IfMatch(options.ifMatch);
    if (ifMatch === null) throw new R2StorageError(operation);
    headers.set("if-match", ifMatch);
  }
  return headers;
}

function responseEtag(
  response: Response,
  operation: "head" | "range" | "get",
): string | null {
  const rawEtag = response.headers.get("etag");
  if (rawEtag === null) return null;
  const normalized = normalizeR2Etag(rawEtag);
  if (normalized === null) throw new R2StorageError(operation);
  return normalized;
}

export function createR2StorageAdapter(
  config: MemberPageR2Config,
  dependencies: R2AdapterDependencies = {},
): R2StorageAdapter {
  const awsClient =
    dependencies.awsClient ??
    new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: config.region,
      retries: 0,
    });
  const fetchImpl = dependencies.fetch ?? ((input, init) => fetch(input, init));
  const now = dependencies.now ?? (() => new Date());

  async function signedFetch(
    objectKey: string,
    method: "HEAD" | "GET" | "DELETE",
    operation: "head" | "range" | "get" | "delete",
    headers?: HeadersInit,
  ): Promise<Response> {
    if (!isValidR2ObjectKey(objectKey)) throw new R2StorageError(operation);
    const url = buildPrivateR2ObjectUrl(config, objectKey);
    let request: Request;
    try {
      request = await awsClient.sign(url, {
        method,
        headers,
        redirect: "error",
        aws: {
          service: "s3",
          region: config.region,
          allHeaders: true,
          datetime: formatAwsDate(now()),
        },
      });
      validateSignedRequest(request, url, method, operation);
      return await fetchImpl(request);
    } catch (error) {
      if (error instanceof R2StorageError) throw error;
      throw new R2StorageError(operation);
    }
  }

  async function createPresignedPut(
    input: R2PresignedPutInput,
  ): Promise<R2PresignedPut> {
    requireValidObjectKey(input.objectKey);
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > ASSET_MAX_BYTES ||
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds < 1 ||
      input.expiresInSeconds > R2_MAX_PRESIGN_EXPIRY_SECONDS
    ) {
      throw new R2StorageError("presign");
    }

    const issuedAt = now();
    const unsignedUrl = new URL(buildPrivateR2ObjectUrl(config, input.objectKey));
    unsignedUrl.searchParams.set(
      "X-Amz-Expires",
      String(input.expiresInSeconds),
    );

    try {
      const signed = await awsClient.sign(unsignedUrl, {
        method: "PUT",
        headers: {
          "content-length": String(input.byteSize),
          "content-type": input.contentType,
        },
        aws: {
          service: "s3",
          region: config.region,
          signQuery: true,
          allHeaders: true,
          datetime: formatAwsDate(issuedAt),
        },
      });
      validateSignedRequest(
        signed,
        unsignedUrl.toString(),
        "PUT",
        "presign",
        false,
      );
      const signedUrl = new URL(signed.url);
      const signedHeaders = signedUrl.searchParams
        .get("X-Amz-SignedHeaders")
        ?.split(";");
      if (
        signed.headers.get("content-length") !== String(input.byteSize) ||
        signed.headers.get("content-type") !== input.contentType ||
        signedUrl.searchParams.getAll("X-Amz-Expires").length !== 1 ||
        signedUrl.searchParams.getAll("X-Amz-SignedHeaders").length !== 1 ||
        signedUrl.searchParams.get("X-Amz-Expires") !==
          String(input.expiresInSeconds) ||
        !signedHeaders?.includes("content-length") ||
        !signedHeaders.includes("content-type")
      ) {
        throw new R2StorageError("presign");
      }

      return {
        method: "PUT",
        url: signed.url,
        headers: new Headers({
          "content-length": String(input.byteSize),
          "content-type": input.contentType,
        }),
        expiresAt: new Date(
          issuedAt.getTime() + input.expiresInSeconds * 1_000,
        ),
      };
    } catch (error) {
      if (error instanceof R2StorageError) throw error;
      throw new R2StorageError("presign");
    }
  }

  async function headObject(objectKey: string): Promise<R2HeadMetadata> {
    const response = await signedFetch(objectKey, "HEAD", "head");
    if (!response.ok) {
      await discardBody(response);
      throw new R2StorageError("head", response.status);
    }

    const rawLength = response.headers.get("content-length");
    const byteSize = parseNonNegativeInteger(rawLength);
    if (rawLength !== null && byteSize === null) {
      throw new R2StorageError("head");
    }
    const rawLastModified = response.headers.get("last-modified");
    const lastModifiedMs = rawLastModified ? Date.parse(rawLastModified) : NaN;
    const etag = responseEtag(response, "head");
    await discardBody(response);
    return {
      byteSize,
      contentType: response.headers.get("content-type"),
      etag,
      lastModified: Number.isNaN(lastModifiedMs)
        ? null
        : new Date(lastModifiedMs),
    };
  }

  async function getObjectRange(
    objectKey: string,
    start: number,
    endInclusive: number,
    options?: R2ConditionalGetOptions,
  ): Promise<R2RangedObject> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(endInclusive) ||
      start < 0 ||
      endInclusive < start ||
      endInclusive - start + 1 > ASSET_MAX_BYTES
    ) {
      throw new R2StorageError("range");
    }

    const response = await signedFetch(
      objectKey,
      "GET",
      "range",
      conditionalGetHeaders(
        "range",
        { range: `bytes=${start}-${endInclusive}` },
        options,
      ),
    );
    if (response.status !== 206) {
      await discardBody(response);
      throw new R2StorageError("range", response.status);
    }
    const contentRange = parseContentRange(
      response.headers.get("content-range"),
    );
    if (
      contentRange === null ||
      contentRange.start !== start ||
      contentRange.end > endInclusive
    ) {
      await discardBody(response);
      throw new R2StorageError("range");
    }
    const expectedLength = contentRange.end - contentRange.start + 1;
    let etag: string | null;
    try {
      etag = responseEtag(response, "range");
    } catch (error) {
      await discardBody(response);
      throw error;
    }
    const bytes = await readBodyBounded(response, expectedLength, "range");
    if (bytes.byteLength !== expectedLength) throw new R2StorageError("range");

    return {
      bytes,
      contentType: response.headers.get("content-type"),
      etag,
      contentRange,
    };
  }

  async function getObject(
    objectKey: string,
    maxBytes: number,
    options?: R2ConditionalGetOptions,
  ): Promise<R2FullObject> {
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > ASSET_MAX_BYTES
    ) {
      throw new R2StorageError("get");
    }
    const response = await signedFetch(
      objectKey,
      "GET",
      "get",
      conditionalGetHeaders("get", undefined, options),
    );
    if (!response.ok) {
      await discardBody(response);
      throw new R2StorageError("get", response.status);
    }
    const rawLength = response.headers.get("content-length");
    const byteSize = parseNonNegativeInteger(rawLength);
    if (rawLength !== null && byteSize === null) {
      await discardBody(response);
      throw new R2StorageError("get");
    }
    let etag: string | null;
    try {
      etag = responseEtag(response, "get");
    } catch (error) {
      await discardBody(response);
      throw error;
    }
    const bytes = await readBodyBounded(response, maxBytes, "get");
    return {
      bytes,
      contentType: response.headers.get("content-type"),
      etag,
      byteSize,
    };
  }

  async function deleteObject(
    objectKey: string,
    options?: R2DeleteOptions,
  ): Promise<void> {
    let headers: Headers | undefined;
    if (options?.ifMatch !== undefined) {
      const ifMatch = formatR2IfMatch(options.ifMatch);
      if (ifMatch === null) throw new R2StorageError("delete");
      headers = new Headers({ "if-match": ifMatch });
    }
    const response = await signedFetch(
      objectKey,
      "DELETE",
      "delete",
      headers,
    );
    await discardBody(response);
    if (!response.ok) throw new R2StorageError("delete", response.status);
  }

  return {
    createPresignedPut,
    headObject,
    getObjectRange,
    getObject,
    deleteObject,
  };
}
