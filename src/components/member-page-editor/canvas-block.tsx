"use client";

import type { AssetMetadata } from "@/components/member-page-v2";
import {
  renderMemberPageV2LeafBlock,
  type MemberPageV2ImageSizes,
} from "@/components/member-page-v2";
import type { MemberBlock } from "@/lib/members/v2/document";

/**
 * Image `sizes` hints for the workbench viewport: a canvas block is measured
 * against the editor's own width, not the public page's. Every other leaf
 * rendering decision comes from the shared dispatcher.
 */
const EDITOR_CANVAS_IMAGE_SIZES: MemberPageV2ImageSizes = {
  framed: "(min-width: 1024px) 768px, calc(100vw - 2.5rem)",
  wide: "(min-width: 1280px) 1152px, calc(100vw - 2.5rem)",
};

/**
 * Renders one block with the public component for its type.
 *
 * Block selection is shared with the public body through
 * `renderMemberPageV2LeafBlock`, so a canvas block is the same markup a
 * visitor gets. The public body keeps ownership of list spacing; the canvas
 * supplies its own, because each block sits inside editor chrome.
 */
export function CanvasBlock({
  block,
  assetMetadata,
  featuredProjectLayout = "standard",
}: {
  block: MemberBlock;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  featuredProjectLayout?: "standard" | "showcase";
}) {
  return renderMemberPageV2LeafBlock(block, {
    assetMetadata,
    imageSizes: EDITOR_CANVAS_IMAGE_SIZES,
    featuredProjectLayout,
  });
}
