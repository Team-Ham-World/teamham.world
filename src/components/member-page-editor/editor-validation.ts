import type {
  MemberBlock,
  MemberPageDocumentV2,
  MemberProjectRef,
} from "@/lib/members/v2/document";
import {
  parseMemberPageDocumentV2,
  type MemberPageDocumentV2ValidationError,
} from "@/lib/members/v2/validation";

import { blockTypeLabel } from "./document-ops";

export type EditorValidationTarget =
  | { kind: "frame" }
  | { kind: "block"; blockId: string }
  | null;

export interface EditorValidationSummary {
  messages: string[];
  frameInvalid: boolean;
  invalidBlockIds: ReadonlySet<string>;
  firstTarget: EditorValidationTarget;
  firstControlId: string | null;
}

const EMPTY_SUMMARY: EditorValidationSummary = {
  messages: [],
  frameInvalid: false,
  invalidBlockIds: new Set(),
  firstTarget: null,
  firstControlId: null,
};

/**
 * Turns the shared validator's paths into editor regions. The server remains
 * authoritative, but this gives the owner a useful summary and lets the canvas
 * mark the frame or block that needs attention before an explicit publish.
 */
export function summarizeEditorValidation(
  document: MemberPageDocumentV2,
): EditorValidationSummary {
  const parsed = parseMemberPageDocumentV2(document);
  if (parsed.success) return EMPTY_SUMMARY;

  const invalidBlockIds = new Set<string>();
  let frameInvalid = false;
  let firstTarget: EditorValidationTarget = null;
  let firstControlId: string | null = null;

  for (const error of parsed.errors) {
    const target = targetForError(document, error);
    const controlId = controlIdForError(document, error);
    if (target?.kind === "frame") frameInvalid = true;
    if (target?.kind === "block") invalidBlockIds.add(target.blockId);
    if (!firstTarget && target) {
      firstTarget = target;
    }
    if (!firstControlId && controlId) {
      firstControlId = controlId;
      firstTarget = target;
    }
  }

  return {
    messages: uniqueMessages(
      parsed.errors.map((error) => describeValidationError(document, error)),
    ),
    frameInvalid,
    invalidBlockIds,
    firstTarget,
    firstControlId,
  };
}

function resolveBlockAtPath(
  document: MemberPageDocumentV2,
  error: MemberPageDocumentV2ValidationError,
): { block: MemberBlock; path: readonly (string | number)[] } | null {
  if (error.path[0] !== "blocks" || typeof error.path[1] !== "number") {
    return null;
  }
  const entry = document.blocks[error.path[1]];
  if (!entry) return null;

  if (entry.type === "row") {
    if (error.path[2] !== "blocks" || typeof error.path[3] !== "number") {
      return null;
    }
    const block = entry.blocks[error.path[3]];
    return block ? { block, path: error.path.slice(4) } : null;
  }
  return { block: entry, path: error.path.slice(2) };
}

/** Maps the shared validator path to the matching typed inspector control. */
export function controlIdForError(
  document: MemberPageDocumentV2,
  error: MemberPageDocumentV2ValidationError,
): string | null {
  if (error.path[0] === "frame") {
    return frameControlId(error.path.slice(1));
  }

  const resolved = resolveBlockAtPath(document, error);
  if (!resolved) return null;
  const { block, path } = resolved;
  const base = `block-${block.id}`;

  if (path[0] === "variant") return `${base}-variant`;

  switch (block.type) {
    case "richText":
      return `${base}-rich-text`;
    case "featuredProject":
      return projectControlId(`${base}-project`, block.project, path.slice(1));
    case "projectList": {
      if (path[0] !== "projects" || typeof path[1] !== "number") return null;
      const entry = block.projects[path[1]];
      return entry
        ? projectControlId(
            `${base}-entry-${entry.id}`,
            entry.project,
            path.slice(3),
          )
        : null;
    }
    case "additionalLinks": {
      if (path[0] !== "links" || typeof path[1] !== "number") return null;
      const link = block.links[path[1]];
      const field = path[2];
      return link && ["label", "url", "description"].includes(String(field))
        ? `${base}-link-${link.id}-${String(field)}`
        : null;
    }
    case "image":
      if (path[0] === "caption") return `${base}-caption`;
      return path[0] === "image"
        ? imageControlId(`${base}-image`, path.slice(1))
        : null;
    case "gallery": {
      if (path[0] !== "items" || typeof path[1] !== "number") return null;
      const item = block.items[path[1]];
      if (!item) return null;
      if (path[2] === "caption") return `${base}-item-${item.id}-caption`;
      return path[2] === "image"
        ? imageControlId(`${base}-item-${item.id}`, path.slice(3))
        : null;
    }
    case "calloutQuote":
      if (path[0] === "text") return `${base}-text`;
      if (path[0] === "attribution") return `${base}-attribution`;
      return `${base}-variant`;
    case "embed":
      if (path[0] === "url") return `${base}-url`;
      if (path[0] === "title") return `${base}-title`;
      if (path[0] === "showFrame") return `${base}-show-frame`;
      return `${base}-variant`;
  }
}

