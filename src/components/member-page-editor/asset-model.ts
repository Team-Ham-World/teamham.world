import type { AssetMetadata } from "@/components/member-page-v2";
import type {
  GalleryBlock,
  ImageBlock,
  MemberImageRef,
} from "@/lib/members/v2/document";
import {
  MAX_CAPTION_CHARS,
  MAX_COLLECTION_ITEMS,
  MAX_IMAGE_ALT_CHARS,
  MAX_READY_ASSETS,
  MIN_GALLERY_ITEMS,
} from "@/lib/members/v2/limits";

import type {
  EditorAsset,
  FinalizedEditorAsset,
  ReadyEditorAsset,
} from "./asset-api";
import type { MemberEditorIdGenerator } from "./ids";

export interface ImageUseDraft {
  assetId: string;
  alt: string;
  decorative: boolean;
}

export interface GalleryItemDraft extends ImageUseDraft {
  draftId: string;
  caption: string;
}

export function readyEditorAssets(
  assets: readonly EditorAsset[],
): ReadyEditorAsset[] {
  return assets.filter((asset): asset is ReadyEditorAsset => asset.status === "ready");
}

export function readyAssetCount(assets: readonly EditorAsset[]): number {
  return readyEditorAssets(assets).length;
}

export function canUploadReadyAsset(assets: readonly EditorAsset[]): boolean {
  return readyAssetCount(assets) < MAX_READY_ASSETS;
}

export function isReadyAssetId(
  assets: readonly EditorAsset[],
  assetId: string,
): boolean {
  return assets.some(
    (asset) => asset.status === "ready" && asset.assetId === assetId,
  );
}

/** The only browser-side commit point for a document image reference. */
export function buildReadyImageRef(
  draft: ImageUseDraft,
  assets: readonly EditorAsset[],
): MemberImageRef | null {
  if (!isReadyAssetId(assets, draft.assetId)) return null;
  if (draft.decorative) {
    return draft.alt.trim() === ""
      ? { assetId: draft.assetId, alt: null, decorative: true }
      : null;
  }
  const alt = draft.alt.trim();
  return alt === "" || alt.length > MAX_IMAGE_ALT_CHARS
    ? null
    : { assetId: draft.assetId, alt, decorative: false };
}

export function imageRefToDraft(image: MemberImageRef): ImageUseDraft {
  return {
    assetId: image.assetId,
    alt: image.alt ?? "",
    decorative: image.decorative,
  };
}

export function buildImageBlockFromDraft(
  draft: {
    variant: ImageBlock["variant"];
    image: ImageUseDraft;
    caption: string;
  },
  assets: readonly EditorAsset[],
  nextId: MemberEditorIdGenerator,
): ImageBlock | null {
  const image = buildReadyImageRef(draft.image, assets);
  if (!image) return null;
  const caption = draft.caption.trim();
  if (caption.length > MAX_CAPTION_CHARS) return null;
  return {
    id: nextId(),
    type: "image",
    variant: draft.variant,
    image,
    caption: caption === "" ? null : caption,
  };
}

export function buildGalleryBlockFromDraft(
  draft: {
    variant: GalleryBlock["variant"];
    items: readonly GalleryItemDraft[];
  },
  assets: readonly EditorAsset[],
  nextId: MemberEditorIdGenerator,
): GalleryBlock | null {
  if (
    draft.items.length < MIN_GALLERY_ITEMS ||
    draft.items.length > MAX_COLLECTION_ITEMS
  ) {
    return null;
  }
  const items = draft.items.map((item) => {
    const image = buildReadyImageRef(item, assets);
    const caption = item.caption.trim();
    if (caption.length > MAX_CAPTION_CHARS) return null;
    return image
      ? {
          id: nextId(),
          image,
          caption: caption === "" ? null : caption,
        }
      : null;
  });
  if (items.some((item) => item === null)) return null;
  return {
    id: nextId(),
    type: "gallery",
    variant: draft.variant,
    items: items as GalleryBlock["items"],
  };
}

export function finalizedAssetToEditorAsset(
  asset: FinalizedEditorAsset,
  previous?: EditorAsset,
): ReadyEditorAsset {
  return {
    assetId: asset.assetId,
    status: "ready",
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    createdAt: previous?.createdAt ?? null,
    readyAt: asset.readyAt,
    verifiedAt: asset.verifiedAt,
    pendingExpiresAt: previous?.pendingExpiresAt ?? null,
  };
}

export function upsertEditorAsset(
  assets: readonly EditorAsset[],
  next: EditorAsset,
): EditorAsset[] {
  return [next, ...assets.filter((asset) => asset.assetId !== next.assetId)];
}

export function assetMetadataMap(
  assets: readonly EditorAsset[],
): ReadonlyMap<string, AssetMetadata> {
  const metadata = new Map<string, AssetMetadata>();
  for (const asset of assets) {
    if (asset.status !== "ready") continue;
    metadata.set(asset.assetId, {
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
    });
  }
  return metadata;
}

export function editorAssetsFromMetadata(
  metadata: ReadonlyMap<string, AssetMetadata>,
): EditorAsset[] {
  return [...metadata.entries()].map(([assetId, value]) => ({
    assetId,
    status: "ready" as const,
    mimeType: value.mimeType as ReadyEditorAsset["mimeType"],
    width: value.width,
    height: value.height,
    createdAt: null,
    readyAt: null,
    verifiedAt: null,
    pendingExpiresAt: null,
  }));
}
