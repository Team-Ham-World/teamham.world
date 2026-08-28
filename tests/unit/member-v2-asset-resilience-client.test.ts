import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  validateOrigin: vi.fn(() => true),
}));

vi.mock("@/lib/auth/config", () => ({
  getAuthMode: vi.fn(() => "development"),
  getAuthConfig: () => ({
    mode: "production",
    canonicalOrigin: "https://teamham.world",
  }),
  validateRequestOrigin: vi.fn(() => true),
  validateLogoutOrigin: mocks.validateOrigin,
}));

vi.mock("@/lib/members/assets/dal", () => ({
  deleteOwnedMemberPageAsset: mocks.remove,
}));

import { DELETE } from "@/app/api/member-page-assets/[assetId]/route";
import {
  MemberAssetApiError,
  assetReferenceMessage,
  deleteMemberPageAsset,
} from "@/components/member-page-editor/asset-api";

const ASSET_ID = "550e8400-e29b-41d4-a716-446655440020";
const ORIGIN = "https://teamham.world";

function deleteRequest() {
  return new Request(`${ORIGIN}/api/member-page-assets/${ASSET_ID}`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: "__Host-session=test",
    },
    body: JSON.stringify({ slug: "hamfriend" }),
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validateOrigin.mockReturnValue(true);
});

describe("DELETE route reference classification", () => {
  it.each(["draft", "published", "both"] as const)(
    "returns an owner-only %s classification with asset_referenced",
    async (location) => {
      mocks.remove.mockResolvedValueOnce({ status: "referenced", location });

      const response = await DELETE(deleteRequest(), {
        params: Promise.resolve({ assetId: ASSET_ID }),
      });

      expect(response.status).toBe(409);
      expect(mocks.remove).toHaveBeenCalledWith("hamfriend", ASSET_ID);
      const body = await response.json();
      expect(body).toEqual({
        error: "asset_referenced",
        referenceLocation: location,
      });
      // Private response discipline is unchanged.
      expect(response.headers.get("vary")).toBe("Cookie");
      expect(response.headers.get("cache-control")).toContain("no-store");
    },
  );

  it("keeps the non-referenced outcomes mapped exactly as before", async () => {
    const cases: [
      unknown,
      number,
      Record<string, string> | null,
    ][] = [
      [{ status: "success" }, 204, null],
      [{ status: "invalid" }, 400, { error: "invalid_request" }],
      [{ status: "conflict" }, 409, { error: "asset_conflict" }],
      [
        { status: "not-found-or-forbidden" },
        404,
        { error: "not_found" },
      ],
      [
        { status: "unavailable" },
        503,
        { error: "service_unavailable" },
      ],
    ];
    for (const [result, status, body] of cases) {
      mocks.remove.mockResolvedValueOnce(result);
      const response = await DELETE(deleteRequest(), {
        params: Promise.resolve({ assetId: ASSET_ID }),
      });
      expect(response.status).toBe(status);
      if (body) {
        expect(await response.json()).toEqual(body);
      }
    }
    // No object keys or storage detail in any owner error body.
    const referencedResponse = await (async () => {
      mocks.remove.mockResolvedValueOnce({
        status: "referenced",
        location: "draft",
      });
      return DELETE(deleteRequest(), {
        params: Promise.resolve({ assetId: ASSET_ID }),
      });
    })();
    expect(Object.keys(await referencedResponse.json()).sort()).toEqual([
      "error",
      "referenceLocation",
    ]);
  });
});

describe("asset API reference parsing", () => {
  it.each(["draft", "published", "both"] as const)(
    "carries the %s classification and classified copy on the error",
    async (location) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
        json({ error: "asset_referenced", referenceLocation: location }, 409),
      );

      const error = await deleteMemberPageAsset(
        "hamfriend",
        ASSET_ID,
        fetchImpl,
      ).then(
        () => {
          throw new Error("expected rejection");
        },
        (caught: unknown) => caught as MemberAssetApiError,
      );

      expect(error).toBeInstanceOf(MemberAssetApiError);
      expect(error.code).toBe("asset_referenced");
      expect(error.status).toBe(409);
      expect(error.referenceLocation).toBe(location);
      expect(error.message).toBe(assetReferenceMessage(location));
    },
  );

  it("falls back to the combined copy when the server does not classify", async () => {
    for (const body of [
      { error: "asset_referenced" },
      { error: "asset_referenced", referenceLocation: "somewhere-else" },
    ]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
        json(body, 409),
      );

      const error = await deleteMemberPageAsset(
        "hamfriend",
        ASSET_ID,
        fetchImpl,
      ).then(
        () => {
          throw new Error("expected rejection");
        },
        (caught: unknown) => caught as MemberAssetApiError,
      );

      expect(error.referenceLocation).toBeNull();
      expect(error.message).toBe(assetReferenceMessage(null));
      // Legacy-compatible wording, now naming the last published snapshot.
      expect(error.message).toContain("saved draft or live page");
      expect(error.message).toContain("last published snapshot");
    }
  });
});

describe("deletion error copy", () => {
  it("states for a draft-only reference that the snapshot is clear", () => {
    const message = assetReferenceMessage("draft");
    expect(message).toContain("saved draft");
    expect(message).toContain("does not reference it");
    expect(message).toContain("Saved");
  });

  it("states that unpublish alone does not clear the last published snapshot", () => {
    for (const location of ["published", "both"] as const) {
      const message = assetReferenceMessage(location);
      expect(message).toContain("last published snapshot");
      expect(message).toContain(
        "Unpublishing alone does not clear the last published snapshot",
      );
    }
  });

  it("never advises republishing a private or held page to free quota", () => {
    const message = assetReferenceMessage("published");
    expect(message).toContain("keep the image");
    expect(message).toContain("instead of republishing just to free quota");
  });

  it("does not leak object keys, storage detail, or internal reasons", () => {
    for (const location of ["draft", "published", "both", null] as const) {
      const message = assetReferenceMessage(location);
      expect(message).not.toMatch(/object[- ]key|etag|r2|bucket|s3/iu);
    }
  });
});
