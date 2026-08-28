import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { R2StorageAdapter } from "@/lib/members/assets/types";
import type { MemberAssetVerificationReasonCode } from "@/lib/members/assets/verify";

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
  allocateOwnedMemberPageAsset,
  deleteOwnedMemberPageAsset,
  finalizeOwnedMemberPageAsset,
  getPublicMemberPageAssetMetadata,
  listOwnedMemberPageAssets,
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
const ADMIN_NON_OWNER = {
  ...OWNER,
  id: "550e8400-e29b-41d4-a716-446655440001",
  siteRole: "admin" as const,
};
const OWNED_PAGE = { owned: true };
const ASSET_ID = "550e8400-e29b-41d4-a716-446655440020";
const PAGE_ID = "550e8400-e29b-41d4-a716-446655440010";
const NOW = "2026-08-25T12:00:00.000Z";
const EXPIRES = "2026-08-25T12:05:00.000Z";
const OBJECT_KEY =
  `member-page-assets/${"A".repeat(24)}/68-png-${"B".repeat(43)}`;
const ORIGINAL_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_EDITOR_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function queryText(index: number): string {
  return mocks.query.mock.calls[index][0].join("?");
}

function makeStorage(): R2StorageAdapter {
  return {
    createPresignedPut: vi.fn().mockResolvedValue({
      method: "PUT",
      url: "https://storage.example/private-key?X-Amz-Signature=secret-query",
      headers: new Headers({
        "content-length": "68",
        "content-type": "image/png",
      }),
      expiresAt: new Date(EXPIRES),
    }),
    headObject: vi.fn().mockResolvedValue({
      byteSize: 68,
      contentType: "image/png",
      etag: "verified-etag",
      lastModified: new Date(NOW),
    }),
    getObjectRange: vi.fn(),
    getObject: vi.fn().mockResolvedValue({
      bytes: new Uint8Array(68),
      contentType: "image/png",
      etag: "verified-etag",
      byteSize: 68,
    }),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
}

function cleanupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    object_key: OBJECT_KEY,
    status: "pending",
    etag: null,
    created_at: NOW,
    newly_claimed: true,
    ...overrides,
  };
}

function servingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    slug: "hamfriend",
    owner_account_id: OWNER.id,
    object_key: "member-page-assets/public/object",
    mime_type: "image/png",
    byte_size: 68,
    width: 2,
    height: 3,
    etag: "verified-etag",
    published_doc: {
      schemaVersion: 2,
      frame: {
        displayName: "HAM Friend",
        summary: null,
        websiteUrl: null,
        socialLinks: {},
        portrait: {
          assetId: ASSET_ID,
          alt: "HAM Friend",
          decorative: false,
        },
        theme: { id: "paper", accentId: "default" },
      },
      blocks: [],
    },
    public_authorized: true,
    ...overrides,
  };
}

