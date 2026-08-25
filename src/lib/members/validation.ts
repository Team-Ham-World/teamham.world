import { PROJECTS, type ProjectStatus } from "@/data/projects";
import {
  isValidMemberSlug,
  type MemberShowcase,
} from "@/lib/members/model";

export const MEMBER_LIMITS = {
  displayName: 80,
  blurb: 500,
  websiteUrl: 2048,
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

export type MemberField =
  | "slug"
  | "ownerAccountId"
  | "displayName"
  | "blurb"
  | "websiteUrl"
  | "showcase";

export type MemberFieldErrors = Partial<Record<MemberField, string>>;

export interface MemberContentInput {
  displayName: string;
  blurb: string | null;
  websiteUrl: string | null;
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

function optionalTrimmedString(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
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
  if (normalized.length > maximum || !isHttpsUrl(normalized)) return undefined;
  return normalized;
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

  if (
    !name ||
    name.length > MEMBER_LIMITS.showcaseName ||
    !shortDescription ||
    shortDescription.length > MEMBER_LIMITS.showcaseDescription ||
    !type ||
    type.length > MEMBER_LIMITS.showcaseType ||
    typeof status !== "string" ||
    !PROJECT_STATUSES.has(status as ProjectStatus) ||
    url === undefined ||
    repository === undefined
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
  };
}

export function validateMemberContent(
  input: Record<string, unknown>,
): ValidationResult<MemberContentInput> {
  const errors: MemberFieldErrors = {};
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  const blurb = optionalTrimmedString(input.blurb);
  const websiteUrl = parseOptionalHttpsUrl(
    input.websiteUrl,
    MEMBER_LIMITS.websiteUrl,
  );

  if (!displayName) {
    errors.displayName = "Enter a display name.";
  } else if (displayName.length > MEMBER_LIMITS.displayName) {
    errors.displayName = `Use ${MEMBER_LIMITS.displayName} characters or fewer.`;
  }

  if (blurb === undefined || (blurb && blurb.length > MEMBER_LIMITS.blurb)) {
    errors.blurb = `Use ${MEMBER_LIMITS.blurb} characters or fewer.`;
  }

  if (websiteUrl === undefined) {
    errors.websiteUrl = "Enter a complete https:// URL or leave this blank.";
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
    };
  }
  return { kind };
}

export function memberContentFromFormData(formData: FormData) {
  return {
    displayName: formData.get("displayName"),
    blurb: formData.get("blurb"),
    websiteUrl: formData.get("websiteUrl"),
    showcase: showcaseFromFormData(formData),
  };
}
