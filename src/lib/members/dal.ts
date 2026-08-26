import "server-only";

import { cache } from "react";

import { getAuthMode } from "@/lib/auth/config";
import { getDbClient } from "@/lib/auth/db";
import { isValidUuid } from "@/lib/auth/crypto";
import { getCurrentVerifiedAccount } from "@/lib/auth/session";
import {
  isValidMemberSlug,
  type MemberDirectoryItem,
  type MemberPublicPage,
} from "@/lib/members/model";
import {
  validateMemberContent,
  validateMemberSlug,
  type MemberContentInput,
  type MemberFieldErrors,
} from "@/lib/members/validation";
import { isMemberPageV2Cohort } from "@/lib/members/v2/feature-flag";
import { legacyToDoc } from "@/lib/members/v2/legacy-to-doc";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";

interface MemberPageRow {
  slug: unknown;
  display_name: unknown;
  blurb: unknown;
  website_url: unknown;
  social_links: unknown;
  showcase: unknown;
  owner_account_id?: unknown;
  is_published?: unknown;
  moderation_hold?: unknown;
}

interface DirectoryRow {
  slug: unknown;
  display_name: unknown;
  blurb: unknown;
}

export interface ViewerMemberPage {
  page: MemberPublicPage;
  isOwner: boolean;
  isPublished: boolean;
}

export interface AdminAccountOption {
  id: string;
  username: string | null;
  hasPage: boolean;
  assignedPageSlug: string | null;
}

export interface AdminMemberPageRow {
  id: string;
  slug: string;
  displayName: string;
  isPublished: boolean;
  moderationHold: boolean;
  publishedAt: string | null;
  unpublishedAt: string | null;
  moderationHeldAt: string | null;
  isV2Cohort: boolean;
  ownerAccountId: string;
  ownerUsername: string | null;
}

export interface AdminMemberManagementData {
  accounts: AdminAccountOption[];
  pages: AdminMemberPageRow[];
}

export interface MemberPortalSummary {
  siteRole: "member" | "admin";
  page: { slug: string; isPublished: boolean } | null;
}

export class MemberAccessError extends Error {
  constructor(
    public readonly code: "unauthenticated" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "MemberAccessError";
  }
}

export class MemberMutationError extends Error {
  constructor(
    public readonly code:
      | "invalid"
      | "duplicate_slug"
      | "duplicate_owner"
      | "ineligible_owner"
      | "not_found",
    message: string,
    public readonly fieldErrors: MemberFieldErrors = {},
  ) {
    super(message);
    this.name = "MemberMutationError";
  }
}

function isMemberStorageEnabled(): boolean {
  try {
    return getAuthMode() !== "disabled";
  } catch {
    return false;
  }
}

function parseNullableString(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new Error("Malformed member-page database result");
  }
  return value;
}

function parseNullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (!(value instanceof Date) && typeof value !== "string") {
    throw new Error("Malformed member-page database result");
  }
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Malformed member-page database result");
  }
  return timestamp.toISOString();
}

function legacyDocumentForPage(
  pageId: string,
  content: MemberContentInput,
  externalArtworkAssetId?: string,
) {
  return legacyToDoc(content, {
    ids: () => `legacy-featured-${pageId}`,
    ...(externalArtworkAssetId ? { externalArtworkAssetId } : {}),
  });
}

function normalizeExternalProjectUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.normalize("NFC").trim()).href;
  } catch {
    return null;
  }
}

function hasSameExternalProjectIdentity(
  existing: {
    name: string;
    shortDescription: string;
    type: string;
    status: string;
    url?: string;
    repository?: string;
  },
  next: {
    name: string;
    shortDescription: string;
    type: string;
    status: string;
    url?: string;
    repository?: string;
  },
): boolean {
  const existingUrl = normalizeExternalProjectUrl(existing.url);
  const nextUrl = normalizeExternalProjectUrl(next.url);
  if (existingUrl && nextUrl && existingUrl === nextUrl) return true;

  const existingRepository = normalizeExternalProjectUrl(existing.repository);
  const nextRepository = normalizeExternalProjectUrl(next.repository);
  if (
    existingRepository &&
    nextRepository &&
    existingRepository === nextRepository
  ) {
    return true;
  }

  // URL and repository are both optional. When neither version has a stable
  // link, preserve imported artwork only for an otherwise exact canonical
  // project identity; changing any descriptive field intentionally drops it.
  if (existingUrl || nextUrl || existingRepository || nextRepository) {
    return false;
  }
  return (
    existing.name.normalize("NFC").trim() === next.name.normalize("NFC").trim() &&
    existing.shortDescription.normalize("NFC").trim() ===
      next.shortDescription.normalize("NFC").trim() &&
    existing.type.normalize("NFC").trim() === next.type.normalize("NFC").trim() &&
    existing.status === next.status
  );
}

