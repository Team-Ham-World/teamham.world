import { PROJECTS } from "@/data/projects";
import type {
  AdditionalLinksBlock,
  CalloutQuoteBlock,
  EmbedBlock,
  FeaturedProjectBlock,
  GalleryBlock,
  ImageBlock,
  MemberBlock,
  MemberBlockRow,
  MemberImageRef,
  MemberPageDocumentV2,
  MemberPageEntry,
  MemberPageFrameV2,
  MemberProjectRef,
  ProjectListBlock,
  RichTextBlock,
  SocialPlatformId,
} from "@/lib/members/v2/document";
import {
  MEMBER_BLOCK_ROW_RATIOS,
  MEMBER_PROJECT_STATUSES,
  MEMBER_SOCIAL_PLATFORM_IDS,
} from "@/lib/members/v2/document";
import {
  MAX_BLOCKS,
  MAX_CALLOUT_CHARS,
  MAX_CAPTION_CHARS,
  MAX_COLLECTION_ITEMS,
  MAX_DISPLAY_NAME_CHARS,
  MAX_DOCUMENT_BYTES,
  MAX_EMBED_TITLE_CHARS,
  MAX_FEATURED_PROJECT_BLOCKS,
  MAX_IMAGE_ALT_CHARS,
  MAX_LINK_DESCRIPTION_CHARS,
  MAX_LINK_LABEL_CHARS,
  MAX_PROJECT_DESCRIPTION_CHARS,
  MAX_PROJECT_NAME_CHARS,
  MAX_PROJECT_TYPE_CHARS,
  MAX_QUOTE_ATTRIBUTION_CHARS,
  MAX_READY_ASSETS,
  MAX_SUMMARY_CHARS,
  MAX_URL_CHARS,
  MIN_GALLERY_ITEMS,
} from "@/lib/members/v2/limits";
import { parseRichTextDoc } from "@/lib/members/v2/rich-text";
import {
  assertNeverMemberThemeLifecycle,
  getMemberThemeDefinition,
  isMemberThemeId,
  isRenderableThemeAccentPair,
} from "@/lib/members/v2/themes";

export interface MemberPageDocumentV2ValidationError {
  path: (string | number)[];
  message: string;
}

export type MemberPageDocumentV2ParseResult =
  | { success: true; doc: MemberPageDocumentV2 }
  | { success: false; errors: MemberPageDocumentV2ValidationError[] };

interface ParseState {
  errors: MemberPageDocumentV2ValidationError[];
  ids: Set<string>;
  assetIds: Set<string>;
  featuredProjectBlocks: number;
}

type Parsed<T> = { ok: true; value: T } | { ok: false };

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const PROJECT_SLUGS = new Set(PROJECTS.map((project) => project.slug));
const SOCIAL_PLATFORM_IDS = new Set<string>(MEMBER_SOCIAL_PLATFORM_IDS);

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

function normalizeUnicode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (CONTROL_CHARACTERS.test(value) || hasUnpairedSurrogate(value)) return null;
  return value.normalize("NFC");
}

function parseRequiredText(
  value: unknown,
  maximum: number,
  path: (string | number)[],
  state: ParseState,
): Parsed<string> {
  const normalized = normalizeUnicode(value)?.trim();
  if (!normalized) {
    addError(
      state,
      path,
      "Must be non-empty Unicode plain text without control characters.",
    );
    return { ok: false };
  }
  if (countCharacters(normalized) > maximum) {
    addError(state, path, `Must use ${maximum} characters or fewer.`);
    return { ok: false };
  }
  return { ok: true, value: normalized };
}

