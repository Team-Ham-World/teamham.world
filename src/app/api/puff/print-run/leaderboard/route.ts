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
  getPrintRunLeaderboard,
  isValidPrintRunScore,
  savePrintRunHighScore,
} from "@/lib/puff/print-run-leaderboard";

const SIGNED_OUT_PAYLOAD = {
  authenticated: false,
  username: null,
  personalBest: 0,
  scores: [],
} as const;

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
  if (member.kind === "signed-out") return json(SIGNED_OUT_PAYLOAD);

  try {
    const snapshot = await getPrintRunLeaderboard(member.account.id, member.databaseUrl);
    if (snapshot === null) return json(SIGNED_OUT_PAYLOAD);
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
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !("score" in body) ||
    !isValidPrintRunScore(body.score)
  ) {
    return json({ error: "invalid_score" }, 400);
  }

  try {
    const saved = await savePrintRunHighScore(member.account.id, body.score, member.databaseUrl);
    if (saved === null) return json({ error: "authentication_required" }, 401);

    const snapshot = await getPrintRunLeaderboard(member.account.id, member.databaseUrl);
    if (snapshot === null) return json({ error: "authentication_required" }, 401);
    return json({
      authenticated: true,
      username: member.account.username,
      ...snapshot,
    });
  } catch {
    return json({ error: "service_unavailable" }, 503);
  }
}
