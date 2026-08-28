import { Fragment } from "react";

import type { MemberBlock } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

import {
  MEMBER_PAGE_PUBLIC_IMAGE_SIZES,
  renderMemberPageV2LeafBlock,
} from "./MemberPageV2LeafBlock";

interface MemberPageV2BodyProps {
  blocks: MemberBlock[];
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
}

export function MemberPageV2Body({
  blocks,
  assetMetadata,
}: MemberPageV2BodyProps) {
  return (
    <div className="mt-16 space-y-12">
      {blocks.map((block) => (
        // The fragment carries the key; the leaf element the shared
        // dispatcher returns is flattened straight into this list, so the
        // `space-y-12` spacing and every child DOM node are unchanged.
        <Fragment key={block.id}>
          {renderMemberPageV2LeafBlock(block, {
            assetMetadata,
            imageSizes: MEMBER_PAGE_PUBLIC_IMAGE_SIZES,
          })}
        </Fragment>
      ))}
    </div>
  );
}
