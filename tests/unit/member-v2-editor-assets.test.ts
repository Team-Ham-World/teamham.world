import { describe, expect, it } from "vitest";

import {
  assetMetadataMap,
  buildGalleryBlockFromDraft,
  buildImageBlockFromDraft,
  buildReadyImageRef,
  canUploadReadyAsset,
  finalizedAssetToEditorAsset,
  readyAssetCount,
  upsertEditorAsset,
  type GalleryItemDraft,
} from "@/components/member-page-editor/asset-model";
import type { EditorAsset } from "@/components/member-page-editor/asset-api";
import {
  buildExternalProjectRef,
  withExternalProjectArtwork,
} from "@/components/member-page-editor/block-catalog";
import { MAX_READY_ASSETS } from "@/lib/members/v2/limits";

const READY_ID = "550e8400-e29b-41d4-a716-446655440020";
const READY_ID_2 = "550e8400-e29b-41d4-a716-446655440021";
const PENDING_ID = "550e8400-e29b-41d4-a716-446655440022";

function ready(assetId = READY_ID): EditorAsset {
  return {
    assetId,
    status: "ready",
    mimeType: "image/png",
    width: 1200,
    height: 800,
    createdAt: null,
    readyAt: null,
    verifiedAt: null,
    pendingExpiresAt: null,
  };
}

const pending: EditorAsset = {
  assetId: PENDING_ID,
  status: "pending",
  mimeType: null,
  width: null,
  height: null,
  createdAt: null,
  readyAt: null,
  verifiedAt: null,
  pendingExpiresAt: null,
};

function ids() {
  let value = 0;
  return () => `editor-id-${++value}`;
}

describe("ready-only image references", () => {
  const assets = [ready(), pending];

  it("refuses pending IDs and incomplete alt/decorative states", () => {
    expect(buildReadyImageRef(
      { assetId: PENDING_ID, alt: "Pending image", decorative: false },
      assets,
    )).toBeNull();
    expect(buildReadyImageRef(
      { assetId: READY_ID, alt: "   ", decorative: false },
      assets,
    )).toBeNull();
    expect(buildReadyImageRef(
      { assetId: READY_ID, alt: "Not allowed", decorative: true },
      assets,
    )).toBeNull();
  });

  it("builds exactly informative or decorative portrait/image references", () => {
    expect(buildReadyImageRef(
      { assetId: READY_ID, alt: " Portrait of HAM Friend ", decorative: false },
      assets,
    )).toEqual({
      assetId: READY_ID,
      alt: "Portrait of HAM Friend",
      decorative: false,
    });
    expect(buildReadyImageRef(
      { assetId: READY_ID, alt: "", decorative: true },
      assets,
    )).toEqual({ assetId: READY_ID, alt: null, decorative: true });
  });

  it("creates an image block only after a ready image use is complete", () => {
    expect(buildImageBlockFromDraft({
      variant: "wide",
      image: { assetId: PENDING_ID, alt: "Waiting", decorative: false },
      caption: "Optional caption",
    }, assets, ids())).toBeNull();

    expect(buildImageBlockFromDraft({
      variant: "wide",
      image: { assetId: READY_ID, alt: "A wide prototype", decorative: false },
      caption: " Optional caption ",
    }, assets, ids())).toMatchObject({
      type: "image",
      variant: "wide",
      caption: "Optional caption",
      image: { assetId: READY_ID },
    });
  });
});

describe("gallery creation", () => {
  const assets = [ready(), ready(READY_ID_2)];
  const item = (draftId: string, assetId: string): GalleryItemDraft => ({
    draftId,
    assetId,
    alt: `Description ${draftId}`,
    decorative: false,
    caption: "",
  });

  it("stays transient below two ready items", () => {
    expect(buildGalleryBlockFromDraft({
      variant: "grid",
      items: [item("one", READY_ID)],
    }, assets, ids())).toBeNull();
  });

  it("commits two complete ready items and stable document IDs", () => {
    const block = buildGalleryBlockFromDraft({
      variant: "strip",
      items: [item("one", READY_ID), item("two", READY_ID_2)],
    }, assets, ids());

    expect(block).toMatchObject({ type: "gallery", variant: "strip" });
    expect(block?.items).toHaveLength(2);
    expect(block?.items.map((entry) => entry.image.assetId)).toEqual([
      READY_ID,
      READY_ID_2,
    ]);
  });
});

describe("external project artwork references", () => {
  const assets = [ready(), ready(READY_ID_2), pending];

  it("adds, replaces, and removes one canonical ready artwork reference", () => {
    const project = buildExternalProjectRef({
      name: "Outside project",
      shortDescription: "A project from outside HAM.",
      type: "game",
      status: "released",
      url: "https://example.com/project",
      repository: "",
    });
    if (project.kind !== "external") throw new Error("expected external project");

    const incomplete = buildReadyImageRef(
      { assetId: PENDING_ID, alt: "Waiting", decorative: false },
      assets,
    );
    expect(incomplete).toBeNull();
    expect(project).not.toHaveProperty("artwork");

    const informative = buildReadyImageRef(
      { assetId: READY_ID, alt: " Project title screen ", decorative: false },
      assets,
    );
    if (!informative) throw new Error("expected informative artwork");
    const added = withExternalProjectArtwork(project, informative);
    expect(added.artwork).toEqual({
      assetId: READY_ID,
      alt: "Project title screen",
      decorative: false,
    });

    const decorative = buildReadyImageRef(
      { assetId: READY_ID_2, alt: "", decorative: true },
      assets,
    );
    if (!decorative) throw new Error("expected decorative artwork");
    const edited = withExternalProjectArtwork(added, decorative);
    expect(edited.artwork).toEqual({
      assetId: READY_ID_2,
      alt: null,
      decorative: true,
    });

    expect(withExternalProjectArtwork(edited, null)).not.toHaveProperty("artwork");
  });

  it("preserves canonical artwork while another external project field changes", () => {
    const artwork = buildReadyImageRef(
      { assetId: READY_ID, alt: "Project cover", decorative: false },
      assets,
    );
    if (!artwork) throw new Error("expected ready artwork");

    expect(
      buildExternalProjectRef({
        name: "Edited project name",
        shortDescription: "Description",
        type: "tool",
        status: "playable",
        url: "",
        repository: "",
        artwork,
      }),
    ).toMatchObject({ name: "Edited project name", artwork });
  });
});

describe("quota and live verified metadata", () => {
  it("counts only ready assets toward the 20-image quota", () => {
    const nineteenReady = Array.from({ length: MAX_READY_ASSETS - 1 }, (_, index) =>
      ready(`ready-${index}`),
    );
    expect(readyAssetCount([...nineteenReady, pending])).toBe(MAX_READY_ASSETS - 1);
    expect(canUploadReadyAsset([...nineteenReady, pending])).toBe(true);
    expect(canUploadReadyAsset([...nineteenReady, ready("ready-last"), pending])).toBe(
      false,
    );
  });

  it("adds finalized dimensions and MIME to the live canvas metadata immediately", () => {
    const finalized = finalizedAssetToEditorAsset({
      assetId: READY_ID,
      status: "ready",
      mimeType: "image/webp",
      width: 900,
      height: 600,
      readyAt: "2026-08-25T12:01:00.000Z",
      verifiedAt: "2026-08-25T12:01:00.000Z",
    });
    const assets = upsertEditorAsset([pending], finalized);

    expect(assetMetadataMap(assets).get(READY_ID)).toEqual({
      width: 900,
      height: 600,
      mimeType: "image/webp",
    });
  });
});
