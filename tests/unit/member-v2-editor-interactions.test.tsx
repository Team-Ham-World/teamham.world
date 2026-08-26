import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { blockOutlineSummary } from "@/components/member-page-editor/block-outline";
import { memberPageDndContextId } from "@/components/member-page-editor/dnd-config";
import { EditorCanvas } from "@/components/member-page-editor/editor-canvas";
import {
  moveBlock,
  moveBlockToIndex,
} from "@/components/member-page-editor/document-ops";
import {
  controlIdForError,
  focusFirstInvalidControl,
  summarizeEditorValidation,
} from "@/components/member-page-editor/editor-validation";
import {
  focusInspectorReturnTarget,
  handleInspectorDialogKeyDown,
  MobileInspectorSheet,
} from "@/components/member-page-editor/mobile-inspector-sheet";
import {
  dragCancelAnnouncement,
  dragOverAnnouncement,
  dragStartAnnouncement,
  MEMBER_PAGE_DND_CONTEXT_ID,
  POINTER_ACTIVATION_DISTANCE,
  SortableEditorCanvas,
} from "@/components/member-page-editor/sortable-editor-canvas";
import type { MemberBlock, MemberPageDocumentV2 } from "@/lib/members/v2/document";
import {
  getEnabledMemberThemes,
  resolveEnabledThemeAccent,
} from "@/lib/members/v2/themes";

import {
  externalProject,
  minimalMemberPageDocument,
} from "../fixtures/member-v2/documents";

const resolvedTheme = resolveEnabledThemeAccent("paper", "default");
if (!resolvedTheme) throw new Error("paper/default must be enabled for this test");

function callout(id: string): MemberBlock {
  return {
    id,
    type: "calloutQuote",
    variant: "note",
    text: `Text ${id}`,
    attribution: null,
  };
}

function docWith(blocks: MemberBlock[]): MemberPageDocumentV2 {
  return { ...minimalMemberPageDocument(), blocks };
}

const CANVAS_CALLBACKS = {
  onSelectFrame: () => undefined,
  onSelectBlock: () => undefined,
  onDuplicate: () => undefined,
  onDelete: () => undefined,
  onMove: () => undefined,
};

function focusedElement(connected = true) {
  return {
    isConnected: connected,
    focus: vi.fn(),
    getAttribute: vi.fn(() => null),
    hasAttribute: vi.fn(() => false),
  };
}

describe("sortable editor enhancement", () => {
  it("keeps pointer and keyboard drops identical to repeated move controls", () => {
    const original = docWith([callout("a"), callout("b"), callout("c")]);

    const pointerDrop = moveBlockToIndex(original, "a", 2);
    const firstDown = moveBlock(original, "a", "down");
    expect(pointerDrop.status).toBe("ok");
    expect(firstDown.status).toBe("ok");
    if (pointerDrop.status !== "ok" || firstDown.status !== "ok") return;
    const secondDown = moveBlock(firstDown.document, "a", "down");
    expect(secondDown.status).toBe("ok");
    if (secondDown.status !== "ok") return;
    expect(pointerDrop.document.blocks.map((block) => block.id)).toEqual(
      secondDown.document.blocks.map((block) => block.id),
    );

    const keyboardDrop = moveBlockToIndex(original, "c", 0);
    const firstUp = moveBlock(original, "c", "up");
    expect(keyboardDrop.status).toBe("ok");
    expect(firstUp.status).toBe("ok");
    if (keyboardDrop.status !== "ok" || firstUp.status !== "ok") return;
    const secondUp = moveBlock(firstUp.document, "c", "up");
    expect(secondUp.status).toBe("ok");
    if (secondUp.status !== "ok") return;
    expect(keyboardDrop.document.blocks.map((block) => block.id)).toEqual(
      secondUp.document.blocks.map((block) => block.id),
    );
  });

  it("uses an explicit context id, an 8px activation floor, and visible handles", () => {
    const contextId = memberPageDndContextId("hamfriend");
    const html = renderToStaticMarkup(
      <SortableEditorCanvas
        document={docWith([callout("a"), callout("b")])}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={{ kind: "block", blockId: "a" }}
        callbacks={{
          onSelectFrame: () => undefined,
          onSelectBlock: () => undefined,
          onDuplicate: () => undefined,
          onDelete: () => undefined,
          onMove: () => undefined,
        }}
        interactive
        dndContextId={contextId}
        onReorder={() => undefined}
        onAnnounce={() => undefined}
      />,
    );

    expect(MEMBER_PAGE_DND_CONTEXT_ID).toBe("member-page-block-sorter");
    expect(contextId).toBe("member-page-block-sorter-hamfriend");
    expect(POINTER_ACTIVATION_DISTANCE).toBeGreaterThanOrEqual(8);
    expect(html).toContain(`data-editor-dnd-context-id="${contextId}"`);
    expect(html).toContain("Drag Callout or quote, current position 1 of 2");
    expect(html).toContain("touch-none");
    expect(html).toContain("Move up");
    expect(html).toContain("Move down");
  });

  it("announces the block type and position without an assertive region", () => {
    expect(dragStartAnnouncement("Gallery", 2, 5)).toContain(
      "Picked up Gallery, position 2 of 5",
    );
    expect(dragOverAnnouncement("Gallery", 4, 5)).toBe(
      "Gallery is over position 4 of 5.",
    );
    expect(dragCancelAnnouncement("Gallery", 2, 5)).toContain(
      "still at position 2 of 5",
    );
  });
});

