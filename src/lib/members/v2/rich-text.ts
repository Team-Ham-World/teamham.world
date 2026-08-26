import type {
  RichTextBlockNode,
  RichTextBlockquote,
  RichTextBulletList,
  RichTextDoc,
  RichTextHeading,
  RichTextListItem,
  RichTextMark,
  RichTextOrderedList,
  RichTextParagraph,
  RichTextText,
} from "@/lib/members/v2/document";
import {
  MAX_URL_CHARS,
  RICH_TEXT_MAX_DEPTH,
  RICH_TEXT_MAX_NODES,
  RICH_TEXT_MAX_TEXT_CHARS,
} from "@/lib/members/v2/limits";

export interface RichTextValidationError {
  path: (string | number)[];
  message: string;
}

export type RichTextParseResult =
  | { success: true; doc: RichTextDoc }
  | { success: false; errors: RichTextValidationError[] };

interface ParseState {
  errors: RichTextValidationError[];
  nodeCount: number;
  textChars: number;
  nodeLimitReported: boolean;
  textLimitReported: boolean;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const MARK_ORDER: Record<RichTextMark["type"], number> = {
  bold: 0,
  italic: 1,
  link: 2,
};

function addError(
  state: ParseState,
  path: (string | number)[],
  message: string,
) {
  state.errors.push({ path, message });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    addError(state, path, "Must be a plain object.");
    return null;
  }
  return value;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: (string | number)[],
  state: ParseState,
) {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      addError(state, [...path, String(key)], "Unknown key.");
    }
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function countCharacters(value: string): number {
  return [...value].length;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (CONTROL_CHARACTERS.test(value) || hasUnpairedSurrogate(value)) return null;
  return value.normalize("NFC");
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value)?.trim();
  if (!normalized || countCharacters(normalized) > MAX_URL_CHARS) return null;
  try {
    const parsed = new URL(normalized);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return normalized;
}

function enterNode(
  state: ParseState,
  path: (string | number)[],
  depth: number,
): boolean {
  if (depth > RICH_TEXT_MAX_DEPTH) {
    addError(
      state,
      path,
      `Rich text cannot exceed depth ${RICH_TEXT_MAX_DEPTH}, counting the doc as depth 1.`,
    );
    return false;
  }
  state.nodeCount += 1;
  if (state.nodeCount > RICH_TEXT_MAX_NODES) {
    if (!state.nodeLimitReported) {
      addError(
        state,
        path,
        `Rich text cannot contain more than ${RICH_TEXT_MAX_NODES} nodes.`,
      );
      state.nodeLimitReported = true;
    }
    return false;
  }
  return true;
}

function parseMark(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): RichTextMark | null {
  const mark = requirePlainObject(value, path, state);
  if (!mark) return null;
  if (typeof mark.type !== "string") {
    addError(state, [...path, "type"], "Mark type must be a string.");
    return null;
  }

  if (mark.type === "bold" || mark.type === "italic") {
    rejectUnknownKeys(mark, ["type"], path, state);
    return { type: mark.type };
  }

  if (mark.type === "link") {
    rejectUnknownKeys(mark, ["type", "attrs"], path, state);
    const attrsPath = [...path, "attrs"];
    const attrs = requirePlainObject(mark.attrs, attrsPath, state);
    if (!attrs) return null;
    rejectUnknownKeys(attrs, ["href"], attrsPath, state);
    const href = normalizeHttpsUrl(attrs.href);
    if (!href) {
      addError(
        state,
        [...attrsPath, "href"],
        "Link must be an absolute credential-free HTTPS URL.",
      );
      return null;
    }
    return { type: "link", attrs: { href } };
  }

  addError(state, [...path, "type"], "Unknown rich-text mark.");
  return null;
}

