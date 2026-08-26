import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  getAuthMode,
  isAuthEnabled,
  getAuthConfig,
  validateRequestOrigin,
  validateLogoutOrigin,
  FORBIDDEN_IN_DISABLED,
} from '@/lib/auth/config';
import { VALID_DEV_ENV, VALID_PROD_ENV, setTestEnv, clearAuthEnv } from '../helpers/test-fixtures';

describe('lib/auth/config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearAuthEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getAuthMode and isAuthEnabled', () => {
    it('accepts only "disabled", "development", and "production"', () => {
      setTestEnv({ AUTH_MODE: 'disabled' });
      expect(getAuthMode()).toBe('disabled');
      expect(isAuthEnabled()).toBe(false);

      setTestEnv({ AUTH_MODE: 'development' });
      expect(getAuthMode()).toBe('development');
      expect(isAuthEnabled()).toBe(true);

      setTestEnv({ AUTH_MODE: 'production' });
      expect(getAuthMode()).toBe('production');
      expect(isAuthEnabled()).toBe(true);
    });

    it('safely throws on missing or invalid AUTH_MODE', () => {
      clearAuthEnv();
      expect(() => getAuthMode()).toThrow(/AUTH_MODE must be set to exactly/);

      setTestEnv({ AUTH_MODE: 'staging' });
      expect(() => getAuthMode()).toThrow(/AUTH_MODE must be set to exactly/);

      setTestEnv({ AUTH_MODE: 'test' });
      expect(() => getAuthMode()).toThrow(/AUTH_MODE must be set to exactly/);

      setTestEnv({ AUTH_MODE: '' });
      expect(() => getAuthMode()).toThrow(/AUTH_MODE must be set to exactly/);
    });
  });

  describe('FORBIDDEN_IN_DISABLED inventory', () => {
    it('matches the exact documented secretless inventory', () => {
      expect(FORBIDDEN_IN_DISABLED).toEqual([
        'APP_BASE_URL',
        'OAUTH_STATE_HMAC_SECRET',
        'GAME_AUTH_REQUEST_HMAC_SECRET',
        'DISCORD_CLIENT_ID',
        'DISCORD_CLIENT_SECRET',
        'DISCORD_GUILD_ID',
        'DISCORD_REQUIRED_ROLE_ID',
        'DATABASE_URL',
      ]);
    });

    it('throws when getAuthConfig is called in disabled mode', () => {
      setTestEnv({ AUTH_MODE: 'disabled' });
      expect(() => getAuthConfig()).toThrow('Authentication is disabled in AUTH_MODE=disabled; no configuration available.');
    });
  });

  describe('getAuthConfig with valid configs', () => {
    it('parses valid development configuration', () => {
      setTestEnv(VALID_DEV_ENV);
      const config = getAuthConfig();

      expect(config.mode).toBe('development');
      expect(config.appBaseUrl).toBe('https://localhost:3000');
      expect(config.canonicalOrigin).toBe('https://localhost:3000');
      expect(config.redirectUri).toBe('https://localhost:3000/api/auth/discord/callback');
      expect(config.oauthStateHmacSecret).toBe(VALID_DEV_ENV.OAUTH_STATE_HMAC_SECRET);
      expect(config.gameAuthRequestHmacSecret).toBe(VALID_DEV_ENV.GAME_AUTH_REQUEST_HMAC_SECRET);
      expect(config.discordClientId).toBe(VALID_DEV_ENV.DISCORD_CLIENT_ID);
      expect(config.discordClientSecret).toBe(VALID_DEV_ENV.DISCORD_CLIENT_SECRET);
      expect(config.discordGuildId).toBe(VALID_DEV_ENV.DISCORD_GUILD_ID);
      expect(config.discordRequiredRoleId).toBe(VALID_DEV_ENV.DISCORD_REQUIRED_ROLE_ID);
      expect(config.databaseUrl).toBe(VALID_DEV_ENV.DATABASE_URL);
    });

    it('parses valid production configuration', () => {
      setTestEnv(VALID_PROD_ENV);
      const config = getAuthConfig();

      expect(config.mode).toBe('production');
      expect(config.canonicalOrigin).toBe('https://teamham.world');
      expect(config.redirectUri).toBe('https://teamham.world/api/auth/discord/callback');
      expect(config.oauthStateHmacSecret).toBe(VALID_PROD_ENV.OAUTH_STATE_HMAC_SECRET);
      expect(config.gameAuthRequestHmacSecret).toBe(VALID_PROD_ENV.GAME_AUTH_REQUEST_HMAC_SECRET);
    });
  });

  describe('APP_BASE_URL validation', () => {
    it('rejects trailing slash, path, query, fragment, and malformed URL', () => {
      const invalidUrls = [
        'https://teamham.world/',
        'https://teamham.world/subpath',
        'https://teamham.world?query=1',
        'https://teamham.world#hash',
        'not-a-url',
      ];

      for (const url of invalidUrls) {
        setTestEnv({ ...VALID_PROD_ENV, APP_BASE_URL: url });
        expect(() => getAuthConfig()).toThrow(/APP_BASE_URL/);
      }
    });

    it('rejects http: in production mode', () => {
      setTestEnv({ ...VALID_PROD_ENV, APP_BASE_URL: 'http://teamham.world' });
      expect(() => getAuthConfig()).toThrow(/APP_BASE_URL must use https: in production mode/);
    });

    it('allows loopback http: only in development mode, rejecting remote http:', () => {
      const validLoopbacks = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://[::1]:3000',
      ];

      for (const url of validLoopbacks) {
        setTestEnv({ ...VALID_DEV_ENV, APP_BASE_URL: url });
        const config = getAuthConfig();
        expect(config.canonicalOrigin).toBe(url);
      }

      setTestEnv({ ...VALID_DEV_ENV, APP_BASE_URL: 'http://example.com:3000' });
      expect(() => getAuthConfig()).toThrow(/loopback host/);
    });
  });

  describe('Secret and snowflake validations', () => {
    it('rejects invalid OAUTH_STATE_HMAC_SECRET length or encoding', () => {
      // 32 chars instead of 64
      setTestEnv({ ...VALID_DEV_ENV, OAUTH_STATE_HMAC_SECRET: '0123456789abcdef0123456789abcdef' });
      expect(() => getAuthConfig()).toThrow(/OAUTH_STATE_HMAC_SECRET must be a 64-character hex string/);

      // 64 chars but non-hex
      setTestEnv({ ...VALID_DEV_ENV, OAUTH_STATE_HMAC_SECRET: 'z'.repeat(64) });
      expect(() => getAuthConfig()).toThrow(/OAUTH_STATE_HMAC_SECRET must be a 64-character hex string/);
    });

    it('rejects invalid GAME_AUTH_REQUEST_HMAC_SECRET length or encoding', () => {
      // 32 chars instead of 64
      setTestEnv({ ...VALID_DEV_ENV, GAME_AUTH_REQUEST_HMAC_SECRET: '0123456789abcdef0123456789abcdef' });
      expect(() => getAuthConfig()).toThrow(/GAME_AUTH_REQUEST_HMAC_SECRET must be a 64-character hex string/);

      // 64 chars but non-hex
      setTestEnv({ ...VALID_DEV_ENV, GAME_AUTH_REQUEST_HMAC_SECRET: 'z'.repeat(64) });
      expect(() => getAuthConfig()).toThrow(/GAME_AUTH_REQUEST_HMAC_SECRET must be a 64-character hex string/);
    });

    it('rejects malformed snowflake IDs for client, guild, and role', () => {
      const invalidSnowflakes = ['abc', '123456789012345678901', '-12345'];

      for (const invalid of invalidSnowflakes) {
        setTestEnv({ ...VALID_DEV_ENV, DISCORD_CLIENT_ID: invalid });
        expect(() => getAuthConfig()).toThrow(/DISCORD_CLIENT_ID must be a numeric snowflake/);

        setTestEnv({ ...VALID_DEV_ENV, DISCORD_GUILD_ID: invalid });
        expect(() => getAuthConfig()).toThrow(/DISCORD_GUILD_ID must be a numeric snowflake/);

        setTestEnv({ ...VALID_DEV_ENV, DISCORD_REQUIRED_ROLE_ID: invalid });
        expect(() => getAuthConfig()).toThrow(/DISCORD_REQUIRED_ROLE_ID must be a numeric snowflake/);
      }
    });

    it('rejects missing or empty snowflakes and secrets', () => {
      setTestEnv({ ...VALID_DEV_ENV, DISCORD_CLIENT_ID: '' });
      expect(() => getAuthConfig()).toThrow(/Missing required variable DISCORD_CLIENT_ID/);

      setTestEnv({ ...VALID_DEV_ENV, DISCORD_GUILD_ID: '' });
      expect(() => getAuthConfig()).toThrow(/Missing required variable DISCORD_GUILD_ID/);

      setTestEnv({ ...VALID_DEV_ENV, DISCORD_REQUIRED_ROLE_ID: '' });
      expect(() => getAuthConfig()).toThrow(/Missing required variable DISCORD_REQUIRED_ROLE_ID/);

      setTestEnv({ ...VALID_DEV_ENV, DISCORD_CLIENT_SECRET: '' });
      expect(() => getAuthConfig()).toThrow(/Missing required variable DISCORD_CLIENT_SECRET/);

      setTestEnv({ ...VALID_DEV_ENV, OAUTH_STATE_HMAC_SECRET: '' });
      expect(() => getAuthConfig()).toThrow(/Missing required variable OAUTH_STATE_HMAC_SECRET/);

      setTestEnv({ ...VALID_DEV_ENV, GAME_AUTH_REQUEST_HMAC_SECRET: '' });
      expect(() => getAuthConfig()).toThrow(/Missing required variable GAME_AUTH_REQUEST_HMAC_SECRET/);

      setTestEnv({ ...VALID_DEV_ENV, DATABASE_URL: '' });
      expect(() => getAuthConfig()).toThrow(/Missing required variable DATABASE_URL/);
    });
  });

  describe('DATABASE_URL validation', () => {
    it('accepts valid dev and production app_runtime_role URLs', () => {
      // Dev
      setTestEnv(VALID_DEV_ENV);
      expect(getAuthConfig().databaseUrl).toBe(VALID_DEV_ENV.DATABASE_URL);

      // Prod with sslmode=require
      setTestEnv(VALID_PROD_ENV);
      expect(getAuthConfig().databaseUrl).toBe(VALID_PROD_ENV.DATABASE_URL);

      // Prod with omitted sslmode
      setTestEnv({
        ...VALID_PROD_ENV,
        DATABASE_URL: 'postgres://app_runtime_role:secret_pw@ep-prod-1234.us-east-2.aws.neon.tech/neondb',
      });
      expect(getAuthConfig().databaseUrl).toBe(
        'postgres://app_runtime_role:secret_pw@ep-prod-1234.us-east-2.aws.neon.tech/neondb'
      );

      // Prod with postgresql: scheme and case-insensitive sslmode=REQUIRE
      setTestEnv({
        ...VALID_PROD_ENV,
        DATABASE_URL: 'postgresql://app_runtime_role:secret_pw@ep-prod-1234.us-east-2.aws.neon.tech/neondb?sslmode=REQUIRE',
      });
      expect(getAuthConfig().databaseUrl).toBe(
        'postgresql://app_runtime_role:secret_pw@ep-prod-1234.us-east-2.aws.neon.tech/neondb?sslmode=REQUIRE'
      );
    });

    it('rejects invalid database URL schemes, usernames, missing components, and fragments', () => {
      const secret = 'SUPER_SECRET_DB_PASS_XYZ';
      const testCases = [
        { url: `mysql://app_runtime_role:${secret}@localhost:5432/neondb`, reason: /protocol/ },
        { url: `http://app_runtime_role:${secret}@localhost:5432/neondb`, reason: /protocol/ },
        { url: `postgres://neondb_owner:${secret}@localhost:5432/neondb`, reason: /username must be app_runtime_role/ },
        { url: `postgres://postgres:${secret}@localhost:5432/neondb`, reason: /username must be app_runtime_role/ },
        { url: `postgres://app_runtime_role@localhost:5432/neondb`, reason: /password/ },
        { url: `postgres://app_runtime_role:@localhost:5432/neondb`, reason: /password/ },
        { url: `postgres://app_runtime_role:${secret}@/neondb`, reason: /hostname|valid connection URL/ },
        { url: `postgres://app_runtime_role:${secret}@localhost:5432`, reason: /database name/ },
        { url: `postgres://app_runtime_role:${secret}@localhost:5432/`, reason: /database name/ },
        { url: `postgres://app_runtime_role:${secret}@localhost:5432/neondb#frag`, reason: /fragment/ },
      ];

      for (const { url, reason } of testCases) {
        setTestEnv({ ...VALID_DEV_ENV, DATABASE_URL: url });
        let thrownError: Error | null = null;
        try {
          getAuthConfig();
        } catch (err: unknown) {
          thrownError = err as Error;
        }
        expect(thrownError).not.toBeNull();
        expect(thrownError!.message).toMatch(reason);
        expect(thrownError!.message).not.toContain(secret);
      }
    });

    it('rejects insecure SSL settings in production mode case-insensitively', () => {
      const secret = 'SUPER_SECRET_DB_PASS_XYZ';
      const insecureParams = [
        'sslmode=disable',
        'sslmode=DISABLE',
        'sslmode=allow',
        'sslmode=ALLOW',
        'sslmode=prefer',
        'sslmode=PREFER',
        'ssl=false',
        'ssl=FALSE',
        'ssl=0',
        'ssl=disable',
        'ssl=DISABLE',
      ];

      for (const param of insecureParams) {
        setTestEnv({
          ...VALID_PROD_ENV,
          DATABASE_URL: `postgres://app_runtime_role:${secret}@ep-prod-1234.us-east-2.aws.neon.tech/neondb?${param}`,
        });
        let thrownError: Error | null = null;
        try {
          getAuthConfig();
        } catch (err: unknown) {
          thrownError = err as Error;
        }
        expect(thrownError).not.toBeNull();
        expect(thrownError!.message).toMatch(/insecure SSL settings in production mode/);
        expect(thrownError!.message).not.toContain(secret);
      }
    });

    it('permits relaxed SSL in development mode while still enforcing runtime role and URL validity', () => {
      // Dev mode permits sslmode=disable
      setTestEnv({
        ...VALID_DEV_ENV,
        DATABASE_URL: 'postgres://app_runtime_role:secret@localhost:5432/neondb?sslmode=disable',
      });
      expect(getAuthConfig().databaseUrl).toContain('sslmode=disable');

      // Dev mode permits ssl=false
      setTestEnv({
        ...VALID_DEV_ENV,
        DATABASE_URL: 'postgres://app_runtime_role:secret@localhost:5432/neondb?ssl=false',
      });
      expect(getAuthConfig().databaseUrl).toContain('ssl=false');

      // Dev mode still requires app_runtime_role
      setTestEnv({
        ...VALID_DEV_ENV,
        DATABASE_URL: 'postgres://owner_user:secret@localhost:5432/neondb?sslmode=disable',
      });
      expect(() => getAuthConfig()).toThrow(/DATABASE_URL username must be app_runtime_role/);

      // Dev mode still requires postgres protocol
      setTestEnv({
        ...VALID_DEV_ENV,
        DATABASE_URL: 'mysql://app_runtime_role:secret@localhost:5432/neondb',
      });
      expect(() => getAuthConfig()).toThrow(/DATABASE_URL must use postgres: or postgresql: protocol/);
    });
  });

  describe('validateRequestOrigin', () => {
    it('always permits in development mode', () => {
      setTestEnv(VALID_DEV_ENV);
      const config = getAuthConfig();

      const req = new Request('http://localhost:3000/account', {
        headers: { host: 'localhost:3000' },
      });
      expect(validateRequestOrigin(req, config)).toBe(true);
    });

    it('validates canonical origin in production mode', () => {
      setTestEnv(VALID_PROD_ENV);
      const config = getAuthConfig();

      // Valid headers
      const validReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https',
        },
      });
      expect(validateRequestOrigin(validReq, config)).toBe(true);

      // Comma-separated host
      const multiHostReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world, evil.com',
          'x-forwarded-proto': 'https',
        },
      });
      expect(validateRequestOrigin(multiHostReq, config)).toBe(false);

      // Comma-separated proto rejected
      const multiProtoReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'https, http',
        },
      });
      expect(validateRequestOrigin(multiProtoReq, config)).toBe(false);

      // Empty forwarded host rejected
      const emptyHostReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': '',
          'x-forwarded-proto': 'https',
        },
      });
      expect(validateRequestOrigin(emptyHostReq, config)).toBe(false);

      const whitespaceHostReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': '   ',
          'x-forwarded-proto': 'https',
        },
      });
      expect(validateRequestOrigin(whitespaceHostReq, config)).toBe(false);

      // Empty forwarded proto rejected
      const emptyProtoReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': '',
        },
      });
      expect(validateRequestOrigin(emptyProtoReq, config)).toBe(false);

      const whitespaceProtoReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': '   ',
        },
      });
      expect(validateRequestOrigin(whitespaceProtoReq, config)).toBe(false);

      // Canonical HTTPS request URL works when forwarded proto is absent
      const noProtoHttpsReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
        },
      });
      expect(validateRequestOrigin(noProtoHttpsReq, config)).toBe(true);

      const hostOnlyHttpsReq = new Request('https://teamham.world/account', {
        headers: {
          host: 'teamham.world',
        },
      });
      expect(validateRequestOrigin(hostOnlyHttpsReq, config)).toBe(true);

      // HTTP request URL fails when forwarded proto is absent
      const noProtoHttpReq = new Request('http://teamham.world/account', {
        headers: {
          host: 'teamham.world',
        },
      });
      expect(validateRequestOrigin(noProtoHttpReq, config)).toBe(false);

      // Mismatched x-forwarded-host
      const invalidHostReq = new Request('https://evil.com/account', {
        headers: {
          'x-forwarded-host': 'evil.com',
          'x-forwarded-proto': 'https',
        },
      });
      expect(validateRequestOrigin(invalidHostReq, config)).toBe(false);

      // Comma-separated host header rejected
      const multiRawHostReq = new Request('https://teamham.world/account', {
        headers: {
          host: 'teamham.world, evil.com',
          'x-forwarded-proto': 'https',
        },
      });
      expect(validateRequestOrigin(multiRawHostReq, config)).toBe(false);

      // Mismatched raw host
      const invalidRawHostReq = new Request('https://teamham.world/account', {
        headers: {
          host: 'evil.com',
          'x-forwarded-proto': 'https',
        },
      });
      expect(validateRequestOrigin(invalidRawHostReq, config)).toBe(false);

      // Non-https proto
      const httpProtoReq = new Request('https://teamham.world/account', {
        headers: {
          'x-forwarded-host': 'teamham.world',
          'x-forwarded-proto': 'http',
        },
      });
      expect(validateRequestOrigin(httpProtoReq, config)).toBe(false);
    });
  });

  describe('validateLogoutOrigin', () => {
    it('enforces exact same-origin Origin header', () => {
      setTestEnv(VALID_PROD_ENV);
      const config = getAuthConfig();

      // Exact match
      const validReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://teamham.world' },
      });
      expect(validateLogoutOrigin(validReq, config)).toBe(true);

      // Missing origin
      const noOriginReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
      });
      expect(validateLogoutOrigin(noOriginReq, config)).toBe(false);

      // Comma/duplicate-like origin
      const commaOriginReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://teamham.world, https://evil.com' },
      });
      expect(validateLogoutOrigin(commaOriginReq, config)).toBe(false);

      // Origin with path
      const pathOriginReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://teamham.world/account' },
      });
      expect(validateLogoutOrigin(pathOriginReq, config)).toBe(false);

      // Different scheme
      const httpOriginReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'http://teamham.world' },
      });
      expect(validateLogoutOrigin(httpOriginReq, config)).toBe(false);

      // Different host
      const wrongHostReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://evil.com' },
      });
      expect(validateLogoutOrigin(wrongHostReq, config)).toBe(false);
    });

    // Browsers serialize the origin as the literal string 'null' when the
    // document's referrer policy is 'no-referrer'. Protected pages must not use
    // that policy, or the logout form POST is rejected here. See
    // applyProtectedHeaders in lib/auth/http.ts.
    it('rejects an opaque `null` Origin', () => {
      setTestEnv(VALID_PROD_ENV);
      const config = getAuthConfig();

      const nullOriginReq = new Request('https://teamham.world/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'null' },
      });
      expect(validateLogoutOrigin(nullOriginReq, config)).toBe(false);
    });
  });

  describe('scripts/preflight.ts CLI validation', () => {
    const projectRoot = path.resolve(__dirname, '../..');
    const preflightScript = path.resolve(projectRoot, 'scripts/preflight.ts');

    const cleanBaseEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([k]) =>
          !k.startsWith('DISCORD_') &&
          !k.startsWith('MEMBER_PAGE_R2_') &&
          !k.startsWith('MEMBER_PAGE_V2_') &&
          ![
            'APP_BASE_URL',
            'OAUTH_STATE_HMAC_SECRET',
            'GAME_AUTH_REQUEST_HMAC_SECRET',
            'DATABASE_URL',
            'AUTH_MODE',
          ].includes(k)
      )
    );

    it('clean disabled mode succeeds', () => {
      const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', preflightScript],
        {
          cwd: projectRoot,
          env: {
            ...cleanBaseEnv,
            NODE_ENV: process.env.NODE_ENV || 'test',
            AUTH_MODE: 'disabled',
          },
          encoding: 'utf8',
          stdio: 'pipe',
        }
      );
      expect(output).toContain('Preflight validation succeeded (mode: disabled).');
    });

    it('disabled mode with fake DATABASE_URL fails without leaking credentials', () => {
      const fakeSecretUrl = 'postgres://fake-user:SUPER_SECRET_VALUE@localhost:5432/db';
      let failed = false;
      let combinedOutput = '';

      try {
        execFileSync(
          process.execPath,
          ['--import', 'tsx', preflightScript],
          {
            cwd: projectRoot,
            env: {
              ...cleanBaseEnv,
              NODE_ENV: process.env.NODE_ENV || 'test',
              AUTH_MODE: 'disabled',
              DATABASE_URL: fakeSecretUrl,
            },
            encoding: 'utf8',
            stdio: 'pipe',
          }
        );
      } catch (err: unknown) {
        failed = true;
        const execErr = err as { stdout?: string; stderr?: string };
        combinedOutput = `${execErr.stdout || ''}\n${execErr.stderr || ''}`;
      }

      expect(failed).toBe(true);
      expect(combinedOutput).toContain('Forbidden variable DATABASE_URL is configured');
      expect(combinedOutput).not.toContain(fakeSecretUrl);
      expect(combinedOutput).not.toContain('SUPER_SECRET_VALUE');
    });

    it('valid production runtime-role URL succeeds', () => {
      const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', preflightScript],
        {
          cwd: projectRoot,
          env: {
            ...cleanBaseEnv,
            NODE_ENV: 'test',
            ...VALID_PROD_ENV,
          },
          encoding: 'utf8',
          stdio: 'pipe',
        }
      );
      expect(output).toContain('Preflight validation succeeded (mode: production).');
    });

    it('owner-role in production fails without leaking URL or password', () => {
      const secretPass = 'SUPER_SECRET_OWNER_PASS_123';
      const ownerUrl = `postgres://neondb_owner:${secretPass}@ep-prod-1234.us-east-2.aws.neon.tech/neondb?sslmode=require`;
      let failed = false;
      let combinedOutput = '';

      try {
        execFileSync(
          process.execPath,
          ['--import', 'tsx', preflightScript],
          {
            cwd: projectRoot,
            env: {
              ...cleanBaseEnv,
              NODE_ENV: 'test',
              ...VALID_PROD_ENV,
              DATABASE_URL: ownerUrl,
            },
            encoding: 'utf8',
            stdio: 'pipe',
          }
        );
      } catch (err: unknown) {
        failed = true;
        const execErr = err as { stdout?: string; stderr?: string };
        combinedOutput = `${execErr.stdout || ''}\n${execErr.stderr || ''}`;
      }

      expect(failed).toBe(true);
      expect(combinedOutput).toContain("DATABASE_URL must authenticate as user 'app_runtime_role'");
      expect(combinedOutput).not.toContain(ownerUrl);
      expect(combinedOutput).not.toContain(secretPass);
    });

    it('insecure production URL fails without leaking URL or password', () => {
      const secretPass = 'SUPER_SECRET_INSECURE_PASS_456';
      const insecureUrl = `postgres://app_runtime_role:${secretPass}@ep-prod-1234.us-east-2.aws.neon.tech/neondb?sslmode=disable`;
      let failed = false;
      let combinedOutput = '';

      try {
        execFileSync(
          process.execPath,
          ['--import', 'tsx', preflightScript],
          {
            cwd: projectRoot,
            env: {
              ...cleanBaseEnv,
              NODE_ENV: 'test',
              ...VALID_PROD_ENV,
              DATABASE_URL: insecureUrl,
            },
            encoding: 'utf8',
            stdio: 'pipe',
          }
        );
      } catch (err: unknown) {
        failed = true;
        const execErr = err as { stdout?: string; stderr?: string };
        combinedOutput = `${execErr.stdout || ''}\n${execErr.stderr || ''}`;
      }

      expect(failed).toBe(true);
      expect(combinedOutput).toContain('must not disable or downgrade SSL');
      expect(combinedOutput).not.toContain(insecureUrl);
      expect(combinedOutput).not.toContain(secretPass);
    });
  });
});
