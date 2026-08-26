import {
  isExactObject,
  privateEmpty,
  privateJson,
  readBoundedJson,
  validateMemberAssetMutationOrigin,
} from "@/app/api/member-page-assets/http";
import { deleteOwnedMemberPageAsset } from "@/lib/members/assets/dal";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const origin = validateMemberAssetMutationOrigin(request);
  if (origin === "disabled") return privateJson({ error: "not_found" }, 404);
  if (origin !== "valid") return privateJson({ error: "invalid_request_origin" }, 403);

  const body = await readBoundedJson(request);
  if (!isExactObject(body, ["slug"])) {
    return privateJson({ error: "invalid_request" }, 400);
  }
  const { assetId } = await params;
  let result;
  try {
    result = await deleteOwnedMemberPageAsset(body.slug, assetId);
  } catch {
    return privateJson({ error: "service_unavailable" }, 503);
  }
  switch (result.status) {
    case "success":
      return privateEmpty();
    case "invalid":
      return privateJson({ error: "invalid_request" }, 400);
    case "referenced":
      return privateJson({ error: "asset_referenced" }, 409);
    case "conflict":
      return privateJson({ error: "asset_conflict" }, 409);
    case "not-found-or-forbidden":
      return privateJson({ error: "not_found" }, 404);
    case "unavailable":
      return privateJson({ error: "service_unavailable" }, 503);
  }
}
