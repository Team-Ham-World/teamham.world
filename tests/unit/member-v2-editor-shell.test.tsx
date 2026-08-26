import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AddBlockPanel } from "@/components/member-page-editor/add-block-panel";
import {
  DesktopMemberPageEditor,
  EditorScreenRequirement,
  EditorInspectorEmptyState,
  MemberPageEditor,
} from "@/components/member-page-editor/editor-shell";
import { DESKTOP_EDITOR_MEDIA_QUERY } from "@/components/member-page-editor/use-editor-layout";
import type { MemberEditorActions } from "@/components/member-page-editor/use-member-page-editor";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import { resolveEnabledThemeAccent } from "@/lib/members/v2/themes";

import {
  canonicalMemberPageDocument,
  minimalMemberPageDocument,
} from "../fixtures/member-v2/documents";

const resolved = resolveEnabledThemeAccent("paper", "default");
if (!resolved) throw new Error("paper/default must be enabled for this test");
const THEME = resolved;

const ACTIONS: MemberEditorActions = {
  autosave: vi.fn(async () => ({
    status: "saved",
    message: "Saved.",
    fieldErrors: {},
    draftRev: 2,
    draftUpdatedAt: "2026-08-25T00:00:00.000Z",
  }) as const),
  publish: vi.fn(async () => ({
    status: "published",
    message: "Published.",
    fieldErrors: {},
    slug: "hamfriend",
    draftRev: 2,
    publishedAt: "2026-08-25T00:00:00.000Z",
  }) as const),
  unpublish: vi.fn(async () => ({
    status: "unpublished",
    message: "Unpublished.",
    fieldErrors: {},
    slug: "hamfriend",
    unpublishedAt: "2026-08-25T00:00:00.000Z",
  }) as const),
  reset: vi.fn(async () => ({
    status: "reset",
    message: "Draft reset.",
    fieldErrors: {},
    document: minimalMemberPageDocument(),
    draftRev: 2,
    draftUpdatedAt: "2026-08-25T00:00:00.000Z",
  }) as const),
};

function renderEditor(
  document: MemberPageDocumentV2,
  overrides: {
    isPublished?: boolean;
    moderationHold?: boolean;
    hasPublishedSnapshot?: boolean;
  } = {},
) {
  return renderToStaticMarkup(
    <DesktopMemberPageEditor
      slug="hamfriend"
      initialDocument={document}
      initialDraftRev={1}
      initialIsPublished={overrides.isPublished ?? false}
      initialModerationHold={overrides.moderationHold ?? false}
      initialHasPublishedSnapshot={overrides.hasPublishedSnapshot ?? false}
      theme={THEME}
      assetMetadata={new Map()}
      actions={ACTIONS}
    />,
  );
}

