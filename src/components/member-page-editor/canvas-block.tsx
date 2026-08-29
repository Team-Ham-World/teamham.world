"use client";

import type { AssetMetadata } from "@/components/member-page-v2";
import {
  memberPageV2ImageSizesForPlacement,
  renderMemberPageV2LeafBlock,
  type MemberPageV2ImageSizes,
  type MemberPageV2Placement,
  type MemberPageV2RowColumnPx,
} from "@/components/member-page-v2";
import type { MemberBlock } from "@/lib/members/v2/document";

/**
 * Image `sizes` hints for the workbench viewport: a canvas block is measured
 * against the editor's own width, not the public page's.
 */
const EDITOR_CANVAS_IMAGE_SIZES: MemberPageV2ImageSizes = {
  framed: "(min-width: 1024px) 768px, calc(100vw - 2.5rem)",
  wide: "(min-width: 1280px) 1152px, calc(100vw - 2.5rem)",
};

/**
 * Row columns at `lg` inside the editor sheet: `max-w-[62rem]` (992px) less
 * its 2px borders and `px-10` padding leaves 908px of content, minus one
 * `gap-14` gutter, split by the row ratio.
 */
const EDITOR_ROW_COLUMN_PX: MemberPageV2RowColumnPx = {
  half: 426,
  third: 284,
  "two-thirds": 568,
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
  placement = "full",
}: {
  block: MemberBlock;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  featuredProjectLayout?: "standard" | "showcase";
  placement?: MemberPageV2Placement;
}) {
  return renderMemberPageV2LeafBlock(block, {
    assetMetadata,
    imageSizes: memberPageV2ImageSizesForPlacement(
      EDITOR_CANVAS_IMAGE_SIZES,
      EDITOR_ROW_COLUMN_PX,
      placement,
    ),
    featuredProjectLayout,
  });
}
