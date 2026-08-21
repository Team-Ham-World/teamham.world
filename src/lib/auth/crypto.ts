import crypto from 'node:crypto';

export const ALLOWED_OAUTH_RETURN_TO = '/api/auth/game/authorize/resume' as const;
export type AllowedOAuthReturnTo = typeof ALLOWED_OAUTH_RETURN_TO;

export interface OAuthStatePayload {
  state: string;
  verifier: string;
  issuedAt: number; // Unix timestamp in seconds
  returnTo: AllowedOAuthReturnTo | null;
}

const OAUTH_STATE_REGEX = /^[A-Za-z0-9_-]{22}$/;
const PKCE_VERIFIER_REGEX = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_REGEX = /^[0-9a-f]{64}$/;
const DISCORD_ID_REGEX = /^[0-9]{1,20}$/;
// Discord's current username shape. Values that fail it are dropped rather
// than stored, so a legacy or unexpected handle never blocks a login.
const DISCORD_USERNAME_REGEX = /^[A-Za-z0-9._]{2,32}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateOAuthState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function generatePkceVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generatePkceChallenge(verifier: string): string {
  if (!isValidPkceVerifier(verifier)) {
    throw new Error('Invalid PKCE verifier format');
  }
  return crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  if (!isValidSessionToken(token)) {
    throw new Error('Invalid session token format');
  }
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex').toLowerCase();
}

export function isValidOAuthState(state: unknown): state is string {
  return typeof state === 'string' && OAUTH_STATE_REGEX.test(state);
}

export function isValidPkceVerifier(verifier: unknown): verifier is string {
  return typeof verifier === 'string' && PKCE_VERIFIER_REGEX.test(verifier);
}

export function isValidSessionToken(token: unknown): token is string {
  return typeof token === 'string' && SESSION_TOKEN_REGEX.test(token);
}

export function isValidTokenHash(hash: unknown): hash is string {
  return typeof hash === 'string' && TOKEN_HASH_REGEX.test(hash);
}

export function isValidDiscordId(id: unknown): id is string {
  return typeof id === 'string' && DISCORD_ID_REGEX.test(id);
}

export function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export function isValidDiscordUsername(username: unknown): username is string {
  return typeof username === 'string' && DISCORD_USERNAME_REGEX.test(username);
}

function getHmacKey(secret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  return Buffer.from(secret, 'utf8');
}

export function signOAuthState(
  payload: {
    state: string;
    verifier: string;
    issuedAt: number;
    returnTo?: AllowedOAuthReturnTo | null;
  },
  secret: string
): string {
  if (!isValidOAuthState(payload.state)) {
    throw new Error('Invalid OAuth state in payload');
  }
  if (!isValidPkceVerifier(payload.verifier)) {
    throw new Error('Invalid PKCE verifier in payload');
  }
  if (typeof payload.issuedAt !== 'number' || !Number.isInteger(payload.issuedAt)) {
    throw new Error('Invalid issuedAt in payload');
  }
  const returnTo = payload.returnTo ?? null;
  if (returnTo !== null && returnTo !== ALLOWED_OAUTH_RETURN_TO) {
    throw new Error('Invalid returnTo in payload');
  }

  const jsonStr = JSON.stringify({
    state: payload.state,
    verifier: payload.verifier,
    issuedAt: payload.issuedAt,
    returnTo,
  });

  const rawPayload = Buffer.from(jsonStr, 'utf8').toString('base64url');
  const key = getHmacKey(secret);
  const signature = crypto.createHmac('sha256', key).update(rawPayload).digest('base64url');

  return `${rawPayload}.${signature}`;
}

export function verifyOAuthStateCookie(
  cookieValue: string | undefined | null,
  secret: string,
  maxAgeSeconds = 600
): OAuthStatePayload | null {
  if (!cookieValue || typeof cookieValue !== 'string') {
    return null;
  }

  // Input bounds checks before parsing
  if (cookieValue.length > 512 || cookieValue.length < 10) {
    return null;
  }

  const parts = cookieValue.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [rawPayload, signature] = parts;
  if (!rawPayload || !signature) {
    return null;
  }

  // Constant-time signature verification
  const key = getHmacKey(secret);
  const expectedSignature = crypto.createHmac('sha256', key).update(rawPayload).digest('base64url');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expectedSignature, 'utf8');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  // Decode and validate payload JSON
  try {
    const jsonStr = Buffer.from(rawPayload, 'base64url').toString('utf8');
    const parsed = JSON.parse(jsonStr);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const keys = Object.keys(parsed);
    if (keys.length !== 4) {
      return null;
    }

    if (
      !Object.prototype.hasOwnProperty.call(parsed, 'state') ||
      !Object.prototype.hasOwnProperty.call(parsed, 'verifier') ||
      !Object.prototype.hasOwnProperty.call(parsed, 'issuedAt') ||
      !Object.prototype.hasOwnProperty.call(parsed, 'returnTo')
    ) {
      return null;
    }

    if (!isValidOAuthState(parsed.state)) {
      return null;
    }

    if (!isValidPkceVerifier(parsed.verifier)) {
      return null;
    }

    if (typeof parsed.issuedAt !== 'number' || !Number.isInteger(parsed.issuedAt)) {
      return null;
    }

    if (parsed.returnTo !== null && parsed.returnTo !== ALLOWED_OAUTH_RETURN_TO) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    // Reject materially future-issued timestamps (> 60 seconds)
    if (parsed.issuedAt > now + 60) {
      return null;
    }

    // Reject expired state (> maxAgeSeconds)
    if (now - parsed.issuedAt > maxAgeSeconds) {
      return null;
    }

    return {
      state: parsed.state,
      verifier: parsed.verifier,
      issuedAt: parsed.issuedAt,
      returnTo: parsed.returnTo,
    };
  } catch {
    return null;
  }
}
