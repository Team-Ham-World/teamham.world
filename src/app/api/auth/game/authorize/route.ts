import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import {
  compareRedirectUris,
  GAME_OAUTH_SCOPE,
  GameAuthRequestPayload,
  generateGameAuthorizationCode,
  hashGameToken,
  isValidGameAudience,
  isValidGameClientId,
  isValidGamePkceChallenge,
  isValidGameRedirectUri,
  isValidGameState,
  signGameAuthCookie,
} from '@/lib/auth/game-oauth';
import { getGameOAuthClient, issueGameAuthorizationCode } from '@/lib/auth/game-db';
import { hashSessionToken, isValidSessionToken } from '@/lib/auth/crypto';
import { verifySession } from '@/lib/auth/db';
import {
  applyProtectedHeaders,
  buildGameAuthCookie,
  createAuthErrorResponse,
  createDisabledModeNotFoundResponse,
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

  if (config.mode === 'production' && !validateRequestOrigin(request, config)) {
    return createAuthErrorResponse(400, 'Bad Request', 'Invalid request host.');
  }

  const url = new URL(request.url);

  // Request size bounds: query string strictly bounded to <= 2048 UTF-8 bytes
  if (Buffer.byteLength(url.search, 'utf8') > 2048) {
    return createAuthErrorResponse(400, 'Invalid Request', 'Query string exceeds maximum allowed size.');
  }

  // Reject duplicate query parameters
  for (const key of Array.from(new Set(url.searchParams.keys()))) {
    if (url.searchParams.getAll(key).length > 1) {
      return createAuthErrorResponse(400, 'Invalid Request', 'Duplicate query parameters detected.');
    }
  }

  const responseType = url.searchParams.get('response_type');
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const scope = url.searchParams.get('scope');
  const state = url.searchParams.get('state');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const audience = url.searchParams.get('audience');

  // Exact required parameters format validation (scope must be strictly GAME_OAUTH_SCOPE = 'identity')
  if (
    responseType !== 'code' ||
    !clientId ||
    !isValidGameClientId(clientId) ||
    !redirectUri ||
    !isValidGameRedirectUri(redirectUri, config.mode) ||
    scope !== GAME_OAUTH_SCOPE ||
    !state ||
    !isValidGameState(state) ||
    !codeChallenge ||
    !isValidGamePkceChallenge(codeChallenge) ||
    codeChallengeMethod !== 'S256' ||
    !audience ||
    !isValidGameAudience(audience, clientId)
  ) {
    return createAuthErrorResponse(400, 'Invalid Request', 'Invalid authorization request parameters.');
  }

  // Verify registered client and exact redirect URI / audience match
  let client;
  try {
    client = await getGameOAuthClient(clientId, config.databaseUrl);
  } catch {
    return createAuthErrorResponse(503, 'Service Unavailable', 'Database temporarily unavailable.');
  }

  if (!client || !client.enabled) {
    return createAuthErrorResponse(400, 'Invalid Client', 'Client is unknown or disabled.');
  }

  if (!compareRedirectUris(redirectUri, client.redirectUri)) {
    return createAuthErrorResponse(400, 'Invalid Request', 'Redirect URI does not match registered client configuration.');
  }

  if (audience !== client.audience) {
    return createAuthErrorResponse(400, 'Invalid Request', 'Audience does not match registered client configuration.');
  }

  // Check central member session
  const sessionCookieResult = getSingleCookieValue(request, SESSION_COOKIE_NAME);
  let activeAccountId: string | null = null;
  let activeSessionTokenHash: string | null = null;

  if (sessionCookieResult.status === 'found' && isValidSessionToken(sessionCookieResult.value)) {
    const tokenHash = hashSessionToken(sessionCookieResult.value);
    try {
      const sessionVerification = await verifySession(tokenHash, config.databaseUrl);
      if (sessionVerification.valid) {
        activeAccountId = sessionVerification.account.id;
        activeSessionTokenHash = tokenHash;
      }
    } catch {
      return createAuthErrorResponse(503, 'Service Unavailable', 'Database temporarily unavailable.');
    }
  }

  // Case A: Central Session Active (Silent SSO)
  if (activeAccountId && activeSessionTokenHash) {
    const rawCode = generateGameAuthorizationCode();
    const codeHash = hashGameToken(rawCode);

    try {
      const issueResult = await issueGameAuthorizationCode({
        accountId: activeAccountId,
        clientId: client.clientId,
        codeHash,
        codeChallenge,
        sourceSessionHash: activeSessionTokenHash,
        databaseUrl: config.databaseUrl,
      });

      if (issueResult.success) {
        const redirectTarget = new URL(client.redirectUri);
        redirectTarget.searchParams.set('code', rawCode);
        redirectTarget.searchParams.set('state', state);
        redirectTarget.searchParams.set('iss', config.canonicalOrigin);

        const headers = new Headers();
        applyProtectedHeaders(headers);
        headers.set('Location', redirectTarget.toString());

        return new Response(null, {
          status: 302,
          headers,
        });
      }

      if (issueResult.reason === 'client_disabled' || issueResult.reason === 'client_not_found') {
        return createAuthErrorResponse(400, 'Invalid Client', 'Client is unknown or disabled.');
      }
    } catch {
      return createAuthErrorResponse(503, 'Service Unavailable', 'Database temporarily unavailable.');
    }
  }

  // Case B: Central Session Missing or Ineligible (Interrupted Resume Flow)
  const payload: GameAuthRequestPayload = {
    responseType: 'code',
    clientId: client.clientId,
    redirectUri: client.redirectUri,
    scope: GAME_OAUTH_SCOPE,
    audience: client.audience,
    state,
    codeChallenge,
    codeChallengeMethod: 'S256',
    issuedAt: Math.floor(Date.now() / 1000),
  };

  let signedPayload: string;
  try {
    signedPayload = signGameAuthCookie(payload, config.gameAuthRequestHmacSecret, config.mode);
  } catch {
    return createAuthErrorResponse(500, 'Server Configuration Error', 'Failed to initialize authorization session.');
  }

  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set(
    'Location',
    `${config.canonicalOrigin}/api/auth/discord/login?return_to=%2Fapi%2Fauth%2Fgame%2Fauthorize%2Fresume`
  );
  headers.append('Set-Cookie', buildGameAuthCookie(signedPayload));

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
