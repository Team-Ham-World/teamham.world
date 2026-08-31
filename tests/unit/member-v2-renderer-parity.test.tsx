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
  MemberBlockRow,
  MemberBlockRowRatio,
  MemberPageDocumentV2,
  MemberPageEntry,
} from "@/lib/members/v2/document";
import { rowEntryKey } from "@/lib/members/v2/member-page-entries";
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
  {
    id: "b-embed-compact",
    type: "embed",
    variant: "compact",
    url: "https://open.spotify.com/embed/track/compact-example",
    title: "Compact audio player",
    showFrame: true,
  },
  {
    id: "b-embed-standard",
    type: "embed",
    variant: "standard",
    url: "https://open.spotify.com/embed/playlist/standard-example",
    title: "Standard playlist player",
    showFrame: true,
  },
  {
    id: "b-embed-widescreen",
    type: "embed",
    variant: "widescreen",
    url: "https://www.youtube.com/embed/widescreen-example",
    title: "Widescreen video player",
    showFrame: false,
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
  embed: "Compact audio player",
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
    { blockId: "b-embed-compact", landmark: "Compact audio player" },
    { blockId: "b-embed-standard", landmark: "Standard playlist player" },
    { blockId: "b-embed-widescreen", landmark: "Widescreen video player" },
  ];

const LANDMARK_BY_BLOCK_ID = new Map(
  ORDERED_LANDMARKS.map((entry) => [entry.blockId, entry.landmark]),
);

function memberPageDocument(
  blocks: readonly MemberPageEntry[],
): MemberPageDocumentV2 {
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
    blocks: [...blocks],
  };
}

