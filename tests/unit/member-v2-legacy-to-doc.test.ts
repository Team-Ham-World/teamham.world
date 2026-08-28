import { describe, expect, it } from "vitest";

import type { MemberContentInput } from "@/lib/members/validation";
import { legacyToDoc } from "@/lib/members/v2/legacy-to-doc";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";
import { ALL_PROJECT_STATUSES } from "../fixtures/member-v2/documents";

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? `unexpected-${index}`;
}

const BASE: MemberContentInput = {
  displayName: "HAM Friend",
  blurb: "Makes tiny things.",
  websiteUrl: "https://hamfriend.example",
  socialLinks: {},
  showcase: null,
};

describe("legacy member content to V2 conversion", () => {
  const importedAssetId = "550e8400-e29b-41d4-a716-446655440020";

  it("converts no-showcase and null optionals without requesting IDs", () => {
    const nextId = ids("unused");
    const doc = legacyToDoc({
      ...BASE,
      blurb: null,
      websiteUrl: null,
    }, { ids: nextId });

    expect(doc).toEqual({
      schemaVersion: 2,
      frame: {
        displayName: "HAM Friend",
        summary: null,
        websiteUrl: null,
        socialLinks: {},
        portrait: null,
        theme: { id: "paper", accentId: "default" },
      },
      blocks: [],
    });
    expect(parseMemberPageDocumentV2(doc).success).toBe(true);
  });

  it("converts a HAM showcase to one deterministic featured card", () => {
    const doc = legacyToDoc({
      ...BASE,
      showcase: { kind: "project", projectSlug: "untitled-quiz-show" },
    }, { ids: ids("featured-fixed") });

    expect(doc.blocks).toEqual([{
      id: "featured-fixed",
      type: "featuredProject",
      variant: "card",
      project: { kind: "ham", projectSlug: "untitled-quiz-show" },
    }]);
  });

  it("preserves every external status and omits legacy remote artwork", () => {
    for (const status of ALL_PROJECT_STATUSES) {
      const doc = legacyToDoc({
        ...BASE,
        showcase: {
          kind: "external",
          name: `Project ${status}`,
          shortDescription: "Description",
          type: "game",
          status,
          url: "https://example.com/play",
          repository: "https://github.com/teamham/project",
          imageUrl: "https://remote.example/artwork.png",
        },
      }, { ids: ids(`featured-${status}`) });

      expect(doc.blocks[0]).toMatchObject({
        id: `featured-${status}`,
        project: { status },
      });
      const block = doc.blocks[0];
      if (block.type !== "featuredProject" || block.project.kind !== "external") {
        throw new Error("conversion mismatch");
      }
      expect(block.project).not.toHaveProperty("artwork");
      expect(block.project).not.toHaveProperty("imageUrl");
      expect(parseMemberPageDocumentV2(doc).success).toBe(true);
    }
  });

  it("uses a supplied imported asset ID only for external artwork", () => {
    const doc = legacyToDoc({
      ...BASE,
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        imageUrl: "https://remote.example/artwork.png",
      },
    }, {
      ids: ids("featured-external"),
      externalArtworkAssetId: importedAssetId,
    });

    expect(doc.blocks).toEqual([{
      id: "featured-external",
      type: "featuredProject",
      variant: "card",
      project: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        artwork: {
          assetId: importedAssetId,
          alt: "Weekend Thing showcase artwork",
          decorative: false,
        },
      },
    }]);
  });

  it("carries a complete non-decorative artwork reference through verbatim", () => {
    const carriedArtwork = {
      assetId: importedAssetId,
      alt: "Imported Weekend Thing artwork",
      decorative: false,
    };
    const doc = legacyToDoc({
      ...BASE,
      showcase: {
        kind: "external",
        name: "Weekend Thing renamed",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        imageUrl: "https://remote.example/artwork.png",
      },
    }, {
      ids: ids("featured-external"),
      externalArtwork: carriedArtwork,
    });

    // The existing alt text is accessibility content: a legacy save must not
    // regenerate it from the project name.
    expect(doc.blocks).toEqual([{
      id: "featured-external",
      type: "featuredProject",
      variant: "card",
      project: {
        kind: "external",
        name: "Weekend Thing renamed",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        artwork: {
          assetId: importedAssetId,
          alt: "Imported Weekend Thing artwork",
          decorative: false,
        },
      },
    }]);
    expect(parseMemberPageDocumentV2(doc).success).toBe(true);
  });

  it("rejects carried artwork with V2-only decorative state", () => {
    expect(() => legacyToDoc({
      ...BASE,
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
      },
    }, {
      ids: ids("unused"),
      externalArtwork: {
        assetId: importedAssetId,
        alt: null,
        decorative: true,
      },
    })).toThrow(TypeError);
  });

  it("rejects carried artwork for a non-external showcase", () => {
    expect(() => legacyToDoc({
      ...BASE,
      showcase: { kind: "project", projectSlug: "untitled-quiz-show" },
    }, {
      ids: ids("unused"),
      externalArtwork: {
        assetId: importedAssetId,
        alt: "Imported Weekend Thing artwork",
        decorative: false,
      },
    })).toThrow(TypeError);
  });

  it("rejects supplying carried artwork together with a bare asset ID", () => {
    expect(() => legacyToDoc({
      ...BASE,
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
      },
    }, {
      ids: ids("unused"),
      externalArtworkAssetId: importedAssetId,
      externalArtwork: {
        assetId: importedAssetId,
        alt: "Imported Weekend Thing artwork",
        decorative: false,
      },
    })).toThrow(TypeError);
  });

  it("preserves all supported social links and clones their object", () => {
    const socialLinks = {
      github: "https://github.com/hamfriend",
      bluesky: "https://bsky.app/profile/hamfriend.example",
      mastodon: "https://social.example/@hamfriend",
      instagram: "https://instagram.com/hamfriend",
      youtube: "https://youtube.com/@hamfriend",
      twitch: "https://twitch.tv/hamfriend",
      x: "https://x.com/hamfriend",
    };
    const doc = legacyToDoc({ ...BASE, socialLinks }, { ids: ids("unused") });
    expect(doc.frame.socialLinks).toEqual(socialLinks);
    expect(doc.frame.socialLinks).not.toBe(socialLinks);
  });

  it("returns the same NFC and trimmed document as the V2 parser", () => {
    const doc = legacyToDoc({
      ...BASE,
      displayName: "\u00a0Cafe\u0301 HAM\ufeff",
      blurb: "\u2007Makes cafe\u0301 tools.\u205f",
      websiteUrl: "\u3000https://example.com/cafe\u0301\u202f",
      socialLinks: { x: "\u1680https://x.com/cafe\u0301\u2000" },
      showcase: {
        kind: "external",
        name: "\u00a0Cafe\u0301 project\ufeff",
        shortDescription: "\u2028Cafe\u0301 description.\u2029",
        type: "\u200atool\u3000",
        status: "released",
        url: "\u2007https://example.com/play/cafe\u0301\u205f",
      },
    }, { ids: ids("\u00a0featured-cafe\u0301\ufeff") });

    const parsed = parseMemberPageDocumentV2(doc);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));
    expect(doc).toEqual(parsed.doc);
    expect(doc.frame.displayName).toBe("Café HAM");
    expect(doc.blocks[0]).toMatchObject({
      id: "featured-café",
      project: { name: "Café project", type: "tool" },
    });
  });

  it("fails closed when typed bridge input bypasses legacy validation", () => {
    expect(() => legacyToDoc({
      ...BASE,
      blurb: "invalid\nbridge text",
    }, { ids: ids("unused") })).toThrow(TypeError);
  });
});
