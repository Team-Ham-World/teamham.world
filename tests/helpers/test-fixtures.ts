export const VALID_DEV_ENV = {
  AUTH_MODE: 'development',
  APP_BASE_URL: 'https://localhost:3000',
  OAUTH_STATE_HMAC_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  GAME_AUTH_REQUEST_HMAC_SECRET: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'test_dev_discord_client_secret',
  DISCORD_GUILD_ID: '987654321098765432',
  DISCORD_REQUIRED_ROLE_ID: '112233445566778899',
  DATABASE_URL: 'postgres://app_runtime_role:secret@localhost:5432/neondb',
} as const;

export const VALID_PROD_ENV = {
  AUTH_MODE: 'production',
  APP_BASE_URL: 'https://teamham.world',
  OAUTH_STATE_HMAC_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  GAME_AUTH_REQUEST_HMAC_SECRET: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'test_prod_discord_client_secret',
  DISCORD_GUILD_ID: '987654321098765432',
  DISCORD_REQUIRED_ROLE_ID: '112233445566778899',
  DATABASE_URL: 'postgres://app_runtime_role:secret@ep-prod-1234.us-east-2.aws.neon.tech/neondb?sslmode=require',
} as const;

export const VALID_GAME_CLIENT_ID = 'poker';
export const VALID_GAME_AUDIENCE = 'urn:teamham:game:poker';
export const VALID_GAME_REDIRECT_URI = 'https://poker.teamham.world/auth/callback';
export const VALID_DEV_GAME_REDIRECT_URI = 'https://localhost:3001/auth/callback';
export const VALID_GAME_AUTH_SCOPE = 'identity';

const AUTH_ENV_KEYS = [
  'AUTH_MODE',
  'APP_BASE_URL',
  'OAUTH_STATE_HMAC_SECRET',
  'GAME_AUTH_REQUEST_HMAC_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_GUILD_ID',
  'DISCORD_REQUIRED_ROLE_ID',
  'DATABASE_URL',
] as const;

export function clearAuthEnv(): void {
  for (const key of AUTH_ENV_KEYS) {
    delete process.env[key];
  }
}

export function setTestEnv(env: Partial<Record<(typeof AUTH_ENV_KEYS)[number], string>>): void {
  clearAuthEnv();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}
