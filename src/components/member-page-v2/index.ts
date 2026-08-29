export { MemberPageV2View } from "./MemberPageV2View";
export {
  composeMemberPageV2Layout,
  getHeaderSlotBlock,
  memberPageV2RowPlacement,
  planMemberPageV2Entry,
} from "./page-composition";
export type {
  MemberPageV2Layout,
  MemberPageV2Placement,
} from "./page-composition";
export { MemberPageThemeStyle } from "./MemberPageThemeStyle";
export type {
  MemberPageV2ViewProps,
  AssetMetadata,
} from "./MemberPageV2View";

/*
 * Frame and per-block exports.
 *
 * The owner editor renders the live canvas from these exact components, so the
 * canvas cannot drift from the public page. Nothing about their design or
 * composition changes here; this barrel only makes them reachable.
 *
 * `renderMemberPageV2LeafBlock` is the one shared block dispatch both paths
 * render through, and `MEMBER_PAGE_PUBLIC_IMAGE_SIZES` the public body's
 * viewport hints; the editor passes its own workbench hints instead.
 */
export { MemberPageV2Frame } from "./frame/MemberPageV2Frame";
export { MemberPageV2Body } from "./blocks/MemberPageV2Body";
export { MemberPageV2EntryFrame } from "./blocks/MemberPageV2EntryFrame";
export {
  MEMBER_PAGE_PUBLIC_IMAGE_SIZES,
  MEMBER_PAGE_PUBLIC_ROW_COLUMN_PX,
  memberPageV2ImageSizesForPlacement,
  renderMemberPageV2LeafBlock,
} from "./blocks/MemberPageV2LeafBlock";
export type {
  MemberPageV2ImageSizes,
  MemberPageV2LeafContext,
  MemberPageV2RowColumnPx,
} from "./blocks/MemberPageV2LeafBlock";
export { MemberPageV2RichText } from "./blocks/MemberPageV2RichText";
export { MemberPageV2FeaturedProject } from "./blocks/MemberPageV2FeaturedProject";
export { MemberPageV2ProjectList } from "./blocks/MemberPageV2ProjectList";
export { MemberPageV2AdditionalLinks } from "./blocks/MemberPageV2AdditionalLinks";
export { MemberPageV2Image } from "./blocks/MemberPageV2Image";
export { MemberPageV2Gallery } from "./blocks/MemberPageV2Gallery";
export { MemberPageV2CalloutQuote } from "./blocks/MemberPageV2CalloutQuote";
