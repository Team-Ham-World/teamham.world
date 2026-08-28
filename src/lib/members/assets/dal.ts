import "server-only";

import { randomBytes as nodeRandomBytes } from "node:crypto";

import { getAuthMode } from "@/lib/auth/config";
import { isValidUuid } from "@/lib/auth/crypto";
import { getDbClient } from "@/lib/auth/db";
import { getCurrentVerifiedAccount } from "@/lib/auth/session";
import {
  getMemberPageR2Config,
  isMemberAssetMimeType,
  isValidR2ObjectKey,
} from "@/lib/members/assets/config";
import { createR2StorageAdapter } from "@/lib/members/assets/r2";
import type {
  MemberAssetMimeType,
  R2StorageAdapter,
  VerifiedMemberAssetMetadata,
} from "@/lib/members/assets/types";
import {
  normalizeR2Etag,
} from "@/lib/members/assets/types";
import {
  verifyStoredMemberAsset,
  type MemberAssetVerificationReasonCode,
} from "@/lib/members/assets/verify";
import { isValidMemberSlug } from "@/lib/members/model";
import { validateMemberSlug } from "@/lib/members/validation";
import { extractMemberPageAssetIds } from "@/lib/members/v2/asset-references";
import { ASSET_MAX_BYTES, ASSET_MAX_DIMENSION } from "@/lib/members/v2/limits";
import { isMemberPageV2EditorEnabled } from "@/lib/members/v2/feature-flag";
import { MEMBER_PAGE_ASSET_FINALIZE_RATE_LIMIT } from "@/lib/members/v2/rate-limits";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";

export const MEMBER_ASSET_PENDING_LIMIT = 5;
export const MEMBER_ASSET_HOURLY_ALLOCATION_LIMIT = 20;
export const MEMBER_ASSET_READY_LIMIT = 20;
export const MEMBER_ASSET_PENDING_SECONDS = 300;
export const MEMBER_ASSET_CLEANUP_BATCH_SIZE = 5;

// Pending counters represent unclaimed pending rows. Ready counters represent
// all stored ready rows, including deletion claims, until metadata is physically
// deleted after upload URL expiry and confirmed R2 deletion or absence.
const MEMBER_ASSET_READY_COUNT_CONSTRAINT =
  "ck_member_pages_asset_ready_count";

const MIME_TOKEN: Readonly<Record<MemberAssetMimeType, string>> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const TOKEN_MIME: Readonly<Record<string, MemberAssetMimeType>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

const ALLOCATION_KEY_PATTERN =
  /^member-page-assets\/[A-Za-z0-9_-]{24}\/(\d{1,7})-(jpeg|png|webp|avif)-[A-Za-z0-9_-]{43}$/u;

export interface MemberAssetDalDependencies {
  storage?: R2StorageAdapter;
  now?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
}

interface AllocationOutcomeRow {
  outcome: unknown;
  asset_id?: unknown;
  pending_expires_at?: unknown;
}

interface OwnedPageExistenceRow {
  owned: unknown;
}

interface PendingAssetRow {
  outcome?: unknown;
  id: unknown;
  object_key: unknown;
  pending_expires_at: unknown;
}

interface CleanupAssetRow {
  id: unknown;
  object_key: unknown;
  status: unknown;
  etag: unknown;
  created_at: unknown;
  newly_claimed: unknown;
}

interface FinalizeOutcomeRow {
  outcome: unknown;
  asset_id?: unknown;
  mime_type?: unknown;
  width?: unknown;
  height?: unknown;
  ready_at?: unknown;
  verified_at?: unknown;
}

interface ListedAssetRow {
  id: unknown;
  status: unknown;
  mime_type: unknown;
  width: unknown;
  height: unknown;
  created_at: unknown;
  ready_at: unknown;
  verified_at: unknown;
  pending_expires_at: unknown;
}

interface ServingAssetRow {
  id: unknown;
  slug: unknown;
  owner_account_id: unknown;
  object_key: unknown;
  mime_type: unknown;
  byte_size: unknown;
  width: unknown;
  height: unknown;
  etag: unknown;
  published_doc: unknown;
  public_authorized: unknown;
}

interface MetadataAssetRow {
  id: unknown;
  mime_type: unknown;
  width: unknown;
  height: unknown;
}

export interface MemberAssetAllocation {
  assetId: string;
  uploadUrl: string;
  requiredContentType: MemberAssetMimeType;
  requiredByteSize: number;
  expiresAt: string;
}

export type MemberAssetAllocationResult =
  | { status: "success"; data: MemberAssetAllocation }
  | { status: "not-found-or-forbidden" }
  | { status: "invalid" }
  | { status: "pending-limit" }
  | { status: "rate-limit" }
  | { status: "unavailable" };

export interface ReadyMemberAssetMetadata {
  assetId: string;
  status: "ready";
  mimeType: MemberAssetMimeType;
  width: number;
  height: number;
  readyAt: string;
  verifiedAt: string;
}

export type MemberAssetFinalizeResult =
  | { status: "success"; data: ReadyMemberAssetMetadata }
  | { status: "not-found-or-forbidden" }
  | { status: "invalid"; reason?: MemberAssetVerificationReasonCode }
  | { status: "quota" }
  | { status: "conflict" }
  | { status: "rate-limit" }
  | { status: "unavailable" };

export interface OwnedMemberAssetMetadata {
  assetId: string;
  status: "pending" | "ready";
  mimeType: MemberAssetMimeType | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  readyAt: string | null;
  verifiedAt: string | null;
  pendingExpiresAt: string;
}

export type OwnedMemberAssetListResult =
  | { status: "success"; assets: readonly OwnedMemberAssetMetadata[] }
  | { status: "not-found-or-forbidden" }
  | { status: "invalid" }
  | { status: "unavailable" };

export type MemberAssetDeleteResult =
  | { status: "success" }
  | { status: "not-found-or-forbidden" }
  | { status: "invalid" }
  | {
      status: "referenced";
      /**
       * Owner-only classification of where the blocking reference lives. This
       * never weakens the deletion invariant: the asset stays claimed-free and
       * the SQL guard still requires both documents to be clear.
       */
      location: MemberAssetReferenceLocation;
    }
  | { status: "conflict" }
  | { status: "unavailable" };

/**
 * Where a deletion-blocked asset is still referenced. Owner-only output: the
 * generic editor never receives this for other viewers, and it carries no
 * document content — only which stored document(s) hold the reference.
 */
export type MemberAssetReferenceLocation = "draft" | "published" | "both";

export type MemberAssetServingResult =
  | {
      status: "success";
      visibility: "public" | "private";
      mimeType: MemberAssetMimeType;
      byteSize: number;
      width: number;
      height: number;
      etag: string;
      bytes: Uint8Array;
    }
  | { status: "not-found" }
  | { status: "unavailable" };

