import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import { hashSessionToken, isValidSessionToken } from '@/lib/auth/crypto';
import { verifySession } from '@/lib/auth/db';
import {
  applyProtectedHeaders,
  createDisabledModeNotFoundResponse,
  getSingleCookieValue,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/http';

/**
 * Read-only session status for the statically prerendered home page, which
 * cannot inspect cookies at build time and is deliberately left out of the
 * proxy matcher. Returns only what the sign-in control needs to render, and
 * never mutates cookies: revocation stays the job of the proxy and /api/auth/logout.
 */
interface SessionStatus {
  authenticated: boolean;
  username: string | null;
}

function createJsonResponse(body: unknown, status: number): Response {
  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function createSessionStatusResponse(status: SessionStatus): Response {
  return createJsonResponse(status, 200);
}

// This route is read by fetch(), never navigated to, so errors stay JSON
// instead of reusing the HTML error page the browser-facing routes render.
function createSessionErrorResponse(status: number, error: string): Response {
  return createJsonResponse({ error }, status);
}

const SIGNED_OUT: SessionStatus = { authenticated: false, username: null };

export async function GET(request: Request): Promise<Response> {
  let mode;
  try {
    mode = getAuthMode();
  } catch {
    return createDisabledModeNotFoundResponse();
  }

  if (mode === 'disabled') {
    return createDisabledModeNotFoundResponse();
  }

  let config;
  try {
    config = getAuthConfig();
  } catch {
    return createSessionErrorResponse(500, 'server_configuration_error');
  }

  if (config.mode === 'production' && !validateRequestOrigin(request, config)) {
    return createSessionErrorResponse(400, 'invalid_request_host');
  }

  const cookieResult = getSingleCookieValue(request, SESSION_COOKIE_NAME);

  if (cookieResult.status !== 'found' || !isValidSessionToken(cookieResult.value)) {
    return createSessionStatusResponse(SIGNED_OUT);
  }

  let verificationResult;
  try {
    verificationResult = await verifySession(hashSessionToken(cookieResult.value), config.databaseUrl);
  } catch {
    // Report the outage rather than a signed-out state, so the caller can leave
    // the control hidden instead of inviting a member to sign in again.
    return createSessionErrorResponse(503, 'service_unavailable');
  }

  if (!verificationResult.valid) {
    return createSessionStatusResponse(SIGNED_OUT);
  }

  return createSessionStatusResponse({
    authenticated: true,
    username: verificationResult.account.username,
  });
}
