import { NextRequest, NextResponse } from 'next/server';
import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import { hashSessionToken, isValidSessionToken } from '@/lib/auth/crypto';
import { verifySession } from '@/lib/auth/db';
import {
  applyProtectedHeaders,
  buildClearSessionCookie,
  createAuthErrorResponse,
  createDisabledModeNotFoundResponse,
  getSingleCookieValue,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/http';

export const config = {
  matcher: ['/account', '/account/:path*'],
};

export async function proxy(request: NextRequest): Promise<NextResponse | Response> {
  let mode;
  try {
    mode = getAuthMode();
  } catch {
    return createDisabledModeNotFoundResponse();
  }

  if (mode === 'disabled') {
    return createDisabledModeNotFoundResponse();
  }

  let authConfig;
  try {
    authConfig = getAuthConfig();
  } catch {
    return createAuthErrorResponse(
      500,
      'Server Configuration Error',
      'Authentication configuration is invalid.'
    );
  }

  if (authConfig.mode === 'production' && !validateRequestOrigin(request, authConfig)) {
    return createAuthErrorResponse(400, 'Bad Request', 'Invalid request host.');
  }

  const cookieResult = getSingleCookieValue(request, SESSION_COOKIE_NAME);

  const forwardWithAuthStatus = (
    isAuthenticated: boolean,
    shouldClearCookie: boolean
  ): NextResponse => {
    const requestHeaders = new Headers(request.headers);
    // Overwrite any client-supplied x-teamham-authenticated header
    requestHeaders.set('x-teamham-authenticated', isAuthenticated ? '1' : '0');

    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    applyProtectedHeaders(response.headers);
    if (shouldClearCookie) {
      response.headers.append('Set-Cookie', buildClearSessionCookie());
    }

    return response;
  };

  // Case 1: Missing cookie -> render signed-out state, do not clear cookie
  if (cookieResult.status === 'missing') {
    return forwardWithAuthStatus(false, false);
  }

  // Case 2: Duplicate cookies or malformed token -> render signed-out state, clear cookie
  if (cookieResult.status === 'duplicate' || !isValidSessionToken(cookieResult.value)) {
    return forwardWithAuthStatus(false, true);
  }

  // Case 3: Single valid token -> verify session in database
  const tokenHash = hashSessionToken(cookieResult.value);

  let verificationResult;
  try {
    verificationResult = await verifySession(tokenHash, authConfig.databaseUrl);
  } catch {
    // Database outage or malformed result -> 503 and RETAIN cookie
    return createAuthErrorResponse(
      503,
      'Service Unavailable',
      'Authentication service is temporarily unavailable. Please try again.'
    );
  }

  if (verificationResult.valid) {
    return forwardWithAuthStatus(true, false);
  }

  // Session expired, suspended, or ineligible -> render signed-out state, clear cookie
  return forwardWithAuthStatus(false, true);
}

export const middleware = proxy;
export default proxy;
