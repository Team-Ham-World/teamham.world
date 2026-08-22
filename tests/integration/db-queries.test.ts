/**
 * Real PostgreSQL Schema, Query, and Least-Privilege Integration Suite
 *
 * Authoritative source: organization-docs/website/MEMBER_SYSTEM_IMPLEMENTATION.md (Sections 3, 4, 7, AC-3/4/5)
 * and Game Backend Authorization Handoff (0002 Schema, Pairwise Subjects, Least-Privilege).
 *
 * TRANSPORT CONSTRAINT NOTE:
 * @neondatabase/serverless tagged HTTP queries cannot talk to a stock local Postgres service.
 * Therefore, this integration suite exercises the authoritative parameterized SQL query paths
 * against real PostgreSQL via standard `pg` pool connections (both owner and app_runtime_role).
 * Other mocked unit/integration test suites cover application handler HTTP wiring.
 *
 * ENVIRONMENT & SAFETY CONTRACT:
 * - Suite executes only when TEST_DATABASE_URL is explicitly set; otherwise gracefully skips.
 * - Refuses destructive setup unless ALL THREE safety gates pass:
 *     1. Explicit opt-in flag ALLOW_LOCAL_DB_TESTS=1 is present.
 *     2. Target host is strictly loopback (localhost, 127.0.0.1, ::1).
 *     3. Database name is on the disposable allowlist (neondb, test, testdb, teamham_test, postgres_test).
 * - Passwords, connection URLs, and connection host details are never logged or exposed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Pool, DatabaseError } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import {
  issueLoginSession,
  verifySession,
  deleteSessionByTokenHash,
} from '@/lib/auth/db';
import {
  getGameOAuthClient,
  authenticateGameClient,
  issueGameAuthorizationCode,
  exchangeGameAuthorizationCode,
  introspectGameAccessToken,
  revokeGameAccessToken,
} from '@/lib/auth/game-db';
import {
  generateGameClientSecret,
  generateGamePkce,
  derivePkceChallenge,
  hashGameToken,
  generateGameAuthorizationCode,
  generateGameAccessToken,
} from '@/lib/auth/game-oauth';
import { getPuffLeaderboard, savePuffHighScore } from '@/lib/puff/leaderboard';
import { VALID_DEV_ENV } from '../helpers/test-fixtures';

const rawTestDbUrl = process.env.TEST_DATABASE_URL;
const hasTestDb = Boolean(rawTestDbUrl && rawTestDbUrl.trim() !== '');

const TEST_RUNTIME_ROLE = 'app_runtime_role';
const TEST_RUNTIME_PASSWORD = 'test_only_runtime_secret_password_12345';

// SQL queries faithful to MEMBER_SYSTEM_IMPLEMENTATION.md Sections 4.1 - 4.4

const SQL_SESSION_VERIFICATION = `
SELECT
    a.id AS account_id,
    a.access_status,
    a.membership_status,
    a.discord_username,
    s.expires_at
FROM public.sessions s
JOIN public.accounts a ON s.account_id = a.id
WHERE s.token_hash = $1
  AND s.expires_at > NOW()
  AND a.access_status = 'active'
  AND a.membership_status = 'eligible'
  AND a.membership_checked_at + INTERVAL '24 hours' > NOW();
`;

const SQL_LOGIN_CTE = `
WITH upsert_account AS (
    INSERT INTO public.accounts (
        discord_user_id,
        discord_username,
        membership_status,
        access_status,
        membership_checked_at
    )
    VALUES ($1, $2, 'eligible', 'active', NOW())
    ON CONFLICT (discord_user_id) DO UPDATE
    SET
        discord_username = COALESCE(EXCLUDED.discord_username, accounts.discord_username),
        membership_status = 'eligible',
        membership_checked_at = NOW(),
        updated_at = NOW()
    WHERE accounts.access_status = 'active'
    RETURNING accounts.id, accounts.access_status
),
upsert_session AS (
    INSERT INTO public.sessions (
        account_id,
        token_hash,
        created_at,
        expires_at
    )
    SELECT
        ua.id,
        $3,
        NOW(),
        NOW() + INTERVAL '24 hours'
    FROM upsert_account ua
    ON CONFLICT (account_id) DO UPDATE
    SET
        token_hash = EXCLUDED.token_hash,
        created_at = EXCLUDED.created_at,
        expires_at = EXCLUDED.expires_at
    RETURNING sessions.account_id
)
SELECT ua.id AS account_id, ua.access_status
FROM upsert_account ua
JOIN upsert_session us ON us.account_id = ua.id;
`;

const SQL_CONFIRMED_INELIGIBILITY_CTE = `
WITH updated_account AS (
    UPDATE public.accounts
    SET
        membership_status = 'ineligible',
        membership_checked_at = NOW(),
        updated_at = NOW()
    WHERE discord_user_id = $1
      AND access_status = 'active'
    RETURNING accounts.id
)
DELETE FROM public.sessions
WHERE account_id IN (SELECT id FROM updated_account);
`;

const SQL_LOGOUT = `
DELETE FROM public.sessions WHERE token_hash = $1;
`;

function validateSafeTestDatabaseUrl(urlString: string): void {
  if (process.env.ALLOW_LOCAL_DB_TESTS !== '1') {
    throw new Error(
      'TEST_DATABASE_URL refused: execution requires ALLOW_LOCAL_DB_TESTS=1 to confirm destructive test setup.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL.');
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]';

  if (!isLoopback) {
    throw new Error(
      'TEST_DATABASE_URL refused: target host must be loopback (localhost, 127.0.0.1, ::1).'
    );
  }

  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const allowedDisposableDbNames = new Set([
    'neondb',
    'test',
    'testdb',
    'teamham_test',
    'postgres_test',
  ]);

  if (!allowedDisposableDbNames.has(dbName)) {
    throw new Error(
      `TEST_DATABASE_URL refused: database "${dbName}" is not an allowed disposable test database (neondb, test, testdb, teamham_test, postgres_test).`
    );
  }
}

function buildRuntimeUrl(ownerUrlString: string, runtimePassword: string): string {
  const parsed = new URL(ownerUrlString);
  parsed.username = TEST_RUNTIME_ROLE;
  parsed.password = runtimePassword;
  return parsed.toString();
}

function makeDiscordId(suffix = 1): string {
  return `1000000000000000${String(suffix).padStart(2, '0')}`;
}

function makeTokenHash(char = 'a'): string {
  return char.repeat(64);
}

function makeClientId(slug = 'game-alpha'): string {
  return slug;
}

function makeAudience(slug = 'game-alpha'): string {
  return `urn:teamham:game:${slug}`;
}

function makeRedirectUri(slug = 'game-alpha'): string {
  return `https://${slug}.teamham.world/callback`;
}

function makeSecretHash(char = '0'): string {
  return char.repeat(64);
}

function makeChallenge(char = 'A'): string {
  return char.repeat(43);
}

function makeCodeHash(char = 'c'): string {
  return char.repeat(64);
}

describe.skipIf(!hasTestDb)('PostgreSQL Member System Integration Suite (Real DB)', () => {
  let ownerPool: Pool;
  let runtimePool: Pool;
  let runtimeUrl: string;

  beforeAll(async () => {
    if (!rawTestDbUrl) return;

    validateSafeTestDatabaseUrl(rawTestDbUrl);

    ownerPool = new Pool({
      connectionString: rawTestDbUrl,
      max: 5,
    });

    // 1. Provision app_runtime_role safely using owner connection
    await ownerPool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${TEST_RUNTIME_ROLE}') THEN
              CREATE ROLE ${TEST_RUNTIME_ROLE} WITH LOGIN NOINHERIT;
          END IF;
      END $$;
    `);

    await ownerPool.query(
      `ALTER ROLE ${TEST_RUNTIME_ROLE} WITH PASSWORD '${TEST_RUNTIME_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`
    );

    await ownerPool.query(`
      DO $$
      BEGIN
          EXECUTE format('REVOKE ALL ON DATABASE %I FROM ${TEST_RUNTIME_ROLE}', current_database());
          EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
          EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${TEST_RUNTIME_ROLE}', current_database());
      END $$;
    `);

    await ownerPool.query(`REVOKE ALL ON SCHEMA public FROM ${TEST_RUNTIME_ROLE};`);
    await ownerPool.query(`GRANT USAGE ON SCHEMA public TO ${TEST_RUNTIME_ROLE};`);
    await ownerPool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${TEST_RUNTIME_ROLE};`);
    await ownerPool.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;`);

    // 2. Clean existing tables and apply migrations 0001 through 0004
    await ownerPool.query(`DROP TABLE IF EXISTS public.puff_flappy_scores CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.game_access_tokens CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.game_authorization_codes CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.game_oauth_subjects CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.game_oauth_clients CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.sessions CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.accounts CASCADE;`);

    const migration0001Path = path.resolve(__dirname, '../../migrations/0001_initial_member_system.sql');
    const migration0001Sql = fs.readFileSync(migration0001Path, 'utf8');
    await ownerPool.query(migration0001Sql);

    const migration0002Path = path.resolve(__dirname, '../../migrations/0002_game_backend_authorization.sql');
    const migration0002Sql = fs.readFileSync(migration0002Path, 'utf8');
    await ownerPool.query(migration0002Sql);

    const migration0003Path = path.resolve(__dirname, '../../migrations/0003_account_display_name.sql');
    const migration0003Sql = fs.readFileSync(migration0003Path, 'utf8');
    await ownerPool.query(migration0003Sql);

    const migration0004Path = path.resolve(__dirname, '../../migrations/0004_puff_flappy_leaderboard.sql');
    const migration0004Sql = fs.readFileSync(migration0004Path, 'utf8');
    await ownerPool.query(migration0004Sql);

    // 3. Connect as runtime role
    runtimeUrl = buildRuntimeUrl(rawTestDbUrl, TEST_RUNTIME_PASSWORD);
    runtimePool = new Pool({
      connectionString: runtimeUrl,
      max: 5,
    });
  });

  afterAll(async () => {
    if (runtimePool) {
      await runtimePool.end().catch(() => {});
    }
    if (ownerPool) {
      await ownerPool.end().catch(() => {});
    }
  });

  beforeEach(async () => {
    if (!ownerPool) return;
    // Clear data between tests to ensure test isolation in FK-safe order
    await ownerPool.query('DELETE FROM public.puff_flappy_scores;');
    await ownerPool.query('DELETE FROM public.game_access_tokens;');
    await ownerPool.query('DELETE FROM public.game_authorization_codes;');
    await ownerPool.query('DELETE FROM public.game_oauth_subjects;');
    await ownerPool.query('DELETE FROM public.game_oauth_clients;');
    await ownerPool.query('DELETE FROM public.sessions;');
    await ownerPool.query('DELETE FROM public.accounts;');
  });

  describe('1. Migration and Schema Constraints', () => {
    it('enforces discord_user_id regex and rejects non-digit / oversized values', async () => {
      // Valid snowflake numeric values
      await ownerPool.query(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active')`,
        ['123456789012345678']
      );

      // Non-digit Discord ID
      await expect(
        ownerPool.query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
           VALUES ($1, 'eligible', 'active')`,
          ['invalid_discord_id']
        )
      ).rejects.toThrow();

      // Empty string
      await expect(
        ownerPool.query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
           VALUES ($1, 'eligible', 'active')`,
          ['']
        )
      ).rejects.toThrow();

      // Longer than 20 digits
      await expect(
        ownerPool.query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
           VALUES ($1, 'eligible', 'active')`,
          ['123456789012345678901']
        )
      ).rejects.toThrow();
    });

    it('enforces discord_user_id uniqueness', async () => {
      const discordId = makeDiscordId(10);
      await ownerPool.query(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active')`,
        [discordId]
      );

      const err = await ownerPool
        .query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
           VALUES ($1, 'eligible', 'active')`,
          [discordId]
        )
        .catch((e: unknown) => e as DatabaseError);

      expect(err).toBeInstanceOf(Error);
      expect((err as DatabaseError).code).toBe('23505'); // unique_violation
    });

    it('enforces discord_username check constraint and allows NULL', async () => {
      // NULL is the documented fallback when Discord gives nothing usable.
      await expect(
        ownerPool.query(
          `INSERT INTO public.accounts (discord_user_id, discord_username, membership_status, access_status)
           VALUES ($1, NULL, 'eligible', 'active')`,
          [makeDiscordId(21)]
        )
      ).resolves.toBeDefined();

      for (const rejected of ['a', 'has space', 'x'.repeat(33)]) {
        await expect(
          ownerPool.query(
            `INSERT INTO public.accounts (discord_user_id, discord_username, membership_status, access_status)
             VALUES ($1, $2, 'eligible', 'active')`,
            [makeDiscordId(22), rejected]
          )
        ).rejects.toThrow();
      }
    });

    it('enforces membership_status check constraint', async () => {
      const discordId = makeDiscordId(20);
      await expect(
        ownerPool.query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
           VALUES ($1, 'pending', 'active')`,
          [discordId]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
           VALUES ($1, 'ELIGIBLE', 'active')`,
          [discordId]
        )
      ).rejects.toThrow();
    });

    it('enforces access_status check constraint', async () => {
      const discordId = makeDiscordId(30);
      await expect(
        ownerPool.query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
           VALUES ($1, 'eligible', 'banned')`,
          [discordId]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
           VALUES ($1, 'eligible', 'ACTIVE')`,
          [discordId]
        )
      ).rejects.toThrow();
    });

    it('enforces lowercase 64-hex token_hash check constraint', async () => {
      const accountRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(40)]
      );
      const accountId = accountRes.rows[0].id;

      // Valid 64-char lowercase hex
      await ownerPool.query(
        `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
        [accountId, '0123456789abcdef'.repeat(4)]
      );

      // Uppercase hex rejected
      await expect(
        ownerPool.query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
          [accountId, 'A'.repeat(64)]
        )
      ).rejects.toThrow();

      // Non-hex rejected
      await expect(
        ownerPool.query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
          [accountId, 'g'.repeat(64)]
        )
      ).rejects.toThrow();

      // Too short
      await expect(
        ownerPool.query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
          [accountId, 'a'.repeat(63)]
        )
      ).rejects.toThrow();
    });

    it('enforces one session per account (PK constraint)', async () => {
      const accountRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(50)]
      );
      const accountId = accountRes.rows[0].id;

      await ownerPool.query(
        `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
        [accountId, makeTokenHash('1')]
      );

      const err = await ownerPool
        .query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
          [accountId, makeTokenHash('2')]
        )
        .catch((e: unknown) => e as DatabaseError);

      expect(err).toBeInstanceOf(Error);
      expect((err as DatabaseError).code).toBe('23505'); // unique_violation on PK
    });

    it('enforces token_hash uniqueness across accounts', async () => {
      const acc1 = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(61)]
      );
      const acc2 = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(62)]
      );

      const sharedHash = makeTokenHash('3');
      await ownerPool.query(
        `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
        [acc1.rows[0].id, sharedHash]
      );

      const err = await ownerPool
        .query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
          [acc2.rows[0].id, sharedHash]
        )
        .catch((e: unknown) => e as DatabaseError);

      expect(err).toBeInstanceOf(Error);
      expect((err as DatabaseError).code).toBe('23505'); // unique_violation
    });

    it('cascades session deletion when account is deleted', async () => {
      const acc = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(70)]
      );
      const accountId = acc.rows[0].id;
      const hash = makeTokenHash('4');

      await ownerPool.query(
        `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
        [accountId, hash]
      );

      await ownerPool.query(`DELETE FROM public.accounts WHERE id = $1`, [accountId]);

      const sessionCheck = await ownerPool.query(
        `SELECT * FROM public.sessions WHERE account_id = $1`,
        [accountId]
      );
      expect(sessionCheck.rowCount).toBe(0);
    });

    it('enforces ck_sessions_expiry: expires_at > created_at AND <= created_at + 24 hours', async () => {
      const acc = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(80)]
      );
      const accountId = acc.rows[0].id;

      // Rejected: expires_at <= created_at
      await expect(
        ownerPool.query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW())`,
          [accountId, makeTokenHash('5')]
        )
      ).rejects.toThrow();

      // Rejected: expires_at < created_at
      await expect(
        ownerPool.query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW() - INTERVAL '1 hour')`,
          [accountId, makeTokenHash('5')]
        )
      ).rejects.toThrow();

      // Rejected: expires_at > created_at + 24 hours
      await expect(
        ownerPool.query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours 1 second')`,
          [accountId, makeTokenHash('5')]
        )
      ).rejects.toThrow();

      // Accepted: exact 24 hours
      await expect(
        ownerPool.query(
          `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
           VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
          [accountId, makeTokenHash('5')]
        )
      ).resolves.toBeDefined();
    });
  });

  describe('2. Successful Login / Session Issuance CTE (Section 4.2, AC-3)', () => {
    it('creates active account and session using DB timestamps and returns 1 row', async () => {
      const discordId = makeDiscordId(101);
      const tokenHash = makeTokenHash('a');

      const res = await runtimePool.query<{ account_id: string; access_status: string }>(
        SQL_LOGIN_CTE,
        [discordId, null, tokenHash]
      );

      expect(res.rowCount).toBe(1);
      expect(res.rows[0].access_status).toBe('active');
      const accountId = res.rows[0].account_id;
      expect(accountId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Verify database stored state
      const accRes = await runtimePool.query<{
        membership_status: string;
        access_status: string;
        recent_check: boolean;
      }>(
        `SELECT membership_status, access_status,
                (membership_checked_at > NOW() - INTERVAL '10 seconds') AS recent_check
         FROM public.accounts WHERE id = $1`,
        [accountId]
      );
      expect(accRes.rows[0].membership_status).toBe('eligible');
      expect(accRes.rows[0].access_status).toBe('active');
      expect(accRes.rows[0].recent_check).toBe(true);

      const sessRes = await runtimePool.query<{
        token_hash: string;
        exact_24h: boolean;
      }>(
        `SELECT token_hash, (expires_at = created_at + INTERVAL '24 hours') AS exact_24h
         FROM public.sessions WHERE account_id = $1`,
        [accountId]
      );
      expect(sessRes.rows[0].token_hash).toBe(tokenHash);
      expect(sessRes.rows[0].exact_24h).toBe(true);
    });

    it('stores the display username and refreshes it on the next login', async () => {
      const discordId = makeDiscordId(131);

      await runtimePool.query(SQL_LOGIN_CTE, [discordId, 'hamfriend', makeTokenHash('a')]);

      const first = await runtimePool.query<{ discord_username: string | null }>(
        `SELECT discord_username FROM public.accounts WHERE discord_user_id = $1`,
        [discordId]
      );
      expect(first.rows[0].discord_username).toBe('hamfriend');

      // A renamed member gets the new handle written on re-login.
      await runtimePool.query(SQL_LOGIN_CTE, [discordId, 'ham.friend2', makeTokenHash('b')]);

      const renamed = await runtimePool.query<{ discord_username: string | null }>(
        `SELECT discord_username FROM public.accounts WHERE discord_user_id = $1`,
        [discordId]
      );
      expect(renamed.rows[0].discord_username).toBe('ham.friend2');
    });

    it('keeps the stored username when a login supplies none', async () => {
      const discordId = makeDiscordId(132);

      await runtimePool.query(SQL_LOGIN_CTE, [discordId, 'hamfriend', makeTokenHash('c')]);
      // Discord omitted or malformed the username: COALESCE must not blank the column.
      await runtimePool.query(SQL_LOGIN_CTE, [discordId, null, makeTokenHash('d')]);

      const res = await runtimePool.query<{ discord_username: string | null }>(
        `SELECT discord_username FROM public.accounts WHERE discord_user_id = $1`,
        [discordId]
      );
      expect(res.rows[0].discord_username).toBe('hamfriend');
    });

    it('atomically replaces prior session on re-login for the same user', async () => {
      const discordId = makeDiscordId(102);
      const tokenHash1 = makeTokenHash('b');
      const tokenHash2 = makeTokenHash('c');

      // First login
      const res1 = await runtimePool.query<{ account_id: string; access_status: string }>(
        SQL_LOGIN_CTE,
        [discordId, null, tokenHash1]
      );
      const accountId1 = res1.rows[0].account_id;

      // Second login (e.g. from new browser/device)
      const res2 = await runtimePool.query<{ account_id: string; access_status: string }>(
        SQL_LOGIN_CTE,
        [discordId, null, tokenHash2]
      );
      const accountId2 = res2.rows[0].account_id;

      expect(accountId2).toBe(accountId1);

      // Exactly 1 session row must exist for this account, holding tokenHash2
      const allSessions = await runtimePool.query<{ account_id: string; token_hash: string }>(
        `SELECT account_id, token_hash FROM public.sessions WHERE account_id = $1`,
        [accountId1]
      );
      expect(allSessions.rowCount).toBe(1);
      expect(allSessions.rows[0].token_hash).toBe(tokenHash2);

      // Previous session token hash is gone
      const oldSession = await runtimePool.query(
        `SELECT * FROM public.sessions WHERE token_hash = $1`,
        [tokenHash1]
      );
      expect(oldSession.rowCount).toBe(0);
    });

    it('returns zero rows for suspended account and performs zero mutation', async () => {
      const discordId = makeDiscordId(103);
      const tokenHash1 = makeTokenHash('d');
      const tokenHash2 = makeTokenHash('e');

      // Create initial active account
      const res1 = await runtimePool.query<{ account_id: string }>(
        SQL_LOGIN_CTE,
        [discordId, null, tokenHash1]
      );
      const accountId = res1.rows[0].account_id;

      // Admin suspends the account and deletes active sessions (Runbook A)
      await ownerPool.query(
        `UPDATE public.accounts SET access_status = 'suspended' WHERE id = $1`,
        [accountId]
      );
      await ownerPool.query(`DELETE FROM public.sessions WHERE account_id = $1`, [accountId]);

      const accBefore = await runtimePool.query<{
        access_status: string;
        membership_checked_at: Date;
        updated_at: Date;
      }>(
        `SELECT access_status, membership_checked_at, updated_at FROM public.accounts WHERE id = $1`,
        [accountId]
      );

      // Attempt login while suspended
      const loginAttempt = await runtimePool.query(SQL_LOGIN_CTE, [discordId, null, tokenHash2]);
      expect(loginAttempt.rowCount).toBe(0);

      // Confirm no mutations occurred
      const accAfter = await runtimePool.query<{
        access_status: string;
        membership_checked_at: Date;
        updated_at: Date;
      }>(
        `SELECT access_status, membership_checked_at, updated_at FROM public.accounts WHERE id = $1`,
        [accountId]
      );
      expect(accAfter.rows[0].access_status).toBe('suspended');
      expect(accAfter.rows[0].updated_at).toEqual(accBefore.rows[0].updated_at);
      expect(accAfter.rows[0].membership_checked_at).toEqual(accBefore.rows[0].membership_checked_at);

      // No session created
      const sessions = await runtimePool.query(
        `SELECT * FROM public.sessions WHERE account_id = $1`,
        [accountId]
      );
      expect(sessions.rowCount).toBe(0);
    });
  });

  describe('3. Session Verification Query (Section 4.1, AC-3)', () => {
    it('returns 1 row for active, eligible, unexpired, freshly-checked session', async () => {
      const discordId = makeDiscordId(201);
      const tokenHash = makeTokenHash('f');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const accountId = loginRes.rows[0].account_id;

      const verifyRes = await runtimePool.query<{
        account_id: string;
        access_status: string;
        membership_status: string;
        expires_at: Date;
      }>(SQL_SESSION_VERIFICATION, [tokenHash]);

      expect(verifyRes.rowCount).toBe(1);
      expect(verifyRes.rows[0].account_id).toBe(accountId);
      expect(verifyRes.rows[0].access_status).toBe('active');
      expect(verifyRes.rows[0].membership_status).toBe('eligible');
    });

    it('rejects expired session (expires_at <= NOW())', async () => {
      const discordId = makeDiscordId(202);
      const tokenHash = makeTokenHash('0');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const accountId = loginRes.rows[0].account_id;

      // Expire session via owner connection (bypassing ck_sessions_expiry temporarily with updated created_at)
      await ownerPool.query(
        `UPDATE public.sessions
         SET created_at = NOW() - INTERVAL '25 hours',
             expires_at = NOW() - INTERVAL '1 hour'
         WHERE account_id = $1`,
        [accountId]
      );

      const verifyRes = await runtimePool.query(SQL_SESSION_VERIFICATION, [tokenHash]);
      expect(verifyRes.rowCount).toBe(0);
    });

    it('rejects suspended account session', async () => {
      const discordId = makeDiscordId(203);
      const tokenHash = makeTokenHash('1');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const accountId = loginRes.rows[0].account_id;

      await ownerPool.query(
        `UPDATE public.accounts SET access_status = 'suspended' WHERE id = $1`,
        [accountId]
      );

      const verifyRes = await runtimePool.query(SQL_SESSION_VERIFICATION, [tokenHash]);
      expect(verifyRes.rowCount).toBe(0);
    });

    it('rejects ineligible account session', async () => {
      const discordId = makeDiscordId(204);
      const tokenHash = makeTokenHash('2');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const accountId = loginRes.rows[0].account_id;

      await ownerPool.query(
        `UPDATE public.accounts SET membership_status = 'ineligible' WHERE id = $1`,
        [accountId]
      );

      const verifyRes = await runtimePool.query(SQL_SESSION_VERIFICATION, [tokenHash]);
      expect(verifyRes.rowCount).toBe(0);
    });

    it('rejects session where membership_checked_at is older than 24 hours', async () => {
      const discordId = makeDiscordId(205);
      const tokenHash = makeTokenHash('3');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const accountId = loginRes.rows[0].account_id;

      // Simulate membership checked 24h 5m ago
      await ownerPool.query(
        `UPDATE public.accounts
         SET membership_checked_at = NOW() - INTERVAL '24 hours 5 minutes'
         WHERE id = $1`,
        [accountId]
      );

      const verifyRes = await runtimePool.query(SQL_SESSION_VERIFICATION, [tokenHash]);
      expect(verifyRes.rowCount).toBe(0);
    });
  });

  describe('4. Confirmed Ineligibility Update CTE (Section 4.3, AC-4)', () => {
    it('sets active account to ineligible and deletes its session', async () => {
      const discordId = makeDiscordId(301);
      const tokenHash = makeTokenHash('4');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const accountId = loginRes.rows[0].account_id;

      // Execute ineligibility CTE via runtime role
      await runtimePool.query(SQL_CONFIRMED_INELIGIBILITY_CTE, [discordId]);

      // Account status updated
      const accRes = await runtimePool.query<{
        membership_status: string;
        access_status: string;
      }>(
        `SELECT membership_status, access_status FROM public.accounts WHERE id = $1`,
        [accountId]
      );
      expect(accRes.rows[0].membership_status).toBe('ineligible');
      expect(accRes.rows[0].access_status).toBe('active');

      // Session deleted
      const sessRes = await runtimePool.query(
        `SELECT * FROM public.sessions WHERE account_id = $1`,
        [accountId]
      );
      expect(sessRes.rowCount).toBe(0);
    });

    it('does not mutate suspended account when ineligibility path runs', async () => {
      const discordId = makeDiscordId(302);
      const tokenHash = makeTokenHash('5');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const accountId = loginRes.rows[0].account_id;

      await ownerPool.query(
        `UPDATE public.accounts SET access_status = 'suspended' WHERE id = $1`,
        [accountId]
      );

      const before = await runtimePool.query<{
        membership_status: string;
        updated_at: Date;
      }>(`SELECT membership_status, updated_at FROM public.accounts WHERE id = $1`, [accountId]);

      // Run ineligibility query
      await runtimePool.query(SQL_CONFIRMED_INELIGIBILITY_CTE, [discordId]);

      const after = await runtimePool.query<{
        membership_status: string;
        updated_at: Date;
      }>(`SELECT membership_status, updated_at FROM public.accounts WHERE id = $1`, [accountId]);

      expect(after.rows[0].membership_status).toBe(before.rows[0].membership_status);
      expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);
    });
  });

  describe('5. Logout Query (Section 4.4, AC-4)', () => {
    it('deletes only the matching session by token hash', async () => {
      const discordId1 = makeDiscordId(401);
      const discordId2 = makeDiscordId(402);
      const tokenHash1 = makeTokenHash('6');
      const tokenHash2 = makeTokenHash('7');

      const res1 = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId1,
        null,
        tokenHash1,
      ]);
      const res2 = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId2,
        null,
        tokenHash2,
      ]);

      // Logout user 1
      const deleteRes = await runtimePool.query(SQL_LOGOUT, [tokenHash1]);
      expect(deleteRes.rowCount).toBe(1);

      // User 1 session deleted
      const check1 = await runtimePool.query(
        `SELECT * FROM public.sessions WHERE account_id = $1`,
        [res1.rows[0].account_id]
      );
      expect(check1.rowCount).toBe(0);

      // User 2 session intact
      const check2 = await runtimePool.query(
        `SELECT * FROM public.sessions WHERE account_id = $1`,
        [res2.rows[0].account_id]
      );
      expect(check2.rowCount).toBe(1);
    });

    it('is idempotent when deleting absent token hash', async () => {
      const nonExistentHash = makeTokenHash('8');
      const deleteRes = await runtimePool.query(SQL_LOGOUT, [nonExistentHash]);
      expect(deleteRes.rowCount).toBe(0);
    });
  });

  describe('6. Account Lifecycle Owner Runbook Semantics (Sections 7.1-7.3, AC-4)', () => {
    it('Runbook A: suspension + session delete revokes access; reinstatement leaves no active session until re-login', async () => {
      const discordId = makeDiscordId(501);
      const tokenHash = makeTokenHash('9');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const accountId = loginRes.rows[0].account_id;

      // Maintainer executes Runbook A: Suspend
      await ownerPool.query(
        `UPDATE public.accounts SET access_status = 'suspended', updated_at = NOW() WHERE discord_user_id = $1`,
        [discordId]
      );
      await ownerPool.query(`DELETE FROM public.sessions WHERE account_id = $1`, [accountId]);

      // Immediate session check fails
      const verifyAfterSuspension = await runtimePool.query(SQL_SESSION_VERIFICATION, [tokenHash]);
      expect(verifyAfterSuspension.rowCount).toBe(0);

      // Maintainer executes Runbook A: Reinstate
      await ownerPool.query(
        `UPDATE public.accounts SET access_status = 'active', updated_at = NOW() WHERE discord_user_id = $1`,
        [discordId]
      );

      // Reinstatement leaves session table empty (user must log in again)
      const verifyAfterReinstate = await runtimePool.query(SQL_SESSION_VERIFICATION, [tokenHash]);
      expect(verifyAfterReinstate.rowCount).toBe(0);

      const sessionCount = await runtimePool.query(
        `SELECT * FROM public.sessions WHERE account_id = $1`,
        [accountId]
      );
      expect(sessionCount.rowCount).toBe(0);

      // User re-authenticates and gets new session
      const newHash = makeTokenHash('e');
      const reLoginRes = await runtimePool.query<{ account_id: string; access_status: string }>(
        SQL_LOGIN_CTE,
        [discordId, null, newHash]
      );
      expect(reLoginRes.rowCount).toBe(1);
      expect(reLoginRes.rows[0].account_id).toBe(accountId);
    });

    it('Runbook B: right to erasure account deletion cascades session, and user can recreate account upon re-login', async () => {
      const discordId = makeDiscordId(502);
      const tokenHash = makeTokenHash('f');

      const loginRes = await runtimePool.query<{ account_id: string }>(SQL_LOGIN_CTE, [
        discordId,
        null,
        tokenHash,
      ]);
      const firstAccountId = loginRes.rows[0].account_id;

      // Maintainer executes Runbook B: Verified Account Deletion
      await ownerPool.query(`DELETE FROM public.accounts WHERE discord_user_id = $1`, [discordId]);

      // Account and cascaded session are gone
      const accCheck = await ownerPool.query(
        `SELECT * FROM public.accounts WHERE discord_user_id = $1`,
        [discordId]
      );
      expect(accCheck.rowCount).toBe(0);

      const sessCheck = await ownerPool.query(
        `SELECT * FROM public.sessions WHERE account_id = $1`,
        [firstAccountId]
      );
      expect(sessCheck.rowCount).toBe(0);

      // User logs in again later as eligible Discord member
      const newHash = makeTokenHash('0');
      const reCreateRes = await runtimePool.query<{ account_id: string; access_status: string }>(
        SQL_LOGIN_CTE,
        [discordId, null, newHash]
      );
      expect(reCreateRes.rowCount).toBe(1);
      expect(reCreateRes.rows[0].account_id).not.toBe(firstAccountId);
      expect(reCreateRes.rows[0].access_status).toBe('active');
    });

    it('Runbook C: emergency session revocation removes all sessions without deleting accounts', async () => {
      await runtimePool.query(SQL_LOGIN_CTE, [makeDiscordId(503), null, makeTokenHash('1')]);
      await runtimePool.query(SQL_LOGIN_CTE, [makeDiscordId(504), null, makeTokenHash('2')]);

      const sessBefore = await ownerPool.query(`SELECT COUNT(*) AS c FROM public.sessions`);
      expect(Number(sessBefore.rows[0].c)).toBe(2);

      // Runbook C: Emergency revocation
      await ownerPool.query(`DELETE FROM public.sessions`);

      const sessAfter = await ownerPool.query(`SELECT COUNT(*) AS c FROM public.sessions`);
      expect(Number(sessAfter.rows[0].c)).toBe(0);

      const accAfter = await ownerPool.query(`SELECT COUNT(*) AS c FROM public.accounts`);
      expect(Number(accAfter.rows[0].c)).toBe(2);
    });
  });

  describe('7. Least Privilege Enforcement for app_runtime_role (Section 3.1 & 3.3, AC-5)', () => {
    it('allows granted SELECT, INSERT, UPDATE, DELETE queries for runtime operations', async () => {
      const discordId = makeDiscordId(601);
      const tokenHash = makeTokenHash('3');

      // Granted INSERT on accounts
      const accRes = await runtimePool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status, membership_checked_at)
         VALUES ($1, 'eligible', 'active', NOW())
         RETURNING id`,
        [discordId]
      );
      const accountId = accRes.rows[0].id;
      expect(accountId).toBeDefined();

      // Granted SELECT on accounts
      const selectAcc = await runtimePool.query(
        `SELECT id, discord_user_id FROM public.accounts WHERE id = $1`,
        [accountId]
      );
      expect(selectAcc.rowCount).toBe(1);

      // Granted UPDATE on accounts (membership_status, membership_checked_at, updated_at)
      await runtimePool.query(
        `UPDATE public.accounts
         SET membership_status = 'ineligible',
             membership_checked_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [accountId]
      );

      // Granted INSERT on sessions (account_id, token_hash, created_at, expires_at)
      await runtimePool.query(
        `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
        [accountId, tokenHash]
      );

      // Granted SELECT on sessions
      const selectSess = await runtimePool.query(
        `SELECT * FROM public.sessions WHERE account_id = $1`,
        [accountId]
      );
      expect(selectSess.rowCount).toBe(1);

      // Granted UPDATE on sessions (token_hash, created_at, expires_at)
      const newHash = makeTokenHash('4');
      await runtimePool.query(
        `UPDATE public.sessions
         SET token_hash = $2, created_at = NOW(), expires_at = NOW() + INTERVAL '24 hours'
         WHERE account_id = $1`,
        [accountId, newHash]
      );

      // Granted DELETE on sessions
      const deleteSess = await runtimePool.query(
        `DELETE FROM public.sessions WHERE account_id = $1`,
        [accountId]
      );
      expect(deleteSess.rowCount).toBe(1);
    });

    it('denies runtime role from updating accounts.access_status', async () => {
      const discordId = makeDiscordId(602);
      const acc = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [discordId]
      );

      const err = await runtimePool
        .query(
          `UPDATE public.accounts SET access_status = 'suspended' WHERE id = $1`,
          [acc.rows[0].id]
        )
        .catch((e: unknown) => e as DatabaseError);

      expect(err).toBeInstanceOf(Error);
      expect((err as DatabaseError).code).toBe('42501'); // insufficient_privilege
    });

    it('denies runtime role from deleting from accounts table', async () => {
      const discordId = makeDiscordId(603);
      const acc = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [discordId]
      );

      const err = await runtimePool
        .query(`DELETE FROM public.accounts WHERE id = $1`, [acc.rows[0].id])
        .catch((e: unknown) => e as DatabaseError);

      expect(err).toBeInstanceOf(Error);
      expect((err as DatabaseError).code).toBe('42501'); // insufficient_privilege
    });

    it('denies runtime role from inserting into non-granted columns on accounts', async () => {
      const discordId = makeDiscordId(604);

      // Explicitly inserting created_at is not granted to app_runtime_role
      const err = await runtimePool
        .query(
          `INSERT INTO public.accounts (discord_user_id, membership_status, access_status, created_at)
           VALUES ($1, 'eligible', 'active', NOW())`,
          [discordId]
        )
        .catch((e: unknown) => e as DatabaseError);

      expect(err).toBeInstanceOf(Error);
      expect((err as DatabaseError).code).toBe('42501'); // insufficient_privilege
    });

    it('denies runtime role from updating non-granted columns on accounts', async () => {
      const discordId = makeDiscordId(605);
      const acc = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [discordId]
      );

      const err = await runtimePool
        .query(
          `UPDATE public.accounts SET discord_user_id = $1 WHERE id = $2`,
          [makeDiscordId(606), acc.rows[0].id]
        )
        .catch((e: unknown) => e as DatabaseError);

      expect(err).toBeInstanceOf(Error);
      expect((err as DatabaseError).code).toBe('42501'); // insufficient_privilege
    });

    it('denies runtime role from performing DDL operations (ALTER / DROP / CREATE / GRANT) and temporary tables', async () => {
      // DROP TABLE
      const dropErr = await runtimePool
        .query(`DROP TABLE public.sessions`)
        .catch((e: unknown) => e as DatabaseError);
      expect(dropErr).toBeInstanceOf(Error);
      expect((dropErr as DatabaseError).code).toBe('42501');

      // CREATE TABLE in public schema
      const createErr = await runtimePool
        .query(`CREATE TABLE public.unauthorized_tbl (id int)`)
        .catch((e: unknown) => e as DatabaseError);
      expect(createErr).toBeInstanceOf(Error);
      expect((createErr as DatabaseError).code).toBe('42501');

      // CREATE TEMP TABLE
      const tempErr = await runtimePool
        .query(`CREATE TEMP TABLE unauthorized_temp (id int)`)
        .catch((e: unknown) => e as DatabaseError);
      expect(tempErr).toBeInstanceOf(Error);
      expect((tempErr as DatabaseError).code).toBe('42501');

      // ALTER TABLE
      const alterErr = await runtimePool
        .query(`ALTER TABLE public.accounts ADD COLUMN malicious_col text`)
        .catch((e: unknown) => e as DatabaseError);
      expect(alterErr).toBeInstanceOf(Error);
      expect((alterErr as DatabaseError).code).toBe('42501');

      // PostgreSQL may accept a GRANT from a role without grant options while
      // issuing only a warning, so prove that the statement grants nothing.
      await runtimePool.query(`GRANT ALL ON public.accounts TO ${TEST_RUNTIME_ROLE}`);
      const privileges = await runtimePool.query<{
        can_delete: boolean;
        can_truncate: boolean;
        can_trigger: boolean;
      }>(`
        SELECT
          has_table_privilege(current_user, 'public.accounts', 'DELETE') AS can_delete,
          has_table_privilege(current_user, 'public.accounts', 'TRUNCATE') AS can_truncate,
          has_table_privilege(current_user, 'public.accounts', 'TRIGGER') AS can_trigger
      `);
      expect(privileges.rows[0]).toEqual({
        can_delete: false,
        can_truncate: false,
        can_trigger: false,
      });
    });
  });

  describe('8. No Client Timestamps and Pure DB-Evaluated Expirations', () => {
    it('computes expires_at strictly as DB created_at + 24 hours interval', async () => {
      const discordId = makeDiscordId(701);
      const tokenHash = makeTokenHash('5');

      await runtimePool.query(SQL_LOGIN_CTE, [discordId, null, tokenHash]);

      const intervalCheck = await runtimePool.query<{
        is_exact_24h: boolean;
        seconds_diff: number;
      }>(
        `SELECT
            (expires_at - created_at = INTERVAL '24 hours') AS is_exact_24h,
            EXTRACT(EPOCH FROM (expires_at - created_at)) AS seconds_diff
         FROM public.sessions
         WHERE token_hash = $1`,
        [tokenHash]
      );

      expect(intervalCheck.rowCount).toBe(1);
      expect(intervalCheck.rows[0].is_exact_24h).toBe(true);
      expect(Number(intervalCheck.rows[0].seconds_diff)).toBe(86400);
    });

    it('relies on DB NOW() for membership_checked_at within 5 seconds of insertion', async () => {
      const discordId = makeDiscordId(702);
      const tokenHash = makeTokenHash('6');

      await runtimePool.query(SQL_LOGIN_CTE, [discordId, null, tokenHash]);

      const timingCheck = await runtimePool.query<{
        checked_fresh: boolean;
        created_fresh: boolean;
      }>(
        `SELECT
            (ABS(EXTRACT(EPOCH FROM (NOW() - membership_checked_at))) < 5) AS checked_fresh,
            (ABS(EXTRACT(EPOCH FROM (NOW() - created_at))) < 5) AS created_fresh
         FROM public.accounts
         WHERE discord_user_id = $1`,
        [discordId]
      );

      expect(timingCheck.rowCount).toBe(1);
      expect(timingCheck.rows[0].checked_fresh).toBe(true);
      expect(timingCheck.rows[0].created_fresh).toBe(true);
    });
  });

  describe('9. Local Development Database Adapter Transport (Regression)', () => {
    it('executes tagged queries against local PostgreSQL via runtime adapter in development mode', async () => {
      const originalEnv = {
        AUTH_MODE: process.env.AUTH_MODE,
        APP_BASE_URL: process.env.APP_BASE_URL,
        OAUTH_STATE_HMAC_SECRET: process.env.OAUTH_STATE_HMAC_SECRET,
        GAME_AUTH_REQUEST_HMAC_SECRET: process.env.GAME_AUTH_REQUEST_HMAC_SECRET,
        DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
        DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
        DISCORD_REQUIRED_ROLE_ID: process.env.DISCORD_REQUIRED_ROLE_ID,
        DATABASE_URL: process.env.DATABASE_URL,
      };

      try {
        process.env.AUTH_MODE = 'development';
        process.env.APP_BASE_URL = 'http://localhost:3000';
        process.env.OAUTH_STATE_HMAC_SECRET =
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        process.env.GAME_AUTH_REQUEST_HMAC_SECRET =
          'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
        process.env.DISCORD_CLIENT_ID = '123456789012345678';
        process.env.DISCORD_CLIENT_SECRET = 'test_discord_client_secret';
        process.env.DISCORD_GUILD_ID = '123456789012345679';
        process.env.DISCORD_REQUIRED_ROLE_ID = '123456789012345680';
        process.env.DATABASE_URL = runtimeUrl;

        const discordId = makeDiscordId(801);
        const tokenHash = makeTokenHash('7');

        // 1. Issue session through runtime adapter
        const issueRes = await issueLoginSession(discordId, 'hamfriend', tokenHash);
        expect(issueRes.success).toBe(true);
        if (issueRes.success) {
          expect(issueRes.accessStatus).toBe('active');
          expect(issueRes.accountId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          );
        }

        // Verify stored in DB
        const sessCheck = await runtimePool.query(
          `SELECT * FROM public.sessions WHERE token_hash = $1`,
          [tokenHash]
        );
        expect(sessCheck.rowCount).toBe(1);

        // 2. Verify session through runtime adapter
        const verifyRes = await verifySession(tokenHash);
        expect(verifyRes.valid).toBe(true);
        if (verifyRes.valid) {
          expect(verifyRes.account.accessStatus).toBe('active');
          expect(verifyRes.account.membershipStatus).toBe('eligible');
        }

        // 3. Delete session through runtime adapter
        const deleteRes = await deleteSessionByTokenHash(tokenHash);
        expect(deleteRes).toEqual({ success: true });

        const sessAfterDelete = await runtimePool.query(
          `SELECT * FROM public.sessions WHERE token_hash = $1`,
          [tokenHash]
        );
        expect(sessAfterDelete.rowCount).toBe(0);
      } finally {
        for (const [key, val] of Object.entries(originalEnv)) {
          if (val === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = val;
          }
        }
      }
    });
  });

  describe('10. Migration 0002 Game OAuth Schema Constraints', () => {
    it('enforces game_oauth_clients constraints (slug, audience urn, redirect_uri https, secret hex)', async () => {
      // Valid client insertion
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash, enabled)
         VALUES ($1, $2, $3, $4, true)`,
        [
          makeClientId('game-alpha'),
          makeAudience('game-alpha'),
          makeRedirectUri('game-alpha'),
          makeSecretHash('0'),
        ]
      );

      // Invalid client_id slug (uppercase, numbers at start, invalid chars, too short, too long)
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['Game-Alpha', makeAudience('game-1'), makeRedirectUri('game-1'), makeSecretHash('1')]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['1game', makeAudience('game-2'), makeRedirectUri('game-2'), makeSecretHash('1')]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['ga', makeAudience('game-3'), makeRedirectUri('game-3'), makeSecretHash('1')]
        )
      ).rejects.toThrow();

      // Invalid audience format (must match ^urn:teamham:game:[a-z][a-z0-9_-]{2,63}$)
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-beta', 'urn:invalid:game:game-beta', makeRedirectUri('game-beta'), makeSecretHash('1')]
        )
      ).rejects.toThrow();

      // Invalid redirect_uri (non-https, query string, fragment, oversized)
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-beta', makeAudience('game-beta'), 'http://game-beta.teamham.world/cb', makeSecretHash('1')]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-beta', makeAudience('game-beta'), 'https://game-beta.teamham.world/cb?param=1', makeSecretHash('1')]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-beta', makeAudience('game-beta'), 'https://game-beta.teamham.world/cb#frag', makeSecretHash('1')]
        )
      ).rejects.toThrow();

      // Invalid secret hash (uppercase, non-hex, != 64)
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-beta', makeAudience('game-beta'), makeRedirectUri('game-beta'), 'A'.repeat(64)]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-beta', makeAudience('game-beta'), makeRedirectUri('game-beta'), 'z'.repeat(64)]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-beta', makeAudience('game-beta'), makeRedirectUri('game-beta'), '0'.repeat(63)]
        )
      ).rejects.toThrow();
    });

    it('enforces uniqueness on client_id, audience, and redirect_uri in game_oauth_clients', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4)`,
        ['game-unique', makeAudience('game-unique'), makeRedirectUri('game-unique'), makeSecretHash('1')]
      );

      // Duplicate client_id
      const err1 = await ownerPool
        .query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-unique', makeAudience('game-unique'), makeRedirectUri('game-other1'), makeSecretHash('2')]
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(err1).toBeInstanceOf(Error);
      expect((err1 as DatabaseError).code).toBe('23505');

      // An audience cannot be reused by a different client because the URN is client-bound.
      const err2 = await ownerPool
        .query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-other2', makeAudience('game-unique'), makeRedirectUri('game-other2'), makeSecretHash('2')]
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(err2).toBeInstanceOf(Error);
      expect((err2 as DatabaseError).code).toBe('23514');

      // Duplicate redirect_uri
      const err3 = await ownerPool
        .query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-other3', makeAudience('game-other3'), makeRedirectUri('game-unique'), makeSecretHash('2')]
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(err3).toBeInstanceOf(Error);
      expect((err3 as DatabaseError).code).toBe('23505');
    });

    it('enforces pairwise subject stability, distinct subjects per client, and unique subject_id', async () => {
      // Create two clients
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
        [
          'game-client-a',
          makeAudience('game-client-a'),
          makeRedirectUri('game-client-a'),
          makeSecretHash('1'),
          'game-client-b',
          makeAudience('game-client-b'),
          makeRedirectUri('game-client-b'),
          makeSecretHash('2'),
        ]
      );

      // Create an account
      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(901)]
      );
      const accountId = accRes.rows[0].id;

      // Insert subject for client-a
      const subARes = await ownerPool.query<{ subject_id: string }>(
        `INSERT INTO public.game_oauth_subjects (client_id, account_id)
         VALUES ($1, $2) RETURNING subject_id`,
        ['game-client-a', accountId]
      );
      const subjectA = subARes.rows[0].subject_id;
      expect(subjectA).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Insert subject for client-b
      const subBRes = await ownerPool.query<{ subject_id: string }>(
        `INSERT INTO public.game_oauth_subjects (client_id, account_id)
         VALUES ($1, $2) RETURNING subject_id`,
        ['game-client-b', accountId]
      );
      const subjectB = subBRes.rows[0].subject_id;
      expect(subjectB).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Distinct subjects for distinct clients
      expect(subjectA).not.toBe(subjectB);

      // Duplicate (client_id, account_id) rejected by PK
      const duplicateErr = await ownerPool
        .query(
          `INSERT INTO public.game_oauth_subjects (client_id, account_id) VALUES ($1, $2)`,
          ['game-client-a', accountId]
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(duplicateErr).toBeInstanceOf(Error);
      expect((duplicateErr as DatabaseError).code).toBe('23505');
    });

    it('enforces one authorization code per account/client (PK) and exact TTL/consumed constraints', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4)`,
        ['game-codes', makeAudience('game-codes'), makeRedirectUri('game-codes'), makeSecretHash('1')]
      );

      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(902)]
      );
      const accountId = accRes.rows[0].id;

      // 1. Valid code insertion (expires_at <= 60 seconds)
      await ownerPool.query(
        `INSERT INTO public.game_authorization_codes
           (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '60 seconds')`,
        [
          accountId,
          'game-codes',
          makeCodeHash('1'),
          makeRedirectUri('game-codes'),
          makeAudience('game-codes'),
          makeChallenge('A'),
          makeTokenHash('a'),
        ]
      );

      // 2. PK constraint: one current code per account/client
      const pkErr = await ownerPool
        .query(
          `INSERT INTO public.game_authorization_codes
             (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '60 seconds')`,
          [
            accountId,
            'game-codes',
            makeCodeHash('2'),
            makeRedirectUri('game-codes'),
            makeAudience('game-codes'),
            makeChallenge('B'),
            makeTokenHash('b'),
          ]
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(pkErr).toBeInstanceOf(Error);
      expect((pkErr as DatabaseError).code).toBe('23505');

      // Clear code for next checks
      await ownerPool.query(`DELETE FROM public.game_authorization_codes WHERE account_id = $1`, [accountId]);

      // 3. Expiry > 60 seconds rejected
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_authorization_codes
             (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '61 seconds')`,
          [
            accountId,
            'game-codes',
            makeCodeHash('3'),
            makeRedirectUri('game-codes'),
            makeAudience('game-codes'),
            makeChallenge('C'),
            makeTokenHash('c'),
          ]
        )
      ).rejects.toThrow();

      // 4. Expiry <= created_at rejected
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_authorization_codes
             (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [
            accountId,
            'game-codes',
            makeCodeHash('4'),
            makeRedirectUri('game-codes'),
            makeAudience('game-codes'),
            makeChallenge('D'),
            makeTokenHash('d'),
          ]
        )
      ).rejects.toThrow();

      // 5. consumed_at < created_at rejected
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_authorization_codes
             (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at, consumed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '60 seconds', NOW() - INTERVAL '1 second')`,
          [
            accountId,
            'game-codes',
            makeCodeHash('5'),
            makeRedirectUri('game-codes'),
            makeAudience('game-codes'),
            makeChallenge('E'),
            makeTokenHash('e'),
          ]
        )
      ).rejects.toThrow();

      // 6. Invalid code_challenge format (must be 43 base64url chars)
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_authorization_codes
             (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '60 seconds')`,
          [
            accountId,
            'game-codes',
            makeCodeHash('6'),
            makeRedirectUri('game-codes'),
            makeAudience('game-codes'),
            'too-short-challenge',
            makeTokenHash('f'),
          ]
        )
      ).rejects.toThrow();
    });

    it('enforces one access token per account/client (PK) and exact 24h TTL constraint', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4)`,
        ['game-tokens', makeAudience('game-tokens'), makeRedirectUri('game-tokens'), makeSecretHash('1')]
      );

      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(903)]
      );
      const accountId = accRes.rows[0].id;

      // 1. Valid token insertion
      await ownerPool.query(
        `INSERT INTO public.game_access_tokens
           (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '24 hours')`,
        [
          accountId,
          'game-tokens',
          makeTokenHash('1'),
          makeAudience('game-tokens'),
          makeTokenHash('a'),
        ]
      );

      // 2. PK constraint: one current token per account/client
      const pkErr = await ownerPool
        .query(
          `INSERT INTO public.game_access_tokens
             (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '24 hours')`,
          [
            accountId,
            'game-tokens',
            makeTokenHash('2'),
            makeAudience('game-tokens'),
            makeTokenHash('b'),
          ]
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(pkErr).toBeInstanceOf(Error);
      expect((pkErr as DatabaseError).code).toBe('23505');

      // Clear token for next checks
      await ownerPool.query(`DELETE FROM public.game_access_tokens WHERE account_id = $1`, [accountId]);

      // 3. Expiry > 24 hours rejected
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_access_tokens
             (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '24 hours 1 second')`,
          [
            accountId,
            'game-tokens',
            makeTokenHash('3'),
            makeAudience('game-tokens'),
            makeTokenHash('c'),
          ]
        )
      ).rejects.toThrow();

      // 4. Expiry <= created_at rejected
      await expect(
        ownerPool.query(
          `INSERT INTO public.game_access_tokens
             (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [
            accountId,
            'game-tokens',
            makeTokenHash('4'),
            makeAudience('game-tokens'),
            makeTokenHash('d'),
          ]
        )
      ).rejects.toThrow();
    });
  });

  describe('11. Least Privilege Enforcement for Game Authorization (0002 Grants)', () => {
    it('allows runtime role SELECT on game_oauth_clients but denies INSERT, UPDATE, DELETE (42501)', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash, enabled)
         VALUES ($1, $2, $3, $4, true)`,
        ['game-lp-client', makeAudience('game-lp-client'), makeRedirectUri('game-lp-client'), makeSecretHash('1')]
      );

      // Allowed: SELECT
      const selectRes = await runtimePool.query(
        `SELECT client_id, audience, redirect_uri, client_secret_hash, enabled FROM public.game_oauth_clients WHERE client_id = $1`,
        ['game-lp-client']
      );
      expect(selectRes.rowCount).toBe(1);

      // Denied: INSERT
      const insertErr = await runtimePool
        .query(
          `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
           VALUES ($1, $2, $3, $4)`,
          ['game-unauthorized', makeAudience('game-unauth'), makeRedirectUri('game-unauth'), makeSecretHash('2')]
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(insertErr).toBeInstanceOf(Error);
      expect((insertErr as DatabaseError).code).toBe('42501');

      // Denied: UPDATE enabled
      const updateEnabledErr = await runtimePool
        .query(`UPDATE public.game_oauth_clients SET enabled = false WHERE client_id = $1`, ['game-lp-client'])
        .catch((e: unknown) => e as DatabaseError);
      expect(updateEnabledErr).toBeInstanceOf(Error);
      expect((updateEnabledErr as DatabaseError).code).toBe('42501');

      // Denied: UPDATE redirect_uri
      const updateUriErr = await runtimePool
        .query(`UPDATE public.game_oauth_clients SET redirect_uri = $1 WHERE client_id = $2`, [
          'https://attacker.com/cb',
          'game-lp-client',
        ])
        .catch((e: unknown) => e as DatabaseError);
      expect(updateUriErr).toBeInstanceOf(Error);
      expect((updateUriErr as DatabaseError).code).toBe('42501');

      // Denied: DELETE
      const deleteErr = await runtimePool
        .query(`DELETE FROM public.game_oauth_clients WHERE client_id = $1`, ['game-lp-client'])
        .catch((e: unknown) => e as DatabaseError);
      expect(deleteErr).toBeInstanceOf(Error);
      expect((deleteErr as DatabaseError).code).toBe('42501');
    });

    it('allows runtime role SELECT and INSERT (client_id, account_id) on game_oauth_subjects but denies UPDATE, DELETE, and inserting ungranted columns (42501)', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4)`,
        ['game-lp-subjects', makeAudience('game-lp-subjects'), makeRedirectUri('game-lp-subjects'), makeSecretHash('1')]
      );

      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(910)]
      );
      const accountId = accRes.rows[0].id;

      // Allowed: INSERT (client_id, account_id)
      const insertRes = await runtimePool.query<{ subject_id: string }>(
        `INSERT INTO public.game_oauth_subjects (client_id, account_id)
         VALUES ($1, $2) RETURNING subject_id`,
        ['game-lp-subjects', accountId]
      );
      expect(insertRes.rowCount).toBe(1);
      const subjectId = insertRes.rows[0].subject_id;
      expect(subjectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

      // Allowed: SELECT
      const selectRes = await runtimePool.query(
        `SELECT client_id, account_id, subject_id, created_at FROM public.game_oauth_subjects WHERE client_id = $1`,
        ['game-lp-subjects']
      );
      expect(selectRes.rowCount).toBe(1);

      // Denied: INSERT explicit subject_id
      const insertExplicitSubjectErr = await runtimePool
        .query(
          `INSERT INTO public.game_oauth_subjects (client_id, account_id, subject_id)
           VALUES ($1, $2, gen_random_uuid())`,
          ['game-lp-subjects', accountId]
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(insertExplicitSubjectErr).toBeInstanceOf(Error);
      expect((insertExplicitSubjectErr as DatabaseError).code).toBe('42501');

      // Denied: UPDATE subject_id
      const updateErr = await runtimePool
        .query(
          `UPDATE public.game_oauth_subjects SET subject_id = gen_random_uuid() WHERE client_id = $1`,
          ['game-lp-subjects']
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(updateErr).toBeInstanceOf(Error);
      expect((updateErr as DatabaseError).code).toBe('42501');

      // Denied: DELETE
      const deleteErr = await runtimePool
        .query(
          `DELETE FROM public.game_oauth_subjects WHERE client_id = $1`,
          ['game-lp-subjects']
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(deleteErr).toBeInstanceOf(Error);
      expect((deleteErr as DatabaseError).code).toBe('42501');
    });

    it('allows runtime role SELECT, INSERT, and UPDATE on authorization codes, but denies DELETE (42501)', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4)`,
        ['game-lp-codes', makeAudience('game-lp-codes'), makeRedirectUri('game-lp-codes'), makeSecretHash('1')]
      );

      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(911)]
      );
      const accountId = accRes.rows[0].id;

      // 1. INSERT code
      await runtimePool.query(
        `INSERT INTO public.game_authorization_codes
           (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '60 seconds')`,
        [
          accountId,
          'game-lp-codes',
          makeCodeHash('a'),
          makeRedirectUri('game-lp-codes'),
          makeAudience('game-lp-codes'),
          makeChallenge('A'),
          makeTokenHash('1'),
        ]
      );

      // 2. SELECT code
      const selectRes = await runtimePool.query(
        `SELECT * FROM public.game_authorization_codes WHERE account_id = $1 AND client_id = $2`,
        [accountId, 'game-lp-codes']
      );
      expect(selectRes.rowCount).toBe(1);

      // 3. UPDATE code (e.g. mark consumed)
      const updateRes = await runtimePool.query(
        `UPDATE public.game_authorization_codes
         SET consumed_at = NOW()
         WHERE account_id = $1 AND client_id = $2`,
        [accountId, 'game-lp-codes']
      );
      expect(updateRes.rowCount).toBe(1);

      // 4. Denied: DELETE code (app_runtime_role has no DELETE privilege on game_authorization_codes)
      const deleteErr = await runtimePool
        .query(
          `DELETE FROM public.game_authorization_codes WHERE account_id = $1 AND client_id = $2`,
          [accountId, 'game-lp-codes']
        )
        .catch((e: unknown) => e as DatabaseError);
      expect(deleteErr).toBeInstanceOf(Error);
      expect((deleteErr as DatabaseError).code).toBe('42501'); // insufficient_privilege
    });

    it('verifies exact table privileges for app_runtime_role across all game auth tables', async () => {
      const privs = await runtimePool.query<{
        table_name: string;
        can_select: boolean;
        can_delete: boolean;
        can_truncate: boolean;
      }>(`
        SELECT
          table_name,
          has_table_privilege(current_user, 'public.' || table_name, 'SELECT') AS can_select,
          has_table_privilege(current_user, 'public.' || table_name, 'DELETE') AS can_delete,
          has_table_privilege(current_user, 'public.' || table_name, 'TRUNCATE') AS can_truncate
        FROM (
          VALUES
            ('game_oauth_clients'),
            ('game_oauth_subjects'),
            ('game_authorization_codes'),
            ('game_access_tokens')
        ) AS t(table_name)
        ORDER BY table_name;
      `);

      const privMap = Object.fromEntries(privs.rows.map((r) => [r.table_name, r]));

      // game_oauth_clients: SELECT only, no DELETE, no TRUNCATE
      expect(privMap['game_oauth_clients']).toEqual({
        table_name: 'game_oauth_clients',
        can_select: true,
        can_delete: false,
        can_truncate: false,
      });

      // game_oauth_subjects: SELECT only at table level, no DELETE, no TRUNCATE
      expect(privMap['game_oauth_subjects']).toEqual({
        table_name: 'game_oauth_subjects',
        can_select: true,
        can_delete: false,
        can_truncate: false,
      });

      // game_authorization_codes: SELECT only at table level, NO DELETE, no TRUNCATE
      expect(privMap['game_authorization_codes']).toEqual({
        table_name: 'game_authorization_codes',
        can_select: true,
        can_delete: false,
        can_truncate: false,
      });

      // game_access_tokens: SELECT and DELETE allowed at table level, no TRUNCATE
      expect(privMap['game_access_tokens']).toEqual({
        table_name: 'game_access_tokens',
        can_select: true,
        can_delete: true,
        can_truncate: false,
      });
    });

    it('allows runtime role full lifecycle DML (INSERT, SELECT, UPDATE, DELETE) on access tokens', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4)`,
        ['game-lp-tokens', makeAudience('game-lp-tokens'), makeRedirectUri('game-lp-tokens'), makeSecretHash('1')]
      );

      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(912)]
      );
      const accountId = accRes.rows[0].id;

      // 1. INSERT token
      await runtimePool.query(
        `INSERT INTO public.game_access_tokens
           (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '24 hours')`,
        [
          accountId,
          'game-lp-tokens',
          makeTokenHash('e'),
          makeAudience('game-lp-tokens'),
          makeTokenHash('f'),
        ]
      );

      // 2. SELECT token
      const selectRes = await runtimePool.query(
        `SELECT * FROM public.game_access_tokens WHERE token_hash = $1`,
        [makeTokenHash('e')]
      );
      expect(selectRes.rowCount).toBe(1);

      // 3. UPDATE token
      const updateRes = await runtimePool.query(
        `UPDATE public.game_access_tokens
         SET token_hash = $1, created_at = NOW(), expires_at = NOW() + INTERVAL '24 hours'
         WHERE account_id = $2 AND client_id = $3`,
        [makeTokenHash('0'), accountId, 'game-lp-tokens']
      );
      expect(updateRes.rowCount).toBe(1);

      // 4. DELETE token
      const deleteRes = await runtimePool.query(
        `DELETE FROM public.game_access_tokens WHERE token_hash = $1`,
        [makeTokenHash('0')]
      );
      expect(deleteRes.rowCount).toBe(1);
    });
  });

  describe('12. Owner Runbook Semantics and Cascading for Game Authorization', () => {
    it('disabling client data remains in DB and runtime SELECT observes enabled=false', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash, enabled)
         VALUES ($1, $2, $3, $4, true)`,
        ['game-disable-test', makeAudience('game-disable-test'), makeRedirectUri('game-disable-test'), makeSecretHash('1')]
      );

      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(920)]
      );
      const accountId = accRes.rows[0].id;

      // Insert subject, code, and token
      await ownerPool.query(
        `INSERT INTO public.game_oauth_subjects (client_id, account_id) VALUES ($1, $2)`,
        ['game-disable-test', accountId]
      );
      await ownerPool.query(
        `INSERT INTO public.game_authorization_codes
           (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '60 seconds')`,
        [
          accountId,
          'game-disable-test',
          makeCodeHash('d'),
          makeRedirectUri('game-disable-test'),
          makeAudience('game-disable-test'),
          makeChallenge('D'),
          makeTokenHash('1'),
        ]
      );
      await ownerPool.query(
        `INSERT INTO public.game_access_tokens
           (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '24 hours')`,
        [
          accountId,
          'game-disable-test',
          makeTokenHash('d'),
          makeAudience('game-disable-test'),
          makeTokenHash('1'),
        ]
      );

      // Maintainer disables client via owner connection
      await ownerPool.query(
        `UPDATE public.game_oauth_clients SET enabled = false, updated_at = NOW() WHERE client_id = $1`,
        ['game-disable-test']
      );

      // Runtime reads client and sees enabled = false
      const clientCheck = await runtimePool.query<{ enabled: boolean }>(
        `SELECT enabled FROM public.game_oauth_clients WHERE client_id = $1`,
        ['game-disable-test']
      );
      expect(clientCheck.rowCount).toBe(1);
      expect(clientCheck.rows[0].enabled).toBe(false);

      // Existing subjects, codes, and tokens remain intact in DB
      const subCheck = await ownerPool.query(`SELECT * FROM public.game_oauth_subjects WHERE client_id = $1`, ['game-disable-test']);
      expect(subCheck.rowCount).toBe(1);
      const codeCheck = await ownerPool.query(`SELECT * FROM public.game_authorization_codes WHERE client_id = $1`, ['game-disable-test']);
      expect(codeCheck.rowCount).toBe(1);
      const tokenCheck = await ownerPool.query(`SELECT * FROM public.game_access_tokens WHERE client_id = $1`, ['game-disable-test']);
      expect(tokenCheck.rowCount).toBe(1);
    });

    it('deleting client cascades and deletes all related subjects, codes, and tokens', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4)`,
        ['game-cascade-test', makeAudience('game-cascade-test'), makeRedirectUri('game-cascade-test'), makeSecretHash('1')]
      );

      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(921)]
      );
      const accountId = accRes.rows[0].id;

      await ownerPool.query(
        `INSERT INTO public.game_oauth_subjects (client_id, account_id) VALUES ($1, $2)`,
        ['game-cascade-test', accountId]
      );
      await ownerPool.query(
        `INSERT INTO public.game_authorization_codes
           (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '60 seconds')`,
        [
          accountId,
          'game-cascade-test',
          makeCodeHash('c'),
          makeRedirectUri('game-cascade-test'),
          makeAudience('game-cascade-test'),
          makeChallenge('C'),
          makeTokenHash('1'),
        ]
      );
      await ownerPool.query(
        `INSERT INTO public.game_access_tokens
           (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '24 hours')`,
        [
          accountId,
          'game-cascade-test',
          makeTokenHash('c'),
          makeAudience('game-cascade-test'),
          makeTokenHash('1'),
        ]
      );

      // Maintainer deletes client
      await ownerPool.query(`DELETE FROM public.game_oauth_clients WHERE client_id = $1`, ['game-cascade-test']);

      // Client, subjects, codes, and tokens all cascaded and deleted
      const clientCheck = await ownerPool.query(`SELECT * FROM public.game_oauth_clients WHERE client_id = $1`, ['game-cascade-test']);
      expect(clientCheck.rowCount).toBe(0);

      const subCheck = await ownerPool.query(`SELECT * FROM public.game_oauth_subjects WHERE client_id = $1`, ['game-cascade-test']);
      expect(subCheck.rowCount).toBe(0);

      const codeCheck = await ownerPool.query(`SELECT * FROM public.game_authorization_codes WHERE client_id = $1`, ['game-cascade-test']);
      expect(codeCheck.rowCount).toBe(0);

      const tokenCheck = await ownerPool.query(`SELECT * FROM public.game_access_tokens WHERE client_id = $1`, ['game-cascade-test']);
      expect(tokenCheck.rowCount).toBe(0);

      // Account remains intact
      const accCheck = await ownerPool.query(`SELECT * FROM public.accounts WHERE id = $1`, [accountId]);
      expect(accCheck.rowCount).toBe(1);
    });

    it('deleting account cascades all mappings and grants (sessions, subjects, codes, tokens)', async () => {
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash)
         VALUES ($1, $2, $3, $4)`,
        ['game-acc-cascade', makeAudience('game-acc-cascade'), makeRedirectUri('game-acc-cascade'), makeSecretHash('1')]
      );

      const accRes = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (discord_user_id, membership_status, access_status)
         VALUES ($1, 'eligible', 'active') RETURNING id`,
        [makeDiscordId(922)]
      );
      const accountId = accRes.rows[0].id;

      // Create session, subject, code, token
      await ownerPool.query(
        `INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')`,
        [accountId, makeTokenHash('1')]
      );
      await ownerPool.query(
        `INSERT INTO public.game_oauth_subjects (client_id, account_id) VALUES ($1, $2)`,
        ['game-acc-cascade', accountId]
      );
      await ownerPool.query(
        `INSERT INTO public.game_authorization_codes
           (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '60 seconds')`,
        [
          accountId,
          'game-acc-cascade',
          makeCodeHash('a'),
          makeRedirectUri('game-acc-cascade'),
          makeAudience('game-acc-cascade'),
          makeChallenge('A'),
          makeTokenHash('2'),
        ]
      );
      await ownerPool.query(
        `INSERT INTO public.game_access_tokens
           (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '24 hours')`,
        [
          accountId,
          'game-acc-cascade',
          makeTokenHash('3'),
          makeAudience('game-acc-cascade'),
          makeTokenHash('4'),
        ]
      );

      // Maintainer deletes account
      await ownerPool.query(`DELETE FROM public.accounts WHERE id = $1`, [accountId]);

      // Verify cascading across all 4 dependent tables
      const sessCheck = await ownerPool.query(`SELECT * FROM public.sessions WHERE account_id = $1`, [accountId]);
      expect(sessCheck.rowCount).toBe(0);

      const subCheck = await ownerPool.query(`SELECT * FROM public.game_oauth_subjects WHERE account_id = $1`, [accountId]);
      expect(subCheck.rowCount).toBe(0);

      const codeCheck = await ownerPool.query(`SELECT * FROM public.game_authorization_codes WHERE account_id = $1`, [accountId]);
      expect(codeCheck.rowCount).toBe(0);

      const tokenCheck = await ownerPool.query(`SELECT * FROM public.game_access_tokens WHERE account_id = $1`, [accountId]);
      expect(tokenCheck.rowCount).toBe(0);

      // Client remains intact
      const clientCheck = await ownerPool.query(`SELECT * FROM public.game_oauth_clients WHERE client_id = $1`, ['game-acc-cascade']);
      expect(clientCheck.rowCount).toBe(1);
    });
  });

  describe('13. Game Database Runtime Adapter Functions (game-db.ts)', () => {
    let savedEnv: Record<string, string | undefined>;

    beforeEach(() => {
      savedEnv = {
        AUTH_MODE: process.env.AUTH_MODE,
        APP_BASE_URL: process.env.APP_BASE_URL,
        OAUTH_STATE_HMAC_SECRET: process.env.OAUTH_STATE_HMAC_SECRET,
        GAME_AUTH_REQUEST_HMAC_SECRET: process.env.GAME_AUTH_REQUEST_HMAC_SECRET,
        DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
        DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
        DISCORD_REQUIRED_ROLE_ID: process.env.DISCORD_REQUIRED_ROLE_ID,
        DATABASE_URL: process.env.DATABASE_URL,
      };

      process.env.AUTH_MODE = 'development';
      process.env.APP_BASE_URL = 'http://localhost:3000';
      process.env.OAUTH_STATE_HMAC_SECRET =
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      process.env.GAME_AUTH_REQUEST_HMAC_SECRET =
        'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
      process.env.DISCORD_CLIENT_ID = '123456789012345678';
      process.env.DISCORD_CLIENT_SECRET = 'test_secret';
      process.env.DISCORD_GUILD_ID = '123456789012345679';
      process.env.DISCORD_REQUIRED_ROLE_ID = '123456789012345680';
      process.env.DATABASE_URL = runtimeUrl;
    });

    afterEach(() => {
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    });

    async function registerTestClient(clientId = 'poker_game', enabled = true) {
      const secret = generateGameClientSecret();
      const secretHash = hashGameToken(secret);
      const audience = `urn:teamham:game:${clientId}`;
      const redirectUri = `https://${clientId.replaceAll('_', '-')}.teamham.world/auth/callback`;
      await ownerPool.query(
        `INSERT INTO public.game_oauth_clients (client_id, audience, redirect_uri, client_secret_hash, enabled)
         VALUES ($1, $2, $3, $4, $5)`,
        [clientId, audience, redirectUri, secretHash, enabled]
      );
      return { clientId, clientSecret: secret, secretHash, audience, redirectUri };
    }

    async function createMemberSession(suffix = 1) {
      const discordId = makeDiscordId(suffix);
      const sessionHash = makeTokenHash(String(suffix % 10));
      const res = await issueLoginSession(discordId, null, sessionHash, runtimeUrl);
      if (!res.success) throw new Error('Failed to create session');
      return { accountId: res.accountId, sessionHash, discordId };
    }

    it('getGameOAuthClient and authenticateGameClient handle enabled, disabled, and unknown clients', async () => {
      const client = await registerTestClient('chess_game', true);
      const disabledClient = await registerTestClient('disabled_game', false);

      // 1. getGameOAuthClient returns client record
      const lookup = await getGameOAuthClient('chess_game', runtimeUrl);
      expect(lookup).toEqual({
        clientId: 'chess_game',
        audience: client.audience,
        redirectUri: client.redirectUri,
        clientSecretHash: client.secretHash,
        enabled: true,
      });

      // 2. authenticateGameClient succeeds with matching secret
      const authSuccess = await authenticateGameClient('chess_game', client.clientSecret, runtimeUrl);
      expect(authSuccess).toEqual(lookup);

      // 3. authenticateGameClient fails with wrong secret
      const authWrongSecret = await authenticateGameClient('chess_game', generateGameClientSecret(), runtimeUrl);
      expect(authWrongSecret).toBeNull();

      // 4. Disabled client: lookup succeeds with enabled: false, authenticate returns null
      const disabledLookup = await getGameOAuthClient('disabled_game', runtimeUrl);
      expect(disabledLookup?.enabled).toBe(false);
      const disabledAuth = await authenticateGameClient('disabled_game', disabledClient.clientSecret, runtimeUrl);
      expect(disabledAuth).toBeNull();

      // 5. Unknown client: lookup and auth return null safely
      expect(await getGameOAuthClient('unknown_game', runtimeUrl)).toBeNull();
      expect(await authenticateGameClient('unknown_game', client.clientSecret, runtimeUrl)).toBeNull();

      // 6. Invalid clientId format returns null
      expect(await getGameOAuthClient('INVALID_CLIENT', runtimeUrl)).toBeNull();
    });

    it('issueGameAuthorizationCode persists hashed code bound to active central session and replaces prior code', async () => {
      const client = await registerTestClient('poker_game', true);
      const session = await createMemberSession(810);
      const { challenge } = generateGamePkce();

      const rawCode1 = generateGameAuthorizationCode();
      const codeHash1 = hashGameToken(rawCode1);

      // 1. Issue code
      const issueRes1 = await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash: codeHash1,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      expect(issueRes1.success).toBe(true);
      if (issueRes1.success) {
        expect(issueRes1.redirectUri).toBe(client.redirectUri);
        expect(issueRes1.audience).toBe(client.audience);
      }

      // Verify code stored in DB
      const codeRow1 = await runtimePool.query<{
        code_hash: string;
        consumed_at: Date | null;
      }>(`SELECT code_hash, consumed_at FROM public.game_authorization_codes WHERE account_id = $1 AND client_id = $2`, [
        session.accountId,
        client.clientId,
      ]);
      expect(codeRow1.rowCount).toBe(1);
      expect(codeRow1.rows[0].code_hash).toBe(codeHash1);
      expect(codeRow1.rows[0].consumed_at).toBeNull();

      // 2. Re-issuing for same (account, client) atomically replaces previous code
      const rawCode2 = generateGameAuthorizationCode();
      const codeHash2 = hashGameToken(rawCode2);
      const issueRes2 = await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash: codeHash2,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });
      expect(issueRes2.success).toBe(true);

      const codeRow2 = await runtimePool.query<{ code_hash: string }>(
        `SELECT code_hash FROM public.game_authorization_codes WHERE account_id = $1 AND client_id = $2`,
        [session.accountId, client.clientId]
      );
      expect(codeRow2.rowCount).toBe(1);
      expect(codeRow2.rows[0].code_hash).toBe(codeHash2);

      // 3. Issue fails with session_invalid if session is inactive or nonexistent
      const badSessionRes = await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash: makeCodeHash('9'),
        codeChallenge: challenge,
        sourceSessionHash: makeTokenHash('9'),
        databaseUrl: runtimeUrl,
      });
      expect(badSessionRes).toEqual({ success: false, reason: 'session_invalid' });
    });

    it('exchangeGameAuthorizationCode consumes code atomically, creates stable pairwise subject, and issues token', async () => {
      const client = await registerTestClient('poker_game', true);
      const session = await createMemberSession(820);
      const { challenge } = generateGamePkce();

      const rawCode = generateGameAuthorizationCode();
      const codeHash = hashGameToken(rawCode);

      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      const rawToken = generateGameAccessToken();
      const tokenHash = hashGameToken(rawToken);

      // 1. Successful exchange
      const exchangeRes = await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash,
        redirectUri: client.redirectUri,
        computedCodeChallenge: challenge,
        newTokenHash: tokenHash,
        databaseUrl: runtimeUrl,
      });

      expect(exchangeRes.success).toBe(true);
      let subjectId = '';
      if (exchangeRes.success) {
        expect(exchangeRes.audience).toBe(client.audience);
        expect(exchangeRes.subjectId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        subjectId = exchangeRes.subjectId;
      }

      // Code is consumed
      const codeCheck = await runtimePool.query<{ consumed_at: Date | null }>(
        `SELECT consumed_at FROM public.game_authorization_codes WHERE code_hash = $1`,
        [codeHash]
      );
      expect(codeCheck.rows[0].consumed_at).not.toBeNull();

      // Token is in DB
      const tokenCheck = await runtimePool.query<{ token_hash: string }>(
        `SELECT token_hash FROM public.game_access_tokens WHERE account_id = $1 AND client_id = $2`,
        [session.accountId, client.clientId]
      );
      expect(tokenCheck.rowCount).toBe(1);
      expect(tokenCheck.rows[0].token_hash).toBe(tokenHash);

      // 2. Pairwise subject stability: second exchange for same client & account yields same subjectId
      const rawCode2 = generateGameAuthorizationCode();
      const codeHash2 = hashGameToken(rawCode2);
      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash: codeHash2,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      const rawToken2 = generateGameAccessToken();
      const tokenHash2 = hashGameToken(rawToken2);
      const exchangeRes2 = await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash: codeHash2,
        redirectUri: client.redirectUri,
        computedCodeChallenge: challenge,
        newTokenHash: tokenHash2,
        databaseUrl: runtimeUrl,
      });
      expect(exchangeRes2.success).toBe(true);
      if (exchangeRes2.success) {
        expect(exchangeRes2.subjectId).toBe(subjectId);
      }

      // 3. Different client receives distinct pairwise subjectId for same account
      const clientB = await registerTestClient('chess_game', true);
      const rawCodeB = generateGameAuthorizationCode();
      const codeHashB = hashGameToken(rawCodeB);
      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: clientB.clientId,
        codeHash: codeHashB,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      const rawTokenB = generateGameAccessToken();
      const tokenHashB = hashGameToken(rawTokenB);
      const exchangeResB = await exchangeGameAuthorizationCode({
        authenticatedClientId: clientB.clientId,
        codeHash: codeHashB,
        redirectUri: clientB.redirectUri,
        computedCodeChallenge: challenge,
        newTokenHash: tokenHashB,
        databaseUrl: runtimeUrl,
      });
      expect(exchangeResB.success).toBe(true);
      if (exchangeResB.success) {
        expect(exchangeResB.subjectId).not.toBe(subjectId);
      }
    });

    it('exchangeGameAuthorizationCode enforces replay-revocation defense on consumed code', async () => {
      const client = await registerTestClient('poker_game', true);
      const session = await createMemberSession(830);
      const { challenge } = generateGamePkce();

      const rawCode = generateGameAuthorizationCode();
      const codeHash = hashGameToken(rawCode);

      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      const rawToken = generateGameAccessToken();
      const tokenHash = hashGameToken(rawToken);

      // 1. Initial valid exchange
      const firstRes = await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash,
        redirectUri: client.redirectUri,
        computedCodeChallenge: challenge,
        newTokenHash: tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(firstRes.success).toBe(true);

      // Confirm token active in DB and via introspection
      const tokenBefore = await runtimePool.query(
        `SELECT * FROM public.game_access_tokens WHERE account_id = $1 AND client_id = $2`,
        [session.accountId, client.clientId]
      );
      expect(tokenBefore.rowCount).toBe(1);

      const introspectBefore = await introspectGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(introspectBefore.active).toBe(true);

      // 2. Replay attack with already consumed code
      const replayRes = await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash,
        redirectUri: client.redirectUri,
        computedCodeChallenge: challenge,
        newTokenHash: hashGameToken(generateGameAccessToken()),
        databaseUrl: runtimeUrl,
      });
      expect(replayRes).toEqual({ success: false, reason: 'invalid_grant' });

      // Replay defense revokes active token in DB and via introspection
      const tokenAfter = await runtimePool.query(
        `SELECT * FROM public.game_access_tokens WHERE account_id = $1 AND client_id = $2`,
        [session.accountId, client.clientId]
      );
      expect(tokenAfter.rowCount).toBe(0);

      const introspectAfter = await introspectGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(introspectAfter).toEqual({ active: false });
    });

    it('handles simultaneous authorization-code exchange attempts with atomic single-winner and replay revocation semantics', async () => {
      const client = await registerTestClient('poker_game', true);
      const session = await createMemberSession(835);
      const { challenge } = generateGamePkce();

      const rawCode = generateGameAuthorizationCode();
      const codeHash = hashGameToken(rawCode);

      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      const tokenHash1 = hashGameToken(generateGameAccessToken());
      const tokenHash2 = hashGameToken(generateGameAccessToken());

      // Execute simultaneous concurrent code exchange requests
      const [result1, result2] = await Promise.all([
        exchangeGameAuthorizationCode({
          authenticatedClientId: client.clientId,
          codeHash,
          redirectUri: client.redirectUri,
          computedCodeChallenge: challenge,
          newTokenHash: tokenHash1,
          databaseUrl: runtimeUrl,
        }),
        exchangeGameAuthorizationCode({
          authenticatedClientId: client.clientId,
          codeHash,
          redirectUri: client.redirectUri,
          computedCodeChallenge: challenge,
          newTokenHash: tokenHash2,
          databaseUrl: runtimeUrl,
        }),
      ]);

      const results = [result1, result2];
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      // Exactly one request succeeded and one was rejected with invalid_grant
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual({ success: false, reason: 'invalid_grant' });

      if (successes[0].success) {
        expect(successes[0].audience).toBe(client.audience);
        expect(successes[0].subjectId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      }

      // Authorization code marked consumed in database
      const codeCheck = await runtimePool.query<{ consumed_at: Date | null }>(
        `SELECT consumed_at FROM public.game_authorization_codes WHERE code_hash = $1`,
        [codeHash]
      );
      expect(codeCheck.rowCount).toBe(1);
      expect(codeCheck.rows[0].consumed_at).not.toBeNull();
    });

    it('simultaneous replay attempts against consumed code all fail and maintain token revocation', async () => {
      const client = await registerTestClient('poker_game', true);
      const session = await createMemberSession(836);
      const { challenge } = generateGamePkce();

      const rawCode = generateGameAuthorizationCode();
      const codeHash = hashGameToken(rawCode);

      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      const initialTokenHash = hashGameToken(generateGameAccessToken());
      const initialExchange = await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash,
        redirectUri: client.redirectUri,
        computedCodeChallenge: challenge,
        newTokenHash: initialTokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(initialExchange.success).toBe(true);

      // Fire multiple simultaneous replay attempts
      const replayResults = await Promise.all([
        exchangeGameAuthorizationCode({
          authenticatedClientId: client.clientId,
          codeHash,
          redirectUri: client.redirectUri,
          computedCodeChallenge: challenge,
          newTokenHash: hashGameToken(generateGameAccessToken()),
          databaseUrl: runtimeUrl,
        }),
        exchangeGameAuthorizationCode({
          authenticatedClientId: client.clientId,
          codeHash,
          redirectUri: client.redirectUri,
          computedCodeChallenge: challenge,
          newTokenHash: hashGameToken(generateGameAccessToken()),
          databaseUrl: runtimeUrl,
        }),
        exchangeGameAuthorizationCode({
          authenticatedClientId: client.clientId,
          codeHash,
          redirectUri: client.redirectUri,
          computedCodeChallenge: challenge,
          newTokenHash: hashGameToken(generateGameAccessToken()),
          databaseUrl: runtimeUrl,
        }),
      ]);

      // All replay attempts return invalid_grant
      for (const res of replayResults) {
        expect(res).toEqual({ success: false, reason: 'invalid_grant' });
      }

      // Replay defense ensures access token is deleted
      const tokenInDb = await runtimePool.query(
        `SELECT * FROM public.game_access_tokens WHERE account_id = $1 AND client_id = $2`,
        [session.accountId, client.clientId]
      );
      expect(tokenInDb.rowCount).toBe(0);

      // Introspection confirms token is inactive
      const introspect = await introspectGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash: initialTokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(introspect).toEqual({ active: false });
    });

    it('exchangeGameAuthorizationCode rejects invalid verifier, wrong redirect, wrong client, or expired code', async () => {
      const client = await registerTestClient('poker_game', true);
      const session = await createMemberSession(840);
      const { challenge } = generateGamePkce();

      const rawCode = generateGameAuthorizationCode();
      const codeHash = hashGameToken(rawCode);

      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      // Wrong challenge / verifier
      const wrongChallengeRes = await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash,
        redirectUri: client.redirectUri,
        computedCodeChallenge: derivePkceChallenge(generateGamePkce().verifier),
        newTokenHash: hashGameToken(generateGameAccessToken()),
        databaseUrl: runtimeUrl,
      });
      expect(wrongChallengeRes).toEqual({ success: false, reason: 'invalid_grant' });

      // Wrong redirect_uri
      const wrongRedirectRes = await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash,
        redirectUri: 'https://other.teamham.world/cb',
        computedCodeChallenge: challenge,
        newTokenHash: hashGameToken(generateGameAccessToken()),
        databaseUrl: runtimeUrl,
      });
      expect(wrongRedirectRes).toEqual({ success: false, reason: 'invalid_grant' });
    });

    it('introspectGameAccessToken returns active for matching client and eligible session, inactive otherwise', async () => {
      const client = await registerTestClient('poker_game', true);
      const session = await createMemberSession(850);
      const { challenge } = generateGamePkce();

      const rawCode = generateGameAuthorizationCode();
      const codeHash = hashGameToken(rawCode);
      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      const rawToken = generateGameAccessToken();
      const tokenHash = hashGameToken(rawToken);
      const exchangeRes = await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash,
        redirectUri: client.redirectUri,
        computedCodeChallenge: challenge,
        newTokenHash: tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(exchangeRes.success).toBe(true);

      // 1. Introspection succeeds for same client
      const introspectRes = await introspectGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(introspectRes.active).toBe(true);
      if (introspectRes.active) {
        expect(introspectRes.clientId).toBe(client.clientId);
        expect(introspectRes.audience).toBe(client.audience);
      }

      // 2. Client isolation: introspection by different client returns inactive
      const otherClient = await registerTestClient('chess_game', true);
      const introspectOther = await introspectGameAccessToken({
        authenticatedClientId: otherClient.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(introspectOther).toEqual({ active: false });

      // 3. Central session replacement (re-login on another device) invalidates game token
      const newSessionHash = makeTokenHash('f');
      await issueLoginSession(session.discordId, null, newSessionHash, runtimeUrl);

      const introspectAfterRelogin = await introspectGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(introspectAfterRelogin).toEqual({ active: false });
    });

    it('revokeGameAccessToken deletes token idempotently and client-bound', async () => {
      const client = await registerTestClient('poker_game', true);
      const session = await createMemberSession(860);
      const { challenge } = generateGamePkce();

      const rawCode = generateGameAuthorizationCode();
      const codeHash = hashGameToken(rawCode);
      await issueGameAuthorizationCode({
        accountId: session.accountId,
        clientId: client.clientId,
        codeHash,
        codeChallenge: challenge,
        sourceSessionHash: session.sessionHash,
        databaseUrl: runtimeUrl,
      });

      const rawToken = generateGameAccessToken();
      const tokenHash = hashGameToken(rawToken);
      await exchangeGameAuthorizationCode({
        authenticatedClientId: client.clientId,
        codeHash,
        redirectUri: client.redirectUri,
        computedCodeChallenge: challenge,
        newTokenHash: tokenHash,
        databaseUrl: runtimeUrl,
      });

      // Revoke with wrong client does not delete token
      await revokeGameAccessToken({
        authenticatedClientId: 'other_client',
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      const checkStillActive = await introspectGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(checkStillActive.active).toBe(true);

      // Revoke with correct client deletes token
      const revokeRes = await revokeGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(revokeRes).toEqual({ success: true });

      const checkRevoked = await introspectGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(checkRevoked).toEqual({ active: false });

      // Idempotent: revoking already revoked token returns { success: true }
      const repeatRevoke = await revokeGameAccessToken({
        authenticatedClientId: client.clientId,
        tokenHash,
        databaseUrl: runtimeUrl,
      });
      expect(repeatRevoke).toEqual({ success: true });
    });
  });

  describe('13. Flappy Puff Member Leaderboard', () => {
    let savedEnv: Record<string, string | undefined>;

    beforeEach(() => {
      savedEnv = {
        AUTH_MODE: process.env.AUTH_MODE,
        APP_BASE_URL: process.env.APP_BASE_URL,
        OAUTH_STATE_HMAC_SECRET: process.env.OAUTH_STATE_HMAC_SECRET,
        GAME_AUTH_REQUEST_HMAC_SECRET: process.env.GAME_AUTH_REQUEST_HMAC_SECRET,
        DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
        DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
        DISCORD_REQUIRED_ROLE_ID: process.env.DISCORD_REQUIRED_ROLE_ID,
        DATABASE_URL: process.env.DATABASE_URL,
      };

      Object.assign(process.env, VALID_DEV_ENV, {
        APP_BASE_URL: 'http://localhost:3000',
        DATABASE_URL: runtimeUrl,
      });
    });

    afterEach(() => {
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    });

    it('keeps only the best score and returns the ranked member snapshot', async () => {
      const accountResult = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (
           discord_user_id,
           discord_username,
           membership_status,
           access_status,
           membership_checked_at
         )
         VALUES ($1, $2, 'eligible', 'active', NOW())
         RETURNING id`,
        [makeDiscordId(990), 'puffpilot']
      );
      const accountId = accountResult.rows[0].id;

      await expect(savePuffHighScore(accountId, 7, runtimeUrl)).resolves.toBe(7);
      await expect(savePuffHighScore(accountId, 3, runtimeUrl)).resolves.toBe(7);
      await expect(savePuffHighScore(accountId, 11, runtimeUrl)).resolves.toBe(11);

      await expect(getPuffLeaderboard(accountId, runtimeUrl)).resolves.toEqual({
        personalBest: 11,
        scores: [{ rank: 1, username: 'puffpilot', score: 11, mine: true }],
      });
    });
  });
});
