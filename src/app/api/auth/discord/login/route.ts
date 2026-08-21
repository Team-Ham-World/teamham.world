import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import {
  ALLOWED_OAUTH_RETURN_TO,
  AllowedOAuthReturnTo,
  generateOAuthState,
  generatePkceChallenge,
  generatePkceVerifier,
  signOAuthState,
} from '@/lib/auth/crypto';
import {
  applyProtectedHeaders,
  buildClearGameAuthCookie,
  buildOAuthStateCookie,
  createAuthErrorResponse,
  createDisabledModeNotFoundResponse,
  GAME_AUTHORIZATION_COOKIE_NAME,
  getSingleCookieValue,
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

  // Request size bounds: query string strictly bounded to <= 2048 UTF-8 bytes
  if (Buffer.byteLength(url.search, 'utf8') > 2048) {
    return createAuthErrorResponse(400, 'Invalid Request', 'Query string exceeds maximum allowed size.');
  }

  // Validate duplicate query parameters and reject unrecognized query parameters
  for (const key of Array.from(new Set(url.searchParams.keys()))) {
    if (url.searchParams.getAll(key).length > 1) {
      return createAuthErrorResponse(400, 'Invalid Request', 'Duplicate query parameters detected.');
    }
    if (key !== 'return_to') {
      return createAuthErrorResponse(400, 'Invalid Request', 'Unrecognized query parameter.');
    }
  }

  // Validate return_to if present - only allow fixed allowlisted resume destination
  let boundReturnTo: AllowedOAuthReturnTo | null = null;
  if (url.searchParams.has('return_to')) {
    const returnTo = url.searchParams.get('return_to');
    if (returnTo !== ALLOWED_OAUTH_RETURN_TO) {
      return createAuthErrorResponse(
        400,
        'Invalid Request',
        'Invalid return_to parameter.',
        [['Set-Cookie', buildClearGameAuthCookie()]]
      );
    }
    const pendingCookieRes = getSingleCookieValue(request, GAME_AUTHORIZATION_COOKIE_NAME);
    if (pendingCookieRes.status !== 'found') {
      return createAuthErrorResponse(
        400,
        'Invalid Request',
        'Game authorization session is missing or expired.',
        [['Set-Cookie', buildClearGameAuthCookie()]]
      );
    }
    const verifiedPending = verifyGameAuthCookie(
      pendingCookieRes.value,
      config.gameAuthRequestHmacSecret,
      config.mode
    );
    if (!verifiedPending) {
      return createAuthErrorResponse(
        400,
        'Invalid Request',
        'Game authorization session is invalid or expired.',
        [['Set-Cookie', buildClearGameAuthCookie()]]
      );
    }
    boundReturnTo = ALLOWED_OAUTH_RETURN_TO;
  }

  const state = generateOAuthState();
  const verifier = generatePkceVerifier();
  const challenge = generatePkceChallenge(verifier);
  const issuedAt = Math.floor(Date.now() / 1000);

  const signedState = signOAuthState(
    {
      state,
      verifier,
      issuedAt,
      returnTo: boundReturnTo,
    },
    config.oauthStateHmacSecret
  );

  const discordAuthUrl = new URL('https://discord.com/oauth2/authorize');
  discordAuthUrl.searchParams.set('client_id', config.discordClientId);
  discordAuthUrl.searchParams.set('response_type', 'code');
  discordAuthUrl.searchParams.set('redirect_uri', config.redirectUri);
  discordAuthUrl.searchParams.set('scope', 'identify guilds.members.read');
  discordAuthUrl.searchParams.set('state', state);
  discordAuthUrl.searchParams.set('code_challenge', challenge);
  discordAuthUrl.searchParams.set('code_challenge_method', 'S256');
  discordAuthUrl.searchParams.set('prompt', 'consent');

  const headers = new Headers();
  applyProtectedHeaders(headers);
  headers.set('Location', discordAuthUrl.toString());
  headers.append('Set-Cookie', buildOAuthStateCookie(signedState));

  return new Response(null, {
    status: 302,
    headers,
  });
}
