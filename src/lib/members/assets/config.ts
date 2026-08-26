import type { MemberAssetMimeType } from "@/lib/members/assets/types";

export const MEMBER_PAGE_R2_ENVIRONMENT_VARIABLES = [
  "MEMBER_PAGE_R2_ENVIRONMENT",
  "MEMBER_PAGE_R2_ACCOUNT_ID",
  "MEMBER_PAGE_R2_ACCESS_KEY_ID",
  "MEMBER_PAGE_R2_SECRET_ACCESS_KEY",
  "MEMBER_PAGE_R2_BUCKET",
  "MEMBER_PAGE_R2_ENDPOINT",
] as const;

const MEMBER_PAGE_R2_REQUIRED_ENVIRONMENT_VARIABLES =
  MEMBER_PAGE_R2_ENVIRONMENT_VARIABLES.slice(0, 5);

export const MEMBER_ASSET_PUBLIC_CACHE_CONTROL = "no-store";
export const MEMBER_ASSET_PRIVATE_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";

export type MemberPageR2Environment = "production" | "nonproduction";

export interface MemberPageR2EnvironmentInput {
  MEMBER_PAGE_R2_ENVIRONMENT?: string;
  MEMBER_PAGE_R2_ACCOUNT_ID?: string;
  MEMBER_PAGE_R2_ACCESS_KEY_ID?: string;
  MEMBER_PAGE_R2_SECRET_ACCESS_KEY?: string;
  MEMBER_PAGE_R2_BUCKET?: string;
  MEMBER_PAGE_R2_ENDPOINT?: string;
}

export interface MemberPageR2Config {
  environment: MemberPageR2Environment;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: "auto" | "us-east-1";
}

export type MemberPageR2ConfigParseResult =
  | { success: true; config: MemberPageR2Config | null }
  | { success: false; errors: string[] };

