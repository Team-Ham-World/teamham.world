import type { ReactElement } from "react";

import type { ImageBlock, MemberBlock } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

import { MemberPageV2RichText } from "./MemberPageV2RichText";
import { MemberPageV2FeaturedProject } from "./MemberPageV2FeaturedProject";
import { MemberPageV2ProjectList } from "./MemberPageV2ProjectList";
import { MemberPageV2AdditionalLinks } from "./MemberPageV2AdditionalLinks";
import { MemberPageV2Image } from "./MemberPageV2Image";
import { MemberPageV2Gallery } from "./MemberPageV2Gallery";
import { MemberPageV2CalloutQuote } from "./MemberPageV2CalloutQuote";

/**
 * Image `sizes` hints for one containing viewport, keyed by image-block
 * variant. Hints legitimately differ between the public page and the editor
 * workbench; which component an image block renders as never does.
 */
export type MemberPageV2ImageSizes = Readonly<
  Record<ImageBlock["variant"], string>
>;

/**
 * The public page fills the viewport at its measured content width, so a wide
 * image may claim the full HAM page width above the small-screen gutters.
 */
export const MEMBER_PAGE_PUBLIC_IMAGE_SIZES: MemberPageV2ImageSizes = {
  framed: "(min-width: 1024px) 768px, calc(100vw - 2.5rem)",
  wide:
    "(min-width: 1024px) 960px, (min-width: 640px) calc(100vw - 4rem), calc(100vw - 2.5rem)",
};

/**
 * What the two render paths may legitimately differ on. Nothing here changes
 * which component a block renders as, only what that component needs to know
 * about its surroundings.
 */
export interface MemberPageV2LeafContext {
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  /** Viewport hints handed to block images, keyed by variant. */
  imageSizes: MemberPageV2ImageSizes;
  /** Where a featured project sits: inline in the body or beside the frame. */
  featuredProjectLayout?: "standard" | "showcase";
}

/**
 * The one dispatch from a `MemberBlock` to its public leaf component.
 *
 * Both the public body and the editor canvas render leaves through this
 * function, so a block or variant decision can only ever reach one path and
 * not the other. Adding a member to the `MemberBlock` union fails to compile
 * here until it is given a case, and an unknown type reaching this switch is
 * a renderer bug that fails loudly instead of quietly dropping content.
 */
export function renderMemberPageV2LeafBlock(
  block: MemberBlock,
  context: MemberPageV2LeafContext,
): ReactElement | null {
  switch (block.type) {
    case "richText":
      return <MemberPageV2RichText block={block} />;
    case "featuredProject":
      return (
        <MemberPageV2FeaturedProject
          block={block}
          assetMetadata={context.assetMetadata}
          layout={context.featuredProjectLayout}
        />
      );
    case "projectList":
      return (
        <MemberPageV2ProjectList
          block={block}
          assetMetadata={context.assetMetadata}
        />
      );
    case "additionalLinks":
      return <MemberPageV2AdditionalLinks block={block} />;
    case "image":
      return (
        <MemberPageV2Image
          imageRef={block.image}
          caption={block.caption}
          variant={block.variant}
          assetMetadata={context.assetMetadata}
          sizes={context.imageSizes[block.variant]}
        />
      );
    case "gallery":
      return (
        <MemberPageV2Gallery
          block={block}
          assetMetadata={context.assetMetadata}
        />
      );
    case "calloutQuote":
      return <MemberPageV2CalloutQuote block={block} />;
    default:
      return assertNeverMemberBlock(block);
  }
}

function assertNeverMemberBlock(block: never): never {
  throw new Error(
    `Unhandled member block type: ${JSON.stringify(block)}. ` +
      "Add a case to renderMemberPageV2LeafBlock for every MemberBlock member.",
  );
}
