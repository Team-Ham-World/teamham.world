import type {
  MemberPageDocumentV2,
  MemberProjectRef,
} from "@/lib/members/v2/document";

export function extractMemberPageAssetIds(doc: MemberPageDocumentV2): string[] {
  const assetIds = new Set<string>();
  const addProject = (project: MemberProjectRef) => {
    if (project.kind === "external" && project.artwork) {
      assetIds.add(project.artwork.assetId);
    }
  };

  if (doc.frame.portrait) assetIds.add(doc.frame.portrait.assetId);

  for (const block of doc.blocks) {
    switch (block.type) {
      case "featuredProject":
        addProject(block.project);
        break;
      case "projectList":
        for (const entry of block.projects) addProject(entry.project);
        break;
      case "image":
        assetIds.add(block.image.assetId);
        break;
      case "gallery":
        for (const item of block.items) assetIds.add(item.image.assetId);
        break;
      case "richText":
      case "additionalLinks":
      case "calloutQuote":
        break;
    }
  }

  return [...assetIds];
}