function preservedExternalArtworkAssetId(
  draftDocument: unknown,
  showcase: MemberContentInput["showcase"],
): string | undefined {
  if (showcase?.kind !== "external") return undefined;

  const parsedDraft = parseMemberPageDocumentV2(draftDocument);
  if (!parsedDraft.success) return undefined;

  for (const block of parsedDraft.doc.blocks) {
    if (block.type !== "featuredProject") continue;
    if (
      block.project.kind !== "external" ||
      !block.project.artwork ||
      !hasSameExternalProjectIdentity(block.project, showcase)
    ) {
      return undefined;
    }
    return block.project.artwork.assetId;
  }

  return undefined;
}

function withoutRemoteShowcaseArtwork(
  showcase: MemberContentInput["showcase"],
): MemberContentInput["showcase"] {
  if (showcase?.kind !== "external") return showcase;
  const sanitizedShowcase = { ...showcase };
  delete sanitizedShowcase.imageUrl;
  return sanitizedShowcase;
}

function rejectV2CohortLegacyMutation(slug: string): void {
  if (isMemberPageV2Cohort(slug)) {
    throw new MemberMutationError(
      "invalid",
      "This page uses the new editor and cannot be changed through the legacy controls.",
    );
  }
}

function parsePublicPage(row: MemberPageRow): MemberPublicPage {
  if (
    typeof row.slug !== "string" ||
    !isValidMemberSlug(row.slug)
  ) {
    throw new Error("Malformed member-page database result");
  }

  const content = validateMemberContent({
    displayName: row.display_name,
    blurb: row.blurb,
    websiteUrl: row.website_url,
    socialLinks: row.social_links,
    showcase: row.showcase,
  });
  if (!content.success) {
    throw new Error("Malformed member-page content in database");
  }

  return {
    slug: row.slug,
    ...content.data,
  };
}

function parseDirectoryItem(row: DirectoryRow): MemberDirectoryItem {
  if (
    typeof row.slug !== "string" ||
    !isValidMemberSlug(row.slug) ||
    typeof row.display_name !== "string" ||
    row.display_name.trim() === "" ||
    row.display_name.length > 80
  ) {
    throw new Error("Malformed member-directory database result");
  }
  return {
    slug: row.slug,
    displayName: row.display_name,
    blurb: parseNullableString(row.blurb, 500),
  };
}

export async function listPublishedMembers(
  limit?: number,
): Promise<MemberDirectoryItem[]> {
  if (!isMemberStorageEnabled()) return [];
  const sql = getDbClient();
  const safeLimit =
    typeof limit === "number" && Number.isInteger(limit) && limit > 0
      ? Math.min(limit, 100)
      : 100;
  const rows = (await sql`
    SELECT slug, display_name, blurb
    FROM public.member_pages
    WHERE is_published = TRUE
      AND moderation_hold = FALSE
    ORDER BY LOWER(display_name), slug
    LIMIT ${safeLimit};
  `) as DirectoryRow[];
  return rows.map(parseDirectoryItem);
}

const readMemberPageForViewer = async (
  slug: string,
): Promise<ViewerMemberPage | null> => {
  if (!isMemberStorageEnabled() || !isValidMemberSlug(slug)) return null;

  const viewer = await getCurrentVerifiedAccount();
  const viewerId = viewer?.id ?? null;
  const sql = getDbClient();
  const rows = (await sql`
    SELECT
      slug,
      display_name,
      blurb,
      website_url,
      social_links,
      showcase,
      owner_account_id,
      is_published,
      moderation_hold
    FROM public.member_pages
    WHERE slug = ${slug}
      AND (
        (is_published = TRUE AND moderation_hold = FALSE)
        OR owner_account_id = ${viewerId}
      )
    LIMIT 1;
  `) as MemberPageRow[];

  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("Malformed member-page query result");
  const row = rows[0];
  if (
    typeof row.owner_account_id !== "string" ||
    !isValidUuid(row.owner_account_id) ||
    typeof row.is_published !== "boolean" ||
    typeof row.moderation_hold !== "boolean"
  ) {
    throw new Error("Malformed member-page database result");
  }

  return {
    page: parsePublicPage(row),
    isOwner: viewerId === row.owner_account_id,
    isPublished: row.is_published && !row.moderation_hold,
  };
};

