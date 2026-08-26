import { privateJson } from "@/app/api/member-page-assets/http";
import { listOwnedMemberPageAssets } from "@/lib/members/assets/dal";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return privateJson({ error: "invalid_request" }, 400);
  }
  if (
    [...url.searchParams.keys()].some((key) => key !== "slug") ||
    url.searchParams.getAll("slug").length !== 1
  ) {
    return privateJson({ error: "invalid_request" }, 400);
  }

  let result;
  try {
    result = await listOwnedMemberPageAssets(url.searchParams.get("slug"));
  } catch {
    return privateJson({ error: "service_unavailable" }, 503);
  }
  switch (result.status) {
    case "success":
      return privateJson({ assets: result.assets });
    case "invalid":
      return privateJson({ error: "invalid_request" }, 400);
    case "not-found-or-forbidden":
      return privateJson({ error: "not_found" }, 404);
    case "unavailable":
      return privateJson({ error: "service_unavailable" }, 503);
  }
}
