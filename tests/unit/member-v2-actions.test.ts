import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";

const mocks = vi.hoisted(() => ({
  autosave: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  reset: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/members/v2/dal", () => ({
  autosaveOwnedMemberPageDraftV2: mocks.autosave,
  publishOwnedMemberPageV2: mocks.publish,
  unpublishOwnedMemberPageV2: mocks.unpublish,
  resetOwnedMemberPageDraftV2: mocks.reset,
}));

import {
  autosaveMemberPageV2Action,
  publishMemberPageV2Action,
  resetMemberPageV2Action,
  unpublishMemberPageV2Action,
} from "@/app/m/[member]/v2-actions";

const NOW = "2026-08-25T12:00:00.000Z";
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

function expectSerializable(value: unknown): void {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
}

function expectPublicPaths(): void {
  expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
  expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/m/hamfriend");
  expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/members");
  expect(mocks.revalidatePath).toHaveBeenNthCalledWith(3, "/api/members");
}

describe("member V2 owner Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      dal: {
        status: "success",
        draftRev: 8,
        draftUpdatedAt: NOW,
      },
      action: {
        status: "saved",
        message: "Saved.",
        fieldErrors: {},
        draftRev: 8,
        draftUpdatedAt: NOW,
      },
    },
    {
      dal: { status: "conflict" },
      action: {
        status: "conflict",
        message: "Conflict detected.",
        fieldErrors: {},
      },
    },
    {
      dal: { status: "rate-limit" },
      action: {
        status: "rate-limit",
        message:
          "Saving is paused because changes are arriving too quickly. Wait a minute, then retry.",
        fieldErrors: {},
      },
    },
    {
      dal: { status: "invalid" },
      action: {
        status: "invalid",
        message: "Save failed.",
        fieldErrors: {
          document: "Review the page content and try again.",
        },
      },
    },
    {
      dal: { status: "not-found-or-forbidden" },
      action: {
        status: "unavailable",
        message: "Save unavailable.",
        fieldErrors: {},
      },
    },
  ])("maps autosave DAL status $dal.status", async ({ dal, action }) => {
    mocks.autosave.mockResolvedValueOnce(dal);

    const result = await autosaveMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
      document: DOCUMENT,
    });

    expect(mocks.autosave).toHaveBeenCalledOnce();
    expect(mocks.autosave).toHaveBeenCalledWith("hamfriend", 7, DOCUMENT);
    expect(result).toEqual(action);
    expectSerializable(result);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    {
      dal: {
        status: "success",
        slug: "hamfriend",
        draftRev: 7,
        publishedAt: NOW,
      },
      action: {
        status: "published",
        message: "Published.",
        fieldErrors: {},
        slug: "hamfriend",
        draftRev: 7,
        publishedAt: NOW,
      },
      revalidates: true,
    },
    {
      dal: { status: "conflict" },
      action: {
        status: "conflict",
        message: "Conflict detected.",
        fieldErrors: {},
      },
      revalidates: false,
    },
    {
      dal: { status: "hold" },
      action: {
        status: "hold",
        message: "Publishing is blocked by a moderation hold.",
        fieldErrors: {},
      },
      revalidates: false,
    },
    {
      dal: { status: "rate-limit" },
      action: {
        status: "rate-limit",
        message:
          "Publishing is moving too quickly. Wait a few minutes, then try again.",
        fieldErrors: {},
      },
      revalidates: false,
    },
    {
      dal: { status: "invalid" },
      action: {
        status: "invalid",
        message: "Publish failed.",
        fieldErrors: { document: "Review the draft and try again." },
      },
      revalidates: false,
    },
    {
      dal: { status: "not-found-or-forbidden" },
      action: {
        status: "unavailable",
        message: "Publish unavailable.",
        fieldErrors: {},
      },
      revalidates: false,
    },
  ])("maps publish DAL status $dal.status", async ({
    dal,
    action,
    revalidates,
  }) => {
    mocks.publish.mockResolvedValueOnce(dal);

    const result = await publishMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
    });

    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledWith("hamfriend", 7);
    expect(result).toEqual(action);
    expectSerializable(result);
    if (revalidates) expectPublicPaths();
    else expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    {
      dal: { status: "success", slug: "hamfriend", unpublishedAt: NOW },
      action: {
        status: "unpublished",
        message: "Unpublished.",
        fieldErrors: {},
        slug: "hamfriend",
        unpublishedAt: NOW,
      },
      revalidates: true,
    },
    {
      dal: { status: "invalid" },
      action: {
        status: "invalid",
        message: "Unpublish failed.",
        fieldErrors: {},
      },
      revalidates: false,
    },
    {
      dal: { status: "not-found-or-forbidden" },
      action: {
        status: "unavailable",
        message: "Unpublish unavailable.",
        fieldErrors: {},
      },
      revalidates: false,
    },
  ])("maps unpublish DAL status $dal.status", async ({
    dal,
    action,
    revalidates,
  }) => {
    mocks.unpublish.mockResolvedValueOnce(dal);

    const result = await unpublishMemberPageV2Action({ slug: "hamfriend" });

    expect(mocks.unpublish).toHaveBeenCalledOnce();
    expect(mocks.unpublish).toHaveBeenCalledWith("hamfriend");
    expect(result).toEqual(action);
    expectSerializable(result);
    if (revalidates) expectPublicPaths();
    else expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    {
      dal: {
        status: "success",
        draft: DOCUMENT,
        draftRev: 8,
        draftUpdatedAt: NOW,
      },
      action: {
        status: "reset",
        message: "Draft reset.",
        fieldErrors: {},
        document: DOCUMENT,
        draftRev: 8,
        draftUpdatedAt: NOW,
      },
    },
    {
      dal: { status: "conflict" },
      action: {
        status: "conflict",
        message: "Conflict detected.",
        fieldErrors: {},
      },
    },
    {
      dal: { status: "no-snapshot" },
      action: {
        status: "no-snapshot",
        message: "No published snapshot is available.",
        fieldErrors: {},
      },
    },
    {
      dal: { status: "invalid" },
      action: {
        status: "invalid",
        message: "Reset failed.",
        fieldErrors: {},
      },
    },
    {
      dal: { status: "not-found-or-forbidden" },
      action: {
        status: "unavailable",
        message: "Reset unavailable.",
        fieldErrors: {},
      },
    },
  ])("maps reset DAL status $dal.status", async ({ dal, action }) => {
    mocks.reset.mockResolvedValueOnce(dal);

    const result = await resetMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
    });

    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(mocks.reset).toHaveBeenCalledWith("hamfriend", 7);
    expect(result).toEqual(action);
    expectSerializable(result);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      "autosave object",
      () => autosaveMemberPageV2Action(null as never),
      "autosave",
    ],
    [
      "autosave document",
      () => autosaveMemberPageV2Action({
        slug: "hamfriend",
        expectedDraftRev: 7,
        document: [] as never,
      }),
      "autosave",
    ],
    [
      "publish revision",
      () => publishMemberPageV2Action({
        slug: "hamfriend",
        expectedDraftRev: "7",
      } as never),
      "publish",
    ],
    [
      "unpublish slug",
      () => unpublishMemberPageV2Action({ slug: "Not A Slug" }),
      "unpublish",
    ],
    [
      "reset revision",
      () => resetMemberPageV2Action({
        slug: "hamfriend",
        expectedDraftRev: -1,
      }),
      "reset",
    ],
  ])("rejects malformed $0 without DAL delegation", async (
    _label,
    invoke,
    dalName,
  ) => {
    const result = await invoke();

    expect(result.status).toBe("invalid");
    expect(mocks[dalName as "autosave" | "publish" | "unpublish" | "reset"])
      .not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expectSerializable(result);
  });

  it.each([
    [
      "ownerAccountId",
      () => autosaveMemberPageV2Action({
        slug: "hamfriend",
        expectedDraftRev: 7,
        document: DOCUMENT,
        ownerAccountId: "550e8400-e29b-41d4-a716-446655440000",
      } as never),
    ],
    [
      "pageId",
      () => publishMemberPageV2Action({
        slug: "hamfriend",
        expectedDraftRev: 7,
        pageId: "550e8400-e29b-41d4-a716-446655440010",
      } as never),
    ],
    [
      "ownerId",
      () => unpublishMemberPageV2Action({
        slug: "hamfriend",
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
      } as never),
    ],
    [
      "isOwner",
      () => resetMemberPageV2Action({
        slug: "hamfriend",
        expectedDraftRev: 7,
        isOwner: true,
      } as never),
    ],
  ])("rejects client authority field %s", async (_field, invoke) => {
    const result = await invoke();

    expect(result.status).toBe("invalid");
    expect(mocks.autosave).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.unpublish).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("surfaces cohort and kill-switch rejection without distinguishing existence", async () => {
    mocks.autosave.mockResolvedValue({ status: "not-found-or-forbidden" });

    const first = await autosaveMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
      document: DOCUMENT,
    });
    const second = await autosaveMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
      document: DOCUMENT,
    });

    expect(first).toEqual({
      status: "unavailable",
      message: "Save unavailable.",
      fieldErrors: {},
    });
    expect(second).toEqual(first);
    expect(mocks.autosave).toHaveBeenCalledTimes(2);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("lets unexpected DAL errors propagate", async () => {
    const error = new Error("unexpected");
    mocks.publish.mockRejectedValueOnce(error);

    await expect(publishMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
    })).rejects.toBe(error);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
