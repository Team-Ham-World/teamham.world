import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allocate: vi.fn(),
  finalize: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  serve: vi.fn(),
  validateOrigin: vi.fn(() => true),
  authMode: vi.fn(() => "development"),
}));

vi.mock("@/lib/auth/config", () => ({
  getAuthMode: mocks.authMode,
  getAuthConfig: () => ({ canonicalOrigin: "https://teamham.world" }),
  validateLogoutOrigin: mocks.validateOrigin,
  validateRequestOrigin: vi.fn(() => true),
}));
vi.mock("@/lib/members/assets/dal", () => ({
  allocateOwnedMemberPageAsset: mocks.allocate,
  finalizeOwnedMemberPageAsset: mocks.finalize,
  listOwnedMemberPageAssets: mocks.list,
  deleteOwnedMemberPageAsset: mocks.remove,
  readMemberPageAssetForServing: mocks.serve,
}));

import { DELETE } from "@/app/api/member-page-assets/[assetId]/route";
import { POST as FINALIZE } from "@/app/api/member-page-assets/[assetId]/finalize/route";
import { GET as LIST } from "@/app/api/member-page-assets/route";
import { POST as ALLOCATE } from "@/app/api/member-page-assets/uploads/route";
import { GET as SERVE } from "@/app/member-assets/[assetId]/route";

const ASSET_ID = "550e8400-e29b-41d4-a716-446655440020";
const ORIGIN = "https://teamham.world";

function mutationRequest(path: string, body: unknown, method = "POST") {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: "__Host-session=test",
    },
    body: JSON.stringify(body),
  });
}

