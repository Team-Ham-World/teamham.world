import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MemberPageV2View } from "@/components/member-page-v2/MemberPageV2View";
import { PROJECTS } from "@/data/projects";
import type {
  MemberPageDocumentV2,
  RichTextDoc,
} from "@/lib/members/v2/document";
import { extractMemberPageAssetIds } from "@/lib/members/v2/asset-references";
import {
  PAPER_DEFAULT_ACCENT_ID,
  getEnabledMemberThemes,
  resolveEnabledThemeAccent,
} from "@/lib/members/v2/themes";
import { canonicalMemberPageDocument } from "../fixtures/member-v2/documents";

const PAPER_THEME = resolveEnabledThemeAccent("paper", PAPER_DEFAULT_ACCENT_ID);
if (!PAPER_THEME) throw new Error("paper/default must remain enabled");

const MINIMAL_DOC: MemberPageDocumentV2 = {
  schemaVersion: 2,
  frame: {
    displayName: "Test Member",
    summary: null,
    websiteUrl: null,
    socialLinks: {},
    portrait: null,
    theme: {
      id: "paper",
      accentId: PAPER_DEFAULT_ACCENT_ID,
    },
  },
  blocks: [],
};

const ASSET_METADATA = new Map([
  ["asset-1", { width: 800, height: 600, mimeType: "image/jpeg" }],
  ["asset-2", { width: 1600, height: 900, mimeType: "image/png" }],
  ["portrait-1", { width: 400, height: 400, mimeType: "image/webp" }],
]);

describe("MemberPageV2View frame", () => {
  it("renders the structural member identity with exactly one h1", () => {
    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={MINIMAL_DOC}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("HAM member");
    expect(html).toContain("<h1");
    expect(html).toContain("Test Member");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("renders display name, summary, website, and social links", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      frame: {
        ...MINIMAL_DOC.frame,
        displayName: "CyR1en",
        summary: "A test member with a summary.",
        websiteUrl: "https://example.com",
        socialLinks: {
          github: "https://github.com/cyr1en",
          bluesky: "https://bsky.app/profile/cyr1en.example",
        },
      },
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("CyR1en");
    expect(html).toContain("A test member with a summary.");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="https://github.com/cyr1en"');
    expect(html).toContain('href="https://bsky.app/profile/cyr1en.example"');
    expect(html).toContain("Visit site");
    expect(html).toContain("GitHub");
    expect(html).toContain("Bluesky");
  });

  it("renders portrait with verified asset metadata", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      frame: {
        ...MINIMAL_DOC.frame,
        portrait: {
          assetId: "portrait-1",
          alt: "Portrait of Test Member",
          decorative: false,
        },
      },
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("/member-assets/portrait-1");
    expect(html).toContain('alt="Portrait of Test Member"');
    expect(html).toContain('width="400"');
    expect(html).toContain('height="400"');
  });

  it("omits portrait when asset metadata is missing", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      frame: {
        ...MINIMAL_DOC.frame,
        portrait: {
          assetId: "missing-asset",
          alt: "Should not appear",
          decorative: false,
        },
      },
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).not.toContain("/member-assets/missing-asset");
    expect(html).not.toContain("Should not appear");
  });

  it("preserves decorative image semantics with empty alt", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      frame: {
        ...MINIMAL_DOC.frame,
        portrait: {
          assetId: "portrait-1",
          alt: null,
          decorative: true,
        },
      },
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("/member-assets/portrait-1");
    expect(html).toContain('alt=""');
  });

  it("uses rel noopener noreferrer for external website", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      frame: {
        ...MINIMAL_DOC.frame,
        websiteUrl: "https://example.com",
      },
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("keeps a page with nothing to show in the single-column shape", () => {
    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={MINIMAL_DOC}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />,
    );

    expect(html).toContain('data-member-layout="blocks"');
    expect(html).not.toContain("data-profile-showcase");
    expect(html).not.toContain("Showcase");
  });
});