export class MemberPageR2ConfigurationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid member asset storage configuration: ${errors.join(" ")}`);
    this.name = "MemberPageR2ConfigurationError";
    this.errors = errors;
  }
}

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const ACCESS_KEY_ID_PATTERN = /^[A-Za-z0-9]{16,128}$/;
const SECRET_ACCESS_KEY_PATTERN = /^[\x21-\x7e]{32,256}$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const OBJECT_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const MAX_OBJECT_KEY_BYTES = 1_024;

function isValidBucketName(bucket: string): boolean {
  return (
    BUCKET_PATTERN.test(bucket) &&
    !bucket.startsWith("xn--") &&
    !bucket.endsWith("-s3alias") &&
    !bucket.endsWith("--ol-s3")
  );
}

function isValidLocalEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.origin === endpoint &&
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "[::1]" ||
        hostname === "::1")
    );
  } catch {
    return false;
  }
}

export function isValidR2ObjectKey(objectKey: string): boolean {
  if (
    objectKey.length === 0 ||
    objectKey.startsWith("/") ||
    objectKey.endsWith("/") ||
    objectKey.includes("\\") ||
    new TextEncoder().encode(objectKey).byteLength > MAX_OBJECT_KEY_BYTES
  ) {
    return false;
  }

  const segments = objectKey.split("/");
  return segments.every(
    (segment) =>
      segment !== "." &&
      segment !== ".." &&
      OBJECT_KEY_SEGMENT_PATTERN.test(segment),
  );
}

export function encodeR2ObjectKey(objectKey: string): string {
  if (!isValidR2ObjectKey(objectKey)) {
    throw new MemberPageR2ConfigurationError([
      "The R2 object key is invalid.",
    ]);
  }
  return objectKey.split("/").map(encodeURIComponent).join("/");
}

export function buildPrivateR2ObjectUrl(
  config: Pick<MemberPageR2Config, "endpoint">,
  objectKey: string,
): string {
  return `${config.endpoint}/${encodeR2ObjectKey(objectKey)}`;
}

export function isMemberAssetMimeType(
  value: string,
): value is MemberAssetMimeType {
  return (
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/webp" ||
    value === "image/avif"
  );
}

export function parseMemberPageR2Config(
  env: MemberPageR2EnvironmentInput,
  appEnvironment: MemberPageR2Environment,
): MemberPageR2ConfigParseResult {
  if (appEnvironment !== "production" && appEnvironment !== "nonproduction") {
    return {
      success: false,
      errors: ["The application environment class is invalid."],
    };
  }

  const values = MEMBER_PAGE_R2_ENVIRONMENT_VARIABLES.map((name) => [
    name,
    env[name],
  ] as const);
  const configured = values.filter(([, value]) => value !== undefined);

  if (configured.length === 0) {
    return { success: true, config: null };
  }

  const errors: string[] = [];
  if (configured.length > 0) {
    for (const name of MEMBER_PAGE_R2_REQUIRED_ENVIRONMENT_VARIABLES) {
      const value = env[name];
      if (value === undefined) errors.push(`${name} is required when R2 storage is configured.`);
    }
  }

  const storageEnvironment = env.MEMBER_PAGE_R2_ENVIRONMENT?.trim();
  const accountId = env.MEMBER_PAGE_R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.MEMBER_PAGE_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.MEMBER_PAGE_R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.MEMBER_PAGE_R2_BUCKET?.trim();
  const endpointOverride = env.MEMBER_PAGE_R2_ENDPOINT?.trim();

  if (
    storageEnvironment !== undefined &&
    storageEnvironment !== "production" &&
    storageEnvironment !== "nonproduction"
  ) {
    errors.push(
      "MEMBER_PAGE_R2_ENVIRONMENT must be exactly production or nonproduction.",
    );
  }
  if (
    storageEnvironment === "production" ||
    storageEnvironment === "nonproduction"
  ) {
    if (storageEnvironment !== appEnvironment) {
      errors.push(
        "MEMBER_PAGE_R2_ENVIRONMENT must match the application environment class.",
      );
    }
  }
  if (accountId !== undefined && !ACCOUNT_ID_PATTERN.test(accountId)) {
    errors.push("MEMBER_PAGE_R2_ACCOUNT_ID is malformed.");
  }
  if (accessKeyId !== undefined && !ACCESS_KEY_ID_PATTERN.test(accessKeyId)) {
    errors.push("MEMBER_PAGE_R2_ACCESS_KEY_ID is malformed.");
  }
  if (
    secretAccessKey !== undefined &&
    !SECRET_ACCESS_KEY_PATTERN.test(secretAccessKey)
  ) {
    errors.push("MEMBER_PAGE_R2_SECRET_ACCESS_KEY is malformed.");
  }
  if (bucket !== undefined && !isValidBucketName(bucket)) {
    errors.push("MEMBER_PAGE_R2_BUCKET is malformed.");
  }
  if (endpointOverride !== undefined) {
    if (appEnvironment === "production") {
      errors.push(
        "MEMBER_PAGE_R2_ENDPOINT is forbidden in production; the R2 endpoint is derived from the account and bucket.",
      );
    } else if (!isValidLocalEndpoint(endpointOverride)) {
      errors.push(
        "MEMBER_PAGE_R2_ENDPOINT must be a clean http: or https: loopback origin in nonproduction.",
      );
    }
  }

  if (errors.length > 0) return { success: false, errors };

  return {
    success: true,
    config: {
      environment: storageEnvironment as MemberPageR2Environment,
      accountId: accountId!,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      bucket: bucket!,
      endpoint: `${
        endpointOverride ??
        `https://${accountId}.r2.cloudflarestorage.com`
      }/${bucket}`,
      region: endpointOverride === undefined ? "auto" : "us-east-1",
    },
  };
}

export function getMemberPageR2Config(
  appEnvironment: MemberPageR2Environment,
  env: MemberPageR2EnvironmentInput = {
    MEMBER_PAGE_R2_ENVIRONMENT: process.env.MEMBER_PAGE_R2_ENVIRONMENT,
    MEMBER_PAGE_R2_ACCOUNT_ID: process.env.MEMBER_PAGE_R2_ACCOUNT_ID,
    MEMBER_PAGE_R2_ACCESS_KEY_ID: process.env.MEMBER_PAGE_R2_ACCESS_KEY_ID,
    MEMBER_PAGE_R2_SECRET_ACCESS_KEY:
      process.env.MEMBER_PAGE_R2_SECRET_ACCESS_KEY,
    MEMBER_PAGE_R2_BUCKET: process.env.MEMBER_PAGE_R2_BUCKET,
    MEMBER_PAGE_R2_ENDPOINT: process.env.MEMBER_PAGE_R2_ENDPOINT,
  },
): MemberPageR2Config | null {
  const parsed = parseMemberPageR2Config(env, appEnvironment);
  if (!parsed.success) throw new MemberPageR2ConfigurationError(parsed.errors);
  return parsed.config;
}
