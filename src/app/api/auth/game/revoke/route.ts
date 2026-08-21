import { getAuthConfig, getAuthMode, validateRequestOrigin } from '@/lib/auth/config';
import {
  hashGameToken,
  isValidGameAccessToken,
  parseBasicClientAuth,
  readBoundedUrlEncodedForm,
} from '@/lib/auth/game-oauth';
import { authenticateGameClient, revokeGameAccessToken } from '@/lib/auth/game-db';
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
    return createOAuthErrorResponse('unsupported_token_type', 'Unsupported token_type_hint parameter.', 400);
  }

  // RFC 7009 §2.2: If the token is invalid or already revoked, return 200 OK.
  // Access tokens only (never accept/hash/delete thc_ authorization codes).
  if (!isValidGameAccessToken(token)) {
    return createOAuthJsonResponse({}, 200);
  }

  // 4. Revoke token in database
  const tokenHash = hashGameToken(token);

  try {
    await revokeGameAccessToken({
      authenticatedClientId: client.clientId,
      tokenHash,
      databaseUrl: config.databaseUrl,
    });
  } catch {
    return createOAuthErrorResponse('temporarily_unavailable', 'Database unavailable.', 503);
  }

  return createOAuthJsonResponse({}, 200);
}

export const GET = createGameMethodNotAllowedHandler('POST');
export const PUT = createGameMethodNotAllowedHandler('POST');
export const PATCH = createGameMethodNotAllowedHandler('POST');
export const DELETE = createGameMethodNotAllowedHandler('POST');
export const HEAD = createGameMethodNotAllowedHandler('POST');
export const OPTIONS = createGameMethodNotAllowedHandler('POST');
