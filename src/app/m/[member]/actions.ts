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
  type MemberFieldErrors,
} from "@/lib/members/validation";
import { memberPath } from "@/lib/site";

export interface MemberEditorState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors: MemberFieldErrors;
}

export async function updateMemberPageAction(
  _previousState: MemberEditorState,
  formData: FormData,
): Promise<MemberEditorState> {
  const slug = formData.get("slug");

  try {
    const updatedSlug = await updateOwnedMemberPage(
      slug,
      memberContentFromFormData(formData),
    );
    revalidatePath(memberPath(updatedSlug));
    revalidatePath("/members");
    revalidatePath("/api/members");
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
