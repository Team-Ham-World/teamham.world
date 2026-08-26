import "server-only";

import type { AssetMetadata } from "@/components/member-page-v2";
import { listOwnedMemberPageAssets } from "@/lib/members/assets/dal";
import type { OwnedMemberPageDraftV2 } from "@/lib/members/v2/dal";

import type { EditorAsset } from "./asset-api";

export interface OwnedMemberPageEditorAssets {
  assets: EditorAsset[];
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
}

/**
 * Asset metadata for the owner canvas.
 *
 * The public metadata reader deliberately requires a currently published page,
 * so an unpublished draft would render with no images at all. This uses the
 * owner-scoped asset list instead and keeps the same shape the public renderer
 * expects, so the canvas shows whatever the owner actually has.
 *
 * The library receives both pending and ready rows. Only ready assets with
 * verified dimensions enter the renderer metadata map, exactly as the public
 * path fails closed.
 */
export async function getOwnedMemberPageAssetMetadataForEditor(
  draft: OwnedMemberPageDraftV2,
): Promise<ReadonlyMap<string, AssetMetadata>> {
  return (await getOwnedMemberPageAssetsForEditor(draft)).assetMetadata;
}

export async function getOwnedMemberPageAssetsForEditor(
  draft: OwnedMemberPageDraftV2,
): Promise<OwnedMemberPageEditorAssets> {
  const metadata = new Map<string, AssetMetadata>();
  const assets: EditorAsset[] = [];

  const result = await listOwnedMemberPageAssets(draft.slug);
  if (result.status !== "success") return { assets, assetMetadata: metadata };

  for (const asset of result.assets) {
    if (asset.status === "pending") {
      assets.push({
        assetId: asset.assetId,
        status: "pending",
        mimeType: null,
        width: null,
        height: null,
        createdAt: asset.createdAt,
        readyAt: null,
        verifiedAt: null,
        pendingExpiresAt: asset.pendingExpiresAt,
      });
      continue;
    }
    if (
      asset.mimeType === null ||
      asset.width === null ||
      asset.height === null
    ) {
      continue;
    }
    assets.push({
      assetId: asset.assetId,
      status: "ready",
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
      readyAt: asset.readyAt,
      verifiedAt: asset.verifiedAt,
      pendingExpiresAt: asset.pendingExpiresAt,
    });
    metadata.set(asset.assetId, {
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
    });
  }

  return { assets, assetMetadata: metadata };
}