function parseTextNode(
  value: unknown,
  path: (string | number)[],
  depth: number,
  state: ParseState,
): RichTextText | null {
  if (!enterNode(state, path, depth)) return null;
  const node = requirePlainObject(value, path, state);
  if (!node) return null;
  rejectUnknownKeys(node, ["type", "text", "marks"], path, state);

  if (node.type !== "text") {
    addError(state, [...path, "type"], "Expected a text node.");
    return null;
  }

  const text = normalizeText(node.text);
  if (text === null || text.length === 0) {
    addError(
      state,
      [...path, "text"],
      "Text must be non-empty Unicode plain text without control characters.",
    );
    return null;
  }

  state.textChars += countCharacters(text);
  if (state.textChars > RICH_TEXT_MAX_TEXT_CHARS) {
    if (!state.textLimitReported) {
      addError(
        state,
        [...path, "text"],
        `Rich text cannot contain more than ${RICH_TEXT_MAX_TEXT_CHARS} text characters.`,
      );
      state.textLimitReported = true;
    }
    return null;
  }

  if (!Object.hasOwn(node, "marks")) return { type: "text", text };
  if (!Array.isArray(node.marks)) {
    addError(state, [...path, "marks"], "Marks must be an array when present.");
    return null;
  }
  if (node.marks.length > 3) {
    addError(state, [...path, "marks"], "Text may contain at most three marks.");
  }

  const seen = new Set<RichTextMark["type"]>();
  const marks: RichTextMark[] = [];
  node.marks.forEach((markValue, index) => {
    const markPath = [...path, "marks", index];
    const mark = parseMark(markValue, markPath, state);
    if (!mark) return;
    if (seen.has(mark.type)) {
      addError(state, [...markPath, "type"], "Duplicate rich-text mark.");
      return;
    }
    seen.add(mark.type);
    marks.push(mark);
  });

  if (marks.length === 0) return { type: "text", text };
  marks.sort((left, right) => MARK_ORDER[left.type] - MARK_ORDER[right.type]);
  return { type: "text", text, marks };
}

function parseTextContent(
  value: unknown,
  path: (string | number)[],
  depth: number,
  state: ParseState,
): RichTextText[] | null {
  if (!Array.isArray(value)) {
    addError(state, path, "Content must be an array.");
    return null;
  }
  if (value.length === 0) {
    addError(state, path, "Structural rich-text nodes cannot be empty.");
    return null;
  }
  if (value.length > RICH_TEXT_MAX_NODES) {
    addError(
      state,
      path,
      `Rich text cannot contain more than ${RICH_TEXT_MAX_NODES} nodes.`,
    );
    return null;
  }

  const content = value.map((child, index) =>
    parseTextNode(child, [...path, index], depth, state)
  );
  if (!content.every((child): child is RichTextText => child !== null)) return null;
  if (!content.some((child) => child.text.trim().length > 0)) {
    addError(state, path, "Structural rich-text nodes cannot contain only whitespace.");
    return null;
  }
  return content;
}

function parseListItem(
  value: unknown,
  path: (string | number)[],
  depth: number,
  state: ParseState,
): RichTextListItem | null {
  if (!enterNode(state, path, depth)) return null;
  const node = requirePlainObject(value, path, state);
  if (!node) return null;
  rejectUnknownKeys(node, ["type", "content"], path, state);
  if (node.type !== "listItem") {
    addError(state, [...path, "type"], "Lists may contain only list items.");
    return null;
  }
  const content = parseBlockContent(
    node.content,
    [...path, "content"],
    depth + 1,
    state,
  );
  return content ? { type: "listItem", content } : null;
}

function parseListContent(
  value: unknown,
  path: (string | number)[],
  depth: number,
  state: ParseState,
): RichTextListItem[] | null {
  if (!Array.isArray(value)) {
    addError(state, path, "List content must be an array.");
    return null;
  }
  if (value.length === 0) {
    addError(state, path, "Structural rich-text nodes cannot be empty.");
    return null;
  }
  if (value.length > RICH_TEXT_MAX_NODES) {
    addError(
      state,
      path,
      `Rich text cannot contain more than ${RICH_TEXT_MAX_NODES} nodes.`,
    );
    return null;
  }
  const content = value.map((child, index) =>
    parseListItem(child, [...path, index], depth, state)
  );
  return content.every((child): child is RichTextListItem => child !== null)
    ? content
    : null;
}

