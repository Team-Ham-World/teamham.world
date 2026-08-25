import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getAuthConfig, getAuthMode } from "@/lib/auth/config";
import { hashSessionToken, isValidSessionToken } from "@/lib/auth/crypto";
import { verifySession, type VerifiedAccount } from "@/lib/auth/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth/http";

/**
 * Database-backed session lookup for Server Components and Server Actions.
 * Duplicate and malformed cookies fail closed just like the auth proxy.
 */
async function verifyCurrentAccount(): Promise<VerifiedAccount | null> {
  let mode;
  try {
    mode = getAuthMode();
  } catch {
    return null;
  }
  if (mode === "disabled") return null;

  const cookieStore = await cookies();
  const sessionCookies = cookieStore.getAll(SESSION_COOKIE_NAME);
  if (sessionCookies.length !== 1) return null;

  const token = sessionCookies[0]?.value;
  if (!isValidSessionToken(token)) return null;

  const config = getAuthConfig();
  const result = await verifySession(hashSessionToken(token), config.databaseUrl);
  return result.valid ? result.account : null;
}

export const getCurrentVerifiedAccount = cache(verifyCurrentAccount);
