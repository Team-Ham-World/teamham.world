import type {
  MemberPageDocumentV2,
} from "@/lib/members/v2/document";
import type { ResolvedMemberThemeAccent } from "@/lib/members/v2/themes";

import { MemberPageV2Frame } from "./frame/MemberPageV2Frame";
import { MemberPageV2Body } from "./blocks/MemberPageV2Body";
import { MemberPageV2FeaturedProject } from "./blocks/MemberPageV2FeaturedProject";
import { MemberPageThemeStyle } from "./MemberPageThemeStyle";
import { memberThemeStyle } from "./member-theme-presentation";
import { composeMemberPageV2Layout } from "./page-composition";
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
  const { layout, showcaseProject, bodyBlocks } =
    composeMemberPageV2Layout(document);

  return (
    <div
      className={`${styles.container} ${styles.themeSurface}`}
      data-member-theme-surface="true"
      data-theme-scope="page"
      data-theme-id={theme.themeId}
      data-accent-id={theme.accentId}
      data-member-layout={layout}
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

export { getShowcaseProject } from "./page-composition";
