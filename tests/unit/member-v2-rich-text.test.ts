import { describe, expect, it } from "vitest";

import {
  RICH_TEXT_MAX_DEPTH,
  RICH_TEXT_MAX_NODES,
  RICH_TEXT_MAX_TEXT_CHARS,
} from "@/lib/members/v2/limits";
import { parseRichTextDoc } from "@/lib/members/v2/rich-text";
import { richTextFixture } from "../fixtures/member-v2/documents";

function expectRichFailure(value: unknown, path?: (string | number)[]) {
  const result = parseRichTextDoc(value);
  expect(result.success).toBe(false);
  if (!result.success && path) {
    expect(result.errors.some((error) =>
      JSON.stringify(error.path) === JSON.stringify(path)
    )).toBe(true);
  }
}

function nestedBlockquotes(count: number): unknown {
  let node: unknown = {
    type: "paragraph",
    content: [{ type: "text", text: "Deep" }],
  };
  for (let index = 0; index < count; index += 1) {
    node = { type: "blockquote", content: [node] };
  }
  return { type: "doc", content: [node] };
}

describe("member V2 rich text", () => {
  it("parses every allowed node and mark and canonicalizes text and mark order", () => {
    const doc = richTextFixture();
    const paragraph = doc.content[1];
    if (paragraph.type !== "paragraph") throw new Error("fixture mismatch");
    paragraph.content[0] = {
      type: "text",
      text: "Cafe\u0301",
      marks: [
        { type: "link", attrs: { href: "  https://example.com/cafe  " } },
        { type: "italic" },
        { type: "bold" },
      ],
    };

    const result = parseRichTextDoc(doc);
    expect(result.success).toBe(true);
    if (result.success) {
      const normalizedParagraph = result.doc.content[1];
      if (normalizedParagraph.type !== "paragraph") throw new Error("parser mismatch");
      expect(normalizedParagraph.content[0]).toEqual({
        type: "text",
        text: "Café",
        marks: [
          { type: "bold" },
          { type: "italic" },
          { type: "link", attrs: { href: "https://example.com/cafe" } },
        ],
      });
    }
  });

  it("rejects unknown keys, nodes, heading levels, and marks", () => {
    expectRichFailure({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi", extra: true }] }],
    }, ["content", 0, "content", 0, "extra"]);

    for (const type of ["codeBlock", "table", "html", "image", "hardBreak"]) {
      expectRichFailure({ type: "doc", content: [{ type }] }, ["content", 0, "type"]);
    }

    expectRichFailure({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H1" }] }],
    }, ["content", 0, "attrs", "level"]);

    for (const mark of [
      { type: "code" },
      { type: "underline" },
      { type: "link", attrs: { href: "https://example.com", target: "_blank" } },
    ]) {
      expectRichFailure({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hi", marks: [mark] }] }],
      });
    }
  });

  it("rejects malformed or duplicate marks and unsafe links", () => {
    expectRichFailure({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Hi", marks: [{ type: "bold" }, { type: "bold" }] }],
      }],
    }, ["content", 0, "content", 0, "marks", 1, "type"]);

    for (const href of [
      "http://example.com",
      "https://user@example.com",
      "/relative",
      "https://example.com/\nunsafe",
    ]) {
      expectRichFailure({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "Hi", marks: [{ type: "link", attrs: { href } }] }],
        }],
      });
    }
  });

  it("rejects empty structural nodes and invalid child placement", () => {
    for (const node of [
      { type: "doc", content: [] },
      { type: "doc", content: [{ type: "paragraph", content: [] }] },
      { type: "doc", content: [{ type: "bulletList", content: [] }] },
      { type: "doc", content: [{ type: "blockquote", content: [] }] },
    ]) {
      expectRichFailure(node);
    }

    expectRichFailure({
      type: "doc",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] }],
    }, ["content", 0, "type"]);
    expectRichFailure({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] }],
    }, ["content", 0, "content", 0, "type"]);
  });

  it("enforces node, text, and inclusive depth limits", () => {
    const exactNodes = {
      type: "doc",
      content: [{
        type: "paragraph",
        content: Array.from({ length: RICH_TEXT_MAX_NODES - 2 }, () => ({ type: "text", text: "x" })),
      }],
    };
    expect(parseRichTextDoc(exactNodes).success).toBe(true);
    (exactNodes.content[0].content as unknown[]).push({ type: "text", text: "x" });
    expectRichFailure(exactNodes);

    const exactText = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(RICH_TEXT_MAX_TEXT_CHARS) }] }],
    };
    expect(parseRichTextDoc(exactText).success).toBe(true);
    exactText.content[0].content[0].text += "x";
    expectRichFailure(exactText, ["content", 0, "content", 0, "text"]);

    expect(RICH_TEXT_MAX_DEPTH).toBe(10);
    expect(parseRichTextDoc(nestedBlockquotes(RICH_TEXT_MAX_DEPTH - 3)).success).toBe(true);
    expectRichFailure(nestedBlockquotes(RICH_TEXT_MAX_DEPTH - 2));
  });
});