describe("editor shell layout", () => {
  it("fails closed before mounting the editor on an unconfirmed viewport", () => {
    const html = renderToStaticMarkup(
      <MemberPageEditor
        slug="hamfriend"
        initialDocument={minimalMemberPageDocument()}
        initialDraftRev={1}
        initialIsPublished={false}
        initialModerationHold={false}
        initialHasPublishedSnapshot={false}
        theme={THEME}
        assetMetadata={new Map()}
        actions={ACTIONS}
      />,
    );

    expect(DESKTOP_EDITOR_MEDIA_QUERY).toBe(
      "(min-width: 80rem) and (hover: hover) and (pointer: fine)",
    );
    expect(html).toContain('data-editor-unavailable="small-screen"');
    expect(html).toContain("Make room to edit.");
    expect(html).toContain("at least 1280 pixels wide");
    expect(html).toContain("with a mouse or trackpad");
    expect(html).toContain('href="/m/hamfriend"');
    expect(html).not.toContain('data-editor-workspace="app-shell"');
    expect(html).not.toContain('data-editor-canvas="true"');
    expect(html).not.toContain('id="member-page-publish"');
  });

  it("gives the small-screen notice an accessible escape to the public page", () => {
    const html = renderToStaticMarkup(
      <EditorScreenRequirement slug="hamfriend" />,
    );

    expect(html).toContain('aria-labelledby="editor-screen-requirement-title"');
    expect(html).toContain('id="editor-screen-requirement-title"');
    expect(html).toContain("Your page and saved draft are unchanged.");
    expect(html).toContain("View your page");
    expect(html).not.toContain("xl:hidden");
  });

  it("shows the page as it will look, with the frame and body fields beside it", () => {
    const html = renderEditor(canonicalMemberPageDocument());

    // The canvas renders the real page content, not a form-only stand-in.
    expect(html).toContain("HAM Friend");
    expect(html).toContain("Makes tiny games and useful tools.");
    // The frame inspector is the default panel.
    expect(html).toContain("Display name");
    expect(html).toContain("Short introduction");
  });

  it("derives the live canvas palette from the current private draft IDs", () => {
    const document = minimalMemberPageDocument();
    document.frame.theme = { id: "riso", accentId: "soy-red" };

    // renderEditor deliberately receives the Paper prop constant. The canvas
    // must still resolve the mutable draft IDs after a theme edit.
    const html = renderEditor(document);

    expect(html).toContain('data-member-theme-surface="true"');
    expect(html).toContain('data-theme-id="riso"');
    expect(html).toContain('data-accent-id="soy-red"');
    expect(html).toContain("--member-paper:#f6eedf");
  });

  it("dresses the whole sheet in the theme and leaves the workbench alone", () => {
    const document = minimalMemberPageDocument();
    document.frame.theme = { id: "blueprint", accentId: "technical-blue" };

    const html = renderEditor(document);
    const sheet = html.match(/<div[^>]*data-editor-sheet="true"[^>]*>/u)?.[0];

    // The sheet is the member's page, so the sheet is what wears the theme:
    // stock, texture, rule and shadow to its own edge. Painting it further in
    // left a coloured rectangle floating on HAM paper with a bare margin.
    expect(sheet).toBeDefined();
    expect(sheet).toContain('data-theme-scope="panel"');
    expect(sheet).toContain('data-theme-id="blueprint"');
    expect(sheet).toContain("--member-paper:#edf5f3");
    // The sheet's own stock comes from the panel scope, so no utility is left
    // painting HAM paper over it.
    expect(sheet).not.toMatch(/\bbg-paper\b/u);

    // Page scope is what hands the palette to the body. A workbench that
    // claimed it would repaint its own rail, bar and inspector too.
    expect(html).not.toContain('data-theme-scope="page"');
  });

  it("offers an Edit and Preview switch at every width", () => {
    const html = renderEditor(minimalMemberPageDocument());
    const modeButtons = html.match(
      /<button id="member-page-mode-(?:edit|preview)"[^>]*>/g,
    );

    expect(html).toContain(">Edit<");
    expect(html).toContain(">Preview<");
    // Both are real buttons in one group, so the state is announced.
    expect(html).toContain('role="group"');
    expect(html).toMatch(/aria-pressed="(true|false)"/);
    expect(modeButtons).toHaveLength(2);
    // Preview used to exist only under the mobile mode bar, which left wide
    // screens with no way to see the page without editor chrome over it.
    expect(html).not.toContain('aria-label="Editor mode" class="xl:hidden"');
    for (const button of modeButtons ?? []) {
      // State-driven variants avoid utility ordering turning either selected
      // mode into light text on a light surface. The same readable inversion
      // and selected hover treatment applies to Edit and Preview.
      expect(button).toContain("aria-pressed:bg-ink");
      expect(button).toContain("aria-pressed:text-paper");
      expect(button).toContain("aria-pressed:hover:bg-interactive-blue");
      expect(button).toContain("focus-visible:outline-interactive-blue");
    }
  });

  it("lays the editor out as a three-region workbench, not a page section", () => {
    const html = renderEditor(minimalMemberPageDocument());

    // A bar, a tool rail, the canvas, and the inspector. Each side region is
    // its own scrolling pane from `xl` up, so nothing that matters scrolls
    // away with a page that runs to dozens of screens.
    expect(DESKTOP_EDITOR_MEDIA_QUERY).toBe(
      "(min-width: 80rem) and (hover: hover) and (pointer: fine)",
    );
    expect(html).toContain('data-editor-workspace="app-shell"');
    expect(html).toContain('data-editor-rail="true"');
    expect(html).toContain('data-editor-canvas="true"');
    expect(html).toContain('data-editor-inspector="true"');
    expect(html).toContain("xl:h-[calc(100dvh-var(--nav-height))]");
    expect(html).toContain("xl:overflow-hidden");
    expect(html).toContain("xl:overflow-y-auto");

    // Reading order matches the visual order: tools, page, then fields.
    expect(html.indexOf('data-editor-rail="true"')).toBeLessThan(
      html.indexOf('data-editor-canvas="true"'),
    );
    expect(html.indexOf('data-editor-canvas="true"')).toBeLessThan(
      html.indexOf('data-editor-inspector="true"'),
    );

    // The old layout broke out of the reading column with a viewport-width
    // translate, which is what forced the defensive clipping around it.
    expect(html).not.toContain("xl:w-[calc(100vw-4rem)]");
    expect(html).not.toContain("xl:-translate-x-1/2");
  });

  it("keeps the page's structure and its images one keystroke apart", () => {
    const html = renderEditor(canonicalMemberPageDocument());

    // Both rail panels are tabs of one region. Images used to sit a full
    // page-length below the canvas until 1536px, where nobody would find them.
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="member-page-rail-tab-outline"');
    expect(html).toContain('id="member-page-rail-tab-images"');
    expect(html).toMatch(/role="tabpanel"/);
    expect(html).toContain('data-editor-outline="true"');

    // The outline names every block in document order.
    expect(html).toContain("Profile header");
    expect(html).toContain("Rich text");
    expect(html).toContain("Featured project");
    expect(html).toContain("Add a block");
  });

  it("takes the viewport back from the site header while editing", async () => {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const css = await readFile(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const html = renderEditor(minimalMemberPageDocument());

    // The editor's own bar already carries the page identity and the way out,
    // so the site header above it is a second, redundant row. Both halves key
    // off the same attribute: where `:has()` is unavailable neither applies,
    // and the header and the height reserved for it stay in agreement.
    expect(html).toContain('data-editor-workspace="app-shell"');
    expect(css).toContain(
      'body:has([data-editor-workspace="app-shell"]) > header',
    );
    expect(css).toMatch(
      /body:has\(\[data-editor-workspace="app-shell"\]\) \{\s*\n\s*--nav-height: 0px;/,
    );
    // The way back out lives in the editor bar instead.
    expect(html).toContain("Done editing");
  });

  it("shows an explicit empty inspector instead of profile fields with no selection", () => {
    const html = renderToStaticMarkup(
      <EditorInspectorEmptyState onSelectFrame={() => undefined} />,
    );

    expect(html).toContain("Pick a block on your page to change it");
    expect(html).toContain("Edit profile header");
    expect(html).not.toContain("Display name");
    expect(html).not.toContain("Short introduction");
  });
});

describe("editor accessibility", () => {
  it("announces changes politely rather than interrupting", () => {
    const html = renderEditor(canonicalMemberPageDocument());

    const politeRegions = html.match(/aria-live="polite"/g) ?? [];
    expect(politeRegions.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('aria-live="assertive"');
  });

  it("gives every control a comfortable touch target", () => {
    const html = renderEditor(canonicalMemberPageDocument());

    // Buttons and inputs all carry the shared min-h-11 (44px) sizing.
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button, button).toMatch(/min-h-11/);
    }
  });

  it("labels each block's controls with the block it acts on", () => {
    const html = renderEditor(canonicalMemberPageDocument());

    expect(html).toMatch(/aria-label="[^"]*Move [^"]*up[^"]*"/i);
    expect(html).toMatch(/aria-label="[^"]*Move [^"]*down[^"]*"/i);
    expect(html).toMatch(/aria-label="[^"]*Duplicate[^"]*"/i);
    expect(html).toMatch(/aria-label="[^"]*Delete[^"]*"/i);
  });

  it("marks the selected block with more than a colour", () => {
    const html = renderEditor(canonicalMemberPageDocument());

    // Selection state is exposed to assistive tech, not implied by a tint.
    expect(html).toMatch(/aria-(current|pressed)="/);
  });
});

describe("publication controls", () => {
  it("starts out saved and private", () => {
    const html = renderEditor(minimalMemberPageDocument());

    expect(html).toContain('data-autosave-state="saved"');
    expect(html).toContain("This page is private to you.");
    expect(html).toContain(">Publish<");
  });

  it("offers Unpublish once the page is live", () => {
    const html = renderEditor(minimalMemberPageDocument(), {
      isPublished: true,
      hasPublishedSnapshot: true,
    });

    expect(html).toContain("This page is live.");
    expect(html).toContain(">Unpublish<");
    expect(html).toContain(">Reset to live<");
  });

  it("explains a hold in plain words and still allows a reset", () => {
    const html = renderEditor(minimalMemberPageDocument(), {
      moderationHold: true,
      hasPublishedSnapshot: true,
    });

    expect(html).toContain("An administrator placed this page on hold");
    expect(html).toContain(">Reset to live<");
    // Publish is present but not usable.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Publish<\/button>/);
  });
});

describe("typed editor controls", () => {
  it("still draws existing rich text in the canvas", () => {
    const html = renderEditor(canonicalMemberPageDocument());

    // The saved prose stays visible before its lazy editor is selected.
    expect(html).toContain("About");
  });

  it("offers portrait controls without inserting an incomplete reference", () => {
    const html = renderEditor(canonicalMemberPageDocument());

    expect(html).toContain("Portrait");
    expect(html).toContain("Remove portrait from page");
    expect(html).toContain("Only verified, ready images can be placed on the page");
  });

  it("offers only the block types that can be created today", () => {
    // The add flow now opens in the inspector rather than sitting open at the
    // bottom of the canvas, so the menu is rendered on its own here.
    const html = renderToStaticMarkup(
      <AddBlockPanel
        canAddBlock
        canAddFeaturedProject
        blockCount={0}
        maxBlocks={12}
        nextId={() => "id"}
        assets={[]}
        onAdd={() => undefined}
      />,
    );

    expect(html).toContain("Add Featured project");
    expect(html).toContain("Add Project list");
    expect(html).toContain("Add Additional links");
    expect(html).toContain("Add Callout or quote");
    expect(html).toContain("Add Rich text");
    expect(html).toContain("Add Image");
    expect(html).toContain("Add Gallery");
  });

  it("shows the ready-only asset library and its quota", () => {
    const html = renderEditor(minimalMemberPageDocument());

    expect(html).toContain("Asset library");
    expect(html).toContain("0 / 20 ready");
    expect(html).toContain("Upload an image");
    expect(html).toContain("Refresh library");
  });
});