export interface PublicMemberAssetMetadata {
  width: number;
  height: number;
  mimeType: MemberAssetMimeType;
}

/**
 * Upper bound on the degraded asset-ID set. A page cannot reference more ready
 * assets than the ready quota, so the bound never truncates in practice; it
 * exists so the diagnostic set can never grow with a corrupted request.
 */
export const MEMBER_ASSET_PUBLIC_METADATA_DEGRADED_LIMIT = 20;

/**
 * Public metadata read for rendering a published page.
 *
 * - `success` carries every safely resolvable asset plus the bounded set of
 *   requested asset IDs that are missing, deletion-claimed, or stored with
 *   invalid metadata. Callers render unaffected content and give degraded
 *   assets the existing safe leaf fallbacks.
 * - `invalid` is reserved for malformed request input or unattributable
 *   corruption, not for content-level asset problems.
 * - `unavailable` means a database or storage failure: a service failure that
 *   must never be rendered as ordinary 404 content.
 */
export type PublicMemberAssetMetadataResult =
  | {
      status: "success";
      metadata: ReadonlyMap<string, PublicMemberAssetMetadata>;
      degradedAssetIds: ReadonlySet<string>;
    }
  | { status: "invalid" }
  | { status: "unavailable" };

type EditorAuthorization =
  | { status: "success"; slug: string; accountId: string }
  | { status: "not-found-or-forbidden" }
  | { status: "invalid" };

function parseTimestamp(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseNullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parseTimestamp(value) ?? undefined;
}

function parsePositiveInteger(value: unknown, maximum: number): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : null;
}

function isDatabaseEnabled(): boolean {
  try {
    return getAuthMode() !== "disabled";
  } catch {
    return false;
  }
}

function resolveStorage(
  dependencies: MemberAssetDalDependencies,
): R2StorageAdapter | null {
  if (dependencies.storage) return dependencies.storage;
  try {
    const mode = getAuthMode();
    if (mode === "disabled") return null;
    const config = getMemberPageR2Config(
      mode === "production" ? "production" : "nonproduction",
    );
    return config ? createR2StorageAdapter(config) : null;
  } catch {
    return null;
  }
}

async function authorizeEditorRequest(slugInput: unknown): Promise<EditorAuthorization> {
  let account;
  try {
    account = await getCurrentVerifiedAccount();
  } catch {
    return { status: "not-found-or-forbidden" };
  }
  if (!account) return { status: "not-found-or-forbidden" };
  const slug = validateMemberSlug(slugInput);
  if (!slug) return { status: "invalid" };
  try {
    if (!isMemberPageV2EditorEnabled(slug)) {
      return { status: "not-found-or-forbidden" };
    }
  } catch {
    return { status: "not-found-or-forbidden" };
  }
  return { status: "success", slug, accountId: account.id };
}

function createObjectKey(
  mimeType: MemberAssetMimeType,
  byteSize: number,
  randomBytes: (size: number) => Uint8Array,
): string {
  const directory = Buffer.from(randomBytes(18)).toString("base64url");
  const nonce = Buffer.from(randomBytes(32)).toString("base64url");
  const objectKey =
    `member-page-assets/${directory}/${byteSize}-${MIME_TOKEN[mimeType]}-${nonce}`;
  if (!ALLOCATION_KEY_PATTERN.test(objectKey) || !isValidR2ObjectKey(objectKey)) {
    throw new Error("Failed to generate a valid member asset object key.");
  }
  return objectKey;
}

function parseAllocationBinding(objectKey: string): {
  claimedMimeType: MemberAssetMimeType;
  claimedByteSize: number;
} | null {
  const match = ALLOCATION_KEY_PATTERN.exec(objectKey);
  if (!match) return null;
  const claimedByteSize = parsePositiveInteger(match[1], ASSET_MAX_BYTES);
  const claimedMimeType = TOKEN_MIME[match[2]];
  return claimedByteSize === null || !claimedMimeType
    ? null
    : { claimedMimeType, claimedByteSize };
}

