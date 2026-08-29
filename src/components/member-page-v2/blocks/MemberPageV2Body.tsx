import { Fragment } from "react";

import type { MemberBlock, MemberPageEntry } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";
import {
  planMemberPageV2Entry,
  type MemberPageV2Placement,
} from "../page-composition";

import { MemberPageV2EntryFrame } from "./MemberPageV2EntryFrame";
import {
  MEMBER_PAGE_PUBLIC_IMAGE_SIZES,
  MEMBER_PAGE_PUBLIC_ROW_COLUMN_PX,
  memberPageV2ImageSizesForPlacement,
  renderMemberPageV2LeafBlock,
} from "./MemberPageV2LeafBlock";

interface MemberPageV2BodyProps {
  entries: MemberPageEntry[];
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
}

export function MemberPageV2Body({
  entries,
  assetMetadata,
}: MemberPageV2BodyProps) {
  return (
    <div className="mt-16 space-y-12">
      {entries.map((entry) => {
        const plan = planMemberPageV2Entry(entry, assetMetadata);
        if (plan.kind === "omitted") return null;
        if (plan.kind === "row") {
          return (
            <MemberPageV2EntryFrame
              key={plan.key}
              ratio={plan.ratio}
              left={
                <PlacedLeaf
                  block={plan.left.block}
                  placement={plan.left.placement}
                  assetMetadata={assetMetadata}
                />
              }
              right={
                <PlacedLeaf
                  block={plan.right.block}
                  placement={plan.right.placement}
                  assetMetadata={assetMetadata}
                />
              }
            />
          );
        }
        return (
          // The fragment carries the key; the leaf element the shared
          // dispatcher returns is flattened straight into this list, so the
          // `space-y-12` spacing and every child DOM node are unchanged.
          <Fragment key={plan.key}>
            <PlacedLeaf
              block={plan.block}
              placement="full"
              assetMetadata={assetMetadata}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

function PlacedLeaf({
  block,
  placement,
  assetMetadata,
}: {
  block: MemberBlock;
  placement: MemberPageV2Placement;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
}) {
  return renderMemberPageV2LeafBlock(block, {
    assetMetadata,
    imageSizes: memberPageV2ImageSizesForPlacement(
      MEMBER_PAGE_PUBLIC_IMAGE_SIZES,
      MEMBER_PAGE_PUBLIC_ROW_COLUMN_PX,
      placement,
    ),
  });
}