function frameControlId(path: readonly (string | number)[]): string | null {
  switch (path[0]) {
    case "displayName":
      return "frame-display-name";
    case "summary":
      return "frame-summary";
    case "websiteUrl":
      return "frame-website";
    case "socialLinks":
      return typeof path[1] === "string" ? `frame-social-${path[1]}` : null;
    case "portrait":
      return imageControlId("frame-portrait", path.slice(1));
    case "theme":
      return path[1] === "accentId" ? "frame-accent" : "frame-theme";
    default:
      return null;
  }
}

function projectControlId(
  prefix: string,
  project: MemberProjectRef,
  path: readonly (string | number)[],
): string | null {
  if (project.kind === "ham") return `${prefix}-ham-slug`;
  switch (path[0]) {
    case "name":
      return `${prefix}-name`;
    case "shortDescription":
      return `${prefix}-description`;
    case "type":
      return `${prefix}-type`;
    case "status":
      return `${prefix}-status`;
    case "url":
      return `${prefix}-url`;
    case "repository":
      return `${prefix}-repository`;
    case "artwork":
      return imageControlId(`${prefix}-artwork`, path.slice(1));
    default:
      return `${prefix}-name`;
  }
}

function imageControlId(
  prefix: string,
  path: readonly (string | number)[],
): string {
  return path[0] === "alt" ? `${prefix}-alt` : `${prefix}-asset`;
}

function targetForError(
  document: MemberPageDocumentV2,
  error: MemberPageDocumentV2ValidationError,
): EditorValidationTarget {
  if (error.path[0] === "frame") return { kind: "frame" };
  const resolved = resolveBlockAtPath(document, error);
  return resolved
    ? { kind: "block", blockId: resolved.block.id }
    : { kind: "frame" };
}

function describeValidationError(
  document: MemberPageDocumentV2,
  error: MemberPageDocumentV2ValidationError,
): string {
  if (error.path[0] === "frame") {
    return `${frameFieldLabel(error.path)}: ${plainValidationMessage(error.message)}`;
  }
  const resolved = resolveBlockAtPath(document, error);
  if (resolved && typeof error.path[1] === "number") {
    return `${blockTypeLabel(resolved.block.type)}, block ${error.path[1] + 1}: ${plainValidationMessage(error.message)}`;
  }
  return `Page content: ${plainValidationMessage(error.message)}`;
}

function frameFieldLabel(path: readonly (string | number)[]): string {
  switch (path[1]) {
    case "displayName":
      return "Display name";
    case "summary":
      return "Short introduction";
    case "websiteUrl":
      return "Personal site";
    case "socialLinks":
      return "Social profile";
    case "portrait":
      return "Portrait";
    case "theme":
      return "Theme";
    default:
      return "Profile header";
  }
}

function plainValidationMessage(message: string): string {
  if (message.startsWith("Must be non-empty")) return "Add the required text.";
  if (message.startsWith("Must use ")) return message.replace(/^Must/u, "Please");
  if (message.includes("HTTPS")) return "Use a full https:// address.";
  return message;
}

function uniqueMessages(messages: readonly string[]): string[] {
  return [...new Set(messages)].slice(0, 8);
}

/**
 * Focuses the validator-mapped field first, then the first mounted invalid
 * field. The fallback is normally the frame or block selector, so a
 * server-only/general error still leaves focus in a useful place.
 */
export function focusFirstInvalidControl(
  root: Pick<ParentNode, "querySelectorAll">,
  fallback?: Pick<HTMLElement, "focus"> | null,
  preferred?: Pick<HTMLElement, "focus" | "hasAttribute" | "getAttribute"> | null,
): Pick<HTMLElement, "focus"> | null {
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>('[aria-invalid="true"]'),
  );
  const firstInvalid =
    controls.find(
      (candidate) =>
        !candidate.hasAttribute("disabled") &&
        candidate.getAttribute("aria-hidden") !== "true",
    ) ?? null;
  const preferredAvailable =
    preferred &&
    !preferred.hasAttribute("disabled") &&
    preferred.getAttribute("aria-hidden") !== "true"
      ? preferred
      : null;
  const target = preferredAvailable ?? firstInvalid ?? fallback ?? null;
  target?.focus();
  return target;
}
