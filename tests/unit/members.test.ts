import { describe, it, expect } from "vitest";

import {
  findMember,
  isValidMemberSlug,
  MEMBERS,
  RESERVED_SUBDOMAINS,
  resolveShowcase,
  type Member,
} from "@/data/members";
import { PROJECTS } from "@/data/projects";

describe("data/members", () => {
  describe("isValidMemberSlug", () => {
    it("accepts RFC 1123 host labels", () => {
      for (const slug of ["cyr1en", "a", "a-b", "x0", "a".repeat(63)]) {
        expect(isValidMemberSlug(slug), slug).toBe(true);
      }
    });

    it("rejects labels a DNS name cannot carry", () => {
      const invalid = [
        "", // empty
        "CyR1en", // uppercase
        "-lead", // leading hyphen
        "trail-", // trailing hyphen
        "under_score",
        "dot.separated",
        "spa ce",
        "a".repeat(64), // one over the 63-character limit
      ];

      for (const slug of invalid) {
        expect(isValidMemberSlug(slug), slug).toBe(false);
      }
    });

    it("rejects labels the apex reserves for itself", () => {
      for (const reserved of RESERVED_SUBDOMAINS) {
        expect(isValidMemberSlug(reserved), reserved).toBe(false);
      }
    });
  });

  describe("catalog integrity", () => {
    it("gives every member a valid, unique slug and a name", () => {
      const seen = new Set<string>();

      for (const member of MEMBERS) {
        expect(isValidMemberSlug(member.slug), member.slug).toBe(true);
        expect(seen.has(member.slug), `duplicate slug ${member.slug}`).toBe(
          false,
        );
        seen.add(member.slug);
        expect(member.name.trim().length).toBeGreaterThan(0);
      }
    });

    it("records every website as an absolute https URL", () => {
      for (const member of MEMBERS) {
        if (!member.website) continue;
        const url = new URL(member.website);
        expect(url.protocol, member.slug).toBe("https:");
      }
    });

    it("points every project showcase at a project that exists", () => {
      const slugs = new Set(PROJECTS.map((project) => project.slug));

      for (const member of MEMBERS) {
        if (member.showcase?.kind !== "project") continue;
        expect(
          slugs.has(member.showcase.projectSlug),
          `${member.slug} references unknown project ${member.showcase.projectSlug}`,
        ).toBe(true);
      }
    });

    it("finds a member by slug and nothing by an unknown one", () => {
      for (const member of MEMBERS) {
        expect(findMember(member.slug)).toBe(member);
      }
      expect(findMember("definitely-not-a-member")).toBeUndefined();
    });
  });

  describe("resolveShowcase", () => {
    const base: Member = { slug: "example", name: "Example" };

    it("returns null when the member has no showcase", () => {
      expect(resolveShowcase(base)).toBeNull();
    });

    it("reads a project showcase out of the project catalog", () => {
      const project = PROJECTS[0];
      const resolved = resolveShowcase({
        ...base,
        showcase: { kind: "project", projectSlug: project.slug },
      });

      expect(resolved).not.toBeNull();
      expect(resolved?.name).toBe(project.name);
      expect(resolved?.status).toBe(project.status);
      expect(resolved?.type).toBe(project.type);
      expect(resolved?.shortDescription).toBe(project.shortDescription);
      expect(resolved?.publicUrl).toBe(project.links?.publicUrl);
      expect(resolved?.repository).toBe(project.links?.repository);
    });

    it("degrades a dangling project reference to no showcase", () => {
      const resolved = resolveShowcase({
        ...base,
        showcase: { kind: "project", projectSlug: "no-such-project" },
      });

      expect(resolved).toBeNull();
    });

    it("passes an external showcase through unchanged", () => {
      const resolved = resolveShowcase({
        ...base,
        showcase: {
          kind: "external",
          name: "Personal Thing",
          shortDescription: "A thing.",
          type: "tool",
          status: "released",
          url: "https://example.com",
          repository: "https://example.com/src",
        },
      });

      expect(resolved).toEqual({
        name: "Personal Thing",
        shortDescription: "A thing.",
        type: "tool",
        status: "released",
        publicUrl: "https://example.com",
        repository: "https://example.com/src",
        artwork: undefined,
      });
    });
  });
});
