"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import {
  createMemberPage,
  MemberAccessError,
  MemberMutationError,
  reassignMemberPage,
  setMemberPublication,
} from "@/lib/members/dal";
import type { MemberFieldErrors } from "@/lib/members/validation";
import { memberPath } from "@/lib/site";

export interface AdminMemberActionState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors: MemberFieldErrors;
}

function mutationFailure(error: unknown): AdminMemberActionState | null {
  if (error instanceof MemberMutationError) {
    return {
      status: "error",
      message: error.message,
      fieldErrors: error.fieldErrors,
    };
  }
  if (error instanceof MemberAccessError) {
    return {
      status: "error",
      message:
        error.code === "unauthenticated"
          ? "Your session ended. Sign in again."
          : "Administrator access is required.",
      fieldErrors: {},
    };
  }
  return null;
}

function refreshMemberSurfaces(slug?: string) {
  revalidatePath("/admin/members");
  revalidatePath("/members");
  revalidatePath("/api/members");
  if (slug) revalidatePath(memberPath(slug));
}

export async function createMemberPageAction(
  _previousState: AdminMemberActionState,
  formData: FormData,
): Promise<AdminMemberActionState> {
  try {
    const slug = await createMemberPage({
      ownerAccountId: formData.get("ownerAccountId"),
      slug: formData.get("slug"),
      displayName: formData.get("displayName"),
      isPublished: formData.get("isPublished") === "on",
    });
    refreshMemberSurfaces(slug);
    return {
      status: "success",
      message: `Created /m/${slug}.`,
      fieldErrors: {},
    };
  } catch (error) {
    const failure = mutationFailure(error);
    if (failure) return failure;
    throw error;
  }
}
export async function manageMemberPageAction(
  _previousState: AdminMemberActionState,
  formData: FormData,
): Promise<AdminMemberActionState> {
  const operation = formData.get("operation");
  try {
    let slug: string;
    let message: string;
    if (operation === "publish") {
      slug = await setMemberPublication(formData.get("pageId"), true);
      message = `Published /m/${slug}.`;
    } else if (operation === "unpublish") {
      slug = await setMemberPublication(formData.get("pageId"), false);
      message = `Unpublished /m/${slug}.`;
    } else if (operation === "reassign") {
      slug = await reassignMemberPage(
        formData.get("pageId"),
        formData.get("ownerAccountId"),
      );
      message = `Reassigned /m/${slug}.`;
    } else {
      throw new MemberMutationError("invalid", "Choose a valid page action.");
    }

    refreshMemberSurfaces(slug);
    return { status: "success", message, fieldErrors: {} };
  } catch (error) {
    const failure = mutationFailure(error);
    if (failure) return failure;
    throw error;
  }
}
