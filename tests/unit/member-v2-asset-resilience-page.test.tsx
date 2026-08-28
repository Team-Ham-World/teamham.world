import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MemberPage from "@/app/m/[member]/page";
import * as assetDal from "@/lib/members/assets/dal";
import * as memberDal from "@/lib/members/dal";
import * as v2Dal from "@/lib/members/v2/dal";
import * as featureFlag from "@/lib/members/v2/feature-flag";
import * as invalidPublishedDiagnostic from "@/components/member-page-v2/invalid-published-diagnostic";
import type { PublicMemberAssetMetadata } from "@/lib/members/assets/dal";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";

import { minimalMemberPageDocument } from "../fixtures/member-v2/documents";

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
  default: () => <section data-v2-editor>V2 editor</section>,
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
  getPublishedMemberPageAssetMetadata: vi.fn(),
}));

vi.mock("@/lib/members/v2/feature-flag", () => ({
  isMemberPageV2Cohort: vi.fn(),
  isMemberPageV2EditorEnabled: vi.fn(),
}));

const VALID_ID = "asset-portrait";
const DEGRADED_ID = "asset-image-1";
const VALID_METADATA: PublicMemberAssetMetadata = {
  width: 640,
  height: 480,
  mimeType: "image/png",
};

function portraitAndImageDocument(): MemberPageDocumentV2 {
  return {
    ...minimalMemberPageDocument(),
    frame: {
      ...minimalMemberPageDocument().frame,
      displayName: "HAM Friend",
      portrait: {
        assetId: VALID_ID,
        alt: "HAM Friend smiling",
        decorative: false,
      },
    },
    blocks: [
      {
        id: "block-image",
        type: "image",
        variant: "framed",
        image: {
          assetId: DEGRADED_ID,
          alt: "A game board",
          decorative: false,
        },
        caption: "Prototype night.",
      },
    ],
  };
}

function galleryDocument(): MemberPageDocumentV2 {
  return {
    ...minimalMemberPageDocument(),
    frame: {
      ...minimalMemberPageDocument().frame,
      displayName: "Gallery Owner",
    },
    blocks: [
      {
        id: "block-gallery",
        type: "gallery",
        variant: "grid",
        items: [
          {
            id: "kept-item",
            image: {
              assetId: VALID_ID,
              alt: "Kept image",
              decorative: false,
            },
            caption: "Kept caption.",
          },
          {
            id: "dropped-item",
            image: {
              assetId: DEGRADED_ID,
              alt: "Dropped image",
              decorative: false,
            },
            caption: "Dropped caption.",
          },
        ],
      },
    ],
  };
}

function setViewer(value: { isOwner: boolean; isPublished: boolean } | null) {
  vi.mocked(memberDal.getMemberPageForViewer).mockResolvedValue(
    value === null
      ? null
      : {
          page: {
            slug: "hamfriend",
            displayName: "Legacy Name",
            blurb: null,
            websiteUrl: null,
            socialLinks: {},
            showcase: null,
          },
          isOwner: value.isOwner,
          isPublished: value.isPublished,
        },
  );
}

function setPublishedV2(
  document: MemberPageDocumentV2 | null,
  slug: string = "hamfriend",
) {
  vi.mocked(v2Dal.getPublishedMemberPageV2).mockResolvedValue(
    document === null
      ? { status: "not-found-or-forbidden" }
      : { status: "success", data: { slug, document } },
  );
}

function setAssetMetadata(
  result: Awaited<ReturnType<typeof assetDal.getPublishedMemberPageAssetMetadata>>,
) {
  vi.mocked(assetDal.getPublishedMemberPageAssetMetadata).mockResolvedValue(
    result,
  );
}