export const getMemberPageForViewer = cache(readMemberPageForViewer);

export async function requireAdmin() {
  const account = await getCurrentVerifiedAccount();
  if (!account) {
    throw new MemberAccessError("unauthenticated", "Sign in is required.");
  }
  if (account.siteRole !== "admin") {
    throw new MemberAccessError("forbidden", "Administrator access is required.");
  }
  return account;
}

export async function getMemberPortalSummary(): Promise<MemberPortalSummary | null> {
  const account = await getCurrentVerifiedAccount();
  if (!account) return null;
  const sql = getDbClient();
  const rows = (await sql`
    SELECT slug, is_published
    FROM public.member_pages
    WHERE owner_account_id = ${account.id}
    LIMIT 1;
  `) as Array<{ slug: unknown; is_published: unknown }>;
  if (rows.length > 1) throw new Error("Malformed member portal query result");
  if (rows.length === 0) return { siteRole: account.siteRole, page: null };
  const row = rows[0];
  if (
    typeof row.slug !== "string" ||
    !isValidMemberSlug(row.slug) ||
    typeof row.is_published !== "boolean"
  ) {
    throw new Error("Malformed member portal query result");
  }
  return {
    siteRole: account.siteRole,
    page: { slug: row.slug, isPublished: row.is_published },
  };
}

export async function getAdminMemberManagementData(): Promise<AdminMemberManagementData> {
  await requireAdmin();
  const sql = getDbClient();
  const [accountRows, pageRows] = await Promise.all([
    sql`
      SELECT
        a.id,
        a.discord_username,
        (mp.id IS NOT NULL) AS has_page,
        mp.slug AS assigned_page_slug
      FROM public.accounts a
      LEFT JOIN public.member_pages mp ON mp.owner_account_id = a.id
      WHERE a.access_status = 'active'
        AND a.membership_status = 'eligible'
        AND a.membership_checked_at + INTERVAL '24 hours' > NOW()
      ORDER BY LOWER(COALESCE(a.discord_username, '')), a.id;
    `,
    sql`
      SELECT
        mp.id,
        mp.slug,
        mp.display_name,
        mp.is_published,
        mp.moderation_hold,
        mp.published_at,
        mp.unpublished_at,
        mp.moderation_held_at,
        mp.owner_account_id,
        a.discord_username AS owner_username
      FROM public.member_pages mp
      JOIN public.accounts a ON a.id = mp.owner_account_id
      ORDER BY LOWER(mp.display_name), mp.slug;
    `,
  ]);

  const accounts = (accountRows as Array<Record<string, unknown>>).map((row) => {
    if (
      typeof row.id !== "string" ||
      !isValidUuid(row.id) ||
      (row.discord_username !== null && typeof row.discord_username !== "string") ||
      typeof row.has_page !== "boolean" ||
      (row.assigned_page_slug !== null &&
        (typeof row.assigned_page_slug !== "string" ||
          !isValidMemberSlug(row.assigned_page_slug))) ||
      row.has_page !== (row.assigned_page_slug !== null)
    ) {
      throw new Error("Malformed admin account query result");
    }
    return {
      id: row.id,
      username: row.discord_username as string | null,
      hasPage: row.has_page,
      assignedPageSlug: row.assigned_page_slug as string | null,
    };
  });

  const pages = (pageRows as Array<Record<string, unknown>>).map((row) => {
    if (
      typeof row.id !== "string" ||
      !isValidUuid(row.id) ||
      typeof row.owner_account_id !== "string" ||
      !isValidUuid(row.owner_account_id) ||
      typeof row.slug !== "string" ||
      !isValidMemberSlug(row.slug) ||
      typeof row.display_name !== "string" ||
      typeof row.is_published !== "boolean" ||
      typeof row.moderation_hold !== "boolean" ||
      (row.owner_username !== null && typeof row.owner_username !== "string")
    ) {
      throw new Error("Malformed admin member-page query result");
    }
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      isPublished: row.is_published,
      moderationHold: row.moderation_hold,
      publishedAt: parseNullableTimestamp(row.published_at),
      unpublishedAt: parseNullableTimestamp(row.unpublished_at),
      moderationHeldAt: parseNullableTimestamp(row.moderation_held_at),
      isV2Cohort: isMemberPageV2Cohort(row.slug),
      ownerAccountId: row.owner_account_id,
      ownerUsername: row.owner_username as string | null,
    };
  });

  return { accounts, pages };
}

