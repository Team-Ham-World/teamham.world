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

async function readBoundedJson(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error('Discord response body exceeds maximum allowed size');
  }

  if (!response.body) {
    return null;
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

  const text = new TextDecoder('utf-8').decode(total);
  if (!text || text.trim() === '') {
    return null;
  }

  return JSON.parse(text);
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

  const data = (await readBoundedJson(response)) as Record<string, unknown> | null;
  if (!data || typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('Invalid token exchange response from Discord');
  }

  return data.access_token;
}

export async function fetchDiscordUserIdentity(accessToken: string): Promise<DiscordIdentity> {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Discord @me fetch failed with status ${response.status}`);
  }

  const data = (await readBoundedJson(response)) as Record<string, unknown> | null;
  if (!data || !isValidDiscordId(data.id)) {
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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (response.status === 200) {
    const data = (await readBoundedJson(response)) as Record<string, unknown> | null;
    if (data && Array.isArray(data.roles)) {
      if (data.roles.includes(config.discordRequiredRoleId)) {
        return { status: 'eligible' };
      }
      return { status: 'ineligible', reason: 'missing_role' };
    }
    return { status: 'upstream_error', error: 'malformed_member_payload', httpStatus: 502 };
  }

  if (response.status === 404) {
    const data = (await readBoundedJson(response)) as Record<string, unknown> | null;
    const discordCode = data && typeof data === 'object' ? data.code : undefined;

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