function parseBlockNode(
  value: unknown,
  path: (string | number)[],
  depth: number,
  state: ParseState,
): RichTextBlockNode | null {
  if (!enterNode(state, path, depth)) return null;
  const node = requirePlainObject(value, path, state);
  if (!node) return null;
  if (typeof node.type !== "string") {
    addError(state, [...path, "type"], "Node type must be a string.");
    return null;
  }

  if (node.type === "paragraph") {
    rejectUnknownKeys(node, ["type", "content"], path, state);
    const content = parseTextContent(
      node.content,
      [...path, "content"],
      depth + 1,
      state,
    );
    return content ? { type: "paragraph", content } satisfies RichTextParagraph : null;
  }

  if (node.type === "heading") {
    rejectUnknownKeys(node, ["type", "attrs", "content"], path, state);
    const attrsPath = [...path, "attrs"];
    const attrs = requirePlainObject(node.attrs, attrsPath, state);
    if (!attrs) return null;
    rejectUnknownKeys(attrs, ["level"], attrsPath, state);
    if (attrs.level !== 2 && attrs.level !== 3) {
      addError(state, [...attrsPath, "level"], "Heading level must be 2 or 3.");
      return null;
    }
    const content = parseTextContent(
      node.content,
      [...path, "content"],
      depth + 1,
      state,
    );
    return content
      ? { type: "heading", attrs: { level: attrs.level }, content } satisfies RichTextHeading
      : null;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    rejectUnknownKeys(node, ["type", "content"], path, state);
    const content = parseListContent(
      node.content,
      [...path, "content"],
      depth + 1,
      state,
    );
    if (!content) return null;
    if (node.type === "bulletList") {
      return { type: "bulletList", content } satisfies RichTextBulletList;
    }
    return { type: "orderedList", content } satisfies RichTextOrderedList;
  }

  if (node.type === "blockquote") {
    rejectUnknownKeys(node, ["type", "content"], path, state);
    const content = parseBlockContent(
      node.content,
      [...path, "content"],
      depth + 1,
      state,
    );
    return content
      ? { type: "blockquote", content } satisfies RichTextBlockquote
      : null;
  }

  addError(state, [...path, "type"], "Unknown rich-text node.");
  return null;
}

function parseBlockContent(
  value: unknown,
  path: (string | number)[],
  depth: number,
  state: ParseState,
): RichTextBlockNode[] | null {
  if (!Array.isArray(value)) {
    addError(state, path, "Content must be an array.");
    return null;
  }
  if (value.length === 0) {
    addError(state, path, "Structural rich-text nodes cannot be empty.");
    return null;
  }
  if (value.length > RICH_TEXT_MAX_NODES) {
    addError(
      state,
      path,
      `Rich text cannot contain more than ${RICH_TEXT_MAX_NODES} nodes.`,
    );
    return null;
  }
  const content = value.map((child, index) =>
    parseBlockNode(child, [...path, index], depth, state)
  );
  return content.every((child): child is RichTextBlockNode => child !== null)
    ? content
    : null;
}

export function parseRichTextDoc(value: unknown): RichTextParseResult {
  const state: ParseState = {
    errors: [],
    nodeCount: 0,
    textChars: 0,
    nodeLimitReported: false,
    textLimitReported: false,
  };

  if (!enterNode(state, [], 1)) return { success: false, errors: state.errors };
  const doc = requirePlainObject(value, [], state);
  if (!doc) return { success: false, errors: state.errors };
  rejectUnknownKeys(doc, ["type", "content"], [], state);
  if (doc.type !== "doc") {
    addError(state, ["type"], "Rich text root must be a doc node.");
  }
  const content = parseBlockContent(doc.content, ["content"], 2, state);

  if (state.errors.length > 0 || doc.type !== "doc" || !content) {
    return { success: false, errors: state.errors };
  }
  return { success: true, doc: { type: "doc", content } };
}
