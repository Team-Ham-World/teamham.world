import { describe, expect, it, vi } from "vitest";

import {
  allocateMemberPageAsset,
  deleteMemberPageAsset,
  finalizeMemberPageAsset,
  listMemberPageAssets,
  putMemberPageAsset,
  uploadNormalizedMemberPageAsset,
} from "@/components/member-page-editor/asset-api";
import { ASSET_MAX_BYTES } from "@/lib/members/v2/limits";

const ASSET_ID = "550e8400-e29b-41d4-a716-446655440020";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("member asset client API", () => {
  it("runs allocate, exact Content-Type PUT, and finalize in order", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        assetId: ASSET_ID,
        uploadUrl: "https://storage.example/private/path?signature=secret",
        requiredContentType: "image/png",
        requiredByteSize: 3,
        expiresAt: "2026-08-25T12:05:00.000Z",
      }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json({
        assetId: ASSET_ID,
        status: "ready",
        mimeType: "image/png",
        width: 1200,
        height: 800,
        readyAt: "2026-08-25T12:01:00.000Z",
        verifiedAt: "2026-08-25T12:01:00.000Z",
      }));

    const ready = await uploadNormalizedMemberPageAsset(
      { slug: "hamfriend", blob, mimeType: "image/png" },
      { fetchImpl },
    );

    expect(ready).toMatchObject({ assetId: ASSET_ID, status: "ready" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const put = fetchImpl.mock.calls[1];
    expect(put[0]).toBe("https://storage.example/private/path?signature=secret");
    expect(put[1]).toMatchObject({ method: "PUT", body: blob });
    expect((put[1]?.body as Blob).size).toBe(3);
    expect(new Headers(put[1]?.headers).get("content-type")).toBe("image/png");
    // Browsers derive the signed Content-Length from the checked Blob; client
    // code must not try to set the forbidden header itself.
    expect([...new Headers(put[1]?.headers).keys()]).toEqual(["content-type"]);
  });

  it("rejects a body-size mismatch before the direct PUT fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      putMemberPageAsset(
        {
          assetId: ASSET_ID,
          uploadUrl: "https://storage.example/private/path?signature=secret",
          requiredContentType: "image/png",
          requiredByteSize: 3,
          expiresAt: "2026-08-25T12:05:00.000Z",
        },
        new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized allocation before calling the route", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      allocateMemberPageAsset(
        {
          slug: "hamfriend",
          mimeType: "image/png",
          byteSize: ASSET_MAX_BYTES + 1,
        },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses pending and verified ready states without private storage fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      assets: [
        {
          assetId: ASSET_ID,
          status: "pending",
          mimeType: null,
          width: null,
          height: null,
          createdAt: "2026-08-25T12:00:00.000Z",
          readyAt: null,
          verifiedAt: null,
          pendingExpiresAt: "2026-08-25T12:05:00.000Z",
        },
        {
          assetId: "550e8400-e29b-41d4-a716-446655440021",
          status: "ready",
          mimeType: "image/webp",
          width: 640,
          height: 480,
          createdAt: "2026-08-25T11:00:00.000Z",
          readyAt: "2026-08-25T11:01:00.000Z",
          verifiedAt: "2026-08-25T11:01:00.000Z",
          pendingExpiresAt: "2026-08-25T11:05:00.000Z",
        },
      ],
    }));

    const assets = await listMemberPageAssets("hamfriend", fetchImpl);
    expect(assets.map((asset) => asset.status)).toEqual(["pending", "ready"]);
    expect(assets[1]).toMatchObject({ width: 640, height: 480, mimeType: "image/webp" });
    expect(assets[1]).not.toHaveProperty("objectKey");
  });

  it.each([
    ["asset_referenced", "saved draft or live page"],
    ["asset_conflict", "changed while"],
  ] as const)("surfaces a clear %s deletion response", async (code, wording) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({ error: code }, 409),
    );

    await expect(
      deleteMemberPageAsset("hamfriend", ASSET_ID, fetchImpl),
    ).rejects.toMatchObject({
      code,
      message: expect.stringContaining(wording),
    });
  });

  it("surfaces a retryable finalize throttle", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      json({ error: "finalize_rate_limit" }, 429),
    );

    await expect(
      finalizeMemberPageAsset("hamfriend", ASSET_ID, fetchImpl),
    ).rejects.toMatchObject({
      code: "finalize_rate_limit",
      status: 429,
      message: expect.stringContaining("Wait a few minutes"),
    });
  });

  it("deletes storage explicitly without sending or rewriting a page document", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteMemberPageAsset("hamfriend", ASSET_ID, fetchImpl);

    const request = fetchImpl.mock.calls[0][1];
    expect(request?.method).toBe("DELETE");
    expect(JSON.parse(String(request?.body))).toEqual({ slug: "hamfriend" });
  });

  it("fails closed when a response contains an unexpected field", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(json({
      assets: [],
      privateStorageDetail: "must-not-reach-the-editor",
    }));

    await expect(listMemberPageAssets("hamfriend", fetchImpl)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
