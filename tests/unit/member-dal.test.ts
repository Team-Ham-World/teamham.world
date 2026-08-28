import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
  openGraphImage: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => "development" }));
vi.mock("@/lib/auth/db", () => ({ getDbClient: () => mocks.query }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentVerifiedAccount: mocks.currentAccount,
}));
vi.mock("@/lib/members/open-graph", () => ({
  findOpenGraphImage: mocks.openGraphImage,
}));

import {
  createMemberPage,
  getAdminMemberManagementData,
  getMemberPageForViewer,
  listPublishedMembers,
  MemberAccessError,
  reassignMemberPage,
  requireAdmin,
  setMemberPublication,
  updateOwnedMemberPage,
} from "@/lib/members/dal";
import { updateMemberPageAction } from "@/app/m/[member]/actions";

const MEMBER_ACCOUNT = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  accessStatus: "active" as const,
  membershipStatus: "eligible" as const,
  expiresAt: new Date(Date.now() + 60_000),
  username: "hamfriend",
  siteRole: "member" as const,
};

const ADMIN_ACCOUNT = {
  ...MEMBER_ACCOUNT,
  id: "550e8400-e29b-41d4-a716-446655440001",
  siteRole: "admin" as const,
};

const PAGE_ID = "550e8400-e29b-41d4-a716-446655440010";
const IMPORTED_ARTWORK_ASSET_ID = "550e8400-e29b-41d4-a716-446655440020";

function importedExternalArtworkDraft(input: {
  url?: string;
  repository?: string;
  assetId?: string;
}) {
  return {
    schemaVersion: 2,
    frame: {
      displayName: "HAM Friend",
      summary: null,
      websiteUrl: null,
      socialLinks: {},
      portrait: null,
      theme: { id: "paper", accentId: "default" },
    },
    blocks: [{
      id: `legacy-featured-${PAGE_ID}`,
      type: "featuredProject",
      variant: "card",
      project: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        ...(input.url ? { url: input.url } : {}),
        ...(input.repository ? { repository: input.repository } : {}),
        artwork: {
          assetId: input.assetId ?? IMPORTED_ARTWORK_ASSET_ID,
          alt: "Imported Weekend Thing artwork",
          decorative: false,
        },
      },
    }],
  };
}

