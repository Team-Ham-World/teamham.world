import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => "development" }));
vi.mock("@/lib/auth/db", () => ({ getDbClient: () => mocks.query }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentVerifiedAccount: mocks.currentAccount,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { unpublishMemberPageV2Action } from "@/app/m/[member]/v2-actions";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import {
  autosaveOwnedMemberPageDraftV2,
  unpublishOwnedMemberPageV2,
} from "@/lib/members/v2/dal";

const OWNER = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  accessStatus: "active" as const,
  membershipStatus: "eligible" as const,
  expiresAt: new Date(Date.now() + 60_000),
  username: "hamfriend",
  siteRole: "member" as const,
};

const ADMIN_NON_OWNER = {
  ...OWNER,
  id: "550e8400-e29b-41d4-a716-446655440001",
  siteRole: "admin" as const,
};

const NOW = "2026-08-25T12:00:00.000Z";
const GENERATION_ONE = "2026-08-20T09:00:00.000Z";
const GENERATION_TWO = "2026-08-21T09:00:00.000Z";
const ORIGINAL_V2_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_V2_EDITOR_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

const DOCUMENT: MemberPageDocumentV2 = {
  schemaVersion: 2,
  frame: {
    displayName: "HAM Friend",
    summary: "Makes tiny tools.",
    websiteUrl: null,
    socialLinks: {},
    portrait: null,
    theme: { id: "paper", accentId: "default" },
  },
  blocks: [],
};

function queryText(callIndex: number): string {
  return mocks.query.mock.calls[callIndex][0].join("?");
}

function guardValues(callIndex: number): unknown[] {
  const [, ...values] = mocks.query.mock.calls[callIndex];
  return values;
}

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * Stale-unpublish protection: the unpublish request carries the publication
 * generation the editor loaded (the server-issued `published_at` boundary),
 * and the store refuses to take a newer publication down on its behalf.
 * `draft_rev` is deliberately not part of the guard, so a private draft
 * autosave can never block an emergency unpublish.
 */
describe("member V2 unpublish publication-generation guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "false";
    mocks.currentAccount.mockResolvedValue(OWNER);
  });

  afterEach(() => {
    restoreEnvironmentVariable("MEMBER_PAGE_V2_ALLOWLIST", ORIGINAL_V2_ALLOWLIST);
    restoreEnvironmentVariable(
      "MEMBER_PAGE_V2_EDITOR_DISABLED",
      ORIGINAL_V2_EDITOR_DISABLED,
    );
  });

  it("unpublishes for a fresh owner whose token matches the stored generation", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      slug: "hamfriend",
      unpublished_at: NOW,
    }]);

    const result = await unpublishMemberPageV2Action({
      slug: "hamfriend",
      expectedPublishedAt: GENERATION_TWO,
    });

    expect(result).toEqual({
      status: "unpublished",
      message: "Unpublished.",
      fieldErrors: {},
      slug: "hamfriend",
      unpublishedAt: NOW,
    });
    expect(guardValues(0)).toContain(GENERATION_TWO);
    expect(queryText(0)).toContain(
      "page.published_at IS NOT DISTINCT FROM ?::timestamptz",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/m/hamfriend");
  });

  it("rejects generation-one intent after a generation-two publish with a typed conflict", async () => {
    // Tab B published a second generation; Tab A still presents the first.
    mocks.query.mockResolvedValueOnce([{
      outcome: "conflict",
      slug: null,
      unpublished_at: null,
    }]);

    const result = await unpublishMemberPageV2Action({
      slug: "hamfriend",
      expectedPublishedAt: GENERATION_ONE,
    });

    expect(result.status).toBe("conflict");
    expect(result).toEqual({
      status: "conflict",
      message:
        "This page was published again in another editor. Reload the editor before unpublishing.",
      fieldErrors: {},
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);

    // The stale generation, not the stored one, was the comparison value the
    // guard evaluated, so the row lock resolves the race in the store.
    expect(guardValues(0)).toContain(GENERATION_ONE);
    expect(guardValues(0)).not.toContain(GENERATION_TWO);

    // A stale intent changes neither publication state nor either document.
    const sql = queryText(0);
    expect(sql.match(/UPDATE public\.member_pages/gu)).toHaveLength(1);
    expect(sql).toContain("'conflict'::text AS outcome");
    expect(sql).toContain("is_published = FALSE");
    expect(sql).not.toContain("draft_doc =");
    expect(sql).not.toContain("published_doc =");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps unpublish available after private draft autosaves", async () => {
    // A private autosave advances draft_rev; it never touches published_at.
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      draft_rev: "8",
      draft_updated_at: NOW,
    }]);
    await expect(
      autosaveOwnedMemberPageDraftV2("hamfriend", 7, DOCUMENT),
    ).resolves.toMatchObject({ status: "success", draftRev: 8 });
    expect(queryText(0)).toContain("page.draft_rev = ?");

    // The generation-loaded token still unpublishes on the next generation.
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      slug: "hamfriend",
      unpublished_at: NOW,
    }]);
    await expect(
      unpublishMemberPageV2Action({
        slug: "hamfriend",
        expectedPublishedAt: GENERATION_TWO,
      }),
    ).resolves.toMatchObject({ status: "unpublished" });

    const unpublishSql = queryText(1);
    expect(unpublishSql).toContain(
      "page.published_at IS NOT DISTINCT FROM ?::timestamptz",
    );
    expect(unpublishSql).not.toContain("draft_rev");
  });

  it("requires the exact unpublish input shape before any store access", async () => {
    const malformedInputs = [
      { slug: "hamfriend" },
      {
        slug: "hamfriend",
        expectedPublishedAt: GENERATION_TWO,
        ownerId: OWNER.id,
      },
      { slug: "hamfriend", expectedPublishedAt: "not-a-date" },
      { slug: "hamfriend", expectedPublishedAt: 42 },
    ];

    for (const input of malformedInputs) {
      const result = await unpublishMemberPageV2Action(input as never);
      expect(result.status).toBe("invalid");
    }

    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("treats a null token as the never-published generation", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      slug: "hamfriend",
      unpublished_at: NOW,
    }]);

    const result = await unpublishMemberPageV2Action({
      slug: "hamfriend",
      expectedPublishedAt: null,
    });

    expect(result.status).toBe("unpublished");
    expect(guardValues(0)).toContain(null);
  });

  it("keeps the owner boundary: a non-owner administrator is not granted unpublish", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_NON_OWNER);
    mocks.query.mockResolvedValueOnce([]);

    const result = await unpublishMemberPageV2Action({
      slug: "hamfriend",
      expectedPublishedAt: GENERATION_TWO,
    });

    expect(result).toEqual({
      status: "unavailable",
      message: "Unpublish unavailable.",
      fieldErrors: {},
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0].slice(1)).toContain(ADMIN_NON_OWNER.id);
  });

  it("surfaces the typed conflict from the DAL without revalidation", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "conflict",
      slug: null,
      unpublished_at: null,
    }]);

    await expect(
      unpublishOwnedMemberPageV2("hamfriend", GENERATION_ONE),
    ).resolves.toEqual({ status: "conflict" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
