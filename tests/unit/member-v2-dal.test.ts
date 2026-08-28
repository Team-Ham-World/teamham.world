import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => "development" }));
vi.mock("@/lib/auth/db", () => ({ getDbClient: () => mocks.query }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentVerifiedAccount: mocks.currentAccount,
}));

import { updateOwnedMemberPage } from "@/lib/members/dal";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import {
  autosaveOwnedMemberPageDraftV2,
  getOwnedMemberPageDraftV2,
  getPublishedMemberPageV2,
  publishOwnedMemberPageV2,
  resetOwnedMemberPageDraftV2,
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

const PAGE_ID = "550e8400-e29b-41d4-a716-446655440010";
const ASSET_ID = "550e8400-e29b-41d4-a716-446655440020";
const NOW = "2026-08-25T12:00:00.000Z";
const ORIGINAL_V2_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_V2_EDITOR_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

const DOCUMENT: MemberPageDocumentV2 = {
  schemaVersion: 2,
  frame: {
    displayName: "HAM Friend",
    summary: "Makes tiny tools.",
    websiteUrl: "https://hamfriend.example",
    socialLinks: { github: "https://github.com/hamfriend" },
    portrait: null,
    theme: { id: "paper", accentId: "default" },
  },
  blocks: [],
};

const DOCUMENT_WITH_ASSET: MemberPageDocumentV2 = {
  ...DOCUMENT,
  frame: {
    ...DOCUMENT.frame,
    portrait: {
      assetId: ASSET_ID,
      alt: "HAM Friend smiling",
      decorative: false,
    },
  },
};

const DOCUMENT_WITH_REUSED_ASSET: MemberPageDocumentV2 = {
  ...DOCUMENT_WITH_ASSET,
  blocks: [{
    id: "reused-asset-image",
    type: "image",
    variant: "framed",
    image: {
      assetId: ASSET_ID,
      alt: "The same HAM Friend portrait",
      decorative: false,
    },
    caption: null,
  }],
};

function queryText(callIndex: number): string {
  return mocks.query.mock.calls[callIndex][0].join("?");
}

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("member V2 data access", () => {
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

  it("reads a minimal exact-owner draft DTO without private asset metadata", async () => {
    mocks.query.mockResolvedValueOnce([{
      id: PAGE_ID,
      slug: "hamfriend",
      draft_doc: DOCUMENT,
      draft_rev: "7",
      is_published: false,
      moderation_hold: true,
      has_published_snapshot: true,
      draft_updated_at: NOW,
      published_at: "2026-08-24T12:00:00.000Z",
      unpublished_at: NOW,
      object_key: "must-not-escape",
    }]);

    await expect(getOwnedMemberPageDraftV2("hamfriend")).resolves.toEqual({
      status: "success",
      data: {
        pageId: PAGE_ID,
        slug: "hamfriend",
        draft: DOCUMENT,
        draftRev: 7,
        isPublished: false,
        moderationHold: true,
        hasPublishedSnapshot: true,
        draftUpdatedAt: NOW,
        publishedAt: "2026-08-24T12:00:00.000Z",
        unpublishedAt: NOW,
      },
    });

    const sql = queryText(0);
    const [, ...values] = mocks.query.mock.calls[0];
    expect(sql).toContain("WHERE slug = ?");
    expect(sql).toContain("owner_account_id = ?");
    expect(sql).toContain("(published_doc IS NOT NULL)");
    expect(sql).not.toContain("object_key");
    expect(sql).not.toContain("member_page_assets");
    expect(values).toContain("hamfriend");
    expect(values).toContain(OWNER.id);
  });

  it("does not grant an administrator a non-owned draft", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_NON_OWNER);
    mocks.query.mockResolvedValueOnce([]);

    await expect(getOwnedMemberPageDraftV2("hamfriend")).resolves.toEqual({
      status: "not-found-or-forbidden",
    });

    expect(mocks.query.mock.calls[0].slice(1)).toContain(ADMIN_NON_OWNER.id);
  });

  it("requires both cohort membership and an enabled editor for private access", async () => {
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "true";

    await expect(getOwnedMemberPageDraftV2("hamfriend")).resolves.toEqual({
      status: "not-found-or-forbidden",
    });

    expect(mocks.currentAccount).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("allows public V2 reads without cohort membership or editor availability", async () => {
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "true";
    mocks.currentAccount.mockResolvedValue(null);
    mocks.query.mockResolvedValueOnce([{
      slug: "hamfriend",
      published_doc: DOCUMENT,
    }]);

    await expect(getPublishedMemberPageV2("hamfriend")).resolves.toEqual({
      status: "success",
      data: { slug: "hamfriend", document: DOCUMENT },
    });

    expect(mocks.currentAccount).not.toHaveBeenCalled();
    expect(queryText(0)).toContain("moderation_hold = FALSE");
  });

  it("fails closed for malformed published and draft documents", async () => {
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "";
    mocks.query.mockResolvedValueOnce([{
      slug: "hamfriend",
      published_doc: { ...DOCUMENT, unexpected: true },
    }]);
    await expect(getPublishedMemberPageV2("hamfriend")).resolves.toEqual({
      status: "invalid",
    });

    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    mocks.query.mockResolvedValueOnce([{
      id: PAGE_ID,
      slug: "hamfriend",
      draft_doc: { ...DOCUMENT, unexpected: true },
      draft_rev: 0,
      is_published: false,
      moderation_hold: false,
      has_published_snapshot: false,
      draft_updated_at: NOW,
      published_at: null,
      unpublished_at: null,
    }]);
    await expect(getOwnedMemberPageDraftV2("hamfriend")).resolves.toEqual({
      status: "invalid",
    });
  });

  it("autosaves an asset-free draft with one guarded transition statement", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      draft_rev: "8",
      draft_updated_at: NOW,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT,
    )).resolves.toEqual({
      status: "success",
      draftRev: 8,
      draftUpdatedAt: NOW,
    });

    const sql = queryText(0);
    const [, ...values] = mocks.query.mock.calls[0];
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(sql).toContain(
      "INSERT INTO public.member_page_mutation_rate_limits",
    );
    expect(sql).toContain("SELECT owned_page.id, 'autosave', NOW(), 1");
    expect(sql.indexOf("FOR UPDATE OF page")).toBeLessThan(
      sql.indexOf("INSERT INTO public.member_page_mutation_rate_limits"),
    );
    expect(sql).toContain("mutation_limit.attempt_count < ?");
    expect(values).toContain(60);
    expect(values).toContain(120);
    expect(sql.match(/UPDATE public\.member_pages/gu)).toHaveLength(1);
    expect(sql).toContain("draft_doc = ?");
    expect(sql).toContain("draft_rev = page.draft_rev + 1");
    expect(sql).toContain("page.draft_rev = ?");
    expect(sql).toContain("matched_assets AS MATERIALIZED");
    expect(sql).toContain("owner_account_id = ?\n      FOR UPDATE");
    expect(sql).toContain("(SELECT COUNT(*) FROM matched_assets) = ?");
    expect(values).toContain("[]");
    expect(values).toContain(0);
    expect(sql).not.toContain("moderation_hold = FALSE");
    expect(sql).not.toContain("published_doc =");
    expect(sql).not.toContain("display_name =");
    expect(sql).not.toContain("is_published =");
  });

  it("returns a typed autosave throttle without mistaking ownership for absence", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "rate-limit",
      draft_rev: "7",
      draft_updated_at: null,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT,
    )).resolves.toEqual({ status: "rate-limit" });

    const sql = queryText(0);
    expect(sql).toContain("'rate-limit'::text AS outcome");
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM mutation_rate)");
  });

  it.each([
    ["pending", "asset.status = 'ready'"],
    ["missing", "(SELECT COUNT(*) FROM matched_assets) = ?"],
    ["foreign-page", "JOIN target ON target.id = asset.member_page_id"],
    ["deletion-claimed", "asset.deletion_claimed_at IS NULL"],
  ])("returns typed invalid for a %s referenced asset", async (_scenario, guard) => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "invalid",
      draft_rev: "7",
      draft_updated_at: null,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT_WITH_ASSET,
    )).resolves.toEqual({ status: "invalid" });

    expect(queryText(0)).toContain(guard);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("deduplicates reused asset references before applying the count guard", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      draft_rev: "8",
      draft_updated_at: NOW,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT_WITH_REUSED_ASSET,
    )).resolves.toMatchObject({ status: "success", draftRev: 8 });

    const [, ...values] = mocks.query.mock.calls[0];
    expect(values).toContain(JSON.stringify([ASSET_ID]));
    expect(values).toContain(1);
    expect(values).not.toContain(JSON.stringify([ASSET_ID, ASSET_ID]));
  });

  it("locks matched assets in the same guarded autosave statement", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      draft_rev: "8",
      draft_updated_at: NOW,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT_WITH_ASSET,
    )).resolves.toMatchObject({ status: "success" });

    const sql = queryText(0);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(sql.match(/UPDATE public\.member_pages/gu)).toHaveLength(1);
    expect(sql).toContain("matched_assets AS MATERIALIZED");
    expect(sql).toContain("ON asset.id::text = reference.asset_id");
    expect(sql).toContain("FOR SHARE OF asset");
    expect(sql.indexOf("FOR SHARE OF asset")).toBeLessThan(
      sql.indexOf("UPDATE public.member_pages page"),
    );
    expect(sql.indexOf("FOR UPDATE")).toBeLessThan(
      sql.indexOf("FOR SHARE OF asset"),
    );
    expect(sql).toContain("(SELECT COUNT(*) FROM matched_assets) = ?");
  });

  it("returns conflict before asset mismatch for a stale autosave revision", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "conflict",
      draft_rev: "8",
      draft_updated_at: null,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT_WITH_ASSET,
    )).resolves.toEqual({ status: "conflict" });

    const sql = queryText(0);
    expect(sql).toMatch(
      /CASE\s+WHEN target\.draft_rev <> \? THEN 'conflict'[\s\S]+WHEN \(SELECT COUNT\(\*\) FROM matched_assets\) <> \?[\s\S]+THEN 'invalid'/u,
    );
  });

  it("does not disclose asset existence when the target page is not owned", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_NON_OWNER);
    mocks.query.mockResolvedValueOnce([]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT_WITH_ASSET,
    )).resolves.toEqual({ status: "not-found-or-forbidden" });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0].slice(1)).toContain(ADMIN_NON_OWNER.id);
    expect(queryText(0)).toContain("JOIN target ON target.id = asset.member_page_id");
  });

  it("permits autosave while held", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      draft_rev: "8",
      draft_updated_at: NOW,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT,
    )).resolves.toEqual({
      status: "success",
      draftRev: 8,
      draftUpdatedAt: NOW,
    });

    expect(queryText(0)).not.toContain("moderation_hold");
  });

  it("blocks publish on hold before attempting the final transition", async () => {
    mocks.query.mockResolvedValueOnce([{
      draft_doc: DOCUMENT,
      draft_rev: 7,
      moderation_hold: true,
    }]);

    await expect(publishOwnedMemberPageV2("hamfriend", 7)).resolves.toEqual({
      status: "hold",
    });

    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("fails publish closed for malformed or stale drafts", async () => {
    mocks.query.mockResolvedValueOnce([{
      draft_doc: { ...DOCUMENT, unexpected: true },
      draft_rev: 7,
      moderation_hold: false,
    }]);
    await expect(publishOwnedMemberPageV2("hamfriend", 7)).resolves.toEqual({
      status: "invalid",
    });

    mocks.query.mockResolvedValueOnce([{
      draft_doc: DOCUMENT,
      draft_rev: 8,
      moderation_hold: false,
    }]);
    await expect(publishOwnedMemberPageV2("hamfriend", 7)).resolves.toEqual({
      status: "conflict",
    });
  });

  it("publishes snapshot, projection, state, and timestamp atomically", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        draft_doc: DOCUMENT_WITH_ASSET,
        draft_rev: 7,
        moderation_hold: false,
      }])
      .mockResolvedValueOnce([{
        outcome: "success",
        slug: "hamfriend",
        draft_rev: 7,
        published_at: NOW,
      }]);

    await expect(publishOwnedMemberPageV2("hamfriend", 7)).resolves.toEqual({
      status: "success",
      slug: "hamfriend",
      draftRev: 7,
      publishedAt: NOW,
    });

    const rateSql = queryText(0);
    const [, ...rateValues] = mocks.query.mock.calls[0];
    expect(rateSql).toContain(
      "INSERT INTO public.member_page_mutation_rate_limits",
    );
    expect(rateSql).toContain("SELECT owned_page.id, 'publish', NOW(), 1");
    expect(rateSql.indexOf("FOR UPDATE OF page")).toBeLessThan(
      rateSql.indexOf("INSERT INTO public.member_page_mutation_rate_limits"),
    );
    expect(rateSql).toContain("mutation_limit.attempt_count < ?");
    expect(rateValues).toContain(300);
    expect(rateValues).toContain(10);

    const sql = queryText(1);
    const [, ...values] = mocks.query.mock.calls[1];
    expect(sql.match(/UPDATE public\.member_pages/gu)).toHaveLength(1);
    expect(sql).toContain("published_doc = page.draft_doc");
    expect(sql).toContain("display_name = ?");
    expect(sql).toContain("blurb = ?");
    expect(sql).toContain("is_published = TRUE");
    expect(sql).toContain("published_at = NOW()");
    expect(sql).toContain("page.moderation_hold = FALSE");
    expect(sql).toContain("asset.status = 'ready'");
    expect(sql).toContain("asset.deletion_claimed_at IS NULL");
    expect(sql).toContain("FOR SHARE OF asset");
    expect(values).toContain(JSON.stringify([ASSET_ID]));
    expect(values).toContain("HAM Friend");
    expect(values).toContain("Makes tiny tools.");
  });

  it("returns a typed publish throttle before parsing or transitioning the draft", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "rate-limit",
      draft_doc: null,
      draft_rev: 7,
      moderation_hold: false,
    }]);

    await expect(publishOwnedMemberPageV2("hamfriend", 7)).resolves.toEqual({
      status: "rate-limit",
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(queryText(0)).toContain(
      "WHEN mutation_rate.member_page_id IS NULL THEN 'rate-limit'",
    );
  });

  it("fails publish closed when a referenced asset is not ready and unclaimed", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        draft_doc: DOCUMENT_WITH_ASSET,
        draft_rev: 7,
        moderation_hold: false,
      }])
      .mockResolvedValueOnce([{
        outcome: "invalid",
        slug: null,
        draft_rev: 7,
        published_at: null,
      }]);

    await expect(publishOwnedMemberPageV2("hamfriend", 7)).resolves.toEqual({
      status: "invalid",
    });
  });

  it("unpublishes when the loaded publication generation still matches", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      slug: "hamfriend",
      unpublished_at: NOW,
    }]);

    await expect(
      unpublishOwnedMemberPageV2("hamfriend", "2026-08-20T09:00:00.000Z"),
    ).resolves.toEqual({
      status: "success",
      slug: "hamfriend",
      unpublishedAt: NOW,
    });

    const sql = queryText(0);
    const [, ...values] = mocks.query.mock.calls[0];
    expect(sql.match(/UPDATE public\.member_pages/gu)).toHaveLength(1);
    expect(sql).toContain("is_published = FALSE");
    expect(sql).toContain("ELSE COALESCE(page.unpublished_at, NOW())");
    expect(sql).toContain(
      "page.published_at IS NOT DISTINCT FROM ?::timestamptz",
    );
    expect(values).toContain("2026-08-20T09:00:00.000Z");
    expect(sql).not.toContain("moderation_hold = FALSE");
    expect(sql).not.toContain("draft_doc =");
    expect(sql).not.toContain("published_doc =");
    expect(sql).not.toContain("draft_rev");
  });

  it("matches a null token only against a page that was never published", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      slug: "hamfriend",
      unpublished_at: NOW,
    }]);

    await expect(unpublishOwnedMemberPageV2("hamfriend", null)).resolves.toEqual({
      status: "success",
      slug: "hamfriend",
      unpublishedAt: NOW,
    });

    const [, ...values] = mocks.query.mock.calls[0];
    expect(values).toContain(null);
    expect(queryText(0)).toContain(
      "page.published_at IS NOT DISTINCT FROM ?::timestamptz",
    );
  });

  it("returns a typed conflict for a stale publication token and writes nothing", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "conflict",
      slug: null,
      unpublished_at: null,
    }]);

    await expect(
      unpublishOwnedMemberPageV2("hamfriend", "2026-08-20T09:00:00.000Z"),
    ).resolves.toEqual({ status: "conflict" });

    const sql = queryText(0);
    expect(sql).toContain("'conflict'::text AS outcome");
    expect(sql.match(/UPDATE public\.member_pages/gu)).toHaveLength(1);
    expect(sql).not.toContain("draft_doc =");
    expect(sql).not.toContain("published_doc =");
  });

  it("rejects a malformed publication token before querying", async () => {
    await expect(unpublishOwnedMemberPageV2("hamfriend", 7)).resolves.toEqual({
      status: "invalid",
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("resets to a valid published snapshot while held", async () => {
    mocks.query
      .mockResolvedValueOnce([{ published_doc: DOCUMENT, draft_rev: 7 }])
      .mockResolvedValueOnce([{
        outcome: "success",
        draft_doc: DOCUMENT,
        draft_rev: 8,
        draft_updated_at: NOW,
      }]);

    await expect(resetOwnedMemberPageDraftV2("hamfriend", 7)).resolves.toEqual({
      status: "success",
      draft: DOCUMENT,
      draftRev: 8,
      draftUpdatedAt: NOW,
    });

    const sql = queryText(1);
    expect(sql.match(/UPDATE public\.member_pages/gu)).toHaveLength(1);
    expect(sql).toContain("draft_doc = page.published_doc");
    expect(sql).toContain("page.draft_rev = ?");
    expect(sql).not.toContain("moderation_hold");
    expect(sql).not.toContain("is_published = TRUE");
  });

  it("distinguishes reset conflicts, missing snapshots, and malformed snapshots", async () => {
    mocks.query.mockResolvedValueOnce([{ published_doc: DOCUMENT, draft_rev: 8 }]);
    await expect(resetOwnedMemberPageDraftV2("hamfriend", 7)).resolves.toEqual({
      status: "conflict",
    });

    mocks.query.mockResolvedValueOnce([{ published_doc: null, draft_rev: 7 }]);
    await expect(resetOwnedMemberPageDraftV2("hamfriend", 7)).resolves.toEqual({
      status: "no-snapshot",
    });

    mocks.query.mockResolvedValueOnce([{
      published_doc: { ...DOCUMENT, unexpected: true },
      draft_rev: 7,
    }]);
    await expect(resetOwnedMemberPageDraftV2("hamfriend", 7)).resolves.toEqual({
      status: "invalid",
    });
  });

  it("never accepts the same cohort page through both mutation systems", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      draft_rev: 1,
      draft_updated_at: NOW,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      0,
      DOCUMENT,
    )).resolves.toMatchObject({ status: "success" });
    await expect(updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: null,
    })).rejects.toMatchObject({ code: "invalid" });

    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});