describe("member V2 asset HTTP routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMode.mockReturnValue("development");
    mocks.validateOrigin.mockReturnValue(true);
  });

  it("allocates with exact private headers and no separate object key", async () => {
    mocks.allocate.mockResolvedValueOnce({
      status: "success",
      data: {
        assetId: ASSET_ID,
        uploadUrl: "https://storage.example/key?X-Amz-Signature=secret",
        requiredContentType: "image/png",
        requiredByteSize: 68,
        expiresAt: "2026-08-25T12:05:00.000Z",
      },
    });

    const response = await ALLOCATE(mutationRequest(
      "/api/member-page-assets/uploads",
      { slug: "hamfriend", mimeType: "image/png", byteSize: 68 },
    ));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate",
    );
    expect(response.headers.get("vary")).toBe("Cookie");
    const body = await response.json();
    expect(body).toEqual({
      assetId: ASSET_ID,
      uploadUrl: "https://storage.example/key?X-Amz-Signature=secret",
      requiredContentType: "image/png",
      requiredByteSize: 68,
      expiresAt: "2026-08-25T12:05:00.000Z",
    });
    expect(body).not.toHaveProperty("objectKey");
    expect(mocks.allocate).toHaveBeenCalledWith("hamfriend", "image/png", 68);
  });

  it("enforces exact same-origin CSRF before every mutation", async () => {
    mocks.validateOrigin.mockReturnValue(false);
    const requests = [
      ALLOCATE(mutationRequest(
        "/api/member-page-assets/uploads",
        { slug: "hamfriend", mimeType: "image/png", byteSize: 68 },
      )),
      FINALIZE(
        mutationRequest(
          `/api/member-page-assets/${ASSET_ID}/finalize`,
          { slug: "hamfriend" },
        ),
        { params: Promise.resolve({ assetId: ASSET_ID }) },
      ),
      DELETE(
        mutationRequest(
          `/api/member-page-assets/${ASSET_ID}`,
          { slug: "hamfriend" },
          "DELETE",
        ),
        { params: Promise.resolve({ assetId: ASSET_ID }) },
      ),
    ];
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rejects extra authority fields and malformed bodies", async () => {
    const response = await ALLOCATE(mutationRequest(
      "/api/member-page-assets/uploads",
      {
        slug: "hamfriend",
        mimeType: "image/png",
        byteSize: 68,
        pageId: "client-controlled",
        objectKey: "client-controlled",
      },
    ));
    expect(response.status).toBe(400);
    expect(mocks.allocate).not.toHaveBeenCalled();
  });

  it("uses async route params for finalize and deletion", async () => {
    mocks.finalize.mockResolvedValueOnce({
      status: "success",
      data: {
        assetId: ASSET_ID,
        status: "ready",
        mimeType: "image/png",
        width: 2,
        height: 3,
        readyAt: "2026-08-25T12:00:00.000Z",
        verifiedAt: "2026-08-25T12:00:00.000Z",
      },
    });
    mocks.remove.mockResolvedValueOnce({ status: "success" });

    const finalizeResponse = await FINALIZE(
      mutationRequest(
        `/api/member-page-assets/${ASSET_ID}/finalize`,
        { slug: "hamfriend" },
      ),
      { params: Promise.resolve({ assetId: ASSET_ID }) },
    );
    const deleteResponse = await DELETE(
      mutationRequest(
        `/api/member-page-assets/${ASSET_ID}`,
        { slug: "hamfriend" },
        "DELETE",
      ),
      { params: Promise.resolve({ assetId: ASSET_ID }) },
    );
    expect(finalizeResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(204);
    expect(deleteResponse.headers.get("vary")).toBe("Cookie");
    expect(mocks.finalize).toHaveBeenCalledWith("hamfriend", ASSET_ID);
    expect(mocks.remove).toHaveBeenCalledWith("hamfriend", ASSET_ID);
  });

  it("returns a private 429 when finalize verification is throttled", async () => {
    mocks.finalize.mockResolvedValueOnce({ status: "rate-limit" });

    const response = await FINALIZE(
      mutationRequest(
        `/api/member-page-assets/${ASSET_ID}/finalize`,
        { slug: "hamfriend" },
      ),
      { params: Promise.resolve({ assetId: ASSET_ID }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "finalize_rate_limit" });
  });

  it("lists minimal owner metadata through a private no-store response", async () => {
    mocks.list.mockResolvedValueOnce({ status: "success", assets: [] });
    const response = await LIST(new Request(
      `${ORIGIN}/api/member-page-assets?slug=hamfriend`,
      { headers: { cookie: "__Host-session=test" } },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(await response.json()).toEqual({ assets: [] });
    expect(mocks.list).toHaveBeenCalledWith("hamfriend");
  });

  it("serves a public asset with conservative no-store and no cookie vary", async () => {
    mocks.serve.mockResolvedValueOnce({
      status: "success",
      visibility: "public",
      mimeType: "image/png",
      byteSize: 3,
      width: 1,
      height: 1,
      etag: "verified-etag",
      bytes: new Uint8Array([1, 2, 3]),
    });

    const response = await SERVE(
      new Request(`${ORIGIN}/member-assets/${ASSET_ID}`),
      { params: Promise.resolve({ assetId: ASSET_ID }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBeNull();
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("etag")).toBe('"verified-etag"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("serves private owner bytes with exact private no-store and Vary Cookie", async () => {
    mocks.serve.mockResolvedValueOnce({
      status: "success",
      visibility: "private",
      mimeType: "image/webp",
      byteSize: 2,
      width: 1,
      height: 1,
      etag: "verified-etag",
      bytes: new Uint8Array([4, 5]),
    });

    const response = await SERVE(
      new Request(`${ORIGIN}/member-assets/${ASSET_ID}`, {
        headers: { cookie: "__Host-session=test" },
      }),
      { params: Promise.resolve({ assetId: ASSET_ID }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate",
    );
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("returns 404 rather than 403 for every unauthorized asset result", async () => {
    mocks.serve.mockResolvedValueOnce({ status: "not-found" });
    const response = await SERVE(
      new Request(`${ORIGIN}/member-assets/${ASSET_ID}`),
      { params: Promise.resolve({ assetId: ASSET_ID }) },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(await response.text()).toBe("");
  });

  it("does not log presigned queries, object keys, or storage errors", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.allocate.mockResolvedValueOnce({ status: "unavailable" });
    const response = await ALLOCATE(mutationRequest(
      "/api/member-page-assets/uploads",
      { slug: "hamfriend", mimeType: "image/png", byteSize: 68 },
    ));
    expect(response.status).toBe(503);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
