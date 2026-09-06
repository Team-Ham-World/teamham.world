import { getAuthConfig, validateLogoutOrigin } from "@/lib/auth/config";
import { authenticatePuffdleMember as authenticate, puffdleJson as json, readPuffdleBody } from "@/lib/puffdle/http";
import { getPuffdleLeaderboard, savePuffdleScore } from "@/lib/puffdle/leaderboard";
import { isValidPuffdleScore, isValidPuffdleStats } from "@/lib/puffdle/contracts";

export async function GET(request: Request): Promise<Response> {
  const member = await authenticate(request);
  if (member.kind === "response") return member.response;
  if (member.kind === "signed-out") {
    return json({
      authenticated: false,
      username: null,
      personalBest: 0,
      stats: { gamesPlayed: 0, gamesWon: 0, currentStreak: 0, maxStreak: 0 },
      scores: [],
    });
  }

  try {
    const snapshot = await getPuffdleLeaderboard(member.account.id, member.databaseUrl);
    return json({
      authenticated: true,
      username: member.account.username,
      ...snapshot,
    });
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  const member = await authenticate(request);
  if (member.kind === "response") return member.response;
  if (member.kind === "signed-out") return json({ error: "authentication_required" }, 401);

  const config = getAuthConfig();
  if (!validateLogoutOrigin(request, config)) {
    return json({ error: "invalid_request_origin" }, 403);
  }

  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "unsupported_media_type" }, 415);
  }
  if (Number(request.headers.get("content-length")) > 2_048) {
    return json({ error: "request_body_too_large" }, 413);
  }
  let body: unknown;
  try {
    body = await readPuffdleBody(request);
  } catch (error) {
    return error instanceof RangeError
      ? json({ error: "request_body_too_large" }, 413)
      : json({ error: "invalid_request_body" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_request_body" }, 400);
  }

  const payload = body as Record<string, unknown>;

  if (!("score" in payload) || !isValidPuffdleScore(payload.score)) {
    return json({ error: "invalid_score" }, 400);
  }

  const gamesPlayed = payload.gamesPlayed !== undefined ? payload.gamesPlayed : 0;
  const gamesWon = payload.gamesWon !== undefined ? payload.gamesWon : 0;
  const currentStreak = payload.currentStreak !== undefined ? payload.currentStreak : 0;
  const maxStreak = payload.maxStreak !== undefined ? payload.maxStreak : 0;

  const stats = { gamesPlayed, gamesWon, currentStreak, maxStreak };
  if (!isValidPuffdleStats(stats)) {
    return json({ error: "invalid_stats" }, 400);
  }

  try {
    await savePuffdleScore(
      member.account.id,
      {
        score: payload.score,
        ...stats,
      },
      member.databaseUrl,
    );
    const snapshot = await getPuffdleLeaderboard(member.account.id, member.databaseUrl);
    return json({
      authenticated: true,
      username: member.account.username,
      ...snapshot,
    });
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }
}
