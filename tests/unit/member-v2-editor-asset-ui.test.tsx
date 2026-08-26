import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AddBlockPanel } from "@/components/member-page-editor/add-block-panel";
import { AssetLibrary } from "@/components/member-page-editor/asset-library";
import type { EditorAsset } from "@/components/member-page-editor/asset-api";
import { BlockInspector } from "@/components/member-page-editor/block-inspector";
import { CanvasBlock } from "@/components/member-page-editor/canvas-block";
import { FrameInspector } from "@/components/member-page-editor/frame-inspector";
import type {
  FeaturedProjectBlock,
  GalleryBlock,
  ImageBlock,
  MemberProjectRef,
  ProjectListBlock,
} from "@/lib/members/v2/document";
import { getEnabledMemberThemes } from "@/lib/members/v2/themes";

const READY_ID = "550e8400-e29b-41d4-a716-446655440020";
const READY_ID_2 = "550e8400-e29b-41d4-a716-446655440021";
const PENDING_ID = "550e8400-e29b-41d4-a716-446655440022";

const assets: EditorAsset[] = [
  {
    assetId: READY_ID,
    status: "ready",
    mimeType: "image/png",
    width: 1200,
    height: 800,
    createdAt: "2026-08-25T11:00:00.000Z",
    readyAt: "2026-08-25T11:01:00.000Z",
    verifiedAt: "2026-08-25T11:01:00.000Z",
    pendingExpiresAt: "2026-08-25T11:05:00.000Z",
  },
  {
    assetId: READY_ID_2,
    status: "ready",
    mimeType: "image/webp",
    width: 800,
    height: 800,
    createdAt: "2026-08-25T10:00:00.000Z",
    readyAt: "2026-08-25T10:01:00.000Z",
    verifiedAt: "2026-08-25T10:01:00.000Z",
    pendingExpiresAt: "2026-08-25T10:05:00.000Z",
  },
  {
    assetId: PENDING_ID,
    status: "pending",
    mimeType: null,
    width: null,
    height: null,
    createdAt: "2026-08-25T12:00:00.000Z",
    readyAt: null,
    verifiedAt: null,
    pendingExpiresAt: "2026-08-25T12:05:00.000Z",
  },
];

function nextId() {
  return "next-editor-id";
}

describe("asset library UI", () => {
  it("shows pending/ready states, verified metadata, quota, retry, refresh, and delete", () => {
    const html = renderToStaticMarkup(
      <AssetLibrary
        slug="hamfriend"
        assets={assets}
        referencedAssetIds={new Set([READY_ID])}
        onAssetsChange={() => undefined}
        confirmDelete={() => true}
      />,
    );

    expect(html).toContain("2 / 20 ready · 1 pending");
    expect(html).toContain("Asset library loaded. 2 ready, 1 pending.");
    expect(html).not.toContain("Loading the latest image states");
    expect(html).toContain("Ready · verified");
    expect(html).toContain("1200 × 800 · PNG");
    expect(html).toContain("Pending");
    expect(html).toContain("Retry check");
    expect(html).toContain("Refresh library");
    expect(html).toContain("Delete stored image");
    expect(html).toContain("Used in this draft");
  });

  it("stacks asset cards into the narrow tool rail", () => {
    const html = renderToStaticMarkup(
      <AssetLibrary
        slug="hamfriend"
        assets={assets}
        referencedAssetIds={new Set()}
        onAssetsChange={() => undefined}
        confirmDelete={() => true}
        layout="rail"
      />,
    );

    // The rail supplies the panel frame, so the library drops its own and
    // pairs the thumbnails up rather than running one per row.
    expect(html).toContain('data-asset-library-layout="rail"');
    expect(html).toContain("grid-cols-2");
    expect(html).not.toContain("shadow-[4px_4px_0_0_var(--color-ink)]");
  });
});

