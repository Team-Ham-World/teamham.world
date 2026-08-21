import crypto from 'node:crypto';
import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import {
  ALLOWED_OAUTH_RETURN_TO,
  generateSessionToken,
  hashSessionToken,
  isValidOAuthState,
  verifyOAuthStateCookie,
} from '@/lib/auth/crypto';
import { issueLoginSession, recordIneligibleAccount } from '@/lib/auth/db';
import { exchangeCodeAndCheckGuildRole } from '@/lib/auth/discord';
import {
  applyProtectedHeaders,
  buildClearGameAuthCookie,
  buildClearOAuthStateCookie,
  buildClearSessionCookie,
  buildSessionCookie,
  createAuthErrorResponse,
  createDisabledModeNotFoundResponse,
  GAME_AUTHORIZATION_COOKIE_NAME,
  getSingleCookieValue,
  OAUTH_STATE_COOKIE_NAME,
} from '@/lib/auth/http';
import { verifyGameAuthCookie } from '@/lib/auth/game-oauth';

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
    return createAuthErrorResponse(
      500,
      'Server Configuration Error',
      'Authentication configuration is invalid.'
    );
  }

  if (config.mode === 'production' && !validateRequestOrigin(request, config)) {
    return createAuthErrorResponse(400, 'Bad Request', 'Invalid request host.');
  }

  const url = new URL(request.url);

  // Request bounds: query string strictly bounded to <= 2048 UTF-8 bytes
  if (Buffer.byteLength(url.search, 'utf8') > 2048) {
    return createAuthErrorResponse(400, 'Invalid Request', 'Query string exceeds maximum allowed size.');
  }

  // 1. Reject duplicate parameters using searchParams.getAll
  for (const key of Array.from(new Set(url.searchParams.keys()))) {
    if (url.searchParams.getAll(key).length > 1) {
      const headers = new Headers();
      headers.append('Set-Cookie', buildClearOAuthStateCookie());
      headers.append('Set-Cookie', buildClearGameAuthCookie());
      return createAuthErrorResponse(
        400,
        'Invalid Request',
        'Duplicate query parameters detected.',
        headers
      );
    }
  }

  const state = url.searchParams.get('state');

  // 2. Validate state presence and format before processing either success or error.
  // An unsolicited error callback or request without valid state must not clear an unrelated OAuth state.
  if (!state || state.length !== 22 || !isValidOAuthState(state)) {
    return createAuthErrorResponse(
      400,
      'Invalid Request',
      'Invalid or missing state parameter.'
    );
  }

  // 3. Read and verify state cookie
  const cookieResult = getSingleCookieValue(request, OAUTH_STATE_COOKIE_NAME);
  if (cookieResult.status === 'missing') {
    return createAuthErrorResponse(
      403,
      'Session Expired',
      'OAuth state cookie missing or expired. Please initiate login again.'
    );
  }
  if (cookieResult.status === 'duplicate') {
    return createAuthErrorResponse(
      400,
      'Invalid Request',
      'Duplicate OAuth state cookies detected.'
    );
  }
  if (cookieResult.value.length > 512) {
    return createAuthErrorResponse(
      400,
      'Invalid Request',
      'OAuth state cookie exceeds maximum allowed size.'
    );
  }

  const rawStateCookie = cookieResult.value;
  const statePayload = verifyOAuthStateCookie(rawStateCookie, config.oauthStateHmacSecret);
  if (!statePayload) {
    return createAuthErrorResponse(
      403,
      'Invalid State',
      'OAuth state verification failed. Please initiate login again.'
    );
  }

  // Constant-time comparison between returned state and verified cookie payload state
  const stateParamBuf = Buffer.from(state, 'utf8');
  const payloadStateBuf = Buffer.from(statePayload.state, 'utf8');
  if (
    stateParamBuf.length !== payloadStateBuf.length ||
    !crypto.timingSafeEqual(stateParamBuf, payloadStateBuf)
  ) {
    return createAuthErrorResponse(
      403,
      'Invalid State',
      'OAuth state parameter mismatch. Please initiate login again.'
    );
  }

  // Helper for terminal 4xx client errors (clears OAuth cookie and pending game cookie)
  const terminalError = (
    status: number,
    title: string,
    message: string,
    extraHeaders?: HeadersInit
  ) => {
    const headers = new Headers(extraHeaders);
    headers.append('Set-Cookie', buildClearOAuthStateCookie());
    headers.append('Set-Cookie', buildClearGameAuthCookie());
    return createAuthErrorResponse(status, title, message, headers);
  };

  // Helper for retryable 502/503 upstream errors (clears OAuth cookie, retains pending game cookie)
  const retryableError = (
    status: number,
    title: string,
    message: string,
    extraHeaders?: HeadersInit
  ) => {
    const headers = new Headers(extraHeaders);
    headers.append('Set-Cookie', buildClearOAuthStateCookie());
    return createAuthErrorResponse(status, title, message, headers);
  };

  // 4. Check if Discord returned an authorization error (processed after state verification)
  if (url.searchParams.has('error') || url.searchParams.has('error_description')) {
    const errorParam = url.searchParams.get('error') || '';
    const errorDescParam = url.searchParams.get('error_description') || '';
    if (errorParam.length > 128 || errorDescParam.length > 512) {
      return terminalError(400, 'Invalid Request', 'Oversized error parameter.');
    }
    if (errorParam === 'access_denied') {
      return terminalError(
        403,
        'Authorization Denied',
        'You cancelled or denied the authorization request on Discord.'
      );
    }
    return terminalError(
      400,
      'Authorization Error',
      'An error occurred during Discord authorization.'
    );
  }

  const code = url.searchParams.get('code');
  if (!code || code.length > 256) {
    return terminalError(
      400,
      'Invalid Request',
      'Invalid or missing authorization code parameter.'
    );
  }

  // 5. Exchange code and check guild role
  let gateResult;
  try {
    gateResult = await exchangeCodeAndCheckGuildRole(code, statePayload.verifier, config);
  } catch {
    return retryableError(
      502,
      'Bad Gateway',
      'Failed to communicate with Discord authentication services.'
    );
  }

  if (gateResult.status === 'upstream_error') {
    return retryableError(
      502,
      'Service Unavailable',
      'Failed to verify membership with Discord. Please try again later.'
    );
  }

  if (gateResult.status === 'ineligible') {
    // Confirmed ineligible: update DB, invalidate any active session, clear session cookie, return 403
    try {
      await recordIneligibleAccount(gateResult.discordUserId, config.databaseUrl);
    } catch {
      return retryableError(
        503,
        'Service Unavailable',
        'A database error occurred while updating membership status.'
      );
    }

    const headers = new Headers();
    headers.append('Set-Cookie', buildClearOAuthStateCookie());
    headers.append('Set-Cookie', buildClearSessionCookie());
    headers.append('Set-Cookie', buildClearGameAuthCookie());

    const message =
      gateResult.reason === 'unknown_member'
        ? 'You are not a member of the required Discord server.'
        : 'You do not have the required role to access the member portal.';

    return createAuthErrorResponse(403, 'Access Denied', message, headers);
  }

  // 6. Eligible: Issue session
  const sessionToken = generateSessionToken();
  const tokenHash = hashSessionToken(sessionToken);

  let dbResult;
  try {
    dbResult = await issueLoginSession(
      gateResult.discordUserId,
      gateResult.discordUsername,
      tokenHash,
      config.databaseUrl
    );
  } catch {
    return retryableError(
      503,
      'Service Unavailable',
      'A database error occurred while creating your session.'
    );
  }

  if (!dbResult.success && dbResult.suspended) {
    // Suspended account -> 403 with no session cookie
    return terminalError(
      403,
      'Account Suspended',
      'Your account has been suspended.'
    );
  }

  if (!dbResult.success || !dbResult.accountId) {
    return retryableError(
      503,
      'Service Unavailable',
      'Failed to establish an active member session.'
    );
  }

  // 7. Success: Decide continuation based strictly on verified statePayload.returnTo
  let redirectLocation = '/account';
  let shouldClearGameCookie = true;

  if (statePayload.returnTo === ALLOWED_OAUTH_RETURN_TO) {
    const gameAuthCookieRes = getSingleCookieValue(request, GAME_AUTHORIZATION_COOKIE_NAME);
    if (gameAuthCookieRes.status === 'found') {
      const verifiedGamePayload = verifyGameAuthCookie(
        gameAuthCookieRes.value,
        config.gameAuthRequestHmacSecret,
        config.mode
      );
      if (verifiedGamePayload) {
        redirectLocation = ALLOWED_OAUTH_RETURN_TO;
        shouldClearGameCookie = false;
      }
    }
  }

  // Set session cookie, clear OAuth state cookie, handle pending game cookie, redirect 302
  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set('Location', redirectLocation);
  headers.append('Set-Cookie', buildSessionCookie(sessionToken));
  headers.append('Set-Cookie', buildClearOAuthStateCookie());
  if (shouldClearGameCookie) {
    headers.append('Set-Cookie', buildClearGameAuthCookie());
  }

  return new Response(null, {
    status: 302,
    headers,
  });
}
