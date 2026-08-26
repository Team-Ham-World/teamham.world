import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MemberPage, { generateMetadata } from "@/app/m/[member]/page";
import * as assetDal from "@/lib/members/assets/dal";
import * as memberDal from "@/lib/members/dal";
import * as v2Dal from "@/lib/members/v2/dal";
import * as featureFlag from "@/lib/members/v2/feature-flag";
import * as fallbackDiagnostic from "@/components/member-page-editor/legacy-fallback-diagnostic";
import * as invalidPublishedDiagnostic from "@/components/member-page-v2/invalid-published-diagnostic";

import {
  canonicalMemberPageDocument,
  minimalMemberPageDocument,
} from "../fixtures/member-v2/documents";

vi.mock("next/server", () => ({ connection: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/components/member-editor", () => ({
  MemberEditor: () => <section data-member-editor>Legacy editor</section>,
}));

vi.mock("@/components/member-page-editor/editor-mount", () => ({
  default: ({ draft }: { draft: { slug: string } }) => (
    <section data-v2-editor data-slug={draft.slug}>
      V2 editor
    </section>
  ),
}));

vi.mock("@/components/member-page-editor/owner-asset-metadata", () => ({
  getOwnedMemberPageAssetMetadataForEditor: vi.fn(async () => new Map()),
  getOwnedMemberPageAssetsForEditor: vi.fn(async () => ({
    assets: [],
    assetMetadata: new Map(),
  })),
}));

vi.mock("@/components/member-page-editor/legacy-fallback-diagnostic", () => ({
  recordLegacyFallbackRender: vi.fn(),
}));

vi.mock("@/components/member-page-v2/invalid-published-diagnostic", () => ({
  recordInvalidPublishedV2Read: vi.fn(),
}));

vi.mock("@/lib/members/dal", () => ({
  getMemberPageForViewer: vi.fn(),
}));

vi.mock("@/lib/members/v2/dal", () => ({
  getPublishedMemberPageV2: vi.fn(),
  getOwnedMemberPageDraftV2: vi.fn(),
}));

vi.mock("@/lib/members/assets/dal", () => ({
  getPublishedMemberPageAssetMetadata: vi.fn(async () => ({
    status: "success",
    metadata: new Map(),
  })),
}));

vi.mock("@/lib/members/v2/feature-flag", () => ({
  isMemberPageV2Cohort: vi.fn(),
  isMemberPageV2EditorEnabled: vi.fn(),
}));

const SLUG = "hamfriend";

const LEGACY_PAGE: {
  slug: string;
  displayName: string;
  blurb: string | null;
  websiteUrl: string | null;
  socialLinks: Record<string, string>;
  showcase: null;
} = {
  slug: SLUG,
  displayName: "Legacy Name",
  blurb: "Legacy blurb.",
  websiteUrl: null,
  socialLinks: {},
  showcase: null,
};

function setViewer(
  value: { isOwner: boolean; isPublished: boolean } | null,
  page: typeof LEGACY_PAGE = LEGACY_PAGE,
) {
  vi.mocked(memberDal.getMemberPageForViewer).mockResolvedValue(
    value === null ? null : { page, isOwner: value.isOwner, isPublished: value.isPublished },
  );
}

function setPublishedV2(document: ReturnType<typeof canonicalMemberPageDocument> | null) {
  vi.mocked(v2Dal.getPublishedMemberPageV2).mockResolvedValue(
    document === null
      ? { status: "not-found-or-forbidden" }
      : { status: "success", data: { slug: SLUG, document } },
  );
}

function setInvalidPublishedV2() {
  vi.mocked(v2Dal.getPublishedMemberPageV2).mockResolvedValue({
    status: "invalid",
  });
}

function setDraft(document: ReturnType<typeof canonicalMemberPageDocument> | null, extra?: {
  isPublished?: boolean;
  moderationHold?: boolean;
  hasPublishedSnapshot?: boolean;
}) {
  vi.mocked(v2Dal.getOwnedMemberPageDraftV2).mockResolvedValue(
    document === null
      ? { status: "not-found-or-forbidden" }
      : {
          status: "success",
          data: {
            pageId: "11111111-1111-4111-8111-111111111111",
            slug: SLUG,
            draft: document,
            draftRev: 4,
            isPublished: extra?.isPublished ?? false,
            moderationHold: extra?.moderationHold ?? false,
            hasPublishedSnapshot: extra?.hasPublishedSnapshot ?? false,
            draftUpdatedAt: "2026-01-01T00:00:00.000Z",
            publishedAt: null,
            unpublishedAt: null,
          },
        },
  );
}

function setCohort({ cohort, editor }: { cohort: boolean; editor: boolean }) {
  vi.mocked(featureFlag.isMemberPageV2Cohort).mockReturnValue(cohort);
  vi.mocked(featureFlag.isMemberPageV2EditorEnabled).mockReturnValue(editor);
}