function isMissingObjectDelete(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

function classifyMemberAssetDatabaseError(
  error: unknown,
): "ready-quota" | "other" {
  const databaseError = error as { code?: unknown; constraint?: unknown };
  return databaseError.code === "23514" &&
    databaseError.constraint === MEMBER_ASSET_READY_COUNT_CONSTRAINT
    ? "ready-quota"
    : "other";
}

/**
 * Parses the owner-only reference classification emitted by the deletion
 * query's CASE expression. The SQL always yields one of the three literals;
 * "both" is the conservative fallback because its owner-facing copy covers
 * both stored documents without claiming where the reference uniquely sits.
 */
function parseReferenceLocation(
  value: unknown,
): MemberAssetReferenceLocation {
  return value === "draft" || value === "published" || value === "both"
    ? value
    : "both";
}

async function deleteStorageObject(
  storage: R2StorageAdapter,
  objectKey: string,
  etag: string | null,
): Promise<boolean> {
  try {
    await storage.deleteObject(
      objectKey,
      etag === null ? undefined : { ifMatch: etag },
    );
    return true;
  } catch (error) {
    return isMissingObjectDelete(error);
  }
}

function parseCleanupRow(row: CleanupAssetRow): {
  id: string;
  objectKey: string;
  status: "pending" | "ready";
  etag: string | null;
  createdAt: string;
  newlyClaimed: boolean;
} | null {
  const etag = row.etag === null
    ? null
    : typeof row.etag === "string"
      ? normalizeR2Etag(row.etag)
      : null;
  const createdAt = parseTimestamp(row.created_at);
  if (
    typeof row.id !== "string" ||
    !isValidUuid(row.id) ||
    typeof row.object_key !== "string" ||
    !isValidR2ObjectKey(row.object_key) ||
    (row.status !== "pending" && row.status !== "ready") ||
    (row.etag !== null && etag === null) ||
    (row.status === "ready" && etag === null) ||
    createdAt === null ||
    typeof row.newly_claimed !== "boolean"
  ) {
    return null;
  }
  return {
    id: row.id,
    objectKey: row.object_key,
    status: row.status,
    etag,
    createdAt,
    newlyClaimed: row.newly_claimed,
  };
}

async function deleteClaimedMetadata(
  asset: ReturnType<typeof parseCleanupRow> & {},
): Promise<boolean> {
  const sql = getDbClient();
  const rows = await sql`
    WITH page_guard AS MATERIALIZED (
      SELECT page.id
      FROM public.member_pages page
      JOIN public.member_page_assets asset
        ON asset.member_page_id = page.id
      WHERE asset.id = ${asset.id}
        AND asset.object_key = ${asset.objectKey}
        AND asset.deletion_claimed_at IS NOT NULL
        AND asset.etag IS NOT DISTINCT FROM ${asset.etag}
        AND asset.pending_expires_at <= NOW()
      FOR UPDATE OF page
    ),
    deleted AS (
      DELETE FROM public.member_page_assets asset
      USING page_guard
      WHERE asset.id = ${asset.id}
        AND asset.member_page_id = page_guard.id
        AND asset.object_key = ${asset.objectKey}
        AND asset.deletion_claimed_at IS NOT NULL
        AND asset.etag IS NOT DISTINCT FROM ${asset.etag}
        AND asset.pending_expires_at <= NOW()
      RETURNING asset.id, asset.member_page_id, asset.status
    ),
    page_adjusted AS (
      UPDATE public.member_pages page
      SET asset_ready_count = page.asset_ready_count - CASE
        WHEN deleted.status = 'ready' THEN 1 ELSE 0
      END
      FROM deleted
      WHERE page.id = deleted.member_page_id
      RETURNING page.id
    )
    SELECT deleted.id
    FROM deleted
    JOIN page_adjusted ON page_adjusted.id = deleted.member_page_id;
  `;
  return rows.length === 1;
}

async function cleanupClaimedRows(
  rows: CleanupAssetRow[],
  storage: R2StorageAdapter,
): Promise<void> {
  for (const row of rows) {
    const asset = parseCleanupRow(row);
    if (!asset) continue;
    if (!(await deleteStorageObject(storage, asset.objectKey, null))) continue;
    try {
      await deleteClaimedMetadata(asset);
    } catch {
      // The claim retains the recoverable object identity for a later retry.
    }
  }
}

async function cleanupOwnedMemberPageAssets(
  slug: string,
  accountId: string,
  storage: R2StorageAdapter,
): Promise<void> {
  try {
    const sql = getDbClient();
    const rows = (await sql`
      WITH target AS MATERIALIZED (
        SELECT id
        FROM public.member_pages
        WHERE slug = ${slug}
          AND owner_account_id = ${accountId}
        FOR UPDATE
      ),
      candidates AS MATERIALIZED (
        SELECT
          asset.id,
          (asset.deletion_claimed_at IS NULL) AS needs_claim
        FROM public.member_page_assets asset
        JOIN target ON target.id = asset.member_page_id
        WHERE asset.pending_expires_at <= NOW()
          AND (
            asset.deletion_claimed_at IS NOT NULL
            OR asset.status = 'pending'
          )
        ORDER BY asset.deletion_claimed_at NULLS LAST, asset.pending_expires_at
        LIMIT ${MEMBER_ASSET_CLEANUP_BATCH_SIZE}
        FOR UPDATE OF asset SKIP LOCKED
      ),
      newly_claimed AS (
        UPDATE public.member_page_assets asset
        SET deletion_claimed_at = NOW()
        FROM candidates
        WHERE asset.id = candidates.id
          AND candidates.needs_claim
          AND asset.deletion_claimed_at IS NULL
        RETURNING
          asset.id,
          asset.member_page_id,
          asset.object_key,
          asset.status,
          asset.etag,
          asset.created_at
      ),
      page_adjusted AS (
        UPDATE public.member_pages page
        SET asset_pending_count = page.asset_pending_count - (
          SELECT COUNT(*)::integer
          FROM newly_claimed
          WHERE newly_claimed.status = 'pending'
        )
        FROM target
        WHERE page.id = target.id
          AND EXISTS (SELECT 1 FROM newly_claimed)
        RETURNING page.id
      ),
      retry_rows AS (
        SELECT
          asset.id,
          asset.object_key,
          asset.status,
          asset.etag,
          asset.created_at
        FROM public.member_page_assets asset
        JOIN candidates ON candidates.id = asset.id
        WHERE NOT candidates.needs_claim
          AND asset.deletion_claimed_at IS NOT NULL
      )
      SELECT
        newly_claimed.id,
        newly_claimed.object_key,
        newly_claimed.status,
        newly_claimed.etag,
        newly_claimed.created_at,
        TRUE AS newly_claimed
      FROM newly_claimed
      JOIN page_adjusted ON page_adjusted.id = newly_claimed.member_page_id
      UNION ALL
      SELECT
        retry_rows.id,
        retry_rows.object_key,
        retry_rows.status,
        retry_rows.etag,
        retry_rows.created_at,
        FALSE AS newly_claimed
      FROM retry_rows;
    `) as CleanupAssetRow[];
    await cleanupClaimedRows(rows, storage);
  } catch {
    // Cleanup is bounded and opportunistic; the primary owner operation proceeds.
  }
}

async function claimPendingAsset(
  assetId: string,
  slug: string,
  accountId: string,
): Promise<CleanupAssetRow[]> {
  const sql = getDbClient();
  return (await sql`
    WITH page_guard AS MATERIALIZED (
      SELECT page.id
      FROM public.member_pages page
      WHERE page.slug = ${slug}
        AND page.owner_account_id = ${accountId}
      FOR UPDATE
    ),
    newly_claimed AS (
      UPDATE public.member_page_assets asset
      SET deletion_claimed_at = NOW()
      FROM page_guard page
      WHERE asset.id = ${assetId}
        AND asset.member_page_id = page.id
        AND asset.status = 'pending'
        AND asset.deletion_claimed_at IS NULL
      RETURNING
        asset.id,
        asset.member_page_id,
        asset.object_key,
        asset.status,
        asset.etag,
        asset.created_at
    ),
    page_adjusted AS (
      UPDATE public.member_pages page
      SET asset_pending_count = page.asset_pending_count - 1
      FROM newly_claimed
      WHERE page.id = newly_claimed.member_page_id
      RETURNING page.id
    )
    SELECT
      newly_claimed.id,
      newly_claimed.object_key,
      newly_claimed.status,
      newly_claimed.etag,
      newly_claimed.created_at,
      TRUE AS newly_claimed
    FROM newly_claimed
    JOIN page_adjusted ON page_adjusted.id = newly_claimed.member_page_id;
  `) as CleanupAssetRow[];
}

async function removeInvalidPendingAsset(
  assetId: string,
  slug: string,
  accountId: string,
  storage: R2StorageAdapter,
): Promise<void> {
  try {
    const rows = await claimPendingAsset(assetId, slug, accountId);
    await cleanupClaimedRows(rows, storage);
  } catch {
    // A retained pending/claimed row remains recoverable by later owner cleanup.
  }
}

export async function allocateOwnedMemberPageAsset(
  slugInput: unknown,
  mimeTypeInput: unknown,
  byteSizeInput: unknown,
  dependencies: MemberAssetDalDependencies = {},
): Promise<MemberAssetAllocationResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;
  if (
    typeof mimeTypeInput !== "string" ||
    !isMemberAssetMimeType(mimeTypeInput)
  ) {
    return { status: "invalid" };
  }
  const byteSize = parsePositiveInteger(byteSizeInput, ASSET_MAX_BYTES);
  if (byteSize === null) return { status: "invalid" };
  const storage = resolveStorage(dependencies);
  if (!storage) return { status: "unavailable" };

  const sql = getDbClient();
  let ownershipRows: OwnedPageExistenceRow[];
  try {
    ownershipRows = (await sql`
      SELECT TRUE AS owned
      FROM public.member_pages page
      WHERE page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
      LIMIT 1;
    `) as OwnedPageExistenceRow[];
  } catch {
    return { status: "unavailable" };
  }
  if (ownershipRows.length === 0) return { status: "not-found-or-forbidden" };
  if (ownershipRows.length !== 1 || ownershipRows[0].owned !== true) {
    return { status: "unavailable" };
  }

  await cleanupOwnedMemberPageAssets(
    authorization.slug,
    authorization.accountId,
    storage,
  );

  let objectKey: string;
  let presigned: Awaited<ReturnType<R2StorageAdapter["createPresignedPut"]>>;
  try {
    objectKey = createObjectKey(
      mimeTypeInput,
      byteSize,
      dependencies.randomBytes ?? nodeRandomBytes,
    );
    presigned = await storage.createPresignedPut({
      objectKey,
      contentType: mimeTypeInput,
      byteSize,
      expiresInSeconds: MEMBER_ASSET_PENDING_SECONDS,
    });
    if (
      presigned.method !== "PUT" ||
      presigned.headers.get("content-length") !== String(byteSize) ||
      presigned.headers.get("content-type") !== mimeTypeInput ||
      parseTimestamp(presigned.expiresAt) === null
    ) {
      return { status: "unavailable" };
    }
  } catch {
    return { status: "unavailable" };
  }

  let rows: AllocationOutcomeRow[];
  try {
    rows = (await sql`
      WITH page_guard AS (
        UPDATE public.member_pages page
        SET
          asset_pending_count = page.asset_pending_count + 1,
          asset_alloc_window_started_at = CASE
            WHEN page.asset_alloc_window_started_at IS NULL
              OR page.asset_alloc_window_started_at <= NOW() - INTERVAL '1 hour'
              THEN NOW()
            ELSE page.asset_alloc_window_started_at
          END,
          asset_alloc_window_count = CASE
            WHEN page.asset_alloc_window_started_at IS NULL
              OR page.asset_alloc_window_started_at <= NOW() - INTERVAL '1 hour'
              THEN 1
            ELSE page.asset_alloc_window_count + 1
          END
        WHERE page.slug = ${authorization.slug}
          AND page.owner_account_id = ${authorization.accountId}
          AND ${presigned.expiresAt} > NOW()
          AND page.asset_pending_count < ${MEMBER_ASSET_PENDING_LIMIT}
          AND (
            page.asset_alloc_window_started_at IS NULL
            OR page.asset_alloc_window_started_at <= NOW() - INTERVAL '1 hour'
            OR page.asset_alloc_window_count < ${MEMBER_ASSET_HOURLY_ALLOCATION_LIMIT}
          )
        RETURNING page.id
      ),
      inserted AS (
        INSERT INTO public.member_page_assets (
          member_page_id,
          object_key,
          pending_expires_at
        )
        SELECT
          page_guard.id,
          ${objectKey},
          ${presigned.expiresAt}
        FROM page_guard
        RETURNING id, pending_expires_at
      )
      SELECT
        'success'::text AS outcome,
        inserted.id AS asset_id,
        inserted.pending_expires_at
      FROM inserted
      UNION ALL
      SELECT
        CASE
          WHEN page.asset_pending_count >= ${MEMBER_ASSET_PENDING_LIMIT}
            THEN 'pending-limit'
          WHEN page.asset_alloc_window_started_at IS NOT NULL
            AND page.asset_alloc_window_started_at > NOW() - INTERVAL '1 hour'
            AND page.asset_alloc_window_count >= ${MEMBER_ASSET_HOURLY_ALLOCATION_LIMIT}
            THEN 'rate-limit'
          ELSE 'conflict'
        END AS outcome,
        NULL::uuid AS asset_id,
        NULL::timestamptz AS pending_expires_at
      FROM public.member_pages page
      WHERE page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
        AND NOT EXISTS (SELECT 1 FROM page_guard)
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1;
    `) as AllocationOutcomeRow[];
  } catch {
    return { status: "unavailable" };
  }
  if (rows.length === 0) return { status: "not-found-or-forbidden" };
  if (rows.length !== 1) return { status: "unavailable" };
  if (rows[0].outcome === "pending-limit") return { status: "pending-limit" };
  if (rows[0].outcome === "rate-limit") return { status: "rate-limit" };
  if (rows[0].outcome !== "success") return { status: "unavailable" };

  const assetId = rows[0].asset_id;
  const pendingExpiresAt = parseTimestamp(rows[0].pending_expires_at);
  if (typeof assetId !== "string" || !isValidUuid(assetId) || !pendingExpiresAt) {
    return { status: "unavailable" };
  }

  if (new Date(pendingExpiresAt).getTime() < presigned.expiresAt.getTime()) {
    return { status: "unavailable" };
  }
  return {
    status: "success",
    data: {
      assetId,
      uploadUrl: presigned.url,
      requiredContentType: mimeTypeInput,
      requiredByteSize: byteSize,
      expiresAt: presigned.expiresAt.toISOString(),
    },
  };
}

