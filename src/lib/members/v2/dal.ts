import "server-only";

import { getAuthMode } from "@/lib/auth/config";
import { isValidUuid } from "@/lib/auth/crypto";
import { getDbClient } from "@/lib/auth/db";
import { getCurrentVerifiedAccount } from "@/lib/auth/session";
import { isValidMemberSlug } from "@/lib/members/model";
import { validateMemberSlug } from "@/lib/members/validation";
import { extractMemberPageAssetIds } from "@/lib/members/v2/asset-references";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import { isMemberPageV2EditorEnabled } from "@/lib/members/v2/feature-flag";
import {
  MEMBER_PAGE_AUTOSAVE_RATE_LIMIT,
  MEMBER_PAGE_PUBLISH_RATE_LIMIT,
} from "@/lib/members/v2/rate-limits";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";

interface OwnedDraftRow {
  id: unknown;
  slug: unknown;
  draft_doc: unknown;
  draft_rev: unknown;
  is_published: unknown;
  moderation_hold: unknown;
  has_published_snapshot: unknown;
  draft_updated_at: unknown;
  published_at: unknown;
  unpublished_at: unknown;
}

interface DraftForTransitionRow {
  outcome?: unknown;
  draft_doc: unknown;
  draft_rev: unknown;
  moderation_hold?: unknown;
}

interface PublishedForResetRow {
  published_doc: unknown;
  draft_rev: unknown;
}

interface OutcomeRow {
  outcome: unknown;
  slug?: unknown;
  draft_doc?: unknown;
  draft_rev?: unknown;
  draft_updated_at?: unknown;
  published_at?: unknown;
  unpublished_at?: unknown;
}

export interface OwnedMemberPageDraftV2 {
  pageId: string;
  slug: string;
  draft: MemberPageDocumentV2;
  draftRev: number;
  isPublished: boolean;
  moderationHold: boolean;
  hasPublishedSnapshot: boolean;
  draftUpdatedAt: string;
  publishedAt: string | null;
  unpublishedAt: string | null;
}

export interface PublishedMemberPageV2 {
  slug: string;
  document: MemberPageDocumentV2;
}

export type MemberPageV2ReadResult<T> =
  | { status: "success"; data: T }
  | { status: "not-found-or-forbidden" }
  | { status: "invalid" };

export type MemberPageV2AutosaveResult =
  | {
      status: "success";
      draftRev: number;
      draftUpdatedAt: string;
    }
  | { status: "not-found-or-forbidden" }
  | { status: "rate-limit" }
  | { status: "conflict" }
  | { status: "invalid" };

export type MemberPageV2PublishResult =
  | {
      status: "success";
      slug: string;
      draftRev: number;
      publishedAt: string;
    }
  | { status: "not-found-or-forbidden" }
  | { status: "rate-limit" }
  | { status: "conflict" }
  | { status: "hold" }
  | { status: "invalid" };

export type MemberPageV2UnpublishResult =
  | {
      status: "success";
      slug: string;
      unpublishedAt: string;
    }
  | { status: "not-found-or-forbidden" }
  | { status: "invalid" };

export type MemberPageV2ResetResult =
  | {
      status: "success";
      draft: MemberPageDocumentV2;
      draftRev: number;
      draftUpdatedAt: string;
    }
  | { status: "not-found-or-forbidden" }
  | { status: "conflict" }
  | { status: "no-snapshot" }
  | { status: "invalid" };

function isMemberStorageEnabled(): boolean {
  try {
    return getAuthMode() !== "disabled";
  } catch {
    return false;
  }
}

