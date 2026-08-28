"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import {
  autosaveOwnedMemberPageDraftV2,
  parsePublicationToken,
  publishOwnedMemberPageV2,
  resetOwnedMemberPageDraftV2,
  unpublishOwnedMemberPageV2,
} from "@/lib/members/v2/dal";
import { validateMemberSlug } from "@/lib/members/validation";
import { memberPath } from "@/lib/site";

export interface MemberPageV2AutosaveActionInput {
  slug: string;
  expectedDraftRev: number;
  document: MemberPageDocumentV2;
}

export interface MemberPageV2PublishActionInput {
  slug: string;
  expectedDraftRev: number;
}

export interface MemberPageV2UnpublishActionInput {
  slug: string;
  /**
   * Opaque publication token this editor loaded: the server-issued canonical
   * UTC text form of the row's `published_at` boundary with the full Postgres
   * precision preserved, or null for a page never published. The token is
   * validated and passed through verbatim — never reinterpreted through a
   * JavaScript `Date`, whose millisecond precision would make the guard
   * reject this editor's own fresh generation as stale.
   */
  expectedPublishedAt: string | null;
}

export interface MemberPageV2ResetActionInput {
  slug: string;
  expectedDraftRev: number;
}

export type MemberPageV2ActionFieldErrors = Partial<Record<
  "slug" | "expectedDraftRev" | "expectedPublishedAt" | "document",
  string
>>;

