import { PROJECTS } from "@/data/projects";
import type {
  AdditionalLinksBlock,
  CalloutQuoteBlock,
  FeaturedProjectBlock,
  MemberBlock,
  MemberImageRef,
  MemberProjectRef,
  MemberProjectStatus,
  ProjectListBlock,
  RichTextBlock,
  RichTextDoc,
} from "@/lib/members/v2/document";
import { MEMBER_PROJECT_STATUSES } from "@/lib/members/v2/document";
import {
  MAX_CALLOUT_CHARS,
  MAX_CAPTION_CHARS,
  MAX_COLLECTION_ITEMS,
  MAX_IMAGE_ALT_CHARS,
  MAX_LINK_DESCRIPTION_CHARS,
  MAX_LINK_LABEL_CHARS,
  MAX_PROJECT_DESCRIPTION_CHARS,
  MAX_PROJECT_NAME_CHARS,
  MAX_PROJECT_TYPE_CHARS,
  MAX_URL_CHARS,
} from "@/lib/members/v2/limits";

import type { MemberEditorIdGenerator } from "./ids";

/**
 * What the Add block menu offers, and which types the editor can build yet.
 *
 * Availability is explicit rather than hidden so incomplete future block
 * types never become half-working controls.
 */
export type EditorBlockAvailability =
  | { kind: "available" }
  | { kind: "unavailable"; reason: string };

export interface EditorBlockKind {
  type: MemberBlock["type"];
  label: string;
  description: string;
  availability: EditorBlockAvailability;
  /** True when the Add flow must collect content before inserting. */
  requiresContent: boolean;
}

export const EDITOR_BLOCK_KINDS: readonly EditorBlockKind[] = [
  {
    type: "featuredProject",
    label: "Featured project",
    description: "One project, given the largest treatment on the page.",
    availability: { kind: "available" },
    requiresContent: true,
  },
  {
    type: "projectList",
    label: "Project list",
    description: "Several projects in a stacked or compact run.",
    availability: { kind: "available" },
    requiresContent: true,
  },
  {
    type: "additionalLinks",
    label: "Additional links",
    description: "Labeled links to other places. Your site and socials stay up top.",
    availability: { kind: "available" },
    requiresContent: true,
  },
  {
    type: "calloutQuote",
    label: "Callout or quote",
    description: "A short note, or a quote with optional attribution.",
    availability: { kind: "available" },
    requiresContent: true,
  },
  {
    type: "richText",
    label: "Rich text",
    description: "Headings, paragraphs, and lists in your own words.",
    availability: { kind: "available" },
    requiresContent: true,
  },
  {
    type: "image",
    label: "Image",
    description: "One uploaded image with a caption.",
    availability: { kind: "available" },
    requiresContent: true,
  },
  {
    type: "gallery",
    label: "Gallery",
    description: "Two or more uploaded images.",
    availability: { kind: "available" },
    requiresContent: true,
  },
];

export function editorBlockKind(type: MemberBlock["type"]): EditorBlockKind {
  const kind = EDITOR_BLOCK_KINDS.find((entry) => entry.type === type);
  if (!kind) throw new TypeError(`Unknown editor block type: ${type}`);
  return kind;
}

export function isBlockTypeAvailable(type: MemberBlock["type"]): boolean {
  return editorBlockKind(type).availability.kind === "available";
}

/** Field limits surfaced to inspector inputs. Server stays authoritative. */
export const EDITOR_FIELD_LIMITS = {
  projectName: MAX_PROJECT_NAME_CHARS,
  projectType: MAX_PROJECT_TYPE_CHARS,
  projectDescription: MAX_PROJECT_DESCRIPTION_CHARS,
  linkLabel: MAX_LINK_LABEL_CHARS,
  linkDescription: MAX_LINK_DESCRIPTION_CHARS,
  callout: MAX_CALLOUT_CHARS,
  caption: MAX_CAPTION_CHARS,
  imageAlt: MAX_IMAGE_ALT_CHARS,
  url: MAX_URL_CHARS,
  collectionItems: MAX_COLLECTION_ITEMS,
} as const;

export const EDITOR_PROJECT_STATUSES: readonly MemberProjectStatus[] =
  MEMBER_PROJECT_STATUSES;

export const HAM_PROJECT_CHOICES = PROJECTS.map((project) => ({
  slug: project.slug,
  name: project.name,
  type: project.type,
  status: project.status,
  shortDescription: project.shortDescription,
}));