function parseRevision(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseExpectedRevision(value: unknown): number | null {
  return parseRevision(value);
}

function parseTimestamp(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseNullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return parseTimestamp(value) ?? undefined;
}

async function authorizeEditorRequest(slugInput: unknown): Promise<
  | { status: "success"; slug: string; accountId: string }
  | { status: "not-found-or-forbidden" }
  | { status: "invalid" }
> {
  const account = await getCurrentVerifiedAccount();
  if (!account) return { status: "not-found-or-forbidden" };

  const slug = validateMemberSlug(slugInput);
  if (!slug) return { status: "invalid" };
  if (!isMemberPageV2EditorEnabled(slug)) {
    return { status: "not-found-or-forbidden" };
  }
  return { status: "success", slug, accountId: account.id };
}

function parseOwnedDraft(row: OwnedDraftRow): OwnedMemberPageDraftV2 | null {
  const draft = parseMemberPageDocumentV2(row.draft_doc);
  const draftRev = parseRevision(row.draft_rev);
  const draftUpdatedAt = parseTimestamp(row.draft_updated_at);
  const publishedAt = parseNullableTimestamp(row.published_at);
  const unpublishedAt = parseNullableTimestamp(row.unpublished_at);
  if (
    typeof row.id !== "string" ||
    !isValidUuid(row.id) ||
    typeof row.slug !== "string" ||
    !isValidMemberSlug(row.slug) ||
    !draft.success ||
    draftRev === null ||
    typeof row.is_published !== "boolean" ||
    typeof row.moderation_hold !== "boolean" ||
    typeof row.has_published_snapshot !== "boolean" ||
    draftUpdatedAt === null ||
    publishedAt === undefined ||
    unpublishedAt === undefined
  ) {
    return null;
  }

  return {
    pageId: row.id,
    slug: row.slug,
    draft: draft.doc,
    draftRev,
    isPublished: row.is_published,
    moderationHold: row.moderation_hold,
    hasPublishedSnapshot: row.has_published_snapshot,
    draftUpdatedAt,
    publishedAt,
    unpublishedAt,
  };
}

export async function getPublishedMemberPageV2(
  slugInput: unknown,
): Promise<MemberPageV2ReadResult<PublishedMemberPageV2>> {
  if (!isMemberStorageEnabled()) return { status: "not-found-or-forbidden" };
  const slug = validateMemberSlug(slugInput);
  if (!slug) return { status: "invalid" };

  const sql = getDbClient();
  const rows = (await sql`
    SELECT slug, published_doc
    FROM public.member_pages
    WHERE slug = ${slug}
      AND is_published = TRUE
      AND moderation_hold = FALSE
    LIMIT 1;
  `) as Array<{ slug: unknown; published_doc: unknown }>;
  if (rows.length === 0) return { status: "not-found-or-forbidden" };
  if (rows.length !== 1) return { status: "invalid" };

  const row = rows[0];
  const document = parseMemberPageDocumentV2(row.published_doc);
  if (
    typeof row.slug !== "string" ||
    !isValidMemberSlug(row.slug) ||
    !document.success
  ) {
    return { status: "invalid" };
  }
  return {
    status: "success",
    data: { slug: row.slug, document: document.doc },
  };
}

export async function getOwnedMemberPageDraftV2(
  slugInput: unknown,
): Promise<MemberPageV2ReadResult<OwnedMemberPageDraftV2>> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;

  const sql = getDbClient();
  const rows = (await sql`
    SELECT
      id,
      slug,
      draft_doc,
      draft_rev,
      is_published,
      moderation_hold,
      (published_doc IS NOT NULL) AS has_published_snapshot,
      draft_updated_at,
      published_at,
      unpublished_at
    FROM public.member_pages
    WHERE slug = ${authorization.slug}
      AND owner_account_id = ${authorization.accountId}
    LIMIT 1;
  `) as OwnedDraftRow[];
  if (rows.length === 0) return { status: "not-found-or-forbidden" };
  if (rows.length !== 1) return { status: "invalid" };

  const draft = parseOwnedDraft(rows[0]);
  return draft
    ? { status: "success", data: draft }
    : { status: "invalid" };
}