describe("portrait, image, and gallery controls", () => {
  it("offers a transient portrait add flow from the frame inspector", () => {
    const html = renderToStaticMarkup(
      <FrameInspector
        frame={{
          displayName: "HAM Friend",
          summary: null,
          websiteUrl: null,
          socialLinks: {},
          portrait: null,
          theme: { id: "paper", accentId: "default" },
        }}
        assets={assets}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Portrait");
    expect(html).toContain("Add portrait");
  });

  it("offers only reviewed theme/accent IDs with labelled previews and 44px selects", () => {
    for (const theme of getEnabledMemberThemes()) {
      const accentId = theme.defaultAccentId;
      const html = renderToStaticMarkup(
        <FrameInspector
          frame={{
            displayName: "HAM Friend",
            summary: null,
            websiteUrl: null,
            socialLinks: {},
            portrait: null,
            theme: { id: theme.id, accentId },
          }}
          assets={assets}
          onChange={() => undefined}
        />,
      );

      for (const enabledTheme of getEnabledMemberThemes()) {
        expect(html).toContain(enabledTheme.label);
      }
      for (const accent of Object.values(theme.accents)) {
        expect(html).toContain(accent.label);
      }
      expect(html).toContain('data-theme-preview="true"');
      expect(html).toContain(`data-theme-id="${theme.id}"`);
      expect(html).toContain(`data-accent-id="${accentId}"`);
      expect(html).toContain("private draft until you publish");
      expect(html).not.toContain('type="color"');
      for (const select of html.match(/<select[^>]*>/gu) ?? []) {
        expect(select).toContain("min-h-11");
      }
    }
  });

  it("renders ready-only image and gallery inspectors with optional captions", () => {
    const image: ImageBlock = {
      id: "image-block",
      type: "image",
      variant: "framed",
      image: { assetId: READY_ID, alt: "Prototype board", decorative: false },
      caption: null,
    };
    const gallery: GalleryBlock = {
      id: "gallery-block",
      type: "gallery",
      variant: "grid",
      items: [
        {
          id: "gallery-one",
          image: { assetId: READY_ID, alt: "Prototype board", decorative: false },
          caption: null,
        },
        {
          id: "gallery-two",
          image: { assetId: READY_ID_2, alt: null, decorative: true },
          caption: "Second view",
        },
      ],
    };

    const imageHtml = renderToStaticMarkup(
      <BlockInspector
        block={image}
        assets={assets}
        nextId={nextId}
        onChange={() => undefined}
      />,
    );
    const galleryHtml = renderToStaticMarkup(
      <BlockInspector
        block={gallery}
        assets={assets}
        nextId={nextId}
        onChange={() => undefined}
      />,
    );

    expect(imageHtml).toContain("Alternative text");
    expect(imageHtml).toContain("Caption");
    expect(imageHtml).not.toContain(PENDING_ID);
    expect(galleryHtml).toContain("Gallery image 1");
    expect(galleryHtml).toContain("Gallery image 2");
    expect(galleryHtml).toContain("Add gallery image");
    expect(galleryHtml).toMatch(/<button[^>]*disabled[^>]*aria-label="Remove gallery image 1"/);
  });

  it("makes image and gallery available in the add-block menu", () => {
    const html = renderToStaticMarkup(
      <AddBlockPanel
        canAddBlock
        canAddFeaturedProject
        blockCount={0}
        maxBlocks={12}
        nextId={nextId}
        assets={assets}
        onAdd={() => undefined}
      />,
    );
    expect(html).toContain("Add Image");
    expect(html).toContain("Add Gallery");
  });
});

describe("external project artwork controls", () => {
  const externalProject: Extract<MemberProjectRef, { kind: "external" }> = {
    kind: "external",
    name: "Outside project",
    shortDescription: "An external project.",
    type: "game",
    status: "released",
  };
  const externalWithoutArtwork: FeaturedProjectBlock = {
    id: "featured-no-artwork",
    type: "featuredProject",
    variant: "card",
    project: externalProject,
  };
  const externalWithArtwork: FeaturedProjectBlock = {
    ...externalWithoutArtwork,
    id: "featured-with-artwork",
    project: {
      ...externalProject,
      artwork: {
        assetId: READY_ID,
        alt: "Project title screen",
        decorative: false,
      },
    },
  };

  it("offers optional add, edit, and remove controls for featured external refs", () => {
    const addHtml = renderToStaticMarkup(
      <BlockInspector
        block={externalWithoutArtwork}
        assets={assets}
        nextId={nextId}
        onChange={() => undefined}
      />,
    );
    const editHtml = renderToStaticMarkup(
      <BlockInspector
        block={externalWithArtwork}
        assets={assets}
        nextId={nextId}
        onChange={() => undefined}
      />,
    );

    expect(addHtml).toContain("Project artwork");
    expect(addHtml).toContain("Add project artwork");
    expect(editHtml).toContain("Stored image");
    expect(editHtml).toContain("Alternative text");
    expect(editHtml).toContain("Remove project artwork");
    expect(editHtml).toContain(READY_ID_2);
    expect(editHtml).not.toContain(PENDING_ID);
    expect(editHtml).not.toMatch(/project artwork (url|object key|data url)/iu);

    for (const button of editHtml.match(/<button[^>]*>/gu) ?? []) {
      expect(button).toContain("min-h-11");
    }
    for (const select of editHtml.match(/<select[^>]*>/gu) ?? []) {
      expect(select).toContain("min-h-11");
    }
  });

  it("supports the same ready-only artwork editor on external project-list entries", () => {
    const list: ProjectListBlock = {
      id: "project-list",
      type: "projectList",
      variant: "stacked",
      projects: [
        {
          id: "external-entry",
          project: externalWithArtwork.project,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <BlockInspector
        block={list}
        assets={assets}
        nextId={nextId}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("Project artwork");
    expect(html).toContain("Remove project artwork");
    expect(html).not.toContain(PENDING_ID);
  });

  it("keeps HAM project facts and registry artwork outside member controls", () => {
    const ham: FeaturedProjectBlock = {
      id: "ham-featured",
      type: "featuredProject",
      variant: "artwork-first",
      project: { kind: "ham", projectSlug: "untitled-quiz-show" },
    };
    const html = renderToStaticMarkup(
      <BlockInspector
        block={ham}
        assets={assets}
        nextId={nextId}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("come from HAM&#x27;s project catalog");
    expect(html).not.toContain("Project artwork");
    expect(html).not.toContain("Stored image");
  });

  it("updates the live canvas through the existing public project renderer", () => {
    const metadata = new Map([
      [READY_ID, { width: 1200, height: 800, mimeType: "image/png" }],
    ]);
    const withArtwork = renderToStaticMarkup(
      <CanvasBlock block={externalWithArtwork} assetMetadata={metadata} />,
    );
    const withoutArtwork = renderToStaticMarkup(
      <CanvasBlock block={externalWithoutArtwork} assetMetadata={metadata} />,
    );

    expect(withArtwork).toContain(`/member-assets/${READY_ID}`);
    expect(withArtwork).toContain('alt="Project title screen"');
    expect(withoutArtwork).not.toContain(`/member-assets/${READY_ID}`);
  });
});
