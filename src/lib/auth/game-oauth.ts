import crypto from 'node:crypto';

// Canonical Game OAuth Constants
export const GAME_OAUTH_SCOPE = 'identity' as const;
export type GameOAuthScope = typeof GAME_OAUTH_SCOPE;
export const GAME_OAUTH_PRODUCTION_ISSUER = 'https://teamham.world' as const;
export const GAME_REDIRECT_URI_MAX_BYTES = 512 as const;

// Format validation regexes matching migration 0002 and approved specification
export const GAME_CLIENT_ID_REGEX = /^[a-z][a-z0-9_-]{2,63}$/;
export const GAME_AUDIENCE_REGEX = /^urn:teamham:game:[a-z][a-z0-9_-]{2,63}$/;
export const GAME_AUTH_CODE_REGEX = /^thc_[A-Za-z0-9_-]{43}$/;
export const GAME_ACCESS_TOKEN_REGEX = /^tha_[A-Za-z0-9_-]{43}$/;
export const GAME_CLIENT_SECRET_REGEX = /^ths_[A-Za-z0-9_-]{43}$/;
export const GAME_PKCE_VERIFIER_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const GAME_PKCE_CHALLENGE_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const GAME_STATE_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
export const HEX_64_SECRET_REGEX = /^[0-9a-fA-F]{64}$/;
export const BASE64URL_STRICT_REGEX = /^[A-Za-z0-9_-]+$/;

// Format Validators & Audience Helpers
export function isValidGameClientId(clientId: string): boolean {
  return GAME_CLIENT_ID_REGEX.test(clientId);
}

export function deriveGameAudience(clientId: string): string {
  return `urn:teamham:game:${clientId}`;
}

export function isValidGameAudience(audience: string, clientId?: string): boolean {
  if (!audience || typeof audience !== 'string' || audience.length > 128) {
    return false;
  }
  if (!audience.startsWith('urn:teamham:game:')) {
    return false;
  }
  const extractedClientId = audience.slice('urn:teamham:game:'.length);
  if (!isValidGameClientId(extractedClientId)) {
    return false;
  }
  if (clientId !== undefined) {
    return extractedClientId === clientId;
  }
  return true;
}

export function isGameAudienceForClientId(audience: string, clientId: string): boolean {
  return isValidGameAudience(audience, clientId);
}

export function isValidGameAuthorizationCode(code: string): boolean {
  return GAME_AUTH_CODE_REGEX.test(code);
}

export function isValidGameAccessToken(token: string): boolean {
  return GAME_ACCESS_TOKEN_REGEX.test(token);
}

export function isValidGameClientSecret(secret: string): boolean {
  return GAME_CLIENT_SECRET_REGEX.test(secret);
}

export function isValidGamePkceVerifier(verifier: string): boolean {
  return GAME_PKCE_VERIFIER_REGEX.test(verifier);
}

export function isValidGamePkceChallenge(challenge: string): boolean {
  return GAME_PKCE_CHALLENGE_REGEX.test(challenge);
}

export function isValidGameState(state: string): boolean {
  return GAME_STATE_REGEX.test(state);
}

export function isValidSha256Hex(hex: string): boolean {
  return SHA256_HEX_REGEX.test(hex);
}

