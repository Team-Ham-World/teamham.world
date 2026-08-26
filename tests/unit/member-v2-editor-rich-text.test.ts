import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildRichTextBlock } from "@/components/member-page-editor/block-catalog";
import { summarizeTransientRichTextValidation } from "@/components/member-page-editor/editor-shell";
import {
  canonicalRichTextToTipTapJson,
  evaluateTipTapEdit,
  normalizeRichTextHttpsLink,
  tipTapJsonToCanonical,
} from "@/components/member-page-editor/rich-text-adapter";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";

import {
  minimalMemberPageDocument,
  richTextFixture,
} from "../fixtures/member-v2/documents";

const EDITOR_DIR = path.join(
  process.cwd(),
  "src",
  "components",
  "member-page-editor",
);

async function editorSource(file: string): Promise<string> {
  return readFile(path.join(EDITOR_DIR, file), "utf8");
}

describe("TipTap to canonical rich-text adapter", () => {
  it("keeps every allowed node and mark while removing editor-only attributes", () => {
    const result = tipTapJsonToCanonical({
      type: "doc",
      attrs: null,
      content: [
        {
          type: "heading",
          attrs: { level: 2, textAlign: null },
          content: [{ type: "text", text: "Heading" }],
        },
        {
          type: "paragraph",
          attrs: { editorDecoration: null },
          content: [
            {
              type: "text",
              text: "Linked",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: "  https://example.com/path  ",
                    target: null,
                    rel: "noopener noreferrer",
                    class: null,
                  },
                },
                { type: "italic", attrs: null },
                { type: "bold", attrs: null },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          attrs: null,
          content: [
            {
              type: "listItem",
              attrs: { color: null },
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Bullet" }],
                },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 1, type: null },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Number" }],
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
              content: [{ type: "text", text: "Quote" }],
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "text", text: "Smaller heading" }],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.doc.content[1]).toEqual({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Linked",
          marks: [
            { type: "bold" },
            { type: "italic" },
            { type: "link", attrs: { href: "https://example.com/path" } },
          ],
        },
      ],
    });
    expect(result.doc.content[3]).toEqual({
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Number" }],
            },
          ],
        },
      ],
    });
  });

  it.each([
    ["H1", { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "No" }] }],
    ["inline code", { type: "paragraph", content: [{ type: "text", text: "No", marks: [{ type: "code" }] }] }],
    ["code block", { type: "codeBlock", content: [{ type: "text", text: "No" }] }],
    ["table", { type: "table", content: [] }],
    ["embed", { type: "iframe", attrs: { src: "https://example.com" } }],
    ["raw HTML", { type: "html", attrs: { html: "<script>no</script>" } }],
    ["image", { type: "image", attrs: { src: "https://example.com/a.png" } }],
    ["hard break", { type: "hardBreak" }],
    ["horizontal rule", { type: "horizontalRule" }],
  ])("rejects %s so it cannot persist", (_label, node) => {
    expect(tipTapJsonToCanonical({ type: "doc", content: [node] }).success).toBe(
      false,
    );
  });

  it.each(["strike", "underline", "code"])(
    "rejects the %s mark",
    (mark) => {
      const result = tipTapJsonToCanonical({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "No", marks: [{ type: mark }] },
            ],
          },
        ],
      });
      expect(result.success).toBe(false);
    },
  );

  it("rejects unsupported non-null node and mark attributes", () => {
    expect(
      tipTapJsonToCanonical({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { textAlign: "center" },
            content: [{ type: "text", text: "No" }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      tipTapJsonToCanonical({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "No",
                marks: [{ type: "bold", attrs: { color: "red" } }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      tipTapJsonToCanonical({
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 5 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Five" }],
                  },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("uses the shared HTTPS-only, credential-free link rule", () => {
    expect(normalizeRichTextHttpsLink(" https://example.com/a ")).toBe(
      "https://example.com/a",
    );
    for (const value of [
      "http://example.com",
      "https://user@example.com",
      "https://user:password@example.com",
      "/relative",
      "javascript:alert(1)",
    ]) {
      expect(normalizeRichTextHttpsLink(value), value).toBeNull();
    }
  });

  it("rejects empty editor content and validates canonical content on the return trip", () => {
    expect(
      tipTapJsonToCanonical({
        type: "doc",
        content: [{ type: "paragraph" }],
      }).success,
    ).toBe(false);
    expect(canonicalRichTextToTipTapJson(richTextFixture())).toEqual(
      richTextFixture(),
    );
    expect(() =>
      canonicalRichTextToTipTapJson({ type: "doc", content: [] }),
    ).toThrow(/invalid canonical rich text/i);
  });

  it("keeps an empty TipTap edit transient, blocks publish, and clears on correction", () => {
    const editorJson = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
    const empty = evaluateTipTapEdit(editorJson);
    expect(empty).toMatchObject({
      status: "invalid",
      message: "Add some text before this block can save.",
    });
    if (empty.status !== "invalid") return;

    const document = {
      ...minimalMemberPageDocument(),
      blocks: [
        {
          id: "rich",
          type: "richText" as const,
          content: richTextFixture(),
        },
      ],
    };
    const blocked = summarizeTransientRichTextValidation(document, {
      rich: { editorJson: empty.editorJson, message: empty.message },
    });
    expect(blocked).toMatchObject({
      messages: [
        "Rich text, block 1: Add some text before this block can save.",
      ],
      firstTarget: { kind: "block", blockId: "rich" },
      firstControlId: "block-rich-rich-text",
    });

    const corrected = evaluateTipTapEdit(richTextFixture());
    expect(corrected).toEqual({ status: "valid", doc: richTextFixture() });
    expect(summarizeTransientRichTextValidation(document, {})).toMatchObject({
      messages: [],
      firstTarget: null,
    });
  });
});

describe("rich-text block creation", () => {
  it("builds a valid block only from valid non-empty canonical content", () => {
    const block = buildRichTextBlock(richTextFixture(), () => "rich-new");
    const document = {
      ...minimalMemberPageDocument(),
      blocks: [block],
    };

    expect(block.id).toBe("rich-new");
    expect(parseMemberPageDocumentV2(document).success).toBe(true);
  });
});

describe("rich-text lazy loading and accessible controls", () => {
  it("keeps every TipTap import inside the dynamically loaded editor module", async () => {
    const files = [
      "add-block-panel.tsx",
      "block-inspector.tsx",
      "editor-shell.tsx",
      "rich-text-adapter.ts",
      "rich-text-editor-lazy.tsx",
      "rich-text-tiptap-editor.tsx",
    ];

    for (const file of files) {
      const source = await editorSource(file);
      if (file === "rich-text-tiptap-editor.tsx") {
        expect(source).toMatch(/from "@tiptap\//);
      } else {
        expect(source, file).not.toMatch(/from "@tiptap\//);
      }
    }

    const lazySource = await editorSource("rich-text-editor-lazy.tsx");
    expect(lazySource).toContain('import("./rich-text-tiptap-editor")');
    expect(lazySource).toContain("ssr: false");
  });

  it("uses the hydration-safe setting and disables unsupported StarterKit output", async () => {
    const source = await editorSource("rich-text-tiptap-editor.tsx");

    expect(source).toContain("immediatelyRender: false");
    for (const option of [
      "code: false",
      "codeBlock: false",
      "hardBreak: false",
      "horizontalRule: false",
      "strike: false",
      "underline: false",
      "link: false",
    ]) {
      expect(source, option).toContain(option);
    }
    expect(source).toContain("heading: { levels: [2, 3] }");
  });

  it("clears transient rich-text and add-block drafts only after reset succeeds", async () => {
    const [shell, topBar] = await Promise.all([
      editorSource("editor-shell.tsx"),
      editorSource("editor-topbar.tsx"),
    ]);

    expect(shell).toContain('if (result.status !== "reset") return;');
    expect(shell).toContain("setRichTextTransients({});");
    expect(shell).toContain("key={resetSequence}");
    // Reset lives in the persistent bar now, and stays unavailable while any
    // publication action is in flight.
    expect(topBar).toMatch(
      /disabled=\{editor\.busy !== null\}\s*\n\s*onClick=\{onReset\}/,
    );
  });

  it("loads only from rich-text selection/add states and exposes usable toolbar semantics", async () => {
    const [inspector, addPanel, editor] = await Promise.all([
      editorSource("block-inspector.tsx"),
      editorSource("add-block-panel.tsx"),
      editorSource("rich-text-tiptap-editor.tsx"),
    ]);

    expect(inspector).toContain('block.type === "richText"');
    expect(inspector).toContain("<RichTextEditorLazy");
    expect(addPanel).toContain('draft.kind === "richText"');
    expect(addPanel).toContain("content: null");
    expect(addPanel).toContain("<RichTextEditorLazy");
    expect(editor).toContain('role="toolbar"');
    expect(editor).toContain('aria-label="Rich text formatting"');
    expect(editor).toContain("aria-pressed={active}");
    expect(editor).toContain("min-h-11");
    expect(editor).toContain('aria-live="polite"');
    expect(editor).toContain('"aria-invalid": "true"');
    expect(editor).toContain("setEditorInvalid(activeEditor, false)");
    expect(editor).toContain("motion-reduce:transition-none");
    expect(editor).toContain("Select words before adding a link.");
    expect(editor).toContain("credential-free https:// address");
  });

  it("draws a pressed toolbar button in a way no cascade order can undo", async () => {
    const editor = await editorSource("rich-text-tiptap-editor.tsx");

    // `bg-ink` and `bg-surface` weigh the same, so appending the pressed
    // colours to the base class list left Tailwind's emission order to pick a
    // winner per property: an active button came out paper-on-surface, its
    // label all but invisible. Every pressed colour must carry the attribute
    // selector that outweighs the resting one.
    expect(editor).toContain("aria-pressed:bg-ink");
    expect(editor).toContain("aria-pressed:text-paper");
    expect(editor).toContain(
      "aria-pressed:shadow-[3px_3px_0_0_var(--color-interactive-blue)]",
    );
    expect(editor).not.toMatch(/\$\{TOOLBAR_CONTROL\}\s+bg-ink/);

    // The state is on the element itself, not chosen between two class lists,
    // so what a pressed button looks like cannot drift from what it announces.
    expect(editor).toContain(
      "className={`${TOOLBAR_CONTROL} ${ACTIVE_TOOLBAR_STATE}`}",
    );
  });
});
