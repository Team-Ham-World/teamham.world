"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import {
  MemberAccessError,
  MemberMutationError,
  updateOwnedMemberPage,
} from "@/lib/members/dal";
import {
  memberContentFromFormData,
  validateMemberSlug,
  type MemberFieldErrors,
} from "@/lib/members/validation";
import { isMemberPageV2Cohort } from "@/lib/members/v2/feature-flag";
import { memberPath } from "@/lib/site";

export interface MemberEditorState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors: MemberFieldErrors;
}

function revalidateMemberPublicSurfaces(slug: string) {
  revalidatePath(memberPath(slug));
  revalidatePath("/members");
  revalidatePath("/api/members");
}

export async function updateMemberPageAction(
  _previousState: MemberEditorState,
  formData: FormData,
): Promise<MemberEditorState> {
  const slug = formData.get("slug");

  try {
    const normalizedSlug = validateMemberSlug(slug);
    if (normalizedSlug && isMemberPageV2Cohort(normalizedSlug)) {
      return {
        status: "error",
        message: "This page uses the new editor and cannot be saved here.",
        fieldErrors: {},
      };
    }

    const updatedSlug = await updateOwnedMemberPage(
      slug,
      memberContentFromFormData(formData),
    );
    revalidateMemberPublicSurfaces(updatedSlug);
    return {
      status: "success",
      message: "Your page is saved.",
      fieldErrors: {},
    };
  } catch (error) {
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
            ? "Your session ended. Sign in again before saving."
            : "You cannot edit this member page.",
        fieldErrors: {},
      };
    }
    throw error;
  }
}