// Redirect URI validation (HTTPS required in both production and development, max 512 bytes, non-root path)
export function isValidGameRedirectUri(
  uri: string,
  mode: 'development' | 'production' = 'production'
): boolean {
  if (!uri || typeof uri !== 'string' || Buffer.byteLength(uri, 'utf8') > GAME_REDIRECT_URI_MAX_BYTES) {
    return false;
  }
  try {
    const parsed = new URL(uri);
    // Protocol must strictly be HTTPS
    if (parsed.protocol !== 'https:') {
      return false;
    }
    // Reject query and fragment
    if (parsed.search !== '' || parsed.hash !== '') {
      return false;
    }
    // Reject userinfo/credentials
    if (parsed.username !== '' || parsed.password !== '') {
      return false;
    }
    // Must have a non-root path
    if (!parsed.pathname || parsed.pathname === '' || parsed.pathname === '/') {
      return false;
    }

    const host = parsed.hostname.toLowerCase();

    if (mode === 'production') {
      // Reject non-default/explicit ports
      if (parsed.port !== '') {
        return false;
      }
      // Must be a subdomain of teamham.world (not apex teamham.world)
      if (!host.endsWith('.teamham.world') || host === 'teamham.world') {
        return false;
      }
      if (!/^[a-z0-9.-]+\.teamham\.world$/.test(host)) {
        return false;
      }
      return true;
    }

    // Development mode additionally allows reviewed loopback/local test hosts (still HTTPS)
    const isLoopback =
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    const isSubdomain =
      host.endsWith('.teamham.world') &&
      host !== 'teamham.world' &&
      /^[a-z0-9.-]+\.teamham\.world$/.test(host);

    if (isLoopback) {
      // Local development test hosts may carry explicit ports
      return true;
    }

    if (isSubdomain) {
      // Non-local hosts cannot carry explicit ports even in development
      if (parsed.port !== '') {
        return false;
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function compareRedirectUris(requested: string, registered: string): boolean {
  return requested === registered;
}

// Generation and hashing functions
export function generateGameAuthorizationCode(): string {
  return `thc_${crypto.randomBytes(32).toString('base64url')}`;
}

export function generateGameAccessToken(): string {
  return `tha_${crypto.randomBytes(32).toString('base64url')}`;
}

export function generateGameClientSecret(): string {
  return `ths_${crypto.randomBytes(32).toString('base64url')}`;
}

export function generateGameState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function derivePkceChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

export function generateGamePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = derivePkceChallenge(verifier);
  return { verifier, challenge };
}

export function hashGameToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex').toLowerCase();
}

// Constant-time PKCE verifier challenge verification
export function verifyPkceChallenge(verifier: string, storedChallenge: string): boolean {
  if (!isValidGamePkceVerifier(verifier) || !isValidGamePkceChallenge(storedChallenge)) {
    return false;
  }
  const derived = derivePkceChallenge(verifier);
  if (derived.length !== storedChallenge.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(derived, 'utf8'), Buffer.from(storedChallenge, 'utf8'));
}

// Basic Client Authentication Parsing
export function parseBasicClientAuth(
  authHeader: string | null
): { clientId: string; clientSecret: string } | null {
  if (!authHeader || typeof authHeader !== 'string' || authHeader.length > 512) {
    return null;
  }

  // Reject multiple/comma-combined headers or control characters/NUL
  if (authHeader.includes(',') || /[\x00-\x1F\x7F]/.test(authHeader)) {
    return null;
  }

  const trimmed = authHeader.trim();
  const match = trimmed.match(/^Basic\s+([A-Za-z0-9+/]+=*)$/i);
  if (!match) {
    return null;
  }

  const b64 = match[1];
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    return null;
  }

  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (/[\x00-\x1F\x7F]/.test(decoded)) {
      return null;
    }

    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1 || decoded.indexOf(':', colonIndex + 1) !== -1) {
      return null;
    }

    const clientId = decoded.slice(0, colonIndex);
    const clientSecret = decoded.slice(colonIndex + 1);

    if (!isValidGameClientId(clientId) || !isValidGameClientSecret(clientSecret)) {
      return null;
    }

    return { clientId, clientSecret };
  } catch {
    return null;
  }
}

// Constant-time client secret verification
const DUMMY_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export function verifyClientSecret(presentedSecret: string, storedSecretHash: string): boolean {
  const presentedHash = hashGameToken(presentedSecret);
  const targetHash = isValidSha256Hex(storedSecretHash) ? storedSecretHash : DUMMY_HASH;

  const match = crypto.timingSafeEqual(
    Buffer.from(presentedHash, 'utf8'),
    Buffer.from(targetHash, 'utf8')
  );

  return match && storedSecretHash !== DUMMY_HASH && isValidSha256Hex(storedSecretHash);
}

// Pending Authorization Request Payload & Cookie Signing (__Host-game_authz)
export interface GameAuthRequestPayload {
  responseType: 'code';
  clientId: string;
  redirectUri: string;
  scope: typeof GAME_OAUTH_SCOPE;
  audience: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  issuedAt: number; // Unix timestamp in seconds
}

export function signGameAuthCookie(
  payload: GameAuthRequestPayload,
  secretHex: string,
  mode: 'development' | 'production' = 'production'
): string {
  if (!HEX_64_SECRET_REGEX.test(secretHex)) {
    throw new Error('Invalid secret format for game auth cookie signing');
  }

  if (
    payload.responseType !== 'code' ||
    !isValidGameClientId(payload.clientId) ||
    !isValidGameRedirectUri(payload.redirectUri, mode) ||
    payload.scope !== GAME_OAUTH_SCOPE ||
    !isValidGameAudience(payload.audience, payload.clientId) ||
    !isValidGameState(payload.state) ||
    !isValidGamePkceChallenge(payload.codeChallenge) ||
    payload.codeChallengeMethod !== 'S256' ||
    typeof payload.issuedAt !== 'number' ||
    !Number.isInteger(payload.issuedAt)
  ) {
    throw new Error('Invalid payload fields for game auth cookie signing');
  }

  const payloadJson = JSON.stringify({
    responseType: payload.responseType,
    clientId: payload.clientId,
    redirectUri: payload.redirectUri,
    scope: payload.scope,
    audience: payload.audience,
    state: payload.state,
    codeChallenge: payload.codeChallenge,
    codeChallengeMethod: payload.codeChallengeMethod,
    issuedAt: payload.issuedAt,
  });

  const rawPayload = Buffer.from(payloadJson, 'utf8').toString('base64url');
  const secretKey = Buffer.from(secretHex, 'hex');
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(rawPayload, 'utf8')
    .digest('base64url');

  return `${rawPayload}.${signature}`;
}

