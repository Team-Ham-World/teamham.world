import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { R2StorageAdapter } from "@/lib/members/assets/types";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => "development" }));
vi.mock("@/lib/auth/db", () => ({ getDbClient: () => mocks.query }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentVerifiedAccount: mocks.currentAccount,
}));
vi.mock("@/lib/members/assets/verify", () => ({
  verifyStoredMemberAsset: mocks.verify,
}));

import {
  MEMBER_ASSET_PUBLIC_METADATA_DEGRADED_LIMIT,
  deleteOwnedMemberPageAsset,
  getPublicMemberPageAssetMetadata,
  readMemberPageAssetForServing,
} from "@/lib/members/assets/dal";

const OWNER = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  accessStatus: "active" as const,
  membershipStatus: "eligible" as const,
  expiresAt: new Date(Date.now() + 60_000),
  username: "hamfriend",
  siteRole: "member" as const,
};
const VALID_ID = "550e8400-e29b-41d4-a716-446655440020";
const DEGRADED_ID = "550e8400-e29b-41d4-a716-446655440021";
const UNREQUESTED_ID = "550e8400-e29b-41d4-a716-446655440099";
const OBJECT_KEY =
  `member-page-assets/${"A".repeat(24)}/68-png-${"B".repeat(43)}`;
const ORIGINAL_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_EDITOR_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
  process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "false";
  mocks.currentAccount.mockResolvedValue(OWNER);
});

afterEach(() => {
  restoreEnvironmentVariable("MEMBER_PAGE_V2_ALLOWLIST", ORIGINAL_ALLOWLIST);
  restoreEnvironmentVariable(
    "MEMBER_PAGE_V2_EDITOR_DISABLED",
    ORIGINAL_EDITOR_DISABLED,
  );
});

function validRow(id: string = VALID_ID) {
  return { id, mime_type: "image/png", width: 2, height: 3 };
}

function makeStorage(): R2StorageAdapter {
  return {
    createPresignedPut: vi.fn(),
    headObject: vi.fn(),
    getObjectRange: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
}

function cleanupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_ID,
    object_key: OBJECT_KEY,
    status: "ready",
    etag: "verified-etag",
    created_at: "2026-08-25T12:00:00.000Z",
    newly_claimed: true,
    ...overrides,
  };
}

