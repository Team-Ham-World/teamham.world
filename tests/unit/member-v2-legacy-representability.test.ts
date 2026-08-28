import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => "development" }));
vi.mock("@/lib/auth/db", () => ({ getDbClient: () => mocks.query }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentVerifiedAccount: mocks.currentAccount,
}));

import { updateMemberPageAction } from "@/app/m/[member]/actions";
import {
  setMemberPublication,
  updateOwnedMemberPage,
  MemberMutationError,
} from "@/lib/members/dal";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import {
  assessLegacyRepresentability,
} from "@/lib/members/v2/legacy-representability";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";
import {
  minimalMemberPageDocument,
  richTextFixture,
} from "../fixtures/member-v2/documents";

const MEMBER_ACCOUNT = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  accessStatus: "active" as const,
  membershipStatus: "eligible" as const,
  expiresAt: new Date(Date.now() + 60_000),
  username: "hamfriend",
  siteRole: "member" as const,
};

const ADMIN_ACCOUNT = {
  ...MEMBER_ACCOUNT,
  id: "550e8400-e29b-41d4-a716-446655440001",
  siteRole: "admin" as const,
};

const PAGE_ID = "550e8400-e29b-41d4-a716-446655440010";
const IMPORTED_ARTWORK_ASSET_ID = "550e8400-e29b-41d4-a716-446655440020";

const LEGACY_SAVE_INPUT = {
  displayName: "HAM Friend",
  blurb: null,
  websiteUrl: null,
  socialLinks: {},
  showcase: null,
};

function legacyRepresentableDocument(): MemberPageDocumentV2 {
  return minimalMemberPageDocument();
}

function legacyExternalCardDocument(): MemberPageDocumentV2 {
  return {
    ...minimalMemberPageDocument(),
    blocks: [{
      id: `legacy-featured-${PAGE_ID}`,
      type: "featuredProject",
      variant: "card",
      project: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        url: "https://example.com/weekend-thing",
        artwork: {
          assetId: IMPORTED_ARTWORK_ASSET_ID,
          alt: "Imported Weekend Thing artwork",
          decorative: false,
        },
      },
    }],
  };
}

function v2OnlyDocument(): MemberPageDocumentV2 {
  return {
    schemaVersion: 2,
    frame: {
      displayName: "HAM Friend",
      summary: "Makes tiny things.",
      websiteUrl: "https://hamfriend.example",
      socialLinks: { github: "https://github.com/hamfriend" },
      portrait: {
        assetId: "550e8400-e29b-41d4-a716-446655440021",
        alt: "HAM Friend portrait",
        decorative: false,
      },
      theme: { id: "riso", accentId: "soy-red" },
    },
    blocks: [
      { id: "block-rich", type: "richText", content: richTextFixture() },
      {
        id: "block-gallery",
        type: "gallery",
        variant: "grid",
        items: [
          {
            id: "gallery-1",
            image: { assetId: "asset-gallery-1", alt: "One", decorative: false },
            caption: null,
          },
          {
            id: "gallery-2",
            image: { assetId: "asset-gallery-2", alt: null, decorative: true },
            caption: null,
          },
        ],
      },
    ],
  };
}

function expectValidDocument(document: MemberPageDocumentV2) {
  const parsed = parseMemberPageDocumentV2(document);
  expect(parsed.success).toBe(true);
}

