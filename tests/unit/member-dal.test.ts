import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
  openGraphImage: vi.fn(),
}));

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
  getMemberPageForViewer,
  listPublishedMembers,
  MemberAccessError,
  reassignMemberPage,
  requireAdmin,
  setMemberPublication,
  updateOwnedMemberPage,
} from "@/lib/members/dal";

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

describe("member data access authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentAccount.mockResolvedValue(MEMBER_ACCOUNT);
    mocks.openGraphImage.mockResolvedValue(null);
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
    expect(mocks.query).toHaveBeenCalledTimes(3);
  });

  it("binds owner updates to both the slug and the verified account id", async () => {
    mocks.query.mockResolvedValueOnce([{ slug: "hamfriend" }]);
    await expect(updateOwnedMemberPage("hamfriend", {
      displayName: "HAM Friend",
      blurb: "Makes tiny tools.",
      websiteUrl: "https://hamfriend.example",
      socialLinks: { github: "https://github.com/hamfriend" },
      showcase: null,
    })).resolves.toBe("hamfriend");

    const [strings, ...values] = mocks.query.mock.calls[0];
    expect(strings.join("?")).toContain("WHERE slug = ?");
    expect(strings.join("?")).toContain("owner_account_id = ?");
    expect(values).toContain("hamfriend");
    expect(values).toContain(MEMBER_ACCOUNT.id);
    expect(values).toContainEqual({ github: "https://github.com/hamfriend" });
  });

  it("stores an Open Graph artwork fallback after authorization", async () => {
    mocks.openGraphImage.mockResolvedValueOnce("https://cdn.example.com/card.jpg");
    mocks.query
      .mockResolvedValueOnce([{ slug: "hamfriend" }])
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

    expect(mocks.openGraphImage).toHaveBeenCalledWith(
      "https://example.com/weekend-thing",
    );
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openGraphImage.mock.invocationCallOrder[0],
    );
    const [, ...values] = mocks.query.mock.calls[1];
    expect(values).toContainEqual({
      kind: "external",
      name: "Weekend Thing",
      shortDescription: "Made over a weekend.",
      type: "tool",
      status: "released",
      url: "https://example.com/weekend-thing",
      imageUrl: "https://cdn.example.com/card.jpg",
    });
  });

  it("does not discover artwork until ownership is verified", async () => {
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

  it("keeps explicit artwork and skips Open Graph discovery", async () => {
    mocks.query.mockResolvedValueOnce([{ slug: "hamfriend" }]);

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
    }]);

    await expect(getMemberPageForViewer("hamfriend")).rejects.toThrow(
      "Malformed member-page content",
    );
  });
});