describe("public member page asset metadata degradation", () => {
  it("degrades one missing or claimed asset while keeping valid metadata visible", async () => {
    mocks.query.mockResolvedValueOnce([validRow()]);

    const result = await getPublicMemberPageAssetMetadata("hamfriend", [
      VALID_ID,
      DEGRADED_ID,
    ]);

    // A missing or deletion-claimed asset produces no row: it degrades, while
    // the valid asset keeps its full metadata so unaffected media still render.
    expect(result).toEqual({
      status: "success",
      metadata: new Map([[
        VALID_ID,
        { mimeType: "image/png", width: 2, height: 3 },
      ]]),
      degradedAssetIds: new Set([DEGRADED_ID]),
    });
    const sql = mocks.query.mock.calls[0][0].join("?");
    // The published-only authorization guard is unchanged.
    expect(sql).toContain("page.is_published = TRUE");
    expect(sql).toContain("page.moderation_hold = FALSE");
    expect(sql).toContain("asset.status = 'ready'");
    expect(sql).toContain("asset.deletion_claimed_at IS NULL");
    expect(sql).toContain("page.published_doc");
    expect(sql).not.toContain("object_key");
    expect(sql).not.toContain("etag");
  });

  it("returns an empty degrade set when every requested asset resolves", async () => {
    const secondId = "550e8400-e29b-41d4-a716-446655440022";
    mocks.query.mockResolvedValueOnce([validRow(), validRow(secondId)]);

    const result = await getPublicMemberPageAssetMetadata("hamfriend", [
      VALID_ID,
      secondId,
    ]);

    expect(result).toEqual({
      status: "success",
      metadata: new Map([
        [VALID_ID, { mimeType: "image/png", width: 2, height: 3 }],
        [secondId, { mimeType: "image/png", width: 2, height: 3 }],
      ]),
      degradedAssetIds: new Set<string>(),
    });
  });

  it("degrades attributable malformed metadata instead of failing the page", async () => {
    mocks.query.mockResolvedValueOnce([
      { id: VALID_ID, mime_type: "image/png", width: null, height: 3 },
    ]);

    const result = await getPublicMemberPageAssetMetadata("hamfriend", [
      VALID_ID,
    ]);

    expect(result).toEqual({
      status: "success",
      metadata: new Map(),
      degradedAssetIds: new Set([VALID_ID]),
    });
  });

  it("fails closed on corruption it cannot attribute to a requested asset", async () => {
    // A row whose ID is not one of the requested assets, and a row whose ID
    // is not even a UUID, are stored-state corruption rather than one broken
    // medium: the whole read fails closed instead of degrading.
    mocks.query
      .mockResolvedValueOnce([validRow(UNREQUESTED_ID)])
      .mockResolvedValueOnce([{
        id: 42,
        mime_type: "image/png",
        width: 2,
        height: 3,
      }]);

    await expect(
      getPublicMemberPageAssetMetadata("hamfriend", [VALID_ID]),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      getPublicMemberPageAssetMetadata("hamfriend", [VALID_ID]),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("keeps a database outage distinct from content degradation", async () => {
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      getPublicMemberPageAssetMetadata("hamfriend", [VALID_ID]),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("bounds the degraded asset-ID set", async () => {
    const beyondBound = MEMBER_ASSET_PUBLIC_METADATA_DEGRADED_LIMIT + 2;
    const requested = Array.from(
      { length: beyondBound },
      (_, index) =>
        `550e8400-e29b-4${String(index).padStart(3, "0")}-8111-111111111111`,
    );
    mocks.query.mockResolvedValueOnce([]);

    const result = await getPublicMemberPageAssetMetadata("hamfriend", requested);
    if (result.status !== "success") throw new Error("fixture mismatch");

    expect(result.metadata.size).toBe(0);
    expect(result.degradedAssetIds.size).toBe(
      MEMBER_ASSET_PUBLIC_METADATA_DEGRADED_LIMIT,
    );
  });
});

describe("asset deletion reference classification", () => {
  it.each(["draft", "published", "both"] as const)(
    "classifies a %s reference without weakening the guard",
    async (location) => {
      const storage = makeStorage();
      mocks.query.mockResolvedValueOnce([
        { outcome: "referenced", reference_location: location },
      ]);

      await expect(
        deleteOwnedMemberPageAsset("hamfriend", VALID_ID, { storage }),
      ).resolves.toEqual({ status: "referenced", location });
      expect(storage.deleteObject).not.toHaveBeenCalled();
    },
  );

  it("keeps a published-only reference blocked: unpublish alone does not clear the snapshot", async () => {
    const storage = makeStorage();
    mocks.query.mockResolvedValueOnce([
      { outcome: "referenced", reference_location: "published" },
    ]);

    // The result is still a blocked deletion. Nothing here offers a bypass:
    // unpublish does not touch published_doc, and the classification only
    // tells the owner where the reference lives.
    await expect(
      deleteOwnedMemberPageAsset("hamfriend", VALID_ID, { storage }),
    ).resolves.toEqual({ status: "referenced", location: "published" });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("falls back to the conservative classification when the row shape is unexpected", async () => {
    const storage = makeStorage();
    mocks.query.mockResolvedValueOnce([{ outcome: "referenced" }]);

    await expect(
      deleteOwnedMemberPageAsset("hamfriend", VALID_ID, { storage }),
    ).resolves.toEqual({ status: "referenced", location: "both" });
  });

  it("still deletes cleanly when both documents are clear", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([
        {
          outcome: "success",
          reference_location: null,
          ...cleanupRow(),
        },
      ])
      .mockResolvedValueOnce([{ id: VALID_ID }]);

    await expect(
      deleteOwnedMemberPageAsset("hamfriend", VALID_ID, { storage }),
    ).resolves.toEqual({ status: "success" });
    expect(storage.deleteObject).toHaveBeenCalledWith(OBJECT_KEY, {
      ifMatch: "verified-etag",
    });

    const sql = mocks.query.mock.calls[0][0].join("?");
    // The dual-document guard is intact: deletion stays blocked unless both
    // stored documents are clear of the asset.
    expect(sql).toContain("page_guard.draft_doc");
    expect(sql).toContain("page_guard.published_doc");
    expect(sql.match(/jsonb_path_exists/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("AND NOT target.is_referenced");
    expect(sql).toContain(
      "WHEN target.referenced_in_draft AND target.referenced_in_published",
    );
    expect(sql).toContain("WHEN target.referenced_in_draft THEN 'draft'");
    expect(sql).toContain("ELSE 'published'");
    expect(sql).toContain("FOR UPDATE OF asset");
    expect(sql).not.toContain("asset_ready_count");
  });
});

describe("direct requests for a degraded asset", () => {
  it("keeps serving a missing, claimed, or invalid asset at 404", async () => {
    mocks.query.mockResolvedValueOnce([]);

    await expect(
      readMemberPageAssetForServing(DEGRADED_ID),
    ).resolves.toEqual({ status: "not-found" });
    expect(mocks.currentAccount).not.toHaveBeenCalled();
  });

  it("keeps a malformed asset ID at 404 without querying", async () => {
    await expect(
      readMemberPageAssetForServing("../../private-key"),
    ).resolves.toEqual({ status: "not-found" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
