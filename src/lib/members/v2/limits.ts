export const MAX_LABEL_CHARS = 80;
export const MAX_DISPLAY_NAME_CHARS = 80;
export const MAX_PROJECT_NAME_CHARS = 80;
export const MAX_PROJECT_TYPE_CHARS = 80;
export const MAX_LINK_LABEL_CHARS = 80;
export const MAX_QUOTE_ATTRIBUTION_CHARS = 80;
export const MAX_EMBED_TITLE_CHARS = 200;

export const MAX_DESCRIPTION_CHARS = 500;
export const MAX_SUMMARY_CHARS = 500;
export const MAX_PROJECT_DESCRIPTION_CHARS = 500;
export const MAX_LINK_DESCRIPTION_CHARS = 500;
export const MAX_CAPTION_CHARS = 500;
export const MAX_CALLOUT_CHARS = 500;
export const MAX_IMAGE_ALT_CHARS = 500;

export const MAX_URL_CHARS = 2_048;
export const MAX_BLOCKS = 12;
export const MAX_FEATURED_PROJECT_BLOCKS = 1;
export const MAX_COLLECTION_ITEMS = 12;
export const MIN_GALLERY_ITEMS = 2;
export const MAX_READY_ASSETS = 20;
export const RICH_TEXT_MAX_NODES = 500;
export const RICH_TEXT_MAX_TEXT_CHARS = 10_000;
export const RICH_TEXT_MAX_DEPTH = 10;
export const MAX_DOCUMENT_BYTES = 262_144;
export const ASSET_MAX_BYTES = 5_242_880;
export const ASSET_MAX_DIMENSION = 4_000;

export const MEMBER_PAGE_V2_LIMITS = {
  label: MAX_LABEL_CHARS,
  displayName: MAX_DISPLAY_NAME_CHARS,
  projectName: MAX_PROJECT_NAME_CHARS,
  projectType: MAX_PROJECT_TYPE_CHARS,
  linkLabel: MAX_LINK_LABEL_CHARS,
  quoteAttribution: MAX_QUOTE_ATTRIBUTION_CHARS,
  embedTitle: MAX_EMBED_TITLE_CHARS,
  description: MAX_DESCRIPTION_CHARS,
  summary: MAX_SUMMARY_CHARS,
  projectDescription: MAX_PROJECT_DESCRIPTION_CHARS,
  linkDescription: MAX_LINK_DESCRIPTION_CHARS,
  caption: MAX_CAPTION_CHARS,
  callout: MAX_CALLOUT_CHARS,
  imageAlt: MAX_IMAGE_ALT_CHARS,
  url: MAX_URL_CHARS,
  blocks: MAX_BLOCKS,
  featuredProjectBlocks: MAX_FEATURED_PROJECT_BLOCKS,
  collectionItems: MAX_COLLECTION_ITEMS,
  galleryItemsMinimum: MIN_GALLERY_ITEMS,
  readyAssets: MAX_READY_ASSETS,
  richTextNodes: RICH_TEXT_MAX_NODES,
  richTextTextChars: RICH_TEXT_MAX_TEXT_CHARS,
  richTextDepth: RICH_TEXT_MAX_DEPTH,
  documentBytes: MAX_DOCUMENT_BYTES,
  assetBytes: ASSET_MAX_BYTES,
  assetDimension: ASSET_MAX_DIMENSION,
} as const;