async function renderForSlug(
  slug: string,
  searchParams: Record<string, string> = {},
) {
  const page = await MemberPage({
    params: Promise.resolve({ member: slug }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(page);
}

async function render(searchParams: Record<string, string> = {}) {
  return renderForSlug(SLUG, searchParams);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assetDal.getPublishedMemberPageAssetMetadata).mockResolvedValue({
    status: "success",
    metadata: new Map(),
  });
  setCohort({ cohort: false, editor: false });
  setPublishedV2(null);
  setDraft(null);
  setViewer(null);
});

describe("public member page rendering", () => {
  it("renders the published V2 document for a visitor", async () => {
    setPublishedV2(canonicalMemberPageDocument());
    setViewer({ isOwner: false, isPublished: true });

    const html = await render();

    expect(html).toContain("HAM Friend");
    expect(html).toContain("Makes tiny games and useful tools.");
    // The legacy presentation must not appear alongside the V2 frame.
    expect(html).not.toContain("Legacy Name");
    expect(html).not.toContain("Legacy blurb.");
    expect(html).not.toContain("data-member-editor");
    expect(html).not.toContain("data-v2-editor");
  });

  it("does not mix V1 data into the V2 frame even when both exist", async () => {
    setPublishedV2(minimalMemberPageDocument());
    setViewer({ isOwner: false, isPublished: true }, {
      ...LEGACY_PAGE,
      websiteUrl: "https://legacy.example",
      socialLinks: { github: "https://github.com/legacy" },
    });

    const html = await render();

    expect(html).not.toContain("legacy.example");
    expect(html).not.toContain("github.com/legacy");
  });

  it("falls back to the published V1 page when no V2 page exists", async () => {
    setPublishedV2(null);
    setViewer({ isOwner: false, isPublished: true });

    const html = await render();

    expect(html).toContain("Legacy Name");
    expect(html).toContain("Legacy blurb.");
    expect(fallbackDiagnostic.recordLegacyFallbackRender).toHaveBeenCalledWith(
      SLUG,
    );
  });

  it("fails closed for a cohort publish race instead of rendering V1 after a no-row read", async () => {
    setCohort({ cohort: true, editor: true });
    setPublishedV2(null);
    setViewer({ isOwner: false, isPublished: true });

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(fallbackDiagnostic.recordLegacyFallbackRender).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).not.toHaveBeenCalled();
  });

  it("fails closed instead of exposing V1 when the published V2 row is malformed", async () => {
    setInvalidPublishedV2();
    setViewer({ isOwner: false, isPublished: true });

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(memberDal.getMemberPageForViewer).not.toHaveBeenCalled();
    expect(fallbackDiagnostic.recordLegacyFallbackRender).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).toHaveBeenCalledWith(SLUG);
  });

  it("fails closed instead of exposing V1 when the published theme cannot resolve", async () => {
    const document = minimalMemberPageDocument();
    document.frame.theme.accentId = "disabled-accent";
    setPublishedV2(document);
    setViewer({ isOwner: false, isPublished: true });

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(memberDal.getMemberPageForViewer).not.toHaveBeenCalled();
    expect(fallbackDiagnostic.recordLegacyFallbackRender).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).toHaveBeenCalledWith(SLUG);
  });

  it("404s for a visitor when nothing is published", async () => {
    setPublishedV2(null);
    setViewer({ isOwner: false, isPublished: false });

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s for a visitor when the slug is unknown", async () => {
    setPublishedV2(null);
    setViewer(null);

    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("rejects an invalid slug before reads, cohort checks, or diagnostics", async () => {
    await expect(renderForSlug("not/a/member")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(v2Dal.getPublishedMemberPageV2).not.toHaveBeenCalled();
    expect(memberDal.getMemberPageForViewer).not.toHaveBeenCalled();
    expect(featureFlag.isMemberPageV2Cohort).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).not.toHaveBeenCalled();
  });

  it("ignores ?edit=1 from a visitor", async () => {
    setCohort({ cohort: true, editor: true });
    setPublishedV2(canonicalMemberPageDocument());
    setDraft(canonicalMemberPageDocument());
    setViewer({ isOwner: false, isPublished: true });

    const html = await render({ edit: "1" });

    expect(html).not.toContain("data-v2-editor");
    expect(html).not.toContain("data-member-editor");
    expect(v2Dal.getOwnedMemberPageDraftV2).not.toHaveBeenCalled();
  });
});