export async function autosaveOwnedMemberPageDraftV2(
  slugInput: unknown,
  expectedDraftRevInput: unknown,
  documentInput: unknown,
): Promise<MemberPageV2AutosaveResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;

  const expectedDraftRev = parseExpectedRevision(expectedDraftRevInput);
  const document = parseMemberPageDocumentV2(documentInput);
  if (expectedDraftRev === null || !document.success) {
    return { status: "invalid" };
  }

  const assetIds = extractMemberPageAssetIds(document.doc);
  const assetIdsJson = JSON.stringify(assetIds);
  const sql = getDbClient();
  const rows = (await sql`
    WITH owned_page AS MATERIALIZED (
      SELECT page.id, page.draft_rev
      FROM public.member_pages page
      WHERE page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
      FOR UPDATE OF page
    ),
    mutation_rate AS (
      INSERT INTO public.member_page_mutation_rate_limits AS mutation_limit (
        member_page_id,
        action,
        window_started_at,
        attempt_count
      )
      SELECT owned_page.id, 'autosave', NOW(), 1
      FROM owned_page
      ON CONFLICT (member_page_id, action) DO UPDATE
      SET
        window_started_at = CASE
          WHEN mutation_limit.window_started_at <= NOW() - (
            ${MEMBER_PAGE_AUTOSAVE_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
          ) THEN NOW()
          ELSE mutation_limit.window_started_at
        END,
        attempt_count = CASE
          WHEN mutation_limit.window_started_at <= NOW() - (
            ${MEMBER_PAGE_AUTOSAVE_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
          ) THEN 1
          ELSE mutation_limit.attempt_count + 1
        END
      WHERE mutation_limit.window_started_at <= NOW() - (
          ${MEMBER_PAGE_AUTOSAVE_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
        )
        OR mutation_limit.attempt_count < ${MEMBER_PAGE_AUTOSAVE_RATE_LIMIT.attempts}
      RETURNING member_page_id
    ),
    target AS MATERIALIZED (
      SELECT page.id, page.draft_rev
      FROM public.member_pages page
      JOIN owned_page ON owned_page.id = page.id
      JOIN mutation_rate ON mutation_rate.member_page_id = page.id
      WHERE page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
      FOR UPDATE OF page
    ),
    matched_assets AS MATERIALIZED (
      SELECT asset.id
      FROM public.member_page_assets asset
      JOIN target ON target.id = asset.member_page_id
      JOIN jsonb_array_elements_text(${assetIdsJson}::jsonb) reference(asset_id)
        ON asset.id::text = reference.asset_id
      WHERE asset.status = 'ready'
        AND asset.deletion_claimed_at IS NULL
      FOR SHARE OF asset
    ),
    updated AS (
      UPDATE public.member_pages page
      SET
        draft_doc = ${document.doc},
        draft_rev = page.draft_rev + 1,
        draft_updated_at = NOW(),
        updated_at = NOW()
      FROM target
      WHERE page.id = target.id
        AND page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
        AND page.draft_rev = ${expectedDraftRev}
        AND (SELECT COUNT(*) FROM matched_assets) = ${assetIds.length}
      RETURNING page.draft_rev, page.draft_updated_at
    )
    SELECT
      'success'::text AS outcome,
      updated.draft_rev,
      updated.draft_updated_at
    FROM updated
    UNION ALL
    SELECT
      CASE
        WHEN target.draft_rev <> ${expectedDraftRev} THEN 'conflict'
        WHEN (SELECT COUNT(*) FROM matched_assets) <> ${assetIds.length}
          THEN 'invalid'
        ELSE 'conflict'
      END AS outcome,
      target.draft_rev,
      NULL::timestamptz AS draft_updated_at
    FROM target
    WHERE NOT EXISTS (SELECT 1 FROM updated)
    UNION ALL
    SELECT
      'rate-limit'::text AS outcome,
      owned_page.draft_rev,
      NULL::timestamptz AS draft_updated_at
    FROM owned_page
    WHERE NOT EXISTS (SELECT 1 FROM mutation_rate)
    LIMIT 1;
  `) as OutcomeRow[];
  if (rows.length === 0) return { status: "not-found-or-forbidden" };
  if (rows.length !== 1) return { status: "invalid" };
  if (rows[0].outcome === "rate-limit") return { status: "rate-limit" };
  if (rows[0].outcome === "conflict") return { status: "conflict" };
  if (rows[0].outcome !== "success") return { status: "invalid" };

  const draftRev = parseRevision(rows[0].draft_rev);
  const draftUpdatedAt = parseTimestamp(rows[0].draft_updated_at);
  if (draftRev === null || draftUpdatedAt === null) {
    return { status: "invalid" };
  }
  return { status: "success", draftRev, draftUpdatedAt };
}

