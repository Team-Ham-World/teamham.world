import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import {
  compareRedirectUris,
  derivePkceChallenge,
  GAME_OAUTH_SCOPE,
  generateGameAccessToken,
  hashGameToken,
  isValidGameAuthorizationCode,
  isValidGamePkceVerifier,
  isValidGameRedirectUri,
  parseBasicClientAuth,
  readBoundedUrlEncodedForm,
} from '@/lib/auth/game-oauth';
import { authenticateGameClient, exchangeGameAuthorizationCode } from '@/lib/auth/game-db';
import {
  createDisabledModeNotFoundResponse,
  createOAuthErrorResponse,
  createOAuthJsonResponse,
} from '@/lib/auth/http';
import { createGameMethodNotAllowedHandler } from '@/lib/auth/game-route';

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
    return createOAuthErrorResponse(
      'temporarily_unavailable',
      'Authentication service configuration error.',
      500
    );
  }

  if (config.mode === 'production' && !validateRequestOrigin(request, config)) {
    return createOAuthErrorResponse('invalid_request', 'Invalid request host.', 400);
  }

  // 1. Read bounded URL-encoded form body
  const formResult = await readBoundedUrlEncodedForm(request, 4096);
  if (!formResult.success) {
    if (formResult.error === 'invalid_content_type') {
      return createOAuthErrorResponse(
        'invalid_request',
        'Content-Type must be application/x-www-form-urlencoded.',
        415
      );
    }
    if (formResult.error === 'invalid_url_query') {
      return createOAuthErrorResponse(
        'invalid_request',
        'Query parameters are not permitted on POST endpoints.',
        400
      );
    }
    return createOAuthErrorResponse('invalid_request', 'Invalid request body.', 400);
  }

  // 2. Authenticate confidential client via HTTP Basic
  const authHeader = request.headers.get('authorization');
  const basicCredentials = parseBasicClientAuth(authHeader);
  if (!basicCredentials) {
    return createOAuthErrorResponse(
      'invalid_client',
      'Client authentication failed.',
      401,
      { 'WWW-Authenticate': 'Basic realm="teamham_game"' }
    );
  }

  let client;
  try {
    client = await authenticateGameClient(
      basicCredentials.clientId,
      basicCredentials.clientSecret,
      config.databaseUrl
    );
  } catch {
    return createOAuthErrorResponse('temporarily_unavailable', 'Database unavailable.', 503);
  }

  if (!client) {
    return createOAuthErrorResponse(
      'invalid_client',
      'Client authentication failed.',
      401,
      { 'WWW-Authenticate': 'Basic realm="teamham_game"' }
    );
  }

  // 3. Reject duplicate body parameters
  const params = formResult.params;
  for (const key of Array.from(new Set(params.keys()))) {
    if (params.getAll(key).length > 1) {
      return createOAuthErrorResponse('invalid_request', 'Duplicate parameters detected.', 400);
    }
  }

  const grantType = params.get('grant_type');
  const code = params.get('code');
  const redirectUri = params.get('redirect_uri');
  const codeVerifier = params.get('code_verifier');

  // Distinguish missing parameters from invalid grant
  if (
    grantType === null ||
    grantType.trim() === '' ||
    code === null ||
    code.trim() === '' ||
    redirectUri === null ||
    redirectUri.trim() === '' ||
    codeVerifier === null ||
    codeVerifier.trim() === ''
  ) {
    return createOAuthErrorResponse('invalid_request', 'Missing required parameter.', 400);
  }

  if (grantType !== 'authorization_code') {
    return createOAuthErrorResponse('unsupported_grant_type', 'Unsupported grant_type parameter.', 400);
  }

  if (!isValidGameAuthorizationCode(code)) {
    return createOAuthErrorResponse('invalid_grant', 'Invalid authorization code format.', 400);
  }

  if (!isValidGameRedirectUri(redirectUri, config.mode) || !compareRedirectUris(redirectUri, client.redirectUri)) {
    return createOAuthErrorResponse('invalid_grant', 'Redirect URI mismatch.', 400);
  }

  if (!isValidGamePkceVerifier(codeVerifier)) {
    return createOAuthErrorResponse('invalid_grant', 'Invalid code verifier format.', 400);
  }

  // 4. Atomic code consumption, PKCE verification, and token exchange in database
  const computedChallenge = derivePkceChallenge(codeVerifier);
  const codeHash = hashGameToken(code);
  const newAccessToken = generateGameAccessToken();
  const newTokenHash = hashGameToken(newAccessToken);

  let exchangeResult;
  try {
    exchangeResult = await exchangeGameAuthorizationCode({
      authenticatedClientId: client.clientId,
      codeHash,
      redirectUri: client.redirectUri,
      computedCodeChallenge: computedChallenge,
      newTokenHash,
      databaseUrl: config.databaseUrl,
    });
  } catch {
    return createOAuthErrorResponse('temporarily_unavailable', 'Database unavailable.', 503);
  }

  if (!exchangeResult.success) {
    return createOAuthErrorResponse('invalid_grant', 'Authorization code is invalid, expired, or already consumed.', 400);
  }

  const expDate = new Date(exchangeResult.expiresAt);
  const expiresIn = Math.max(0, Math.floor((expDate.getTime() - Date.now()) / 1000));

  return createOAuthJsonResponse(
    {
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      audience: exchangeResult.audience,
      sub: exchangeResult.subjectId,
      scope: GAME_OAUTH_SCOPE,
    },
    200
  );
}

export const GET = createGameMethodNotAllowedHandler('POST');
export const PUT = createGameMethodNotAllowedHandler('POST');
export const PATCH = createGameMethodNotAllowedHandler('POST');
export const DELETE = createGameMethodNotAllowedHandler('POST');
export const HEAD = createGameMethodNotAllowedHandler('POST');
export const OPTIONS = createGameMethodNotAllowedHandler('POST');