describe("member V2 asset DAL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "false";
    mocks.currentAccount.mockResolvedValue(OWNER);
    mocks.verify.mockResolvedValue({
      success: true,
      metadata: {
        mimeType: "image/png",
        byteSize: 68,
        width: 2,
        height: 3,
        etag: "verified-etag",
        verifiedAt: new Date(NOW),
      },
    });
  });

  afterEach(() => {
    restoreEnvironmentVariable("MEMBER_PAGE_V2_ALLOWLIST", ORIGINAL_ALLOWLIST);
    restoreEnvironmentVariable(
      "MEMBER_PAGE_V2_EDITOR_DISABLED",
      ORIGINAL_EDITOR_DISABLED,
    );
  });

  it.each([
    ["signed out", null],
    ["administrator non-owner", ADMIN_NON_OWNER],
  ])("does not allocate for a %s", async (_label, account) => {
    const storage = makeStorage();
    mocks.currentAccount.mockResolvedValue(account);
    if (account) mocks.query.mockResolvedValueOnce([]);

    await expect(
      allocateOwnedMemberPageAsset("hamfriend", "image/png", 68, { storage }),
    ).resolves.toEqual({ status: "not-found-or-forbidden" });
    expect(storage.createPresignedPut).not.toHaveBeenCalled();
    if (account) {
      expect(mocks.query).toHaveBeenCalledOnce();
      expect(queryText(0)).toContain("SELECT TRUE AS owned");
      expect(queryText(0)).toContain("page.slug = ?");
      expect(queryText(0)).toContain("page.owner_account_id = ?");
      expect(mocks.query.mock.calls[0].slice(1)).toContain(ADMIN_NON_OWNER.id);
    } else {
      expect(mocks.query).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["cohort disabled", "", "false"],
    ["editor kill switch", "hamfriend", "true"],
  ])("rejects allocation when %s", async (_label, allowlist, disabled) => {
    process.env.MEMBER_PAGE_V2_ALLOWLIST = allowlist;
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = disabled;
    const storage = makeStorage();

    await expect(
      allocateOwnedMemberPageAsset("hamfriend", "image/png", 68, { storage }),
    ).resolves.toEqual({ status: "not-found-or-forbidden" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(storage.createPresignedPut).not.toHaveBeenCalled();
  });

  it("fails closed before presigning when exact ownership cannot be established", async () => {
    const storage = makeStorage();
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      allocateOwnedMemberPageAsset("hamfriend", "image/png", 68, { storage }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(storage.createPresignedPut).not.toHaveBeenCalled();
  });

  it("allocates one guarded pending row with a random server-only key", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([OWNED_PAGE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        outcome: "success",
        asset_id: ASSET_ID,
        pending_expires_at: EXPIRES,
      }]);

    const result = await allocateOwnedMemberPageAsset(
      "hamfriend",
      "image/png",
      68,
      {
        storage,
        randomBytes: (size) => new Uint8Array(size).fill(7),
      },
    );

    expect(result).toEqual({
      status: "success",
      data: {
        assetId: ASSET_ID,
        uploadUrl: "https://storage.example/private-key?X-Amz-Signature=secret-query",
        requiredContentType: "image/png",
        requiredByteSize: 68,
        expiresAt: EXPIRES,
      },
    });
    if (result.status !== "success") throw new Error("fixture mismatch");
    expect(Object.keys(result.data).sort()).toEqual([
      "assetId",
      "expiresAt",
      "requiredByteSize",
      "requiredContentType",
      "uploadUrl",
    ]);

    const sql = queryText(2);
    const values = mocks.query.mock.calls[2].slice(1);
    const objectKey = values.find(
      (value) => typeof value === "string" && value.startsWith("member-page-assets/"),
    );
    expect(sql).toContain("INSERT INTO public.member_page_assets");
    expect(sql.trimStart().startsWith("WITH page_guard AS")).toBe(true);
    expect(sql).toContain("UPDATE public.member_pages page");
    expect(sql).toContain("asset_pending_count = page.asset_pending_count + 1");
    expect(sql).toContain("asset_alloc_window_started_at = CASE");
    expect(sql).toContain("asset_alloc_window_count = CASE");
    expect(sql).toContain("asset_alloc_window_count + 1");
    expect(sql).toContain("THEN 1");
    expect(sql).toContain("asset_pending_count < ?");
    expect(sql).toContain("asset_alloc_window_count < ?");
    expect(sql).not.toContain("NOW() + INTERVAL '5 minutes'");
    expect(mocks.query.mock.calls[2].slice(1)).toContainEqual(new Date(EXPIRES));
    expect(sql.match(/INSERT INTO public\.member_page_assets/gu)).toHaveLength(1);
    expect(sql).not.toMatch(
      /SELECT COUNT\(\*\)[\s\S]+FROM public\.member_page_assets (?:pending|recent)/u,
    );
    expect(objectKey).toMatch(/^member-page-assets\//u);
    expect(objectKey).not.toContain(ASSET_ID);
    expect(storage.createPresignedPut).toHaveBeenCalledWith({
      objectKey,
      contentType: "image/png",
      byteSize: 68,
      expiresInSeconds: 300,
    });
  });

  it.each([
    ["pending-limit", "pending-limit"],
    ["rate-limit", "rate-limit"],
  ] as const)("fails closed at the %s cap", async (_label, outcome) => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([OWNED_PAGE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ outcome }]);

    await expect(
      allocateOwnedMemberPageAsset("hamfriend", "image/png", 68, { storage }),
    ).resolves.toEqual({ status: outcome });
    expect(storage.createPresignedPut).toHaveBeenCalledOnce();
  });

  it("uses a fixed one-hour window reset rather than an asset-row rate count", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([OWNED_PAGE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        outcome: "rate-limit",
      }]);

    await allocateOwnedMemberPageAsset("hamfriend", "image/png", 68, { storage });
    const sql = queryText(2);
    expect(sql).toContain(
      "asset_alloc_window_started_at <= NOW() - INTERVAL '1 hour'",
    );
    expect(sql).toMatch(
      /asset_alloc_window_started_at = CASE[\s\S]+THEN NOW\(\)[\s\S]+ELSE page\.asset_alloc_window_started_at/u,
    );
    expect(sql).toMatch(
      /asset_alloc_window_count = CASE[\s\S]+THEN 1[\s\S]+ELSE page\.asset_alloc_window_count \+ 1/u,
    );
    expect(sql).not.toContain("recent.created_at");
  });

  it("splits newly claimed cleanup rows from retries and clears a full batch", async () => {
    const storage = makeStorage();
    const retryId = "550e8400-e29b-41d4-a716-446655440021";
    const retryKey =
      `member-page-assets/${"C".repeat(24)}/68-png-${"D".repeat(43)}`;
    mocks.query
      .mockResolvedValueOnce([OWNED_PAGE])
      .mockResolvedValueOnce([
        cleanupRow({ status: "ready", etag: "new-etag" }),
        cleanupRow({
          id: retryId,
          object_key: retryKey,
          status: "ready",
          etag: "stale-etag",
          newly_claimed: false,
        }),
      ])
      .mockResolvedValueOnce([{ id: ASSET_ID }])
      .mockResolvedValueOnce([{ id: retryId }])
      .mockResolvedValueOnce([{
        outcome: "success",
        asset_id: ASSET_ID,
        pending_expires_at: EXPIRES,
      }]);

    await allocateOwnedMemberPageAsset("hamfriend", "image/png", 68, { storage });

    const sql = queryText(1);
    expect(sql).toContain("WITH target AS MATERIALIZED");
    expect(sql.indexOf("FOR UPDATE")).toBeLessThan(
      sql.indexOf("FOR UPDATE OF asset SKIP LOCKED"),
    );
    expect(sql).toContain("(asset.deletion_claimed_at IS NULL) AS needs_claim");
    expect(sql).toContain("WHERE asset.pending_expires_at <= NOW()");
    expect(sql).toContain("asset.deletion_claimed_at IS NOT NULL");
    expect(sql).toContain("TRUE AS newly_claimed");
    expect(sql).toContain("FALSE AS newly_claimed");
    expect(sql).toContain("asset_pending_count = page.asset_pending_count - (");
    expect(sql).not.toContain("asset_ready_count");
    expect(sql).toContain("FROM newly_claimed");
    expect(queryText(2)).toContain(
      "asset_ready_count = page.asset_ready_count - CASE",
    );
    expect(queryText(3)).toContain(
      "asset_ready_count = page.asset_ready_count - CASE",
    );
    expect(mocks.query.mock.calls[1].slice(1)).toContain(5);
    expect(storage.deleteObject).toHaveBeenNthCalledWith(
      1,
      OBJECT_KEY,
      undefined,
    );
    expect(storage.deleteObject).toHaveBeenNthCalledWith(
      2,
      retryKey,
      undefined,
    );
  });

  it("rejects non-normalized MIME, invalid size, and unknown input authority", async () => {
    const storage = makeStorage();
    for (const [mime, size] of [
      ["image/PNG", 68],
      ["image/gif", 68],
      ["image/png", 0],
      ["image/png", 5_242_881],
      ["image/png", 1.5],
    ] as const) {
      await expect(
        allocateOwnedMemberPageAsset("hamfriend", mime, size, { storage }),
      ).resolves.toEqual({ status: "invalid" });
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not insert metadata when presigning fails before any URL is returned", async () => {
    const storage = makeStorage();
    vi.mocked(storage.createPresignedPut).mockRejectedValueOnce(new Error("secret URL"));
    mocks.query
      .mockResolvedValueOnce([OWNED_PAGE])
      .mockResolvedValueOnce([]);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      allocateOwnedMemberPageAsset("hamfriend", "image/png", 68, { storage }),
    ).resolves.toEqual({ status: "unavailable" });

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(queryText(0)).not.toContain("INSERT INTO public.member_page_assets");
    expect(queryText(1)).not.toContain("INSERT INTO public.member_page_assets");
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("finalizes only after an immediate unchanged HEAD and one guarded update", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        object_key: OBJECT_KEY,
        pending_expires_at: EXPIRES,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        outcome: "success",
        asset_id: ASSET_ID,
        mime_type: "image/png",
        width: 2,
        height: 3,
        ready_at: NOW,
        verified_at: NOW,
      }]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({
      status: "success",
      data: {
        assetId: ASSET_ID,
        status: "ready",
        mimeType: "image/png",
        width: 2,
        height: 3,
        readyAt: NOW,
        verifiedAt: NOW,
      },
    });

    expect(mocks.verify).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: OBJECT_KEY,
      claimedMimeType: "image/png",
    }));
    expect(storage.headObject).toHaveBeenCalledAfter(mocks.verify);
    const rateSql = queryText(0);
    const [, ...rateValues] = mocks.query.mock.calls[0];
    expect(rateSql).toContain(
      "INSERT INTO public.member_page_mutation_rate_limits",
    );
    expect(rateSql).toContain(
      "SELECT owned_pending.member_page_id, 'asset-finalize', NOW(), 1",
    );
    expect(rateSql).toContain("mutation_limit.attempt_count < ?");
    expect(rateValues).toContain(300);
    expect(rateValues).toContain(20);

    const sql = queryText(2);
    expect(sql.trimStart().startsWith("WITH page_guard AS MATERIALIZED")).toBe(true);
    expect(sql.indexOf("FOR UPDATE")).toBeLessThan(
      sql.indexOf("UPDATE public.member_page_assets asset"),
    );
    expect(sql.match(/UPDATE public\.member_page_assets asset/gu)).toHaveLength(1);
    expect(sql.match(/UPDATE public\.member_pages page/gu)).toHaveLength(1);
    expect(sql).toContain("asset.pending_expires_at > NOW()");
    expect(sql).toContain("page.asset_ready_count < ?");
    expect(sql).toContain("etag = ?");
    expect(sql).toContain("verified_at = ?");
    expect(sql).toContain("asset_pending_count = page.asset_pending_count - 1");
    expect(sql).toContain("asset_ready_count = page.asset_ready_count + 1");
    expect(sql.indexOf("UPDATE public.member_page_assets asset")).toBeLessThan(
      sql.indexOf("UPDATE public.member_pages page"),
    );
    expect(sql).not.toMatch(
      /SELECT COUNT\(\*\)[\s\S]+FROM public\.member_page_assets ready/u,
    );
  });

  it("maps the guarded ready-cap path to quota without a ready flip", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        object_key: OBJECT_KEY,
        pending_expires_at: EXPIRES,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ outcome: "quota" }])
      .mockResolvedValueOnce([cleanupRow()])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "quota" });

    const sql = queryText(2);
    expect(sql).toContain("page.asset_ready_count < ?");
    expect(sql).toContain("page.asset_ready_count >= ?");
    expect(sql).toContain("'quota'::text AS outcome");
    expect(queryText(3)).toContain("asset_pending_count = page.asset_pending_count - 1");
    expect(storage.deleteObject).toHaveBeenCalledWith(OBJECT_KEY, undefined);
  });

  it("returns a typed finalize throttle before cleanup or object verification", async () => {
    const storage = makeStorage();
    mocks.query.mockResolvedValueOnce([{
      outcome: "rate-limit",
      id: ASSET_ID,
      object_key: OBJECT_KEY,
      pending_expires_at: EXPIRES,
    }]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "rate-limit" });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    const sql = queryText(0);
    expect(sql.indexOf("owned_pending AS MATERIALIZED")).toBeLessThan(
      sql.indexOf("INSERT INTO public.member_page_mutation_rate_limits"),
    );
    expect(sql.indexOf("FOR UPDATE OF page")).toBeLessThan(
      sql.indexOf("INSERT INTO public.member_page_mutation_rate_limits"),
    );
    expect(sql).toContain(
      "SELECT owned_pending.member_page_id, 'asset-finalize', NOW(), 1",
    );
    expect(sql).toContain(
      "WHEN mutation_rate.member_page_id IS NULL THEN 'rate-limit'",
    );
  });

  const verifierFailures: MemberAssetVerificationReasonCode[] = [
    "storage_error",
    "missing_size",
    "invalid_size",
    "too_large",
    "missing_stored_mime",
    "missing_etag",
    "invalid_etag",
    "identity_mismatch",
    "unsupported_mime",
    "mime_mismatch",
    "unsupported_format",
    "signature_mismatch",
    "size_mismatch",
    "malformed_image",
    "animated_image",
    "uncertain_animation",
    "invalid_dimensions",
    "dimensions_too_large",
  ];

  it.each(verifierFailures)("claims and deletes verifier failure %s", async (code) => {
    const storage = makeStorage();
    mocks.verify.mockResolvedValueOnce({
      success: false,
      reason: { code, message: "sanitized" },
    });
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        object_key: OBJECT_KEY,
        pending_expires_at: EXPIRES,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cleanupRow()])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "invalid", reason: code });
    expect(queryText(2).trimStart().startsWith("WITH page_guard AS MATERIALIZED")).toBe(
      true,
    );
    expect(queryText(2).indexOf("FOR UPDATE")).toBeLessThan(
      queryText(2).indexOf("UPDATE public.member_page_assets asset"),
    );
    expect(queryText(2)).toContain("SET deletion_claimed_at");
    expect(queryText(2)).toContain(
      "asset_pending_count = page.asset_pending_count - 1",
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(OBJECT_KEY, undefined);
    expect(queryText(3)).toContain("deletion_claimed_at IS NOT NULL");
  });

  it("retains the deletion claim when invalid-object deletion fails", async () => {
    const storage = makeStorage();
    vi.mocked(storage.deleteObject).mockRejectedValueOnce({ status: 503 });
    mocks.verify.mockResolvedValueOnce({
      success: false,
      reason: { code: "animated_image", message: "sanitized" },
    });
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        object_key: OBJECT_KEY,
        pending_expires_at: EXPIRES,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cleanupRow()]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "invalid", reason: "animated_image" });
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(queryText(2)).toContain("SET deletion_claimed_at");
  });

  it("rejects a changed re-HEAD identity before the ready update", async () => {
    const storage = makeStorage();
    vi.mocked(storage.headObject).mockResolvedValueOnce({
      byteSize: 68,
      contentType: "image/png",
      etag: "swapped-etag",
      lastModified: new Date(NOW),
    });
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        object_key: OBJECT_KEY,
        pending_expires_at: EXPIRES,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cleanupRow()])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "invalid", reason: "identity_mismatch" });
    expect(queryText(2)).toContain("SET deletion_claimed_at");
    expect(queryText(2)).not.toContain("status = 'ready'");
  });

  it("maps only the exact ready-counter CHECK violation to quota", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        object_key: OBJECT_KEY,
        pending_expires_at: EXPIRES,
      }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce({
        code: "23514",
        constraint: "ck_member_pages_asset_ready_count",
      })
      .mockResolvedValueOnce([cleanupRow()])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "quota" });
    expect(storage.deleteObject).toHaveBeenCalled();
  });

  it.each([
    [{ code: "23514", constraint: "some_other_check" }],
    [{ code: "23505", constraint: "ck_member_pages_asset_ready_count" }],
  ])("does not misclassify unrelated database errors as quota", async (error) => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        object_key: OBJECT_KEY,
        pending_expires_at: EXPIRES,
      }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(error);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("cleans an unready object after a zero-row finalize conflict", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        object_key: OBJECT_KEY,
        pending_expires_at: EXPIRES,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cleanupRow()])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "conflict" });
    expect(storage.deleteObject).toHaveBeenCalled();
  });

  it("fails closed for stale, expired, wrong-page, or claimed pending rows", async () => {
    const storage = makeStorage();
    mocks.query.mockResolvedValueOnce([]);

    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "not-found-or-forbidden" });
    expect(queryText(0)).toContain("page.slug = ?");
    expect(queryText(0)).toContain("page.owner_account_id = ?");
    expect(queryText(0)).toContain("asset.pending_expires_at > NOW()");
    expect(queryText(0)).toContain("asset.deletion_claimed_at IS NULL");
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("lists only minimal owner metadata", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        status: "ready",
        mime_type: "image/png",
        width: 2,
        height: 3,
        created_at: NOW,
        ready_at: NOW,
        verified_at: NOW,
        pending_expires_at: EXPIRES,
        object_key: "must-not-escape",
        etag: "must-not-escape",
      }]);

    const result = await listOwnedMemberPageAssets("hamfriend", { storage });
    expect(result).toEqual({
      status: "success",
      assets: [{
        assetId: ASSET_ID,
        status: "ready",
        mimeType: "image/png",
        width: 2,
        height: 3,
        createdAt: NOW,
        readyAt: NOW,
        verifiedAt: NOW,
        pendingExpiresAt: EXPIRES,
      }],
    });
    expect(queryText(1)).not.toContain("object_key");
    expect(queryText(1)).not.toContain("etag");
  });

  it("claims deletion in one dual-document JSONPath-guarded update", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([{
        outcome: "success",
        ...cleanupRow({ status: "ready", etag: "verified-etag" }),
      }])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      deleteOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "success" });

    const sql = queryText(0);
    expect(sql.match(/UPDATE public\.member_page_assets asset/gu)).toHaveLength(1);
    expect(sql).toContain("page_guard.draft_doc");
    expect(sql).toContain("page_guard.published_doc");
    expect(sql).toContain("jsonb_path_exists");
    expect(sql).toContain("page_guard AS MATERIALIZED");
    expect(sql).toContain("FOR UPDATE OF asset");
    expect(sql.indexOf("FOR UPDATE")).toBeLessThan(
      sql.indexOf("FOR UPDATE OF asset"),
    );
    expect(sql).toContain("asset_pending_count = page.asset_pending_count - CASE");
    expect(sql).not.toContain("asset_ready_count");
    expect(sql).toContain("AND asset.deletion_claimed_at IS NULL");
    expect(sql).toContain("target.already_claimed");
    expect(sql).toContain("AND NOT target.already_claimed");
    expect(sql).toContain("FROM newly_claimed");
    expect(sql).not.toMatch(/\bLIKE\b/iu);
    expect(storage.deleteObject).toHaveBeenCalledWith(OBJECT_KEY, {
      ifMatch: "verified-etag",
    });
    expect(queryText(1)).toContain("DELETE FROM public.member_page_assets");
    expect(queryText(1).trimStart().startsWith("WITH page_guard AS MATERIALIZED")).toBe(
      true,
    );
    expect(queryText(1).indexOf("FOR UPDATE OF page")).toBeLessThan(
      queryText(1).indexOf("DELETE FROM public.member_page_assets"),
    );
    expect(queryText(1)).not.toContain("asset_pending_count");
    expect(queryText(1)).toContain(
      "asset_ready_count = page.asset_ready_count - CASE",
    );
  });

  it("retains a hidden claim through replay risk and re-deletes after expiry", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([{
        outcome: "success",
        ...cleanupRow({ status: "ready", etag: "verified-etag" }),
      }])
      // The first R2 delete succeeds before URL expiry, so metadata and ready
      // quota remain while the same signed URL could recreate the object.
      .mockResolvedValueOnce([])
      // A later bounded owner cleanup runs after expiry and sees the claim.
      .mockResolvedValueOnce([cleanupRow({
        status: "ready",
        etag: "verified-etag",
        newly_claimed: false,
      })])
      .mockResolvedValueOnce([{ id: ASSET_ID }])
      .mockResolvedValueOnce([]);

    await expect(
      deleteOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "success" });
    await expect(
      listOwnedMemberPageAssets("hamfriend", { storage }),
    ).resolves.toEqual({ status: "success", assets: [] });

    expect(queryText(1)).toContain("pending_expires_at <= NOW()");
    expect(queryText(0)).not.toContain("asset_ready_count");
    expect(queryText(2)).toContain("WHERE asset.pending_expires_at <= NOW()");
    expect(queryText(4)).toContain("asset.deletion_claimed_at IS NULL");
    expect(storage.deleteObject).toHaveBeenNthCalledWith(
      1,
      OBJECT_KEY,
      { ifMatch: "verified-etag" },
    );
    expect(storage.deleteObject).toHaveBeenNthCalledWith(
      2,
      OBJECT_KEY,
      undefined,
    );
    expect(queryText(3)).toContain(
      "asset_ready_count = page.asset_ready_count - CASE",
    );
  });

  it("returns a reference conflict without touching storage", async () => {
    const storage = makeStorage();
    mocks.query.mockResolvedValueOnce([{ outcome: "referenced" }]);

    await expect(
      deleteOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({
      status: "referenced",
      // Unclassified rows fall back to the conservative owner-facing "both".
      location: "both",
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("deletes ready metadata and quota after expiry when R2 reports it missing", async () => {
    const storage = makeStorage();
    vi.mocked(storage.deleteObject).mockRejectedValueOnce({ status: 404 });
    mocks.query
      .mockResolvedValueOnce([{
        outcome: "success",
        ...cleanupRow({ status: "ready", etag: "verified-etag" }),
      }])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      deleteOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "success" });

    expect(queryText(0)).not.toContain("asset_ready_count");
    expect(queryText(1)).toContain("DELETE FROM public.member_page_assets");
    expect(queryText(1)).toContain("pending_expires_at <= NOW()");
    expect(queryText(1)).toContain(
      "asset_ready_count = page.asset_ready_count - CASE",
    );
  });

  it("retains a deletion claim on R2 failure and retries it safely", async () => {
    const storage = makeStorage();
    vi.mocked(storage.deleteObject)
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce(undefined);
    mocks.query
      .mockResolvedValueOnce([{
        outcome: "success",
        ...cleanupRow({ status: "ready", etag: "verified-etag" }),
      }])
      .mockResolvedValueOnce([{
        outcome: "success",
        ...cleanupRow({
          status: "ready",
          etag: "verified-etag",
          newly_claimed: false,
        }),
      }])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      deleteOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "unavailable" });
    expect(queryText(0)).not.toContain("asset_ready_count");
    expect(mocks.query).toHaveBeenCalledTimes(1);
    await expect(
      deleteOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "success" });
    expect(queryText(1)).toContain("target.already_claimed");
    expect(storage.deleteObject).toHaveBeenNthCalledWith(
      1,
      OBJECT_KEY,
      { ifMatch: "verified-etag" },
    );
    expect(storage.deleteObject).toHaveBeenNthCalledWith(
      2,
      OBJECT_KEY,
      undefined,
    );
    expect(queryText(2)).toContain("pending_expires_at <= NOW()");
    expect(queryText(2)).toContain(
      "asset_ready_count = page.asset_ready_count - CASE",
    );
  });

  it("serves a same-page published reference publicly without reading cookies", async () => {
    const storage = makeStorage();
    mocks.currentAccount.mockResolvedValue(null);
    mocks.query.mockResolvedValueOnce([servingRow()]);

    await expect(
      readMemberPageAssetForServing(ASSET_ID, { storage }),
    ).resolves.toMatchObject({
      status: "success",
      visibility: "public",
      mimeType: "image/png",
      byteSize: 68,
      etag: "verified-etag",
    });
    expect(mocks.currentAccount).not.toHaveBeenCalled();
    expect(queryText(0)).toContain("JOIN public.member_pages page ON page.id = asset.member_page_id");
    expect(queryText(0)).toContain("page.is_published = TRUE");
    expect(queryText(0)).toContain("page.moderation_hold = FALSE");
    expect(queryText(0)).toContain("page.published_doc");
    expect(storage.getObject).toHaveBeenCalledWith(
      "member-page-assets/public/object",
      68,
      { ifMatch: "verified-etag" },
    );
  });

  it("serves an unpublished or held asset only to the enabled exact owner", async () => {
    const storage = makeStorage();
    mocks.query.mockResolvedValueOnce([servingRow({ public_authorized: false })]);

    await expect(
      readMemberPageAssetForServing(ASSET_ID, { storage }),
    ).resolves.toMatchObject({ status: "success", visibility: "private" });

    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "true";
    mocks.query.mockResolvedValueOnce([servingRow({ public_authorized: false })]);
    await expect(
      readMemberPageAssetForServing(ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "not-found" });
  });

  it.each([
    ["wrong owner", { ...OWNER, id: ADMIN_NON_OWNER.id, siteRole: "member" as const }],
    ["administrator non-owner", ADMIN_NON_OWNER],
    ["signed out", null],
  ])("returns 404 to a private %s", async (_label, account) => {
    const storage = makeStorage();
    mocks.currentAccount.mockResolvedValue(account);
    mocks.query.mockResolvedValueOnce([servingRow({ public_authorized: false })]);

    await expect(
      readMemberPageAssetForServing(ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "not-found" });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("claims an If-Match swap rejection and never serves changed bytes", async () => {
    const storage = makeStorage();
    vi.mocked(storage.getObject).mockRejectedValueOnce({ status: 412 });
    mocks.query
      .mockResolvedValueOnce([servingRow()])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      readMemberPageAssetForServing(ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "not-found" });
    expect(queryText(1)).toContain("etag = ?");
    expect(queryText(1)).toContain("deletion_claimed_at IS NULL");
    expect(queryText(1)).not.toContain("asset_ready_count");
  });

  it("claims mismatched response metadata", async () => {
    const storage = makeStorage();
    vi.mocked(storage.getObject).mockResolvedValueOnce({
      bytes: new Uint8Array(68),
      contentType: "image/jpeg",
      etag: "verified-etag",
      byteSize: 68,
    });
    mocks.query
      .mockResolvedValueOnce([servingRow()])
      .mockResolvedValueOnce([{ id: ASSET_ID }]);

    await expect(
      readMemberPageAssetForServing(ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "not-found" });
    expect(queryText(1)).toContain("SET deletion_claimed_at");
    expect(queryText(1)).not.toContain("asset_ready_count");
  });

  it("builds an exact public metadata map without private storage fields", async () => {
    mocks.query.mockResolvedValueOnce([{
      id: ASSET_ID,
      mime_type: "image/png",
      width: 2,
      height: 3,
      object_key: "must-not-escape",
      etag: "must-not-escape",
    }]);

    const result = await getPublicMemberPageAssetMetadata("hamfriend", [
      ASSET_ID,
      ASSET_ID,
    ]);
    expect(result).toEqual({
      status: "success",
      degradedAssetIds: new Set<string>(),
      metadata: new Map([[
        ASSET_ID,
        { mimeType: "image/png", width: 2, height: 3 },
      ]]),
    });
    const sql = queryText(0);
    expect(sql).toContain("page.slug = ?");
    expect(sql).toContain("page.is_published = TRUE");
    expect(sql).toContain("page.moderation_hold = FALSE");
    expect(sql).toContain("asset.status = 'ready'");
    expect(sql).toContain("asset.deletion_claimed_at IS NULL");
    expect(sql).toContain("jsonb_path_exists(");
    expect(sql).toContain("page.published_doc");
    expect(sql).toContain("jsonb_build_object('assetId', to_jsonb(asset.id::text))");
    expect(sql).not.toContain("object_key");
    expect(sql).not.toContain("etag");
    expect(mocks.query.mock.calls[0].slice(1)).toContain(
      JSON.stringify([ASSET_ID]),
    );
  });

  it("degrades missing or malformed published assets instead of failing the page", async () => {
    const missingId = "550e8400-e29b-41d4-a716-446655440021";
    mocks.query
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        mime_type: "image/png",
        width: 2,
        height: 3,
      }])
      .mockResolvedValueOnce([{
        id: ASSET_ID,
        mime_type: "image/png",
        width: null,
        height: 3,
      }]);

    // A missing asset (deletion-claimed or absent) degrades alongside the one
    // usable asset; attributable malformed metadata degrades the same way.
    await expect(
      getPublicMemberPageAssetMetadata("hamfriend", [ASSET_ID, missingId]),
    ).resolves.toEqual({
      status: "success",
      metadata: new Map([[
        ASSET_ID,
        { mimeType: "image/png", width: 2, height: 3 },
      ]]),
      degradedAssetIds: new Set([missingId]),
    });
    await expect(
      getPublicMemberPageAssetMetadata("hamfriend", [ASSET_ID]),
    ).resolves.toEqual({
      status: "success",
      metadata: new Map(),
      degradedAssetIds: new Set([ASSET_ID]),
    });
  });

  it("distinguishes public metadata infrastructure failure", async () => {
    mocks.query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      getPublicMemberPageAssetMetadata("hamfriend", [ASSET_ID]),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("binds all owner mutations to exact page ownership", async () => {
    const storage = makeStorage();
    mocks.query.mockResolvedValueOnce([{ outcome: "not-found" }]);
    mocks.currentAccount.mockResolvedValue(ADMIN_NON_OWNER);

    await expect(
      deleteOwnedMemberPageAsset("hamfriend", ASSET_ID, { storage }),
    ).resolves.toEqual({ status: "not-found-or-forbidden" });
    expect(queryText(0)).toContain("WHERE slug = ?");
    expect(queryText(0)).toContain("AND owner_account_id = ?");
    expect(mocks.query.mock.calls[0].slice(1)).toContain(ADMIN_NON_OWNER.id);
  });

  it("uses only opaque UUIDs as asset route authority", async () => {
    const storage = makeStorage();
    await expect(
      readMemberPageAssetForServing("../../private-key", { storage }),
    ).resolves.toEqual({ status: "not-found" });
    await expect(
      finalizeOwnedMemberPageAsset("hamfriend", "not-a-uuid", { storage }),
    ).resolves.toEqual({ status: "invalid" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("keeps the page identity server-resolved rather than accepting a page ID", async () => {
    const storage = makeStorage();
    mocks.query
      .mockResolvedValueOnce([OWNED_PAGE])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        outcome: "success",
        asset_id: ASSET_ID,
        pending_expires_at: EXPIRES,
      }]);
    await allocateOwnedMemberPageAsset("hamfriend", "image/png", 68, { storage });
    expect(queryText(2)).toContain("page.slug = ?");
    expect(queryText(2)).toContain("page.owner_account_id = ?");
    expect(mocks.query.mock.calls[2].slice(1)).not.toContain(PAGE_ID);
  });
});
