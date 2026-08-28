import type {
  FeaturedProjectBlock,
  MemberBlock,
  MemberPageDocumentV2,
} from "@/lib/members/v2/document";

/**
 * Pure V2 page composition: showcase eligibility and the body order that
 * follows from it. Dependency-free, so the public view and the editor canvas
 * share one decision instead of two that can drift apart.
 */
export interface MemberPageV2Layout {
  /** Page layout mode: drives the top-row grid and `data-member-layout`. */
  layout: "showcase" | "blocks";
  /** The featured project beside the profile, or null for a plain body. */
  showcaseProject: FeaturedProjectBlock | null;
  /** Body blocks in document order with the showcase slot removed. */
  bodyBlocks: MemberBlock[];
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

/**
 * The single composition decision for both render paths: whether the page has
 * a showcase, which block holds it, and what the body underneath it is.
 */
export function composeMemberPageV2Layout(
  document: MemberPageDocumentV2,
): MemberPageV2Layout {
  const showcaseProject = getShowcaseProject(document);

  // The showcase holds the first slot, so the rest of the blocks are the body.
  const bodyBlocks = showcaseProject
    ? document.blocks.slice(1)
    : document.blocks;

  return {
    layout: showcaseProject ? "showcase" : "blocks",
    showcaseProject,
    bodyBlocks,
  };
}
