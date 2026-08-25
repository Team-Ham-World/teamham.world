import { listPublishedMembers } from "@/lib/members/dal";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200
        ? "public, max-age=30, stale-while-revalidate=120"
        : "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET() {
  try {
    const members = await listPublishedMembers(6);
    return json({ members });
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }
}
