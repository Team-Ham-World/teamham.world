import { describe, expect, it } from "vitest";

import {
  extractOpenGraphImage,
  isPublicAddress,
} from "@/lib/members/open-graph";

describe("external showcase Open Graph artwork", () => {
  it("extracts property attributes in either order and resolves relative URLs", () => {
    expect(extractOpenGraphImage(
      '<meta content="/images/card.jpg?one=1&amp;two=2" property="og:image">',
      "https://example.com/projects/one",
    )).toBe("https://example.com/images/card.jpg?one=1&two=2");

    expect(extractOpenGraphImage(
      "<meta property='og:image:secure_url' content='https://cdn.example.com/card.webp'>",
      "https://example.com",
    )).toBe("https://cdn.example.com/card.webp");
  });

  it("ignores non-HTTPS and unrelated metadata", () => {
    expect(extractOpenGraphImage(
      '<meta property="twitter:image" content="https://example.com/twitter.jpg">',
      "https://example.com",
    )).toBeNull();
    expect(extractOpenGraphImage(
      '<meta property="og:image" content="http://example.com/card.jpg">',
      "https://example.com",
    )).toBeNull();
  });

  it("allows globally routable addresses and blocks local or reserved ranges", () => {
    for (const address of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "192.168.1.10",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});
