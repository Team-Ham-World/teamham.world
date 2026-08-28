import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditorCanvas } from "@/components/member-page-editor/editor-canvas";
import {
  MEMBER_PAGE_PUBLIC_IMAGE_SIZES,
  renderMemberPageV2LeafBlock,
} from "@/components/member-page-v2/blocks/MemberPageV2LeafBlock";
import { MemberPageV2View } from "@/components/member-page-v2/MemberPageV2View";
import { composeMemberPageV2Layout } from "@/components/member-page-v2/page-composition";
import type {
  MemberBlock,
  MemberPageDocumentV2,
} from "@/lib/members/v2/document";
import {
  PAPER_DEFAULT_ACCENT_ID,
  resolveEnabledThemeAccent,
} from "@/lib/members/v2/themes";

function paperTheme() {
  const theme = resolveEnabledThemeAccent("paper", PAPER_DEFAULT_ACCENT_ID);
  if (!theme) throw new Error("paper/default must remain enabled");
  return theme;
}

const THEME = paperTheme();

const ASSET_METADATA = new Map([
  ["asset-a", { width: 1200, height: 800, mimeType: "image/png" }],
  ["asset-b", { width: 1600, height: 900, mimeType: "image/png" }],
  ["asset-c", { width: 800, height: 800, mimeType: "image/jpeg" }],
] as const);

function externalProject(name: string, slug: string) {
  return {
    kind: "external" as const,
    name,
    // Deliberately free of the name so project names stay unique landmarks.
    shortDescription: "Made for the parity fixture.",
    type: "game",
    status: "released" as const,
    url: `https://example.com/${slug}`,
  };
}

/**
 * One block per union member per variant that the fixtures exercise, each
 * with a landmark string unique across the whole page so both render trees
 * can be compared by landmark position.
 */
const ALL_BLOCKS: MemberBlock[] = [
  {
    id: "b-rich",
    type: "richText",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Origin story" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Path notes." }],
        },
      ],
    },
  },
  {
    id: "b-featured-card",
    type: "featuredProject",
    variant: "card",
    project: externalProject("Lantern row", "lantern-row"),
  },
  {
    id: "b-projects-stacked",
    type: "projectList",
    variant: "stacked",
    projects: [
      { id: "p-1", project: externalProject("Comet feed", "comet-feed") },
      { id: "p-2", project: externalProject("Signal box", "signal-box") },
    ],
  },
  {
    id: "b-projects-compact",
    type: "projectList",
    variant: "compact",
    projects: [
      { id: "p-3", project: externalProject("Pocket atlas", "pocket-atlas") },
    ],
  },
  {
    id: "b-links-list",
    type: "additionalLinks",
    variant: "list",
    links: [
      {
        id: "l-1",
        label: "Devlog",
        url: "https://example.com/devlog",
        description: "Weekly notes.",
      },
    ],
  },
  {
    id: "b-links-buttons",
    type: "additionalLinks",
    variant: "buttons",
    links: [
      {
        id: "l-2",
        label: "Play the thing",
        url: "https://example.com/play",
        description: null,
      },
    ],
  },
  {
    id: "b-image-framed",
    type: "image",
    variant: "framed",
    image: { assetId: "asset-a", alt: "Game board photo", decorative: false },
    caption: "Prototype night.",
  },
  {
    id: "b-image-wide",
    type: "image",
    variant: "wide",
    image: { assetId: "asset-b", alt: null, decorative: true },
    caption: null,
  },
  {
    id: "b-gallery-grid",
    type: "gallery",
    variant: "grid",
    items: [
      {
        id: "g-1",
        image: { assetId: "asset-c", alt: "Sketch one", decorative: false },
        caption: "First sketch.",
      },
    ],
  },
  {
    id: "b-gallery-strip",
    type: "gallery",
    variant: "strip",
    items: [
      {
        id: "g-2",
        image: { assetId: "asset-c", alt: "Sketch three", decorative: false },
        caption: null,
      },
    ],
  },
  {
    id: "b-note",
    type: "calloutQuote",
    variant: "note",
    text: "Currently experimenting with tiny multiplayer games.",
    attribution: null,
  },
  {
    id: "b-quote",
    type: "calloutQuote",
    variant: "quote",
    text: "Make the useful thing delightful.",
    attribution: "Ada",
  },
];