export function verifyGameAuthCookie(
  cookieValue: string,
  secretHex: string,
  mode: 'development' | 'production' = 'production'
): GameAuthRequestPayload | null {
  if (!HEX_64_SECRET_REGEX.test(secretHex)) {
    return null;
  }

  if (!cookieValue || typeof cookieValue !== 'string' || cookieValue.length > 2048) {
    return null;
  }

  const dotIndex = cookieValue.indexOf('.');
  if (dotIndex === -1 || dotIndex === 0 || dotIndex === cookieValue.length - 1) {
    return null;
  }

  const rawPayload = cookieValue.slice(0, dotIndex);
  const signature = cookieValue.slice(dotIndex + 1);

  if (
    !BASE64URL_STRICT_REGEX.test(rawPayload) ||
    !BASE64URL_STRICT_REGEX.test(signature)
  ) {
    return null;
  }

  const secretKey = Buffer.from(secretHex, 'hex');
  const expectedSig = crypto
    .createHmac('sha256', secretKey)
    .update(rawPayload, 'utf8')
    .digest('base64url');

  if (
    signature.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expectedSig, 'utf8'))
  ) {
    return null;
  }

  try {
    const jsonStr = Buffer.from(rawPayload, 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const expectedKeys = [
      'responseType',
      'clientId',
      'redirectUri',
      'scope',
      'audience',
      'state',
      'codeChallenge',
      'codeChallengeMethod',
      'issuedAt',
    ];
    const actualKeys = Object.keys(parsed);
    if (actualKeys.length !== expectedKeys.length) {
      return null;
    }
    for (const key of expectedKeys) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
        return null;
      }
    }

    if (
      parsed.responseType !== 'code' ||
      !isValidGameClientId(parsed.clientId) ||
      !isValidGameRedirectUri(parsed.redirectUri, mode) ||
      parsed.scope !== GAME_OAUTH_SCOPE ||
      !isValidGameAudience(parsed.audience, parsed.clientId) ||
      !isValidGameState(parsed.state) ||
      !isValidGamePkceChallenge(parsed.codeChallenge) ||
      parsed.codeChallengeMethod !== 'S256' ||
      typeof parsed.issuedAt !== 'number' ||
      !Number.isInteger(parsed.issuedAt)
    ) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    // <= 600s age (10 min), reject > 60s future
    if (now - parsed.issuedAt > 600 || parsed.issuedAt - now > 60) {
      return null;
    }

    return parsed as GameAuthRequestPayload;
  } catch {
    return null;
  }
}

// Bounded URL-encoded form reader for POST requests
export type ReadBoundedFormResult =
  | { success: true; params: URLSearchParams }
  | {
      success: false;
      error: 'invalid_content_type' | 'payload_too_large' | 'invalid_url_query' | 'malformed_body';
    };

export async function readBoundedUrlEncodedForm(
  request: Request,
  maxBytes = 4096
): Promise<ReadBoundedFormResult> {
  try {
    const parsedUrl = new URL(request.url);
    if (parsedUrl.search !== '') {
      return { success: false, error: 'invalid_url_query' };
    }

    const contentType = request.headers.get('content-type');
    if (!contentType) {
      return { success: false, error: 'invalid_content_type' };
    }

    // Strictly accept application/x-www-form-urlencoded with no params or charset=utf-8
    const isUrlEncoded = /^application\/x-www-form-urlencoded(?:\s*;\s*charset\s*=\s*utf-8\s*)?$/i.test(
      contentType.trim()
    );

    if (!isUrlEncoded) {
      return { success: false, error: 'invalid_content_type' };
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength) {
      const parsedLen = parseInt(contentLength, 10);
      if (!isNaN(parsedLen) && parsedLen > maxBytes) {
        return { success: false, error: 'payload_too_large' };
      }
    }

    if (!request.body) {
      return { success: true, params: new URLSearchParams() };
    }

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          return { success: false, error: 'payload_too_large' };
        }
        chunks.push(value);
      }
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const bodyText = new TextDecoder('utf-8', { fatal: true }).decode(combined);
    const params = new URLSearchParams(bodyText);

    return { success: true, params };
  } catch {
    return { success: false, error: 'malformed_body' };
  }
}
