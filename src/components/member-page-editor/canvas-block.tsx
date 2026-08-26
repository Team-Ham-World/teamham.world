"use client";

import type { AssetMetadata } from "@/components/member-page-v2";
import {
  MemberPageV2AdditionalLinks,
  MemberPageV2CalloutQuote,
  MemberPageV2FeaturedProject,
  MemberPageV2Gallery,
  MemberPageV2Image,
  MemberPageV2ProjectList,
  MemberPageV2RichText,
} from "@/components/member-page-v2";
import type { MemberBlock } from "@/lib/members/v2/document";

/**
 * Renders one block with the public component for its type.
 *
 * This mirrors the public body's dispatch so a canvas block is the same markup
 * a visitor gets. The public body keeps ownership of list spacing; the canvas
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
  switch (block.type) {
    case "richText":
      return <MemberPageV2RichText block={block} />;
    case "featuredProject":
      return (
        <MemberPageV2FeaturedProject
          block={block}
          assetMetadata={assetMetadata}
          layout={featuredProjectLayout}
        />
      );
    case "projectList":
      return <MemberPageV2ProjectList block={block} assetMetadata={assetMetadata} />;
    case "additionalLinks":
      return <MemberPageV2AdditionalLinks block={block} />;
    case "image":
      return (
        <MemberPageV2Image
          imageRef={block.image}
          caption={block.caption}
          variant={block.variant}
          assetMetadata={assetMetadata}
          sizes={
            block.variant === "wide"
              ? "(min-width: 1280px) 1152px, calc(100vw - 2.5rem)"
              : "(min-width: 1024px) 768px, calc(100vw - 2.5rem)"
          }
        />
      );
    case "gallery":
      return <MemberPageV2Gallery block={block} assetMetadata={assetMetadata} />;
    case "calloutQuote":
      return <MemberPageV2CalloutQuote block={block} />;
  }
}
