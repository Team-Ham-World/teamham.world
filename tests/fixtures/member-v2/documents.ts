import { PROJECTS } from "@/data/projects";
import type {
  MemberPageDocumentV2,
  MemberProjectRef,
  MemberProjectStatus,
  RichTextDoc,
} from "@/lib/members/v2/document";

export const ALL_PROJECT_STATUSES: readonly MemberProjectStatus[] = [
  "planning",
  "in-development",
  "playable",
  "released",
  "paused",
  "retired",
];

export function externalProject(
  status: MemberProjectStatus = "released",
  suffix: string = status,
): Extract<MemberProjectRef, { kind: "external" }> {
  return {
    kind: "external",
    name: `Project ${suffix}`,
    shortDescription: `Description for ${suffix}.`,
    type: "game",
    status,
    url: `https://example.com/${suffix}`,
    repository: `https://github.com/teamham/${suffix}`,
  };
}

export function richTextFixture(): RichTextDoc {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "About" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Bold", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          { type: "text", text: "italic", marks: [{ type: "italic" }] },
          {
            type: "text",
            text: " link",
            marks: [{ type: "link", attrs: { href: "https://example.com/about" } }],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: "Lists" }],
      },
      {
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "Bullet" }],
          }],
        }],
      },
      {
        type: "orderedList",
        content: [{
          type: "listItem",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "Numbered" }],
          }],
        }],
      },
      {
        type: "blockquote",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Quoted" }],
        }],
      },
    ],
  };
}

export function minimalMemberPageDocument(): MemberPageDocumentV2 {
  return {
    schemaVersion: 2,
    frame: {
      displayName: "HAM Friend",
      summary: null,
      websiteUrl: null,
      socialLinks: {},
      portrait: null,
      theme: { id: "paper", accentId: "default" },
    },
    blocks: [],
  };
}

export function canonicalMemberPageDocument(): MemberPageDocumentV2 {
  return {
    schemaVersion: 2,
    frame: {
      displayName: "HAM Friend",
      summary: "Makes tiny games and useful tools.",
      websiteUrl: "https://hamfriend.example",
      socialLinks: {
        github: "https://github.com/hamfriend",
        bluesky: "https://bsky.app/profile/hamfriend.example",
        mastodon: "https://social.example/@hamfriend",
        instagram: "https://instagram.com/hamfriend",
        youtube: "https://youtube.com/@hamfriend",
        twitch: "https://twitch.tv/hamfriend",
        x: "https://x.com/hamfriend",
      },
      portrait: {
        assetId: "asset-portrait",
        alt: "HAM Friend smiling",
        decorative: false,
      },
      theme: { id: "paper", accentId: "default" },
    },
    blocks: [
      { id: "block-rich", type: "richText", content: richTextFixture() },
      {
        id: "block-featured",
        type: "featuredProject",
        variant: "card",
        project: {
          ...externalProject("released", "featured"),
          artwork: {
            assetId: "asset-featured",
            alt: "Featured project artwork",
            decorative: false,
          },
        },
      },
      {
        id: "block-projects-stacked",
        type: "projectList",
        variant: "stacked",
        projects: [
          {
            id: "project-ham",
            project: { kind: "ham", projectSlug: PROJECTS[0].slug },
          },
          ...ALL_PROJECT_STATUSES.map((status, index) => ({
            id: `project-${index}`,
            project: externalProject(status, `status-${index}`),
          })),
        ],
      },
      {
        id: "block-embed",
        type: "embed",
        variant: "standard",
        url: "https://open.spotify.com/embed/track/example",
        title: "Spotify track player",
        showFrame: true,
      },
      {
        id: "block-links-list",
        type: "additionalLinks",
        variant: "list",
        links: [{
          id: "link-list",
          label: "Newsletter",
          url: "https://example.com/newsletter",
          description: "Occasional project notes.",
        }],
      },
      {
        id: "block-links-buttons",
        type: "additionalLinks",
        variant: "buttons",
        links: [{
          id: "link-buttons",
          label: "Play",
          url: "https://example.com/play",
          description: null,
        }],
      },
      {
        id: "block-image-framed",
        type: "image",
        variant: "framed",
        image: { assetId: "asset-image-1", alt: "A game board", decorative: false },
        caption: "Prototype night.",
      },
      {
        id: "block-image-wide",
        type: "image",
        variant: "wide",
        image: { assetId: "asset-image-2", alt: null, decorative: true },
        caption: null,
      },
      {
        id: "block-gallery-grid",
        type: "gallery",
        variant: "grid",
        items: [
          {
            id: "gallery-grid-1",
            image: { assetId: "asset-gallery-1", alt: "Sketch one", decorative: false },
            caption: "First sketch.",
          },
          {
            id: "gallery-grid-2",
            image: { assetId: "asset-gallery-2", alt: null, decorative: true },
            caption: null,
          },
        ],
      },
      {
        id: "block-gallery-strip",
        type: "gallery",
        variant: "strip",
        items: [
          {
            id: "gallery-strip-1",
            image: { assetId: "asset-gallery-3", alt: "Sketch three", decorative: false },
            caption: null,
          },
          {
            id: "gallery-strip-2",
            image: { assetId: "asset-gallery-4", alt: "Sketch four", decorative: false },
            caption: "Fourth sketch.",
          },
        ],
      },
      {
        id: "block-note",
        type: "calloutQuote",
        variant: "note",
        text: "Currently experimenting with tiny multiplayer games.",
        attribution: null,
      },
      {
        id: "block-quote",
        type: "calloutQuote",
        variant: "quote",
        text: "Make the useful thing delightful.",
        attribution: "HAM Friend",
      },
    ],
  };
}
