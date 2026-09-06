import { getAuthConfig, validateLogoutOrigin } from "@/lib/auth/config";
import { authenticatePuffdleMember as authenticate, puffdleJson as json, readPuffdleBody } from "@/lib/puffdle/http";
import { getDailyGame, isDailyGuess, submitDailyGuess } from "@/lib/puffdle/daily";

export async function GET(request: Request): Promise<Response> {
  const member = await authenticate(request);
  if (member.kind === "response") return member.response;
  if (member.kind === "signed-out") return json({ authenticated: false });
  try { return json(await getDailyGame(member.account.id, member.databaseUrl)); }
  catch { return json({ error: "service_unavailable" }, 503); }
}

export async function POST(request: Request): Promise<Response> {
  const member = await authenticate(request);
  if (member.kind === "response") return member.response;
  if (member.kind === "signed-out") return json({ authenticated: false }, 401);
  if (!validateLogoutOrigin(request, getAuthConfig())) return json({ error: "invalid_request_origin" }, 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "unsupported_media_type" }, 415);
  let input: unknown;
  try { input = await readPuffdleBody(request); }
  catch (error) { return json({ error: "invalid_request_body" }, error instanceof RangeError ? 413 : 400); }
  if (!isDailyGuess(input)) return json({ error: "invalid_guess" }, 400);
  try {
    const { conflict, snapshot } = await submitDailyGuess(member.account.id, input, member.databaseUrl);
    return json(snapshot, conflict ? 409 : 200);
  } catch { return json({ error: "service_unavailable" }, 503); }
}
