import type { MemberBlock } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

import { MemberPageV2RichText } from "./MemberPageV2RichText";
import { MemberPageV2FeaturedProject } from "./MemberPageV2FeaturedProject";
import { MemberPageV2ProjectList } from "./MemberPageV2ProjectList";
import { MemberPageV2AdditionalLinks } from "./MemberPageV2AdditionalLinks";
import { MemberPageV2Image } from "./MemberPageV2Image";
import { MemberPageV2Gallery } from "./MemberPageV2Gallery";
import { MemberPageV2CalloutQuote } from "./MemberPageV2CalloutQuote";

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
      {blocks.map((block) => {
        switch (block.type) {
          case "richText":
            return (
              <MemberPageV2RichText key={block.id} block={block} />
            );
          case "featuredProject":
            return (
              <MemberPageV2FeaturedProject
                key={block.id}
                block={block}
                assetMetadata={assetMetadata}
              />
            );
          case "projectList":
            return (
              <MemberPageV2ProjectList
                key={block.id}
                block={block}
                assetMetadata={assetMetadata}
              />
            );
          case "additionalLinks":
            return (
              <MemberPageV2AdditionalLinks key={block.id} block={block} />
            );
          case "image":
            return (
              <MemberPageV2Image
                key={block.id}
                imageRef={block.image}
                caption={block.caption}
                variant={block.variant}
                assetMetadata={assetMetadata}
                sizes={
                  block.variant === "wide"
                    ? "(min-width: 1024px) 960px, (min-width: 640px) calc(100vw - 4rem), calc(100vw - 2.5rem)"
                    : "(min-width: 1024px) 768px, calc(100vw - 2.5rem)"
                }
              />
            );
          case "gallery":
            return (
              <MemberPageV2Gallery
                key={block.id}
                block={block}
                assetMetadata={assetMetadata}
              />
            );
          case "calloutQuote":
            return (
              <MemberPageV2CalloutQuote key={block.id} block={block} />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