function parseNullableText(
  value: unknown,
  maximum: number,
  path: (string | number)[],
  state: ParseState,
): Parsed<string | null> {
  if (value === null) return { ok: true, value: null };
  const normalized = normalizeUnicode(value);
  if (normalized === null) {
    addError(
      state,
      path,
      "Must be Unicode plain text or null without control characters.",
    );
    return { ok: false };
  }
  const trimmed = normalized.trim();
  if (!trimmed) return { ok: true, value: null };
  if (countCharacters(trimmed) > maximum) {
    addError(state, path, `Must use ${maximum} characters or fewer.`);
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      Boolean(parsed.hostname) &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function parseNullableHttpsUrl(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): Parsed<string | null> {
  if (value === null) return { ok: true, value: null };
  const normalized = normalizeUnicode(value);
  if (normalized === null) {
    addError(state, path, "Must be an absolute credential-free HTTPS URL or null.");
    return { ok: false };
  }
  const trimmed = normalized.trim();
  if (!trimmed) return { ok: true, value: null };
  if (countCharacters(trimmed) > MAX_URL_CHARS || !isHttpsUrl(trimmed)) {
    addError(state, path, "Must be an absolute credential-free HTTPS URL.");
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

function parseOptionalHttpsUrl(
  value: unknown,
  present: boolean,
  path: (string | number)[],
  state: ParseState,
): Parsed<string | undefined> {
  if (!present || value === null) return { ok: true, value: undefined };
  const parsed = parseNullableHttpsUrl(value, path, state);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value ?? undefined };
}

function parseStableId(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
  label: string,
): Parsed<string> {
  const normalized = normalizeUnicode(value)?.trim();
  if (!normalized) {
    addError(state, path, `${label} must be a non-empty opaque ID.`);
    return { ok: false };
  }
  return { ok: true, value: normalized };
}

function parseAssetId(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): Parsed<string> {
  const parsed = parseStableId(value, path, state, "Asset ID");
  if (!parsed.ok) return parsed;
  if (
    /^(?:https?:|data:|blob:)/iu.test(parsed.value) ||
    parsed.value.startsWith("/") ||
    parsed.value.includes("\\") ||
    parsed.value.includes("/")
  ) {
    addError(state, path, "Asset ID must not be a URL, route, or object key.");
    return { ok: false };
  }
  return parsed;
}

function parseUniqueId(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): Parsed<string> {
  const parsed = parseStableId(value, path, state, "ID");
  if (!parsed.ok) return parsed;
  if (state.ids.has(parsed.value)) {
    addError(state, path, "Block and entry IDs must be unique within the document.");
    return { ok: false };
  }
  state.ids.add(parsed.value);
  return parsed;
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: (string | number)[],
  state: ParseState,
  label: string,
): Parsed<T> {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    addError(state, path, `Unknown ${label}.`);
    return { ok: false };
  }
  return { ok: true, value: value as T };
}

function parseImageRef(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): MemberImageRef | null {
  const image = requirePlainObject(value, path, state);
  if (!image) return null;
  rejectUnknownKeys(image, ["assetId", "alt", "decorative"], path, state);

  const assetId = parseAssetId(image.assetId, [...path, "assetId"], state);
  const alt = parseNullableText(
    image.alt,
    MAX_IMAGE_ALT_CHARS,
    [...path, "alt"],
    state,
  );
  const decorative = image.decorative;
  if (typeof decorative !== "boolean") {
    addError(state, [...path, "decorative"], "Decorative must be a boolean.");
  }

  if (typeof decorative === "boolean" && alt.ok) {
    if (decorative && alt.value !== null) {
      addError(state, [...path, "alt"], "Decorative images must have null alt text.");
    }
    if (!decorative && alt.value === null) {
      addError(
        state,
        [...path, "alt"],
        "Informative images must have non-empty alt text.",
      );
    }
  }

  if (!assetId.ok || !alt.ok || typeof decorative !== "boolean") return null;
  if ((decorative && alt.value !== null) || (!decorative && alt.value === null)) {
    return null;
  }

  state.assetIds.add(assetId.value);
  return { assetId: assetId.value, alt: alt.value, decorative };
}

function parseSocialLinks(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): MemberPageFrameV2["socialLinks"] | null {
  const links = requirePlainObject(value, path, state);
  if (!links) return null;

  for (const key of Reflect.ownKeys(links)) {
    if (typeof key !== "string" || !SOCIAL_PLATFORM_IDS.has(key)) {
      addError(state, [...path, String(key)], "Unknown social platform.");
    }
  }

  const parsedLinks: Partial<Record<SocialPlatformId, string>> = {};
  for (const platform of MEMBER_SOCIAL_PLATFORM_IDS) {
    if (!Object.hasOwn(links, platform)) continue;
    const parsed = parseOptionalHttpsUrl(
      links[platform],
      true,
      [...path, platform],
      state,
    );
    if (parsed.ok && parsed.value) parsedLinks[platform] = parsed.value;
  }
  return parsedLinks;
}

function parseTheme(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): MemberPageFrameV2["theme"] | null {
  const theme = requirePlainObject(value, path, state);
  if (!theme) return null;
  rejectUnknownKeys(theme, ["id", "accentId"], path, state);

  if (typeof theme.id !== "string") {
    addError(state, [...path, "id"], "Theme ID must be a string.");
    return null;
  }
  if (typeof theme.accentId !== "string" || !theme.accentId) {
    addError(state, [...path, "accentId"], "Accent ID must be a non-empty string.");
    return null;
  }

  if (!isMemberThemeId(theme.id)) {
    addError(state, [...path, "id"], "Unknown theme.");
    return null;
  }
  const definition = getMemberThemeDefinition(theme.id);
  if (!definition) {
    // Unreachable once the ID guard above passes; kept so the union-typed
    // lookup stays honest without casts.
    addError(state, [...path, "id"], "Unknown theme.");
    return null;
  }
  switch (definition.lifecycle) {
    case "active":
    case "legacy":
      // Read/render acceptance: active themes are selectable and renderable;
      // legacy themes stay valid for stored documents even though the picker
      // omits them. This parser is NOT the write boundary — mutations apply
      // the narrower `classifyThemeAccentPairForWrite` decision (see
      // themes.ts) on top of it, so a legacy pair can never be newly selected
      // through an autosave.
      break;
    case "revoked":
      addError(state, [...path, "id"], "Theme is revoked.");
      return null;
    default:
      assertNeverMemberThemeLifecycle(definition);
  }
  if (!isRenderableThemeAccentPair(definition, theme.accentId)) {
    addError(state, [...path, "accentId"], "Unknown or unavailable accent.");
    return null;
  }

  return { id: theme.id, accentId: theme.accentId };
}

function parseFrame(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): MemberPageFrameV2 | null {
  const frame = requirePlainObject(value, path, state);
  if (!frame) return null;
  rejectUnknownKeys(
    frame,
    ["displayName", "summary", "websiteUrl", "socialLinks", "portrait", "theme"],
    path,
    state,
  );

  const displayName = parseRequiredText(
    frame.displayName,
    MAX_DISPLAY_NAME_CHARS,
    [...path, "displayName"],
    state,
  );
  const summary = parseNullableText(
    frame.summary,
    MAX_SUMMARY_CHARS,
    [...path, "summary"],
    state,
  );
  const websiteUrl = parseNullableHttpsUrl(
    frame.websiteUrl,
    [...path, "websiteUrl"],
    state,
  );
  const socialLinks = parseSocialLinks(
    frame.socialLinks,
    [...path, "socialLinks"],
    state,
  );
  let portrait: MemberImageRef | null = null;
  let portraitValid = true;
  if (frame.portrait !== null) {
    portrait = parseImageRef(frame.portrait, [...path, "portrait"], state);
    portraitValid = portrait !== null;
  }
  const theme = parseTheme(frame.theme, [...path, "theme"], state);

  if (
    !displayName.ok ||
    !summary.ok ||
    !websiteUrl.ok ||
    !socialLinks ||
    !portraitValid ||
    !theme
  ) {
    return null;
  }

  return {
    displayName: displayName.value,
    summary: summary.value,
    websiteUrl: websiteUrl.value,
    socialLinks,
    portrait,
    theme,
  };
}

function parseProject(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): MemberProjectRef | null {
  const project = requirePlainObject(value, path, state);
  if (!project) return null;
  if (typeof project.kind !== "string") {
    addError(state, [...path, "kind"], "Project kind must be a string.");
    return null;
  }

  if (project.kind === "ham") {
    rejectUnknownKeys(project, ["kind", "projectSlug"], path, state);
    const projectSlug = parseRequiredText(
      project.projectSlug,
      MAX_URL_CHARS,
      [...path, "projectSlug"],
      state,
    );
    if (!projectSlug.ok) return null;
    if (!PROJECT_SLUGS.has(projectSlug.value)) {
      addError(
        state,
        [...path, "projectSlug"],
        "HAM project slug is not present in the public project registry.",
      );
      return null;
    }
    return { kind: "ham", projectSlug: projectSlug.value };
  }

  if (project.kind !== "external") {
    addError(state, [...path, "kind"], "Unknown project kind.");
    return null;
  }

  rejectUnknownKeys(
    project,
    [
      "kind",
      "name",
      "shortDescription",
      "type",
      "status",
      "url",
      "repository",
      "artwork",
    ],
    path,
    state,
  );
  const name = parseRequiredText(
    project.name,
    MAX_PROJECT_NAME_CHARS,
    [...path, "name"],
    state,
  );
  const shortDescription = parseRequiredText(
    project.shortDescription,
    MAX_PROJECT_DESCRIPTION_CHARS,
    [...path, "shortDescription"],
    state,
  );
  const type = parseRequiredText(
    project.type,
    MAX_PROJECT_TYPE_CHARS,
    [...path, "type"],
    state,
  );
  const status = parseEnum(
    project.status,
    MEMBER_PROJECT_STATUSES,
    [...path, "status"],
    state,
    "project status",
  );
  const url = parseOptionalHttpsUrl(
    project.url,
    Object.hasOwn(project, "url"),
    [...path, "url"],
    state,
  );
  const repository = parseOptionalHttpsUrl(
    project.repository,
    Object.hasOwn(project, "repository"),
    [...path, "repository"],
    state,
  );
  let artwork: MemberImageRef | undefined;
  let artworkValid = true;
  if (Object.hasOwn(project, "artwork")) {
    artwork = parseImageRef(project.artwork, [...path, "artwork"], state) ?? undefined;
    artworkValid = artwork !== undefined;
  }

  if (
    !name.ok ||
    !shortDescription.ok ||
    !type.ok ||
    !status.ok ||
    !url.ok ||
    !repository.ok ||
    !artworkValid
  ) {
    return null;
  }

  return {
    kind: "external",
    name: name.value,
    shortDescription: shortDescription.value,
    type: type.value,
    status: status.value,
    ...(url.value ? { url: url.value } : {}),
    ...(repository.value ? { repository: repository.value } : {}),
    ...(artwork ? { artwork } : {}),
  };
}

function parseProjectEntries(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): ProjectListBlock["projects"] | null {
  if (!Array.isArray(value)) {
    addError(state, path, "Projects must be an array.");
    return null;
  }
  if (value.length === 0 || value.length > MAX_COLLECTION_ITEMS) {
    addError(
      state,
      path,
      `Projects must contain between 1 and ${MAX_COLLECTION_ITEMS} entries.`,
    );
  }

  const entries = value.map((entryValue, index) => {
    const entryPath = [...path, index];
    const entry = requirePlainObject(entryValue, entryPath, state);
    if (!entry) return null;
    rejectUnknownKeys(entry, ["id", "project"], entryPath, state);
    const id = parseUniqueId(entry.id, [...entryPath, "id"], state);
    const project = parseProject(entry.project, [...entryPath, "project"], state);
    return id.ok && project ? { id: id.value, project } : null;
  });
  return entries.every((entry): entry is ProjectListBlock["projects"][number] =>
    entry !== null
  ) ? entries : null;
}

function parseLinkEntries(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): AdditionalLinksBlock["links"] | null {
  if (!Array.isArray(value)) {
    addError(state, path, "Links must be an array.");
    return null;
  }
  if (value.length === 0 || value.length > MAX_COLLECTION_ITEMS) {
    addError(
      state,
      path,
      `Links must contain between 1 and ${MAX_COLLECTION_ITEMS} entries.`,
    );
  }

  const links = value.map((linkValue, index) => {
    const linkPath = [...path, index];
    const link = requirePlainObject(linkValue, linkPath, state);
    if (!link) return null;
    rejectUnknownKeys(link, ["id", "label", "url", "description"], linkPath, state);
    const id = parseUniqueId(link.id, [...linkPath, "id"], state);
    const label = parseRequiredText(
      link.label,
      MAX_LINK_LABEL_CHARS,
      [...linkPath, "label"],
      state,
    );
    const url = parseNullableHttpsUrl(link.url, [...linkPath, "url"], state);
    if (url.ok && url.value === null) {
      addError(state, [...linkPath, "url"], "Link URL cannot be empty.");
    }
    const description = parseNullableText(
      link.description,
      MAX_LINK_DESCRIPTION_CHARS,
      [...linkPath, "description"],
      state,
    );
    return id.ok && label.ok && url.ok && url.value && description.ok
      ? {
          id: id.value,
          label: label.value,
          url: url.value,
          description: description.value,
        }
      : null;
  });
  return links.every((link): link is AdditionalLinksBlock["links"][number] =>
    link !== null
  ) ? links : null;
}

function parseGalleryItems(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): GalleryBlock["items"] | null {
  if (!Array.isArray(value)) {
    addError(state, path, "Gallery items must be an array.");
    return null;
  }
  if (value.length < MIN_GALLERY_ITEMS || value.length > MAX_COLLECTION_ITEMS) {
    addError(
      state,
      path,
      `Gallery must contain between ${MIN_GALLERY_ITEMS} and ${MAX_COLLECTION_ITEMS} items.`,
    );
  }

  const items = value.map((itemValue, index) => {
    const itemPath = [...path, index];
    const item = requirePlainObject(itemValue, itemPath, state);
    if (!item) return null;
    rejectUnknownKeys(item, ["id", "image", "caption"], itemPath, state);
    const id = parseUniqueId(item.id, [...itemPath, "id"], state);
    const image = parseImageRef(item.image, [...itemPath, "image"], state);
    const caption = parseNullableText(
      item.caption,
      MAX_CAPTION_CHARS,
      [...itemPath, "caption"],
      state,
    );
    return id.ok && image && caption.ok
      ? { id: id.value, image, caption: caption.value }
      : null;
  });
  return items.every((item): item is GalleryBlock["items"][number] => item !== null)
    ? items
    : null;
}

function parseBlock(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): MemberBlock | null {
  const block = requirePlainObject(value, path, state);
  if (!block) return null;
  const id = parseUniqueId(block.id, [...path, "id"], state);
  if (typeof block.type !== "string") {
    addError(state, [...path, "type"], "Block type must be a string.");
    return null;
  }

  if (block.type === "richText") {
    rejectUnknownKeys(block, ["id", "type", "content"], path, state);
    const content = parseRichTextDoc(block.content);
    if (!content.success) {
      for (const error of content.errors) {
        addError(state, [...path, "content", ...error.path], error.message);
      }
    }
    return id.ok && content.success
      ? { id: id.value, type: "richText", content: content.doc } satisfies RichTextBlock
      : null;
  }

  if (block.type === "featuredProject") {
    state.featuredProjectBlocks += 1;
    rejectUnknownKeys(block, ["id", "type", "variant", "project"], path, state);
    const variant = parseEnum(
      block.variant,
      ["card", "artwork-first"] as const,
      [...path, "variant"],
      state,
      "featured project variant",
    );
    const project = parseProject(block.project, [...path, "project"], state);
    return id.ok && variant.ok && project
      ? {
          id: id.value,
          type: "featuredProject",
          variant: variant.value,
          project,
        } satisfies FeaturedProjectBlock
      : null;
  }

  if (block.type === "projectList") {
    rejectUnknownKeys(block, ["id", "type", "variant", "projects"], path, state);
    const variant = parseEnum(
      block.variant,
      ["stacked", "compact"] as const,
      [...path, "variant"],
      state,
      "project list variant",
    );
    const projects = parseProjectEntries(block.projects, [...path, "projects"], state);
    return id.ok && variant.ok && projects
      ? {
          id: id.value,
          type: "projectList",
          variant: variant.value,
          projects,
        } satisfies ProjectListBlock
      : null;
  }

  if (block.type === "additionalLinks") {
    rejectUnknownKeys(block, ["id", "type", "variant", "links"], path, state);
    const variant = parseEnum(
      block.variant,
      ["list", "buttons"] as const,
      [...path, "variant"],
      state,
      "additional links variant",
    );
    const links = parseLinkEntries(block.links, [...path, "links"], state);
    return id.ok && variant.ok && links
      ? {
          id: id.value,
          type: "additionalLinks",
          variant: variant.value,
          links,
        } satisfies AdditionalLinksBlock
      : null;
  }

  if (block.type === "image") {
    rejectUnknownKeys(block, ["id", "type", "variant", "image", "caption"], path, state);
    const variant = parseEnum(
      block.variant,
      ["framed", "wide"] as const,
      [...path, "variant"],
      state,
      "image variant",
    );
    const image = parseImageRef(block.image, [...path, "image"], state);
    const caption = parseNullableText(
      block.caption,
      MAX_CAPTION_CHARS,
      [...path, "caption"],
      state,
    );
    return id.ok && variant.ok && image && caption.ok
      ? {
          id: id.value,
          type: "image",
          variant: variant.value,
          image,
          caption: caption.value,
        } satisfies ImageBlock
      : null;
  }

  if (block.type === "gallery") {
    rejectUnknownKeys(block, ["id", "type", "variant", "items"], path, state);
    const variant = parseEnum(
      block.variant,
      ["grid", "strip"] as const,
      [...path, "variant"],
      state,
      "gallery variant",
    );
    const items = parseGalleryItems(block.items, [...path, "items"], state);
    return id.ok && variant.ok && items
      ? {
          id: id.value,
          type: "gallery",
          variant: variant.value,
          items,
        } satisfies GalleryBlock
      : null;
  }

  if (block.type === "calloutQuote") {
    rejectUnknownKeys(
      block,
      ["id", "type", "variant", "text", "attribution"],
      path,
      state,
    );
    const variant = parseEnum(
      block.variant,
      ["note", "quote"] as const,
      [...path, "variant"],
      state,
      "callout variant",
    );
    const text = parseRequiredText(
      block.text,
      MAX_CALLOUT_CHARS,
      [...path, "text"],
      state,
    );
    const attribution = parseNullableText(
      block.attribution,
      MAX_QUOTE_ATTRIBUTION_CHARS,
      [...path, "attribution"],
      state,
    );
    if (variant.ok && variant.value === "note" && attribution.ok && attribution.value) {
      addError(state, [...path, "attribution"], "Note attribution must be null.");
    }
    return id.ok && variant.ok && text.ok && attribution.ok &&
        (variant.value === "quote" || attribution.value === null)
      ? {
          id: id.value,
          type: "calloutQuote",
          variant: variant.value,
          text: text.value,
          attribution: attribution.value,
        } satisfies CalloutQuoteBlock
      : null;
  }

  if (block.type === "embed") {
    rejectUnknownKeys(
      block,
      ["id", "type", "variant", "url", "title", "showFrame"],
      path,
      state,
    );
    const variant = parseEnum(
      block.variant,
      ["compact", "standard", "widescreen"] as const,
      [...path, "variant"],
      state,
      "embed variant",
    );
    const url = parseNullableHttpsUrl(block.url, [...path, "url"], state);
    if (url.ok && url.value === null) {
      addError(state, [...path, "url"], "Embed URL cannot be empty.");
    }
    const title = parseRequiredText(
      block.title,
      MAX_EMBED_TITLE_CHARS,
      [...path, "title"],
      state,
    );
    // Embed blocks created before the frame control predate this key. Treat
    // its absence as the original framed presentation and return the complete
    // current shape, so stored drafts need no database rewrite.
    const showFrame = Object.hasOwn(block, "showFrame")
      ? block.showFrame
      : true;
    if (typeof showFrame !== "boolean") {
      addError(state, [...path, "showFrame"], "Show frame must be a boolean.");
    }
    return id.ok && variant.ok && url.ok && url.value && title.ok &&
        typeof showFrame === "boolean"
      ? {
          id: id.value,
          type: "embed",
          variant: variant.value,
          url: url.value,
          title: title.value,
          showFrame,
        } satisfies EmbedBlock
      : null;
  }

  addError(state, [...path, "type"], "Unknown member block type.");
  return null;
}

/**
 * Parses a row entry at the document boundary. Row children go through the
 * leaf-only `parseBlock`, never recursively through entry parsing, so a
 * nested row fails with "Unknown member block type." at its own child path.
 */
function parseRow(
  entry: Record<string, unknown>,
  path: (string | number)[],
  state: ParseState,
): MemberBlockRow | null {
  rejectUnknownKeys(entry, ["type", "ratio", "blocks"], path, state);
  const ratio = parseEnum(
    entry.ratio,
    MEMBER_BLOCK_ROW_RATIOS,
    [...path, "ratio"],
    state,
    "row ratio",
  );
  if (!Array.isArray(entry.blocks)) {
    addError(state, [...path, "blocks"], "Row blocks must be an array of exactly two leaf blocks.");
    return null;
  }
  if (entry.blocks.length !== 2) {
    addError(state, [...path, "blocks"], "A row must contain exactly two leaf blocks.");
  }
  // Explicit indices: map/every skip holes, so a sparse array would
  // otherwise yield an undefined tuple slot.
  const left = parseBlock(entry.blocks[0], [...path, "blocks", 0], state);
  const right = parseBlock(entry.blocks[1], [...path, "blocks", 1], state);
  return ratio.ok && left && right && entry.blocks.length === 2
    ? { type: "row", ratio: ratio.value, blocks: [left, right] }
    : null;
}

function parseEntry(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): MemberPageEntry | null {
  const entry = requirePlainObject(value, path, state);
  if (!entry) return null;
  if (entry.type === "row") return parseRow(entry, path, state);
  return parseBlock(entry, path, state);
}

function parseEntries(
  value: unknown,
  path: (string | number)[],
  state: ParseState,
): MemberPageEntry[] | null {
  if (!Array.isArray(value)) {
    addError(state, path, "Blocks must be an array.");
    return null;
  }
  const entries = value.map((entry, index) =>
    parseEntry(entry, [...path, index], state)
  );
  const parsed = entries.every(
    (entry): entry is MemberPageEntry => entry !== null,
  )
    ? entries
    : null;
  if (!parsed) return null;

  const leafCount = parsed.reduce(
    (total, entry) => total + (entry.type === "row" ? entry.blocks.length : 1),
    0,
  );
  if (leafCount > MAX_BLOCKS) {
    addError(state, path, `A member page may contain at most ${MAX_BLOCKS} blocks.`);
    return null;
  }
  return parsed;
}

function serializedDocumentSize(value: unknown): Parsed<number> {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return { ok: true, value: 0 };
    return {
      ok: true,
      value: new TextEncoder().encode(serialized).byteLength,
    };
  } catch {
    return { ok: false };
  }
}

export function parseMemberPageDocumentV2(
  value: unknown,
): MemberPageDocumentV2ParseResult {
  const serializedSize = serializedDocumentSize(value);
  if (!serializedSize.ok) {
    return {
      success: false,
      errors: [{ path: [], message: "Document must be JSON-serializable." }],
    };
  }
  if (serializedSize.value > MAX_DOCUMENT_BYTES) {
    return {
      success: false,
      errors: [{
        path: [],
        message: `Document cannot exceed ${MAX_DOCUMENT_BYTES} UTF-8 JSON bytes.`,
      }],
    };
  }

  const state: ParseState = {
    errors: [],
    ids: new Set(),
    assetIds: new Set(),
    featuredProjectBlocks: 0,
  };
  const document = requirePlainObject(value, [], state);
  if (!document) return { success: false, errors: state.errors };
  rejectUnknownKeys(document, ["schemaVersion", "frame", "blocks"], [], state);

  if (document.schemaVersion !== 2) {
    addError(state, ["schemaVersion"], "Schema version must be exactly 2.");
  }
  const frame = parseFrame(document.frame, ["frame"], state);
  const blocks = parseEntries(document.blocks, ["blocks"], state);

  if (state.featuredProjectBlocks > MAX_FEATURED_PROJECT_BLOCKS) {
    addError(
      state,
      ["blocks"],
      `A member page may contain at most ${MAX_FEATURED_PROJECT_BLOCKS} featured project block.`,
    );
  }
  if (state.assetIds.size > MAX_READY_ASSETS) {
    addError(
      state,
      [],
      `A member page may reference at most ${MAX_READY_ASSETS} unique ready assets.`,
    );
  }

  if (
    state.errors.length > 0 ||
    document.schemaVersion !== 2 ||
    !frame ||
    !blocks
  ) {
    return { success: false, errors: state.errors };
  }
  return { success: true, doc: { schemaVersion: 2, frame, blocks } };
}