function classifyDatabaseMutationError(error: unknown): never {
  const databaseError = error as { code?: unknown; constraint?: unknown };
  if (databaseError.code === "23505") {
    if (databaseError.constraint === "uq_member_pages_slug") {
      throw new MemberMutationError(
        "duplicate_slug",
        "That member address is already in use.",
        { slug: "Choose another address." },
      );
    }
    if (databaseError.constraint === "uq_member_pages_owner_account_id") {
      throw new MemberMutationError(
        "duplicate_owner",
        "That account already has a member page.",
        { ownerAccountId: "Choose an account without a page." },
      );
    }
  }
  throw error;
}

export async function createMemberPage(input: {
  ownerAccountId: unknown;
  slug: unknown;
  displayName: unknown;
  isPublished: boolean;
}): Promise<string> {
  const admin = await requireAdmin();
  const ownerAccountId =
    typeof input.ownerAccountId === "string" && isValidUuid(input.ownerAccountId)
      ? input.ownerAccountId
      : null;
  const slug = validateMemberSlug(input.slug);
  const content = validateMemberContent({
    displayName: input.displayName,
    blurb: null,
    websiteUrl: null,
    socialLinks: {},
    showcase: null,
  });
  const errors: MemberFieldErrors = {};
  if (!ownerAccountId) errors.ownerAccountId = "Choose an eligible account.";
  if (!slug) errors.slug = "Use an available lowercase DNS label.";
  if (!content.success) Object.assign(errors, content.errors);
  if (Object.keys(errors).length > 0) {
    throw new MemberMutationError("invalid", "Check the highlighted fields.", errors);
  }
  if (!ownerAccountId || !slug || !content.success) {
    throw new Error("Member-page validation failed without field errors");
  }
  if (input.isPublished && isMemberPageV2Cohort(slug)) {
    throw new MemberMutationError(
      "invalid",
      "Pages assigned to the new editor must begin unpublished.",
    );
  }

  const draftDocument = legacyToDoc(content.data, {
    ids: () => `legacy-featured-${slug}`,
  });

  const sql = getDbClient();
  try {
    const rows = (await sql`
      INSERT INTO public.member_pages (
        owner_account_id,
        created_by_account_id,
        slug,
        display_name,
        is_published,
        draft_doc,
        published_doc,
        published_at
      )
      SELECT
        owner.id,
        ${admin.id},
        ${slug},
        ${content.data.displayName},
        ${input.isPublished},
        ${draftDocument},
        ${input.isPublished ? draftDocument : null},
        CASE WHEN ${input.isPublished} THEN NOW() ELSE NULL END
      FROM public.accounts owner
      WHERE owner.id = ${ownerAccountId}
        AND owner.access_status = 'active'
        AND owner.membership_status = 'eligible'
        AND owner.membership_checked_at + INTERVAL '24 hours' > NOW()
      RETURNING slug;
    `) as Array<{ slug: unknown }>;
    if (rows.length === 0) {
      throw new MemberMutationError(
        "ineligible_owner",
        "That account is not currently eligible.",
        { ownerAccountId: "Choose a currently eligible account." },
      );
    }
    if (rows.length !== 1 || rows[0].slug !== slug) {
      throw new Error("Malformed member-page creation result");
    }
    return slug;
  } catch (error) {
    if (error instanceof MemberMutationError) throw error;
    return classifyDatabaseMutationError(error);
  }
}