/**
 * Compile-time exhaustiveness: a new MemberBlock member fails to compile here
 * until it names its landmark, just as it fails to compile in
 * `renderMemberPageV2LeafBlock` until it names its case.
 */
const FIRST_LANDMARK_BY_BLOCK_TYPE = {
  richText: "Origin story",
  featuredProject: "Lantern row",
  projectList: "Comet feed",
  additionalLinks: "Devlog",
  image: "Prototype night.",
  gallery: "First sketch.",
  calloutQuote: "Currently experimenting with tiny multiplayer games.",
} satisfies Record<MemberBlock["type"], string>;

/** Document-order landmarks; one per rendered block, unique per page. */
const ORDERED_LANDMARKS: ReadonlyArray<{ blockId: string; landmark: string }> =
  [
    { blockId: "b-rich", landmark: "Origin story" },
    { blockId: "b-featured-card", landmark: "Lantern row" },
    { blockId: "b-projects-stacked", landmark: "Comet feed" },
    { blockId: "b-projects-compact", landmark: "Pocket atlas" },
    { blockId: "b-links-list", landmark: "Devlog" },
    { blockId: "b-links-buttons", landmark: "Play the thing" },
    { blockId: "b-image-framed", landmark: "Prototype night." },
    { blockId: "b-image-wide", landmark: 'data-image-variant="wide"' },
    { blockId: "b-gallery-grid", landmark: "First sketch." },
    { blockId: "b-gallery-strip", landmark: "Sketch three" },
    {
      blockId: "b-note",
      landmark: "Currently experimenting with tiny multiplayer games.",
    },
    { blockId: "b-quote", landmark: "Make the useful thing delightful." },
  ];

const LANDMARK_BY_BLOCK_ID = new Map(
  ORDERED_LANDMARKS.map((entry) => [entry.blockId, entry.landmark]),
);

function memberPageDocument(blocks: MemberBlock[]): MemberPageDocumentV2 {
  return {
    schemaVersion: 2,
    frame: {
      displayName: "Parity Fixture",
      summary: null,
      websiteUrl: null,
      socialLinks: {},
      portrait: null,
      theme: { id: "paper", accentId: PAPER_DEFAULT_ACCENT_ID },
    },
    blocks,
  };
}

const PUBLIC_CONTEXT = {
  assetMetadata: ASSET_METADATA,
  imageSizes: MEMBER_PAGE_PUBLIC_IMAGE_SIZES,
} as const;

function renderPublic(document: MemberPageDocumentV2): string {
  return renderToStaticMarkup(
    <MemberPageV2View
      document={document}
      theme={THEME}
      assetMetadata={ASSET_METADATA}
    />,
  );
}

const CANVAS_CALLBACKS = {
  onSelectFrame: () => undefined,
  onSelectBlock: () => undefined,
  onDuplicate: () => undefined,
  onDelete: () => undefined,
  onMove: () => undefined,
};

function renderEditor(document: MemberPageDocumentV2): string {
  return renderToStaticMarkup(
    <EditorCanvas
      document={document}
      theme={THEME}
      assetMetadata={ASSET_METADATA}
      selection={null}
      callbacks={CANVAS_CALLBACKS}
      interactive={false}
    />,
  );
}

function firstIndexOf(html: string, landmark: string): number {
  const index = html.indexOf(landmark);
  expect(index, `landmark missing from render output: ${landmark}`).toBeGreaterThan(-1);
  return index;
}

