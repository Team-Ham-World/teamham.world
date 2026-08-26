import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeMemberImage } from "@/components/member-page-editor/image-normalization";
import { ASSET_MAX_BYTES } from "@/lib/members/v2/limits";

function pngSource(type = "image/png"): Blob {
  return new Blob([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
  ], { type });
}

function installCanvas(
  encode: (mimeType: string) => Blob | null = (mimeType) =>
    new Blob([new Uint8Array([1, 2, 3])], { type: mimeType }),
) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage,
    })),
    toBlob: vi.fn((callback: (blob: Blob | null) => void, mimeType: string) => {
      callback(encode(mimeType));
    }),
  };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => canvas),
  });
  return { canvas, drawImage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("member image browser normalization", () => {
  it("decodes with orientation, downsizes to 4000px, and returns a fresh static encoding", async () => {
    const close = vi.fn();
    const create = vi.fn(async () => ({ width: 8000, height: 2000, close }));
    vi.stubGlobal("createImageBitmap", create);
    const { canvas, drawImage } = installCanvas();
    const source = pngSource();

    const result = await normalizeMemberImage(source);

    expect(create).toHaveBeenCalledWith(source, { imageOrientation: "from-image" });
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4000, 1000);
    expect(result).toMatchObject({
      mimeType: "image/png",
      width: 4000,
      height: 1000,
      sourceWidth: 8000,
      sourceHeight: 2000,
    });
    expect(result.blob).not.toBe(source);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "GIF",
      source: new Blob(["GIF89a"], { type: "image/gif" }),
      code: "gif_not_supported",
    },
    {
      label: "SVG",
      source: new Blob(["<svg xmlns='http://www.w3.org/2000/svg'></svg>"], {
        type: "image/svg+xml",
      }),
      code: "svg_not_supported",
    },
  ])("rejects $label before browser decode", async ({ source, code }) => {
    const create = vi.fn();
    vi.stubGlobal("createImageBitmap", create);

    await expect(normalizeMemberImage(source)).rejects.toMatchObject({ code });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a claimed type that does not match the file signature", async () => {
    await expect(normalizeMemberImage(pngSource("image/jpeg"))).rejects.toMatchObject({
      code: "mime_mismatch",
    });
  });

  it("rejects unsupported binary input", async () => {
    await expect(
      normalizeMemberImage(new Blob([new Uint8Array([1, 2, 3, 4])])),
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("reports failed browser encodes", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 20,
      height: 10,
      close: vi.fn(),
    })));
    installCanvas(() => null);

    await expect(normalizeMemberImage(pngSource())).rejects.toMatchObject({
      code: "encode_failed",
    });
  });

  it("enforces the 5 MB normalized limit after every fallback", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      width: 20,
      height: 10,
      close: vi.fn(),
    })));
    installCanvas((mimeType) => ({
      size: ASSET_MAX_BYTES + 1,
      type: mimeType,
    }) as Blob);

    await expect(normalizeMemberImage(pngSource())).rejects.toMatchObject({
      code: "normalized_too_large",
    });
  });
});
