/**
 * Named external-service requirements and safety guards for the browser E2E
 * suite.
 *
 * Safety boundary (enforced here, never negotiated):
 * - Database URLs must be loopback, must name a disposable test database, and
 *   require ALLOW_LOCAL_DB_TESTS=1. The same rules guard the existing
 *   real-Postgres integration suite; this suite refuses anything else instead
 *   of skipping.
 * - The app origin must be the local HTTPS development origin. The suite never
 *   runs against a deployed host.
 * - The storage origin must be local HTTPS loopback, and server-issued direct
 *   upload URLs are checked against it before any byte leaves the browser.
 * - No shared production credentials exist anywhere in this suite.
 *
 * Every requirement has a human-readable name so a skip says exactly what is
 * missing.
 */

const ALLOWED_DISPOSABLE_DB_NAMES = new Set([
  "neondb",
  "test",
  "testdb",
  "teamham_test",
  "postgres_test",
]);

export const DEFAULT_BASE_URL = "https://localhost:3000";
export const DEFAULT_STORAGE_URL = "https://localhost:9000";

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

/**
 * Validates a disposable test-database URL. Throws (fails the run) when the
 * URL is present but unguarded; absence is handled by the caller as a skip.
 */
export function validateDisposableDatabaseUrl(label: string, rawUrl: string): string {
  if (process.env.ALLOW_LOCAL_DB_TESTS !== "1") {
    throw new Error(
      `${label} refused: destructive test setup requires ALLOW_LOCAL_DB_TESTS=1.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }

  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `${label} refused: target host must be loopback (localhost, 127.0.0.1, ::1), never a remote or production database.`,
    );
  }

  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  if (!ALLOWED_DISPOSABLE_DB_NAMES.has(dbName)) {
    throw new Error(
      `${label} refused: database "${dbName}" is not an allowed disposable test database (${[...ALLOWED_DISPOSABLE_DB_NAMES].join(", ")}).`,
    );
  }

  return rawUrl;
}

export function resolveBaseUrl(): string {
  const value = process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`E2E_BASE_URL is not a valid URL: ${value}`);
  }
  if (parsed.protocol !== "https:" || !isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `E2E_BASE_URL refused: this suite only runs against the local HTTPS development origin, not "${value}".`,
    );
  }
  return value.replace(/\/$/, "");
}

/**
 * Resolves the approved local object-storage origin. Only an HTTPS loopback
 * origin is accepted: remote hosts, embedded credentials, and non-empty
 * paths, queries, or fragments are refused. Returns the bare origin (no
 * trailing slash) so callers can append exactly one path.
 */
export function resolveStorageUrl(): string {
  const value = process.env.E2E_STORAGE_URL ?? DEFAULT_STORAGE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`E2E_STORAGE_URL is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `E2E_STORAGE_URL refused: only HTTPS is accepted, never plain HTTP.`,
    );
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `E2E_STORAGE_URL refused: only loopback hosts (localhost, 127.0.0.1, ::1) are accepted, never a remote host.`,
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error(
      `E2E_STORAGE_URL refused: embedded credentials are not accepted.`,
    );
  }
  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new Error(
      `E2E_STORAGE_URL refused: a bare origin is required, without a path.`,
    );
  }
  if (parsed.search !== "") {
    throw new Error(
      `E2E_STORAGE_URL refused: a bare origin is required, without a query.`,
    );
  }
  if (parsed.hash !== "") {
    throw new Error(
      `E2E_STORAGE_URL refused: a bare origin is required, without a fragment.`,
    );
  }
  return value.replace(/\/+$/, "");
}

/**
 * Guard for server-issued direct-upload URLs. Returns null when the upload
 * URL points at exactly the approved storage origin (scheme, host, and port);
 * otherwise returns a human-readable reason. Embedded credentials are
 * rejected even though URL origins do not include them. Paths, queries, and
 * fragments on the upload URL are expected (object key plus presigned
 * query) and never rejected. Reasons never echo the full upload URL so a
 * presigned signature cannot leak into logs.
 */
export function uploadOriginViolation(
  uploadUrl: string,
  approvedStorageUrl: string,
): string | null {
  let approved: URL;
  try {
    approved = new URL(approvedStorageUrl);
  } catch {
    return "The approved storage URL is not a valid URL.";
  }
  let parsed: URL;
  try {
    parsed = new URL(uploadUrl);
  } catch {
    return "The server-issued upload URL is not a valid URL.";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "The server-issued upload URL embeds credentials.";
  }
  if (parsed.origin !== approved.origin) {
    return `The server-issued upload URL origin ${parsed.origin} is not the approved storage origin ${approved.origin}.`;
  }
  return null;
}

export interface Requirements {
  /** Human-readable names of every absent requirement. Empty when ready. */
  readonly missing: readonly string[];
  readonly hasDatabase: boolean;
  readonly hasOwnerDatabase: boolean;
}

/**
 * Synchronous presence check for the requirements every database-backed test
 * shares. Invalid (unguarded) values throw; absent values become named skips.
 */
export function describeRequirements(): Requirements {
  const missing: string[] = [];

  if (!process.env.E2E_DATABASE_URL) {
    missing.push(
      "disposable test database (E2E_DATABASE_URL; start it with npm run test:e2e:vps, which also opens the guarded SSH tunnel)",
    );
  }
  if (!process.env.E2E_DATABASE_OWNER_URL) {
    missing.push(
      "owner-role disposable database URL (E2E_DATABASE_OWNER_URL) for deterministic fixture cleanup",
    );
  }

  // Validate present values eagerly so an unguarded URL fails the run here,
  // at the boundary, instead of mid-test.
  if (process.env.E2E_DATABASE_URL) {
    validateDisposableDatabaseUrl("E2E_DATABASE_URL", process.env.E2E_DATABASE_URL);
  }
  if (process.env.E2E_DATABASE_OWNER_URL) {
    validateDisposableDatabaseUrl(
      "E2E_DATABASE_OWNER_URL",
      process.env.E2E_DATABASE_OWNER_URL,
    );
  }

  return {
    missing,
    hasDatabase: Boolean(process.env.E2E_DATABASE_URL),
    hasOwnerDatabase: Boolean(process.env.E2E_DATABASE_OWNER_URL),
  };
}

/** True when something answers HTTP on the app origin (any status counts). */
export async function probeApp(baseURL: string): Promise<boolean> {
  try {
    const response = await fetch(baseURL, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

/** True when the local MinIO health endpoint answers. */
export async function probeStorage(storageURL: string): Promise<boolean> {
  try {
    const response = await fetch(`${storageURL}/minio/health/live`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