function parsePendingAsset(row: PendingAssetRow): {
  id: string;
  objectKey: string;
  pendingExpiresAt: string;
} | null {
  const pendingExpiresAt = parseTimestamp(row.pending_expires_at);
  if (
    typeof row.id !== "string" ||
    !isValidUuid(row.id) ||
    typeof row.object_key !== "string" ||
    !isValidR2ObjectKey(row.object_key) ||
    pendingExpiresAt === null
  ) {
    return null;
  }
  return { id: row.id, objectKey: row.object_key, pendingExpiresAt };
}

function headMatchesVerification(
  head: Awaited<ReturnType<R2StorageAdapter["headObject"]>>,
  metadata: VerifiedMemberAssetMetadata,
): boolean {
  return (
    head.byteSize === metadata.byteSize &&
    head.contentType === metadata.mimeType &&
    head.etag !== null &&
    normalizeR2Etag(head.etag) === metadata.etag
  );
}

function parseReadyMetadata(row: FinalizeOutcomeRow): ReadyMemberAssetMetadata | null {
  const width = parsePositiveInteger(row.width, ASSET_MAX_DIMENSION);
  const height = parsePositiveInteger(row.height, ASSET_MAX_DIMENSION);
  const readyAt = parseTimestamp(row.ready_at);
  const verifiedAt = parseTimestamp(row.verified_at);
  if (
    typeof row.asset_id !== "string" ||
    !isValidUuid(row.asset_id) ||
    typeof row.mime_type !== "string" ||
    !isMemberAssetMimeType(row.mime_type) ||
    width === null ||
    height === null ||
    readyAt === null ||
    verifiedAt === null
  ) {
    return null;
  }
  return {
    assetId: row.asset_id,
    status: "ready",
    mimeType: row.mime_type,
    width,
    height,
    readyAt,
    verifiedAt,
  };
}

