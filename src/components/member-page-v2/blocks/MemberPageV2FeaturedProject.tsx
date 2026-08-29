import type { FeaturedProjectBlock } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

import {
  MemberPageV2ProjectCard,
  resolveMemberPageProject,
} from "./MemberPageV2Project";

interface MemberPageV2FeaturedProjectProps {
  block: FeaturedProjectBlock;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  layout?: "standard" | "showcase";
}

export function MemberPageV2FeaturedProject({
  block,
  assetMetadata,
  layout = "standard",
}: MemberPageV2FeaturedProjectProps) {
  const resolved = resolveMemberPageProject(block.project, assetMetadata);
  if (!resolved) return null;

  const showcaseLayout = layout === "showcase";

  return (
    <section
      aria-labelledby={`featured-${block.id}`}
      data-featured-project-layout={layout}
    >
      <h2
        id={`featured-${block.id}`}
        className="text-xs font-bold tracking-[0.18em] text-muted uppercase"
      >
        {showcaseLayout ? "Showcase" : "Featured project"}
      </h2>
      <div className="mt-4">
        <MemberPageV2ProjectCard
          project={resolved}
          assetMetadata={assetMetadata}
          variant="featured"
          artworkPlacement={
            showcaseLayout || block.variant === "artwork-first"
              ? "before"
              : "after"
          }
        />
      </div>
    </section>
  );
}
