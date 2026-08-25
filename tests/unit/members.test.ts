import { describe, expect, it } from "vitest";

import { PROJECTS } from "@/data/projects";
import {
  isValidMemberSlug,
  RESERVED_SUBDOMAINS,
  resolveShowcase,
} from "@/lib/members/model";
import {
  MEMBER_LIMITS,
  parseMemberShowcase,
  validateMemberContent,
} from "@/lib/members/validation";

describe("member model and validation", () => {
  it("accepts usable DNS labels and rejects invalid or reserved labels", () => {
    for (const slug of ["cyr1en", "a", "a-b", "x0", "a".repeat(63)]) {
      expect(isValidMemberSlug(slug), slug).toBe(true);
    }
    for (const slug of ["", "CyR1en", "-lead", "trail-", "under_score", "a".repeat(64)]) {
      expect(isValidMemberSlug(slug), slug).toBe(false);
    }
    for (const slug of RESERVED_SUBDOMAINS) {
      expect(isValidMemberSlug(slug), slug).toBe(false);
    }
  });

  it("strictly parses the editable showcase union", () => {
    expect(parseMemberShowcase({
      kind: "project",
      projectSlug: PROJECTS[0].slug,
    })).toEqual({ kind: "project", projectSlug: PROJECTS[0].slug });

    expect(parseMemberShowcase({
      kind: "external",
      name: "A tiny game",
      shortDescription: "Made on a weekend.",
      type: "game",
      status: "released",
      url: "https://example.com/game",
    })).toEqual({
      kind: "external",
      name: "A tiny game",
      shortDescription: "Made on a weekend.",
      type: "game",
      status: "released",
      url: "https://example.com/game",
    });
  });

  it("rejects unknown projects, non-HTTPS links, and external artwork", () => {
    expect(parseMemberShowcase({ kind: "project", projectSlug: "missing" })).toBeNull();
    expect(parseMemberShowcase({
      kind: "external",
      name: "Thing",
      shortDescription: "A thing.",
      type: "tool",
      status: "released",
      url: "http://example.com",
    })).toBeNull();
    expect(parseMemberShowcase({
      kind: "external",
      name: "Thing",
      shortDescription: "A thing.",
      type: "tool",
      status: "released",
      artwork: { src: "/invented.png", alt: "Invented" },
    })).toBeNull();
  });

  it("validates content bounds and normalizes empty optional fields", () => {
    expect(validateMemberContent({
      displayName: "  HAM Friend  ",
      blurb: "",
      websiteUrl: "",
      showcase: null,
    })).toEqual({
      success: true,
      data: {
        displayName: "HAM Friend",
        blurb: null,
        websiteUrl: null,
        showcase: null,
      },
    });

    const invalid = validateMemberContent({
      displayName: "x".repeat(MEMBER_LIMITS.displayName + 1),
      blurb: "x".repeat(MEMBER_LIMITS.blurb + 1),
      websiteUrl: "http://example.com",
      showcase: null,
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.errors).toMatchObject({
        displayName: expect.any(String),
        blurb: expect.any(String),
        websiteUrl: expect.any(String),
      });
    }
  });

  it("resolves HAM projects and passes external showcases to the renderer", () => {
    const project = PROJECTS[0];
    expect(resolveShowcase({ kind: "project", projectSlug: project.slug })).toMatchObject({
      name: project.name,
      status: project.status,
    });
    expect(resolveShowcase({
      kind: "external",
      name: "Personal Thing",
      shortDescription: "A thing.",
      type: "tool",
      status: "released",
      repository: "https://example.com/source",
    })).toEqual({
      name: "Personal Thing",
      shortDescription: "A thing.",
      type: "tool",
      status: "released",
      publicUrl: undefined,
      repository: "https://example.com/source",
    });
  });
});