export async function finalizeOwnedMemberPageAsset(
  slugInput: unknown,
  assetIdInput: unknown,
  dependencies: MemberAssetDalDependencies = {},
): Promise<MemberAssetFinalizeResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;
  if (typeof assetIdInput !== "string" || !isValidUuid(assetIdInput)) {
    return { status: "invalid" };
  }
  const storage = resolveStorage(dependencies);
  if (!storage) return { status: "unavailable" };

  const sql = getDbClient();
  let pendingRows: PendingAssetRow[];
  try {
    pendingRows = (await sql`
      WITH owned_pending AS MATERIALIZED (
        SELECT
          asset.id,
          asset.object_key,
          asset.pending_expires_at,
          page.id AS member_page_id
        FROM public.member_page_assets asset
        JOIN public.member_pages page ON page.id = asset.member_page_id
        WHERE asset.id = ${assetIdInput}
          AND page.slug = ${authorization.slug}
          AND page.owner_account_id = ${authorization.accountId}
          AND asset.status = 'pending'
          AND asset.deletion_claimed_at IS NULL
          AND asset.pending_expires_at > NOW()
        FOR UPDATE OF page
      ),
      mutation_rate AS (
        INSERT INTO public.member_page_mutation_rate_limits AS mutation_limit (
          member_page_id,
          action,
          window_started_at,
          attempt_count
        )
        SELECT owned_pending.member_page_id, 'asset-finalize', NOW(), 1
        FROM owned_pending
        ON CONFLICT (member_page_id, action) DO UPDATE
        SET
          window_started_at = CASE
            WHEN mutation_limit.window_started_at <= NOW() - (
              ${MEMBER_PAGE_ASSET_FINALIZE_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
            ) THEN NOW()
            ELSE mutation_limit.window_started_at
          END,
          attempt_count = CASE
            WHEN mutation_limit.window_started_at <= NOW() - (
              ${MEMBER_PAGE_ASSET_FINALIZE_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
            ) THEN 1
            ELSE mutation_limit.attempt_count + 1
          END
        WHERE mutation_limit.window_started_at <= NOW() - (
            ${MEMBER_PAGE_ASSET_FINALIZE_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
          )
          OR mutation_limit.attempt_count < ${MEMBER_PAGE_ASSET_FINALIZE_RATE_LIMIT.attempts}
        RETURNING member_page_id
      )
      SELECT
        CASE
          WHEN mutation_rate.member_page_id IS NULL THEN 'rate-limit'
          ELSE 'success'
        END AS outcome,
        owned_pending.id,
        owned_pending.object_key,
        owned_pending.pending_expires_at
      FROM owned_pending
      LEFT JOIN mutation_rate
        ON mutation_rate.member_page_id = owned_pending.member_page_id
      LIMIT 1;
    `) as PendingAssetRow[];
  } catch {
    return { status: "unavailable" };
  }
  if (pendingRows.length === 0) return { status: "not-found-or-forbidden" };
  if (pendingRows.length !== 1) return { status: "unavailable" };
  if (pendingRows[0].outcome === "rate-limit") return { status: "rate-limit" };
  if (
    pendingRows[0].outcome !== undefined &&
    pendingRows[0].outcome !== "success"
  ) {
    return { status: "unavailable" };
  }
  const pending = parsePendingAsset(pendingRows[0]);
  if (!pending) return { status: "unavailable" };

  await cleanupOwnedMemberPageAssets(
    authorization.slug,
    authorization.accountId,
    storage,
  );

  const binding = parseAllocationBinding(pending.objectKey);
  if (!binding) {
    await removeInvalidPendingAsset(
      pending.id,
      authorization.slug,
      authorization.accountId,
      storage,
    );
    return { status: "invalid" };
  }

  const verification = await verifyStoredMemberAsset({
    storage,
    objectKey: pending.objectKey,
    claimedMimeType: binding.claimedMimeType,
    now: dependencies.now,
  });
  if (!verification.success) {
    await removeInvalidPendingAsset(
      pending.id,
      authorization.slug,
      authorization.accountId,
      storage,
    );
    return { status: "invalid", reason: verification.reason.code };
  }
  if (verification.metadata.byteSize !== binding.claimedByteSize) {
    await removeInvalidPendingAsset(
      pending.id,
      authorization.slug,
      authorization.accountId,
      storage,
    );
    return { status: "invalid", reason: "size_mismatch" };
  }

  let finalHead;
  try {
    finalHead = await storage.headObject(pending.objectKey);
  } catch {
    await removeInvalidPendingAsset(
      pending.id,
      authorization.slug,
      authorization.accountId,
      storage,
    );
    return { status: "invalid", reason: "storage_error" };
  }
  if (!headMatchesVerification(finalHead, verification.metadata)) {
    await removeInvalidPendingAsset(
      pending.id,
      authorization.slug,
      authorization.accountId,
      storage,
    );
    return { status: "invalid", reason: "identity_mismatch" };
  }

  let rows: FinalizeOutcomeRow[];
  try {
    rows = (await sql`
      WITH page_guard AS MATERIALIZED (
        SELECT
          page.id,
          page.slug,
          page.owner_account_id,
          page.asset_ready_count
        FROM public.member_pages page
        WHERE page.slug = ${authorization.slug}
          AND page.owner_account_id = ${authorization.accountId}
        FOR UPDATE
      ),
      asset_ready AS (
        UPDATE public.member_page_assets asset
        SET
          status = 'ready',
          mime_type = ${verification.metadata.mimeType},
          byte_size = ${verification.metadata.byteSize},
          width = ${verification.metadata.width},
          height = ${verification.metadata.height},
          etag = ${verification.metadata.etag},
          ready_at = NOW(),
          verified_at = ${verification.metadata.verifiedAt}
        FROM page_guard page
        WHERE asset.id = ${pending.id}
          AND asset.member_page_id = page.id
          AND page.slug = ${authorization.slug}
          AND page.owner_account_id = ${authorization.accountId}
          AND asset.status = 'pending'
          AND asset.deletion_claimed_at IS NULL
          AND asset.pending_expires_at > NOW()
          AND page.asset_ready_count < ${MEMBER_ASSET_READY_LIMIT}
        RETURNING
          asset.id AS asset_id,
          asset.member_page_id,
          asset.mime_type,
          asset.width,
          asset.height,
          asset.ready_at,
          asset.verified_at
      ),
      page_counter AS (
        UPDATE public.member_pages page
        SET
          asset_pending_count = page.asset_pending_count - 1,
          asset_ready_count = page.asset_ready_count + 1
        FROM asset_ready
        WHERE page.id = asset_ready.member_page_id
        RETURNING page.id
      )
      SELECT
        'success'::text AS outcome,
        asset_ready.asset_id,
        asset_ready.mime_type,
        asset_ready.width,
        asset_ready.height,
        asset_ready.ready_at,
        asset_ready.verified_at
      FROM asset_ready
      JOIN page_counter ON page_counter.id = asset_ready.member_page_id
      UNION ALL
      SELECT
        'quota'::text AS outcome,
        NULL::uuid AS asset_id,
        NULL::varchar AS mime_type,
        NULL::integer AS width,
        NULL::integer AS height,
        NULL::timestamptz AS ready_at,
        NULL::timestamptz AS verified_at
      FROM public.member_page_assets asset
      JOIN page_guard page ON page.id = asset.member_page_id
      WHERE asset.id = ${pending.id}
        AND page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
        AND asset.status = 'pending'
        AND asset.deletion_claimed_at IS NULL
        AND asset.pending_expires_at > NOW()
        AND page.asset_ready_count >= ${MEMBER_ASSET_READY_LIMIT}
        AND NOT EXISTS (SELECT 1 FROM asset_ready)
      LIMIT 1;
    `) as FinalizeOutcomeRow[];
  } catch (error) {
    if (classifyMemberAssetDatabaseError(error) === "ready-quota") {
      await removeInvalidPendingAsset(
        pending.id,
        authorization.slug,
        authorization.accountId,
        storage,
      );
      return { status: "quota" };
    }
    // Verification succeeded and the object identity is still valid. A
    // transient or unrelated database failure must leave the pending row and
    // object retryable rather than destroying a valid owner upload.
    return { status: "unavailable" };
  }
  if (rows.length === 0) {
    await removeInvalidPendingAsset(
      pending.id,
      authorization.slug,
      authorization.accountId,
      storage,
    );
    return { status: "conflict" };
  }
  if (rows.length !== 1) return { status: "unavailable" };
  if (rows[0].outcome === "quota") {
    await removeInvalidPendingAsset(
      pending.id,
      authorization.slug,
      authorization.accountId,
      storage,
    );
    return { status: "quota" };
  }
  if (rows[0].outcome !== "success") return { status: "unavailable" };
  const metadata = parseReadyMetadata(rows[0]);
  return metadata
    ? { status: "success", data: metadata }
    : { status: "unavailable" };
}

