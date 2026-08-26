import type {
  FeaturedProjectBlock,
  MemberPageDocumentV2,
} from "@/lib/members/v2/document";
import type { ResolvedMemberThemeAccent } from "@/lib/members/v2/themes";

import { MemberPageV2Frame } from "./frame/MemberPageV2Frame";
import { MemberPageV2Body } from "./blocks/MemberPageV2Body";
import { MemberPageV2FeaturedProject } from "./blocks/MemberPageV2FeaturedProject";
import { MemberPageThemeStyle } from "./MemberPageThemeStyle";
import { memberThemeStyle } from "./member-theme-presentation";
import styles from "./MemberPageV2View.module.css";

export interface AssetMetadata {
  width: number;
  height: number;
  mimeType: string;
}

export interface MemberPageV2ViewProps {
  document: MemberPageDocumentV2;
  theme: ResolvedMemberThemeAccent;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
}

/**
 * Server-renderable V2 member page view.
 *
 * Renders only published documents; no editor, autosave, TipTap, dnd-kit,
 * upload, or auth dependencies. Member uploads use same-origin
 * `/member-assets/<assetId>` sources; HAM projects use the reviewed catalog.
 */
export function MemberPageV2View({
  document,
  theme,
  assetMetadata,
}: MemberPageV2ViewProps) {
  const showcaseProject = getShowcaseProject(document);

  // The showcase holds the first slot, so the rest of the blocks are the body.
  const bodyBlocks = showcaseProject
    ? document.blocks.slice(1)
    : document.blocks;

  return (
    <div
      className={`${styles.container} ${styles.themeSurface}`}
      data-member-theme-surface="true"
      data-theme-scope="page"
      data-theme-id={theme.themeId}
      data-accent-id={theme.accentId}
      data-member-layout={showcaseProject ? "showcase" : "blocks"}
      style={memberThemeStyle(theme)}
    >
      <MemberPageThemeStyle theme={theme} />
      {showcaseProject ? (
        <div
          className="lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-14"
          data-profile-showcase="true"
        >
          <MemberPageV2Frame
            frame={document.frame}
            assetMetadata={assetMetadata}
          />
          <MemberPageV2FeaturedProject
            block={showcaseProject}
            assetMetadata={assetMetadata}
            layout="showcase"
          />
        </div>
      ) : (
        <MemberPageV2Frame
          frame={document.frame}
          assetMetadata={assetMetadata}
        />
      )}
      {bodyBlocks.length > 0 ? (
        <MemberPageV2Body blocks={bodyBlocks} assetMetadata={assetMetadata} />
      ) : null}
    </div>
  );
}

/**
 * The showcase slot: a featured project standing beside the profile.
 *
 * The slot belongs to whatever is at the top of the document, so a member who
 * adds more blocks keeps their project next to their name instead of watching
 * it drop to the foot of the page, and moving something else to the front is
 * what gives the slot up. It is deliberately independent of the theme: which
 * palette and stock a page wears has nothing to do with where its project
 * sits, and tying the two meant switching theme quietly rearranged the page.
 */
export function getShowcaseProject(
  document: MemberPageDocumentV2,
): FeaturedProjectBlock | null {
  const [block] = document.blocks;
  if (!block) return null;
  return block.type === "featuredProject" ? block : null;
}