describe("showcase canvas parity", () => {
  const showcaseDocument = docWith([
    {
      id: "the-showcase",
      type: "featuredProject",
      variant: "card",
      project: {
        kind: "external",
        name: "Showcase Project",
        shortDescription: "The legacy showcase description.",
        type: "tool",
        status: "released",
        url: "https://example.com/migrated",
      },
    },
  ]);

  it("uses the public two-column Showcase treatment with desktop editor chrome", () => {
    const html = renderToStaticMarkup(
      <EditorCanvas
        document={showcaseDocument}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={{ kind: "block", blockId: "the-showcase" }}
        callbacks={CANVAS_CALLBACKS}
        interactive
      />,
    );

    expect(html).toContain('data-member-layout="showcase"');
    expect(html).toContain('data-profile-showcase="true"');
    expect(html).toContain(
      "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]",
    );
    expect(html).toContain('data-featured-project-layout="showcase"');
    expect(html).toContain("Showcase");
    expect(html).toContain("Editing Featured project");
    expect(html.indexOf("HAM Friend")).toBeLessThan(html.indexOf("Showcase"));
    expect(html.indexOf("ART PENDING")).toBeLessThan(
      html.indexOf("Showcase Project"),
    );
  });

  it("removes editor wrappers in mobile Preview while keeping public reading order", () => {
    const html = renderToStaticMarkup(
      <EditorCanvas
        document={showcaseDocument}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={null}
        callbacks={CANVAS_CALLBACKS}
        interactive={false}
      />,
    );

    expect(html).toContain('data-profile-showcase="true"');
    expect(html).toContain('data-featured-project-layout="showcase"');
    expect(html).toContain("Showcase");
    expect(html).not.toContain("Edit profile header");
    expect(html).not.toContain("Edit Featured project");
    expect(html.indexOf("HAM Friend")).toBeLessThan(html.indexOf("Showcase"));
  });

  it("keeps the Showcase beside the profile once other blocks are added", () => {
    const document = docWith([
      ...showcaseDocument.blocks,
      callout("later-note"),
      callout("last-note"),
    ]);

    const html = renderToStaticMarkup(
      <EditorCanvas
        document={document}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={null}
        callbacks={CANVAS_CALLBACKS}
        interactive
      />,
    );

    // The project used to fall to the foot of the page the moment a second
    // block existed. The slot belongs to whatever is first instead.
    expect(html).toContain('data-profile-showcase="true"');
    expect(html).toContain('data-featured-project-layout="showcase"');
    expect(html.indexOf("Showcase")).toBeLessThan(html.indexOf("Text later-note"));

    // One list, so the document keeps one order and one set of positions:
    // `lg:contents` hands the items to the grid rather than splitting them
    // across two lists that drag-and-drop would have to reconcile.
    expect(html.match(/data-editor-block-list="true"/g)).toHaveLength(1);
    expect(html).toContain("lg:contents");
    expect(html).toContain("lg:col-start-2");
    expect(html).toContain("lg:col-span-2");
    expect(html).toContain("Edit Featured project, position 1 of 3");
    expect(html).toContain("Edit Callout or quote, position 3 of 3");
  });

  it("gives the Showcase slot up when another block is moved to the front", () => {
    const html = renderToStaticMarkup(
      <EditorCanvas
        document={docWith([callout("now-first"), ...showcaseDocument.blocks])}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={null}
        callbacks={CANVAS_CALLBACKS}
        interactive
      />,
    );

    expect(html).toContain('data-member-layout="blocks"');
    expect(html).not.toContain("data-profile-showcase");
    expect(html).toContain('data-featured-project-layout="standard"');
  });

  it("keeps a page that opens with anything else in normal block flow", () => {
    const html = renderToStaticMarkup(
      <EditorCanvas
        document={docWith([callout("first-note")])}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={null}
        callbacks={CANVAS_CALLBACKS}
        interactive={false}
      />,
    );

    expect(html).toContain('data-member-layout="blocks"');
    expect(html).not.toContain("data-profile-showcase");
    expect(html).toContain("Text first-note");
  });

  it("holds the showcase slot in every theme", () => {
    for (const definition of getEnabledMemberThemes()) {
      const theme = resolveEnabledThemeAccent(
        definition.id,
        definition.defaultAccentId,
      );
      if (!theme) throw new Error(`${definition.id}/default must remain enabled`);

      const html = renderToStaticMarkup(
        <EditorCanvas
          document={{
            ...showcaseDocument,
            frame: {
              ...showcaseDocument.frame,
              theme: { id: theme.themeId, accentId: theme.accentId },
            },
          }}
          theme={theme}
          assetMetadata={new Map()}
          selection={null}
          callbacks={CANVAS_CALLBACKS}
          interactive
        />,
      );

      // Switching theme used to drop the project to the foot of the canvas.
      expect(html).toContain('data-member-layout="showcase"');
      expect(html).toContain('data-profile-showcase="true"');
      expect(html).toContain('data-featured-project-layout="showcase"');
    }
  });
});