function parseListedAsset(row: ListedAssetRow): OwnedMemberAssetMetadata | null {
  if (
    typeof row.id !== "string" ||
    !isValidUuid(row.id) ||
    (row.status !== "pending" && row.status !== "ready")
  ) {
    return null;
  }
  const createdAt = parseTimestamp(row.created_at);
  const pendingExpiresAt = parseTimestamp(row.pending_expires_at);
  const readyAt = parseNullableTimestamp(row.ready_at);
  const verifiedAt = parseNullableTimestamp(row.verified_at);
  if (
    createdAt === null ||
    pendingExpiresAt === null ||
    readyAt === undefined ||
    verifiedAt === undefined
  ) {
    return null;
  }
  if (row.status === "pending") {
    if (
      row.mime_type !== null ||
      row.width !== null ||
      row.height !== null ||
      readyAt !== null ||
      verifiedAt !== null
    ) {
      return null;
    }
    return {
      assetId: row.id,
      status: "pending",
      mimeType: null,
      width: null,
      height: null,
      createdAt,
      readyAt: null,
      verifiedAt: null,
      pendingExpiresAt,
    };
  }
  const width = parsePositiveInteger(row.width, ASSET_MAX_DIMENSION);
  const height = parsePositiveInteger(row.height, ASSET_MAX_DIMENSION);
  if (
    typeof row.mime_type !== "string" ||
    !isMemberAssetMimeType(row.mime_type) ||
    width === null ||
    height === null ||
    readyAt === null ||
    verifiedAt === null
  ) {
    return null;
  }
  return {
    assetId: row.id,
    status: "ready",
    mimeType: row.mime_type,
    width,
    height,
    createdAt,
    readyAt,
    verifiedAt,
    pendingExpiresAt,
  };
}