describe("shared leaf dispatcher", () => {
  it("renders every MemberBlock type", () => {
    for (const block of ALL_BLOCKS) {
      const html = renderToStaticMarkup(
        renderMemberPageV2LeafBlock(block, PUBLIC_CONTEXT),
      );
      const landmark = LANDMARK_BY_BLOCK_ID.get(block.id);
      expect(landmark, `fixture landmark for ${block.id}`).toBeDefined();
      expect(html, `dispatcher output for ${block.id}`).toContain(landmark);
    }
  });

  it("defaults a featured project to standard and passes showcase through", () => {
    const block = ALL_BLOCKS.find(
      (candidate): candidate is Extract<MemberBlock, { type: "featuredProject" }> =>
        candidate.id === "b-featured-card",
    );
    if (!block) throw new Error("fixture featured project missing");

    const standard = renderToStaticMarkup(
      renderMemberPageV2LeafBlock(block, PUBLIC_CONTEXT),
    );
    expect(standard).toContain('data-featured-project-layout="standard"');
    expect(standard).toContain("Featured project");

    const showcase = renderToStaticMarkup(
      renderMemberPageV2LeafBlock(block, {
        ...PUBLIC_CONTEXT,
        featuredProjectLayout: "showcase",
      }),
    );
    expect(showcase).toContain('data-featured-project-layout="showcase"');
    expect(showcase).toContain("Showcase");
  });

  it("fails loudly on a block type outside the MemberBlock union", () => {
    // Validation rejects unknown block types before render, so this forged
    // value can only exist behind a broken validation boundary; the dispatcher
    // must still not drop it silently.
    const forged = { id: "b-forged", type: "hologram" } as unknown as MemberBlock;
    expect(() =>
      renderMemberPageV2LeafBlock(forged, PUBLIC_CONTEXT),
    ).toThrowError(/Unhandled member block type/);
  });
});

describe("public and editor leaf parity", () => {
  const allBlocksDocument = memberPageDocument(ALL_BLOCKS);
  const publicHtml = renderPublic(allBlocksDocument);
  const editorHtml = renderEditor(allBlocksDocument);

  it("fixture covers every MemberBlock type", () => {
    const renderedTypes = [...new Set(ALL_BLOCKS.map((block) => block.type))].sort();
    const declaredTypes = Object.keys(FIRST_LANDMARK_BY_BLOCK_TYPE).sort();
    expect(renderedTypes).toEqual(declaredTypes);
  });

  it("renders the same output for every block type in both trees", () => {
    for (const [type, landmark] of Object.entries(FIRST_LANDMARK_BY_BLOCK_TYPE)) {
      expect(publicHtml, `public ${type}`).toContain(landmark);
      expect(editorHtml, `editor ${type}`).toContain(landmark);
    }
  });

  it("keeps the outer trees separate", () => {
    expect(publicHtml).toContain('data-theme-scope="page"');
    expect(publicHtml).not.toContain("data-editor-block-list");
    expect(editorHtml).toContain('data-editor-block-list="true"');
    expect(editorHtml).not.toContain('data-theme-scope="page"');
  });

  it("renders every block in the same order in both trees", () => {
    const landmarks = ORDERED_LANDMARKS.map((entry) => entry.landmark);
    const publicIndices = landmarks.map((landmark) =>
      firstIndexOf(publicHtml, landmark),
    );
    const editorIndices = landmarks.map((landmark) =>
      firstIndexOf(editorHtml, landmark),
    );

    for (const [label, indices] of [
      ["public", publicIndices],
      ["editor", editorIndices],
    ] as const) {
      for (let i = 1; i < indices.length; i += 1) {
        expect(
          indices[i],
          `${label} landmark ${i} out of order`,
        ).toBeGreaterThan(indices[i - 1]);
      }
    }

    // Identical relative order, not merely sorted.
    const orderOf = (indices: number[]) =>
      indices
        .map((index, position) => ({ index, position }))
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.position);
    expect(orderOf(publicIndices)).toEqual(orderOf(editorIndices));
  });

  it("keeps each path's image sizes hints while sharing everything else", () => {
    const framedSizes = '(min-width: 1024px) 768px, calc(100vw - 2.5rem)';
    expect(publicHtml).toContain(
      "(min-width: 1024px) 960px, (min-width: 640px) calc(100vw - 4rem)",
    );
    expect(publicHtml).not.toContain("(min-width: 1280px) 1152px");
    expect(editorHtml).toContain("(min-width: 1280px) 1152px");
    expect(editorHtml).not.toContain("(min-width: 1024px) 960px");
    expect(publicHtml).toContain(`sizes="${framedSizes}"`);
    expect(editorHtml).toContain(`sizes="${framedSizes}"`);
  });
});

