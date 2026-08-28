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
import { classifyThemeAccentPairForWrite } from "@/lib/members/v2/themes";
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
  | { status: "conflict" }
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

/**
 * Canonical shape of the opaque publication token: UTC ISO-8601 with a
 * one-to-six-digit fraction. The issued form always carries the full six
 * digits (e.g. `2026-08-20T09:00:00.123456Z`); shorter fractions are accepted
 * verbatim for tokens issued before the precision fix.
 */
const PUBLICATION_TOKEN_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(\.\d{1,6})?Z$/u;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isRealCalendarDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  let days = DAYS_IN_MONTH[month - 1];
  if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) {
    days = 29;
  }
  return day <= days;
}

/**
 * Validates a publication token without reinterpreting it.
 *
 * The token is an opaque server-issued value that must preserve the full
 * Postgres `timestamptz` precision (microseconds) from its issuing query,
 * across the editor, and back through the unpublish guard. It is therefore
 * passed through verbatim: normalizing it through a JavaScript `Date` would
 * truncate the fraction to milliseconds and make the guard reject the very
 * generation it just issued. Calendar validity is checked exactly rather than
 * with a `Date` probe, because `Date` parsing silently rolls impossible days
 * (e.g. `2026-02-30`) forward instead of rejecting them, and Postgres' cast
 * would throw instead of failing closed as `invalid`.
 */
export function parsePublicationToken(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const match = PUBLICATION_TOKEN_PATTERN.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return isRealCalendarDay(Number(year), Number(month), Number(day))
    ? value
    : undefined;
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
  // The publication token is projected as text in SQL (see the draft read)
  // and must keep its full precision; it is the unpublish guard's identity
  // for the loaded publication generation.
  const publishedAt = parsePublicationToken(row.published_at);
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
      to_char(
        published_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS published_at,
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

  // Write-boundary acceptance, deliberately narrower than the read/render
  // acceptance above: an active pair may be newly selected; a legacy pair may
  // be autosaved only when it exactly equals the pair already stored on the
  // draft (enforced inside the guarded statement below, so the check stays
  // atomic with the write and cannot race a concurrent autosave); revoked or
  // unknown pairs never reach a write.
  const themeWrite = classifyThemeAccentPairForWrite(
    document.doc.frame.theme.id,
    document.doc.frame.theme.accentId,
  );
  if (themeWrite.kind === "rejected") return { status: "invalid" };
  const themePairJson = JSON.stringify({
    id: document.doc.frame.theme.id,
    accentId: document.doc.frame.theme.accentId,
  });

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
      SELECT page.id, page.draft_doc, page.draft_rev
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
        AND (
          ${themeWrite.kind}::text = 'selectable'
          OR page.draft_doc->'frame'->'theme' IS NOT DISTINCT FROM ${themePairJson}::jsonb
        )
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
        WHEN ${themeWrite.kind}::text <> 'selectable'
          AND target.draft_doc->'frame'->'theme' IS DISTINCT FROM ${themePairJson}::jsonb
          THEN 'invalid'
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
      to_char(
        updated.published_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS published_at
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
      NULL::text AS published_at
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
  // Issued as SQL text above so the token carries the full stored precision;
  // a JS Date here would truncate microseconds and break the guarded
  // unpublish of this very generation.
  const publishedAt = parsePublicationToken(rows[0].published_at);
  if (
    rows[0].slug !== authorization.slug ||
    publishedDraftRev === null ||
    publishedAt === null ||
    publishedAt === undefined
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

/**
 * Rejects unpublish intent that observed an older publication generation.
 *
 * The publication generation is the row's server-issued `published_at`
 * instant, presented as the opaque publication token (the canonical UTC text
 * form issued by this module, which preserves the stored microseconds); only
 * an owner publish advances it. The editor presents the token it loaded (or
 * null for a page never published), and a mismatch returns `conflict` without
 * touching `is_published`, `draft_doc`, or `published_doc`. `draft_rev` is
 * deliberately absent from the guard: a private draft autosave must never
 * block an unpublish.
 */
export async function unpublishOwnedMemberPageV2(
  slugInput: unknown,
  expectedPublishedAtInput: unknown,
): Promise<MemberPageV2UnpublishResult> {
  const authorization = await authorizeEditorRequest(slugInput);
  if (authorization.status !== "success") return authorization;

  const expectedPublishedAt = parsePublicationToken(expectedPublishedAtInput);
  if (expectedPublishedAt === undefined) return { status: "invalid" };

  const sql = getDbClient();
  const rows = (await sql`
    WITH target AS MATERIALIZED (
      SELECT id
      FROM public.member_pages
      WHERE slug = ${authorization.slug}
        AND owner_account_id = ${authorization.accountId}
      FOR UPDATE
    ),
    updated AS (
      UPDATE public.member_pages page
      SET
        is_published = FALSE,
        unpublished_at = CASE
          WHEN page.is_published THEN NOW()
          ELSE COALESCE(page.unpublished_at, NOW())
        END,
        updated_at = NOW()
      FROM target
      WHERE page.id = target.id
        AND page.slug = ${authorization.slug}
        AND page.owner_account_id = ${authorization.accountId}
        AND page.published_at IS NOT DISTINCT FROM ${expectedPublishedAt}::timestamptz
      RETURNING page.slug, page.unpublished_at
    )
    SELECT
      'success'::text AS outcome,
      updated.slug,
      updated.unpublished_at
    FROM updated
    UNION ALL
    SELECT
      'conflict'::text AS outcome,
      NULL::text AS slug,
      NULL::timestamptz AS unpublished_at
    FROM target
    WHERE NOT EXISTS (SELECT 1 FROM updated)
    LIMIT 1;
  `) as OutcomeRow[];
  if (rows.length === 0) return { status: "not-found-or-forbidden" };
  if (rows.length !== 1) return { status: "invalid" };
  if (rows[0].outcome === "conflict") return { status: "conflict" };
  if (rows[0].outcome !== "success") return { status: "invalid" };

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
