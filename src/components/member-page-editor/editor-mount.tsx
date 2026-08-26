import type { AssetMetadata } from "@/components/member-page-v2";
import {
  autosaveMemberPageV2Action,
  publishMemberPageV2Action,
  resetMemberPageV2Action,
  unpublishMemberPageV2Action,
} from "@/app/m/[member]/v2-actions";
import type { OwnedMemberPageDraftV2 } from "@/lib/members/v2/dal";
import type { ResolvedMemberThemeAccent } from "@/lib/members/v2/themes";

import { MemberPageEditor } from "./editor-shell";
import type { EditorAsset } from "./asset-api";

/**
 * Server boundary between the owner route and the client editor.
 *
 * The route reaches this module through a dynamic import taken only on the
 * owner-and-editing branch, so a visitor's render never pulls the editor, its
 * state machine, or the server actions into the graph.
 */
export default function MemberPageEditorMount({
  draft,
  theme,
  assetMetadata,
  initialAssets,
}: {
  draft: OwnedMemberPageDraftV2;
  theme: ResolvedMemberThemeAccent;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  initialAssets: readonly EditorAsset[];
}) {
  return (
    <MemberPageEditor
      slug={draft.slug}
      initialDocument={draft.draft}
      initialDraftRev={draft.draftRev}
      initialIsPublished={draft.isPublished}
      initialModerationHold={draft.moderationHold}
      initialHasPublishedSnapshot={draft.hasPublishedSnapshot}
      theme={theme}
      assetMetadata={assetMetadata}
      initialAssets={initialAssets}
      actions={{
        autosave: autosaveMemberPageV2Action,
        publish: publishMemberPageV2Action,
        unpublish: unpublishMemberPageV2Action,
        reset: resetMemberPageV2Action,
      }}
    />
  );
}