export async function updateOwnedMemberPage(
  slugInput: unknown,
  input: Record<string, unknown>,
): Promise<string> {
  const account = await getCurrentVerifiedAccount();
  if (!account) {
    throw new MemberAccessError("unauthenticated", "Sign in is required.");
  }
  const slug = validateMemberSlug(slugInput);
  if (!slug) {
    throw new MemberMutationError("invalid", "This member address is invalid.", {
      slug: "Invalid member address.",
    });
  }
  rejectV2CohortLegacyMutation(slug);

  const content = validateMemberContent(input);
  if (!content.success) {
    throw new MemberMutationError("invalid", "Check the highlighted fields.", content.errors);
  }

  const sql = getDbClient();
  const ownerRows = (await sql`
    SELECT id, slug, draft_doc
    FROM public.member_pages
    WHERE slug = ${slug}
      AND owner_account_id = ${account.id}
    LIMIT 1;
  `) as Array<{ id: unknown; slug: unknown; draft_doc: unknown }>;
  if (ownerRows.length === 0) {
    throw new MemberAccessError("forbidden", "You cannot edit this member page.");
  }
  if (
    ownerRows.length !== 1 ||
    typeof ownerRows[0].id !== "string" ||
    !isValidUuid(ownerRows[0].id) ||
    ownerRows[0].slug !== slug
  ) {
    throw new Error("Malformed member-page ownership result");
  }

  const showcase = withoutRemoteShowcaseArtwork(content.data.showcase);
  const externalArtworkAssetId = preservedExternalArtworkAssetId(
    ownerRows[0].draft_doc,
    showcase,
  );

  const draftDocument = legacyDocumentForPage(
    ownerRows[0].id,
    {
      ...content.data,
      showcase,
    },
    externalArtworkAssetId,
  );

  const rows = (await sql`
    UPDATE public.member_pages
    SET
      display_name = ${content.data.displayName},
      blurb = ${content.data.blurb},
      website_url = ${content.data.websiteUrl},
      social_links = ${content.data.socialLinks},
      showcase = ${showcase},
      draft_doc = ${draftDocument},
      draft_rev = draft_rev + 1,
      draft_updated_at = NOW(),
      published_doc = CASE
        WHEN is_published THEN ${draftDocument}
        ELSE published_doc
      END,
      updated_at = NOW()
    WHERE slug = ${slug}
      AND owner_account_id = ${account.id}
    RETURNING slug;
  `) as Array<{ slug: unknown }>;

  if (rows.length === 0) {
    throw new MemberAccessError("forbidden", "You cannot edit this member page.");
  }
  if (rows.length !== 1 || rows[0].slug !== slug) {
    throw new Error("Malformed member-page update result");
  }
  return slug;
}

