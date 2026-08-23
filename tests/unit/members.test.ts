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

/**
 * Every absolute URL a member entry can put in front of a visitor.
 *
 * Read through `resolveShowcase` rather than off the raw entry, so a
 * `kind: "project"` showcase is checked on the links the page actually renders
 * — which come from `projects.ts`, not from the member entry itself.
 */
function outboundLinks(member: Member): Array<{ field: string; url: string }> {
  const showcase = resolveShowcase(member);

  return [
    { field: "website", url: member.website },
    { field: "showcase.url", url: showcase?.publicUrl },
    { field: "showcase.repository", url: showcase?.repository },
  ].filter((link): link is { field: string; url: string } => Boolean(link.url));
}

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

    it("records every outbound link as an absolute https URL", () => {
      for (const member of MEMBERS) {
        for (const { field, url } of outboundLinks(member)) {
          const label = `${member.slug} ${field}: ${url}`;
          // Parseability is asserted first so a relative URL fails by naming
          // the offending field, rather than as a bare TypeError from `new URL`.
          expect(URL.canParse(url), label).toBe(true);
          expect(new URL(url).protocol, label).toBe("https:");
        }
      }
    });

    /*
     * The guard above iterates the committed catalog, so it passes vacuously
     * while no member has a showcase. This asserts the collector itself finds
     * all three fields — without it, a collector that silently returned nothing
     * would look exactly like a clean catalog.
     */
    it("collects every link field a fully populated member can carry", () => {
      const links = outboundLinks({
        slug: "example",
        name: "Example",
        website: "https://example.com",
        showcase: {
          kind: "external",
          name: "Thing",
          shortDescription: "A thing.",
          type: "tool",
          status: "released",
          url: "https://thing.example.com",
          repository: "https://example.com/src",
        },
      });

      expect(links.map((link) => link.field)).toEqual([
        "website",
        "showcase.url",
        "showcase.repository",
      ]);
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
