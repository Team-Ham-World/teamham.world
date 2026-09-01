import {
  getAuthConfig,
  getAuthMode,
  validateLogoutOrigin,
  validateRequestOrigin,
} from "@/lib/auth/config";
import { hashSessionToken, isValidSessionToken } from "@/lib/auth/crypto";
import { verifySession, type VerifiedAccount } from "@/lib/auth/db";
import {
  applyProtectedHeaders,
  createDisabledModeNotFoundResponse,
  getSingleCookieValue,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/http";
import {
  getPufftonLeaderboard,
  isValidPufftonScore,
  isValidPufftonStat,
  savePufftonScore,
} from "@/lib/puffton/leaderboard";

function json(body: unknown, status = 200): Response {
  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

type MemberResult =
  | { kind: "member"; account: VerifiedAccount; databaseUrl: string }
  | { kind: "signed-out" }
  | { kind: "response"; response: Response };

async function authenticate(request: Request): Promise<MemberResult> {
  let mode;
  try {
    mode = getAuthMode();
  } catch {
    return { kind: "response", response: createDisabledModeNotFoundResponse() };
  }
  if (mode === "disabled") {
    return { kind: "response", response: createDisabledModeNotFoundResponse() };
  }

  let config;
  try {
    config = getAuthConfig();
  } catch {
    return { kind: "response", response: json({ error: "server_configuration_error" }, 500) };
  }

  if (config.mode === "production" && !validateRequestOrigin(request, config)) {
    return { kind: "response", response: json({ error: "invalid_request_host" }, 400) };
  }

  const cookie = getSingleCookieValue(request, SESSION_COOKIE_NAME);
  if (cookie.status !== "found" || !isValidSessionToken(cookie.value)) {
    return { kind: "signed-out" };
  }

  try {
    const result = await verifySession(hashSessionToken(cookie.value), config.databaseUrl);
    return result.valid
      ? { kind: "member", account: result.account, databaseUrl: config.databaseUrl }
      : { kind: "signed-out" };
  } catch {
    return { kind: "response", response: json({ error: "service_unavailable" }, 503) };
  }
}

export async function GET(request: Request): Promise<Response> {
  const member = await authenticate(request);
  if (member.kind === "response") return member.response;
  if (member.kind === "signed-out") {
    return json({
      authenticated: false,
      username: null,
      personalBest: 0,
      stats: { gamesPlayed: 0, gamesWon: 0, totalVp: 0, currentStreak: 0, maxStreak: 0 },
      scores: [],
    });
  }

  try {
    const snapshot = await getPufftonLeaderboard(member.account.id, member.databaseUrl);
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request_body" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_request_body" }, 400);
  }

  const payload = body as Record<string, unknown>;

  if (!("score" in payload) || !isValidPufftonScore(payload.score)) {
    return json({ error: "invalid_score" }, 400);
  }

  const gamesPlayed = payload.gamesPlayed !== undefined ? payload.gamesPlayed : 0;
  const gamesWon = payload.gamesWon !== undefined ? payload.gamesWon : 0;
  const totalVp = payload.totalVp !== undefined ? payload.totalVp : 0;
  const currentStreak = payload.currentStreak !== undefined ? payload.currentStreak : 0;
  const maxStreak = payload.maxStreak !== undefined ? payload.maxStreak : 0;

  if (
    !isValidPufftonStat(gamesPlayed) ||
    !isValidPufftonStat(gamesWon) ||
    !isValidPufftonStat(totalVp) ||
    !isValidPufftonStat(currentStreak) ||
    !isValidPufftonStat(maxStreak)
  ) {
    return json({ error: "invalid_stats" }, 400);
  }

  try {
    await savePufftonScore(
      member.account.id,
      {
        score: payload.score,
        gamesPlayed,
        gamesWon,
        totalVp,
        currentStreak,
        maxStreak,
      },
      member.databaseUrl,
    );
    const snapshot = await getPufftonLeaderboard(member.account.id, member.databaseUrl);
    return json({
      authenticated: true,
      username: member.account.username,
      ...snapshot,
    });
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }
}
