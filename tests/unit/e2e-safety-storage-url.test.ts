import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_STORAGE_URL,
  resolveStorageUrl,
  uploadOriginViolation,
} from "../e2e/support/environment";

/**
 * Focused regression checks for the storage safety boundary: the approved
 * storage origin must be HTTPS loopback only (no remote hosts, credentials,
 * paths, queries, or fragments), and server-issued upload URLs must point at
 * exactly that origin before the browser uploads any bytes.
 */

const originalStorageUrl = process.env.E2E_STORAGE_URL;

afterEach(() => {
  if (originalStorageUrl === undefined) {
    delete process.env.E2E_STORAGE_URL;
  } else {
    process.env.E2E_STORAGE_URL = originalStorageUrl;
  }
});

describe("resolveStorageUrl accepts only HTTPS loopback origins", () => {
  it("defaults to the local MinIO origin", () => {
    delete process.env.E2E_STORAGE_URL;
    expect(resolveStorageUrl()).toBe(DEFAULT_STORAGE_URL);
    expect(resolveStorageUrl()).toBe("https://localhost:9000");
  });

  it("accepts loopback HTTPS origins and strips a trailing slash", () => {
    for (const accepted of [
      "https://localhost:9000",
      "https://localhost:9000/",
      "https://127.0.0.1:9000",
      "https://[::1]:9000",
    ]) {
      process.env.E2E_STORAGE_URL = accepted;
      expect(resolveStorageUrl()).not.toMatch(/\/$/);
    }
  });

  it("refuses plain HTTP", () => {
    process.env.E2E_STORAGE_URL = "http://localhost:9000";
    expect(() => resolveStorageUrl()).toThrow(/refused/);
  });

  it("refuses remote hosts", () => {
    for (const remote of [
      "https://example.com",
      "https://s3.amazonaws.com",
      "https://minio.internal.cyr1en.dev:9000",
      "https://10.0.0.5:9000",
    ]) {
      process.env.E2E_STORAGE_URL = remote;
      expect(() => resolveStorageUrl(), remote).toThrow(/refused/);
    }
  });

  it("refuses embedded credentials", () => {
    process.env.E2E_STORAGE_URL = "https://user:pass@localhost:9000";
    expect(() => resolveStorageUrl()).toThrow(/refused/);
  });

  it("refuses paths, queries, and fragments", () => {
    for (const shaped of [
      "https://localhost:9000/teamham-member-assets-local",
      "https://localhost:9000/bucket/",
      "https://localhost:9000?x=1",
      "https://localhost:9000#frag",
    ]) {
      process.env.E2E_STORAGE_URL = shaped;
      expect(() => resolveStorageUrl(), shaped).toThrow(/refused/);
    }
  });

  it("refuses values that are not URLs at all", () => {
    process.env.E2E_STORAGE_URL = "not a url";
    expect(() => resolveStorageUrl()).toThrow();
  });
});

describe("uploadOriginViolation guards server-issued upload URLs", () => {
  const approved = "https://localhost:9000";

  it("accepts a real presigned upload URL on the approved origin", () => {
    const uploadUrl =
      "https://localhost:9000/teamham-member-assets-local/member-page-assets/abc123/320-image%2Fpng-xyz?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=cafe";
    expect(uploadOriginViolation(uploadUrl, approved)).toBeNull();
  });

  it("rejects a different host, including lookalike suffixes", () => {
    for (const uploadUrl of [
      "https://localhost.evil.com/teamham-member-assets-local/x",
      "https://evil-localhost:9000/x",
      "https://127.0.0.2:9000/x",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      const violation = uploadOriginViolation(uploadUrl, approved);
      expect(violation, uploadUrl).toContain("not the approved storage origin");
    }
  });

  it("rejects scheme and port downgrades or mismatches", () => {
    for (const uploadUrl of [
      "http://localhost:9000/x",
      "https://localhost:9001/x",
      "https://localhost:80/x",
    ]) {
      expect(uploadOriginViolation(uploadUrl, approved), uploadUrl).toContain(
        "not the approved storage origin",
      );
    }
  });

  it("rejects embedded credentials even when the origin matches", () => {
    expect(
      uploadOriginViolation("https://key:secret@localhost:9000/x", approved),
    ).toContain("embeds credentials");
  });

  it("rejects values that are not URLs", () => {
    expect(uploadOriginViolation("not a url", approved)).toContain(
      "not a valid URL",
    );
  });

  it("does not echo the full upload URL in rejection reasons", () => {
    const secret = "X-Amz-Signature=topsecretvalue";
    const uploadUrl = `https://evil.example.com/x?${secret}`;
    const violation = uploadOriginViolation(uploadUrl, approved);
    expect(violation).not.toBeNull();
    expect(violation).not.toContain(secret);
  });
});