describe("showcase eligibility and body order", () => {
  const featured = ALL_BLOCKS.find(
    (candidate): candidate is Extract<MemberBlock, { type: "featuredProject" }> =>
      candidate.id === "b-featured-card",
  );
  if (!featured) throw new Error("fixture featured project missing");
  const note = ALL_BLOCKS.find(
    (candidate): candidate is Extract<MemberBlock, { type: "calloutQuote" }> =>
      candidate.id === "b-note",
  );
  if (!note) throw new Error("fixture note missing");

  it("gives an empty page the blocks layout and no showcase", () => {
    const composition = composeMemberPageV2Layout(memberPageDocument([]));
    expect(composition).toEqual({
      layout: "blocks",
      showcaseProject: null,
      bodyBlocks: [],
    });
  });

  it("makes a leading featured project the showcase and excludes it from the body", () => {
    const composition = composeMemberPageV2Layout(
      memberPageDocument([featured, note]),
    );
    expect(composition.layout).toBe("showcase");
    expect(composition.showcaseProject?.id).toBe(featured.id);
    expect(composition.bodyBlocks.map((block) => block.id)).toEqual([note.id]);
  });

  it("keeps the blocks layout when no featured project is first", () => {
    const composition = composeMemberPageV2Layout(
      memberPageDocument([note, featured]),
    );
    expect(composition.layout).toBe("blocks");
    expect(composition.showcaseProject).toBeNull();
    expect(composition.bodyBlocks.map((block) => block.id)).toEqual([
      note.id,
      featured.id,
    ]);
  });

  it("renders the same showcase eligibility in both trees", () => {
    const showcaseDocument = memberPageDocument([featured, note]);
    const publicHtml = renderPublic(showcaseDocument);
    const editorHtml = renderEditor(showcaseDocument);

    for (const [label, html] of [
      ["public", publicHtml],
      ["editor", editorHtml],
    ] as const) {
      expect(html, label).toContain('data-member-layout="showcase"');
      expect(html, label).toContain('data-profile-showcase="true"');
      expect(html, label).toContain('data-featured-project-layout="showcase"');
      expect(html, label).not.toContain(
        'data-featured-project-layout="standard"',
      );
      // The showcase is not repeated in the body underneath it.
      expect(html.match(/Lantern row/gu), label).toHaveLength(1);
      expect(firstIndexOf(html, "Lantern row")).toBeLessThan(
        firstIndexOf(html, "Currently experimenting with tiny multiplayer games."),
      );
    }
  });

  it("renders the same plain-body eligibility in both trees", () => {
    const blocksDocument = memberPageDocument([note, featured]);
    const publicHtml = renderPublic(blocksDocument);
    const editorHtml = renderEditor(blocksDocument);

    for (const [label, html] of [
      ["public", publicHtml],
      ["editor", editorHtml],
    ] as const) {
      expect(html, label).toContain('data-member-layout="blocks"');
      expect(html, label).not.toContain("data-profile-showcase");
      expect(html, label).toContain('data-featured-project-layout="standard"');
      expect(html, label).not.toContain(
        'data-featured-project-layout="showcase"',
      );
      expect(firstIndexOf(html, "Currently experimenting")).toBeLessThan(
        firstIndexOf(html, "Lantern row"),
      );
    }
  });
});
