import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
  revalidatePath: vi.fn(),
  createMemberPage: vi.fn(),
  reassignMemberPage: vi.fn(),
  setMemberPublication: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/db", () => ({ getDbClient: () => mocks.query }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentVerifiedAccount: mocks.currentAccount,
}));
vi.mock("@/lib/members/dal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members/dal")>();
  return {
    ...actual,
    createMemberPage: mocks.createMemberPage,
    reassignMemberPage: mocks.reassignMemberPage,
    setMemberPublication: mocks.setMemberPublication,
  };
});

import { manageMemberPageAction } from "@/app/admin/members/actions";
import {
  clearModerationHold,
  takeDownAndHold,
} from "@/lib/members/v2/moderation";

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

const INITIAL_ACTION_STATE = {
  status: "idle" as const,
  message: "",
  fieldErrors: {},
};

function moderationRow(moderationHold: boolean) {
  return {
    slug: "hamfriend",
    is_published: false,
    moderation_hold: moderationHold,
    unpublished_at: "2026-08-25T10:00:00.000Z",
    moderation_held_at: "2026-08-25T10:00:00.000Z",
    updated_at: "2026-08-25T10:05:00.000Z",
  };
}

function queryText(callIndex = 0): string {
  return mocks.query.mock.calls[callIndex][0].join("?");
}

function moderationForm(operation: string, slug = "hamfriend"): FormData {
  const formData = new FormData();
  formData.set("operation", operation);
  formData.set("slug", slug);
  formData.set("pageId", "550e8400-e29b-41d4-a716-446655440099");
  return formData;
}

describe("member V2 administrator moderation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
  });

  it("rejects signed-out and non-admin callers before mutation", async () => {
    mocks.currentAccount.mockResolvedValueOnce(null);
    await expect(takeDownAndHold("hamfriend")).rejects.toMatchObject({
      code: "unauthenticated",
    });

    mocks.currentAccount.mockResolvedValueOnce(MEMBER_ACCOUNT);
    await expect(clearModerationHold("unknown-page")).rejects.toMatchObject({
      code: "forbidden",
    });

    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("takes down by validated immutable slug and returns only moderation metadata", async () => {
    mocks.query.mockResolvedValueOnce([moderationRow(true)]);

    await expect(takeDownAndHold(" hamfriend ")).resolves.toEqual({
      slug: "hamfriend",
      isPublished: false,
      moderationHold: true,
      unpublishedAt: "2026-08-25T10:00:00.000Z",
      moderationHeldAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:05:00.000Z",
    });

    const sql = queryText();
    const [, ...values] = mocks.query.mock.calls[0];
    expect(sql).toContain("UPDATE public.member_pages");
    expect(sql).toContain("is_published = FALSE");
    expect(sql).toContain("moderation_hold = TRUE");
    expect(sql).toContain("unpublished_at = NOW()");
    expect(sql).toContain("moderation_held_at = NOW()");
    expect(sql).toContain("WHERE slug = ?");
    expect(values).toEqual(["hamfriend"]);
    expect(sql).not.toMatch(/\bSELECT\b/i);
    expect(sql).not.toMatch(/draft_doc|draft_rev|member_page_assets|object_key/i);
    expect(sql.slice(sql.indexOf("RETURNING"))).toMatch(
      /^RETURNING[\s\S]+slug,\s+is_published,\s+moderation_hold,\s+unpublished_at,\s+moderation_held_at,\s+updated_at;/,
    );
  });

  it("clears only an active hold while explicitly leaving the page unpublished", async () => {
    mocks.query.mockResolvedValueOnce([moderationRow(false)]);

    await expect(clearModerationHold("hamfriend")).resolves.toMatchObject({
      slug: "hamfriend",
      isPublished: false,
      moderationHold: false,
      moderationHeldAt: "2026-08-25T10:00:00.000Z",
    });

    const sql = queryText();
    expect(sql).toContain("is_published = FALSE");
    expect(sql).toContain("moderation_hold = FALSE");
    expect(sql).toContain("AND moderation_hold = TRUE");
    expect(sql).not.toMatch(/moderation_held_at\s*=/i);
    expect(sql).not.toMatch(/draft_doc|draft_rev|published_doc|member_page_assets/i);
  });

  it("fails closed for invalid and unknown targets without querying before validation", async () => {
    await expect(takeDownAndHold("not/a/slug")).rejects.toMatchObject({
      code: "invalid",
    });
    expect(mocks.query).not.toHaveBeenCalled();

    mocks.query.mockResolvedValueOnce([]);
    await expect(takeDownAndHold("unknown-page")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("remains available when the V2 cohort is empty and the editor is disabled", async () => {
    vi.stubEnv("MEMBER_PAGE_V2_ALLOWLIST", "");
    vi.stubEnv("MEMBER_PAGE_V2_EDITOR_DISABLED", "true");
    mocks.query.mockResolvedValueOnce([moderationRow(true)]);

    await expect(takeDownAndHold("hamfriend")).resolves.toMatchObject({
      moderationHold: true,
    });

    vi.unstubAllEnvs();
  });

  it("dispatches exact moderation intents and revalidates public paths only after takedown succeeds", async () => {
    mocks.query.mockResolvedValueOnce([moderationRow(true)]);

    await expect(
      manageMemberPageAction(
        INITIAL_ACTION_STATE,
        moderationForm("take-down-and-hold"),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "Took down /m/hamfriend and placed it on moderation hold.",
      fieldErrors: {},
    });
    expect(mocks.query.mock.calls[0][1]).toBe("hamfriend");
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/admin/members",
      "/members",
      "/api/members",
      "/m/hamfriend",
    ]);

    vi.clearAllMocks();
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query.mockResolvedValueOnce([]);
    await expect(
      manageMemberPageAction(
        INITIAL_ACTION_STATE,
        moderationForm("take-down-and-hold", "unknown-page"),
      ),
    ).resolves.toMatchObject({ status: "error" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("clears a hold without public-list revalidation and rejects inexact intents", async () => {
    mocks.query.mockResolvedValueOnce([moderationRow(false)]);

    await expect(
      manageMemberPageAction(
        INITIAL_ACTION_STATE,
        moderationForm("clear-hold"),
      ),
    ).resolves.toEqual({
      status: "success",
      message:
        "Cleared the moderation hold for /m/hamfriend. The page remains unpublished.",
      fieldErrors: {},
    });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/admin/members",
      "/m/hamfriend",
    ]);

    vi.clearAllMocks();
    await expect(
      manageMemberPageAction(
        INITIAL_ACTION_STATE,
        moderationForm("clear-hold "),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "Choose a valid page action.",
      fieldErrors: {},
    });
    expect(mocks.currentAccount).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
