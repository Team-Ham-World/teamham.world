import {
  getAuthConfig,
  getAuthMode,
  validateRequestOrigin,
} from "@/lib/auth/config";
import { hashSessionToken, isValidSessionToken } from "@/lib/auth/crypto";
import { verifySession, type VerifiedAccount } from "@/lib/auth/db";
import {
  applyProtectedHeaders,
  getSingleCookieValue,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/http";
import type { TileEvaluation } from "@/lib/puffdle/game";

export interface PlayerPresence {
  id: string;
  username: string;
  avatarUrl?: string;
  evaluations: TileEvaluation[][];
  status: "playing" | "won" | "lost";
  attempts: number;
  lastActive: number;
  isSelf?: boolean;
}

// In-memory active player cache (recent 10 minutes)
const activePresences = new Map<string, PlayerPresence>();

// Cleanup stale players older than 10 mins
function pruneStalePresence(): void {
  const now = Date.now();
  for (const [id, presence] of activePresences.entries()) {
    if (now - presence.lastActive > 10 * 60 * 1000) {
      activePresences.delete(id);
    }
  }
}

function json(body: unknown, status = 200): Response {
  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

async function authenticate(request: Request): Promise<{
  account: VerifiedAccount | null;
  databaseUrl?: string;
}> {
  let mode;
  try {
    mode = getAuthMode();
  } catch {
    return { account: null };
  }
  if (mode === "disabled") return { account: null };

  let config;
  try {
    config = getAuthConfig();
  } catch {
    return { account: null };
  }

  if (config.mode === "production" && !validateRequestOrigin(request, config)) {
    return { account: null };
  }

  const cookie = getSingleCookieValue(request, SESSION_COOKIE_NAME);
  if (cookie.status !== "found" || !isValidSessionToken(cookie.value)) {
    return { account: null };
  }

  try {
    const result = await verifySession(hashSessionToken(cookie.value), config.databaseUrl);
    return {
      account: result.valid ? result.account : null,
      databaseUrl: config.databaseUrl,
    };
  } catch {
    return { account: null };
  }
}

export async function GET(request: Request): Promise<Response> {
  pruneStalePresence();
  const { account } = await authenticate(request);

  const players: PlayerPresence[] = Array.from(activePresences.values()).map((p) => ({
    ...p,
    isSelf: account ? p.id === account.id : false,
  }));

  return json({ players });
}

export async function POST(request: Request): Promise<Response> {
  pruneStalePresence();
  const { account } = await authenticate(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request_body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return json({ error: "invalid_request_body" }, 400);
  }

  const payload = body as {
    guestId?: string;
    username?: string;
    evaluations: TileEvaluation[][];
    status: "playing" | "won" | "lost";
  };

  const playerId = account ? account.id : payload.guestId || `guest-${Date.now()}`;
  const username = (account?.username) || payload.username || "Guest Agent";

  const presence: PlayerPresence = {
    id: playerId,
    username,
    evaluations: Array.isArray(payload.evaluations) ? payload.evaluations.slice(0, 6) : [],
    status: payload.status === "won" || payload.status === "lost" ? payload.status : "playing",
    attempts: Array.isArray(payload.evaluations) ? payload.evaluations.length : 0,
    lastActive: Date.now(),
  };

  activePresences.set(playerId, presence);

  return json({ ok: true, presence });
}
