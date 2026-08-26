import {
  MEMBER_ASSET_PRIVATE_CACHE_CONTROL,
  MEMBER_ASSET_PUBLIC_CACHE_CONTROL,
} from "@/lib/members/assets/config";
import { readMemberPageAssetForServing } from "@/lib/members/assets/dal";
import { formatR2IfMatch } from "@/lib/members/assets/types";

export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": MEMBER_ASSET_PRIVATE_CACHE_CONTROL,
      Pragma: "no-cache",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const { assetId } = await params;
  let result;
  try {
    result = await readMemberPageAssetForServing(assetId);
  } catch {
    result = { status: "unavailable" } as const;
  }
  if (result.status === "not-found") return notFound();
  if (result.status === "unavailable") {
    return new Response(null, {
      status: 503,
      headers: {
        "Cache-Control": MEMBER_ASSET_PRIVATE_CACHE_CONTROL,
        Pragma: "no-cache",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const etag = formatR2IfMatch(result.etag);
  if (etag === null) return notFound();
  const headers = new Headers({
    "Cache-Control": result.visibility === "public"
      ? MEMBER_ASSET_PUBLIC_CACHE_CONTROL
      : MEMBER_ASSET_PRIVATE_CACHE_CONTROL,
    "Content-Length": String(result.byteSize),
    "Content-Type": result.mimeType,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
  if (result.visibility === "private") {
    headers.set("Pragma", "no-cache");
    headers.set("Vary", "Cookie");
  }
  return new Response(result.bytes as BodyInit, { status: 200, headers });
}
