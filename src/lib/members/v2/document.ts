export const MEMBER_PAGE_DOCUMENT_SCHEMA_VERSION = 2 as const;

export const MEMBER_THEME_IDS = [
  "paper",
  "newsprint",
  "blueprint",
  "riso",
] as const;

export type MemberThemeId = (typeof MEMBER_THEME_IDS)[number];

export const MEMBER_SOCIAL_PLATFORM_IDS = [
  "github",
  "bluesky",
  "mastodon",
  "instagram",
  "youtube",
  "twitch",
  "x",
] as const;

export type SocialPlatformId = (typeof MEMBER_SOCIAL_PLATFORM_IDS)[number];

export const MEMBER_PROJECT_STATUSES = [
  "planning",
  "in-development",
  "playable",
  "released",
  "paused",
  "retired",
] as const;

export type MemberProjectStatus = (typeof MEMBER_PROJECT_STATUSES)[number];
export type ProjectStatus = MemberProjectStatus;

export interface MemberImageRef {
  assetId: string;
  alt: string | null;
  decorative: boolean;
}

export type MemberProjectRef =
  | {
      kind: "ham";
      projectSlug: string;
    }
  | {
      kind: "external";
      name: string;
      shortDescription: string;
      type: string;
      status: MemberProjectStatus;
      url?: string;
      repository?: string;
      artwork?: MemberImageRef;
    };

export type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | {
      type: "link";
      attrs: {
        href: string;
      };
    };

export interface RichTextText {
  type: "text";
  text: string;
  marks?: RichTextMark[];
}

export interface RichTextParagraph {
  type: "paragraph";
  content: RichTextText[];
}

export interface RichTextHeading {
  type: "heading";
  attrs: {
    level: 2 | 3;
  };
  content: RichTextText[];
}

export interface RichTextBulletList {
  type: "bulletList";
  content: RichTextListItem[];
}

export interface RichTextOrderedList {
  type: "orderedList";
  content: RichTextListItem[];
}

export interface RichTextListItem {
  type: "listItem";
  content: RichTextBlockNode[];
}

export interface RichTextBlockquote {
  type: "blockquote";
  content: RichTextBlockNode[];
}

export type RichTextBlockNode =
  | RichTextParagraph
  | RichTextHeading
  | RichTextBulletList
  | RichTextOrderedList
  | RichTextBlockquote;

export interface RichTextDoc {
  type: "doc";
  content: RichTextBlockNode[];
}

export interface RichTextBlock {
  id: string;
  type: "richText";
  content: RichTextDoc;
}

export interface FeaturedProjectBlock {
  id: string;
  type: "featuredProject";
  variant: "card" | "artwork-first";
  project: MemberProjectRef;
}

export interface ProjectListBlock {
  id: string;
  type: "projectList";
  variant: "stacked" | "compact";
  projects: Array<{
    id: string;
    project: MemberProjectRef;
  }>;
}

export interface AdditionalLinksBlock {
  id: string;
  type: "additionalLinks";
  variant: "list" | "buttons";
  links: Array<{
    id: string;
    label: string;
    url: string;
    description: string | null;
  }>;
}

export interface ImageBlock {
  id: string;
  type: "image";
  variant: "framed" | "wide";
  image: MemberImageRef;
  caption: string | null;
}

export interface GalleryBlock {
  id: string;
  type: "gallery";
  variant: "grid" | "strip";
  items: Array<{
    id: string;
    image: MemberImageRef;
    caption: string | null;
  }>;
}

export interface CalloutQuoteBlock {
  id: string;
  type: "calloutQuote";
  variant: "note" | "quote";
  text: string;
  attribution: string | null;
}

export type MemberBlock =
  | RichTextBlock
  | FeaturedProjectBlock
  | ProjectListBlock
  | AdditionalLinksBlock
  | ImageBlock
  | GalleryBlock
  | CalloutQuoteBlock;

export interface MemberPageFrameV2 {
  displayName: string;
  summary: string | null;
  websiteUrl: string | null;
  socialLinks: Partial<Record<SocialPlatformId, string>>;
  portrait: MemberImageRef | null;
  theme: {
    id: MemberThemeId;
    accentId: string;
  };
}

export interface MemberPageDocumentV2 {
  schemaVersion: typeof MEMBER_PAGE_DOCUMENT_SCHEMA_VERSION;
  frame: MemberPageFrameV2;
  blocks: MemberBlock[];
}
