import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AutosaveSnapshot } from "@/components/member-page-editor/autosave-controller";
import { AUTOSAVE_STATUS_TEXT } from "@/components/member-page-editor/autosave-controller";
import {
  discardLocalVersionAndReload,
  EditorNoticeStrip,
  EditorTopBar,
  memberPageEditorPath,
  PUBLISH_CONTROL_ID,
} from "@/components/member-page-editor/editor-topbar";
import type { useMemberPageEditor } from "@/components/member-page-editor/use-member-page-editor";

type Editor = ReturnType<typeof useMemberPageEditor>;

function autosave(
  state: AutosaveSnapshot["state"],
  overrides: Partial<AutosaveSnapshot> = {},
): AutosaveSnapshot {
  return {
    state,
    statusText: AUTOSAVE_STATUS_TEXT[state],
    draftRev: 4,
    hasPendingWork: false,
    shouldWarnBeforeUnload: state !== "saved",
    canRetry: state === "failed",
    invalidMessage: null,
    fieldErrors: {},
    ...overrides,
  };
}

function editorWith(
  status: AutosaveSnapshot,
  overrides: Partial<Editor> = {},
): Editor {
  return {
    slug: "hamfriend",
    status,
    busy: null,
    isPublished: false,
    hasPublishedSnapshot: false,
    moderationHold: false,
    publicationMessage: null,
    ...overrides,
  } as unknown as Editor;
}

const TOPBAR_PROPS = {
  slug: "hamfriend",
  mode: "edit" as const,
  publishErrors: [] as readonly string[],
  onModeChange: () => undefined,
  onPublish: () => undefined,
  onReset: () => undefined,
};

function renderTopBar(editor: Editor): string {
  return renderToStaticMarkup(<EditorTopBar {...TOPBAR_PROPS} editor={editor} />);
}

function renderNotices(editor: Editor): string {
  return renderToStaticMarkup(
    <EditorNoticeStrip
      editor={editor}
      publishErrors={[]}
      onFocusFirstError={() => undefined}
    />,
  );
}

function openDraftLink(notices: string): string {
  return notices.match(/<a[^>]*>Open latest draft in a new tab<\/a>/u)?.[0] ?? "";
}

describe("conflict recovery copy", () => {
  it("says the local version stays visible but is not saved", () => {
    const notices = renderNotices(editorWith(autosave("conflict")));

    expect(notices).toContain("Saving stopped to protect both versions");
    expect(notices).toContain("still on screen");
    expect(notices).toContain("not saved");
    // The old copy sent people straight to the destructive reload.
    expect(notices).not.toContain("Reload the editor to pick up");
  });

  it("offers the safe action before naming the destructive one", () => {
    const notices = renderNotices(editorWith(autosave("conflict")));

    expect(openDraftLink(notices)).not.toBe("");
    expect(notices.indexOf("Open latest draft in a new tab")).toBeLessThan(
      notices.indexOf("Discard this local version and reload"),
    );
  });
});

describe("open latest draft in a new tab", () => {
  it("opens the current editor URL in a tab that cannot reach back", () => {
    expect(memberPageEditorPath("hamfriend")).toBe("/m/hamfriend?edit=1");

    const link = openDraftLink(
      renderNotices(editorWith(autosave("conflict"))),
    );

    expect(link).toContain('href="/m/hamfriend?edit=1"');
    // A new tab, and opener isolation: the recovered editor must never be
    // able to script the stranded tab that opened it.
    expect(link).toContain('target="_blank"');
    expect(link).toMatch(/rel="[^"]*\bnoopener\b[^"]*"/u);
    expect(link).toMatch(/rel="[^"]*\bnoreferrer\b[^"]*"/u);
  });

  it("keeps the safe action a real link with keyboard reach and a visible focus ring", () => {
    const link = openDraftLink(
      renderNotices(editorWith(autosave("conflict"))),
    );

    // Shared quiet-control chrome: 44px target, platform focus ring.
    expect(link).toContain("min-h-11");
    expect(link).toContain("focus-visible:outline-interactive-blue");
  });

  it("navigates only by the owner's click on the link", async () => {
    const source = await readFile(
      path.join(
        process.cwd(),
        "src/components/member-page-editor/editor-topbar.tsx",
      ),
      "utf8",
    );

    // No scripted opens, no silent navigation, and no draft content parked
    // outside React memory.
    expect(source).not.toMatch(/window\.open|localStorage|sessionStorage|clipboard/u);
  });
});

describe("discard this local version and reload", () => {
  it("reloads through the explicit destructive control", () => {
    const location = { reload: vi.fn() };
    discardLocalVersionAndReload(location);
    expect(location.reload).toHaveBeenCalledOnce();
  });

  it("names the loss in the control itself, replacing the bare reload", () => {
    const bar = renderTopBar(editorWith(autosave("conflict")));

    expect(bar).toContain("Discard this local version and reload");
    expect(bar).not.toContain("Reload editor");
    // The conflict notice is where the safe action lives; the bar keeps only
    // the destructive escape hatch.
    expect(bar).not.toContain("Open latest draft in a new tab");
  });
});

describe("conflict invariants the recovery relies on", () => {
  it("keeps publish blocked while the conflict stands", () => {
    const bar = renderTopBar(editorWith(autosave("conflict")));
    const publish = bar.match(
      new RegExp(`<button id="${PUBLISH_CONTROL_ID}"[^>]*>`, "u"),
    )?.[0];

    expect(publish).toBeDefined();
    expect(publish).toMatch(/\bdisabled/u);
  });

  it("leaves the bar and notices untouched outside a conflict", () => {
    const savedEditor = editorWith(autosave("saved"));

    expect(renderNotices(savedEditor)).toBe("");
    expect(renderTopBar(savedEditor)).not.toContain(
      "Discard this local version",
    );
    expect(renderTopBar(savedEditor)).not.toContain("Open latest draft");
  });
});