export function hamProjectFacts(projectSlug: string) {
  return HAM_PROJECT_CHOICES.find((project) => project.slug === projectSlug) ?? null;
}

/**
 * Advisory HTTPS check.
 *
 * Mirrors the server rule closely enough to guide the owner while typing; the
 * server validator remains the authority on every save.
 */
export function isLikelyHttpsUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_CHARS) return false;
  try {
    const url = new URL(trimmed);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hostname !== ""
    );
  } catch {
    return false;
  }
}

/** Commit point: whitespace is tidied here, not while typing. */
export function buildFeaturedProjectBlock(
  project: MemberProjectRef,
  nextId: MemberEditorIdGenerator,
): FeaturedProjectBlock {
  return {
    id: nextId(),
    type: "featuredProject",
    variant: "card",
    project: normalizeExternalProjectRef(project),
  };
}

/** Commit point: whitespace is tidied here, not while typing. */
export function buildProjectListBlock(
  project: MemberProjectRef,
  nextId: MemberEditorIdGenerator,
): ProjectListBlock {
  return {
    id: nextId(),
    type: "projectList",
    variant: "stacked",
    projects: [{ id: nextId(), project: normalizeExternalProjectRef(project) }],
  };
}

export function buildAdditionalLinksBlock(
  link: { label: string; url: string; description: string | null },
  nextId: MemberEditorIdGenerator,
): AdditionalLinksBlock {
  return {
    id: nextId(),
    type: "additionalLinks",
    variant: "list",
    links: [{ id: nextId(), ...link }],
  };
}

export function buildCalloutQuoteBlock(
  input: { variant: "note" | "quote"; text: string; attribution: string | null },
  nextId: MemberEditorIdGenerator,
): CalloutQuoteBlock {
  return {
    id: nextId(),
    type: "calloutQuote",
    variant: input.variant,
    text: input.text,
    attribution: input.variant === "quote" ? input.attribution : null,
  };
}

export function buildRichTextBlock(
  content: RichTextDoc,
  nextId: MemberEditorIdGenerator,
): RichTextBlock {
  return {
    id: nextId(),
    type: "richText",
    content,
  };
}

export function buildHamProjectRef(projectSlug: string): MemberProjectRef {
  return { kind: "ham", projectSlug };
}

/**
 * Builds an external project reference from what is currently in the fields.
 *
 * Text is taken as typed. Trimming on every keystroke deletes the space the
 * moment it is typed, so "My Game" can never be written: the field collapses
 * to "My" and the next character lands against it. Tidying belongs at the
 * point of commit, which is what `normalizeExternalProjectRef` is for.
 *
 * Links are the exception. A trailing space in a pasted URL is never wanted
 * and would fail the https check for no reason the owner can see.
 */
export function buildExternalProjectRef(input: {
  name: string;
  shortDescription: string;
  type: string;
  status: MemberProjectStatus;
  url: string;
  repository: string;
  artwork?: MemberImageRef;
}): MemberProjectRef {
  const url = input.url.trim();
  const repository = input.repository.trim();
  return {
    kind: "external",
    name: input.name,
    shortDescription: input.shortDescription,
    type: input.type,
    status: input.status,
    ...(url ? { url } : {}),
    ...(repository ? { repository } : {}),
    ...(input.artwork ? { artwork: input.artwork } : {}),
  };
}

/** Adds, replaces, or removes only the member-owned artwork on an external ref. */
export function withExternalProjectArtwork(
  project: Extract<MemberProjectRef, { kind: "external" }>,
  artwork: MemberImageRef | null,
): Extract<MemberProjectRef, { kind: "external" }> {
  const next = { ...project };
  delete next.artwork;
  return artwork ? { ...next, artwork } : next;
}

/**
 * Tidies a project reference on its way into the document.
 *
 * Called when a transient add flow commits, never while the owner is typing or
 * leaving an inspector field.
 */
export function normalizeExternalProjectRef(
  project: MemberProjectRef,
): MemberProjectRef {
  if (project.kind !== "external") return project;

  const url = project.url?.trim() ?? "";
  const repository = project.repository?.trim() ?? "";
  return {
    kind: "external",
    name: project.name.trim(),
    shortDescription: project.shortDescription.trim(),
    type: project.type.trim(),
    status: project.status,
    ...(url ? { url } : {}),
    ...(repository ? { repository } : {}),
    ...(project.artwork ? { artwork: project.artwork } : {}),
  };
}