const ORIGINAL_V2_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_V2_EDITOR_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("legacy representability assessment", () => {
  it("accepts the empty legacy draft", () => {
    expectValidDocument(legacyRepresentableDocument());
    expect(assessLegacyRepresentability(legacyRepresentableDocument())).toEqual({
      outcome: "legacy-representable",
    });
  });

  it("accepts a HAM showcase card", () => {
    const document: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{
        id: "legacy-featured-1",
        type: "featuredProject",
        variant: "card",
        project: { kind: "ham", projectSlug: "untitled-quiz-show" },
      }],
    };
    expect(assessLegacyRepresentability(document)).toEqual({
      outcome: "legacy-representable",
    });
  });

  it("accepts an external card with imported artwork regardless of alt text", () => {
    expectValidDocument(legacyExternalCardDocument());
    expect(assessLegacyRepresentability(legacyExternalCardDocument())).toEqual({
      outcome: "legacy-representable",
    });

    const derivedAlt = legacyExternalCardDocument();
    const [card] = derivedAlt.blocks;
    if (card?.type !== "featuredProject" || card.project.kind !== "external") {
      throw new Error("fixture mismatch");
    }
    card.project.artwork = {
      assetId: IMPORTED_ARTWORK_ASSET_ID,
      alt: "Weekend Thing showcase artwork",
      decorative: false,
    };
    expect(assessLegacyRepresentability(derivedAlt)).toEqual({
      outcome: "legacy-representable",
    });
  });

  it("accepts the full legacy frame without depending on key order", () => {
    const document = minimalMemberPageDocument();
    const reordered = {
      blocks: [...document.blocks],
      frame: {
        theme: { ...document.frame.theme },
        portrait: document.frame.portrait,
        socialLinks: {
          x: "https://x.com/hamfriend",
          github: "https://github.com/hamfriend",
        },
        websiteUrl: "https://hamfriend.example",
        summary: "Makes tiny things.",
        displayName: "HAM Friend",
      },
      schemaVersion: document.schemaVersion,
    };
    expect(assessLegacyRepresentability(reordered)).toEqual({
      outcome: "legacy-representable",
    });
  });

  it("rejects a portrait with a stable reason and path", () => {
    const document: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      frame: {
        ...minimalMemberPageDocument().frame,
        portrait: {
          assetId: "asset-portrait",
          alt: "HAM Friend smiling",
          decorative: false,
        },
      },
    };
    expect(assessLegacyRepresentability(document)).toEqual({
      outcome: "not-legacy-representable",
      reason: "portrait-present",
      path: ["frame", "portrait"],
    });
  });

  it("rejects non-paper themes and non-default paper accents", () => {
    const riso: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      frame: {
        ...minimalMemberPageDocument().frame,
        theme: { id: "riso", accentId: "soy-red" },
      },
    };
    expect(assessLegacyRepresentability(riso)).toEqual({
      outcome: "not-legacy-representable",
      reason: "theme-not-legacy-default",
      path: ["frame", "theme"],
    });

    const newsprint: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      frame: {
        ...minimalMemberPageDocument().frame,
        theme: { id: "newsprint", accentId: "archive-blue" },
      },
    };
    expect(assessLegacyRepresentability(newsprint)).toMatchObject({
      outcome: "not-legacy-representable",
      reason: "theme-not-legacy-default",
    });
  });

  it("rejects multiple blocks even when the first block is legacy-shaped", () => {
    const document: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [
        {
          id: "legacy-featured-1",
          type: "featuredProject",
          variant: "card",
          project: { kind: "ham", projectSlug: "untitled-quiz-show" },
        },
        {
          id: "block-note",
          type: "calloutQuote",
          variant: "note",
          text: "Making things.",
          attribution: null,
        },
      ],
    };
    expectValidDocument(document);
    expect(assessLegacyRepresentability(document)).toEqual({
      outcome: "not-legacy-representable",
      reason: "blocks-count",
      path: ["blocks"],
    });
  });

  it("rejects rich text, galleries, images, callouts, project lists, and links", () => {
    const richText: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{ id: "block-rich", type: "richText", content: richTextFixture() }],
    };
    expect(assessLegacyRepresentability(richText)).toEqual({
      outcome: "not-legacy-representable",
      reason: "block-kind",
      path: ["blocks", 0, "type"],
    });

    const gallery: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{
        id: "block-gallery",
        type: "gallery",
        variant: "strip",
        items: [
          {
            id: "gallery-1",
            image: { assetId: "asset-gallery-1", alt: "One", decorative: false },
            caption: null,
          },
          {
            id: "gallery-2",
            image: { assetId: "asset-gallery-2", alt: "Two", decorative: false },
            caption: null,
          },
        ],
      }],
    };
    expect(assessLegacyRepresentability(gallery)).toMatchObject({
      reason: "block-kind",
    });

    const image: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{
        id: "block-image",
        type: "image",
        variant: "framed",
        image: { assetId: "asset-image-1", alt: "A board", decorative: false },
        caption: null,
      }],
    };
    expect(assessLegacyRepresentability(image)).toMatchObject({
      reason: "block-kind",
    });

    const callout: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{
        id: "block-note",
        type: "calloutQuote",
        variant: "note",
        text: "Making things.",
        attribution: null,
      }],
    };
    expect(assessLegacyRepresentability(callout)).toMatchObject({
      reason: "block-kind",
    });

    const projectList: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{
        id: "block-projects",
        type: "projectList",
        variant: "stacked",
        projects: [{
          id: "project-1",
          project: { kind: "ham", projectSlug: "untitled-quiz-show" },
        }],
      }],
    };
    expect(assessLegacyRepresentability(projectList)).toMatchObject({
      reason: "block-kind",
    });

    const links: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{
        id: "block-links",
        type: "additionalLinks",
        variant: "list",
        links: [{
          id: "link-1",
          label: "Newsletter",
          url: "https://example.com/newsletter",
          description: null,
        }],
      }],
    };
    expect(assessLegacyRepresentability(links)).toMatchObject({
      reason: "block-kind",
    });
  });

  it("rejects the artwork-first featured variant", () => {
    const document: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{
        id: "legacy-featured-1",
        type: "featuredProject",
        variant: "artwork-first",
        project: { kind: "ham", projectSlug: "untitled-quiz-show" },
      }],
    };
    expect(assessLegacyRepresentability(document)).toEqual({
      outcome: "not-legacy-representable",
      reason: "block-variant",
      path: ["blocks", 0, "variant"],
    });
  });

  it("rejects decorative project artwork", () => {
    const document: MemberPageDocumentV2 = {
      ...minimalMemberPageDocument(),
      blocks: [{
        id: "legacy-featured-1",
        type: "featuredProject",
        variant: "card",
        project: {
          kind: "external",
          name: "Weekend Thing",
          shortDescription: "Made over a weekend.",
          type: "tool",
          status: "released",
          artwork: {
            assetId: IMPORTED_ARTWORK_ASSET_ID,
            alt: null,
            decorative: true,
          },
        },
      }],
    };
    expect(assessLegacyRepresentability(document)).toEqual({
      outcome: "not-legacy-representable",
      reason: "artwork-decorative",
      path: ["blocks", 0, "project", "artwork", "decorative"],
    });
  });

  it("rejects a full V2 document at its first unrepresentable node", () => {
    const document = v2OnlyDocument();
    expectValidDocument(document);
    expect(assessLegacyRepresentability(document)).toEqual({
      outcome: "not-legacy-representable",
      reason: "portrait-present",
      path: ["frame", "portrait"],
    });
  });

  it("reports unparseable values without a rejection reason", () => {
    for (const value of [
      null,
      "not a document",
      42,
      { schemaVersion: 1, frame: {}, blocks: [] },
      { ...minimalMemberPageDocument(), unexpected: true },
    ]) {
      expect(assessLegacyRepresentability(value)).toEqual({
        outcome: "not-a-member-page-document-v2",
      });
    }
  });
});