export async function setMemberPublication(
  pageId: unknown,
  isPublished: boolean,
): Promise<string> {
  await requireAdmin();
  if (typeof pageId !== "string" || !isValidUuid(pageId)) {
    throw new MemberMutationError("invalid", "Invalid member page.");
  }
  const sql = getDbClient();
  const pageRows = (await sql`
    SELECT slug, moderation_hold
    FROM public.member_pages
    WHERE id = ${pageId}
    LIMIT 1;
  `) as Array<{ slug: unknown; moderation_hold: unknown }>;
  if (pageRows.length === 0) {
    throw new MemberMutationError("not_found", "Member page not found.");
  }
  if (
    pageRows.length !== 1 ||
    typeof pageRows[0].slug !== "string" ||
    !isValidMemberSlug(pageRows[0].slug) ||
    typeof pageRows[0].moderation_hold !== "boolean"
  ) {
    throw new Error("Malformed publication lookup result");
  }
  rejectV2CohortLegacyMutation(pageRows[0].slug);
  if (isPublished && pageRows[0].moderation_hold) {
    throw new MemberMutationError(
      "invalid",
      "A page on moderation hold cannot be published.",
    );
  }

  const rows = (await sql`
    UPDATE public.member_pages
    SET
      published_doc = CASE
        WHEN ${isPublished} THEN draft_doc
        ELSE published_doc
      END,
      display_name = CASE
        WHEN ${isPublished} THEN draft_doc #>> '{frame,displayName}'
        ELSE display_name
      END,
      blurb = CASE
        WHEN ${isPublished} THEN draft_doc #>> '{frame,summary}'
        ELSE blurb
      END,
      is_published = ${isPublished},
      published_at = CASE
        WHEN ${isPublished} THEN NOW()
        ELSE published_at
      END,
      unpublished_at = CASE
        WHEN ${isPublished} THEN NULL
        ELSE NOW()
      END,
      updated_at = NOW()
    WHERE id = ${pageId}
      AND (NOT ${isPublished} OR moderation_hold = FALSE)
      AND (
        NOT ${isPublished}
        OR draft_doc = jsonb_build_object(
          'schemaVersion', 2,
          'frame', jsonb_build_object(
            'displayName', BTRIM(
              NORMALIZE(display_name, NFC),
              U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
            ),
            'summary', NULLIF(BTRIM(
              NORMALIZE(blurb, NFC),
              U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
            ), ''),
            'websiteUrl', NULLIF(BTRIM(
              NORMALIZE(website_url, NFC),
              U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
            ), ''),
            'socialLinks', jsonb_strip_nulls(jsonb_build_object(
              'github', NULLIF(BTRIM(
                NORMALIZE(social_links->>'github', NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), ''),
              'bluesky', NULLIF(BTRIM(
                NORMALIZE(social_links->>'bluesky', NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), ''),
              'mastodon', NULLIF(BTRIM(
                NORMALIZE(social_links->>'mastodon', NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), ''),
              'instagram', NULLIF(BTRIM(
                NORMALIZE(social_links->>'instagram', NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), ''),
              'youtube', NULLIF(BTRIM(
                NORMALIZE(social_links->>'youtube', NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), ''),
              'twitch', NULLIF(BTRIM(
                NORMALIZE(social_links->>'twitch', NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), ''),
              'x', NULLIF(BTRIM(
                NORMALIZE(social_links->>'x', NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), '')
            )),
            'portrait', NULL,
            'theme', jsonb_build_object(
              'id', 'paper',
              'accentId', 'default'
            )
          ),
          'blocks', CASE
            WHEN showcase IS NULL THEN '[]'::jsonb
            WHEN showcase->>'kind' = 'project' THEN
              jsonb_build_array(
                jsonb_build_object(
                  'id', 'legacy-featured-' || id::text,
                  'type', 'featuredProject',
                  'variant', 'card',
                  'project', jsonb_build_object(
                    'kind', 'ham',
                    'projectSlug', showcase->>'projectSlug'
                  )
                )
              )
            WHEN showcase->>'kind' = 'external' THEN
              jsonb_build_array(
                jsonb_build_object(
                  'id', 'legacy-featured-' || id::text,
                  'type', 'featuredProject',
                  'variant', 'card',
                  'project', jsonb_strip_nulls(
                    jsonb_build_object(
                      'kind', 'external',
                      'name', BTRIM(
                        NORMALIZE(showcase->>'name', NFC),
                        U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                      ),
                      'shortDescription', BTRIM(
                        NORMALIZE(showcase->>'shortDescription', NFC),
                        U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                      ),
                      'type', BTRIM(
                        NORMALIZE(showcase->>'type', NFC),
                        U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                      ),
                      'status', showcase->>'status',
                      'url', NULLIF(BTRIM(
                        NORMALIZE(showcase->>'url', NFC),
                        U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                      ), ''),
                      'repository', NULLIF(BTRIM(
                        NORMALIZE(showcase->>'repository', NFC),
                        U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                      ), ''),
                      'artwork', CASE
                        WHEN
                          JSONB_TYPEOF(
                            draft_doc #> '{blocks,0,project,artwork}'
                          ) = 'object'
                          AND (
                            draft_doc #> '{blocks,0,project,artwork}'
                          ) ?& ARRAY['assetId', 'alt', 'decorative']
                          AND NOT EXISTS (
                            SELECT 1
                            FROM JSONB_OBJECT_KEYS(
                              draft_doc #> '{blocks,0,project,artwork}'
                            ) AS artwork_key(key)
                            WHERE artwork_key.key NOT IN (
                              'assetId',
                              'alt',
                              'decorative'
                            )
                          )
                          AND JSONB_TYPEOF(
                            draft_doc #> '{blocks,0,project,artwork,assetId}'
                          ) = 'string'
                          AND JSONB_TYPEOF(
                            draft_doc #> '{blocks,0,project,artwork,decorative}'
                          ) = 'boolean'
                          AND (
                            (
                              draft_doc #>> '{blocks,0,project,artwork,decorative}'
                            ) = 'true'
                            AND (
                              draft_doc #> '{blocks,0,project,artwork,alt}'
                            ) = 'null'::jsonb
                            OR (
                              draft_doc #>> '{blocks,0,project,artwork,decorative}'
                            ) = 'false'
                            AND JSONB_TYPEOF(
                              draft_doc #> '{blocks,0,project,artwork,alt}'
                            ) = 'string'
                            AND BTRIM(
                              NORMALIZE(
                                draft_doc #>> '{blocks,0,project,artwork,alt}',
                                NFC
                              ),
                              U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                            ) = (
                              draft_doc #>> '{blocks,0,project,artwork,alt}'
                            )
                            AND BTRIM(
                              NORMALIZE(
                                draft_doc #>> '{blocks,0,project,artwork,alt}',
                                NFC
                              ),
                              U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                            ) <> ''
                            AND LENGTH(
                              draft_doc #>> '{blocks,0,project,artwork,alt}'
                            ) <= 500
                            AND NOT EXISTS (
                              SELECT 1
                              FROM GENERATE_SERIES(
                                1,
                                LENGTH(
                                  draft_doc #>> '{blocks,0,project,artwork,alt}'
                                )
                              ) AS codepoint_index(position)
                              WHERE ASCII(SUBSTRING(
                                draft_doc #>> '{blocks,0,project,artwork,alt}'
                                FROM codepoint_index.position FOR 1
                              )) BETWEEN 1 AND 31
                                 OR ASCII(SUBSTRING(
                                   draft_doc #>> '{blocks,0,project,artwork,alt}'
                                   FROM codepoint_index.position FOR 1
                                 )) BETWEEN 127 AND 159
                            )
                          )
                          AND EXISTS (
                            SELECT 1
                            FROM public.member_page_assets asset
                            WHERE asset.member_page_id = member_pages.id
                              AND asset.id::text = (
                                draft_doc #>> '{blocks,0,project,artwork,assetId}'
                              )
                              AND asset.status = 'ready'
                              AND asset.deletion_claimed_at IS NULL
                          )
                          THEN draft_doc #> '{blocks,0,project,artwork}'
                        ELSE NULL
                      END
                    )
                  )
                )
              )
            ELSE '[]'::jsonb
          END
        )
      )
    RETURNING slug;
  `) as Array<{ slug: unknown }>;
  if (rows.length === 0) {
    throw new MemberMutationError(
      "invalid",
      isPublished
        ? "This legacy page cannot be published from its current draft."
        : "Member page not found.",
    );
  }
  if (rows.length !== 1 || typeof rows[0].slug !== "string") {
    throw new Error("Malformed publication update result");
  }
  return rows[0].slug;
}

