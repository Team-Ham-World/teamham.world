import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DesktopMemberPageEditor, EditorScreenRequirement, MemberPageEditor } from "@/components/member-page-editor/editor-shell";
import * as editorLayout from "@/components/member-page-editor/use-editor-layout";
import type { MemberEditorActions } from "@/components/member-page-editor/use-member-page-editor";
import { resolveEnabledThemeAccent } from "@/lib/members/v2/themes";

import { minimalMemberPageDocument } from "../fixtures/member-v2/documents";

/**
 * The responsive inspector model, as capability thresholds instead of one
 * contradictory query:
 *
 * - `EDITOR_MINIMUM_MEDIA_QUERY` — the least a browser needs to edit at all:
 *   64rem with hover and a fine pointer. It mounts the compact workbench,
 *   whose rail and inspector are bottom sheets.
 * - `DESKTOP_EDITOR_MEDIA_QUERY` — the least the full three-column workbench
 *   needs: 80rem with hover and a fine pointer.
 *
 * Between the two thresholds the editor must mount AND use sheets. Below the
 * minimum, and on coarse-pointer or touch-only devices, nothing mounts.
 */

// Optional property so the model test fails with a clear assertion (rather
// than a broken import) while the capability threshold does not yet exist.
const EDITOR_MINIMUM_MEDIA_QUERY = (
  editorLayout as { EDITOR_MINIMUM_MEDIA_QUERY?: string }
).EDITOR_MINIMUM_MEDIA_QUERY;

function minWidthRem(query: string): number {
  const match = /min-width:\s*([\d.]+)rem/u.exec(query);
  if (!match) throw new Error(`Query has no rem min-width: ${String(query)}`);
  return Number(match[1]);
}

const resolved = resolveEnabledThemeAccent("paper", "default");
if (!resolved) throw new Error("paper/default must be enabled for this test");

const ACTIONS: MemberEditorActions = {
  autosave: vi.fn(async () => ({
    status: "saved",
    message: "Saved.",
    fieldErrors: {},
    draftRev: 2,
    draftUpdatedAt: "2026-08-27T00:00:00.000Z",
  }) as const),
  publish: vi.fn(async () => ({
    status: "published",
    message: "Published.",
    fieldErrors: {},
    slug: "hamfriend",
    draftRev: 2,
    publishedAt: "2026-08-27T00:00:00.000Z",
  }) as const),
  unpublish: vi.fn(async () => ({
    status: "unpublished",
    message: "Unpublished.",
    fieldErrors: {},
    slug: "hamfriend",
    unpublishedAt: "2026-08-27T00:00:00.000Z",
  }) as const),
  reset: vi.fn(async () => ({
    status: "reset",
    message: "Draft reset.",
    fieldErrors: {},
    document: minimalMemberPageDocument(),
    draftRev: 2,
    draftUpdatedAt: "2026-08-27T00:00:00.000Z",
  }) as const),
};

const EDITOR_PROPS = {
  slug: "hamfriend",
  initialDocument: minimalMemberPageDocument(),
  initialDraftRev: 1,
  initialIsPublished: false,
  initialModerationHold: false,
  initialHasPublishedSnapshot: false,
  theme: resolved,
  assetMetadata: new Map(),
  actions: ACTIONS,
};

describe("responsive inspector breakpoint model", () => {
  it("mounts compact hover-and-fine-pointer browsers from 64rem", () => {
    expect(EDITOR_MINIMUM_MEDIA_QUERY).toBe(
      "(min-width: 64rem) and (hover: hover) and (pointer: fine)",
    );
  });

  it("keeps the three-column workbench gate at 80rem", () => {
    expect(editorLayout.DESKTOP_EDITOR_MEDIA_QUERY).toBe(
      "(min-width: 80rem) and (hover: hover) and (pointer: fine)",
    );
  });

  it("leaves a reachable compact band between mounting and the workbench", () => {
    const minimum = minWidthRem(EDITOR_MINIMUM_MEDIA_QUERY ?? "");
    const workbench = minWidthRem(editorLayout.DESKTOP_EDITOR_MEDIA_QUERY);

    expect(minimum).toBe(64);
    expect(workbench).toBe(80);
    // The contradiction this suite exists to prevent: the sheet-based
    // workbench is only real if some width mounts the editor without
    // granting the three-column layout.
    expect(minimum).toBeLessThan(workbench);
  });

  it("requires hover and a fine pointer at both thresholds", () => {
    for (const query of [
      EDITOR_MINIMUM_MEDIA_QUERY,
      editorLayout.DESKTOP_EDITOR_MEDIA_QUERY,
    ]) {
      expect(query).toContain("(hover: hover)");
      expect(query).toContain("(pointer: fine)");
    }
  });

  it("hides the fail-closed notice under the same query that mounts the editor", async () => {
    const css = await readFile(
      path.join(
        process.cwd(),
        "src/components/member-page-editor/editor-availability.module.css",
      ),
      "utf8",
    );

    expect(css).toContain(
      "@media (min-width: 64rem) and (hover: hover) and (pointer: fine)",
    );
    expect(css).not.toContain("min-width: 80rem");
  });
});

describe("unsupported-device fail-closed notice", () => {
  it("states the real minimum width, input requirement, and no phone support", () => {
    const html = renderToStaticMarkup(<EditorScreenRequirement slug="hamfriend" />);

    expect(html).toContain("at least 1024 pixels wide");
    expect(html).toContain("mouse or trackpad");
    expect(html).toContain("Phones and tablets are not supported");
    // The old copy demanded 1280px for everything, which the compact
    // workbench no longer does.
    expect(html).not.toContain("1280");
  });

  it("fails closed on the server and never starts autosave there", () => {
    const html = renderToStaticMarkup(<MemberPageEditor {...EDITOR_PROPS} />);

    expect(html).toContain('data-editor-unavailable="small-screen"');
    expect(html).not.toContain("data-autosave-state");
  });
});

describe("inspector field identity", () => {
  it("renders exactly one copy of each field id in the pinned desktop inspect", () => {
    const html = renderToStaticMarkup(
      <DesktopMemberPageEditor {...EDITOR_PROPS} />,
    );

    // Duplicate inspector field ids would silently break label targets and
    // focus scheduling. The sheet branch and the pinned inspector must never
    // both render the same fields.
    expect(html.match(/id="frame-display-name"/gu)).toHaveLength(1);
  });
});