describe("MemberPageV2View rich-text block", () => {
  const richTextDoc: RichTextDoc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Section Heading" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "This is " },
          { type: "text", text: "bold text", marks: [{ type: "bold" }] },
          { type: "text", text: " and " },
          { type: "text", text: "italic text", marks: [{ type: "italic" }] },
          { type: "text", text: "." },
        ],
      },
      {
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: "Subsection" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "A " },
          {
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
          { type: "text", text: " example." },
        ],
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "First item" }],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Second item" }],
              },
            ],
          },
        ],
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Numbered first" }],
              },
            ],
          },
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Numbered second" }],
              },
            ],
          },
        ],
      },
      {
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "A quoted passage." }],
          },
        ],
      },
    ],
  };

  it("renders h2, h3, paragraphs, lists, blockquotes, and marks without adding h1", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "rich-1",
          type: "richText",
          content: richTextDoc,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("<h2");
    expect(html).toContain("Section Heading");
    expect(html).toContain("<h3");
    expect(html).toContain("Subsection");
    expect(html).toContain("<strong");
    expect(html).toContain("bold text");
    expect(html).toContain("<em");
    expect(html).toContain("italic text");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain(
      'href="https://example.com" rel="noopener noreferrer" class="inline-flex min-h-11',
    );
    expect(html).toContain("link");
    expect(html).toContain("<ul");
    expect(html).toContain("First item");
    expect(html).toContain("<ol");
    expect(html).toContain("Numbered first");
    expect(html).toContain("<blockquote");
    expect(html).toContain("A quoted passage.");
    // The frame contains exactly one h1; rich text never adds another
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("escapes text through React and never uses dangerouslySetInnerHTML", () => {
    const dangerousDoc: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "<script>alert('xss')</script>" }],
        },
      ],
    };

    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "rich-2",
          type: "richText",
          content: dangerousDoc,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });
});

