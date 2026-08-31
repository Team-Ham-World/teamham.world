import type {
  MemberBlock,
  MemberBlockRowRatio,
  MemberPageDocumentV2,
  MemberPageEntry,
} from "@/lib/members/v2/document";
import { rowEntryKey } from "@/lib/members/v2/member-page-entries";

import { resolveMemberPageProject } from "./blocks/MemberPageV2Project";
import type { AssetMetadata } from "./MemberPageV2View";

export type MemberPageV2Layout = {
  layout: "showcase" | "blocks";
  headerSlotBlock: MemberBlock | null;
  bodyEntries: MemberPageEntry[];
};

/**
 * A row can never occupy the header slot: its blocks use the standard body
 * presentation, because a half-width column cannot borrow the profile's own
 * grid place.
 */
export function getHeaderSlotBlock(
  document: MemberPageDocumentV2,
): MemberBlock | null {
  const [entry] = document.blocks;
  return entry && entry.type !== "row" ? entry : null;
}

export function composeMemberPageV2Layout(
  document: MemberPageDocumentV2,
): MemberPageV2Layout {
  const headerSlotBlock = getHeaderSlotBlock(document);
  const bodyEntries = headerSlotBlock
    ? document.blocks.slice(1)
    : document.blocks;

  return {
    layout: headerSlotBlock ? "showcase" : "blocks",
    headerSlotBlock,
    bodyEntries,
  };
}

export type MemberPageV2Placement = "full" | "half" | "third" | "two-thirds";

export interface MemberPageV2PlacedLeaf {
  block: MemberBlock;
  placement: Exclude<MemberPageV2Placement, "full">;
}

export type MemberPageV2EntryPlan =
  | { kind: "leaf"; key: string; block: MemberBlock }
  | {
      kind: "row";
      key: string;
      ratio: MemberBlockRowRatio;
      left: MemberPageV2PlacedLeaf;
      right: MemberPageV2PlacedLeaf;
    }
  | { kind: "survivor"; key: string; block: MemberBlock }
  | { kind: "omitted" };

const ROW_RATIO_PLACEMENTS: Record<
  MemberBlockRowRatio,
  readonly [
    Exclude<MemberPageV2Placement, "full">,
    Exclude<MemberPageV2Placement, "full">,
  ]
> = {
  "1:1": ["half", "half"],
  "1:2": ["third", "two-thirds"],
  "2:1": ["two-thirds", "third"],
};

export function memberPageV2RowPlacement(
  ratio: MemberBlockRowRatio,
  childIndex: 0 | 1,
): Exclude<MemberPageV2Placement, "full"> {
  return ROW_RATIO_PLACEMENTS[ratio][childIndex];
}

/**
 * This must agree with the leaf components' own omissions: a returned element
 * can still render nothing once its nested component resolves assets.
 */
export function memberPageV2LeafRenderable(
  block: MemberBlock,
  assetMetadata: ReadonlyMap<string, AssetMetadata>,
): boolean {
  switch (block.type) {
    case "richText":
    case "additionalLinks":
    case "calloutQuote":
    case "embed":
      return true;
    case "image":
      return assetMetadata.has(block.image.assetId);
    case "featuredProject":
      return resolveMemberPageProject(block.project, assetMetadata) !== null;
    case "projectList":
      return block.projects.some(
        (entry) => resolveMemberPageProject(entry.project, assetMetadata) !== null,
      );
    case "gallery":
      return block.items.some((item) => assetMetadata.has(item.image.assetId));
  }
}

export function planMemberPageV2Entry(
  entry: MemberPageEntry,
  assetMetadata: ReadonlyMap<string, AssetMetadata>,
): MemberPageV2EntryPlan {
  if (entry.type !== "row") {
    return { kind: "leaf", key: entry.id, block: entry };
  }

  const [left, right] = entry.blocks;
  const key = rowEntryKey(entry);
  const leftRenderable = memberPageV2LeafRenderable(left, assetMetadata);
  const rightRenderable = memberPageV2LeafRenderable(right, assetMetadata);

  if (leftRenderable && rightRenderable) {
    return {
      kind: "row",
      key,
      ratio: entry.ratio,
      left: { block: left, placement: memberPageV2RowPlacement(entry.ratio, 0) },
      right: {
        block: right,
        placement: memberPageV2RowPlacement(entry.ratio, 1),
      },
    };
  }
  if (leftRenderable) return { kind: "survivor", key, block: left };
  if (rightRenderable) return { kind: "survivor", key, block: right };
  return { kind: "omitted" };
}

/**
 * `minmax(0,…)` keeps long content from stretching a track past the page.
 */
const ROW_GRID_CLASSES: Record<MemberBlockRowRatio, string> = {
  "1:1": "grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
  "1:2": "grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]",
  "2:1": "grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
};

export function memberPageV2RowGridClass(ratio: MemberBlockRowRatio): string {
  return ROW_GRID_CLASSES[ratio];
}
