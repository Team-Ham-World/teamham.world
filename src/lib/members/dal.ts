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
import { findOpenGraphImage } from "@/lib/members/open-graph";
import {
  validateMemberContent,
  validateMemberSlug,
  type MemberFieldErrors,
} from "@/lib/members/validation";

interface MemberPageRow {
  slug: unknown;
  display_name: unknown;
  blurb: unknown;
  website_url: unknown;
  showcase: unknown;
  owner_account_id?: unknown;
  is_published?: unknown;
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
}

export interface AdminMemberPageRow {
  id: string;
  slug: string;
  displayName: string;
  isPublished: boolean;
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
      showcase,
      owner_account_id,
      is_published
    FROM public.member_pages
    WHERE slug = ${slug}
      AND (is_published = TRUE OR owner_account_id = ${viewerId})
    LIMIT 1;
  `) as MemberPageRow[];

  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("Malformed member-page query result");
  const row = rows[0];
  if (
    typeof row.owner_account_id !== "string" ||
    !isValidUuid(row.owner_account_id) ||
    typeof row.is_published !== "boolean"
  ) {
    throw new Error("Malformed member-page database result");
  }

  return {
    page: parsePublicPage(row),
    isOwner: viewerId === row.owner_account_id,
    isPublished: row.is_published,
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
        (mp.id IS NOT NULL) AS has_page
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
      typeof row.has_page !== "boolean"
    ) {
      throw new Error("Malformed admin account query result");
    }
    return {
      id: row.id,
      username: row.discord_username as string | null,
      hasPage: row.has_page,
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
      (row.owner_username !== null && typeof row.owner_username !== "string")
    ) {
      throw new Error("Malformed admin member-page query result");
    }
    return {
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      isPublished: row.is_published,
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

  const sql = getDbClient();
  try {
    const rows = (await sql`
      INSERT INTO public.member_pages (
        owner_account_id,
        created_by_account_id,
        slug,
        display_name,
        is_published
      )
      SELECT
        owner.id,
        ${admin.id},
        ${slug},
        ${content.data.displayName},
        ${input.isPublished}
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
  const content = validateMemberContent(input);
  if (!slug) {
    throw new MemberMutationError("invalid", "This member address is invalid.", {
      slug: "Invalid member address.",
    });
  }
  if (!content.success) {
    throw new MemberMutationError("invalid", "Check the highlighted fields.", content.errors);
  }

  const sql = getDbClient();
  let showcase = content.data.showcase;
  if (
    showcase?.kind === "external" &&
    !showcase.imageUrl &&
    showcase.url
  ) {
    const ownerRows = (await sql`
      SELECT slug
      FROM public.member_pages
      WHERE slug = ${slug}
        AND owner_account_id = ${account.id}
      LIMIT 1;
    `) as Array<{ slug: unknown }>;
    if (ownerRows.length === 0) {
      throw new MemberAccessError("forbidden", "You cannot edit this member page.");
    }
    if (ownerRows.length !== 1 || ownerRows[0].slug !== slug) {
      throw new Error("Malformed member-page ownership result");
    }

    const imageUrl = await findOpenGraphImage(showcase.url);
    if (imageUrl) showcase = { ...showcase, imageUrl };
  }

  const rows = (await sql`
    UPDATE public.member_pages
    SET
      display_name = ${content.data.displayName},
      blurb = ${content.data.blurb},
      website_url = ${content.data.websiteUrl},
      showcase = ${showcase},
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
  const rows = (await sql`
    UPDATE public.member_pages
    SET is_published = ${isPublished}, updated_at = NOW()
    WHERE id = ${pageId}
    RETURNING slug;
  `) as Array<{ slug: unknown }>;
  if (rows.length === 0) throw new MemberMutationError("not_found", "Member page not found.");
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