describe("mobile inspector sheet", () => {
  it("renders a keyboard-safe modal sheet with a 44px close control", () => {
    const html = renderToStaticMarkup(
      <MobileInspectorSheet
        title="Gallery settings"
        titleId="sheet-title"
        descriptionId="sheet-description"
        onClose={() => undefined}
      >
        <input aria-label="Caption" />
      </MobileInspectorSheet>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="sheet-title"');
    expect(html).toContain("100dvh");
    expect(html).toContain("overflow-x-hidden");
    expect(html).toContain("max-w-full");
    expect(html).toMatch(/<button[^>]*min-h-11/);
  });

  it("closes on Escape and traps forward Tab at the last control", () => {
    const first = focusedElement();
    const last = focusedElement();
    const querySelectorAll = vi.fn(() => [first, last]);
    const onClose = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    handleInspectorDialogKeyDown(
      {
        key: "Escape",
        shiftKey: false,
        target: last as unknown as EventTarget,
        preventDefault,
        stopPropagation,
      },
      { querySelectorAll } as never,
      onClose,
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();

    preventDefault.mockClear();
    handleInspectorDialogKeyDown(
      {
        key: "Tab",
        shiftKey: false,
        target: last as unknown as EventTarget,
        preventDefault,
        stopPropagation,
      },
      { querySelectorAll } as never,
      onClose,
    );
    expect(first.focus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("returns focus to the invoker or its rendered fallback", () => {
    const direct = focusedElement(true);
    const fallback = focusedElement(true);
    expect(focusInspectorReturnTarget(direct as never, fallback as never)).toBe(
      direct,
    );
    expect(direct.focus).toHaveBeenCalledOnce();

    const removed = focusedElement(false);
    expect(focusInspectorReturnTarget(removed as never, fallback as never)).toBe(
      fallback,
    );
    expect(fallback.focus).toHaveBeenCalledOnce();
  });
});

describe("publish validation focus", () => {
  it("maps the first invalid frame field to its inspector control", () => {
    const document = minimalMemberPageDocument();
    document.frame.displayName = "";
    const summary = summarizeEditorValidation(document);

    expect(summary.firstTarget).toEqual({ kind: "frame" });
    expect(summary.firstControlId).toBe("frame-display-name");
  });

  it("maps nested block errors and prefers that field when focusing", () => {
    const document = docWith([
      {
        id: "links",
        type: "additionalLinks",
        variant: "list",
        links: [{ id: "docs", label: "", url: "https://example.com", description: null }],
      },
    ]);
    const summary = summarizeEditorValidation(document);
    const preferred = focusedElement();
    const otherInvalid = focusedElement();

    expect(summary.firstTarget).toEqual({ kind: "block", blockId: "links" });
    expect(summary.firstControlId).toBe("block-links-link-docs-label");
    expect(
      controlIdForError(document, {
        path: ["blocks", 0, "links", 0, "label"],
        message: "Must be non-empty.",
      }),
    ).toBe("block-links-link-docs-label");

    const focused = focusFirstInvalidControl(
      { querySelectorAll: () => [otherInvalid] } as never,
      null,
      preferred as never,
    );
    expect(focused).toBe(preferred);
    expect(preferred.focus).toHaveBeenCalledOnce();
    expect(otherInvalid.focus).not.toHaveBeenCalled();
  });

  it("maps external project artwork errors to the image controls", () => {
    const document = docWith([
      {
        id: "featured",
        type: "featuredProject",
        variant: "card",
        project: {
          kind: "external",
          name: "Outside project",
          shortDescription: "Description",
          type: "game",
          status: "released",
          artwork: {
            assetId: "asset-project",
            alt: "Artwork description",
            decorative: false,
          },
        },
      },
    ]);

    expect(
      controlIdForError(document, {
        path: ["blocks", 0, "project", "artwork", "alt"],
        message: "Alternative text is required.",
      }),
    ).toBe("block-featured-project-artwork-alt");
    expect(
      controlIdForError(document, {
        path: ["blocks", 0, "project", "artwork", "assetId"],
        message: "Asset is unavailable.",
      }),
    ).toBe("block-featured-project-artwork-asset");
  });
});

describe("reduced motion and dependency isolation structure", () => {
  it("keeps dnd-kit in the lazy sortable module and removes sortable motion", async () => {
    const root = process.cwd();
    const [lazySource, sortableSource, shellSource] = await Promise.all([
      readFile(
        path.join(root, "src/components/member-page-editor/editor-canvas-lazy.tsx"),
        "utf8",
      ),
      readFile(
        path.join(root, "src/components/member-page-editor/sortable-editor-canvas.tsx"),
        "utf8",
      ),
      readFile(
        path.join(root, "src/components/member-page-editor/editor-shell.tsx"),
        "utf8",
      ),
    ]);

    expect(lazySource).toContain('import("./sortable-editor-canvas")');
    expect(lazySource).not.toContain("@dnd-kit/");
    expect(shellSource).not.toContain("@dnd-kit/");
    expect(sortableSource).toContain("PointerSensor");
    expect(sortableSource).toContain("KeyboardSensor");
    expect(sortableSource).toContain("sortableKeyboardCoordinates");
    expect(sortableSource).toContain("prefers-reduced-motion: reduce");
    expect(sortableSource).toContain("animateLayoutChanges");
    expect(sortableSource).toContain("autoScroll={!reducedMotion}");
  });
});

describe("canvas chrome", () => {
  it("reveals a block's controls on focus and selection, not on hover alone", async () => {
    const css = await readFile(
      path.join(
        process.cwd(),
        "src/components/member-page-editor/editor-canvas.module.css",
      ),
      "utf8",
    );

    // The strip is hidden by default only from the three-column breakpoint up.
    expect(css).toContain("@media (min-width: 80rem)");
    // It rests clear of the region rather than on top of it, and never wraps
    // into a second storey that would bury the preview it labels.
    expect(css).toContain("inset: -3.5rem 0 0 0");
    expect(css).toContain("flex-wrap: nowrap");
    // Keyboard users, the selected region, and an invalid region each reveal
    // it, so a control is never reachable while it is invisible.
    expect(css).toContain(":focus-within > .overlay > .toolbar");
    expect(css).toContain('[data-selected="true"] > .overlay > .toolbar');
    expect(css).toContain('[data-invalid="true"] > .overlay > .toolbar');
    // Hidden means inert: the strip must not swallow clicks meant for the page.
    expect(css).toMatch(/opacity:\s*0;\s*\n\s*pointer-events:\s*none;/);
    // It sticks so it stays in reach through a block that is screens tall.
    expect(css).toContain("position: sticky");
  });

  it("marks selection with an edge rule, not a ring drawn around the block", () => {
    const css = readFileSync(
      path.join(
        process.cwd(),
        "src/components/member-page-editor/editor-canvas.module.css",
      ),
      "utf8",
    );

    // A ring offset from the content collided with the neighbouring column in
    // the two-column profile-and-showcase layout and was cut off at the sheet
    // edge. The rule sits in the margin and reflows nothing.
    expect(css).not.toMatch(/outline-offset/);
    expect(css).toContain(".region::before");
    expect(css).toContain('.region[data-selected="true"]::before');
    expect(css).toContain('.region[data-invalid="true"]::before');
    // Never colour alone: hover is dashed, selection solid, and the strip
    // names the region in words.
    expect(css).toContain("linear-gradient");
  });

  it("keeps a block being dragged above every other block's controls", async () => {
    const [css, sortable] = await Promise.all([
      readFile(
        path.join(
          process.cwd(),
          "src/components/member-page-editor/editor-canvas.module.css",
        ),
        "utf8",
      ),
      readFile(
        path.join(
          process.cwd(),
          "src/components/member-page-editor/sortable-editor-canvas.tsx",
        ),
        "utf8",
      ),
    ]);

    // Each region's chrome stays in its own stacking context, so the strip of
    // a block the pointer passes over cannot paint on top of the block in hand.
    expect(css).toContain("isolation: isolate");
    expect(css).toMatch(/\[data-dragging="true"\]\s*\{[^}]*z-index: 10/);

    // Translate only. dnd-kit derives a scale from the sizes of the two blocks
    // trading places, and page blocks differ wildly: a one-line quote dropped
    // where a featured project stood was asked to grow several times its own
    // height, and burst across the page for the length of the settle.
    expect(sortable).toContain("CSS.Translate.toString(transform)");
    expect(sortable).not.toContain("CSS.Transform.toString");
  });

  it("drops the ordering controls on a page with nothing to reorder", () => {
    const single = renderToStaticMarkup(
      <EditorCanvas
        document={docWith([callout("only")])}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={null}
        callbacks={CANVAS_CALLBACKS}
        interactive
      />,
    );
    const pair = renderToStaticMarkup(
      <EditorCanvas
        document={docWith([callout("a"), callout("b")])}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={null}
        callbacks={CANVAS_CALLBACKS}
        interactive
      />,
    );

    // Three permanently disabled buttons are noise, and they are what pushed
    // the strip onto a second row over a narrow column.
    expect(single).not.toContain("Move up");
    expect(single).not.toContain("Move down");
    expect(single).toMatch(/aria-label="Duplicate Callout or quote"/);
    expect(single).toMatch(/aria-label="Delete Callout or quote"/);
    expect(pair).toContain("Move up");
    expect(pair).toContain("Move down");

    // Position stays in the accessible name of the control and in the
    // region label, so it is still announced without a visible chip.
    expect(single).toContain("position 1 of 1");
    expect(single).not.toMatch(/>\s*1 of 1\s*</);
  });

  it("keeps every block control in the markup regardless of the reveal", () => {
    const html = renderToStaticMarkup(
      <EditorCanvas
        document={docWith([callout("a"), callout("b")])}
        theme={resolvedTheme}
        assetMetadata={new Map()}
        selection={null}
        callbacks={CANVAS_CALLBACKS}
        interactive
      />,
    );

    expect(html).toContain("Edit Callout or quote");
    expect(html).toMatch(/aria-label="Move Callout or quote up"/);
    expect(html).toMatch(/aria-label="Move Callout or quote down"/);
    expect(html).toMatch(/aria-label="Duplicate Callout or quote"/);
    expect(html).toMatch(/aria-label="Delete Callout or quote"/);
  });
});

describe("block outline", () => {
  it("names each block by type and by something from its own content", () => {
    expect(blockOutlineSummary(callout("a"))).toBe("Text a");
    expect(
      blockOutlineSummary({
        id: "links",
        type: "additionalLinks",
        variant: "list",
        links: [
          { id: "a", label: "Newsletter", url: "https://example.com", description: null },
          { id: "b", label: "Shop", url: "https://example.com/shop", description: null },
        ],
      }),
    ).toBe("Newsletter, Shop");
    expect(
      blockOutlineSummary({
        id: "list",
        type: "projectList",
        variant: "stacked",
        projects: [
          { id: "one", project: externalProject() },
        ],
      }),
    ).toBe("1 project");
    // Two blocks of one type stay distinguishable in the rail.
    expect(blockOutlineSummary(callout("a"))).not.toBe(
      blockOutlineSummary(callout("b")),
    );
  });
});