async function renderForSlug(slug: string) {
  const page = await MemberPage({
    params: Promise.resolve({ member: slug }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(featureFlag.isMemberPageV2Cohort).mockReturnValue(false);
  vi.mocked(featureFlag.isMemberPageV2EditorEnabled).mockReturnValue(false);
  setPublishedV2(null);
  vi.mocked(v2Dal.getOwnedMemberPageDraftV2).mockResolvedValue({
    status: "not-found-or-forbidden",
  });
  setViewer(null);
  setAssetMetadata({
    status: "success",
    metadata: new Map(),
    degradedAssetIds: new Set<string>(),
  });
});

describe("public rendering with degraded assets", () => {
  it("keeps unaffected content and valid media visible when one asset degrades", async () => {
    setPublishedV2(portraitAndImageDocument());
    setViewer({ isOwner: false, isPublished: true });
    setAssetMetadata({
      status: "success",
      metadata: new Map([[VALID_ID, VALID_METADATA]]),
      degradedAssetIds: new Set([DEGRADED_ID]),
    });

    // HTTP 200 content: the render resolves instead of throwing NEXT_NOT_FOUND.
    const html = await renderForSlug("hamfriend");

    expect(html).toContain("HAM Friend");
    // The valid portrait keeps its metadata-driven rendering.
    expect(html).toContain(`/member-assets/${VALID_ID}`);
    expect(html).toContain('width="640"');
    // The degraded standalone image is omitted instead of taking the page down.
    expect(html).not.toContain(`/member-assets/${DEGRADED_ID}`);
    expect(html).not.toContain("A game board");
  });

  it("omits degraded gallery items without leaving caption-only shells", async () => {
    setPublishedV2(galleryDocument());
    setViewer({ isOwner: false, isPublished: true });
    setAssetMetadata({
      status: "success",
      metadata: new Map([[VALID_ID, VALID_METADATA]]),
      degradedAssetIds: new Set([DEGRADED_ID]),
    });

    const html = await renderForSlug("hamfriend");

    // The valid item renders with its image and caption.
    expect(html).toContain("Gallery");
    expect(html).toContain("/member-assets/asset-portrait");
    expect(html).toContain("Kept caption.");
    // The degraded item vanishes entirely, caption included.
    expect(html).not.toContain("Dropped caption.");
    expect(html).not.toContain("Dropped image");
  });

  it("records a slug-only degraded-render diagnostic once per slug", async () => {
    setPublishedV2(minimalMemberPageDocument(), "degraded-render-one");
    setViewer({ isOwner: false, isPublished: true });
    setAssetMetadata({
      status: "success",
      metadata: new Map(),
      degradedAssetIds: new Set([DEGRADED_ID]),
    });

    await renderForSlug("degraded-render-one");
    await renderForSlug("degraded-render-one");

    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[member-page] published V2 page rendered with degraded assets",
      { slug: "degraded-render-one" },
    );
  });

  it("records no degraded diagnostic when every asset resolves", async () => {
    setPublishedV2(minimalMemberPageDocument(), "degraded-render-two");
    setViewer({ isOwner: false, isPublished: true });
    setAssetMetadata({
      status: "success",
      metadata: new Map([[VALID_ID, VALID_METADATA]]),
      degradedAssetIds: new Set<string>(),
    });

    await renderForSlug("degraded-render-two");

    expect(console.warn).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).not.toHaveBeenCalled();
  });

  it("reports a metadata outage as a service failure instead of a 404", async () => {
    setPublishedV2(minimalMemberPageDocument(), "degraded-render-three");
    setViewer({ isOwner: false, isPublished: true });
    setAssetMetadata({ status: "unavailable" });

    await expect(renderForSlug("degraded-render-three")).rejects.toThrow(
      /temporarily unavailable/u,
    );
    // Distinguishable from the branded not-found path.
    await expect(renderForSlug("degraded-render-three")).rejects.not.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).not.toHaveBeenCalled();
  });

  it("still fails closed for a malformed document or unsafe theme", async () => {
    vi.mocked(v2Dal.getPublishedMemberPageV2).mockResolvedValue({
      status: "invalid",
    });
    setViewer({ isOwner: false, isPublished: true });

    await expect(renderForSlug("degraded-render-four")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(assetDal.getPublishedMemberPageAssetMetadata).not.toHaveBeenCalled();
    expect(
      invalidPublishedDiagnostic.recordInvalidPublishedV2Read,
    ).toHaveBeenCalledWith("degraded-render-four");

    // An enabled-theme miss is also a whole-page failure, not a degradation.
    const unsafeTheme = minimalMemberPageDocument();
    unsafeTheme.frame.theme.accentId = "disabled-accent";
    setPublishedV2(unsafeTheme, "degraded-render-five");
    await expect(renderForSlug("degraded-render-five")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(assetDal.getPublishedMemberPageAssetMetadata).not.toHaveBeenCalled();
  });
});
