export type AuthMode = 'disabled' | 'development' | 'production';

export interface AuthConfig {
  mode: 'development' | 'production';
  appBaseUrl: string;
  canonicalOrigin: string;
  oauthStateHmacSecret: string;
  gameAuthRequestHmacSecret: string;
  discordClientId: string;
  discordClientSecret: string;
  discordGuildId: string;
  discordRequiredRoleId: string;
  databaseUrl: string;
  redirectUri: string;
}

export const FORBIDDEN_IN_DISABLED = [
  'APP_BASE_URL',
  'OAUTH_STATE_HMAC_SECRET',
  'GAME_AUTH_REQUEST_HMAC_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
  'DISCORD_REQUIRED_ROLE_ID',
  'DATABASE_URL',
] as const;

const SNOWFLAKE_REGEX = /^[0-9]{1,20}$/;
const HEX_64_REGEX = /^[0-9a-fA-F]{64}$/;

export function getAuthMode(): AuthMode {
  const mode = process.env.AUTH_MODE;
  if (mode === 'disabled' || mode === 'development' || mode === 'production') {
    return mode;
  }
  throw new Error(
    `AUTH_MODE must be set to exactly 'disabled', 'development', or 'production' (received: ${mode === undefined ? 'undefined' : `'${mode}'`}).`
  );
}

export function isAuthEnabled(): boolean {
  return getAuthMode() !== 'disabled';
}

