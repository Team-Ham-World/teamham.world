import { PROJECTS, type ProjectStatus } from "@/data/projects";
import {
  isValidMemberSlug,
  type MemberShowcase,
} from "@/lib/members/model";
import {
  SOCIAL_PLATFORMS,
  type MemberSocialLinks,
} from "@/lib/members/socials";

export const MEMBER_LIMITS = {
  displayName: 80,
  blurb: 500,
  websiteUrl: 2048,
  socialUrl: 2048,
  showcaseName: 80,
  showcaseDescription: 500,
  showcaseType: 80,
} as const;

const PROJECT_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "planning",
  "in-development",
  "playable",
  "released",
  "paused",
  "retired",
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

export type MemberField =
  | "slug"
  | "ownerAccountId"
  | "displayName"
  | "blurb"
  | "websiteUrl"
  | "socialLinks"
  | "showcase";

export type MemberFieldErrors = Partial<Record<MemberField, string>>;

export interface MemberContentInput {
  displayName: string;
  blurb: string | null;
  websiteUrl: string | null;
  socialLinks: MemberSocialLinks;
  showcase: MemberShowcase | null;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: MemberFieldErrors };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function countCharacters(value: string): number {
  return [...value].length;
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

function optionalTrimmedString(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  if (CONTROL_CHARACTERS.test(value) || hasUnpairedSurrogate(value)) {
    return undefined;
  }
  const trimmed = value.normalize("NFC").trim();
  return trimmed === "" ? null : trimmed;
}

function isHttpsUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const parsed = new URL(value);
  return (
    parsed.protocol === "https:" &&
    Boolean(parsed.hostname) &&
    parsed.username === "" &&
    parsed.password === ""
  );
}

function parseOptionalHttpsUrl(
  value: unknown,
  maximum: number,
): string | null | undefined {
  const normalized = optionalTrimmedString(value);
  if (normalized === null || normalized === undefined) return normalized;
  if (countCharacters(normalized) > maximum || !isHttpsUrl(normalized)) {
    return undefined;
  }
  return normalized;
}

export function parseMemberSocialLinks(value: unknown): MemberSocialLinks | null {
  if (value === null || value === undefined) return {};
  if (!isPlainObject(value)) return null;
  if (!hasOnlyKeys(value, SOCIAL_PLATFORMS.map(({ id }) => id))) return null;

  const socialLinks: MemberSocialLinks = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const url = parseOptionalHttpsUrl(value[platform.id], MEMBER_LIMITS.socialUrl);
    if (url === undefined) return null;
    if (url) socialLinks[platform.id] = url;
  }
  return socialLinks;
}

export function parseMemberShowcase(value: unknown): MemberShowcase | null {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value) || typeof value.kind !== "string") return null;

  if (value.kind === "project") {
    if (!hasOnlyKeys(value, ["kind", "projectSlug"])) return null;
    if (typeof value.projectSlug !== "string") return null;
    if (!PROJECTS.some((project) => project.slug === value.projectSlug)) return null;
    return { kind: "project", projectSlug: value.projectSlug };
  }

  if (value.kind !== "external") return null;
  if (
    !hasOnlyKeys(value, [
      "kind",
      "name",
      "shortDescription",
      "type",
      "status",
      "url",
      "repository",
      "imageUrl",
    ])
  ) {
    return null;
  }

  const name = optionalTrimmedString(value.name);
  const shortDescription = optionalTrimmedString(value.shortDescription);
  const type = optionalTrimmedString(value.type);
  const status = value.status;
  const url = parseOptionalHttpsUrl(value.url, MEMBER_LIMITS.websiteUrl);
  const repository = parseOptionalHttpsUrl(
    value.repository,
    MEMBER_LIMITS.websiteUrl,
  );
  const imageUrl = parseOptionalHttpsUrl(
    value.imageUrl,
    MEMBER_LIMITS.websiteUrl,
  );

  if (
    !name ||
    countCharacters(name) > MEMBER_LIMITS.showcaseName ||
    !shortDescription ||
    countCharacters(shortDescription) > MEMBER_LIMITS.showcaseDescription ||
    !type ||
    countCharacters(type) > MEMBER_LIMITS.showcaseType ||
    typeof status !== "string" ||
    !PROJECT_STATUSES.has(status as ProjectStatus) ||
    url === undefined ||
    repository === undefined ||
    imageUrl === undefined
  ) {
    return null;
  }

  return {
    kind: "external",
    name,
    shortDescription,
    type,
    status: status as ProjectStatus,
    ...(url ? { url } : {}),
    ...(repository ? { repository } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

export function validateMemberContent(
  input: Record<string, unknown>,
): ValidationResult<MemberContentInput> {
  const errors: MemberFieldErrors = {};
  const parsedDisplayName = optionalTrimmedString(input.displayName);
  const displayName = parsedDisplayName ?? "";
  const blurb = optionalTrimmedString(input.blurb);
  const websiteUrl = parseOptionalHttpsUrl(
    input.websiteUrl,
    MEMBER_LIMITS.websiteUrl,
  );
  const socialLinks = parseMemberSocialLinks(input.socialLinks);

  if (!displayName) {
    errors.displayName = "Enter a display name.";
  } else if (countCharacters(displayName) > MEMBER_LIMITS.displayName) {
    errors.displayName = `Use ${MEMBER_LIMITS.displayName} characters or fewer.`;
  }

  if (
    blurb === undefined ||
    (blurb && countCharacters(blurb) > MEMBER_LIMITS.blurb)
  ) {
    errors.blurb = `Use ${MEMBER_LIMITS.blurb} characters or fewer.`;
  }

  if (websiteUrl === undefined) {
    errors.websiteUrl = "Enter a complete https:// URL or leave this blank.";
  }

  if (!socialLinks) {
    errors.socialLinks = "Use complete https:// profile URLs or leave them blank.";
  }

  const showcase = parseMemberShowcase(input.showcase);
  if (input.showcase !== null && input.showcase !== undefined && !showcase) {
    errors.showcase = "Complete the selected showcase with valid links.";
  }

  if (Object.keys(errors).length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      displayName,
      blurb: blurb ?? null,
      websiteUrl: websiteUrl ?? null,
      socialLinks: socialLinks ?? {},
      showcase,
    },
  };
}

export function validateMemberSlug(slug: unknown): string | null {
  if (typeof slug !== "string") return null;
  const normalized = slug.trim();
  return isValidMemberSlug(normalized) ? normalized : null;
}

export function showcaseFromFormData(formData: FormData): unknown {
  const kind = formData.get("showcaseKind");
  if (kind === "none" || kind === null) return null;
  if (kind === "project") {
    return {
      kind,
      projectSlug: formData.get("projectSlug"),
    };
  }
  if (kind === "external") {
    return {
      kind,
      name: formData.get("showcaseName"),
      shortDescription: formData.get("showcaseDescription"),
      type: formData.get("showcaseType"),
      status: formData.get("showcaseStatus"),
      url: formData.get("showcaseUrl"),
      repository: formData.get("showcaseRepository"),
      imageUrl: formData.get("showcaseImageUrl"),
    };
  }
  return { kind };
}

export function memberContentFromFormData(formData: FormData) {
  const socialLinks = Object.fromEntries(
    SOCIAL_PLATFORMS.map(({ id, formName }) => [id, formData.get(formName)]),
  );
  return {
    displayName: formData.get("displayName"),
    blurb: formData.get("blurb"),
    websiteUrl: formData.get("websiteUrl"),
    socialLinks,
    showcase: showcaseFromFormData(formData),
  };
}