export async function listOwnedMemberPageAssets(
  slugInput: unknown,
  dependencies: MemberAssetDalDependencies = {},
): Promise<OwnedMemberAssetListResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;
  const storage = resolveStorage(dependencies);
  if (!storage) return { status: "unavailable" };
  await cleanupOwnedMemberPageAssets(
    authorization.slug,
    authorization.accountId,
    storage,
  );

  try {
    const sql = getDbClient();
    const rows = (await sql`
      SELECT
        asset.id,
        asset.status,
        asset.mime_type,
        asset.width,
        asset.height,
        asset.created_at,
        asset.ready_at,
        asset.verified_at,
        asset.pending_expires_at
      FROM public.member_page_assets asset
      JOIN public.member_pages page ON page.id = asset.member_page_id
      WHERE page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
        AND asset.deletion_claimed_at IS NULL
      ORDER BY asset.created_at DESC, asset.id DESC;
    `) as ListedAssetRow[];
    const assets = rows.map(parseListedAsset);
    if (assets.some((asset) => asset === null)) return { status: "invalid" };
    return {
      status: "success",
      assets: assets as OwnedMemberAssetMetadata[],
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function deleteOwnedMemberPageAsset(
  slugInput: unknown,
  assetIdInput: unknown,
  dependencies: MemberAssetDalDependencies = {},
): Promise<MemberAssetDeleteResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;
  if (typeof assetIdInput !== "string" || !isValidUuid(assetIdInput)) {
    return { status: "invalid" };
  }
  const storage = resolveStorage(dependencies);
  if (!storage) return { status: "unavailable" };

  let rows: Array<
    CleanupAssetRow & { outcome?: unknown; reference_location?: unknown }
  >;
  try {
    const sql = getDbClient();
    rows = (await sql`
      WITH page_guard AS MATERIALIZED (
        SELECT id, draft_doc, published_doc
        FROM public.member_pages
        WHERE slug = ${authorization.slug}
          AND owner_account_id = ${authorization.accountId}
        FOR UPDATE
      ),
      target AS MATERIALIZED (
        SELECT
          asset.id,
          asset.member_page_id,
          asset.object_key,
          asset.status,
          asset.etag,
          asset.created_at,
          (asset.deletion_claimed_at IS NOT NULL) AS already_claimed,
          (
            jsonb_path_exists(
              page_guard.draft_doc,
              '$.**.assetId ? (@ == $assetId)',
              jsonb_build_object('assetId', to_jsonb(asset.id::text)),
              TRUE
            )
            OR jsonb_path_exists(
              COALESCE(page_guard.published_doc, 'null'::jsonb),
              '$.**.assetId ? (@ == $assetId)',
              jsonb_build_object('assetId', to_jsonb(asset.id::text)),
              TRUE
            )
          ) AS is_referenced,
          jsonb_path_exists(
            page_guard.draft_doc,
            '$.**.assetId ? (@ == $assetId)',
            jsonb_build_object('assetId', to_jsonb(asset.id::text)),
            TRUE
          ) AS referenced_in_draft,
          jsonb_path_exists(
            COALESCE(page_guard.published_doc, 'null'::jsonb),
            '$.**.assetId ? (@ == $assetId)',
            jsonb_build_object('assetId', to_jsonb(asset.id::text)),
            TRUE
          ) AS referenced_in_published
        FROM public.member_page_assets asset
        JOIN page_guard ON page_guard.id = asset.member_page_id
        WHERE asset.id = ${assetIdInput}
        FOR UPDATE OF asset
      ),
      newly_claimed AS (
        UPDATE public.member_page_assets asset
        SET deletion_claimed_at = NOW()
        FROM target
        WHERE asset.id = target.id
          AND NOT target.already_claimed
          AND NOT target.is_referenced
          AND asset.deletion_claimed_at IS NULL
        RETURNING
          asset.id,
          asset.member_page_id,
          asset.object_key,
          asset.status,
          asset.etag,
          asset.created_at
      ),
      page_adjusted AS (
        UPDATE public.member_pages page
        SET asset_pending_count = page.asset_pending_count - CASE
          WHEN newly_claimed.status = 'pending' THEN 1 ELSE 0
        END
        FROM newly_claimed
        WHERE page.id = newly_claimed.member_page_id
        RETURNING page.id
      )
      SELECT
        'success'::text AS outcome,
        NULL::text AS reference_location,
        newly_claimed.id,
        newly_claimed.object_key,
        newly_claimed.status,
        newly_claimed.etag,
        newly_claimed.created_at,
        TRUE AS newly_claimed
      FROM newly_claimed
      JOIN page_adjusted ON page_adjusted.id = newly_claimed.member_page_id
      UNION ALL
      SELECT
        'success'::text AS outcome,
        NULL::text AS reference_location,
        target.id,
        target.object_key,
        target.status,
        target.etag,
        target.created_at,
        FALSE AS newly_claimed
      FROM target
      WHERE target.already_claimed
      UNION ALL
      SELECT
        CASE WHEN target.is_referenced THEN 'referenced' ELSE 'conflict' END AS outcome,
        CASE
          WHEN target.referenced_in_draft AND target.referenced_in_published
            THEN 'both'
          WHEN target.referenced_in_draft THEN 'draft'
          ELSE 'published'
        END AS reference_location,
        NULL::uuid AS id,
        NULL::text AS object_key,
        NULL::varchar AS status,
        NULL::text AS etag,
        NULL::timestamptz AS created_at,
        NULL::boolean AS newly_claimed
      FROM target
      WHERE NOT target.already_claimed
        AND NOT EXISTS (SELECT 1 FROM newly_claimed)
      UNION ALL
      SELECT
        'not-found'::text AS outcome,
        NULL::text AS reference_location,
        NULL::uuid AS id,
        NULL::text AS object_key,
        NULL::varchar AS status,
        NULL::text AS etag,
        NULL::timestamptz AS created_at,
        NULL::boolean AS newly_claimed
      WHERE NOT EXISTS (SELECT 1 FROM target)
      LIMIT 1;
    `) as Array<
      CleanupAssetRow & { outcome?: unknown; reference_location?: unknown }
    >;
  } catch {
    return { status: "unavailable" };
  }
  if (rows.length !== 1) return { status: "unavailable" };
  if (rows[0].outcome === "referenced") {
    return { status: "referenced", location: parseReferenceLocation(rows[0].reference_location) };
  }
  if (rows[0].outcome === "conflict") return { status: "conflict" };
  if (rows[0].outcome === "not-found") {
    return { status: "not-found-or-forbidden" };
  }
  if (rows[0].outcome !== "success") return { status: "unavailable" };
  const asset = parseCleanupRow(rows[0]);
  if (!asset) return { status: "unavailable" };
  if (!(
    await deleteStorageObject(
      storage,
      asset.objectKey,
      asset.newlyClaimed ? asset.etag : null,
    )
  )) {
    return { status: "unavailable" };
  }
  try {
    await deleteClaimedMetadata(asset);
  } catch {
    // R2 deletion already succeeded. The hidden claim and object key remain
    // available for bounded post-expiry cleanup if metadata cleanup is delayed.
  }
  return { status: "success" };
}

function parseServingAsset(row: ServingAssetRow): {
  id: string;
  slug: string;
  ownerAccountId: string;
  objectKey: string;
  mimeType: MemberAssetMimeType;
  byteSize: number;
  width: number;
  height: number;
  etag: string;
  publishedDoc: unknown;
  publicAuthorized: boolean;
} | null {
  const byteSize = parsePositiveInteger(row.byte_size, ASSET_MAX_BYTES);
  const width = parsePositiveInteger(row.width, ASSET_MAX_DIMENSION);
  const height = parsePositiveInteger(row.height, ASSET_MAX_DIMENSION);
  const etag = typeof row.etag === "string" ? normalizeR2Etag(row.etag) : null;
  if (
    typeof row.id !== "string" ||
    !isValidUuid(row.id) ||
    typeof row.slug !== "string" ||
    !isValidMemberSlug(row.slug) ||
    typeof row.owner_account_id !== "string" ||
    !isValidUuid(row.owner_account_id) ||
    typeof row.object_key !== "string" ||
    !isValidR2ObjectKey(row.object_key) ||
    typeof row.mime_type !== "string" ||
    !isMemberAssetMimeType(row.mime_type) ||
    byteSize === null ||
    width === null ||
    height === null ||
    etag === null ||
    typeof row.public_authorized !== "boolean"
  ) {
    return null;
  }
  return {
    id: row.id,
    slug: row.slug,
    ownerAccountId: row.owner_account_id,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    byteSize,
    width,
    height,
    etag,
    publishedDoc: row.published_doc,
    publicAuthorized: row.public_authorized,
  };
}

async function claimServingFailure(assetId: string, etag: string): Promise<void> {
  try {
    const sql = getDbClient();
    await sql`
      UPDATE public.member_page_assets asset
      SET deletion_claimed_at = NOW()
      WHERE asset.id = ${assetId}
        AND asset.status = 'ready'
        AND asset.deletion_claimed_at IS NULL
        AND asset.etag = ${etag}
      RETURNING asset.id;
    `;
  } catch {
    // Serving still fails closed even if the cleanup claim cannot be recorded.
  }
}

function isDefinitiveServingMismatch(error: unknown): boolean {
  return (
    (typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error.status === 404 || error.status === 412)) ||
    (error instanceof Error && error.name === "R2ResponseTooLargeError")
  );
}