describe("owner editor gating", () => {
  it("loads the V2 editor for the owner of a cohort page asking to edit", async () => {
    setCohort({ cohort: true, editor: true });
    setDraft(canonicalMemberPageDocument());
    setViewer({ isOwner: true, isPublished: false });

    const html = await render({ edit: "1" });

    expect(html).toContain("data-v2-editor");
    expect(html).toContain(`data-slug="${SLUG}"`);
    expect(html).not.toContain("data-member-editor");
  });

  it("does not load any editor for the owner until they ask to edit", async () => {
    setCohort({ cohort: true, editor: true });
    setDraft(canonicalMemberPageDocument());
    setPublishedV2(canonicalMemberPageDocument());
    setViewer({ isOwner: true, isPublished: true });

    const html = await render();

    expect(html).not.toContain("data-v2-editor");
    expect(v2Dal.getOwnedMemberPageDraftV2).not.toHaveBeenCalled();
  });

  it("gives the owner of an unpublished cohort page a private way in", async () => {
    setCohort({ cohort: true, editor: true });
    setPublishedV2(null);
    setViewer({ isOwner: true, isPublished: false });

    const html = await render();

    expect(html).toContain("Private to you");
    expect(html).toContain("This page is not public yet");
    expect(html).not.toContain("This page is live and anyone can see it");
    expect(html).toContain(`?edit=1#edit-page`);
    // No token, no shareable preview address.
    expect(html).not.toMatch(/token|preview=/i);
  });

  it("tells the owner when the published page is already live", async () => {
    setCohort({ cohort: true, editor: true });
    setPublishedV2(canonicalMemberPageDocument());
    setViewer({ isOwner: true, isPublished: true });

    const html = await render();

    expect(html).toContain("This page is live and anyone can see it");
    expect(html).not.toContain("This page is not public yet");
  });

  it("hides the editor when the kill switch is on, without falling back to the legacy editor", async () => {
    setCohort({ cohort: true, editor: false });
    setDraft(canonicalMemberPageDocument());
    setViewer({ isOwner: true, isPublished: false });

    const html = await render({ edit: "1" });

    expect(html).not.toContain("data-v2-editor");
    expect(html).not.toContain("data-member-editor");
    expect(html).toContain("Page editing is paused");
    expect(v2Dal.getOwnedMemberPageDraftV2).not.toHaveBeenCalled();
  });

  it("never shows the legacy editor on a cohort page that is published as V2", async () => {
    setCohort({ cohort: true, editor: false });
    setPublishedV2(canonicalMemberPageDocument());
    setViewer({ isOwner: true, isPublished: true });

    const html = await render({ edit: "1" });

    expect(html).not.toContain("data-member-editor");
    expect(html).toContain("HAM Friend");
  });

  it("still uses the legacy editor for an owner outside the cohort", async () => {
    setCohort({ cohort: false, editor: false });
    setPublishedV2(canonicalMemberPageDocument());
    setViewer({ isOwner: true, isPublished: true });

    const html = await render({ edit: "1" });

    expect(html).toContain("data-member-editor");
    expect(html).not.toContain("data-v2-editor");
  });
});

describe("member page metadata", () => {
  async function metadataFor(slug: string = SLUG) {
    return generateMetadata({ params: Promise.resolve({ member: slug }) });
  }

  it("uses the published V2 frame", async () => {
    setPublishedV2(canonicalMemberPageDocument());
    setViewer({ isOwner: false, isPublished: true });

    const metadata = await metadataFor();

    expect(metadata.title).toBe("HAM Friend — HAM");
    expect(metadata.description).toBe("Makes tiny games and useful tools.");
  });

  it("falls back to the published V1 page", async () => {
    setPublishedV2(null);
    setViewer({ isOwner: false, isPublished: true });

    const metadata = await metadataFor();

    expect(metadata.title).toBe("Legacy Name — HAM");
    expect(metadata.description).toBe("Legacy blurb.");
  });

  it("uses private metadata without terminating an unpublished cohort owner route", async () => {
    setCohort({ cohort: true, editor: true });
    setPublishedV2(null);
    setViewer({ isOwner: false, isPublished: true });

    await expect(metadataFor()).resolves.toEqual({
      title: "Member not found — HAM",
      robots: { index: false, follow: false },
    });

    expect(memberDal.getMemberPageForViewer).not.toHaveBeenCalled();
    expect(fallbackDiagnostic.recordLegacyFallbackRender).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).not.toHaveBeenCalled();
  });

  it("fails closed without legacy metadata for an invalid published V2 row", async () => {
    setInvalidPublishedV2();
    setViewer({ isOwner: false, isPublished: true });

    await expect(metadataFor()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(memberDal.getMemberPageForViewer).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).toHaveBeenCalledWith(SLUG);
  });

  it("fails closed without legacy metadata for an unavailable published theme", async () => {
    const document = minimalMemberPageDocument();
    document.frame.theme.accentId = "disabled-accent";
    setPublishedV2(document);
    setViewer({ isOwner: false, isPublished: true });

    await expect(metadataFor()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(memberDal.getMemberPageForViewer).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).toHaveBeenCalledWith(SLUG);
  });

  it("reveals nothing for an unpublished page, even to its owner", async () => {
    setPublishedV2(null);
    setDraft(canonicalMemberPageDocument());
    setViewer({ isOwner: true, isPublished: false });

    const metadata = await metadataFor();

    expect(metadata.title).toBe("Member not found — HAM");
    expect(metadata.description).toBeUndefined();
    expect(v2Dal.getOwnedMemberPageDraftV2).not.toHaveBeenCalled();
  });

  it("rejects invalid metadata slugs without recording a V2 diagnostic", async () => {
    await expect(metadataFor("not/a/member")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );

    expect(v2Dal.getPublishedMemberPageV2).not.toHaveBeenCalled();
    expect(memberDal.getMemberPageForViewer).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).not.toHaveBeenCalled();
  });
});