describe("legacy mutation representability guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMBER_PAGE_V2_ALLOWLIST;
    delete process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;
    mocks.currentAccount.mockResolvedValue(MEMBER_ACCOUNT);
  });

  afterEach(() => {
    restoreEnvironmentVariable("MEMBER_PAGE_V2_ALLOWLIST", ORIGINAL_V2_ALLOWLIST);
    restoreEnvironmentVariable(
      "MEMBER_PAGE_V2_EDITOR_DISABLED",
      ORIGINAL_V2_EDITOR_DISABLED,
    );
  });

  it("rejects a non-cohort legacy save before it can overwrite V2-only documents", async () => {
    const stored = v2OnlyDocument();
    mocks.query.mockResolvedValueOnce([{
      id: PAGE_ID,
      slug: "hamfriend",
      draft_doc: stored,
      published_doc: stored,
      is_published: true,
    }]);

    await expect(
      updateOwnedMemberPage("hamfriend", LEGACY_SAVE_INPUT),
    ).rejects.toMatchObject({
      code: "invalid",
      message: expect.stringContaining("legacy editor cannot save"),
    });

    // Only the guard SELECT ran. No UPDATE statement was issued, so the
    // stored draft and published documents remain byte-for-byte unchanged.
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [strings] = mocks.query.mock.calls[0];
    const sql = strings.join("?");
    expect(sql).toContain("SELECT id, slug, draft_doc, published_doc");
    expect(sql).not.toContain("UPDATE");
  });

  it("returns the safe owner-facing action error without revalidation", async () => {
    const stored = v2OnlyDocument();
    mocks.query.mockResolvedValueOnce([{
      id: PAGE_ID,
      slug: "hamfriend",
      draft_doc: stored,
      published_doc: stored,
      is_published: true,
    }]);

    const formData = new FormData();
    formData.set("slug", "hamfriend");
    formData.set("displayName", "HAM Friend");
    formData.set("showcaseKind", "none");

    await expect(updateMemberPageAction(
      { status: "idle", message: "", fieldErrors: {} },
      formData,
    )).resolves.toMatchObject({
      status: "error",
      message: expect.stringContaining("legacy editor cannot save"),
      fieldErrors: {},
    });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    // The error must not quote stored content.
    expect(JSON.stringify(mocks.query.mock.calls)).not.toContain("richText");
  });

  it("guards the published snapshot of a published page during legacy saves", async () => {
    mocks.query.mockResolvedValueOnce([{
      id: PAGE_ID,
      slug: "hamfriend",
      draft_doc: legacyRepresentableDocument(),
      published_doc: v2OnlyDocument(),
      is_published: true,
    }]);

    await expect(
      updateOwnedMemberPage("hamfriend", LEGACY_SAVE_INPUT),
    ).rejects.toBeInstanceOf(MemberMutationError);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("still saves a legacy-representable page while unscoped documents stay untouched", async () => {
    const stored = legacyExternalCardDocument();
    mocks.query
      .mockResolvedValueOnce([{
        id: PAGE_ID,
        slug: "hamfriend",
        draft_doc: stored,
        published_doc: v2OnlyDocument(),
        is_published: false,
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await expect(updateOwnedMemberPage("hamfriend", {
      ...LEGACY_SAVE_INPUT,
      showcase: {
        kind: "external",
        name: "Weekend Thing",
        shortDescription: "Made over a weekend.",
        type: "tool",
        status: "released",
        url: "https://example.com/weekend-thing",
      },
    })).resolves.toBe("hamfriend");

    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[1][0].join("?")).toContain(
      "UPDATE public.member_pages",
    );
    const [, ...values] = mocks.query.mock.calls[1];
    const documents = values.filter(
      (value: unknown) =>
        typeof value === "object" && value !== null && "schemaVersion" in value,
    );
    // Both parameters are bound (draft_doc and the published CASE branch),
    // even though the CASE leaves published_doc untouched while unpublished.
    expect(documents).toHaveLength(2);
    expect(documents[0]).toEqual(documents[1]);
    // A representable legacy save must carry the complete stored artwork
    // reference through — asset ID, custom alt text, and the informative
    // decorative flag — instead of regenerating alt from the project name.
    expect(documents[0]).toMatchObject({
      blocks: [{
        project: {
          artwork: {
            assetId: IMPORTED_ARTWORK_ASSET_ID,
            alt: "Imported Weekend Thing artwork",
            decorative: false,
          },
        },
      }],
    });
  });

  it("rejects admin publication when the live snapshot is V2-only", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query.mockResolvedValueOnce([{
      slug: "hamfriend",
      moderation_hold: false,
      draft_doc: legacyRepresentableDocument(),
      published_doc: v2OnlyDocument(),
    }]);

    await expect(
      setMemberPublication(PAGE_ID, true),
    ).rejects.toBeInstanceOf(MemberMutationError);

    // No UPDATE ran, so published_doc stays byte-for-byte unchanged.
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0].join("?")).not.toContain("UPDATE");
  });

  it("rejects admin publication when the draft is V2-only", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query.mockResolvedValueOnce([{
      slug: "hamfriend",
      moderation_hold: false,
      draft_doc: v2OnlyDocument(),
      published_doc: legacyRepresentableDocument(),
    }]);

    await expect(
      setMemberPublication(PAGE_ID, true),
    ).rejects.toBeInstanceOf(MemberMutationError);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("publishes when both stored documents are legacy-representable", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    mocks.query
      .mockResolvedValueOnce([{
        slug: "hamfriend",
        moderation_hold: false,
        draft_doc: legacyRepresentableDocument(),
        published_doc: legacyRepresentableDocument(),
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await expect(setMemberPublication(PAGE_ID, true)).resolves.toBe("hamfriend");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls[1][0].join("?")).toContain(
      "UPDATE public.member_pages",
    );
  });

  it("never blocks an emergency unpublish of V2-only documents", async () => {
    mocks.currentAccount.mockResolvedValue(ADMIN_ACCOUNT);
    const stored = v2OnlyDocument();
    mocks.query
      .mockResolvedValueOnce([{
        slug: "hamfriend",
        moderation_hold: false,
        draft_doc: stored,
        published_doc: stored,
      }])
      .mockResolvedValueOnce([{ slug: "hamfriend" }]);

    await expect(setMemberPublication(PAGE_ID, false)).resolves.toBe("hamfriend");
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("keeps cohort rejection ahead of the representability guard", async () => {
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "true";

    await expect(
      updateOwnedMemberPage("hamfriend", LEGACY_SAVE_INPUT),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
