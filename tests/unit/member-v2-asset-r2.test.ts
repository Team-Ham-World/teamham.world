import { describe, expect, it } from "vitest";

import type { MemberPageR2Config } from "@/lib/members/assets/config";
import {
  R2ResponseTooLargeError,
  R2StorageError,
  createR2StorageAdapter,
  type AwsClientLike,
} from "@/lib/members/assets/r2";

const CONFIG: MemberPageR2Config = {
  environment: "nonproduction",
  accountId: "a".repeat(32),
  accessKeyId: "B".repeat(32),
  secretAccessKey: "s".repeat(64),
  bucket: "teamham-member-assets-nonproduction",
  endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com/teamham-member-assets-nonproduction`,
  region: "auto",
};

class FakeAwsClient implements AwsClientLike {
  calls: Array<{ url: string; init: Parameters<AwsClientLike["sign"]>[1] }> = [];

  async sign(
    input: Request | { toString(): string },
    init?: Parameters<AwsClientLike["sign"]>[1],
  ): Promise<Request> {
    const url = input instanceof Request ? input.url : input.toString();
    this.calls.push({ url, init });
    const signedUrl = new URL(url);
    if (init?.aws?.signQuery) {
      signedUrl.searchParams.set(
        "X-Amz-SignedHeaders",
        "content-length;content-type;host",
      );
      signedUrl.searchParams.set("X-Amz-Signature", "redacted");
    }
    return new Request(signedUrl, {
      method: init?.method,
      headers: init?.headers,
      redirect: init?.redirect,
    });
  }
}

describe("member V2 R2 adapter", () => {
  it("presigns an exact short-lived PUT scope", async () => {
    const adapter = createR2StorageAdapter(CONFIG, {
      fetch: async () => {
        throw new Error("network must not be used for presigning");
      },
      now: () => new Date("2026-08-25T12:00:00.000Z"),
    });

    const result = await adapter.createPresignedPut({
      objectKey: "member-pages/page_1/image-1.webp",
      contentType: "image/webp",
      byteSize: 68,
      expiresInSeconds: 300,
    });

    expect(result.method).toBe("PUT");
    expect(result.headers.get("content-type")).toBe("image/webp");
    expect(result.headers.get("content-length")).toBe("68");
    expect(result.expiresAt.toISOString()).toBe("2026-08-25T12:05:00.000Z");
    const signedUrl = new URL(result.url);
    expect(signedUrl.pathname).toBe(
      "/teamham-member-assets-nonproduction/member-pages/page_1/image-1.webp",
    );
    expect(signedUrl.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(
      signedUrl.searchParams.get("X-Amz-SignedHeaders")?.split(";"),
    ).toContain("content-type");
    expect(
      signedUrl.searchParams.get("X-Amz-SignedHeaders")?.split(";"),
    ).toContain("content-length");
  });

  it("rejects invalid presign expiry, size, and object-key boundaries", async () => {
    const adapter = createR2StorageAdapter(CONFIG, {
      awsClient: new FakeAwsClient(),
    });
    for (const expiresInSeconds of [0, 1.5, 901]) {
      await expect(
        adapter.createPresignedPut({
          objectKey: "member-pages/page/image.webp",
          contentType: "image/webp",
          byteSize: 68,
          expiresInSeconds,
        }),
      ).rejects.toBeInstanceOf(R2StorageError);
    }
    await expect(
      adapter.createPresignedPut({
        objectKey: "../image.webp",
        contentType: "image/webp",
        byteSize: 68,
        expiresInSeconds: 300,
      }),
    ).rejects.toBeInstanceOf(R2StorageError);
    for (const byteSize of [0, 1.5, 5_242_881]) {
      await expect(
        adapter.createPresignedPut({
          objectKey: "member-pages/page/image.webp",
          contentType: "image/webp",
          byteSize,
          expiresInSeconds: 300,
        }),
      ).rejects.toBeInstanceOf(R2StorageError);
    }
  });

  it("signs HEAD, ranged GET, bounded full GET, and DELETE through injected fetch", async () => {
    const aws = new FakeAwsClient();
    const requests: Request[] = [];
    const responses = [
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "6",
          "content-type": "image/png",
          etag: '"etag"',
          "last-modified": "Tue, 25 Aug 2026 12:00:00 GMT",
        },
      }),
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: {
          "content-range": "bytes 0-2/6",
          "content-length": "3",
          "content-type": "image/png",
          etag: '"etag"',
        },
      }),
      new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), {
        status: 200,
        headers: {
          "content-length": "6",
          "content-type": "image/png",
          etag: '"etag"',
        },
      }),
      new Response(null, { status: 204 }),
    ];
    const adapter = createR2StorageAdapter(CONFIG, {
      awsClient: aws,
      fetch: async (input) => {
        requests.push(input as Request);
        return responses.shift()!;
      },
    });

    await expect(adapter.headObject("member-pages/a/image.png")).resolves.toMatchObject({
      byteSize: 6,
      contentType: "image/png",
      etag: "etag",
    });
    await expect(
      adapter.getObjectRange("member-pages/a/image.png", 0, 2, {
        ifMatch: "etag",
      }),
    ).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      etag: "etag",
      contentRange: { start: 0, end: 2, totalSize: 6 },
    });
    await expect(
      adapter.getObject("member-pages/a/image.png", 6, { ifMatch: "etag" }),
    ).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6]),
      etag: "etag",
    });
    await expect(
      adapter.deleteObject("member-pages/a/image.png", { ifMatch: "etag" }),
    ).resolves.toBeUndefined();

    expect(requests.map((request) => request.method)).toEqual([
      "HEAD",
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[1].headers.get("range")).toBe("bytes=0-2");
    expect(requests[1].headers.get("if-match")).toBe('"etag"');
    expect(requests[2].headers.get("if-match")).toBe('"etag"');
    expect(requests[3].headers.get("if-match")).toBe('"etag"');
    expect(requests.every((request) => request.redirect === "error")).toBe(true);
  });

  it("rejects traversal, non-2xx responses, malformed ranges, and oversized streams", async () => {
    const aws = new FakeAwsClient();
    const responses = [
      new Response(null, { status: 404 }),
      new Response(new Uint8Array([1, 2]), {
        status: 206,
        headers: { "content-range": "invalid", etag: '"etag"' },
      }),
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3, 4]));
            controller.close();
          },
        }),
        { status: 200, headers: { etag: '"etag"' } },
      ),
    ];
    const adapter = createR2StorageAdapter(CONFIG, {
      awsClient: aws,
      fetch: async () => responses.shift()!,
    });

    await expect(adapter.headObject("../secret")).rejects.toBeInstanceOf(R2StorageError);
    await expect(adapter.headObject("safe/key")).rejects.toMatchObject({ status: 404 });
    await expect(adapter.getObjectRange("safe/key", 0, 1)).rejects.toBeInstanceOf(
      R2StorageError,
    );
    await expect(adapter.getObject("safe/key", 3)).rejects.toBeInstanceOf(
      R2ResponseTooLargeError,
    );
  });

  it("rejects weak/malformed ETags and invalid conditional identities", async () => {
    const responses = [
      new Response(null, {
        status: 200,
        headers: { "content-length": "1", etag: 'W/"weak"' },
      }),
      new Response(null, {
        status: 200,
        headers: { "content-length": "1", etag: '"unterminated' },
      }),
    ];
    const adapter = createR2StorageAdapter(CONFIG, {
      awsClient: new FakeAwsClient(),
      fetch: async () => responses.shift()!,
    });
    await expect(adapter.headObject("safe/key")).rejects.toBeInstanceOf(
      R2StorageError,
    );
    await expect(adapter.headObject("safe/key")).rejects.toBeInstanceOf(
      R2StorageError,
    );
    await expect(
      adapter.getObject("safe/key", 1, { ifMatch: 'W/"weak"' }),
    ).rejects.toBeInstanceOf(R2StorageError);
  });

  it("rejects signed request origin, path, method, and redirect mutations", async () => {
    const mutations = [
      (url: URL, init: RequestInit) =>
        new Request("https://example.com/changed", {
          method: init.method,
          headers: init.headers,
          redirect: "error",
        }),
      (url: URL, init: RequestInit) => {
        url.pathname = `${url.pathname}-changed`;
        return new Request(url, {
          method: init.method,
          headers: init.headers,
          redirect: "error",
        });
      },
      (url: URL, init: RequestInit) =>
        new Request(url, {
          method: "POST",
          headers: init.headers,
          redirect: "error",
        }),
      (url: URL, init: RequestInit) =>
        new Request(url, {
          method: init.method,
          headers: init.headers,
          redirect: "follow",
        }),
    ];

    for (const mutate of mutations) {
      const adapter = createR2StorageAdapter(CONFIG, {
        awsClient: {
          async sign(input, init) {
            return mutate(new URL(input.toString()), init ?? {});
          },
        },
        fetch: async () => new Response(null, { status: 200 }),
      });
      await expect(adapter.headObject("safe/key")).rejects.toBeInstanceOf(
        R2StorageError,
      );
    }
  });

  it("rejects presign scope mutation and missing signed upload headers", async () => {
    for (const mutation of [
      "path",
      "method",
      "content-type",
      "content-length",
    ] as const) {
      const adapter = createR2StorageAdapter(CONFIG, {
        awsClient: {
          async sign(input, init) {
            const url = new URL(input.toString());
            if (mutation === "path") url.pathname += "-changed";
            url.searchParams.set(
              "X-Amz-SignedHeaders",
              mutation === "content-type"
                ? "content-length;host"
                : mutation === "content-length"
                  ? "content-type;host"
                  : "content-length;content-type;host",
            );
            return new Request(url, {
              method: mutation === "method" ? "POST" : init?.method,
              headers: init?.headers,
            });
          },
        },
      });
      await expect(
        adapter.createPresignedPut({
          objectKey: "safe/image.webp",
          contentType: "image/webp",
          byteSize: 68,
          expiresInSeconds: 300,
        }),
      ).rejects.toBeInstanceOf(R2StorageError);
    }
  });
});
