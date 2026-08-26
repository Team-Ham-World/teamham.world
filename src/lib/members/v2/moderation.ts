import "server-only";

import { getDbClient } from "@/lib/auth/db";
import { getCurrentVerifiedAccount } from "@/lib/auth/session";
import {
  MemberAccessError,
  MemberMutationError,
} from "@/lib/members/dal";
import { validateMemberSlug } from "@/lib/members/validation";

interface ModerationRow {
  slug: unknown;
  is_published: unknown;
  moderation_hold: unknown;
  unpublished_at: unknown;
  moderation_held_at: unknown;
  updated_at: unknown;
}

export interface MemberPageModerationMetadata {
  slug: string;
  isPublished: false;
  moderationHold: boolean;
  unpublishedAt: string | null;
  moderationHeldAt: string | null;
  updatedAt: string;
}

async function requireCurrentAdmin(): Promise<void> {
  const account = await getCurrentVerifiedAccount();
  if (!account) {
    throw new MemberAccessError("unauthenticated", "Sign in is required.");
  }
  if (account.siteRole !== "admin") {
    throw new MemberAccessError(
      "forbidden",
      "Administrator access is required.",
    );
  }
}

function parseTimestamp(value: unknown, nullable: true): string | null;
function parseTimestamp(value: unknown, nullable?: false): string;
function parseTimestamp(
  value: unknown,
  nullable = false,
): string | null {
  if (nullable && value === null) return null;
  if (!(typeof value === "string" || value instanceof Date)) {
    throw new Error("Malformed member-page moderation result");
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Malformed member-page moderation result");
  }
  return timestamp.toISOString();
}

function parseModerationResult(
  rows: ModerationRow[],
  slug: string,
  moderationHold: boolean,
): MemberPageModerationMetadata {
  if (rows.length !== 1) {
    throw new Error("Malformed member-page moderation result");
  }
  const row = rows[0];
  if (
    row.slug !== slug ||
    row.is_published !== false ||
    row.moderation_hold !== moderationHold
  ) {
    throw new Error("Malformed member-page moderation result");
  }
  return {
    slug,
    isPublished: false,
    moderationHold,
    unpublishedAt: parseTimestamp(row.unpublished_at, true),
    moderationHeldAt: parseTimestamp(row.moderation_held_at, true),
    updatedAt: parseTimestamp(row.updated_at),
  };
}

async function validateAdminSlug(slugInput: unknown): Promise<string> {
  await requireCurrentAdmin();
  const slug = validateMemberSlug(slugInput);
  if (!slug) {
    throw new MemberMutationError("invalid", "Invalid member page.", {
      slug: "Invalid member address.",
    });
  }
  return slug;
}

export async function takeDownAndHold(
  slugInput: unknown,
): Promise<MemberPageModerationMetadata> {
  const slug = await validateAdminSlug(slugInput);
  const sql = getDbClient();
  const rows = (await sql`
    UPDATE public.member_pages
    SET
      is_published = FALSE,
      moderation_hold = TRUE,
      unpublished_at = NOW(),
      moderation_held_at = NOW(),
      updated_at = NOW()
    WHERE slug = ${slug}
    RETURNING
      slug,
      is_published,
      moderation_hold,
      unpublished_at,
      moderation_held_at,
      updated_at;
  `) as ModerationRow[];

  if (rows.length === 0) {
    throw new MemberMutationError("not_found", "Member page not found.");
  }
  return parseModerationResult(rows, slug, true);
}

export async function clearModerationHold(
  slugInput: unknown,
): Promise<MemberPageModerationMetadata> {
  const slug = await validateAdminSlug(slugInput);
  const sql = getDbClient();
  const rows = (await sql`
    UPDATE public.member_pages
    SET
      is_published = FALSE,
      moderation_hold = FALSE,
      updated_at = NOW()
    WHERE slug = ${slug}
      AND moderation_hold = TRUE
    RETURNING
      slug,
      is_published,
      moderation_hold,
      unpublished_at,
      moderation_held_at,
      updated_at;
  `) as ModerationRow[];

  if (rows.length === 0) {
    throw new MemberMutationError(
      "not_found",
      "Member page not found or no moderation hold is active.",
    );
  }
  return parseModerationResult(rows, slug, false);
}