export type MemberPageV2AutosaveActionResult =
  | {
      status: "saved";
      message: "Saved.";
      fieldErrors: MemberPageV2ActionFieldErrors;
      draftRev: number;
      draftUpdatedAt: string;
    }
  | {
      status: "conflict";
      message: "Conflict detected.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "rate-limit";
      message: "Saving is paused because changes are arriving too quickly. Wait a minute, then retry.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "invalid";
      message: "Save failed.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "unavailable";
      message: "Save unavailable.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    };

export type MemberPageV2PublishActionResult =
  | {
      status: "published";
      message: "Published.";
      fieldErrors: MemberPageV2ActionFieldErrors;
      slug: string;
      draftRev: number;
      publishedAt: string;
    }
  | {
      status: "conflict";
      message: "Conflict detected.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "hold";
      message: "Publishing is blocked by a moderation hold.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "rate-limit";
      message: "Publishing is moving too quickly. Wait a few minutes, then try again.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "invalid";
      message: "Publish failed.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "unavailable";
      message: "Publish unavailable.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    };

export type MemberPageV2UnpublishActionResult =
  | {
      status: "unpublished";
      message: "Unpublished.";
      fieldErrors: MemberPageV2ActionFieldErrors;
      slug: string;
      unpublishedAt: string;
    }
  | {
      status: "conflict";
      message: "This page was published again in another editor. Reload the editor before unpublishing.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "invalid";
      message: "Unpublish failed.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "unavailable";
      message: "Unpublish unavailable.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    };

export type MemberPageV2ResetActionResult =
  | {
      status: "reset";
      message: "Draft reset.";
      fieldErrors: MemberPageV2ActionFieldErrors;
      document: MemberPageDocumentV2;
      draftRev: number;
      draftUpdatedAt: string;
    }
  | {
      status: "conflict";
      message: "Conflict detected.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "no-snapshot";
      message: "No published snapshot is available.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "invalid";
      message: "Reset failed.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    }
  | {
      status: "unavailable";
      message: "Reset unavailable.";
      fieldErrors: MemberPageV2ActionFieldErrors;
    };

type ParsedInput<T> =
  | { success: true; data: T }
  | { success: false; fieldErrors: MemberPageV2ActionFieldErrors };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every(
      (key) => typeof key === "string" && expectedKeys.includes(key),
    )
  );
}

function parseSlug(value: unknown): ParsedInput<string> {
  const slug = validateMemberSlug(value);
  return slug
    ? { success: true, data: slug }
    : {
        success: false,
        fieldErrors: { slug: "Enter a valid member page address." },
      };
}

function parseExpectedDraftRev(value: unknown): ParsedInput<number> {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? { success: true, data: value }
    : {
        success: false,
        fieldErrors: {
          expectedDraftRev: "Reload the editor and try again.",
        },
      };
}

function mergeFieldErrors(
  ...results: ParsedInput<unknown>[]
): MemberPageV2ActionFieldErrors {
  return Object.assign(
    {},
    ...results.flatMap((result) =>
      result.success ? [] : [result.fieldErrors],
    ),
  );
}

function parseAutosaveInput(
  input: unknown,
): ParsedInput<{
  slug: string;
  expectedDraftRev: number;
  document: Record<string, unknown>;
}> {
  if (
    !isPlainObject(input) ||
    !hasExactKeys(input, ["slug", "expectedDraftRev", "document"])
  ) {
    return { success: false, fieldErrors: {} };
  }

  const slug = parseSlug(input.slug);
  const expectedDraftRev = parseExpectedDraftRev(input.expectedDraftRev);
  const document: ParsedInput<Record<string, unknown>> = isPlainObject(
    input.document,
  )
    ? { success: true, data: input.document }
    : {
        success: false,
        fieldErrors: { document: "Page content is required." },
      };
  if (!slug.success || !expectedDraftRev.success || !document.success) {
    return {
      success: false,
      fieldErrors: mergeFieldErrors(slug, expectedDraftRev, document),
    };
  }
  return {
    success: true,
    data: {
      slug: slug.data,
      expectedDraftRev: expectedDraftRev.data,
      document: document.data,
    },
  };
}

function parseRevisionInput(
  input: unknown,
): ParsedInput<{ slug: string; expectedDraftRev: number }> {
  if (
    !isPlainObject(input) ||
    !hasExactKeys(input, ["slug", "expectedDraftRev"])
  ) {
    return { success: false, fieldErrors: {} };
  }

  const slug = parseSlug(input.slug);
  const expectedDraftRev = parseExpectedDraftRev(input.expectedDraftRev);
  if (!slug.success || !expectedDraftRev.success) {
    return {
      success: false,
      fieldErrors: mergeFieldErrors(slug, expectedDraftRev),
    };
  }
  return {
    success: true,
    data: { slug: slug.data, expectedDraftRev: expectedDraftRev.data },
  };
}

/**
 * The token is opaque and server-issued; it is checked for shape and passed
 * through verbatim so the exact stored instant reaches the unpublish guard.
 * Reformatting it here (e.g. through a JavaScript `Date`) would drop the
 * microseconds the guard must match.
 */
function parseExpectedPublishedAt(value: unknown): ParsedInput<string | null> {
  const token = parsePublicationToken(value);
  return token === undefined
    ? {
        success: false,
        fieldErrors: {
          expectedPublishedAt: "Reload the editor and try again.",
        },
      }
    : { success: true, data: token };
}

function parseUnpublishInput(
  input: unknown,
): ParsedInput<{ slug: string; expectedPublishedAt: string | null }> {
  if (
    !isPlainObject(input) ||
    !hasExactKeys(input, ["slug", "expectedPublishedAt"])
  ) {
    return { success: false, fieldErrors: {} };
  }

  const slug = parseSlug(input.slug);
  const expectedPublishedAt = parseExpectedPublishedAt(
    input.expectedPublishedAt,
  );
  if (!slug.success || !expectedPublishedAt.success) {
    return {
      success: false,
      fieldErrors: mergeFieldErrors(slug, expectedPublishedAt),
    };
  }
  return {
    success: true,
    data: {
      slug: slug.data,
      expectedPublishedAt: expectedPublishedAt.data,
    },
  };
}

function revalidateMemberPublicSurfaces(slug: string): void {
  revalidatePath(memberPath(slug));
  revalidatePath("/members");
  revalidatePath("/api/members");
}

export async function autosaveMemberPageV2Action(
  input: MemberPageV2AutosaveActionInput,
): Promise<MemberPageV2AutosaveActionResult> {
  const parsed = parseAutosaveInput(input);
  if (!parsed.success) {
    return {
      status: "invalid",
      message: "Save failed.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await autosaveOwnedMemberPageDraftV2(
    parsed.data.slug,
    parsed.data.expectedDraftRev,
    parsed.data.document,
  );
  switch (result.status) {
    case "success":
      return {
        status: "saved",
        message: "Saved.",
        fieldErrors: {},
        draftRev: result.draftRev,
        draftUpdatedAt: result.draftUpdatedAt,
      };
    case "conflict":
      return {
        status: "conflict",
        message: "Conflict detected.",
        fieldErrors: {},
      };
    case "rate-limit":
      return {
        status: "rate-limit",
        message:
          "Saving is paused because changes are arriving too quickly. Wait a minute, then retry.",
        fieldErrors: {},
      };
    case "invalid":
      return {
        status: "invalid",
        message: "Save failed.",
        fieldErrors: {
          document: "Review the page content and try again.",
        },
      };
    case "not-found-or-forbidden":
      return {
        status: "unavailable",
        message: "Save unavailable.",
        fieldErrors: {},
      };
  }
}

export async function publishMemberPageV2Action(
  input: MemberPageV2PublishActionInput,
): Promise<MemberPageV2PublishActionResult> {
  const parsed = parseRevisionInput(input);
  if (!parsed.success) {
    return {
      status: "invalid",
      message: "Publish failed.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await publishOwnedMemberPageV2(
    parsed.data.slug,
    parsed.data.expectedDraftRev,
  );
  switch (result.status) {
    case "success":
      revalidateMemberPublicSurfaces(result.slug);
      return {
        status: "published",
        message: "Published.",
        fieldErrors: {},
        slug: result.slug,
        draftRev: result.draftRev,
        publishedAt: result.publishedAt,
      };
    case "conflict":
      return {
        status: "conflict",
        message: "Conflict detected.",
        fieldErrors: {},
      };
    case "hold":
      return {
        status: "hold",
        message: "Publishing is blocked by a moderation hold.",
        fieldErrors: {},
      };
    case "rate-limit":
      return {
        status: "rate-limit",
        message:
          "Publishing is moving too quickly. Wait a few minutes, then try again.",
        fieldErrors: {},
      };
    case "invalid":
      return {
        status: "invalid",
        message: "Publish failed.",
        fieldErrors: {
          document: "Review the draft and try again.",
        },
      };
    case "not-found-or-forbidden":
      return {
        status: "unavailable",
        message: "Publish unavailable.",
        fieldErrors: {},
      };
  }
}

export async function unpublishMemberPageV2Action(
  input: MemberPageV2UnpublishActionInput,
): Promise<MemberPageV2UnpublishActionResult> {
  const parsed = parseUnpublishInput(input);
  if (!parsed.success) {
    return {
      status: "invalid",
      message: "Unpublish failed.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await unpublishOwnedMemberPageV2(
    parsed.data.slug,
    parsed.data.expectedPublishedAt,
  );
  switch (result.status) {
    case "success":
      revalidateMemberPublicSurfaces(result.slug);
      return {
        status: "unpublished",
        message: "Unpublished.",
        fieldErrors: {},
        slug: result.slug,
        unpublishedAt: result.unpublishedAt,
      };
    case "conflict":
      return {
        status: "conflict",
        message:
          "This page was published again in another editor. Reload the editor before unpublishing.",
        fieldErrors: {},
      };
    case "invalid":
      return {
        status: "invalid",
        message: "Unpublish failed.",
        fieldErrors: {},
      };
    case "not-found-or-forbidden":
      return {
        status: "unavailable",
        message: "Unpublish unavailable.",
        fieldErrors: {},
      };
  }
}

export async function resetMemberPageV2Action(
  input: MemberPageV2ResetActionInput,
): Promise<MemberPageV2ResetActionResult> {
  const parsed = parseRevisionInput(input);
  if (!parsed.success) {
    return {
      status: "invalid",
      message: "Reset failed.",
      fieldErrors: parsed.fieldErrors,
    };
  }

  const result = await resetOwnedMemberPageDraftV2(
    parsed.data.slug,
    parsed.data.expectedDraftRev,
  );
  switch (result.status) {
    case "success":
      return {
        status: "reset",
        message: "Draft reset.",
        fieldErrors: {},
        document: result.draft,
        draftRev: result.draftRev,
        draftUpdatedAt: result.draftUpdatedAt,
      };
    case "conflict":
      return {
        status: "conflict",
        message: "Conflict detected.",
        fieldErrors: {},
      };
    case "no-snapshot":
      return {
        status: "no-snapshot",
        message: "No published snapshot is available.",
        fieldErrors: {},
      };
    case "invalid":
      return {
        status: "invalid",
        message: "Reset failed.",
        fieldErrors: {},
      };
    case "not-found-or-forbidden":
      return {
        status: "unavailable",
        message: "Reset unavailable.",
        fieldErrors: {},
      };
  }
}