describe("MemberPageV2View project blocks", () => {
  it("preserves profile/showcase ordering and desktop columns", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "migrated-showcase",
          type: "featuredProject",
          variant: "card",
          project: {
            kind: "external",
            name: "Migrated Showcase",
            shortDescription: "The legacy showcase description.",
            type: "tool",
            status: "released",
            url: "https://example.com/migrated",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />,
    );

    expect(html).toContain('data-member-layout="showcase"');
    expect(html).toContain('data-profile-showcase="true"');
    expect(html).toContain(
      "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]",
    );
    expect(html).toContain('data-featured-project-layout="showcase"');
    expect(html).toContain("Showcase");
    expect(html).toContain("ART PENDING");
    expect(html.indexOf("Test Member")).toBeLessThan(html.indexOf("Showcase"));
    expect(html.indexOf("Showcase")).toBeLessThan(
      html.indexOf("Migrated Showcase"),
    );
    expect(html.indexOf("ART PENDING")).toBeLessThan(
      html.indexOf("Migrated Showcase"),
    );
  });

  it("keeps the Showcase beside the profile once other blocks are added", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "kept-showcase",
          type: "featuredProject",
          variant: "card",
          project: {
            kind: "external",
            name: "Kept Showcase",
            shortDescription: "Still beside the name.",
            type: "tool",
            status: "released",
            url: "https://example.com/kept",
          },
        },
        {
          id: "later-note",
          type: "calloutQuote",
          variant: "note",
          text: "Written after the showcase.",
          attribution: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />,
    );

    // A second block used to drop the project to the foot of the page. The
    // slot belongs to whatever is first, and the rest follow underneath.
    expect(html).toContain('data-profile-showcase="true"');
    expect(html).toContain('data-featured-project-layout="showcase"');
    expect(html.indexOf("Kept Showcase")).toBeLessThan(
      html.indexOf("Written after the showcase."),
    );
    // The showcase is not repeated in the body below it.
    expect(html.match(/Kept Showcase/g)).toHaveLength(1);
  });

  it("gives the Showcase slot up when another block is moved to the front", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "now-first",
          type: "calloutQuote",
          variant: "note",
          text: "Moved above the project.",
          attribution: null,
        },
        {
          id: "demoted-showcase",
          type: "featuredProject",
          variant: "card",
          project: externalProjectForRenderer("Demoted Showcase"),
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />,
    );

    expect(html).toContain('data-member-layout="blocks"');
    expect(html).not.toContain("data-profile-showcase");
    expect(html).toContain("Featured project");
  });

  it("puts the showcase beside the profile in every theme", () => {
    for (const definition of getEnabledMemberThemes()) {
      const theme = resolveEnabledThemeAccent(
        definition.id,
        definition.defaultAccentId,
      );
      if (!theme) throw new Error(`${definition.id}/default must remain enabled`);
      const doc: MemberPageDocumentV2 = {
        ...MINIMAL_DOC,
        frame: {
          ...MINIMAL_DOC.frame,
          theme: { id: theme.themeId, accentId: theme.accentId },
        },
        blocks: [
          {
            id: `featured-${definition.id}`,
            type: "featuredProject",
            variant: "card",
            project: externalProjectForRenderer(`${definition.label} Project`),
          },
        ],
      };

      const html = renderToStaticMarkup(
        <MemberPageV2View
          document={doc}
          theme={theme}
          assetMetadata={ASSET_METADATA}
        />,
      );

      // Where a project sits is a matter of composition, not of palette.
      // Tying the two meant a member changing their theme found their page
      // silently rearranged and the project at the foot of it.
      expect(html).toContain('data-member-layout="showcase"');
      expect(html).toContain('data-profile-showcase="true"');
      expect(html).toContain("Showcase");
    }
  });

  it("renders HAM featured project with registry facts", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "featured-1",
          type: "featuredProject",
          variant: "card",
          project: {
            kind: "ham",
            projectSlug: "untitled-quiz-show",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("Untitled quiz-show game");
    expect(html).toContain("game");
    expect(html).toContain("IN PLANNING");
  });

  it("renders HAM registry artwork directly from the reviewed static catalog", () => {
    const project = PROJECTS[0];
    const previousArtwork = project.artwork;
    project.artwork = {
      src: "/project-art/quiz-show.png",
      alt: "Reviewed quiz-show artwork",
    };

    try {
      const doc: MemberPageDocumentV2 = {
        ...MINIMAL_DOC,
        blocks: [
          {
            id: "featured-catalog-art",
            type: "featuredProject",
            variant: "card",
            project: { kind: "ham", projectSlug: project.slug },
          },
        ],
      };

      const html = renderToStaticMarkup(
        <MemberPageV2View
          document={doc}
          theme={PAPER_THEME}
          assetMetadata={new Map()}
        />,
      );

      expect(html).toContain('data-project-artwork-source="catalog"');
      expect(html).toContain('alt="Reviewed quiz-show artwork"');
      expect(html).toContain("quiz-show.png");
      expect(html).not.toContain("/member-assets/");
      expect(html).not.toContain("ART PENDING");
    } finally {
      project.artwork = previousArtwork;
    }
  });

  it("renders external featured project with validated facts", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "featured-2",
          type: "featuredProject",
          variant: "artwork-first",
          project: {
            kind: "external",
            name: "My Cool Game",
            shortDescription: "A description of my project.",
            type: "game",
            status: "in-development",
            url: "https://example.com/game",
            repository: "https://github.com/user/repo",
            artwork: {
              assetId: "asset-1",
              alt: "Game screenshot",
              decorative: false,
            },
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("My Cool Game");
    expect(html).toContain("A description of my project.");
    expect(html).toContain('href="https://example.com/game"');
    expect(html).toContain('href="https://github.com/user/repo"');
    expect(html).toContain("/member-assets/asset-1");
    expect(html).toContain('alt="Game screenshot"');
    expect(html).toContain('data-project-artwork-source="member"');
  });

  it("uses the accessible art-pending treatment when external artwork is absent", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "featured-pending",
          type: "featuredProject",
          variant: "artwork-first",
          project: externalProjectForRenderer("No Artwork Project"),
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />,
    );

    expect(html).toContain('data-project-artwork-source="pending"');
    expect(html).toContain("ART PENDING");
    expect(html.indexOf("ART PENDING")).toBeLessThan(
      html.indexOf("No Artwork Project"),
    );
  });

  it("renders project list with stacked and compact variants", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "list-1",
          type: "projectList",
          variant: "stacked",
          projects: [
            {
              id: "proj-1",
              project: {
                kind: "external",
                name: "Project Alpha",
                shortDescription: "First project.",
                type: "tool",
                status: "released",
              },
            },
            {
              id: "proj-2",
              project: {
                kind: "external",
                name: "Project Beta",
                shortDescription: "Second project.",
                type: "library",
                status: "playable",
              },
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("Project Alpha");
    expect(html).toContain("Project Beta");
    expect(html).toContain("First project.");
    expect(html).toContain("Second project.");
  });

  it("uses rel noopener noreferrer for external project links", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "featured-3",
          type: "featuredProject",
          variant: "card",
          project: {
            kind: "external",
            name: "External Project",
            shortDescription: "Test.",
            type: "game",
            status: "released",
            url: "https://game.example",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain('href="https://game.example"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(
      'href="https://game.example" rel="noopener noreferrer" class="inline-flex min-h-11',
    );
  });
});

