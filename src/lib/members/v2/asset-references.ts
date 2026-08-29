import type {
  MemberPageDocumentV2,
  MemberProjectRef,
} from "@/lib/members/v2/document";
import { analyzeMemberPageEntries } from "@/lib/members/v2/member-page-entries";

export function extractMemberPageAssetIds(doc: MemberPageDocumentV2): string[] {
  const assetIds = new Set<string>();
  const addProject = (project: MemberProjectRef) => {
    if (project.kind === "external" && project.artwork) {
      assetIds.add(project.artwork.assetId);
    }
  };

  if (doc.frame.portrait) assetIds.add(doc.frame.portrait.assetId);

  for (const leaf of analyzeMemberPageEntries(doc.blocks).leaves) {
    switch (leaf.block.type) {
      case "featuredProject":
        addProject(leaf.block.project);
        break;
      case "projectList":
        for (const entry of leaf.block.projects) addProject(entry.project);
        break;
      case "image":
        assetIds.add(leaf.block.image.assetId);
        break;
      case "gallery":
        for (const item of leaf.block.items) assetIds.add(item.image.assetId);
        break;
      case "richText":
      case "additionalLinks":
      case "calloutQuote":
        break;
    }
  }

  return [...assetIds];
}