export async function readMemberPageAssetForServing(
  assetIdInput: unknown,
  dependencies: MemberAssetDalDependencies = {},
): Promise<MemberAssetServingResult> {
  if (!isDatabaseEnabled()) return { status: "not-found" };
  if (typeof assetIdInput !== "string" || !isValidUuid(assetIdInput)) {
    return { status: "not-found" };
  }

  let rows: ServingAssetRow[];
  try {
    const sql = getDbClient();
    rows = (await sql`
      SELECT
        asset.id,
        page.slug,
        page.owner_account_id,
        asset.object_key,
        asset.mime_type,
        asset.byte_size,
        asset.width,
        asset.height,
        asset.etag,
        page.published_doc,
        (
          page.is_published = TRUE
          AND page.moderation_hold = FALSE
          AND page.published_doc IS NOT NULL
          AND jsonb_path_exists(
            page.published_doc,
            '$.**.assetId ? (@ == $assetId)',
            jsonb_build_object('assetId', to_jsonb(asset.id::text)),
            TRUE
          )
        ) AS public_authorized
      FROM public.member_page_assets asset
      JOIN public.member_pages page ON page.id = asset.member_page_id
      WHERE asset.id = ${assetIdInput}
        AND asset.status = 'ready'
        AND asset.deletion_claimed_at IS NULL
      LIMIT 1;
    `) as ServingAssetRow[];
  } catch {
    return { status: "unavailable" };
  }
  if (rows.length === 0) return { status: "not-found" };
  if (rows.length !== 1) return { status: "unavailable" };
  const asset = parseServingAsset(rows[0]);
  if (!asset) return { status: "not-found" };

  const publishedDocument = asset.publicAuthorized
    ? parseMemberPageDocumentV2(asset.publishedDoc)
    : null;
  const isValidPublicReference =
    publishedDocument?.success === true &&
    extractMemberPageAssetIds(publishedDocument.doc).includes(asset.id);

  let visibility: "public" | "private";
  if (isValidPublicReference) {
    visibility = "public";
  } else {
    let account;
    try {
      account = await getCurrentVerifiedAccount();
    } catch {
      return { status: "not-found" };
    }
    if (!account || account.id !== asset.ownerAccountId) {
      return { status: "not-found" };
    }
    try {
      if (!isMemberPageV2EditorEnabled(asset.slug)) {
        return { status: "not-found" };
      }
    } catch {
      return { status: "not-found" };
    }
    visibility = "private";
  }

  const storage = resolveStorage(dependencies);
  if (!storage) return { status: "unavailable" };
  let object;
  try {
    object = await storage.getObject(asset.objectKey, asset.byteSize, {
      ifMatch: asset.etag,
    });
  } catch (error) {
    if (isDefinitiveServingMismatch(error)) {
      await claimServingFailure(asset.id, asset.etag);
      return { status: "not-found" };
    }
    return { status: "unavailable" };
  }
  if (
    object.etag === null ||
    normalizeR2Etag(object.etag) !== asset.etag ||
    object.contentType !== asset.mimeType ||
    object.byteSize !== asset.byteSize ||
    object.bytes.byteLength !== asset.byteSize
  ) {
    await claimServingFailure(asset.id, asset.etag);
    return { status: "not-found" };
  }
  return {
    status: "success",
    visibility,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    width: asset.width,
    height: asset.height,
    etag: asset.etag,
    bytes: object.bytes,
  };
}

export async function getPublicMemberPageAssetMetadata(
  slugInput: unknown,
  assetIdsInput: readonly string[],
): Promise<PublicMemberAssetMetadataResult> {
  const empty = new Map<string, PublicMemberAssetMetadata>();
  if (!isDatabaseEnabled()) return { status: "unavailable" };
  const slug = validateMemberSlug(slugInput);
  if (!slug || !Array.isArray(assetIdsInput)) return { status: "invalid" };
  const assetIds = [...new Set(assetIdsInput)];
  if (assetIds.some((assetId) => !isValidUuid(assetId))) {
    return { status: "invalid" };
  }
  if (assetIds.length === 0) {
    return { status: "success", metadata: empty, degradedAssetIds: new Set() };
  }
  const requested = new Set(assetIds);

  let rows: MetadataAssetRow[];
  try {
    const sql = getDbClient();
    rows = (await sql`
      SELECT asset.id, asset.mime_type, asset.width, asset.height
      FROM public.member_page_assets asset
      JOIN public.member_pages page ON page.id = asset.member_page_id
      JOIN jsonb_array_elements_text(${JSON.stringify(assetIds)}::jsonb) requested(asset_id)
        ON asset.id::text = requested.asset_id
      WHERE page.slug = ${slug}
        AND page.is_published = TRUE
        AND page.moderation_hold = FALSE
        AND asset.status = 'ready'
        AND asset.deletion_claimed_at IS NULL
        AND jsonb_path_exists(
          page.published_doc,
          '$.**.assetId ? (@ == $assetId)',
          jsonb_build_object('assetId', to_jsonb(asset.id::text)),
          TRUE
        );
    `) as MetadataAssetRow[];
  } catch {
    return { status: "unavailable" };
  }

  // Missing and deletion-claimed assets simply produce no row; the degrade set
  // below covers them. Rows that exist but carry unusable metadata degrade
  // only when the corruption is attributable to one requested asset ID.
  const metadata = new Map<string, PublicMemberAssetMetadata>();
  for (const row of rows) {
    if (
      typeof row.id !== "string" ||
      !isValidUuid(row.id) ||
      !requested.has(row.id)
    ) {
      // Corruption that cannot be attributed to a requested asset is stored
      // state, not one broken medium: fail closed instead of degrading.
      return { status: "invalid" };
    }
    const width = parsePositiveInteger(row.width, ASSET_MAX_DIMENSION);
    const height = parsePositiveInteger(row.height, ASSET_MAX_DIMENSION);
    if (
      typeof row.mime_type !== "string" ||
      !isMemberAssetMimeType(row.mime_type) ||
      width === null ||
      height === null
    ) {
      continue;
    }
    metadata.set(row.id, { width, height, mimeType: row.mime_type });
  }

  const degradedAssetIds = new Set<string>();
  for (const assetId of assetIds) {
    if (metadata.has(assetId)) continue;
    degradedAssetIds.add(assetId);
    if (degradedAssetIds.size >= MEMBER_ASSET_PUBLIC_METADATA_DEGRADED_LIMIT) {
      // The bound protects process memory only. Rendering never depends on the
      // set: every asset outside `metadata` degrades regardless.
      break;
    }
  }
  return { status: "success", metadata, degradedAssetIds };
}

export const allocateMemberPageAssetUpload = allocateOwnedMemberPageAsset;
export const finalizeMemberPageAssetUpload = finalizeOwnedMemberPageAsset;
export const listMemberPageAssetsForOwner = listOwnedMemberPageAssets;
export const deleteMemberPageAssetForOwner = deleteOwnedMemberPageAsset;
export const getPublishedMemberPageAssetMetadata =
  getPublicMemberPageAssetMetadata;