function entryLeafId(entry: MemberPageEntry): string {
  return entry.type === "row" ? entry.blocks[0].id : entry.id;
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
  onTakeOutOfRow: () => undefined,
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

  it("renders embeds with fixed permissions and without member HTML", () => {
    const block = ALL_BLOCKS.find(
      (candidate): candidate is Extract<MemberBlock, { type: "embed" }> =>
        candidate.id === "b-embed-compact",
    );
    if (!block) throw new Error("fixture embed missing");

    const html = renderToStaticMarkup(
      renderMemberPageV2LeafBlock(block, PUBLIC_CONTEXT),
    );
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('sandbox="allow-forms allow-popups');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(html).toContain('src="https://open.spotify.com/embed/track/compact-example"');
    expect(html).not.toContain("dangerouslySetInnerHTML");
    expect(html).not.toContain("srcDoc");
  });

  it("can remove every HAM frame element and leave only the embed", () => {
    const block = ALL_BLOCKS.find(
      (candidate): candidate is Extract<MemberBlock, { type: "embed" }> =>
        candidate.id === "b-embed-widescreen",
    );
    if (!block) throw new Error("fixture frameless embed missing");

    const html = renderToStaticMarkup(
      renderMemberPageV2LeafBlock(block, PUBLIC_CONTEXT),
    );
    expect(html).toContain('data-embed-frame="hidden"');
    expect(html).toContain("<iframe");
    expect(html).not.toContain("card-tilt");
    expect(html).not.toContain("Open <span");
    expect(html).not.toContain("youtube.com</p>");
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

  it("gives an empty page the blocks layout and no header block", () => {
    const composition = composeMemberPageV2Layout(memberPageDocument([]));
    expect(composition).toEqual({
      layout: "blocks",
      headerSlotBlock: null,
      bodyEntries: [],
    });
  });

  it("makes a leading featured project the header block and excludes it from the body", () => {
    const composition = composeMemberPageV2Layout(
      memberPageDocument([featured, note]),
    );
    expect(composition.layout).toBe("showcase");
    expect(composition.headerSlotBlock?.id).toBe(featured.id);
    expect(composition.bodyEntries.map(entryLeafId)).toEqual([note.id]);
  });

  it("keeps the blocks layout when a row leads the page", () => {
    const composition = composeMemberPageV2Layout(
      memberPageDocument([
        { type: "row", ratio: "1:1", blocks: [note, featured] },
      ]),
    );
    expect(composition.layout).toBe("blocks");
    expect(composition.headerSlotBlock).toBeNull();
    expect(composition.bodyEntries).toHaveLength(1);
  });

  it("eligible for the header slot: every standalone block variant", () => {
    // The fixture registry fails to compile until it covers every
    // `MemberBlock` type (guarded in the parity suite above), so iterating it
    // walks every variant without hand-copying type lists.
    for (const block of ALL_BLOCKS) {
      const composition = composeMemberPageV2Layout(
        memberPageDocument([block, note]),
      );
      expect(composition.layout, block.id).toBe("showcase");
      expect(composition.headerSlotBlock, block.id).toBe(block);
      expect(
        composition.bodyEntries.map(entryLeafId),
        block.id,
      ).toEqual([note.id]);
    }
  });

  it("never gives a leading row the header slot", () => {
    const composition = composeMemberPageV2Layout(
      memberPageDocument([
        { type: "row", ratio: "1:1", blocks: [featured, note] },
      ]),
    );
    expect(composition.layout).toBe("blocks");
    expect(composition.headerSlotBlock).toBeNull();
    expect(composition.bodyEntries).toHaveLength(1);
  });

  it("renders the same header eligibility in both trees", () => {
    const headerDocument = memberPageDocument([featured, note]);
    const publicHtml = renderPublic(headerDocument);
    const editorHtml = renderEditor(headerDocument);

    for (const [label, html] of [
      ["public", publicHtml],
      ["editor", editorHtml],
    ] as const) {
      expect(html, label).toContain('data-member-layout="showcase"');
      expect(html, label).toContain('data-profile-showcase="true"');
      expect(html, label).toContain("lg:items-center");
      expect(html, label).not.toContain("lg:items-start");
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

  it("renders stored alignment identically in both trees", () => {
    const alignedRichText: MemberBlock = {
      id: "b-align",
      type: "richText",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [{ type: "text", text: "Centered for parity." }],
          },
          {
            type: "heading",
            attrs: { level: 2, textAlign: "right" },
            content: [{ type: "text", text: "Right heading parity." }],
          },
        ],
      },
    };
    const alignedDocument = memberPageDocument([alignedRichText, note]);
    const publicHtml = renderPublic(alignedDocument);
    const editorHtml = renderEditor(alignedDocument);

    for (const [label, html] of [
      ["public", publicHtml],
      ["editor", editorHtml],
    ] as const) {
      // Class-to-element composition is proven exactly in the focused
      // renderer test; here both trees only need the alignment class and
      // the landmark text, with no inline-style fallback.
      expect(html, label).toContain("text-center");
      expect(html, label).toContain("Centered for parity.");
      expect(html, label).toContain("text-right");
      expect(html, label).toContain("Right heading parity.");
      expect(html, label).not.toContain("text-align:");
    }
  });

  it("renders the same plain-body eligibility in both trees", () => {
    const blocksDocument = memberPageDocument([
      { type: "row", ratio: "1:1", blocks: [note, featured] },
    ]);
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

  it("renders a non-project header block once, in the header and not the body", () => {
    const noteDocument = memberPageDocument([note, featured]);
    const publicHtml = renderPublic(noteDocument);
    const editorHtml = renderEditor(noteDocument);

    for (const [label, html] of [
      ["public", publicHtml],
      ["editor", editorHtml],
    ] as const) {
      expect(html, label).toContain('data-member-layout="showcase"');
      expect(html, label).toContain('data-profile-showcase="true"');
      expect(html, label).not.toContain(
        'data-featured-project-layout="showcase"',
      );
      expect(html, label).toContain('data-featured-project-layout="standard"');
      expect(html.match(/Currently experimenting/gu), label).toHaveLength(1);
      const noteIndex = firstIndexOf(
        html,
        "Currently experimenting with tiny multiplayer games.",
      );
      expect(noteIndex).toBeLessThan(firstIndexOf(html, "Featured project"));
      expect(noteIndex).toBeLessThan(firstIndexOf(html, "Lantern row"));
    }
  });
});

describe("row parity", () => {
  function parityRow(
    left: MemberBlock,
    right: MemberBlock,
    ratio: MemberBlockRowRatio = "1:1",
  ): MemberBlockRow {
    return { type: "row", ratio, blocks: [left, right] };
  }

  function parityNote(id: string, text: string): MemberBlock {
    return { id, type: "calloutQuote", variant: "note", text, attribution: null };
  }

  it("renders one shared row geometry in both trees for every ratio", () => {
    for (const ratio of ["1:1", "1:2", "2:1"] as const) {
      const rowDocument = memberPageDocument([
        parityRow(
          ALL_BLOCKS[0],
          parityNote("parity-note", "Right-hand side."),
          ratio,
        ),
      ]);
      const publicHtml = renderPublic(rowDocument);
      const editorHtml = renderEditor(rowDocument);

      const gridClass = {
        "1:1": "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
        "1:2": "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]",
        "2:1": "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
      }[ratio];

      for (const [label, html] of [
        ["public", publicHtml],
        ["editor", editorHtml],
      ] as const) {
        expect(html, `${label} ${ratio}`).toContain(
          `data-member-row-ratio="${ratio}"`,
        );
        expect(html, `${label} ${ratio}`).toContain(gridClass);
        expect(html, `${label} ${ratio}`).toContain("grid grid-cols-1 gap-14");
        expect(html, `${label} ${ratio}`).toContain("lg:items-center");
        expect(firstIndexOf(html, "Origin story")).toBeLessThan(
          firstIndexOf(html, "Right-hand side."),
        );
      }
    }
  });

  it("applies the same survivor plan in both trees", () => {
    const brokenWide = ALL_BLOCKS.find(
      (candidate): candidate is Extract<MemberBlock, { type: "image" }> =>
        candidate.id === "b-image-wide",
    );
    if (!brokenWide) throw new Error("fixture wide image missing");
    const degradedRow = memberPageDocument([
      parityRow(ALL_BLOCKS[0], {
        ...brokenWide,
        image: { assetId: "missing-parity-asset", alt: null, decorative: true },
      }),
      parityNote("after-row", "After the row."),
    ]);
    const publicHtml = renderPublic(degradedRow);
    const editorHtml = renderEditor(degradedRow);

    for (const [label, html] of [
      ["public", publicHtml],
      ["editor", editorHtml],
    ] as const) {
      expect(html, label).not.toContain("data-member-row-ratio");
      expect(html, label).not.toContain("/member-assets/missing-parity-asset");
      expect(html, label).toContain("Origin story");
      expect(firstIndexOf(html, "Origin story"), label).toBeLessThan(
        firstIndexOf(html, "After the row."),
      );
    }
  });

  it("applies the same omitted plan in both trees", () => {
    const deadImage = (id: string, assetId: string): MemberBlock => ({
      id,
      type: "image",
      variant: "framed",
      image: { assetId, alt: `Dead ${id}`, decorative: false },
      caption: null,
    });
    const omittedRow = memberPageDocument([
      parityRow(deadImage("dead-a", "missing-a"), deadImage("dead-b", "missing-b")),
      parityNote("after-row", "After the row."),
    ]);
    const publicHtml = renderPublic(omittedRow);
    const editorHtml = renderEditor(omittedRow);

    for (const [label, html] of [
      ["public", publicHtml],
      ["editor", editorHtml],
    ] as const) {
      expect(html, label).not.toContain("data-member-row-ratio");
      expect(html, label).not.toContain("/member-assets/missing-a");
      expect(html, label).not.toContain("/member-assets/missing-b");
      expect(html, label).toContain("After the row.");
    }
  });

  it("gives row-placed images each tree's own column hints for the same shares", () => {
    const imageLeft: MemberBlock = {
      id: "parity-image",
      type: "image",
      variant: "framed",
      image: { assetId: "asset-a", alt: "Parity image", decorative: false },
      caption: null,
    };
    const rowDocument = memberPageDocument([
      parityRow(imageLeft, parityNote("parity-note", "Text column.")),
    ]);
    const publicHtml = renderPublic(rowDocument);
    const editorHtml = renderEditor(rowDocument);

    expect(publicHtml).toContain(
      'sizes="(min-width: 1024px) 452px, calc(100vw - 2.5rem)"',
    );
    expect(editorHtml).toContain(
      'sizes="(min-width: 1024px) 426px, calc(100vw - 2.5rem)"',
    );
    expect(editorHtml).not.toContain('sizes="(min-width: 1024px) 452px');
  });

  it("keeps the row out of the showcase slot in both trees", () => {
    const featuredInRow: MemberBlock = {
      id: "parity-row-featured",
      type: "featuredProject",
      variant: "card",
      project: externalProject("Row showcase", "row-showcase"),
    };
    const rowDocument = memberPageDocument([
      parityRow(featuredInRow, parityNote("parity-note", "Beside the project.")),
    ]);
    const publicHtml = renderPublic(rowDocument);
    const editorHtml = renderEditor(rowDocument);

    for (const [label, html] of [
      ["public", publicHtml],
      ["editor", editorHtml],
    ] as const) {
      expect(html, label).toContain('data-member-layout="blocks"');
      expect(html, label).not.toContain("data-profile-showcase");
      expect(html, label).toContain('data-featured-project-layout="standard"');
      expect(html, label).not.toContain(">Showcase<");
    }
  });

  it("keys row entries by their analysis descriptor, not a per-path scheme", () => {
    const entries: MemberPageEntry[] = [
      parityRow(
        ALL_BLOCKS[0],
        parityNote("parity-note", "Right-hand side."),
        "2:1",
      ),
    ];
    const rowEntry = entries[0];
    if (rowEntry.type !== "row") throw new Error("expected a row");
    const editorHtml = renderEditor(memberPageDocument(entries));
    expect(editorHtml).toContain(
      `data-sortable-block-id="${rowEntryKey(rowEntry).replace(/"/g, "&quot;")}"`,
    );
    expect(editorHtml).toContain("data-sortable-block-id=");
  });
});
