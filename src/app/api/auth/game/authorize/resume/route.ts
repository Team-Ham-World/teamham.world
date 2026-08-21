import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import {
  compareRedirectUris,
  GAME_OAUTH_SCOPE,
  generateGameAuthorizationCode,
  hashGameToken,
  isValidGameAudience,
  verifyGameAuthCookie,
} from '@/lib/auth/game-oauth';
import { getGameOAuthClient, issueGameAuthorizationCode } from '@/lib/auth/game-db';
import { hashSessionToken, isValidSessionToken } from '@/lib/auth/crypto';
import { verifySession } from '@/lib/auth/db';
import {
  applyProtectedHeaders,
  buildClearGameAuthCookie,
  createAuthErrorResponse,
  createDisabledModeNotFoundResponse,
  GAME_AUTHORIZATION_COOKIE_NAME,
  getSingleCookieValue,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/http';
import { createGameMethodNotAllowedHandler } from '@/lib/auth/game-route';

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

  const clearCookieHeader: HeadersInit = [['Set-Cookie', buildClearGameAuthCookie()]];

  if (config.mode === 'production' && !validateRequestOrigin(request, config)) {
    return createAuthErrorResponse(400, 'Bad Request', 'Invalid request host.', clearCookieHeader);
  }

  const url = new URL(request.url);

  // Resume route does not accept query parameters
  if (url.search !== '') {
    return createAuthErrorResponse(
      400,
      'Invalid Request',
      'Query parameters are not permitted on resume endpoint.',
      clearCookieHeader
    );
  }

  // 1. Read and verify __Host-game_authz cookie
  const gameAuthCookieRes = getSingleCookieValue(request, GAME_AUTHORIZATION_COOKIE_NAME);
  if (gameAuthCookieRes.status !== 'found') {
    return createAuthErrorResponse(
      400,
      'Invalid Request',
      'Game authorization request cookie is missing or expired.',
      clearCookieHeader
    );
  }

  const payload = verifyGameAuthCookie(
    gameAuthCookieRes.value,
    config.gameAuthRequestHmacSecret,
    config.mode
  );
  if (
    !payload ||
    payload.scope !== GAME_OAUTH_SCOPE ||
    !isValidGameAudience(payload.audience, payload.clientId)
  ) {
    return createAuthErrorResponse(
      400,
      'Invalid Request',
      'Game authorization request state is invalid or has expired.',
      clearCookieHeader
    );
  }

  // 2. Read and verify active central member session
  const sessionCookieRes = getSingleCookieValue(request, SESSION_COOKIE_NAME);
  if (sessionCookieRes.status !== 'found' || !isValidSessionToken(sessionCookieRes.value)) {
    return createAuthErrorResponse(
      401,
      'Unauthorized',
      'Active member session is required.',
      clearCookieHeader
    );
  }

  const tokenHash = hashSessionToken(sessionCookieRes.value);
  let sessionVerification;
  try {
    sessionVerification = await verifySession(tokenHash, config.databaseUrl);
  } catch {
    // Database outage is retryable - retain the pending cookie
    return createAuthErrorResponse(
      503,
      'Service Unavailable',
      'Database temporarily unavailable.'
    );
  }

  if (!sessionVerification.valid) {
    return createAuthErrorResponse(
      403,
      'Access Denied',
      'An active and eligible member session is required.',
      clearCookieHeader
    );
  }

  // 3. Re-verify registered client, redirect URI, and audience match
  let client;
  try {
    client = await getGameOAuthClient(payload.clientId, config.databaseUrl);
  } catch {
    // Database outage is retryable - retain the pending cookie
    return createAuthErrorResponse(
      503,
      'Service Unavailable',
      'Database temporarily unavailable.'
    );
  }

  if (!client || !client.enabled) {
    return createAuthErrorResponse(
      400,
      'Invalid Client',
      'Client is unknown or disabled.',
      clearCookieHeader
    );
  }

  if (
    !compareRedirectUris(payload.redirectUri, client.redirectUri) ||
    payload.audience !== client.audience
  ) {
    return createAuthErrorResponse(
      400,
      'Invalid Request',
      'Client configuration mismatch.',
      clearCookieHeader
    );
  }

  // 4. Issue authorization code
  const rawCode = generateGameAuthorizationCode();
  const codeHash = hashGameToken(rawCode);

  let issueResult;
  try {
    issueResult = await issueGameAuthorizationCode({
      accountId: sessionVerification.account.id,
      clientId: client.clientId,
      codeHash,
      codeChallenge: payload.codeChallenge,
      sourceSessionHash: tokenHash,
      databaseUrl: config.databaseUrl,
    });
  } catch {
    // Database outage is retryable - retain the pending cookie
    return createAuthErrorResponse(
      503,
      'Service Unavailable',
      'Database temporarily unavailable.'
    );
  }

  if (!issueResult.success) {
    if (issueResult.reason === 'client_disabled' || issueResult.reason === 'client_not_found') {
      return createAuthErrorResponse(
        400,
        'Invalid Client',
        'Client is unknown or disabled.',
        clearCookieHeader
      );
    }
    return createAuthErrorResponse(
      403,
      'Access Denied',
      'Failed to issue game authorization code.',
      clearCookieHeader
    );
  }

  // 5. Redirect to game redirect_uri and clear pending cookie
  const redirectTarget = new URL(client.redirectUri);
  redirectTarget.searchParams.set('code', rawCode);
  redirectTarget.searchParams.set('state', payload.state);
  redirectTarget.searchParams.set('iss', config.canonicalOrigin);

  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set('Location', redirectTarget.toString());
  headers.append('Set-Cookie', buildClearGameAuthCookie());

  return new Response(null, {
    status: 302,
    headers,
  });
}

export const POST = createGameMethodNotAllowedHandler('GET');
export const PUT = createGameMethodNotAllowedHandler('GET');
export const PATCH = createGameMethodNotAllowedHandler('GET');
export const DELETE = createGameMethodNotAllowedHandler('GET');
export const HEAD = createGameMethodNotAllowedHandler('GET');
export const OPTIONS = createGameMethodNotAllowedHandler('GET');