const ORIGINAL_V2_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_V2_EDITOR_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("member data access authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMBER_PAGE_V2_ALLOWLIST;
    delete process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;
    mocks.currentAccount.mockResolvedValue(MEMBER_ACCOUNT);
    mocks.openGraphImage.mockResolvedValue(null);
  });

  afterEach(() => {
    restoreEnvironmentVariable("MEMBER_PAGE_V2_ALLOWLIST", ORIGINAL_V2_ALLOWLIST);
    restoreEnvironmentVariable(
      "MEMBER_PAGE_V2_EDITOR_DISABLED",
      ORIGINAL_V2_EDITOR_DISABLED,
    );
  });

  it("requires an administrator before admin mutations can reach SQL", async () => {
    await expect(requireAdmin()).rejects.toMatchObject({ code: "forbidden" });
    await expect(createMemberPage({
      ownerAccountId: MEMBER_ACCOUNT.id,
      slug: "hamfriend",
      displayName: "HAM Friend",
      isPublished: false,
    })).rejects.toBeInstanceOf(MemberAccessError);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects reserved slugs before an admin creation query", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    await expect(createMemberPage({
      ownerAccountId: MEMBER_ACCOUNT.id,
      slug: "api",
      displayName: "HAM Friend",
      isPublished: false,
    })).rejects.toMatchObject({ code: "invalid" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("lets an admin create, publish, and reassign through separately authorized queries", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query
      .mockResolvedValueOnce([{ slug: "hamfriend" }])
      .mockResolvedValueOnce([{ slug: "hamfriend", moderation_hold: false }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await expect(createMemberPage({
      ownerAccountId: MEMBER_ACCOUNT.id,
      slug: "hamfriend",
      displayName: "HAM Friend",
      isPublished: false,
    })).resolves.toBe("hamfriend");
    await expect(setMemberPublication(
      "550e8400-e29b-41d4-a716-446655440010",
      true,
    )).resolves.toBe("hamfriend");
    await expect(reassignMemberPage(
      "550e8400-e29b-41d4-a716-446655440010",
      MEMBER_ACCOUNT.id,
    )).resolves.toBe("hamfriend");

    expect(mocks.currentAccount).toHaveBeenCalledTimes(3);
    expect(mocks.query).toHaveBeenCalledTimes(4);
  });

  it("binds owner updates to both the slug and the verified account id", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        id: "550e8400-e29b-41d4-a716-446655440010",
        slug: "hamfriend",
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);
    await expect(updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: "Makes tiny tools.",
      websiteUrl: "https://hamfriend.example",
      socialLinks: { github: "https://github.com/hamfriend" },
      showcase: null,
    })).resolves.toBe("hamfriend");

    const [strings, ...values] = mocks.query.mock.calls[1];
    expect(strings.join("?")).toContain("WHERE slug = ?");
    expect(strings.join("?")).toContain("owner_account_id = ?");
    expect(strings.join("?")).toContain("draft_doc = ?");
    expect(strings.join("?")).toContain("draft_rev = draft_rev + 1");
    expect(strings.join("?")).toContain("WHEN is_published THEN ?");
    expect(strings.join("?")).toContain("ELSE published_doc");
    expect(values).toContain("hamfriend");
    expect(values).toContain(MEMBER_ACCOUNT.id);
    expect(values).toContainEqual({ github: "https://github.com/hamfriend" });
    expect(values).toContainEqual(expect.objectContaining({
      schemaVersion: 2,
      frame: expect.objectContaining({
        displayName: "HAM Friend",
        summary: "Makes tiny tools.",
      }),
    }));
  });

  it("canonicalizes legacy fields before the atomic V1/V2 bridge write", async () => {
    mocks.query
      .mockResolvedValueOnce([{ id: PAGE_ID, slug: "hamfriend", draft_doc: null }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await updateOwnedMemberPage("hamfriend", {
      displayName: "\u00a0Cafe\u0301 HAM\ufeff",
      blurb: "\u2007Makes cafe\u0301 tools.\u205f",
      websiteUrl: "\u3000https://example.com/cafe\u0301\u202f",
      socialLinks: { x: "\u1680https://x.com/cafe\u0301\u2000" },
      showcase: null,
    });

    const [, ...values] = mocks.query.mock.calls[1];
    expect(values).toContain("Café HAM");
    expect(values).toContain("Makes café tools.");
    expect(values).toContain("https://example.com/café");
    expect(values).toContainEqual({ x: "https://x.com/café" });
    expect(values).toContainEqual(expect.objectContaining({
      frame: expect.objectContaining({
        displayName: "Café HAM",
        summary: "Makes café tools.",
        websiteUrl: "https://example.com/café",
        socialLinks: { x: "https://x.com/café" },
      }),
    }));
  });

  it("rejects legacy controls before any bridge query", async () => {
    await expect(updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: "line one\nline two",
      websiteUrl: null,
      socialLinks: {},
      showcase: null,
    })).rejects.toMatchObject({ code: "invalid" });

    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not discover or store Open Graph artwork during legacy saves", async () => {
    mocks.openGraphImage.mockResolvedValueOnce("https://cdn.example.com/card.jpg");
    mocks.query
      .mockResolvedValueOnce([{
        id: "550e8400-e29b-41d4-a716-446655440010",
        slug: "hamfriend",
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await expect(updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        url: "https://example.com/weekend-thing",
      },
    })).resolves.toBe("hamfriend");

    expect(mocks.openGraphImage).not.toHaveBeenCalled();
    const [, ...values] = mocks.query.mock.calls[1];
    expect(values).toContainEqual({
      kind: "external",
      name: "Weekend Thing",
      shortDescription: "Made over a weekend.",
      type: "tool",
      status: "released",
      url: "https://example.com/weekend-thing",
    });
    expect(JSON.stringify(values)).not.toContain("cdn.example.com/card.jpg");
  });

  it("rejects non-owner saves without Open Graph work", async () => {
    mocks.query.mockResolvedValueOnce([]);

    await expect(updateOwnedMemberPage("somebody-else", {
      displayName: "Wrong Owner",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        url: "https://example.com/weekend-thing",
      },
    })).rejects.toMatchObject({ code: "forbidden" });

    expect(mocks.openGraphImage).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("strips explicit remote artwork from legacy and V2 storage", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        id: "550e8400-e29b-41d4-a716-446655440010",
        slug: "hamfriend",
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        url: "https://example.com/weekend-thing",
        imageUrl: "https://images.example.com/hand-picked.jpg",
      },
    });

    expect(mocks.openGraphImage).not.toHaveBeenCalled();
    const [, ...values] = mocks.query.mock.calls[1];
    expect(values).toContainEqual({
      kind: "external",
      name: "Weekend Thing",
      shortDescription: "Made over a weekend.",
      type: "tool",
      status: "released",
      url: "https://example.com/weekend-thing",
    });
    expect(JSON.stringify(values)).not.toContain(
      "https://images.example.com/hand-picked.jpg",
    );
    expect(JSON.stringify(values)).not.toContain("imageUrl");
    const draftDocument = values.find((value) =>
      typeof value === "object" && value !== null && "schemaVersion" in value
    );
    expect(draftDocument).toMatchObject({
      blocks: [{
        type: "featuredProject",
        project: {
          kind: "external",
          name: "Weekend Thing",
        },
      }],
    });
    expect(JSON.stringify(draftDocument)).not.toContain("artwork");
  });

  it("preserves imported artwork for the same normalized external URL", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        id: PAGE_ID,
        slug: "hamfriend",
        draft_doc: importedExternalArtworkDraft({
          url: "https://EXAMPLE.com:443/weekend-thing",
        }),
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: {
        kind: "external",
        name: "Weekend Thing renamed",
        shortDescription: "Updated description.",
        type: "tool",
        status: "released",
        url: "https://example.com/weekend-thing",
        imageUrl: "https://remote.example/drop-this.png",
      },
    });

    expect(mocks.query.mock.calls[0][0].join("?")).toContain(
      "SELECT id, slug, draft_doc",
    );
    const [strings, ...values] = mocks.query.mock.calls[1];
    const documents = values.filter((value) =>
      typeof value === "object" && value !== null && "schemaVersion" in value
    );
    expect(documents).toHaveLength(2);
    expect(documents[0]).toEqual(documents[1]);
    expect(documents[0]).toMatchObject({
      blocks: [{
        project: {
          kind: "external",
          name: "Weekend Thing renamed",
          artwork: {
            assetId: IMPORTED_ARTWORK_ASSET_ID,
            alt: "Imported Weekend Thing artwork",
            decorative: false,
          },
        },
      }],
    });
    expect(strings.join("?")).toContain("WHEN is_published THEN ?");
    expect(strings.join("?")).toContain("ELSE published_doc");
    expect(JSON.stringify(values)).not.toContain("remote.example/drop-this.png");
    expect(JSON.stringify(values)).not.toContain("imageUrl");
  });

  it("falls back to an exact normalized repository match", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        id: PAGE_ID,
        slug: "hamfriend",
        draft_doc: importedExternalArtworkDraft({
          url: "https://old.example/weekend-thing",
          repository: "https://GITHUB.com:443/teamham/weekend-thing",
        }),
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        url: "https://new.example/weekend-thing",
        repository: "https://github.com/teamham/weekend-thing",
      },
    });

    const [, ...values] = mocks.query.mock.calls[1];
    expect(values).toContainEqual(expect.objectContaining({
      blocks: [expect.objectContaining({
        project: expect.objectContaining({
          artwork: {
            assetId: IMPORTED_ARTWORK_ASSET_ID,
            alt: "Imported Weekend Thing artwork",
            decorative: false,
          },
        }),
      })],
    }));
  });

  it("preserves imported artwork for an unchanged linkless external project", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        id: PAGE_ID,
        slug: "hamfriend",
        draft_doc: importedExternalArtworkDraft({}),
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
      },
    });

    const [, ...values] = mocks.query.mock.calls[1];
    expect(values).toContainEqual(expect.objectContaining({
      blocks: [expect.objectContaining({
        project: expect.objectContaining({
          artwork: {
            assetId: IMPORTED_ARTWORK_ASSET_ID,
            alt: "Imported Weekend Thing artwork",
            decorative: false,
          },
        }),
      })],
    }));
  });

  it("drops imported artwork when the external project identity changes", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        id: PAGE_ID,
        slug: "hamfriend",
        draft_doc: importedExternalArtworkDraft({
          url: "https://example.com/weekend-thing",
          repository: "https://github.com/teamham/weekend-thing",
        }),
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: {
        kind: "external",
        name: "Different Project",
        shortDescription: "A different project.",
        type: "game",
        status: "playable",
        url: "https://example.com/different-project",
        repository: "https://github.com/teamham/different-project",
      },
    });

    const [, ...values] = mocks.query.mock.calls[1];
    const documents = values.filter((value) =>
      typeof value === "object" && value !== null && "schemaVersion" in value
    );
    expect(documents).toHaveLength(2);
    for (const document of documents) {
      expect(JSON.stringify(document)).not.toContain("artwork");
      expect(JSON.stringify(document)).not.toContain(IMPORTED_ARTWORK_ASSET_ID);
    }
  });

  it("fails closed and drops artwork when the canonical draft is malformed", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        id: PAGE_ID,
        slug: "hamfriend",
        draft_doc: {
          ...importedExternalArtworkDraft({
            url: "https://example.com/weekend-thing",
          }),
          unexpected: true,
        },
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await expect(updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        url: "https://example.com/weekend-thing",
      },
    })).resolves.toBe("hamfriend");

    const [, ...values] = mocks.query.mock.calls[1];
    const documents = values.filter((value) =>
      typeof value === "object" && value !== null && "schemaVersion" in value
    );
    expect(documents).toHaveLength(2);
    expect(JSON.stringify(documents)).not.toContain("artwork");
    expect(JSON.stringify(documents)).not.toContain(IMPORTED_ARTWORK_ASSET_ID);
  });

  it("fails a forged slug without revealing whether another page exists", async () => {
    mocks.query.mockResolvedValueOnce([]);
    await expect(updateOwnedMemberPage("somebody-else", {
      displayName: "Wrong Owner",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: null,
    })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("returns only the minimal published directory DTO", async () => {
    mocks.query.mockResolvedValueOnce([{
      slug: "hamfriend",
      display_name: "HAM Friend",
      blurb: "Makes tiny tools.",
      owner_account_id: MEMBER_ACCOUNT.id,
      is_published: true,
    }]);
    await expect(listPublishedMembers()).resolves.toEqual([{
      slug: "hamfriend",
      displayName: "HAM Friend",
      blurb: "Makes tiny tools.",
    }]);
    expect(mocks.query.mock.calls[0][0].join("?")).toContain("is_published = TRUE");
    expect(mocks.query.mock.calls[0][0].join("?")).toContain(
      "moderation_hold = FALSE",
    );
  });

  it("fails closed when persisted public content no longer passes write validation", async () => {
    mocks.query.mockResolvedValueOnce([{
      slug: "hamfriend",
      display_name: "HAM Friend",
      blurb: null,
      website_url: "http://insecure.example",
      social_links: {},
      showcase: null,
      owner_account_id: MEMBER_ACCOUNT.id,
      is_published: true,
      moderation_hold: false,
    }]);

    await expect(getMemberPageForViewer("hamfriend")).rejects.toThrow(
      "Malformed member-page content",
    );
  });

  it("seeds every new page with a canonical Paper V2 draft", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query.mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await createMemberPage({
      ownerAccountId: MEMBER_ACCOUNT.id,
      slug: "hamfriend",
      displayName: "HAM Friend",
      isPublished: false,
    });

    const [strings, ...values] = mocks.query.mock.calls[0];
    expect(strings.join("?")).toContain("draft_doc");
    expect(strings.join("?")).toContain("published_doc");
    const documents = values.filter((value) =>
      typeof value === "object" && value !== null && "schemaVersion" in value
    );
    expect(documents).toEqual([{
      schemaVersion: 2,
      frame: {
        displayName: "HAM Friend",
        summary: null,
        websiteUrl: null,
        socialLinks: {},
        portrait: null,
        theme: { id: "paper", accentId: "default" },
      },
      blocks: [],
    }]);
    expect(values).toContain(null);
  });

  it("seeds an identical published snapshot for legacy immediate publication", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query.mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await createMemberPage({
      ownerAccountId: MEMBER_ACCOUNT.id,
      slug: "hamfriend",
      displayName: "HAM Friend",
      isPublished: true,
    });

    const [strings, ...values] = mocks.query.mock.calls[0];
    const documents = values.filter((value) =>
      typeof value === "object" && value !== null && "schemaVersion" in value
    );
    expect(documents).toHaveLength(2);
    expect(documents[0]).toEqual(documents[1]);
    expect(strings.join("?")).toContain("CASE WHEN ? THEN NOW() ELSE NULL END");
  });

  it("rejects cohort legacy saves even while the V2 editor is disabled", async () => {
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "true";

    await expect(updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: null,
      websiteUrl: null,
      socialLinks: {},
      showcase: null,
    })).rejects.toMatchObject({ code: "invalid" });

    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.openGraphImage).not.toHaveBeenCalled();
  });

  it("rejects cohort legacy admin publication before the update statement", async () => {
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "true";
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query.mockResolvedValueOnce([{
      slug: "hamfriend",
      moderation_hold: false,
    }]);

    await expect(setMemberPublication(
      "550e8400-e29b-41d4-a716-446655440010",
      true,
    )).rejects.toMatchObject({ code: "invalid" });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0].join("?")).toContain("SELECT slug");
  });

  it("keeps legacy publication documents, projection, and timestamps in one update", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query
      .mockResolvedValueOnce([{
        slug: "hamfriend",
        moderation_hold: false,
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await setMemberPublication(
      "550e8400-e29b-41d4-a716-446655440010",
      true,
    );

    const sql = mocks.query.mock.calls[1][0].join("?");
    expect(sql).toContain("published_doc = CASE");
    expect(sql).toContain("display_name = CASE");
    expect(sql).toContain("blurb = CASE");
    expect(sql).toContain("published_at = CASE");
    expect(sql).toContain("unpublished_at = CASE");
    expect(sql).toContain("draft_doc = jsonb_build_object");
    expect(sql).toContain("NORMALIZE(display_name, NFC)");
    expect(sql).toContain("NORMALIZE(social_links->>'github', NFC)");
    expect(sql).toContain("NORMALIZE(showcase->>'name', NFC)");
  });

  it("allows only verified same-page imported artwork through legacy publication", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query
      .mockResolvedValueOnce([{
        slug: "hamfriend",
        moderation_hold: false,
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await setMemberPublication(PAGE_ID, true);

    const lookupSql = mocks.query.mock.calls[0][0].join("?");
    const publicationSql = mocks.query.mock.calls[1][0].join("?");
    // The lookup now fetches both stored documents for the legacy
    // representability guard; artwork verification itself stays in SQL.
    expect(lookupSql).toContain("draft_doc");
    expect(lookupSql).toContain("published_doc");
    expect(publicationSql).toContain("'artwork', CASE");
    expect(publicationSql).toContain("asset.member_page_id = member_pages.id");
    expect(publicationSql).toContain("asset.status = 'ready'");
    expect(publicationSql).toContain("asset.deletion_claimed_at IS NULL");
    expect(publicationSql).toContain(
      "THEN draft_doc #> '{blocks,0,project,artwork}'",
    );
  });

  it("keeps admin and public query shapes free of drafts and private assets", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query
      .mockResolvedValueOnce([{
        id: MEMBER_ACCOUNT.id,
        discord_username: "hamfriend",
        has_page: true,
        assigned_page_slug: "hamfriend",
      }])
      .mockResolvedValueOnce([{
        id: "550e8400-e29b-41d4-a716-446655440010",
        slug: "hamfriend",
        display_name: "HAM Friend",
        is_published: false,
        moderation_hold: true,
        published_at: null,
        unpublished_at: "2026-08-25T10:00:00.000Z",
        moderation_held_at: "2026-08-25T10:00:00.000Z",
        owner_account_id: MEMBER_ACCOUNT.id,
        owner_username: "hamfriend",
      }]);

    await expect(getAdminMemberManagementData()).resolves.toEqual({
      accounts: [{
        id: MEMBER_ACCOUNT.id,
        username: "hamfriend",
        hasPage: true,
        assignedPageSlug: "hamfriend",
      }],
      pages: [expect.objectContaining({
        slug: "hamfriend",
        moderationHold: true,
        isV2Cohort: false,
      })],
    });

    const queryText = mocks.query.mock.calls
      .map(([strings]) => strings.join("?"))
      .join("\n");
    expect(queryText).not.toContain("draft_doc");
    expect(queryText).not.toContain("member_page_assets");
    expect(queryText).not.toContain("object_key");
    expect(queryText).toContain("moderation_hold");
  });

  it("rejects cohort legacy actions before DAL or Open Graph work", async () => {
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "true";
    const formData = new FormData();
    formData.set("slug", "hamfriend");
    formData.set("displayName", "HAM Friend");
    formData.set("showcaseKind", "external");
    formData.set("showcaseName", "Weekend Thing");
    formData.set("showcaseDescription", "Made over a weekend.");
    formData.set("showcaseType", "tool");
    formData.set("showcaseStatus", "released");
    formData.set("showcaseUrl", "https://example.com/weekend-thing");

    await expect(updateMemberPageAction(
      { status: "idle", message: "", fieldErrors: {} },
      formData,
    )).resolves.toMatchObject({ status: "error" });

    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.openGraphImage).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves legacy action success and public path revalidation", async () => {
    mocks.query
      .mockResolvedValueOnce([{
        id: "550e8400-e29b-41d4-a716-446655440010",
        slug: "hamfriend",
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);
    const formData = new FormData();
    formData.set("slug", "hamfriend");
    formData.set("displayName", "HAM Friend");
    formData.set("showcaseKind", "none");

    await expect(updateMemberPageAction(
      { status: "idle", message: "", fieldErrors: {} },
      formData,
    )).resolves.toEqual({
      status: "success",
      message: "Your page is saved.",
      fieldErrors: {},
    });

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/m/hamfriend");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/members");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/api/members");
  });
});
