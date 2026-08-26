import { isValidMemberSlug } from "@/lib/members/model";

export interface MemberPageV2Environment {
  MEMBER_PAGE_V2_ALLOWLIST?: string;
  MEMBER_PAGE_V2_EDITOR_DISABLED?: string;
}

export type MemberPageV2Cohort =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "slugs"; slugs: readonly string[] };

export interface MemberPageV2Rollout {
  cohort: MemberPageV2Cohort;
  editorDisabled: boolean;
}

export type MemberPageV2RolloutParseResult =
  | { success: true; rollout: MemberPageV2Rollout }
  | { success: false; errors: string[] };

export class MemberPageV2ConfigurationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid member page V2 rollout configuration: ${errors.join(" ")}`);
    this.name = "MemberPageV2ConfigurationError";
    this.errors = errors;
  }
}

export class MemberPageV2EditorUnavailableError extends Error {
  constructor() {
    super("Member page V2 editing is unavailable.");
    this.name = "MemberPageV2EditorUnavailableError";
  }
}

function parseAllowlist(value: string | undefined):
  | { success: true; cohort: MemberPageV2Cohort }
  | { success: false; error: string } {
  if (value === undefined || value === "") {
    return { success: true, cohort: { kind: "none" } };
  }

  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry === "")) {
    return {
      success: false,
      error: "MEMBER_PAGE_V2_ALLOWLIST contains an empty entry.",
    };
  }

  if (entries.includes("all")) {
    if (entries.length !== 1) {
      return {
        success: false,
        error: "MEMBER_PAGE_V2_ALLOWLIST cannot combine all with slugs.",
      };
    }
    return { success: true, cohort: { kind: "all" } };
  }

  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const slug of entries) {
    if (!isValidMemberSlug(slug)) {
      return {
        success: false,
        error: `MEMBER_PAGE_V2_ALLOWLIST contains invalid slug ${JSON.stringify(slug)}.`,
      };
    }
    if (!seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }

  return { success: true, cohort: { kind: "slugs", slugs } };
}

function parseEditorDisabled(value: string | undefined):
  | { success: true; editorDisabled: boolean }
  | { success: false; error: string } {
  if (value === undefined || value === "false") {
    return { success: true, editorDisabled: false };
  }
  if (value === "true") return { success: true, editorDisabled: true };
  return {
    success: false,
    error: "MEMBER_PAGE_V2_EDITOR_DISABLED must be exactly true, false, or unset.",
  };
}

export function parseMemberPageV2Rollout(
  env: MemberPageV2Environment,
): MemberPageV2RolloutParseResult {
  const allowlist = parseAllowlist(env.MEMBER_PAGE_V2_ALLOWLIST);
  const disabled = parseEditorDisabled(env.MEMBER_PAGE_V2_EDITOR_DISABLED);
  const errors = [
    ...(allowlist.success ? [] : [allowlist.error]),
    ...(disabled.success ? [] : [disabled.error]),
  ];
  if (errors.length > 0) return { success: false, errors };

  return {
    success: true,
    rollout: {
      cohort: allowlist.success ? allowlist.cohort : { kind: "none" },
      editorDisabled: disabled.success ? disabled.editorDisabled : true,
    },
  };
}

export function getMemberPageV2Rollout(
  env: MemberPageV2Environment = {
    MEMBER_PAGE_V2_ALLOWLIST: process.env.MEMBER_PAGE_V2_ALLOWLIST,
    MEMBER_PAGE_V2_EDITOR_DISABLED:
      process.env.MEMBER_PAGE_V2_EDITOR_DISABLED,
  },
): MemberPageV2Rollout {
  const parsed = parseMemberPageV2Rollout(env);
  if (!parsed.success) throw new MemberPageV2ConfigurationError(parsed.errors);
  return parsed.rollout;
}

export function isMemberPageV2Cohort(
  slug: string,
  rollout: MemberPageV2Rollout = getMemberPageV2Rollout(),
): boolean {
  if (rollout.cohort.kind === "all") return isValidMemberSlug(slug);
  if (rollout.cohort.kind === "none") return false;
  return rollout.cohort.slugs.includes(slug);
}

export function isMemberPageV2EditorEnabled(
  slug: string,
  rollout: MemberPageV2Rollout = getMemberPageV2Rollout(),
): boolean {
  return !rollout.editorDisabled && isMemberPageV2Cohort(slug, rollout);
}

export function requireMemberPageV2EditorEnabled(
  slug: string,
  rollout: MemberPageV2Rollout = getMemberPageV2Rollout(),
): void {
  if (!isMemberPageV2EditorEnabled(slug, rollout)) {
    throw new MemberPageV2EditorUnavailableError();
  }
}