export function getAuthConfig(): AuthConfig {
  const mode = getAuthMode();

  if (mode === 'disabled') {
    throw new Error('Authentication is disabled in AUTH_MODE=disabled; no configuration available.');
  }

  const errors: string[] = [];

  // 1. APP_BASE_URL
  const rawBaseUrl = process.env.APP_BASE_URL;
  let canonicalOrigin = '';
  if (!rawBaseUrl || rawBaseUrl.trim() === '') {
    errors.push('Missing required variable APP_BASE_URL.');
  } else {
    const trimmed = rawBaseUrl.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.origin !== trimmed) {
        errors.push(
          'APP_BASE_URL must be a clean origin without path, trailing slash, query, or fragment.'
        );
      } else if (mode === 'production') {
        if (parsed.protocol !== 'https:') {
          errors.push('APP_BASE_URL must use https: in production mode.');
        } else if (trimmed !== 'https://teamham.world') {
          errors.push('APP_BASE_URL must be exactly https://teamham.world in production mode.');
        } else {
          canonicalOrigin = trimmed;
        }
      } else if (mode === 'development') {
        if (parsed.protocol === 'https:') {
          canonicalOrigin = parsed.origin;
        } else if (parsed.protocol === 'http:') {
          const hostname = parsed.hostname.toLowerCase();
          if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '[::1]' ||
            hostname === '::1'
          ) {
            canonicalOrigin = parsed.origin;
          } else {
            errors.push(
              'APP_BASE_URL with http: protocol in development mode must use a loopback host (localhost, 127.0.0.1, [::1]).'
            );
          }
        } else {
          errors.push('APP_BASE_URL must use http: or https: protocol.');
        }
      } else {
        canonicalOrigin = parsed.origin;
      }
    } catch {
      errors.push('APP_BASE_URL is not a valid URL origin.');
    }
  }

  // 2. OAUTH_STATE_HMAC_SECRET
  const rawHmacSecret = process.env.OAUTH_STATE_HMAC_SECRET;
  let oauthStateHmacSecret = '';
  if (!rawHmacSecret || rawHmacSecret.trim() === '') {
    errors.push('Missing required variable OAUTH_STATE_HMAC_SECRET.');
  } else {
    const trimmed = rawHmacSecret.trim();
    if (!HEX_64_REGEX.test(trimmed)) {
      errors.push('OAUTH_STATE_HMAC_SECRET must be a 64-character hex string (32 bytes).');
    } else {
      oauthStateHmacSecret = trimmed;
    }
  }

  // 2b. GAME_AUTH_REQUEST_HMAC_SECRET
  const rawGameHmacSecret = process.env.GAME_AUTH_REQUEST_HMAC_SECRET;
  let gameAuthRequestHmacSecret = '';
  if (!rawGameHmacSecret || rawGameHmacSecret.trim() === '') {
    errors.push('Missing required variable GAME_AUTH_REQUEST_HMAC_SECRET.');
  } else {
    const trimmed = rawGameHmacSecret.trim();
    if (!HEX_64_REGEX.test(trimmed)) {
      errors.push('GAME_AUTH_REQUEST_HMAC_SECRET must be a 64-character hex string (32 bytes).');
    } else {
      gameAuthRequestHmacSecret = trimmed;
    }
  }

  // 3. DISCORD_CLIENT_ID
  const rawClientId = process.env.DISCORD_CLIENT_ID;
  let discordClientId = '';
  if (!rawClientId || rawClientId.trim() === '') {
    errors.push('Missing required variable DISCORD_CLIENT_ID.');
  } else {
    const trimmed = rawClientId.trim();
    if (!SNOWFLAKE_REGEX.test(trimmed)) {
      errors.push('DISCORD_CLIENT_ID must be a numeric snowflake (1-20 digits).');
    } else {
      discordClientId = trimmed;
    }
  }

  // 4. DISCORD_CLIENT_SECRET
  const rawClientSecret = process.env.DISCORD_CLIENT_SECRET;
  let discordClientSecret = '';
  if (!rawClientSecret || rawClientSecret.trim() === '') {
    errors.push('Missing required variable DISCORD_CLIENT_SECRET.');
  } else {
    discordClientSecret = rawClientSecret.trim();
  }

  // 5. DISCORD_GUILD_ID
  const rawGuildId = process.env.DISCORD_GUILD_ID;
  let discordGuildId = '';
  if (!rawGuildId || rawGuildId.trim() === '') {
    errors.push('Missing required variable DISCORD_GUILD_ID.');
  } else {
    const trimmed = rawGuildId.trim();
    if (!SNOWFLAKE_REGEX.test(trimmed)) {
      errors.push('DISCORD_GUILD_ID must be a numeric snowflake (1-20 digits).');
    } else {
      discordGuildId = trimmed;
    }
  }

  // 6. DISCORD_REQUIRED_ROLE_ID
  const rawRoleId = process.env.DISCORD_REQUIRED_ROLE_ID;
  let discordRequiredRoleId = '';
  if (!rawRoleId || rawRoleId.trim() === '') {
    errors.push('Missing required variable DISCORD_REQUIRED_ROLE_ID.');
  } else {
    const trimmed = rawRoleId.trim();
    if (!SNOWFLAKE_REGEX.test(trimmed)) {
      errors.push('DISCORD_REQUIRED_ROLE_ID must be a numeric snowflake (1-20 digits).');
    } else {
      discordRequiredRoleId = trimmed;
    }
  }

  // 7. DATABASE_URL
  const rawDbUrl = process.env.DATABASE_URL;
  let databaseUrl = '';
  if (!rawDbUrl || rawDbUrl.trim() === '') {
    errors.push('Missing required variable DATABASE_URL.');
  } else {
    const trimmed = rawDbUrl.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
        errors.push('DATABASE_URL must use postgres: or postgresql: protocol.');
      } else if (decodeURIComponent(parsed.username) !== 'app_runtime_role') {
        errors.push('DATABASE_URL username must be app_runtime_role.');
      } else if (!parsed.password || parsed.password.trim() === '') {
        errors.push('DATABASE_URL must include a non-empty password.');
      } else if (!parsed.hostname || parsed.hostname.trim() === '') {
        errors.push('DATABASE_URL must include a non-empty hostname.');
      } else if (!parsed.pathname || parsed.pathname.trim() === '' || parsed.pathname.trim() === '/') {
        errors.push('DATABASE_URL must include a database name.');
      } else if (parsed.hash && parsed.hash !== '') {
        errors.push('DATABASE_URL must not contain a fragment.');
      } else {
        if (mode === 'production') {
          const sslmode = parsed.searchParams.get('sslmode')?.toLowerCase();
          const ssl = parsed.searchParams.get('ssl')?.toLowerCase();
          if (
            sslmode === 'disable' ||
            sslmode === 'allow' ||
            sslmode === 'prefer' ||
            ssl === 'false' ||
            ssl === '0' ||
            ssl === 'disable'
          ) {
            errors.push('DATABASE_URL must not specify insecure SSL settings in production mode.');
          }
        }
        databaseUrl = trimmed;
      }
    } catch {
      errors.push('DATABASE_URL is not a valid connection URL.');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Auth configuration validation failed:\n- ${errors.join('\n- ')}`);
  }

  const redirectUri = `${canonicalOrigin}/api/auth/discord/callback`;

  return {
    mode,
    appBaseUrl: rawBaseUrl!.trim(),
    canonicalOrigin,
    oauthStateHmacSecret,
    gameAuthRequestHmacSecret,
    discordClientId,
    discordClientSecret,
    discordGuildId,
    discordRequiredRoleId,
    databaseUrl,
    redirectUri,
  };
}

export function validateRequestOrigin(request: Request, config: AuthConfig): boolean {
  if (config.mode === 'development') {
    return true;
  }

  try {
    const canonicalUrl = new URL(config.canonicalOrigin);
    const expectedHost = canonicalUrl.host.toLowerCase();

    // 1. Validate request.url protocol and host
    const reqUrl = new URL(request.url);
    if (reqUrl.protocol.toLowerCase() !== 'https:') {
      return false;
    }
    if (reqUrl.host.toLowerCase() !== expectedHost) {
      return false;
    }

    // 2. Validate Host header if present
    const rawHost = request.headers.get('host');
    if (rawHost !== null) {
      if (rawHost.includes(',') || /[\x00-\x20\x7F]/.test(rawHost)) {
        return false;
      }
      const trimmedHost = rawHost.trim().toLowerCase();
      if (!trimmedHost || trimmedHost !== expectedHost) {
        return false;
      }
    }

    // 3. Validate X-Forwarded-Host header if present
    const xfHost = request.headers.get('x-forwarded-host');
    if (xfHost !== null) {
      if (xfHost.includes(',') || /[\x00-\x20\x7F]/.test(xfHost)) {
        return false;
      }
      const trimmedXfHost = xfHost.trim().toLowerCase();
      if (!trimmedXfHost || trimmedXfHost !== expectedHost) {
        return false;
      }
    }

    // 4. Validate X-Forwarded-Proto header if present
    const xfProto = request.headers.get('x-forwarded-proto');
    if (xfProto !== null) {
      if (xfProto.includes(',') || /[\x00-\x20\x7F]/.test(xfProto)) {
        return false;
      }
      const trimmedXfProto = xfProto.trim().toLowerCase();
      if (trimmedXfProto !== 'https') {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function validateLogoutOrigin(request: Request, config: AuthConfig): boolean {
  const originHeader = request.headers.get('origin');
  if (!originHeader) {
    return false;
  }

  if (originHeader.includes(',')) {
    return false;
  }

  const trimmedOrigin = originHeader.trim();
  try {
    const parsed = new URL(trimmedOrigin);
    if (parsed.origin !== trimmedOrigin) {
      return false;
    }
    return parsed.origin.toLowerCase() === config.canonicalOrigin.toLowerCase();
  } catch {
    return false;
  }
}
