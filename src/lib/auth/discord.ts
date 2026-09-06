import { AuthConfig } from './config';
import { isValidDiscordId, isValidDiscordUsername } from './crypto';

/**
 * Identity kept from Discord: the ID that anchors the account row, plus the
 * username shown to the member in the UI. `username` is null whenever Discord
 * omits it or returns a value outside the accepted shape.
 */
export interface DiscordIdentity {
  id: string;
  username: string | null;
}

export type DiscordGateResult =
  | { status: 'eligible'; discordUserId: string; discordUsername: string | null }
  | {
      status: 'ineligible';
      reason: 'missing_role' | 'unknown_member';
      discordUserId: string;
      discordUsername: string | null;
    }
  | { status: 'upstream_error'; error: string; httpStatus: 502 };

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 65536; // 64 KB cap
export const DISCORD_OAUTH_SCOPES = 'identify guilds.members.read';

async function readBoundedJson(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<Record<string, unknown>> {
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('Invalid Discord response content type');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error('Discord response body exceeds maximum allowed size');
  }

  if (!response.body) {
    throw new Error('Missing Discord response body');
  }

  const reader = response.body.getReader();
  let receivedLength = 0;
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        receivedLength += value.length;
        if (receivedLength > maxBytes) {
          await reader.cancel();
          throw new Error('Discord response body exceeded stream size limit');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const total = new Uint8Array(receivedLength);
  let offset = 0;
  for (const chunk of chunks) {
    total.set(chunk, offset);
    offset += chunk.length;
  }

  const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(total));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid Discord response shape');
  }
  return data as Record<string, unknown>;
}

export async function exchangeCodeForToken(
  code: string,
  verifier: string,
  config: AuthConfig
): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });

  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Discord token exchange failed with status ${response.status}`);
  }

  const data = await readBoundedJson(response);
  const grantedScopes = typeof data.scope === 'string' ? data.scope.split(' ') : [];
  if (
    typeof data.access_token !== 'string' ||
    data.access_token.length > 4096 ||
    !/^[A-Za-z0-9\-._~+/]+=*$/.test(data.access_token) ||
    typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer' ||
    typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0 ||
    !DISCORD_OAUTH_SCOPES.split(' ').every((scope) => grantedScopes.includes(scope))
  ) {
    throw new Error('Invalid token exchange response from Discord');
  }

  return data.access_token;
}

export async function fetchDiscordUserIdentity(accessToken: string): Promise<DiscordIdentity> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Discord @me fetch failed with status ${response.status}`);
  }

  const data = await readBoundedJson(response);
  if (!isValidDiscordId(data.id)) {
    throw new Error('Invalid user identity payload from Discord');
  }

  return {
    id: data.id,
    username: isValidDiscordUsername(data.username) ? data.username : null,
  };
}

type MemberCheck =
  | { status: 'eligible' }
  | { status: 'ineligible'; reason: 'missing_role' | 'unknown_member' }
  | { status: 'upstream_error'; error: string; httpStatus: 502 };

export async function checkGuildMembership(
  accessToken: string,
  config: AuthConfig
): Promise<MemberCheck> {
  const url = `${DISCORD_API_BASE}/users/@me/guilds/${config.discordGuildId}/member`;
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (response.status === 200) {
    const data = await readBoundedJson(response);
    if (Array.isArray(data.roles) && data.roles.every(isValidDiscordId)) {
      if (data.roles.includes(config.discordRequiredRoleId)) {
        return { status: 'eligible' };
      }
      return { status: 'ineligible', reason: 'missing_role' };
    }
    return { status: 'upstream_error', error: 'malformed_member_payload', httpStatus: 502 };
  }

  if (response.status === 404) {
    const data = await readBoundedJson(response);
    const discordCode = data.code;

    if (discordCode === 10007) {
      // 10007: Unknown Member -> confirmed ineligible
      return { status: 'ineligible', reason: 'unknown_member' };
    }

    if (discordCode === 10004) {
      // 10004: Unknown Guild -> ambiguous configuration error, upstream failure with 0 DB mutation
      return { status: 'upstream_error', error: 'unknown_guild', httpStatus: 502 };
    }

    return { status: 'upstream_error', error: 'discord_404_error', httpStatus: 502 };
  }

  return { status: 'upstream_error', error: `discord_status_${response.status}`, httpStatus: 502 };
}

export async function exchangeCodeAndCheckGuildRole(
  code: string,
  verifier: string,
  config: AuthConfig
): Promise<DiscordGateResult> {
  try {
    // Step 1: Exchange code for access token
    const accessToken = await exchangeCodeForToken(code, verifier, config);

    // Step 2: Fetch Discord user ID and username (discarding all other profile fields)
    const identity = await fetchDiscordUserIdentity(accessToken);

    // Step 3: Check guild membership and required role
    const membershipCheck = await checkGuildMembership(accessToken, config);

    if (membershipCheck.status === 'eligible') {
      return {
        status: 'eligible',
        discordUserId: identity.id,
        discordUsername: identity.username,
      };
    }

    if (membershipCheck.status === 'ineligible') {
      return {
        status: 'ineligible',
        reason: membershipCheck.reason,
        discordUserId: identity.id,
        discordUsername: identity.username,
      };
    }

    return {
      status: 'upstream_error',
      error: membershipCheck.error,
      httpStatus: 502,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown Discord communication failure';
    return {
      status: 'upstream_error',
      error: errorMsg,
      httpStatus: 502,
    };
  }
}