describe("MemberPageV2View image and gallery blocks", () => {
  it("renders image block with same-origin asset path and dimensions", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "img-1",
          type: "image",
          variant: "framed",
          image: {
            assetId: "asset-1",
            alt: "A framed image",
            decorative: false,
          },
          caption: "Image caption text.",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("/member-assets/asset-1");
    expect(html).toContain('alt="A framed image"');
    expect(html).toContain('width="800"');
    expect(html).toContain('height="600"');
    expect(html).toContain("Image caption text.");
  });

  it("omits image when asset metadata is missing", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "img-2",
          type: "image",
          variant: "wide",
          image: {
            assetId: "missing-asset-id",
            alt: "Should not render",
            decorative: false,
          },
          caption: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).not.toContain("/member-assets/missing-asset-id");
    expect(html).not.toContain("Should not render");
  });

  it("contains wide images within the HAM page width and responsive gutters", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "img-wide-contained",
          type: "image",
          variant: "wide",
          image: {
            assetId: "asset-2",
            alt: "Contained wide image",
            decorative: false,
          },
          caption: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />,
    );

    expect(html).toContain('data-image-variant="wide"');
    expect(html).toContain("card-tilt w-full max-w-full");
    expect(html).toContain("(min-width: 1024px) 960px");
    expect(html).not.toMatch(/class="[^"]*-mx-/u);
  });

  it("renders gallery with grid and strip variants", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "gallery-1",
          type: "gallery",
          variant: "grid",
          items: [
            {
              id: "item-1",
              image: {
                assetId: "asset-1",
                alt: "First image",
                decorative: false,
              },
              caption: "First caption",
            },
            {
              id: "item-2",
              image: {
                assetId: "asset-2",
                alt: null,
                decorative: true,
              },
              caption: null,
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("/member-assets/asset-1");
    expect(html).toContain('alt="First image"');
    expect(html).toContain("First caption");
    expect(html).toContain("/member-assets/asset-2");
    expect(html).toContain('alt=""');
  });
});

