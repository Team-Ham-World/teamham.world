import {
  isExactObject,
  privateJson,
  readBoundedJson,
  validateMemberAssetMutationOrigin,
} from "@/app/api/member-page-assets/http";
import { allocateOwnedMemberPageAsset } from "@/lib/members/assets/dal";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const origin = validateMemberAssetMutationOrigin(request);
  if (origin === "disabled") return privateJson({ error: "not_found" }, 404);
  if (origin !== "valid") return privateJson({ error: "invalid_request_origin" }, 403);

  const body = await readBoundedJson(request);
  if (!isExactObject(body, ["slug", "mimeType", "byteSize"])) {
    return privateJson({ error: "invalid_request" }, 400);
  }

  let result;
  try {
    result = await allocateOwnedMemberPageAsset(
      body.slug,
      body.mimeType,
      body.byteSize,
    );
  } catch {
    return privateJson({ error: "service_unavailable" }, 503);
  }
  switch (result.status) {
    case "success":
      return privateJson(result.data, 201);
    case "invalid":
      return privateJson({ error: "invalid_request" }, 400);
    case "pending-limit":
      return privateJson({ error: "pending_upload_limit" }, 409);
    case "rate-limit":
      return privateJson({ error: "upload_rate_limit" }, 429);
    case "not-found-or-forbidden":
      return privateJson({ error: "not_found" }, 404);
    case "unavailable":
      return privateJson({ error: "service_unavailable" }, 503);
  }
}
