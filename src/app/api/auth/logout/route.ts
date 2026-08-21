import { getAuthConfig, getAuthMode, validateLogoutOrigin } from '@/lib/auth/config';
import { hashSessionToken, isValidSessionToken } from '@/lib/auth/crypto';
import { deleteSessionByTokenHash } from '@/lib/auth/db';
import {
  applyProtectedHeaders,
  buildClearSessionCookie,
  createAuthErrorResponse,
  createDisabledModeNotFoundResponse,
  getSingleCookieValue,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/http';

export async function POST(request: Request): Promise<Response> {
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
    return createAuthErrorResponse(
      500,
      'Server Configuration Error',
      'Authentication configuration is invalid.'
    );
  }

  // Exact same-origin Origin enforcement
  if (!validateLogoutOrigin(request, config)) {
    return createAuthErrorResponse(403, 'Forbidden', 'Invalid request origin.');
  }

  const cookieResult = getSingleCookieValue(request, SESSION_COOKIE_NAME);

  // If missing, duplicate, or invalid session cookie: safely clear cookie and redirect 303 to /
  if (cookieResult.status !== 'found' || !isValidSessionToken(cookieResult.value)) {
    const headers = new Headers();
    applyProtectedHeaders(headers);
    headers.set('Location', '/');
    headers.append('Set-Cookie', buildClearSessionCookie());
    return new Response(null, {
      status: 303,
      headers,
    });
  }

  const tokenHash = hashSessionToken(cookieResult.value);

  try {
    await deleteSessionByTokenHash(tokenHash, config.databaseUrl);
  } catch {
    // On DB failure, return 503 and RETAIN cookie so revocation is not falsely reported
    return createAuthErrorResponse(
      503,
      'Service Unavailable',
      'Failed to securely invalidate session. Please try again.'
    );
  }

  // Only after successful DB deletion clear __Host-session and 303 redirect /
  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set('Location', '/');
  headers.append('Set-Cookie', buildClearSessionCookie());

  return new Response(null, {
    status: 303,
    headers,
  });
}
