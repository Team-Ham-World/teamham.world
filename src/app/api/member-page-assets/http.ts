import {
  getAuthConfig,
  getAuthMode,
  validateLogoutOrigin,
  validateRequestOrigin,
} from "@/lib/auth/config";
import { MEMBER_ASSET_PRIVATE_CACHE_CONTROL } from "@/lib/members/assets/config";

const MAX_PRIVATE_JSON_BYTES = 8_192;

export type MutationOriginResult = "valid" | "invalid" | "disabled";

export function validateMemberAssetMutationOrigin(
  request: Request,
): MutationOriginResult {
  try {
    if (getAuthMode() === "disabled") return "disabled";
    const config = getAuthConfig();
    if (config.mode === "production" && !validateRequestOrigin(request, config)) {
      return "invalid";
    }
    return validateLogoutOrigin(request, config) ? "valid" : "invalid";
  } catch {
    return "disabled";
  }
}

function privateHeaders(contentType = true): Headers {
  const headers = new Headers({
    "Cache-Control": MEMBER_ASSET_PRIVATE_CACHE_CONTROL,
    Pragma: "no-cache",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  });
  if (contentType) headers.set("Content-Type", "application/json; charset=utf-8");
  return headers;
}

export function privateJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: privateHeaders(),
  });
}

export function privateEmpty(status = 204): Response {
  return new Response(null, {
    status,
    headers: privateHeaders(false),
  });
}

export async function readBoundedJson(request: Request): Promise<unknown | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) return null;
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_PRIVATE_JSON_BYTES) {
      return null;
    }
  }
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PRIVATE_JSON_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // Preserve the generic invalid-body result.
    }
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

export function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length &&
    actualKeys.every((key) => keys.includes(key));
}