describe("MemberPageV2View additional blocks", () => {
  it("renders additional links with list and button variants", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "links-1",
          type: "additionalLinks",
          variant: "list",
          links: [
            {
              id: "link-1",
              label: "Documentation",
              url: "https://docs.example.com",
              description: "Read the docs.",
            },
            {
              id: "link-2",
              label: "Blog",
              url: "https://blog.example.com",
              description: null,
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("Documentation");
    expect(html).toContain('href="https://docs.example.com"');
    expect(html).toContain("Read the docs.");
    expect(html).toContain("Blog");
    expect(html).toContain('href="https://blog.example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(
      'href="https://docs.example.com" rel="noopener noreferrer" class="inline-flex min-h-11',
    );
  });

  it("renders callout quote with note and quote variants", () => {
    const doc: MemberPageDocumentV2 = {
      ...MINIMAL_DOC,
      blocks: [
        {
          id: "quote-1",
          type: "calloutQuote",
          variant: "note",
          text: "This is a note.",
          attribution: null,
        },
        {
          id: "quote-2",
          type: "calloutQuote",
          variant: "quote",
          text: "A quoted statement.",
          attribution: "Author Name",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={doc}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("This is a note.");
    expect(html).toContain("A quoted statement.");
    expect(html).toContain("Author Name");
  });
});

describe("MemberPageV2View theme application", () => {
  it("applies Paper theme tokens via inline styles", () => {
    const html = renderToStaticMarkup(
      <MemberPageV2View
        document={MINIMAL_DOC}
        theme={PAPER_THEME}
        assetMetadata={ASSET_METADATA}
      />
    );

    expect(html).toContain("--member-paper:#f6f1e5");
    expect(html).toContain("--member-ink:#1c1a17");
    expect(html).toContain("--member-interactive-blue:#1d4ed8");
    expect(html).toContain('data-member-theme-surface="true"');
    expect(html).toContain('data-theme-id="paper"');
    expect(html).toContain(`data-accent-id="${PAPER_DEFAULT_ACCENT_ID}"`);
  });

  it("renders the representative all-block document inside every enabled pair", () => {
    for (const themeDefinition of getEnabledMemberThemes()) {
      for (const accentId of Object.keys(themeDefinition.accents)) {
        const theme = resolveEnabledThemeAccent(themeDefinition.id, accentId);
        if (!theme) {
          throw new Error(
            `fixture pair unavailable: ${themeDefinition.id}/${accentId}`,
          );
        }
        const document = canonicalMemberPageDocument();
        document.frame.theme = { id: theme.themeId, accentId: theme.accentId };
        const assetMetadata = new Map(
          extractMemberPageAssetIds(document).map(
            (assetId) =>
              [
                assetId,
                { width: 1200, height: 800, mimeType: "image/png" },
              ] as const,
          ),
        );

        const html = renderToStaticMarkup(
          <MemberPageV2View
            document={document}
            theme={theme}
            assetMetadata={assetMetadata}
          />,
        );

        expect(html).toContain('data-member-theme-surface="true"');
        expect(html).toContain(`data-theme-id="${theme.themeId}"`);
        expect(html).toContain(`data-accent-id="${theme.accentId}"`);
        expect(html).toContain('data-member-layout="blocks"');
        expect(html).toContain("Featured project");
        expect(html).toContain("Projects");
        expect(html).toContain("Newsletter");
        expect(html).toContain("Prototype night.");
        expect(html).toContain("Gallery");
        expect(html).toContain("Make the useful thing delightful.");
        expect(html.match(/<h1/g)).toHaveLength(1);

        const renderedHexes = new Set(html.match(/#[0-9a-f]{6}/giu) ?? []);
        expect(renderedHexes).toEqual(new Set(Object.values(theme.tokens)));
        expect(JSON.stringify(document)).not.toMatch(/#[0-9a-f]{3,8}/iu);
      }
    }
  });

  it("reaches the whole document without escaping into HAM's own tools", async () => {
    const [css, globals] = await Promise.all([
      readFile(
        path.join(
          process.cwd(),
          "src/components/member-page-v2/MemberPageV2View.module.css",
        ),
        "utf8",
      ),
      readFile(path.join(process.cwd(), "src/app/globals.css"), "utf8"),
    ]);

    for (const token of [
      "paper",
      "ink",
      "border",
      "muted",
      "surface",
      "decorative-red",
      "interactive-blue",
    ]) {
      expect(css).toContain(`--color-${token}: var(--member-${token})`);
      // The same palette reaches the body, so the background, the header rule
      // and the footer wear the member's theme rather than framing it in
      // HAM's. Values still come only from the reviewed registry.
      expect(globals).toContain(`--color-${token}: var(--member-${token})`);
    }
    expect(globals).toContain('body:has([data-theme-scope="page"])');

    for (const themeId of ["paper", "newsprint", "blueprint", "riso"]) {
      expect(css).toContain(`[data-theme-id="${themeId}"]`);
    }
    expect(css).toMatch(
      /\[data-theme-id="paper"\]::before\s*\{[^}]*display:\s*none;/u,
    );

    // A published page's texture is fixed to the window so it fills the sheet;
    // a panel's stops at its own edge, which is what keeps the editor's
    // workbench and its theme swatches in house colours.
    expect(css).toMatch(
      /\[data-theme-scope="page"\]::before\s*\{[^}]*position:\s*fixed;/u,
    );
    expect(css).toContain('.themeSurface[data-theme-scope="panel"]');
    // A surface claiming no scope carries the palette and paints nothing, so
    // a canvas nested in a themed sheet cannot double the texture.
    expect(css).not.toMatch(/^\.themeSurface::before/mu);

    expect(css).not.toContain("prefers-color-scheme");
    expect(
      [...css.matchAll(/animation:\s*([^;]+);/gu)].map((match) => match[1].trim()),
    ).toEqual(["none"]);
  });

  it("installs one reviewed stylesheet and never a document-authored value", () => {
    for (const definition of getEnabledMemberThemes()) {
      for (const accentId of Object.keys(definition.accents)) {
        const theme = resolveEnabledThemeAccent(definition.id, accentId);
        if (!theme) throw new Error(`${definition.id}/${accentId} unavailable`);

        const html = renderToStaticMarkup(
          <MemberPageV2View
            document={MINIMAL_DOC}
            theme={theme}
            assetMetadata={ASSET_METADATA}
          />,
        );

        // Custom properties cannot travel upwards from inside the page, so the
        // palette reaches the root through a stylesheet. Its text is not
        // escaped for us, so it must hold nothing but the registry's colours.
        const style = html.match(/<style[^>]*>(.*?)<\/style>/u);
        expect(style).not.toBeNull();
        expect(style?.[1]).toMatch(
          /^:root\{(--member-[a-z-]+:#[0-9a-f]{6};?)+\}$/u,
        );
        expect(html).toContain(
          `data-href="member-theme-${theme.themeId}-${theme.accentId}"`,
        );
        expect(html).toContain('data-theme-scope="page"');
      }
    }
  });
});

function externalProjectForRenderer(name: string) {
  return {
    kind: "external" as const,
    name,
    shortDescription: `${name} description.`,
    type: "tool",
    status: "released" as const,
    url: "https://example.com/project",
  };
}