export async function publishOwnedMemberPageV2(
  slugInput: unknown,
  expectedDraftRevInput: unknown,
): Promise<MemberPageV2PublishResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;

  const expectedDraftRev = parseExpectedRevision(expectedDraftRevInput);
  if (expectedDraftRev === null) return { status: "invalid" };

  const sql = getDbClient();
  const draftRows = (await sql`
    WITH owned_page AS MATERIALIZED (
      SELECT page.id, page.draft_doc, page.draft_rev, page.moderation_hold
      FROM public.member_pages page
      WHERE page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
      FOR UPDATE OF page
    ),
    mutation_rate AS (
      INSERT INTO public.member_page_mutation_rate_limits AS mutation_limit (
        member_page_id,
        action,
        window_started_at,
        attempt_count
      )
      SELECT owned_page.id, 'publish', NOW(), 1
      FROM owned_page
      ON CONFLICT (member_page_id, action) DO UPDATE
      SET
        window_started_at = CASE
          WHEN mutation_limit.window_started_at <= NOW() - (
            ${MEMBER_PAGE_PUBLISH_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
          ) THEN NOW()
          ELSE mutation_limit.window_started_at
        END,
        attempt_count = CASE
          WHEN mutation_limit.window_started_at <= NOW() - (
            ${MEMBER_PAGE_PUBLISH_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
          ) THEN 1
          ELSE mutation_limit.attempt_count + 1
        END
      WHERE mutation_limit.window_started_at <= NOW() - (
          ${MEMBER_PAGE_PUBLISH_RATE_LIMIT.windowSeconds} * INTERVAL '1 second'
        )
        OR mutation_limit.attempt_count < ${MEMBER_PAGE_PUBLISH_RATE_LIMIT.attempts}
      RETURNING member_page_id
    )
    SELECT
      CASE
        WHEN mutation_rate.member_page_id IS NULL THEN 'rate-limit'
        ELSE 'success'
      END AS outcome,
      owned_page.draft_doc,
      owned_page.draft_rev,
      owned_page.moderation_hold
    FROM owned_page
    LEFT JOIN mutation_rate ON mutation_rate.member_page_id = owned_page.id
    LIMIT 1;
  `) as DraftForTransitionRow[];
  if (draftRows.length === 0) return { status: "not-found-or-forbidden" };
  if (draftRows.length !== 1) return { status: "invalid" };

  const draftRow = draftRows[0];
  if (draftRow.outcome === "rate-limit") return { status: "rate-limit" };
  if (draftRow.outcome !== undefined && draftRow.outcome !== "success") {
    return { status: "invalid" };
  }
  const draftRev = parseRevision(draftRow.draft_rev);
  const document = parseMemberPageDocumentV2(draftRow.draft_doc);
  if (
    draftRev === null ||
    typeof draftRow.moderation_hold !== "boolean" ||
    !document.success
  ) {
    return { status: "invalid" };
  }
  if (draftRev !== expectedDraftRev) return { status: "conflict" };
  if (draftRow.moderation_hold) return { status: "hold" };

  const assetIds = extractMemberPageAssetIds(document.doc);
  const assetIdsJson = JSON.stringify(assetIds);
  const rows = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, draft_doc, draft_rev, moderation_hold
      FROM public.member_pages
      WHERE slug = ${authorization.slug}
        AND owner_account_id = ${authorization.accountId}
      FOR UPDATE
    ),
    matched_assets AS MATERIALIZED (
      SELECT asset.id
      FROM public.member_page_assets asset
      JOIN target ON target.id = asset.member_page_id
      JOIN jsonb_array_elements_text(${assetIdsJson}::jsonb) reference(asset_id)
        ON asset.id::text = reference.asset_id
      WHERE asset.status = 'ready'
        AND asset.deletion_claimed_at IS NULL
      FOR SHARE OF asset
    ),
    updated AS (
      UPDATE public.member_pages page
      SET
        published_doc = page.draft_doc,
        display_name = ${document.doc.frame.displayName},
        blurb = ${document.doc.frame.summary},
        is_published = TRUE,
        published_at = NOW(),
        unpublished_at = NULL,
        updated_at = NOW()
      FROM target
      WHERE page.id = target.id
        AND page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
        AND page.draft_rev = ${expectedDraftRev}
        AND page.draft_doc = ${document.doc}
        AND page.moderation_hold = FALSE
        AND (SELECT COUNT(*) FROM matched_assets) = ${assetIds.length}
      RETURNING page.slug, page.draft_rev, page.published_at
    )
    SELECT
      'success'::text AS outcome,
      updated.slug,
      updated.draft_rev,
      updated.published_at
    FROM updated
    UNION ALL
    SELECT
      CASE
        WHEN target.draft_rev <> ${expectedDraftRev}
          OR target.draft_doc <> ${document.doc}
          THEN 'conflict'
        WHEN target.moderation_hold THEN 'hold'
        WHEN (SELECT COUNT(*) FROM matched_assets) <> ${assetIds.length}
          THEN 'invalid'
        ELSE 'conflict'
      END AS outcome,
      NULL::text AS slug,
      target.draft_rev,
      NULL::timestamptz AS published_at
    FROM target
    WHERE NOT EXISTS (SELECT 1 FROM updated)
    LIMIT 1;
  `) as OutcomeRow[];
  if (rows.length === 0) return { status: "not-found-or-forbidden" };
  if (rows.length !== 1) return { status: "invalid" };
  if (rows[0].outcome === "conflict") return { status: "conflict" };
  if (rows[0].outcome === "hold") return { status: "hold" };
  if (rows[0].outcome === "invalid") return { status: "invalid" };
  if (rows[0].outcome !== "success") return { status: "invalid" };

  const publishedDraftRev = parseRevision(rows[0].draft_rev);
  const publishedAt = parseTimestamp(rows[0].published_at);
  if (
    rows[0].slug !== authorization.slug ||
    publishedDraftRev === null ||
    publishedAt === null
  ) {
    return { status: "invalid" };
  }
  return {
    status: "success",
    slug: authorization.slug,
    draftRev: publishedDraftRev,
    publishedAt,
  };
}

export async function unpublishOwnedMemberPageV2(
  slugInput: unknown,
): Promise<MemberPageV2UnpublishResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;

  const sql = getDbClient();
  const rows = (await sql`
    UPDATE public.member_pages
    SET
      is_published = FALSE,
      unpublished_at = CASE
        WHEN is_published THEN NOW()
        ELSE COALESCE(unpublished_at, NOW())
      END,
      updated_at = NOW()
    WHERE slug = ${authorization.slug}
      AND owner_account_id = ${authorization.accountId}
    RETURNING slug, unpublished_at;
  `) as OutcomeRow[];
  if (rows.length === 0) return { status: "not-found-or-forbidden" };
  if (rows.length !== 1) return { status: "invalid" };

  const unpublishedAt = parseTimestamp(rows[0].unpublished_at);
  if (rows[0].slug !== authorization.slug || unpublishedAt === null) {
    return { status: "invalid" };
  }
  return { status: "success", slug: authorization.slug, unpublishedAt };
}

export async function resetOwnedMemberPageDraftV2(
  slugInput: unknown,
  expectedDraftRevInput: unknown,
): Promise<MemberPageV2ResetResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;

  const expectedDraftRev = parseExpectedRevision(expectedDraftRevInput);
  if (expectedDraftRev === null) return { status: "invalid" };

  const sql = getDbClient();
  const snapshotRows = (await sql`
    SELECT published_doc, draft_rev
    FROM public.member_pages
    WHERE slug = ${authorization.slug}
      AND owner_account_id = ${authorization.accountId}
    LIMIT 1;
  `) as PublishedForResetRow[];
  if (snapshotRows.length === 0) return { status: "not-found-or-forbidden" };
  if (snapshotRows.length !== 1) return { status: "invalid" };

  const snapshotRow = snapshotRows[0];
  const draftRev = parseRevision(snapshotRow.draft_rev);
  if (draftRev === null) return { status: "invalid" };
  if (draftRev !== expectedDraftRev) return { status: "conflict" };
  if (snapshotRow.published_doc === null) return { status: "no-snapshot" };

  const publishedDocument = parseMemberPageDocumentV2(snapshotRow.published_doc);
  if (!publishedDocument.success) return { status: "invalid" };

  const rows = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id, draft_rev, published_doc
      FROM public.member_pages
      WHERE slug = ${authorization.slug}
        AND owner_account_id = ${authorization.accountId}
    ),
    updated AS (
      UPDATE public.member_pages page
      SET
        draft_doc = page.published_doc,
        draft_rev = page.draft_rev + 1,
        draft_updated_at = NOW(),
        updated_at = NOW()
      FROM target
      WHERE page.id = target.id
        AND page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
        AND page.draft_rev = ${expectedDraftRev}
        AND page.published_doc = ${publishedDocument.doc}
        AND page.published_doc IS NOT NULL
      RETURNING page.draft_doc, page.draft_rev, page.draft_updated_at
    )
    SELECT
      'success'::text AS outcome,
      updated.draft_doc,
      updated.draft_rev,
      updated.draft_updated_at
    FROM updated
    UNION ALL
    SELECT
      CASE
        WHEN target.draft_rev <> ${expectedDraftRev} THEN 'conflict'
        WHEN target.published_doc IS NULL THEN 'no-snapshot'
        WHEN target.published_doc <> ${publishedDocument.doc} THEN 'conflict'
        ELSE 'conflict'
      END AS outcome,
      NULL::jsonb AS draft_doc,
      target.draft_rev,
      NULL::timestamptz AS draft_updated_at
    FROM target
    WHERE NOT EXISTS (SELECT 1 FROM updated)
    LIMIT 1;
  `) as OutcomeRow[];
  if (rows.length === 0) return { status: "not-found-or-forbidden" };
  if (rows.length !== 1) return { status: "invalid" };
  if (rows[0].outcome === "conflict") return { status: "conflict" };
  if (rows[0].outcome === "no-snapshot") return { status: "no-snapshot" };
  if (rows[0].outcome !== "success") return { status: "invalid" };

  const resetDocument = parseMemberPageDocumentV2(rows[0].draft_doc);
  const resetDraftRev = parseRevision(rows[0].draft_rev);
  const draftUpdatedAt = parseTimestamp(rows[0].draft_updated_at);
  if (!resetDocument.success || resetDraftRev === null || draftUpdatedAt === null) {
    return { status: "invalid" };
  }
  return {
    status: "success",
    draft: resetDocument.doc,
    draftRev: resetDraftRev,
    draftUpdatedAt,
  };
}