export async function reassignMemberPage(
  pageId: unknown,
  ownerAccountId: unknown,
): Promise<string> {
  await requireAdmin();
  if (
    typeof pageId !== "string" ||
    !isValidUuid(pageId) ||
    typeof ownerAccountId !== "string" ||
    !isValidUuid(ownerAccountId)
  ) {
    throw new MemberMutationError("invalid", "Choose a valid member and account.");
  }

  const sql = getDbClient();
  try {
    const rows = (await sql`
      UPDATE public.member_pages page
      SET owner_account_id = owner.id, updated_at = NOW()
      FROM public.accounts owner
      WHERE page.id = ${pageId}
        AND owner.id = ${ownerAccountId}
        AND owner.access_status = 'active'
        AND owner.membership_status = 'eligible'
        AND owner.membership_checked_at + INTERVAL '24 hours' > NOW()
      RETURNING page.slug;
    `) as Array<{ slug: unknown }>;
    if (rows.length === 0) {
      throw new MemberMutationError(
        "ineligible_owner",
        "That account is not currently eligible.",
      );
    }
    if (rows.length !== 1 || typeof rows[0].slug !== "string") {
      throw new Error("Malformed member-page reassignment result");
    }
    return rows[0].slug;
  } catch (error) {
    if (error instanceof MemberMutationError) throw error;
    return classifyDatabaseMutationError(error);
  }
}
