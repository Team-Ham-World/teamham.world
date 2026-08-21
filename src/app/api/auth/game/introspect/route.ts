import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import {
  GAME_OAUTH_SCOPE,
  hashGameToken,
  isValidGameAccessToken,
  parseBasicClientAuth,
  readBoundedUrlEncodedForm,
} from '@/lib/auth/game-oauth';
import { authenticateGameClient, introspectGameAccessToken } from '@/lib/auth/game-db';
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

  const token = params.get('token');
  const tokenTypeHint = params.get('token_type_hint');

  if (token === null || token.trim() === '') {
    return createOAuthErrorResponse('invalid_request', 'Missing required token parameter.', 400);
  }

  if (tokenTypeHint !== null && tokenTypeHint !== 'access_token') {
    return createOAuthErrorResponse('invalid_request', 'Unsupported token_type_hint parameter.', 400);
  }

  // Malformed or invalid format token is inactive per RFC 7662 §2.2
  if (!isValidGameAccessToken(token)) {
    return createOAuthJsonResponse({ active: false }, 200);
  }

  // 4. Introspect access token in database
  const tokenHash = hashGameToken(token);

  let introspectResult;
  try {
    introspectResult = await introspectGameAccessToken({
      authenticatedClientId: client.clientId,
      tokenHash,
      databaseUrl: config.databaseUrl,
    });
  } catch {
    // Fail closed with 503 on DB error - never return active: false during outages
    return createOAuthErrorResponse('temporarily_unavailable', 'Database unavailable.', 503);
  }

  if (!introspectResult.active) {
    return createOAuthJsonResponse({ active: false }, 200);
  }

  const exp = Math.floor(new Date(introspectResult.expiresAt).getTime() / 1000);

  return createOAuthJsonResponse(
    {
      active: true,
      sub: introspectResult.subject,
      client_id: introspectResult.clientId,
      aud: introspectResult.audience,
      iss: config.canonicalOrigin,
      exp,
      scope: GAME_OAUTH_SCOPE,
      token_type: 'Bearer',
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
