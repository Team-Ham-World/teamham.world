import type { RichTextDoc } from "@/lib/members/v2/document";
import {
  parseRichTextDoc,
  type RichTextParseResult,
} from "@/lib/members/v2/rich-text";

/**
 * The small JSON surface shared with the lazy TipTap chunk.
 *
 * This deliberately does not import a TipTap type. The adapter stays usable in
 * unit tests and in the editor shell without pulling TipTap or ProseMirror into
 * either module graph.
 */
export interface TipTapJsonNode {
  type?: unknown;
  attrs?: unknown;
  content?: unknown;
  marks?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

export type RichTextAdapterResult = RichTextParseResult;

export type RichTextEditEvaluation =
  | { status: "valid"; doc: RichTextDoc }
  | { status: "invalid"; editorJson: unknown; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function contentFrom(node: Record<string, unknown>): unknown {
  if (!Array.isArray(node.content)) return node.content;
  return node.content.map(normalizeTipTapNode);
}

function withoutNullAttributes(value: unknown): unknown {
  if (value === null) return undefined;
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([, attribute]) => attribute !== null),
  );
}

function unexpectedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const allowedKeys = new Set(allowed);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !allowedKeys.has(key)),
  );
}

function attrsIfPresent(attrs: unknown): Record<string, unknown> {
  if (isPlainObject(attrs) && Object.keys(attrs).length === 0) return {};
  return attrs === undefined ? {} : { attrs };
}

function normalizeMark(value: unknown): unknown {
  if (!isPlainObject(value)) return value;

  if (value.type === "bold" || value.type === "italic") {
    const attrs = withoutNullAttributes(value.attrs);
    return {
      type: value.type,
      ...attrsIfPresent(attrs),
      ...unexpectedKeys(value, ["type", "attrs"]),
    };
  }

  if (value.type === "link") {
    const attrs = withoutNullAttributes(value.attrs);
    const canonicalAttrs = isPlainObject(attrs)
      ? {
          href: attrs.href,
          ...unexpectedKeys(attrs, ["href", "target", "rel", "class"]),
        }
      : attrs;
    return {
      type: "link",
      attrs: canonicalAttrs,
      ...unexpectedKeys(value, ["type", "attrs"]),
    };
  }

  // Keep an unsupported mark unsupported so the shared parser rejects it. We
  // never silently turn code, strike, underline, or extension marks into plain
  // text.
  return {
    type: value.type,
    ...attrsIfPresent(withoutNullAttributes(value.attrs)),
    ...unexpectedKeys(value, ["type", "attrs"]),
  };
}

/**
 * Removes attributes TipTap owns for editing but the canonical AST does not.
 *
 * Link commonly supplies null target/rel/class values and list nodes can carry
 * editor defaults such as `start`. Only heading level and link href cross the
 * storage boundary. Unsupported nodes and marks retain their unsupported type
 * and consequently fail the shared parser.
 */
function normalizeTipTapNode(value: unknown): unknown {
  if (!isPlainObject(value)) return value;

  if (value.type === "doc") {
    return {
      type: "doc",
      content: contentFrom(value),
      ...attrsIfPresent(withoutNullAttributes(value.attrs)),
      ...unexpectedKeys(value, ["type", "content", "attrs"]),
    };
  }

  if (value.type === "paragraph") {
    return {
      type: "paragraph",
      content: contentFrom(value),
      ...attrsIfPresent(withoutNullAttributes(value.attrs)),
      ...unexpectedKeys(value, ["type", "content", "attrs"]),
    };
  }

  if (value.type === "heading") {
    const attrs = withoutNullAttributes(value.attrs);
    return {
      type: "heading",
      attrs,
      content: contentFrom(value),
      ...unexpectedKeys(value, ["type", "attrs", "content"]),
    };
  }

  if (value.type === "orderedList") {
    const attrs = withoutNullAttributes(value.attrs);
    const nonDefaultAttrs = isPlainObject(attrs)
      ? Object.fromEntries(
          Object.entries(attrs).filter(
            ([key, attribute]) => !(key === "start" && attribute === 1),
          ),
        )
      : attrs;
    return {
      type: "orderedList",
      content: contentFrom(value),
      ...attrsIfPresent(nonDefaultAttrs),
      ...unexpectedKeys(value, ["type", "content", "attrs"]),
    };
  }

  if (
    value.type === "bulletList" ||
    value.type === "listItem" ||
    value.type === "blockquote"
  ) {
    return {
      type: value.type,
      content: contentFrom(value),
      ...attrsIfPresent(withoutNullAttributes(value.attrs)),
      ...unexpectedKeys(value, ["type", "content", "attrs"]),
    };
  }

  if (value.type === "text") {
    const marks = Array.isArray(value.marks)
      ? value.marks.map(normalizeMark)
      : value.marks;
    return {
      type: "text",
      text: value.text,
      ...(value.marks === undefined ? {} : { marks }),
      ...attrsIfPresent(withoutNullAttributes(value.attrs)),
      ...unexpectedKeys(value, ["type", "text", "marks", "attrs"]),
    };
  }

  return {
    type: value.type,
    ...(value.content === undefined ? {} : { content: contentFrom(value) }),
    ...attrsIfPresent(withoutNullAttributes(value.attrs)),
    ...unexpectedKeys(value, ["type", "content", "attrs"]),
  };
}

/** Convert editor JSON to the one canonical, server-validated storage shape. */
export function tipTapJsonToCanonical(value: unknown): RichTextAdapterResult {
  return parseRichTextDoc(normalizeTipTapNode(value));
}

/** Keeps invalid editor JSON transient while exposing only canonical valid data. */
export function evaluateTipTapEdit(value: unknown): RichTextEditEvaluation {
  const parsed = tipTapJsonToCanonical(value);
  if (parsed.success) return { status: "valid", doc: parsed.doc };
  return {
    status: "invalid",
    editorJson: structuredClone(value),
    message: richTextErrorMessage(parsed.errors[0]?.message),
  };
}

/**
 * Validate canonical content before handing it to TipTap.
 *
 * The returned object is a plain clone, so the editor cannot mutate document
 * state through a shared reference.
 */
export function canonicalRichTextToTipTapJson(doc: RichTextDoc): RichTextDoc {
  const parsed = parseRichTextDoc(doc);
  if (!parsed.success) {
    throw new TypeError("Cannot open invalid canonical rich text in the editor.");
  }
  return structuredClone(parsed.doc);
}

/** Exact shared-parser link rule, also used by the link toolbar. */
export function normalizeRichTextHttpsLink(value: string): string | null {
  const parsed = parseRichTextDoc({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "link",
            marks: [{ type: "link", attrs: { href: value } }],
          },
        ],
      },
    ],
  });
  if (!parsed.success) return null;

  const paragraph = parsed.doc.content[0];
  if (paragraph.type !== "paragraph") return null;
  const link = paragraph.content[0].marks?.find((mark) => mark.type === "link");
  return link?.type === "link" ? link.attrs.href : null;
}

/** Canonical parser output has stable keys and mark order, so this is semantic. */
export function richTextDocsEqual(
  left: RichTextDoc | null,
  right: RichTextDoc | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function richTextErrorMessage(parserMessage?: string): string {
  if (!parserMessage) return "This text is not valid yet.";
  if (
    parserMessage.includes("cannot be empty") ||
    parserMessage.includes("only whitespace") ||
    parserMessage.includes("Content must be an array")
  ) {
    return "Add some text before this block can save.";
  }
  return parserMessage;
}
