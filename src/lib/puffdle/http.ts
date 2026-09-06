import {
  getAuthConfig,
  getAuthMode,
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
export function puffdleJson(body: unknown, status = 200): Response {
  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

type MemberResult =
  | { kind: "member"; account: VerifiedAccount; databaseUrl: string }
  | { kind: "signed-out" }
  | { kind: "response"; response: Response };

export async function authenticatePuffdleMember(request: Request): Promise<MemberResult> {
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
    return { kind: "response", response: puffdleJson({ error: "server_configuration_error" }, 500) };
  }

  if (config.mode === "production" && !validateRequestOrigin(request, config)) {
    return { kind: "response", response: puffdleJson({ error: "invalid_request_host" }, 400) };
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
    return { kind: "response", response: puffdleJson({ error: "service_unavailable" }, 503) };
  }
}

const MAX_BODY_BYTES = 2_048;

export async function readPuffdleBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Body too large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

