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
import {
  getPrintRunLeaderboard,
  savePrintRunHighScore,
} from '@/lib/puff/print-run-leaderboard';
import type { MemberContentInput } from '@/lib/members/validation';
import type { MemberPageDocumentV2 } from '@/lib/members/v2/document';
import { legacyToDoc } from '@/lib/members/v2/legacy-to-doc';
import { parseMemberPageDocumentV2 } from '@/lib/members/v2/validation';
import {
  ALL_PROJECT_STATUSES,
  minimalMemberPageDocument,
} from '../fixtures/member-v2/documents';
import { VALID_DEV_ENV } from '../helpers/test-fixtures';

const rawTestDbUrl = process.env.TEST_DATABASE_URL;
const hasTestDb = Boolean(rawTestDbUrl && rawTestDbUrl.trim() !== '');

const TEST_RUNTIME_ROLE = 'app_runtime_role';
const TEST_RUNTIME_PASSWORD = 'test_only_runtime_secret_password_12345';

interface MemberV2BackfillFixture {
  pageId: string;
  content: MemberContentInput;
  storedDisplayName?: string;
  storedBlurb?: string | null;
  storedWebsiteUrl?: string | null;
  storedSocialLinks?: unknown;
  storedShowcase: unknown;
  isPublished: boolean;
  updatedAt: string;
}

interface MemberV2BackfillRow {
  id: string;
  showcase: unknown | null;
  draft_doc: unknown;
  published_doc: unknown | null;
  draft_rev: string;
  draft_updated_at: Date;
  updated_at: Date;
  published_at: Date | null;
  unpublished_at: Date | null;
  moderation_hold: boolean;
  moderation_held_at: Date | null;
  asset_pending_count: number;
  asset_ready_count: number;
  asset_alloc_window_started_at: Date | null;
  asset_alloc_window_count: number;
}

interface MemberV2BackfillSnapshot {
  fixture: MemberV2BackfillFixture;
  row: MemberV2BackfillRow;
}

interface MigrationPreconditionProbeResult {
  label: string;
  code: string | null;
  message: string;
}

interface MigrationValidEdgeProbeResult {
  code: string | null;
  message: string;
  draftDoc: unknown | null;
}

function makeMinimalMemberV2Document(displayName = 'HAM Friend'): MemberPageDocumentV2 {
  const fixture = minimalMemberPageDocument();
  return {
    ...fixture,
    frame: {
      ...fixture.frame,
      displayName,
    },
  };
}

function makeUrlWithLength(length: number, prefix = 'https://example.com/'): string {
  if (prefix.length > length) throw new Error('URL prefix exceeds requested length.');
  return prefix + 'a'.repeat(length - prefix.length);
}

function makeMemberV2BackfillFixtures(): MemberV2BackfillFixture[] {
  const maximumLengthUrl = makeUrlWithLength(2048);
  const fixtures: MemberV2BackfillFixture[] = [
    {
      pageId: '70000000-0000-4000-8000-000000000001',
      content: {
        displayName: 'No Showcase',
        blurb: null,
        websiteUrl: null,
        socialLinks: {},
        showcase: null,
      },
      storedDisplayName: '  No Showcase  ',
      storedBlurb: '   ',
      storedSocialLinks: {
        github: null,
        bluesky: '',
        mastodon: '   ',
      },
      storedShowcase: null,
      isPublished: false,
      updatedAt: '2026-01-01T01:02:03.000Z',
    },
    {
      pageId: '70000000-0000-4000-8000-000000000002',
      content: {
        displayName: 'HAM Showcase',
        blurb: 'Builds playful things.',
        websiteUrl: 'https://ham-showcase.example',
        socialLinks: {
          github: 'https://github.com/ham-showcase',
          bluesky: 'https://bsky.app/profile/ham-showcase.example',
          mastodon: 'https://social.example/@ham-showcase',
          instagram: 'https://instagram.com/ham-showcase',
          youtube: 'https://youtube.com/@ham-showcase',
          twitch: 'https://twitch.tv/ham-showcase',
          x: 'https://x.com/ham-showcase',
        },
        showcase: { kind: 'project', projectSlug: 'untitled-quiz-show' },
      },
      storedShowcase: { kind: 'project', projectSlug: 'untitled-quiz-show' },
      isPublished: true,
      updatedAt: '2026-02-02T02:03:04.000Z',
    },
    {
      pageId: '70000000-0000-4000-8000-000000000009',
      content: {
        displayName: 'D'.repeat(80),
        blurb: 'B'.repeat(500),
        websiteUrl: maximumLengthUrl,
        socialLinks: {
          github: 'https://github.com/legacy-edge',
          x: maximumLengthUrl,
        },
        showcase: {
          kind: 'external',
          name: 'N'.repeat(80),
          shortDescription: 'S'.repeat(500),
          type: 'T'.repeat(80),
          status: 'released',
        },
      },
      storedSocialLinks: {
        github: '  https://github.com/legacy-edge  ',
        bluesky: null,
        mastodon: '',
        instagram: '   ',
        x: maximumLengthUrl,
      },
      storedShowcase: {
        kind: 'external',
        name: 'N'.repeat(80),
        shortDescription: 'S'.repeat(500),
        type: 'T'.repeat(80),
        status: 'released',
        url: '',
        repository: null,
        imageUrl: 'https://remote.example/operator-import-edge.png',
      },
      isPublished: true,
      updatedAt: '2026-02-03T02:03:04.000Z',
    },
  ];

  for (const [index, status] of ALL_PROJECT_STATUSES.entries()) {
    const includeLinks = index === 0;
    const content: MemberContentInput = {
      displayName: `External ${status}`,
      blurb: index % 2 === 0 ? `Status ${status}.` : null,
      websiteUrl: index % 2 === 0 ? `https://${status}.example` : null,
      socialLinks: index === 1 ? { github: 'https://github.com/external-project' } : {},
      showcase: {
        kind: 'external',
        name: `Project ${status}`,
        shortDescription: `Description for ${status}.`,
        type: 'game',
        status,
        ...(includeLinks
          ? {
              url: 'https://example.com/play',
              repository: 'https://github.com/teamham/external-project',
            }
          : {}),
      },
    };
    const showcase = content.showcase;
    if (!showcase || showcase.kind !== 'external') {
      throw new Error('Expected external migration fixture.');
    }

    fixtures.push({
      pageId: `70000000-0000-4000-8000-${String(index + 3).padStart(12, '0')}`,
      content,
      storedShowcase: {
        ...showcase,
        ...(includeLinks
          ? { imageUrl: 'https://remote.example/legacy-artwork.png' }
          : { url: '', repository: null, imageUrl: 'https://remote.example/drop-me.png' }),
      },
      isPublished: index % 2 === 0,
      updatedAt: `2026-03-${String(index + 1).padStart(2, '0')}T03:04:05.000Z`,
    });
  }

  return fixtures;
}

// SQL queries faithful to MEMBER_SYSTEM_IMPLEMENTATION.md Sections 4.1 - 4.4

const SQL_SESSION_VERIFICATION = `
SELECT
    a.id AS account_id,
    a.access_status,
    a.membership_status,
    a.discord_username,
    a.site_role,
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

// The setup performs dozens of intentional migration probes. Over the VPS SSH
// tunnel those sequential round trips can exceed Vitest's local-DB defaults.
const REAL_DB_LIFECYCLE_TIMEOUT_MS = 120_000;
const REAL_DB_MULTI_QUERY_TEST_TIMEOUT_MS = 15_000;

function makeCodeHash(char = 'c'): string {
  return char.repeat(64);
}

describe.skipIf(!hasTestDb)('PostgreSQL Member System Integration Suite (Real DB)', () => {
  let ownerPool: Pool;
  let runtimePool: Pool;
  let runtimeUrl: string;
  let memberV2BackfillSnapshots: MemberV2BackfillSnapshot[] = [];
  let migrationPreconditionProbeResults: MigrationPreconditionProbeResult[] = [];
  let migrationPreconditionProbeExpectedCount = 0;
  let migrationValidEdgeProbeResult: MigrationValidEdgeProbeResult | null = null;

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

    // 2. Clean existing tables and apply migrations 0001 through 0009
    await ownerPool.query(`DROP TABLE IF EXISTS public.member_page_mutation_rate_limits CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.member_page_assets CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.member_pages CASCADE;`);
    await ownerPool.query(`DROP TABLE IF EXISTS public.puff_print_run_scores CASCADE;`);
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

    const migration0005Path = path.resolve(__dirname, '../../migrations/0005_member_pages.sql');
    const migration0005Sql = fs.readFileSync(migration0005Path, 'utf8');
    await ownerPool.query(migration0005Sql);

    const migration0006Path = path.resolve(__dirname, '../../migrations/0006_member_social_links.sql');
    const migration0006Sql = fs.readFileSync(migration0006Path, 'utf8');
    await ownerPool.query(migration0006Sql);

    const migration0007Path = path.resolve(
      __dirname,
      '../../migrations/0007_member_page_personalization_v2.sql'
    );
    const migration0007Sql = fs.readFileSync(migration0007Path, 'utf8');
    const migration0008Path = path.resolve(
      __dirname,
      '../../migrations/0008_member_page_moderation_privileges.sql'
    );
    const migration0008Sql = fs.readFileSync(migration0008Path, 'utf8');
    const migration0009Path = path.resolve(
      __dirname,
      '../../migrations/0009_puff_print_run_leaderboard.sql'
    );
    const migration0009Sql = fs.readFileSync(migration0009Path, 'utf8');

    const validExternalShowcase = {
      kind: 'external',
      name: 'Name',
      shortDescription: 'Description',
      type: 'game',
      status: 'released',
    };
    const malformedLegacyFixtures: Array<{
      label: string;
      displayName?: string;
      blurb?: string | null;
      websiteUrl?: string | null;
      socialLinks?: unknown;
      showcase?: unknown;
    }> = [
      { label: 'empty display name', displayName: '   ' },
      { label: 'over-limit display name', displayName: 'D'.repeat(81) },
      { label: 'control character in display name', displayName: 'Bad\nName' },
      { label: 'C1 control character in display name', displayName: 'Bad\u0085Name' },
      { label: 'over-limit blurb', blurb: 'B'.repeat(501) },
      { label: 'control character in blurb', blurb: 'Bad\tBlurb' },
      { label: 'over-limit website URL', websiteUrl: makeUrlWithLength(2049) },
      { label: 'relative website URL', websiteUrl: '/members/example' },
      { label: 'non-HTTPS website URL', websiteUrl: 'http://example.com' },
      { label: 'out-of-range website port', websiteUrl: 'https://example.com:99999/' },
      {
        label: 'uppercase scheme with out-of-range website port',
        websiteUrl: 'HTTPS://example.com:99999/',
      },
      {
        label: 'out-of-range numeric IPv4 website host',
        websiteUrl: 'https://999.999.999.999/',
      },
      { label: 'malformed punycode website host', websiteUrl: 'https://xn--a.com/' },
      {
        label: 'uppercase scheme with malformed punycode website host',
        websiteUrl: 'HTTPS://xn--a.com/',
      },
      { label: 'malformed website host', websiteUrl: 'https://%/' },
      {
        label: 'credentialed website URL',
        websiteUrl: 'https://member:secret@example.com/profile',
      },
      { label: 'non-object social links', socialLinks: [] },
      {
        label: 'unknown social platform',
        socialLinks: { linkedin: 'https://linkedin.com/in/example' },
      },
      { label: 'non-string social URL', socialLinks: { github: 42 } },
      {
        label: 'over-limit social URL',
        socialLinks: { github: makeUrlWithLength(2049) },
      },
      { label: 'relative social URL', socialLinks: { github: '/example' } },
      { label: 'non-HTTPS social URL', socialLinks: { github: 'http://github.com/example' } },
      {
        label: 'out-of-range numeric IPv4 social host',
        socialLinks: { github: 'https://999.999.999.999/example' },
      },
      {
        label: 'numeric final-label social host',
        socialLinks: { github: 'https://example.123/example' },
      },
      {
        label: 'credentialed social URL',
        socialLinks: { github: 'https://member:secret@github.com/example' },
      },
      {
        label: 'control character in social URL path',
        socialLinks: { github: 'https://github.com/bad\npath' },
      },
      { label: 'non-object showcase', showcase: [] },
      { label: 'missing showcase kind', showcase: {} },
      { label: 'non-string showcase kind', showcase: { kind: 42 } },
      { label: 'unknown showcase kind', showcase: { kind: 'unknown' } },
      { label: 'missing project slug', showcase: { kind: 'project' } },
      { label: 'non-string project slug', showcase: { kind: 'project', projectSlug: 42 } },
      {
        label: 'nonexistent project slug',
        showcase: { kind: 'project', projectSlug: 'not-in-reviewed-registry' },
      },
      {
        label: 'unknown project showcase key',
        showcase: { kind: 'project', projectSlug: 'untitled-quiz-show', name: 'Unexpected' },
      },
      {
        label: 'missing external name',
        showcase: {
          kind: 'external',
          shortDescription: 'Description',
          type: 'game',
          status: 'released',
        },
      },
      {
        label: 'over-limit external name',
        showcase: { ...validExternalShowcase, name: 'N'.repeat(81) },
      },
      {
        label: 'control character in external name',
        showcase: { ...validExternalShowcase, name: 'Bad\nName' },
      },
      {
        label: 'missing external description',
        showcase: { kind: 'external', name: 'Name', type: 'game', status: 'released' },
      },
      {
        label: 'over-limit external description',
        showcase: { ...validExternalShowcase, shortDescription: 'S'.repeat(501) },
      },
      {
        label: 'control character in external description',
        showcase: { ...validExternalShowcase, shortDescription: 'Bad\tDescription' },
      },
      {
        label: 'missing external type',
        showcase: {
          kind: 'external',
          name: 'Name',
          shortDescription: 'Description',
          status: 'released',
        },
      },
      {
        label: 'over-limit external type',
        showcase: { ...validExternalShowcase, type: 'T'.repeat(81) },
      },
      {
        label: 'control character in external type',
        showcase: { ...validExternalShowcase, type: 'Bad\rType' },
      },
      {
        label: 'missing external status',
        showcase: {
          kind: 'external',
          name: 'Name',
          shortDescription: 'Description',
          type: 'game',
        },
      },
      {
        label: 'non-string external status',
        showcase: { ...validExternalShowcase, status: 42 },
      },
      {
        label: 'unsupported external status',
        showcase: { ...validExternalShowcase, status: 'unknown' },
      },
      {
        label: 'non-string external URL',
        showcase: { ...validExternalShowcase, url: 42 },
      },
      {
        label: 'over-limit external URL',
        showcase: { ...validExternalShowcase, url: makeUrlWithLength(2049) },
      },
      {
        label: 'non-HTTPS external URL',
        showcase: { ...validExternalShowcase, url: 'http://example.com/play' },
      },
      {
        label: 'malformed external IPv6 URL',
        showcase: { ...validExternalShowcase, url: 'https://[:::]/play' },
      },
      {
        label: 'out-of-range numeric IPv4 external URL host',
        showcase: { ...validExternalShowcase, url: 'https://999.999.999.999/play' },
      },
      {
        label: 'hex final-label external URL host',
        showcase: { ...validExternalShowcase, url: 'https://foo.0x10/play' },
      },
      {
        label: 'non-string external repository',
        showcase: { ...validExternalShowcase, repository: false },
      },
      {
        label: 'credentialed external repository',
        showcase: {
          ...validExternalShowcase,
          repository: 'https://member:secret@example.com/repository',
        },
      },
      {
        label: 'out-of-range numeric IPv4 external repository host',
        showcase: {
          ...validExternalShowcase,
          repository: 'https://999.999.999.999/repository',
        },
      },
      {
        label: 'malformed intermediate punycode external repository host',
        showcase: {
          ...validExternalShowcase,
          repository: 'https://foo.xn--abc/repository',
        },
      },
      {
        label: 'invalid external image importer URL',
        showcase: { ...validExternalShowcase, imageUrl: '/legacy-artwork.png' },
      },
      {
        label: 'out-of-range numeric IPv4 external image host',
        showcase: {
          ...validExternalShowcase,
          imageUrl: 'https://999.999.999.999/legacy-artwork.png',
        },
      },
      {
        label: 'octal-like final-label external image host',
        showcase: {
          ...validExternalShowcase,
          imageUrl: 'https://foo.077/legacy-artwork.png',
        },
      },
      {
        label: 'unknown external showcase key',
        showcase: { ...validExternalShowcase, artwork: 'unexpected' },
      },
    ];

    migrationPreconditionProbeExpectedCount = malformedLegacyFixtures.length;
    migrationPreconditionProbeResults = [];
    for (const [index, fixture] of malformedLegacyFixtures.entries()) {
      const client = await ownerPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `ALTER TABLE public.member_pages
           DROP CONSTRAINT ck_member_pages_display_name,
           DROP CONSTRAINT ck_member_pages_blurb,
           DROP CONSTRAINT ck_member_pages_website_url,
           DROP CONSTRAINT ck_member_pages_showcase_object,
           DROP CONSTRAINT ck_member_pages_social_links_object,
           ALTER COLUMN display_name TYPE TEXT,
           ALTER COLUMN blurb TYPE TEXT,
           ALTER COLUMN website_url TYPE TEXT`
        );
        const account = await client.query<{ id: string }>(
          `INSERT INTO public.accounts (
             discord_user_id,
             membership_status,
             access_status,
             membership_checked_at
           ) VALUES ($1, 'eligible', 'active', NOW())
           RETURNING id`,
          [makeDiscordId(1200 + index)]
        );
        await client.query(
          `INSERT INTO public.member_pages (
             owner_account_id,
             created_by_account_id,
             slug,
             display_name,
             blurb,
             website_url,
             social_links,
             showcase
           ) VALUES ($1, $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
          [
            account.rows[0].id,
            `migration-precondition-${index + 1}`,
            fixture.displayName ?? 'Malformed Legacy Fixture',
            fixture.blurb ?? null,
            fixture.websiteUrl ?? null,
            JSON.stringify(fixture.socialLinks === undefined ? {} : fixture.socialLinks),
            fixture.showcase === undefined || fixture.showcase === null
              ? null
              : JSON.stringify(fixture.showcase),
          ]
        );

        try {
          await client.query(migration0007Sql);
          migrationPreconditionProbeResults.push({
            label: fixture.label,
            code: null,
            message: 'Migration unexpectedly succeeded.',
          });
        } catch (error) {
          const databaseError = error as DatabaseError;
          migrationPreconditionProbeResults.push({
            label: fixture.label,
            code: databaseError.code ?? null,
            message: databaseError.message,
          });
        }
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    }

    const validEdgeClient = await ownerPool.connect();
    try {
      await validEdgeClient.query('BEGIN');
      await validEdgeClient.query(
        `ALTER TABLE public.member_pages
         DROP CONSTRAINT ck_member_pages_display_name,
         DROP CONSTRAINT ck_member_pages_blurb,
         DROP CONSTRAINT ck_member_pages_website_url,
         DROP CONSTRAINT ck_member_pages_showcase_object,
         DROP CONSTRAINT ck_member_pages_social_links_object,
         ALTER COLUMN display_name TYPE TEXT,
         ALTER COLUMN blurb TYPE TEXT,
         ALTER COLUMN website_url TYPE TEXT`
      );
      const validEdgeAccount = await validEdgeClient.query<{ id: string }>(
        `INSERT INTO public.accounts (
           discord_user_id,
           membership_status,
           access_status,
           membership_checked_at
         ) VALUES ($1, 'eligible', 'active', NOW())
         RETURNING id`,
        [makeDiscordId(1300)]
      );
      await validEdgeClient.query(
        `INSERT INTO public.member_pages (
           id,
           owner_account_id,
           created_by_account_id,
           slug,
           display_name,
           blurb,
           website_url,
           social_links,
           showcase
         ) VALUES ($1::uuid, $2, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [
          '71000000-0000-4000-8000-000000000001',
          validEdgeAccount.rows[0].id,
          'migration-valid-edge',
          '\u00a0Cafe\u0301 Edge\uFEFF',
          '\u00a0\uFEFF',
          '\u3000https://example.com:65535/path\u202f',
          JSON.stringify({
            github: null,
            bluesky: '',
            mastodon: '   ',
            x: '\u2007https://x.com/valid-edge\u205f',
          }),
          JSON.stringify({
            kind: 'external',
            name: '\u1680Edge Cafe\u0301\u2000',
            shortDescription: '\u2028Edge description.\u2029',
            type: '\u200agame\u3000',
            status: 'released',
            url: '',
            repository: null,
            imageUrl: '\u00a0https://remote.example/operator-import.png\ufeff',
          }),
        ]
      );

      try {
        await validEdgeClient.query(migration0007Sql);
        const migrated = await validEdgeClient.query<{ draft_doc: unknown }>(
          `SELECT draft_doc
           FROM public.member_pages
           WHERE id = $1::uuid`,
          ['71000000-0000-4000-8000-000000000001']
        );
        migrationValidEdgeProbeResult = {
          code: null,
          message: '',
          draftDoc: migrated.rows[0]?.draft_doc ?? null,
        };
      } catch (error) {
        const databaseError = error as DatabaseError;
        migrationValidEdgeProbeResult = {
          code: databaseError.code ?? null,
          message: databaseError.message,
          draftDoc: null,
        };
      }
    } finally {
      await validEdgeClient.query('ROLLBACK').catch(() => {});
      validEdgeClient.release();
    }

    // Seed conceptual V1 fixtures before 0007 so the real migration backfill is
    // exercised in the same disposable database as the rest of this suite.
    const memberV2BackfillFixtures = makeMemberV2BackfillFixtures();
    const migrationAdmin = await ownerPool.query<{ id: string }>(
      `INSERT INTO public.accounts (
         discord_user_id,
         membership_status,
         access_status,
         membership_checked_at,
         site_role
       ) VALUES ($1, 'eligible', 'active', NOW(), 'admin')
       RETURNING id`,
      [makeDiscordId(880)]
    );

    for (const [index, fixture] of memberV2BackfillFixtures.entries()) {
      const migrationOwner = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (
           discord_user_id,
           membership_status,
           access_status,
           membership_checked_at
         ) VALUES ($1, 'eligible', 'active', NOW())
         RETURNING id`,
        [makeDiscordId(881 + index)]
      );

      await ownerPool.query(
        `INSERT INTO public.member_pages (
           id,
           owner_account_id,
           created_by_account_id,
           slug,
           display_name,
           blurb,
           website_url,
           social_links,
           showcase,
           is_published,
           created_at,
           updated_at
         ) VALUES (
           $1::uuid,
           $2::uuid,
           $3::uuid,
           $4,
           $5,
           $6,
           $7,
           $8::jsonb,
           $9::jsonb,
           $10,
           $11::timestamptz,
           $11::timestamptz
         )`,
        [
          fixture.pageId,
          migrationOwner.rows[0].id,
          migrationAdmin.rows[0].id,
          `migration-fixture-${index + 1}`,
          fixture.storedDisplayName ?? fixture.content.displayName,
          fixture.storedBlurb !== undefined ? fixture.storedBlurb : fixture.content.blurb,
          fixture.storedWebsiteUrl !== undefined
            ? fixture.storedWebsiteUrl
            : fixture.content.websiteUrl,
          JSON.stringify(
            fixture.storedSocialLinks === undefined
              ? fixture.content.socialLinks
              : fixture.storedSocialLinks
          ),
          fixture.storedShowcase === null ? null : JSON.stringify(fixture.storedShowcase),
          fixture.isPublished,
          fixture.updatedAt,
        ]
      );
    }

    await ownerPool.query(migration0007Sql);
    await ownerPool.query(migration0008Sql);
    await ownerPool.query(migration0009Sql);

    const memberV2BackfillRows = await ownerPool.query<MemberV2BackfillRow>(
      `SELECT
         id,
         showcase,
         draft_doc,
         published_doc,
         draft_rev,
         draft_updated_at,
         updated_at,
         published_at,
         unpublished_at,
         moderation_hold,
         moderation_held_at,
         asset_pending_count,
         asset_ready_count,
         asset_alloc_window_started_at,
         asset_alloc_window_count
       FROM public.member_pages
       WHERE id = ANY($1::uuid[])`,
      [memberV2BackfillFixtures.map(({ pageId }) => pageId)]
    );
    const backfillRowsById = new Map(
      memberV2BackfillRows.rows.map((row) => [row.id, row] as const)
    );
    memberV2BackfillSnapshots = memberV2BackfillFixtures.map((fixture) => {
      const row = backfillRowsById.get(fixture.pageId);
      if (!row) throw new Error(`Missing 0007 backfill fixture ${fixture.pageId}.`);
      return { fixture, row };
    });

    // 3. Connect as runtime role
    runtimeUrl = buildRuntimeUrl(rawTestDbUrl, TEST_RUNTIME_PASSWORD);
    runtimePool = new Pool({
      connectionString: runtimeUrl,
      max: 5,
    });
  }, REAL_DB_LIFECYCLE_TIMEOUT_MS);

  afterAll(async () => {
    if (runtimePool) {
      await runtimePool.end().catch(() => {});
    }
    if (ownerPool) {
      await ownerPool.end().catch(() => {});
    }
  }, REAL_DB_LIFECYCLE_TIMEOUT_MS);

  beforeEach(async () => {
    if (!ownerPool) return;
    // Clear data between tests to ensure test isolation in FK-safe order
    await ownerPool.query('DELETE FROM public.member_page_assets;');
    await ownerPool.query('DELETE FROM public.member_pages;');
    await ownerPool.query('DELETE FROM public.puff_print_run_scores;');
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
        site_role: string;
        expires_at: Date;
      }>(SQL_SESSION_VERIFICATION, [tokenHash]);

      expect(verifyRes.rowCount).toBe(1);
      expect(verifyRes.rows[0].account_id).toBe(accountId);
      expect(verifyRes.rows[0].access_status).toBe('active');
      expect(verifyRes.rows[0].membership_status).toBe('eligible');
      expect(verifyRes.rows[0].site_role).toBe('member');
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
          expect(verifyRes.account.siteRole).toBe('member');
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

  describe('13a. Puff Print Run Member Leaderboard', () => {
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

    type PrintRunAccountOptions = {
      id?: string;
      username?: string | null;
      membershipStatus?: 'eligible' | 'ineligible';
      accessStatus?: 'active' | 'suspended';
      stale?: boolean;
    };

    async function createPrintRunAccount(suffix: number, options: PrintRunAccountOptions = {}) {
      const result = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (
           id,
           discord_user_id,
           discord_username,
           membership_status,
           access_status,
           membership_checked_at
         ) VALUES (
           COALESCE($1::uuid, gen_random_uuid()),
           $2,
           $3,
           $4,
           $5,
           CASE WHEN $6 THEN NOW() - INTERVAL '25 hours' ELSE NOW() END
         )
         RETURNING id`,
        [
          options.id ?? null,
          makeDiscordId(suffix),
          options.username === undefined ? `runner${suffix}` : options.username,
          options.membershipStatus ?? 'eligible',
          options.accessStatus ?? 'active',
          options.stale ?? false,
        ]
      );
      return result.rows[0].id;
    }

    it('creates the named constraints and ranking index and enforces score, timestamp, FK, and cascade rules', async () => {
      const schema = await ownerPool.query<{
        constraint_name: string;
        definition: string;
      }>(
        `SELECT conname AS constraint_name, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'public.puff_print_run_scores'::regclass
           AND conname IN (
             'ck_puff_print_run_scores_high_score',
             'ck_puff_print_run_scores_timestamps'
           )
         ORDER BY conname`
      );
      expect(schema.rows.map((row) => row.constraint_name)).toEqual([
        'ck_puff_print_run_scores_high_score',
        'ck_puff_print_run_scores_timestamps',
      ]);
      expect(schema.rows[0].definition).toContain('1000000');
      expect(schema.rows[0].definition).toContain('% 5');
      expect(schema.rows[1].definition).toContain('updated_at >= achieved_at');

      const index = await ownerPool.query<{ indexdef: string }>(
        `SELECT indexdef
         FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = 'puff_print_run_scores'
           AND indexname = 'idx_puff_print_run_scores_ranking'`
      );
      expect(index.rows[0].indexdef).toContain(
        'high_score DESC, achieved_at, account_id'
      );

      const accountId = await createPrintRunAccount(1400);
      for (const score of [-5, 1_000_005, 6]) {
        await expect(
          ownerPool.query(
            `INSERT INTO public.puff_print_run_scores (account_id, high_score)
             VALUES ($1, $2)`,
            [accountId, score]
          )
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'ck_puff_print_run_scores_high_score',
        });
      }

      await expect(
        ownerPool.query(
          `INSERT INTO public.puff_print_run_scores (
             account_id, high_score, achieved_at, updated_at
           ) VALUES ($1, 10, NOW(), NOW() - INTERVAL '1 second')`,
          [accountId]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'ck_puff_print_run_scores_timestamps',
      });

      await expect(
        ownerPool.query(
          `INSERT INTO public.puff_print_run_scores (account_id, high_score)
           VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 10)`
        )
      ).rejects.toMatchObject({ code: '23503' });

      await ownerPool.query(
        `INSERT INTO public.puff_print_run_scores (account_id, high_score)
         VALUES ($1, 1000000)`,
        [accountId]
      );
      await ownerPool.query(`DELETE FROM public.accounts WHERE id = $1`, [accountId]);
      const cascaded = await ownerPool.query(
        `SELECT account_id FROM public.puff_print_run_scores WHERE account_id = $1`,
        [accountId]
      );
      expect(cascaded.rowCount).toBe(0);
    });

    it('grants only the exact runtime score operations and rejects forbidden mutations', async () => {
      const privileges = await runtimePool.query<{
        can_select: boolean;
        can_table_insert: boolean;
        can_insert_account: boolean;
        can_insert_score: boolean;
        can_insert_achieved: boolean;
        can_insert_updated: boolean;
        can_update_account: boolean;
        can_update_score: boolean;
        can_update_achieved: boolean;
        can_update_updated: boolean;
        can_delete: boolean;
        can_truncate: boolean;
      }>(`
        SELECT
          has_table_privilege(current_user, 'public.puff_print_run_scores', 'SELECT') AS can_select,
          has_table_privilege(current_user, 'public.puff_print_run_scores', 'INSERT') AS can_table_insert,
          has_column_privilege(current_user, 'public.puff_print_run_scores', 'account_id', 'INSERT') AS can_insert_account,
          has_column_privilege(current_user, 'public.puff_print_run_scores', 'high_score', 'INSERT') AS can_insert_score,
          has_column_privilege(current_user, 'public.puff_print_run_scores', 'achieved_at', 'INSERT') AS can_insert_achieved,
          has_column_privilege(current_user, 'public.puff_print_run_scores', 'updated_at', 'INSERT') AS can_insert_updated,
          has_column_privilege(current_user, 'public.puff_print_run_scores', 'account_id', 'UPDATE') AS can_update_account,
          has_column_privilege(current_user, 'public.puff_print_run_scores', 'high_score', 'UPDATE') AS can_update_score,
          has_column_privilege(current_user, 'public.puff_print_run_scores', 'achieved_at', 'UPDATE') AS can_update_achieved,
          has_column_privilege(current_user, 'public.puff_print_run_scores', 'updated_at', 'UPDATE') AS can_update_updated,
          has_table_privilege(current_user, 'public.puff_print_run_scores', 'DELETE') AS can_delete,
          has_table_privilege(current_user, 'public.puff_print_run_scores', 'TRUNCATE') AS can_truncate
      `);
      expect(privileges.rows[0]).toEqual({
        can_select: true,
        can_table_insert: false,
        can_insert_account: true,
        can_insert_score: true,
        can_insert_achieved: false,
        can_insert_updated: false,
        can_update_account: false,
        can_update_score: true,
        can_update_achieved: true,
        can_update_updated: true,
        can_delete: false,
        can_truncate: false,
      });

      const accountId = await createPrintRunAccount(1401);
      await runtimePool.query(
        `INSERT INTO public.puff_print_run_scores (account_id, high_score) VALUES ($1, 10)`,
        [accountId]
      );
      await expect(
        runtimePool.query(
          `INSERT INTO public.puff_print_run_scores (
             account_id, high_score, achieved_at, updated_at
           ) VALUES ($1, 15, NOW(), NOW())`,
          [accountId]
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtimePool.query(
          `UPDATE public.puff_print_run_scores SET account_id = account_id WHERE account_id = $1`,
          [accountId]
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtimePool.query(
          `DELETE FROM public.puff_print_run_scores WHERE account_id = $1`,
          [accountId]
        )
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('keeps 10 -> 5 -> 10 -> 25 monotonic timestamps and remains independent from Flappy Puff', async () => {
      const accountId = await createPrintRunAccount(1402, { username: 'printpilot' });

      await expect(savePrintRunHighScore(accountId, 10, runtimeUrl)).resolves.toBe(10);
      const first = await ownerPool.query<{ achieved_at: Date; updated_at: Date }>(
        `SELECT achieved_at, updated_at
         FROM public.puff_print_run_scores
         WHERE account_id = $1`,
        [accountId]
      );

      await ownerPool.query(`SELECT pg_sleep(0.02)`);
      await expect(savePrintRunHighScore(accountId, 5, runtimeUrl)).resolves.toBe(10);
      const lower = await ownerPool.query<{ achieved_at: Date; updated_at: Date }>(
        `SELECT achieved_at, updated_at
         FROM public.puff_print_run_scores
         WHERE account_id = $1`,
        [accountId]
      );
      expect(lower.rows[0].achieved_at.getTime()).toBe(first.rows[0].achieved_at.getTime());
      expect(lower.rows[0].updated_at.getTime()).toBeGreaterThan(first.rows[0].updated_at.getTime());

      await ownerPool.query(`SELECT pg_sleep(0.02)`);
      await expect(savePrintRunHighScore(accountId, 10, runtimeUrl)).resolves.toBe(10);
      const equal = await ownerPool.query<{ achieved_at: Date; updated_at: Date }>(
        `SELECT achieved_at, updated_at
         FROM public.puff_print_run_scores
         WHERE account_id = $1`,
        [accountId]
      );
      expect(equal.rows[0].achieved_at.getTime()).toBe(first.rows[0].achieved_at.getTime());
      expect(equal.rows[0].updated_at.getTime()).toBeGreaterThan(lower.rows[0].updated_at.getTime());

      await ownerPool.query(`SELECT pg_sleep(0.02)`);
      await expect(savePrintRunHighScore(accountId, 25, runtimeUrl)).resolves.toBe(25);
      const higher = await ownerPool.query<{ achieved_at: Date; updated_at: Date }>(
        `SELECT achieved_at, updated_at
         FROM public.puff_print_run_scores
         WHERE account_id = $1`,
        [accountId]
      );
      expect(higher.rows[0].achieved_at.getTime()).toBeGreaterThan(first.rows[0].achieved_at.getTime());
      expect(higher.rows[0].updated_at.getTime()).toBeGreaterThanOrEqual(
        higher.rows[0].achieved_at.getTime()
      );

      await expect(savePuffHighScore(accountId, 99, runtimeUrl)).resolves.toBe(99);
      await expect(getPrintRunLeaderboard(accountId, runtimeUrl)).resolves.toMatchObject({
        personalBest: 25,
      });
      await expect(getPuffLeaderboard(accountId, runtimeUrl)).resolves.toMatchObject({
        personalBest: 99,
      });
    });

    it('rejects absent, suspended, ineligible, and stale accounts and excludes their seeded scores', async () => {
      const absentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      await expect(savePrintRunHighScore(absentId, 50, runtimeUrl)).resolves.toBeNull();
      await expect(getPrintRunLeaderboard(absentId, runtimeUrl)).resolves.toBeNull();

      const excluded = [
        await createPrintRunAccount(1410, { accessStatus: 'suspended' }),
        await createPrintRunAccount(1411, { membershipStatus: 'ineligible' }),
        await createPrintRunAccount(1412, { stale: true }),
      ];
      for (const accountId of excluded) {
        await ownerPool.query(
          `INSERT INTO public.puff_print_run_scores (account_id, high_score)
           VALUES ($1, 100)`,
          [accountId]
        );
        await expect(savePrintRunHighScore(accountId, 200, runtimeUrl)).resolves.toBeNull();
        await expect(getPrintRunLeaderboard(accountId, runtimeUrl)).resolves.toBeNull();
      }

      const eligibleId = await createPrintRunAccount(1413, { username: 'eligibleviewer' });
      await expect(getPrintRunLeaderboard(eligibleId, runtimeUrl)).resolves.toEqual({
        personalBest: 0,
        scores: [],
      });
    });

    it('orders ties by achieved time then account ID, marks mine, and falls back missing usernames', async () => {
      const account1 = await createPrintRunAccount(1420, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        username: 'runnerone',
      });
      const account2 = await createPrintRunAccount(1421, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        username: 'runnertwo',
      });
      const account3 = await createPrintRunAccount(1422, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
        username: 'runnerthree',
      });
      const fallback = await createPrintRunAccount(1423, { username: null });

      await ownerPool.query(
        `INSERT INTO public.puff_print_run_scores (
           account_id, high_score, achieved_at, updated_at
         ) VALUES
           ($1, 100, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
           ($2, 100, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
           ($3, 100, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
           ($4, 95,  '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [account1, account2, account3, fallback]
      );

      await expect(getPrintRunLeaderboard(account1, runtimeUrl)).resolves.toEqual({
        personalBest: 100,
        scores: [
          { rank: 1, username: 'runnertwo', score: 100, mine: false },
          { rank: 2, username: 'runnerone', score: 100, mine: true },
          { rank: 3, username: 'runnerthree', score: 100, mine: false },
          { rank: 4, username: 'Member', score: 95, mine: false },
        ],
      });
    });

    it('returns only the top ten while retaining an out-of-board personal best', async () => {
      const accounts: string[] = [];
      for (let index = 0; index < 12; index += 1) {
        const accountId = await createPrintRunAccount(1430 + index, {
          username: `toprunner${index}`,
        });
        accounts.push(accountId);
        await expect(
          savePrintRunHighScore(accountId, 200 - index * 5, runtimeUrl)
        ).resolves.toBe(200 - index * 5);
      }

      const snapshot = await getPrintRunLeaderboard(accounts[11], runtimeUrl);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.personalBest).toBe(145);
      expect(snapshot?.scores).toHaveLength(10);
      expect(snapshot?.scores.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(snapshot?.scores.map((entry) => entry.score)).toEqual([
        200, 195, 190, 185, 180, 175, 170, 165, 160, 155,
      ]);
      expect(snapshot?.scores.some((entry) => entry.mine)).toBe(false);
    });
  });

  describe('14. Member Pages Schema and Least Privilege', () => {
    async function createAccount(idSuffix: number, siteRole: 'member' | 'admin' = 'member') {
      const result = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (
           discord_user_id,
           membership_status,
           access_status,
           membership_checked_at,
           site_role
         ) VALUES ($1, 'eligible', 'active', NOW(), $2)
         RETURNING id`,
        [makeDiscordId(idSuffix), siteRole]
      );
      return result.rows[0].id;
    }

    it('enforces page identity, URL, social-link, showcase, and one-page-per-owner constraints', async () => {
      const adminId = await createAccount(991, 'admin');
      const ownerId = await createAccount(992);

      await runtimePool.query(
        `INSERT INTO public.member_pages (
           owner_account_id,
           created_by_account_id,
           slug,
           display_name,
           website_url,
           showcase,
           draft_doc
         ) VALUES (
           $1,
           $2,
           'ham-friend',
           'HAM Friend',
           'https://example.com',
           $3::jsonb,
           $4::jsonb
         )`,
        [
          ownerId,
          adminId,
          JSON.stringify({ kind: 'project', projectSlug: 'untitled-quiz-show' }),
          JSON.stringify(makeMinimalMemberV2Document()),
        ]
      );

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_pages (
             owner_account_id, created_by_account_id, slug, display_name, draft_doc
           ) VALUES ($1, $2, 'another-page', 'Duplicate Owner', $3::jsonb)`,
          [ownerId, adminId, JSON.stringify(makeMinimalMemberV2Document('Duplicate Owner'))]
        )
      ).rejects.toMatchObject({ code: '23505' });

      const otherOwnerId = await createAccount(993);
      await expect(
        ownerPool.query(
          `INSERT INTO public.member_pages (
             owner_account_id, created_by_account_id, slug, display_name, draft_doc
           ) VALUES ($1, $2, 'UPPERCASE', 'Bad Slug', $3::jsonb)`,
          [otherOwnerId, adminId, JSON.stringify(makeMinimalMemberV2Document('Bad Slug'))]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_pages (
             owner_account_id, created_by_account_id, slug, display_name, social_links, draft_doc
           ) VALUES ($1, $2, 'bad-socials', 'Bad Socials', '[]'::jsonb, $3::jsonb)`,
          [otherOwnerId, adminId, JSON.stringify(makeMinimalMemberV2Document('Bad Socials'))]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_pages (
             owner_account_id, created_by_account_id, slug, display_name, website_url, draft_doc
           ) VALUES ($1, $2, 'bad-url', 'Bad URL', 'http://example.com', $3::jsonb)`,
          [otherOwnerId, adminId, JSON.stringify(makeMinimalMemberV2Document('Bad URL'))]
        )
      ).rejects.toThrow();

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_pages (
             owner_account_id, created_by_account_id, slug, display_name, showcase, draft_doc
           ) VALUES ($1, $2, 'bad-json', 'Bad JSON', '[]'::jsonb, $3::jsonb)`,
          [otherOwnerId, adminId, JSON.stringify(makeMinimalMemberV2Document('Bad JSON'))]
        )
      ).rejects.toThrow();
    });

    it('allows required page operations but denies role changes, slug changes, and deletes', async () => {
      const privileges = await runtimePool.query<{
        can_select_pages_table: boolean;
        can_select_slug: boolean;
        can_select_creator: boolean;
        can_insert_owner: boolean;
        can_update_content: boolean;
        can_select_social_links: boolean;
        can_update_social_links: boolean;
        can_insert_social_links: boolean;
        can_update_slug: boolean;
        can_delete_pages: boolean;
        can_update_role: boolean;
      }>(`
        SELECT
          has_table_privilege(current_user, 'public.member_pages', 'SELECT') AS can_select_pages_table,
          has_column_privilege(current_user, 'public.member_pages', 'slug', 'SELECT') AS can_select_slug,
          has_column_privilege(current_user, 'public.member_pages', 'created_by_account_id', 'SELECT') AS can_select_creator,
          has_column_privilege(current_user, 'public.member_pages', 'owner_account_id', 'INSERT') AS can_insert_owner,
          has_column_privilege(current_user, 'public.member_pages', 'display_name', 'UPDATE') AS can_update_content,
          has_column_privilege(current_user, 'public.member_pages', 'social_links', 'SELECT') AS can_select_social_links,
          has_column_privilege(current_user, 'public.member_pages', 'social_links', 'UPDATE') AS can_update_social_links,
          has_column_privilege(current_user, 'public.member_pages', 'social_links', 'INSERT') AS can_insert_social_links,
          has_column_privilege(current_user, 'public.member_pages', 'slug', 'UPDATE') AS can_update_slug,
          has_table_privilege(current_user, 'public.member_pages', 'DELETE') AS can_delete_pages,
          has_column_privilege(current_user, 'public.accounts', 'site_role', 'UPDATE') AS can_update_role
      `);
      expect(privileges.rows[0]).toEqual({
        can_select_pages_table: false,
        can_select_slug: true,
        can_select_creator: false,
        can_insert_owner: true,
        can_update_content: true,
        can_select_social_links: true,
        can_update_social_links: true,
        can_insert_social_links: false,
        can_update_slug: false,
        can_delete_pages: false,
        can_update_role: false,
      });

      const accountId = await createAccount(994);
      await expect(
        runtimePool.query(`UPDATE public.accounts SET site_role = 'admin' WHERE id = $1`, [accountId])
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('15. Member Page Personalization V2 Migration and Assets', () => {
    async function createV2Actors(idSuffix: number) {
      const admin = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (
           discord_user_id,
           membership_status,
           access_status,
           membership_checked_at,
           site_role
         ) VALUES ($1, 'eligible', 'active', NOW(), 'admin')
         RETURNING id`,
        [makeDiscordId(idSuffix)]
      );
      const owner = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.accounts (
           discord_user_id,
           membership_status,
           access_status,
           membership_checked_at
         ) VALUES ($1, 'eligible', 'active', NOW())
         RETURNING id`,
        [makeDiscordId(idSuffix + 1)]
      );
      return { adminId: admin.rows[0].id, ownerId: owner.rows[0].id };
    }

    async function createV2Page(idSuffix: number, slug: string, displayName = 'V2 Member') {
      const { adminId, ownerId } = await createV2Actors(idSuffix);
      const draft = makeMinimalMemberV2Document(displayName);
      const page = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.member_pages (
           owner_account_id,
           created_by_account_id,
           slug,
           display_name,
           draft_doc
         ) VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [ownerId, adminId, slug, displayName, JSON.stringify(draft)]
      );
      return { adminId, ownerId, pageId: page.rows[0].id, draft };
    }

    function documentReferencingAsset(
      document: MemberPageDocumentV2,
      assetId: string
    ): MemberPageDocumentV2 {
      return {
        ...document,
        frame: {
          ...document.frame,
          portrait: { assetId, alt: null, decorative: true },
        },
      };
    }

    async function insertPendingAssetFixtures(pageId: string, count: number, prefix: string) {
      const result = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.member_page_assets (
           member_page_id, object_key, pending_expires_at
         )
         SELECT $1, $2 || '-' || series::text, NOW() + INTERVAL '15 minutes'
         FROM generate_series(1, $3::integer) series
         RETURNING id`,
        [pageId, prefix, count]
      );
      return result.rows.map(({ id }) => id);
    }

    async function insertReadyAssetFixtures(pageId: string, count: number, prefix: string) {
      const result = await ownerPool.query<{ id: string }>(
        `INSERT INTO public.member_page_assets (
           member_page_id,
           object_key,
           status,
           mime_type,
           byte_size,
           width,
           height,
           etag,
           ready_at,
           verified_at,
           pending_expires_at
         )
         SELECT
           $1,
           $2 || '-' || series::text,
           'ready',
           'image/png',
           1024,
           100,
           100,
           $2 || '-' || series::text,
           NOW(),
           NOW(),
           NOW() + INTERVAL '15 minutes'
         FROM generate_series(1, $3::integer) series
         RETURNING id`,
        [pageId, prefix, count]
      );
      return result.rows.map(({ id }) => id);
    }

    async function setAssetCounterState(input: {
      pageId: string;
      pending: number;
      ready: number;
      windowStartedAt?: Date | null;
      windowCount?: number;
    }) {
      await ownerPool.query(
        `UPDATE public.member_pages
         SET asset_pending_count = $2,
             asset_ready_count = $3,
             asset_alloc_window_started_at = $4,
             asset_alloc_window_count = $5
         WHERE id = $1`,
        [
          input.pageId,
          input.pending,
          input.ready,
          input.windowStartedAt ?? null,
          input.windowCount ?? 0,
        ]
      );
    }

    async function expectNoAssetCounterMismatches() {
      const mismatches = await runtimePool.query<{
        id: string;
        asset_pending_count: number;
        actual_pending_count: number;
        asset_ready_count: number;
        actual_ready_count: number;
      }>(`
        WITH actual AS (
          SELECT
            page.id,
            page.asset_pending_count,
            COUNT(asset.id) FILTER (
              WHERE asset.status = 'pending'
                AND asset.deletion_claimed_at IS NULL
            )::integer AS actual_pending_count,
            page.asset_ready_count,
            COUNT(asset.id) FILTER (
              WHERE asset.status = 'ready'
            )::integer AS actual_ready_count
          FROM public.member_pages page
          LEFT JOIN public.member_page_assets asset ON asset.member_page_id = page.id
          GROUP BY page.id
        )
        SELECT *
        FROM actual
        WHERE asset_pending_count <> actual_pending_count
           OR asset_ready_count <> actual_ready_count
      `);
      expect(mismatches.rows).toEqual([]);
    }

    const ASSET_ALLOCATION_SQL = `
      WITH page_guard AS (
        UPDATE public.member_pages page
        SET
          asset_pending_count = page.asset_pending_count + 1,
          asset_alloc_window_started_at = CASE
            WHEN page.asset_alloc_window_started_at IS NULL
              OR page.asset_alloc_window_started_at <= NOW() - INTERVAL '1 hour'
              THEN NOW()
            ELSE page.asset_alloc_window_started_at
          END,
          asset_alloc_window_count = CASE
            WHEN page.asset_alloc_window_started_at IS NULL
              OR page.asset_alloc_window_started_at <= NOW() - INTERVAL '1 hour'
              THEN 1
            ELSE page.asset_alloc_window_count + 1
          END
        WHERE page.slug = $1
          AND page.owner_account_id = $2
          AND $4::timestamptz > NOW()
          AND page.asset_pending_count < 5
          AND (
            page.asset_alloc_window_started_at IS NULL
            OR page.asset_alloc_window_started_at <= NOW() - INTERVAL '1 hour'
            OR page.asset_alloc_window_count < 20
          )
        RETURNING page.id
      ),
      inserted AS (
        INSERT INTO public.member_page_assets (
          member_page_id,
          object_key,
          pending_expires_at
        )
        SELECT page_guard.id, $3, $4::timestamptz
        FROM page_guard
        RETURNING id, pending_expires_at
      )
      SELECT
        'success'::text AS outcome,
        inserted.id AS asset_id,
        inserted.pending_expires_at
      FROM inserted
      UNION ALL
      SELECT
        CASE
          WHEN page.asset_pending_count >= 5 THEN 'pending-limit'
          WHEN page.asset_alloc_window_started_at IS NOT NULL
            AND page.asset_alloc_window_started_at > NOW() - INTERVAL '1 hour'
            AND page.asset_alloc_window_count >= 20
            THEN 'rate-limit'
          ELSE 'conflict'
        END AS outcome,
        NULL::uuid AS asset_id,
        NULL::timestamptz AS pending_expires_at
      FROM public.member_pages page
      WHERE page.slug = $1
        AND page.owner_account_id = $2
        AND NOT EXISTS (SELECT 1 FROM page_guard)
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1
    `;

    const ASSET_FINALIZE_GUARD_SQL = `
      WITH owned_pending AS MATERIALIZED (
        SELECT
          asset.id,
          asset.object_key,
          asset.pending_expires_at,
          page.id AS member_page_id
        FROM public.member_page_assets asset
        JOIN public.member_pages page ON page.id = asset.member_page_id
        WHERE asset.id = $1
          AND page.slug = $2
          AND page.owner_account_id = $3
          AND asset.status = 'pending'
          AND asset.deletion_claimed_at IS NULL
          AND asset.pending_expires_at > NOW()
        FOR UPDATE OF page
      ),
      mutation_rate AS (
        INSERT INTO public.member_page_mutation_rate_limits AS mutation_limit (
          member_page_id,
          action,
          window_started_at,
          attempt_count
        )
        SELECT owned_pending.member_page_id, 'asset-finalize', NOW(), 1
        FROM owned_pending
        ON CONFLICT (member_page_id, action) DO UPDATE
        SET
          window_started_at = CASE
            WHEN mutation_limit.window_started_at <= NOW() - INTERVAL '5 minutes'
              THEN NOW()
            ELSE mutation_limit.window_started_at
          END,
          attempt_count = CASE
            WHEN mutation_limit.window_started_at <= NOW() - INTERVAL '5 minutes'
              THEN 1
            ELSE mutation_limit.attempt_count + 1
          END
        WHERE mutation_limit.window_started_at <= NOW() - INTERVAL '5 minutes'
           OR mutation_limit.attempt_count < 20
        RETURNING member_page_id
      )
      SELECT
        CASE
          WHEN mutation_rate.member_page_id IS NULL THEN 'rate-limit'
          ELSE 'success'
        END AS outcome,
        owned_pending.id,
        owned_pending.object_key,
        owned_pending.pending_expires_at
      FROM owned_pending
      LEFT JOIN mutation_rate
        ON mutation_rate.member_page_id = owned_pending.member_page_id
      LIMIT 1
    `;

    const ASSET_FINALIZE_SQL = `
      WITH
      page_guard AS MATERIALIZED (
        SELECT
          page.id,
          page.slug,
          page.owner_account_id,
          page.asset_ready_count
        FROM public.member_pages page
        WHERE page.slug = $2
          AND page.owner_account_id = $3
        FOR UPDATE
      ),
      asset_ready AS (
        UPDATE public.member_page_assets asset
        SET
          status = 'ready',
          mime_type = $4,
          byte_size = $5,
          width = $6,
          height = $7,
          etag = $8,
          ready_at = NOW(),
          verified_at = $9
        FROM page_guard page
        WHERE asset.id = $1
          AND asset.member_page_id = page.id
          AND page.slug = $2
          AND page.owner_account_id = $3
          AND asset.status = 'pending'
          AND asset.deletion_claimed_at IS NULL
          AND asset.pending_expires_at > NOW()
          AND page.asset_ready_count < 20
        RETURNING
          asset.id AS asset_id,
          asset.member_page_id,
          asset.mime_type,
          asset.width,
          asset.height,
          asset.ready_at,
          asset.verified_at
      ),
      page_counter AS (
        UPDATE public.member_pages page
        SET
          asset_pending_count = page.asset_pending_count - 1,
          asset_ready_count = page.asset_ready_count + 1
        FROM asset_ready
        WHERE page.id = asset_ready.member_page_id
        RETURNING page.id
      )
      SELECT
        'success'::text AS outcome,
        asset_ready.asset_id,
        asset_ready.mime_type,
        asset_ready.width,
        asset_ready.height,
        asset_ready.ready_at,
        asset_ready.verified_at
      FROM asset_ready
      JOIN page_counter ON page_counter.id = asset_ready.member_page_id
      UNION ALL
      SELECT
        'quota'::text AS outcome,
        NULL::uuid AS asset_id,
        NULL::varchar AS mime_type,
        NULL::integer AS width,
        NULL::integer AS height,
        NULL::timestamptz AS ready_at,
        NULL::timestamptz AS verified_at
      FROM public.member_page_assets asset
      JOIN page_guard page ON page.id = asset.member_page_id
      WHERE asset.id = $1
        AND page.slug = $2
        AND page.owner_account_id = $3
        AND asset.status = 'pending'
        AND asset.deletion_claimed_at IS NULL
        AND asset.pending_expires_at > NOW()
        AND page.asset_ready_count >= 20
        AND NOT EXISTS (SELECT 1 FROM asset_ready)
      LIMIT 1
    `;

    const ASSET_DELETE_CLAIM_SQL = `
      WITH page_guard AS MATERIALIZED (
        SELECT id, draft_doc, published_doc
        FROM public.member_pages
        WHERE slug = $2
          AND owner_account_id = $3
        FOR UPDATE
      ),
      target AS MATERIALIZED (
        SELECT
          asset.id,
          asset.member_page_id,
          asset.object_key,
          asset.status,
          asset.etag,
          asset.created_at,
          (asset.deletion_claimed_at IS NOT NULL) AS already_claimed,
          (
            jsonb_path_exists(
              page_guard.draft_doc,
              '$.**.assetId ? (@ == $assetId)',
              jsonb_build_object('assetId', to_jsonb(asset.id::text)),
              TRUE
            )
            OR jsonb_path_exists(
              COALESCE(page_guard.published_doc, 'null'::jsonb),
              '$.**.assetId ? (@ == $assetId)',
              jsonb_build_object('assetId', to_jsonb(asset.id::text)),
              TRUE
            )
          ) AS is_referenced
        FROM public.member_page_assets asset
        JOIN page_guard ON page_guard.id = asset.member_page_id
        WHERE asset.id = $1
        FOR UPDATE OF asset
      ),
      newly_claimed AS (
        UPDATE public.member_page_assets asset
        SET deletion_claimed_at = NOW()
        FROM target
        WHERE asset.id = target.id
          AND NOT target.already_claimed
          AND NOT target.is_referenced
          AND asset.deletion_claimed_at IS NULL
        RETURNING
          asset.id,
          asset.member_page_id,
          asset.object_key,
          asset.status,
          asset.etag,
          asset.created_at
      ),
      page_adjusted AS (
        UPDATE public.member_pages page
        SET asset_pending_count = page.asset_pending_count - CASE
          WHEN newly_claimed.status = 'pending' THEN 1 ELSE 0
        END
        FROM newly_claimed
        WHERE page.id = newly_claimed.member_page_id
        RETURNING page.id
      )
      SELECT
        'success'::text AS outcome,
        newly_claimed.id,
        newly_claimed.status,
        TRUE AS newly_claimed
      FROM newly_claimed
      JOIN page_adjusted ON page_adjusted.id = newly_claimed.member_page_id
      UNION ALL
      SELECT 'success'::text, target.id, target.status, FALSE
      FROM target
      WHERE target.already_claimed
      UNION ALL
      SELECT
        CASE WHEN target.is_referenced THEN 'referenced' ELSE 'conflict' END,
        NULL::uuid,
        NULL::varchar,
        NULL::boolean
      FROM target
      WHERE NOT target.already_claimed
        AND NOT EXISTS (SELECT 1 FROM newly_claimed)
      UNION ALL
      SELECT 'not-found'::text, NULL::uuid, NULL::varchar, NULL::boolean
      WHERE NOT EXISTS (SELECT 1 FROM target)
      LIMIT 1
    `;

    const ASSET_DELETE_METADATA_SQL = `
      WITH page_guard AS MATERIALIZED (
        SELECT page.id
        FROM public.member_pages page
        JOIN public.member_page_assets asset
          ON asset.member_page_id = page.id
        WHERE asset.id = $1
          AND asset.object_key = $2
          AND asset.deletion_claimed_at IS NOT NULL
          AND asset.etag IS NOT DISTINCT FROM $3
          AND asset.pending_expires_at <= NOW()
        FOR UPDATE OF page
      ),
      deleted AS (
        DELETE FROM public.member_page_assets asset
        USING page_guard
        WHERE asset.id = $1
          AND asset.member_page_id = page_guard.id
          AND asset.object_key = $2
          AND asset.deletion_claimed_at IS NOT NULL
          AND asset.etag IS NOT DISTINCT FROM $3
          AND asset.pending_expires_at <= NOW()
        RETURNING asset.id, asset.member_page_id, asset.status
      ),
      page_adjusted AS (
        UPDATE public.member_pages page
        SET asset_ready_count = page.asset_ready_count - CASE
          WHEN deleted.status = 'ready' THEN 1 ELSE 0
        END
        FROM deleted
        WHERE page.id = deleted.member_page_id
        RETURNING page.id
      )
      SELECT deleted.id, deleted.status
      FROM deleted
      JOIN page_adjusted ON page_adjusted.id = deleted.member_page_id
    `;

    const BRIDGE_SET_PUBLICATION_SQL = `
      UPDATE public.member_pages
      SET
        published_doc = CASE WHEN $2 THEN draft_doc ELSE published_doc END,
        display_name = CASE WHEN $2 THEN draft_doc #>> '{frame,displayName}' ELSE display_name END,
        blurb = CASE WHEN $2 THEN draft_doc #>> '{frame,summary}' ELSE blurb END,
        is_published = $2,
        published_at = CASE WHEN $2 THEN NOW() ELSE published_at END,
        unpublished_at = CASE WHEN $2 THEN NULL ELSE NOW() END,
        updated_at = NOW()
      WHERE id = $1
        AND (NOT $2 OR moderation_hold = FALSE)
        AND (
          NOT $2
          OR draft_doc = jsonb_build_object(
            'schemaVersion', 2,
            'frame', jsonb_build_object(
              'displayName', BTRIM(
                NORMALIZE(display_name, NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ),
              'summary', NULLIF(BTRIM(
                NORMALIZE(blurb, NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), ''),
              'websiteUrl', NULLIF(BTRIM(
                NORMALIZE(website_url, NFC),
                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
              ), ''),
              'socialLinks', jsonb_strip_nulls(jsonb_build_object(
                'github', NULLIF(BTRIM(
                  NORMALIZE(social_links->>'github', NFC),
                  U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                ), ''),
                'bluesky', NULLIF(BTRIM(
                  NORMALIZE(social_links->>'bluesky', NFC),
                  U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                ), ''),
                'mastodon', NULLIF(BTRIM(
                  NORMALIZE(social_links->>'mastodon', NFC),
                  U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                ), ''),
                'instagram', NULLIF(BTRIM(
                  NORMALIZE(social_links->>'instagram', NFC),
                  U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                ), ''),
                'youtube', NULLIF(BTRIM(
                  NORMALIZE(social_links->>'youtube', NFC),
                  U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                ), ''),
                'twitch', NULLIF(BTRIM(
                  NORMALIZE(social_links->>'twitch', NFC),
                  U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                ), ''),
                'x', NULLIF(BTRIM(
                  NORMALIZE(social_links->>'x', NFC),
                  U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                ), '')
              )),
              'portrait', NULL,
              'theme', jsonb_build_object('id', 'paper', 'accentId', 'default')
            ),
            'blocks', CASE
              WHEN showcase IS NULL THEN '[]'::jsonb
              WHEN showcase->>'kind' = 'project' THEN
                jsonb_build_array(
                  jsonb_build_object(
                    'id', 'legacy-featured-' || id::text,
                    'type', 'featuredProject',
                    'variant', 'card',
                    'project', jsonb_build_object(
                      'kind', 'ham',
                      'projectSlug', showcase->>'projectSlug'
                    )
                  )
                )
              WHEN showcase->>'kind' = 'external' THEN
                jsonb_build_array(
                  jsonb_build_object(
                    'id', 'legacy-featured-' || id::text,
                    'type', 'featuredProject',
                    'variant', 'card',
                    'project', jsonb_strip_nulls(
                      jsonb_build_object(
                        'kind', 'external',
                        'name', BTRIM(
                          NORMALIZE(showcase->>'name', NFC),
                          U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                        ),
                        'shortDescription', BTRIM(
                          NORMALIZE(showcase->>'shortDescription', NFC),
                          U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                        ),
                        'type', BTRIM(
                          NORMALIZE(showcase->>'type', NFC),
                          U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                        ),
                        'status', showcase->>'status',
                        'url', NULLIF(BTRIM(
                          NORMALIZE(showcase->>'url', NFC),
                          U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                        ), ''),
                        'repository', NULLIF(BTRIM(
                          NORMALIZE(showcase->>'repository', NFC),
                          U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                        ), ''),
                        'artwork', CASE
                          WHEN
                            JSONB_TYPEOF(
                              draft_doc #> '{blocks,0,project,artwork}'
                            ) = 'object'
                            AND (
                              draft_doc #> '{blocks,0,project,artwork}'
                            ) ?& ARRAY['assetId', 'alt', 'decorative']
                            AND NOT EXISTS (
                              SELECT 1
                              FROM JSONB_OBJECT_KEYS(
                                draft_doc #> '{blocks,0,project,artwork}'
                              ) AS artwork_key(key)
                              WHERE artwork_key.key NOT IN (
                                'assetId',
                                'alt',
                                'decorative'
                              )
                            )
                            AND JSONB_TYPEOF(
                              draft_doc #> '{blocks,0,project,artwork,assetId}'
                            ) = 'string'
                            AND JSONB_TYPEOF(
                              draft_doc #> '{blocks,0,project,artwork,decorative}'
                            ) = 'boolean'
                            AND (
                              (
                                draft_doc #>> '{blocks,0,project,artwork,decorative}'
                              ) = 'true'
                              AND (
                                draft_doc #> '{blocks,0,project,artwork,alt}'
                              ) = 'null'::jsonb
                              OR (
                                draft_doc #>> '{blocks,0,project,artwork,decorative}'
                              ) = 'false'
                              AND JSONB_TYPEOF(
                                draft_doc #> '{blocks,0,project,artwork,alt}'
                              ) = 'string'
                              AND BTRIM(
                                NORMALIZE(
                                  draft_doc #>> '{blocks,0,project,artwork,alt}',
                                  NFC
                                ),
                                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                              ) = (
                                draft_doc #>> '{blocks,0,project,artwork,alt}'
                              )
                              AND BTRIM(
                                NORMALIZE(
                                  draft_doc #>> '{blocks,0,project,artwork,alt}',
                                  NFC
                                ),
                                U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'
                              ) <> ''
                              AND LENGTH(
                                draft_doc #>> '{blocks,0,project,artwork,alt}'
                              ) <= 500
                              AND NOT EXISTS (
                                SELECT 1
                                FROM GENERATE_SERIES(
                                  1,
                                  LENGTH(
                                    draft_doc #>> '{blocks,0,project,artwork,alt}'
                                  )
                                ) AS codepoint_index(position)
                                WHERE ASCII(SUBSTRING(
                                  draft_doc #>> '{blocks,0,project,artwork,alt}'
                                  FROM codepoint_index.position FOR 1
                                )) BETWEEN 1 AND 31
                                   OR ASCII(SUBSTRING(
                                     draft_doc #>> '{blocks,0,project,artwork,alt}'
                                     FROM codepoint_index.position FOR 1
                                   )) BETWEEN 127 AND 159
                              )
                            )
                            AND EXISTS (
                              SELECT 1
                              FROM public.member_page_assets asset
                              WHERE asset.member_page_id = member_pages.id
                                AND asset.id::text = (
                                  draft_doc #>> '{blocks,0,project,artwork,assetId}'
                                )
                                AND asset.status = 'ready'
                                AND asset.deletion_claimed_at IS NULL
                            )
                            THEN draft_doc #> '{blocks,0,project,artwork}'
                          ELSE NULL
                        END
                      )
                    )
                  )
                )
              ELSE '[]'::jsonb
            END
          )
        )
      RETURNING slug
    `;

    const V2_AUTOSAVE_SQL = `
      WITH owned_page AS MATERIALIZED (
        SELECT page.id, page.draft_rev
        FROM public.member_pages page
        WHERE page.slug = $1
          AND page.owner_account_id = $2
        FOR UPDATE OF page
      ),
      mutation_rate AS (
        INSERT INTO public.member_page_mutation_rate_limits AS mutation_limit (
          member_page_id,
          action,
          window_started_at,
          attempt_count
        )
        SELECT owned_page.id, 'autosave', NOW(), 1
        FROM owned_page
        ON CONFLICT (member_page_id, action) DO UPDATE
        SET
          window_started_at = CASE
            WHEN mutation_limit.window_started_at <= NOW() - INTERVAL '1 minute'
              THEN NOW()
            ELSE mutation_limit.window_started_at
          END,
          attempt_count = CASE
            WHEN mutation_limit.window_started_at <= NOW() - INTERVAL '1 minute'
              THEN 1
            ELSE mutation_limit.attempt_count + 1
          END
        WHERE mutation_limit.window_started_at <= NOW() - INTERVAL '1 minute'
           OR mutation_limit.attempt_count < 120
        RETURNING member_page_id
      ),
      target AS MATERIALIZED (
        SELECT page.id, page.draft_rev
        FROM public.member_pages page
        JOIN owned_page ON owned_page.id = page.id
        JOIN mutation_rate ON mutation_rate.member_page_id = page.id
        WHERE page.slug = $1
          AND page.owner_account_id = $2
        FOR UPDATE OF page
      ),
      matched_assets AS MATERIALIZED (
        SELECT asset.id
        FROM public.member_page_assets asset
        JOIN target ON target.id = asset.member_page_id
        JOIN jsonb_array_elements_text($3::jsonb) reference(asset_id)
          ON asset.id::text = reference.asset_id
        WHERE asset.status = 'ready'
          AND asset.deletion_claimed_at IS NULL
        FOR SHARE OF asset
      ),
      updated AS (
        UPDATE public.member_pages page
        SET
          draft_doc = $4::jsonb,
          draft_rev = page.draft_rev + 1,
          draft_updated_at = NOW(),
          updated_at = NOW()
        FROM target
        WHERE page.id = target.id
          AND page.slug = $1
          AND page.owner_account_id = $2
          AND page.draft_rev = $5
          AND (SELECT COUNT(*) FROM matched_assets) = $6
        RETURNING page.draft_rev, page.draft_updated_at
      )
      SELECT 'success'::text AS outcome, updated.draft_rev, updated.draft_updated_at
      FROM updated
      UNION ALL
      SELECT
        CASE
          WHEN target.draft_rev <> $5 THEN 'conflict'
          WHEN (SELECT COUNT(*) FROM matched_assets) <> $6 THEN 'invalid'
          ELSE 'conflict'
        END,
        target.draft_rev,
        NULL::timestamptz
      FROM target
      WHERE NOT EXISTS (SELECT 1 FROM updated)
      UNION ALL
      SELECT
        'rate-limit'::text,
        owned_page.draft_rev,
        NULL::timestamptz
      FROM owned_page
      WHERE NOT EXISTS (SELECT 1 FROM mutation_rate)
      LIMIT 1
    `;

    const V2_PUBLISH_DRAFT_SQL = `
      WITH owned_page AS MATERIALIZED (
        SELECT page.id, page.draft_doc, page.draft_rev, page.moderation_hold
        FROM public.member_pages page
        WHERE page.slug = $1
          AND page.owner_account_id = $2
        FOR UPDATE OF page
      ),
      mutation_rate AS (
        INSERT INTO public.member_page_mutation_rate_limits AS mutation_limit (
          member_page_id,
          action,
          window_started_at,
          attempt_count
        )
        SELECT owned_page.id, 'publish', NOW(), 1
        FROM owned_page
        ON CONFLICT (member_page_id, action) DO UPDATE
        SET
          window_started_at = CASE
            WHEN mutation_limit.window_started_at <= NOW() - INTERVAL '5 minutes'
              THEN NOW()
            ELSE mutation_limit.window_started_at
          END,
          attempt_count = CASE
            WHEN mutation_limit.window_started_at <= NOW() - INTERVAL '5 minutes'
              THEN 1
            ELSE mutation_limit.attempt_count + 1
          END
        WHERE mutation_limit.window_started_at <= NOW() - INTERVAL '5 minutes'
           OR mutation_limit.attempt_count < 10
        RETURNING member_page_id
      )
      SELECT
        CASE
          WHEN mutation_rate.member_page_id IS NULL THEN 'rate-limit'
          ELSE 'success'
        END AS outcome,
        owned_page.draft_doc,
        owned_page.draft_rev,
        owned_page.moderation_hold
      FROM owned_page
      LEFT JOIN mutation_rate ON mutation_rate.member_page_id = owned_page.id
      LIMIT 1
    `;

    const V2_PUBLISH_SQL = `
      WITH target AS MATERIALIZED (
        SELECT id, draft_doc, draft_rev, moderation_hold
        FROM public.member_pages
        WHERE slug = $1
          AND owner_account_id = $2
        FOR UPDATE
      ),
      matched_assets AS MATERIALIZED (
        SELECT asset.id
        FROM public.member_page_assets asset
        JOIN target ON target.id = asset.member_page_id
        JOIN jsonb_array_elements_text($3::jsonb) reference(asset_id)
          ON asset.id::text = reference.asset_id
        WHERE asset.status = 'ready'
          AND asset.deletion_claimed_at IS NULL
        FOR SHARE OF asset
      ),
      updated AS (
        UPDATE public.member_pages page
        SET
          published_doc = page.draft_doc,
          display_name = $7,
          blurb = $8,
          is_published = TRUE,
          published_at = NOW(),
          unpublished_at = NULL,
          updated_at = NOW()
        FROM target
        WHERE page.id = target.id
          AND page.slug = $1
          AND page.owner_account_id = $2
          AND page.draft_rev = $5
          AND page.draft_doc = $4::jsonb
          AND page.moderation_hold = FALSE
          AND (SELECT COUNT(*) FROM matched_assets) = $6
        RETURNING page.slug, page.draft_rev, page.published_at
      )
      SELECT
        'success'::text AS outcome,
        updated.slug,
        updated.draft_rev,
        updated.published_at
      FROM updated
      UNION ALL
      SELECT
        CASE
          WHEN target.draft_rev <> $5 OR target.draft_doc <> $4::jsonb THEN 'conflict'
          WHEN target.moderation_hold THEN 'hold'
          WHEN (SELECT COUNT(*) FROM matched_assets) <> $6 THEN 'invalid'
          ELSE 'conflict'
        END,
        NULL::text,
        target.draft_rev,
        NULL::timestamptz
      FROM target
      WHERE NOT EXISTS (SELECT 1 FROM updated)
      LIMIT 1
    `;

    it('aborts before backfill for every malformed legacy conversion precondition', () => {
      expect(migrationPreconditionProbeResults).toHaveLength(
        migrationPreconditionProbeExpectedCount
      );
      for (const result of migrationPreconditionProbeResults) {
        expect(result, result.label).toMatchObject({ code: '23514' });
        expect(result.message).toContain(
          '0007 precondition failed: malformed or unsupported legacy member page'
        );
      }
    });

    it('backfills the exact NFC and ECMAScript-trimmed legacy document', () => {
      expect(migrationValidEdgeProbeResult).toMatchObject({ code: null, message: '' });
      if (!migrationValidEdgeProbeResult) throw new Error('Missing valid migration edge probe.');

      const expected = legacyToDoc(
        {
          displayName: 'Café Edge',
          blurb: null,
          websiteUrl: 'https://example.com:65535/path',
          socialLinks: { x: 'https://x.com/valid-edge' },
          showcase: {
            kind: 'external',
            name: 'Edge Café',
            shortDescription: 'Edge description.',
            type: 'game',
            status: 'released',
          },
        },
        { ids: () => 'legacy-featured-71000000-0000-4000-8000-000000000001' }
      );
      expect(migrationValidEdgeProbeResult.draftDoc).toEqual(expected);
      const parsed = parseMemberPageDocumentV2(migrationValidEdgeProbeResult.draftDoc);
      expect(parsed.success).toBe(true);
      if (!parsed.success) throw new Error(JSON.stringify(parsed.errors));
      expect(parsed.doc).toEqual(migrationValidEdgeProbeResult.draftDoc);
      expect(JSON.stringify(migrationValidEdgeProbeResult.draftDoc)).not.toContain('imageUrl');
    });

    it('backfills canonical V2 documents for published and unpublished V1 fixtures', () => {
      expect(memberV2BackfillSnapshots).toHaveLength(3 + ALL_PROJECT_STATUSES.length);

      for (const { fixture, row } of memberV2BackfillSnapshots) {
        const expected = legacyToDoc(fixture.content, {
          ids: () => `legacy-featured-${fixture.pageId}`,
        });
        const parsedDraft = parseMemberPageDocumentV2(row.draft_doc);
        expect(parsedDraft.success).toBe(true);
        if (!parsedDraft.success) throw new Error(JSON.stringify(parsedDraft.errors));
        expect(parsedDraft.doc).toEqual(expected);
        expect(row.draft_doc).toEqual(expected);

        if (fixture.isPublished) {
          expect(row.published_doc).toEqual(row.draft_doc);
          const parsedPublished = parseMemberPageDocumentV2(row.published_doc);
          expect(parsedPublished.success).toBe(true);
          if (!parsedPublished.success) throw new Error(JSON.stringify(parsedPublished.errors));
          expect(parsedPublished.doc).toEqual(expected);
        } else {
          expect(row.published_doc).toBeNull();
        }

        const serializedDraft = JSON.stringify(row.draft_doc);
        expect(serializedDraft).not.toContain('imageUrl');
        expect(serializedDraft).not.toContain('remote.example');
        expect(row.showcase).toEqual(fixture.storedShowcase);
        expect(Number(row.draft_rev)).toBe(0);
        expect(row.draft_updated_at).toEqual(row.updated_at);
        expect(row.draft_updated_at.toISOString()).toBe(fixture.updatedAt);
        expect(row.published_at).toBeNull();
        expect(row.unpublished_at).toBeNull();
        expect(row.moderation_hold).toBe(false);
        expect(row.moderation_held_at).toBeNull();
        expect(row.asset_pending_count).toBe(0);
        expect(row.asset_ready_count).toBe(0);
        expect(row.asset_alloc_window_started_at).toBeNull();
        expect(row.asset_alloc_window_count).toBe(0);
      }
    });

    it('accepts limit edges and canonicalizes valid empty legacy optional values', () => {
      const snapshot = memberV2BackfillSnapshots.find(
        ({ fixture }) => fixture.pageId === '70000000-0000-4000-8000-000000000009'
      );
      expect(snapshot).toBeDefined();
      if (!snapshot) throw new Error('Missing legacy normalization edge fixture.');

      expect(snapshot.row.draft_doc).toEqual(
        legacyToDoc(snapshot.fixture.content, {
          ids: () => `legacy-featured-${snapshot.fixture.pageId}`,
        })
      );
      expect(snapshot.fixture.content.displayName).toHaveLength(80);
      expect(snapshot.fixture.content.blurb).toHaveLength(500);
      expect(snapshot.fixture.content.websiteUrl).toHaveLength(2048);
      expect(snapshot.fixture.content.socialLinks.x).toHaveLength(2048);
      expect(snapshot.fixture.content.showcase).toMatchObject({
        name: 'N'.repeat(80),
        shortDescription: 'S'.repeat(500),
        type: 'T'.repeat(80),
      });
      expect(snapshot.row.showcase).toMatchObject({
        imageUrl: 'https://remote.example/operator-import-edge.png',
      });
      expect(JSON.stringify(snapshot.row.draft_doc)).not.toContain('imageUrl');
    });

    it('installs the V2 columns, stable constraints, asset FK, and asset indexes', async () => {
      const pageColumns = await ownerPool.query<{
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
        column_default: string | null;
      }>(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'member_pages'
          AND column_name IN (
            'draft_doc',
            'published_doc',
            'draft_rev',
            'draft_updated_at',
            'published_at',
            'unpublished_at',
            'moderation_hold',
            'moderation_held_at',
            'asset_pending_count',
            'asset_ready_count',
            'asset_alloc_window_started_at',
            'asset_alloc_window_count'
          )
      `);
      const columnsByName = new Map(pageColumns.rows.map((column) => [column.column_name, column]));
      expect(columnsByName.size).toBe(12);
      expect(columnsByName.get('draft_doc')).toMatchObject({
        data_type: 'jsonb',
        is_nullable: 'NO',
        column_default: null,
      });
      expect(columnsByName.get('published_doc')).toMatchObject({
        data_type: 'jsonb',
        is_nullable: 'YES',
        column_default: null,
      });
      expect(columnsByName.get('draft_rev')).toMatchObject({
        data_type: 'bigint',
        is_nullable: 'NO',
        column_default: '0',
      });
      expect(columnsByName.get('draft_updated_at')).toMatchObject({
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
      });
      expect(columnsByName.get('draft_updated_at')?.column_default).toMatch(/now\(\)/i);
      expect(columnsByName.get('moderation_hold')).toMatchObject({
        data_type: 'boolean',
        is_nullable: 'NO',
        column_default: 'false',
      });
      expect(columnsByName.get('asset_pending_count')).toMatchObject({
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '0',
      });
      expect(columnsByName.get('asset_ready_count')).toMatchObject({
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '0',
      });
      expect(columnsByName.get('asset_alloc_window_started_at')).toMatchObject({
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      });
      expect(columnsByName.get('asset_alloc_window_count')).toMatchObject({
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '0',
      });

      const pageConstraints = await ownerPool.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.member_pages'::regclass
      `);
      expect(pageConstraints.rows.map(({ conname }) => conname)).toEqual(
        expect.arrayContaining([
          'ck_member_pages_draft_doc_v2',
          'ck_member_pages_published_doc_v2',
          'ck_member_pages_published_doc_required',
          'ck_member_pages_hold_not_public',
          'ck_member_pages_draft_rev_nonnegative',
          'ck_member_pages_draft_doc_size',
          'ck_member_pages_published_doc_size',
          'ck_member_pages_asset_pending_count',
          'ck_member_pages_asset_ready_count',
          'ck_member_pages_asset_alloc_window_count',
          'ck_member_pages_asset_alloc_window_state',
        ])
      );

      const rateLimitColumns = await ownerPool.query<{
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
        character_maximum_length: number | null;
      }>(`
        SELECT column_name, data_type, is_nullable, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'member_page_mutation_rate_limits'
        ORDER BY ordinal_position
      `);
      expect(rateLimitColumns.rows).toEqual([
        expect.objectContaining({
          column_name: 'member_page_id',
          data_type: 'uuid',
          is_nullable: 'NO',
        }),
        expect.objectContaining({
          column_name: 'action',
          data_type: 'character varying',
          is_nullable: 'NO',
          character_maximum_length: 32,
        }),
        expect.objectContaining({
          column_name: 'window_started_at',
          data_type: 'timestamp with time zone',
          is_nullable: 'NO',
        }),
        expect.objectContaining({
          column_name: 'attempt_count',
          data_type: 'integer',
          is_nullable: 'NO',
        }),
      ]);
      const rateLimitConstraints = await ownerPool.query<{
        conname: string;
        definition: string;
      }>(`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.member_page_mutation_rate_limits'::regclass
      `);
      const rateLimitConstraintsByName = new Map(
        rateLimitConstraints.rows.map(({ conname, definition }) => [conname, definition])
      );
      expect([...rateLimitConstraintsByName.keys()]).toEqual(
        expect.arrayContaining([
          'pk_member_page_mutation_rate_limits',
          'fk_member_page_mutation_rate_limits_page',
          'ck_member_page_mutation_rate_limits_action',
          'ck_member_page_mutation_rate_limits_count',
        ])
      );
      expect(
        rateLimitConstraintsByName.get('fk_member_page_mutation_rate_limits_page')
      ).toContain('ON DELETE CASCADE');

      const assetColumns = await ownerPool.query<{
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
        column_default: string | null;
        character_maximum_length: number | null;
      }>(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'member_page_assets'
      `);
      expect(assetColumns.rows.map(({ column_name }) => column_name)).toEqual(
        expect.arrayContaining([
          'id',
          'member_page_id',
          'object_key',
          'status',
          'mime_type',
          'byte_size',
          'width',
          'height',
          'etag',
          'created_at',
          'ready_at',
          'verified_at',
          'pending_expires_at',
          'deletion_claimed_at',
        ])
      );
      const assetColumnsByName = new Map(
        assetColumns.rows.map((column) => [column.column_name, column])
      );
      expect(assetColumnsByName.size).toBe(14);
      expect(assetColumnsByName.get('id')).toMatchObject({
        data_type: 'uuid',
        is_nullable: 'NO',
      });
      expect(assetColumnsByName.get('id')?.column_default).toMatch(/gen_random_uuid\(\)/i);
      expect(assetColumnsByName.get('status')).toMatchObject({
        data_type: 'character varying',
        is_nullable: 'NO',
        character_maximum_length: 16,
      });
      expect(assetColumnsByName.get('status')?.column_default).toContain('pending');
      expect(assetColumnsByName.get('mime_type')).toMatchObject({
        data_type: 'character varying',
        is_nullable: 'YES',
        character_maximum_length: 32,
      });
      expect(assetColumnsByName.get('etag')).toMatchObject({
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
        character_maximum_length: null,
      });
      expect(assetColumnsByName.get('verified_at')).toMatchObject({
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      });
      expect(assetColumnsByName.get('pending_expires_at')).toMatchObject({
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        column_default: null,
      });
      expect(assetColumnsByName.get('created_at')?.column_default).toMatch(/now\(\)/i);
      expect(assetColumnsByName.get('deletion_claimed_at')).toMatchObject({
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      });

      const assetConstraints = await ownerPool.query<{
        conname: string;
        definition: string;
      }>(`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.member_page_assets'::regclass
      `);
      const assetConstraintsByName = new Map(
        assetConstraints.rows.map((constraint) => [constraint.conname, constraint.definition])
      );
      expect([...assetConstraintsByName.keys()]).toEqual(
        expect.arrayContaining([
          'fk_member_page_assets_member_page',
          'uq_member_page_assets_object_key',
          'ck_member_page_assets_status',
          'ck_member_page_assets_mime_type',
          'ck_member_page_assets_byte_size',
          'ck_member_page_assets_dimensions',
          'ck_member_page_assets_etag',
          'ck_member_page_assets_ready_complete',
          'ck_member_page_assets_pending_incomplete',
        ])
      );
      expect(assetConstraintsByName.get('fk_member_page_assets_member_page')).toContain(
        'ON DELETE RESTRICT'
      );

      const assetIndexes = await ownerPool.query<{ indexname: string; indexdef: string }>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'member_page_assets'
          AND indexname IN (
            'ix_member_page_assets_page',
            'ix_member_page_assets_pending_expiry'
          )
      `);
      const assetIndexesByName = new Map(
        assetIndexes.rows.map(({ indexname, indexdef }) => [indexname, indexdef])
      );
      expect(assetIndexesByName.size).toBe(2);
      expect(assetIndexesByName.get('ix_member_page_assets_page')).toMatch(
        /\(member_page_id, status\)$/
      );
      expect(assetIndexesByName.get('ix_member_page_assets_pending_expiry')).toMatch(
        /\(pending_expires_at\) WHERE .*status.*=.*'pending'/
      );
    });

    it('enforces V2 document defaults, shallow shape/state rules, and both size backstops', async () => {
      const { pageId } = await createV2Page(1000, 'v2-doc-constraints');
      const defaults = await ownerPool.query<{
        draft_rev: string;
        draft_updated_at: Date;
        published_doc: unknown | null;
        published_at: Date | null;
        unpublished_at: Date | null;
        moderation_hold: boolean;
        moderation_held_at: Date | null;
        asset_pending_count: number;
        asset_ready_count: number;
        asset_alloc_window_started_at: Date | null;
        asset_alloc_window_count: number;
      }>(
        `SELECT
           draft_rev,
           draft_updated_at,
           published_doc,
           published_at,
           unpublished_at,
           moderation_hold,
           moderation_held_at,
           asset_pending_count,
           asset_ready_count,
           asset_alloc_window_started_at,
           asset_alloc_window_count
         FROM public.member_pages
         WHERE id = $1`,
        [pageId]
      );
      expect(defaults.rows[0]).toMatchObject({
        draft_rev: '0',
        published_doc: null,
        published_at: null,
        unpublished_at: null,
        moderation_hold: false,
        moderation_held_at: null,
        asset_pending_count: 0,
        asset_ready_count: 0,
        asset_alloc_window_started_at: null,
        asset_alloc_window_count: 0,
      });
      expect(defaults.rows[0].draft_updated_at).toBeInstanceOf(Date);

      for (const violation of [
        {
          assignment: 'asset_pending_count = -1',
          constraint: 'ck_member_pages_asset_pending_count',
        },
        {
          assignment: 'asset_pending_count = 6',
          constraint: 'ck_member_pages_asset_pending_count',
        },
        {
          assignment: 'asset_ready_count = -1',
          constraint: 'ck_member_pages_asset_ready_count',
        },
        {
          assignment: 'asset_ready_count = 21',
          constraint: 'ck_member_pages_asset_ready_count',
        },
        {
          assignment: 'asset_alloc_window_count = -1',
          constraint: 'ck_member_pages_asset_alloc_window_count',
        },
        {
          assignment: 'asset_alloc_window_count = 1, asset_alloc_window_started_at = NULL',
          constraint: 'ck_member_pages_asset_alloc_window_state',
        },
      ]) {
        await expect(
          ownerPool.query(
            `UPDATE public.member_pages SET ${violation.assignment} WHERE id = $1`,
            [pageId]
          )
        ).rejects.toMatchObject({ code: '23514', constraint: violation.constraint });
      }

      for (const malformed of [
        [],
        {},
        { schemaVersion: '2' },
        { schemaVersion: 1 },
      ]) {
        await expect(
          ownerPool.query(`UPDATE public.member_pages SET draft_doc = $2::jsonb WHERE id = $1`, [
            pageId,
            JSON.stringify(malformed),
          ])
        ).rejects.toMatchObject({ code: '23514' });
      }

      await expect(
        ownerPool.query(
          `UPDATE public.member_pages
           SET published_doc = '[]'::jsonb
           WHERE id = $1`,
          [pageId]
        )
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        ownerPool.query(`UPDATE public.member_pages SET is_published = TRUE WHERE id = $1`, [pageId])
      ).rejects.toMatchObject({ code: '23514' });

      await ownerPool.query(
        `UPDATE public.member_pages
         SET published_doc = draft_doc,
             is_published = TRUE
         WHERE id = $1`,
        [pageId]
      );
      await expect(
        ownerPool.query(`UPDATE public.member_pages SET moderation_hold = TRUE WHERE id = $1`, [
          pageId,
        ])
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        ownerPool.query(`UPDATE public.member_pages SET draft_rev = -1 WHERE id = $1`, [pageId])
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        ownerPool.query(
          `UPDATE public.member_pages
           SET draft_doc = jsonb_build_object('schemaVersion', 2, 'padding', repeat('x', 524289))
           WHERE id = $1`,
          [pageId]
        )
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        ownerPool.query(
          `UPDATE public.member_pages
           SET published_doc = jsonb_build_object('schemaVersion', 2, 'padding', repeat('y', 524289))
           WHERE id = $1`,
          [pageId]
        )
      ).rejects.toMatchObject({ code: '23514' });
    }, REAL_DB_MULTI_QUERY_TEST_TIMEOUT_MS);

    it('enforces asset status, ready completeness, ETag, verification, metadata, uniqueness, and FK rules', async () => {
      const { pageId } = await createV2Page(1010, 'v2-asset-constraints');
      const pendingExpiry = '2026-12-31T00:00:00.000Z';

      const pending = await ownerPool.query<{ etag: string | null; verified_at: Date | null }>(
        `INSERT INTO public.member_page_assets (member_page_id, object_key, pending_expires_at)
         VALUES ($1, 'pending/valid', $2::timestamptz)
         RETURNING etag, verified_at`,
        [pageId, pendingExpiry]
      );
      expect(pending.rows[0]).toEqual({ etag: null, verified_at: null });
      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (member_page_id, object_key, pending_expires_at)
           VALUES ($1, 'pending/valid', $2::timestamptz)`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({ code: '23505' });

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (member_page_id, object_key, pending_expires_at)
           VALUES ('00000000-0000-4000-8000-000000000099', 'pending/bad-fk', $1::timestamptz)`,
          [pendingExpiry]
        )
      ).rejects.toMatchObject({ code: '23503' });

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id, object_key, status, pending_expires_at
           ) VALUES ($1, 'invalid/status', 'uploaded', $2::timestamptz)`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id, object_key, status, pending_expires_at
           ) VALUES ($1, 'ready/incomplete', 'ready', $2::timestamptz)`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id, object_key, etag, pending_expires_at
           ) VALUES ($1, 'pending/etag-only', 'pending-etag', $2::timestamptz)`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'ck_member_page_assets_pending_incomplete',
      });

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id, object_key, verified_at, pending_expires_at
           ) VALUES ($1, 'pending/verified-only', NOW(), $2::timestamptz)`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'ck_member_page_assets_pending_incomplete',
      });

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id,
             object_key,
             status,
             mime_type,
             byte_size,
             width,
             height,
             etag,
             ready_at,
             verified_at,
             pending_expires_at
           ) VALUES (
             $1, 'pending/masquerade', 'pending', 'image/png', 100, 10, 10,
             'pending-etag', NOW(), NOW(), $2::timestamptz
           )`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({ code: '23514' });

      for (const invalid of [
        { key: 'ready/bad-mime', mime: 'image/gif', size: 100, width: 10, height: 10 },
        { key: 'ready/zero-size', mime: 'image/png', size: 0, width: 10, height: 10 },
        { key: 'ready/large-size', mime: 'image/png', size: 5242881, width: 10, height: 10 },
        { key: 'ready/zero-width', mime: 'image/png', size: 100, width: 0, height: 10 },
        { key: 'ready/large-height', mime: 'image/png', size: 100, width: 10, height: 4001 },
      ]) {
        await expect(
          ownerPool.query(
            `INSERT INTO public.member_page_assets (
               member_page_id,
               object_key,
               status,
               mime_type,
               byte_size,
               width,
               height,
               etag,
               ready_at,
               verified_at,
               pending_expires_at
             ) VALUES (
               $1, $2, 'ready', $3, $4, $5, $6, 'fixture-etag', NOW(), NOW(), $7::timestamptz
             )`,
            [
              pageId,
              invalid.key,
              invalid.mime,
              invalid.size,
              invalid.width,
              invalid.height,
              pendingExpiry,
            ]
          )
        ).rejects.toMatchObject({ code: '23514' });
      }

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id,
             object_key,
             status,
             mime_type,
             byte_size,
             width,
             height,
             etag,
             ready_at,
             verified_at,
             pending_expires_at
           ) VALUES (
             $1, 'ready/missing-height', 'ready', 'image/webp', 100, 10, NULL,
             'missing-height-etag', NOW(), NOW(), $2
           )`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id,
             object_key,
             status,
             mime_type,
             byte_size,
             width,
             height,
             ready_at,
             verified_at,
             pending_expires_at
           ) VALUES (
             $1, 'ready/missing-etag', 'ready', 'image/png', 100, 10, 10, NOW(), NOW(), $2
           )`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'ck_member_page_assets_ready_complete',
      });

      await expect(
        ownerPool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id,
             object_key,
             status,
             mime_type,
             byte_size,
             width,
             height,
             etag,
             ready_at,
             pending_expires_at
           ) VALUES (
             $1, 'ready/missing-verification', 'ready', 'image/png', 100, 10, 10,
             'missing-verification-etag', NOW(), $2
           )`,
          [pageId, pendingExpiry]
        )
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'ck_member_page_assets_ready_complete',
      });

      for (const [index, invalidEtag] of [
        '',
        'x'.repeat(257),
        'bad\netag',
        'bad\u0085etag',
        'quoted"etag',
      ].entries()) {
        await expect(
          ownerPool.query(
            `INSERT INTO public.member_page_assets (
               member_page_id,
               object_key,
               status,
               mime_type,
               byte_size,
               width,
               height,
               etag,
               ready_at,
               verified_at,
               pending_expires_at
             ) VALUES (
               $1, $2, 'ready', 'image/png', 100, 10, 10, $3, NOW(), NOW(), $4
             )`,
            [pageId, `ready/bad-etag-${index}`, invalidEtag, pendingExpiry]
          )
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'ck_member_page_assets_etag',
        });
      }

      const ready = await ownerPool.query<{
        id: string;
        etag: string;
        verified_at: Date;
        deletion_claimed_at: Date | null;
      }>(
        `INSERT INTO public.member_page_assets (
           member_page_id,
           object_key,
           status,
           mime_type,
           byte_size,
           width,
           height,
           etag,
           ready_at,
           verified_at,
           pending_expires_at
         ) VALUES (
           $1, 'ready/valid', 'ready', 'image/avif', 5242880, 4000, 4000,
           'valid-etag', NOW(), NOW(), $2
         )
         RETURNING id, etag, verified_at, deletion_claimed_at`,
        [pageId, pendingExpiry]
      );
      expect(ready.rows[0].etag).toBe('valid-etag');
      expect(ready.rows[0].verified_at).toBeInstanceOf(Date);
      expect(ready.rows[0].deletion_claimed_at).toBeNull();

      const claimed = await ownerPool.query<{ deletion_claimed_at: Date }>(
        `UPDATE public.member_page_assets
         SET deletion_claimed_at = NOW()
         WHERE id = $1
         RETURNING deletion_claimed_at`,
        [ready.rows[0].id]
      );
      expect(claimed.rows[0].deletion_claimed_at).toBeInstanceOf(Date);

      await expect(
        ownerPool.query(`DELETE FROM public.member_pages WHERE id = $1`, [pageId])
      ).rejects.toMatchObject({ code: '23503' });
    }, REAL_DB_MULTI_QUERY_TEST_TIMEOUT_MS);

    it('grants only the V2 page and asset columns needed by guarded runtime paths', async () => {
      const privileges = await runtimePool.query<Record<string, boolean>>(`
        SELECT
          (
            has_column_privilege(current_user, 'public.member_pages', 'draft_doc', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'published_doc', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'draft_rev', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'draft_updated_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'published_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'unpublished_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'moderation_hold', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'moderation_held_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'updated_at', 'SELECT')
          ) AS can_select_page_v2,
          (
            has_column_privilege(current_user, 'public.member_pages', 'draft_doc', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'published_doc', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'draft_rev', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'draft_updated_at', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'published_at', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'unpublished_at', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'moderation_hold', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'moderation_held_at', 'UPDATE')
          ) AS can_update_page_v2,
          has_column_privilege(current_user, 'public.member_pages', 'draft_doc', 'INSERT') AS can_insert_draft_doc,
          has_column_privilege(current_user, 'public.member_pages', 'draft_rev', 'INSERT') AS can_insert_draft_rev,
          has_column_privilege(current_user, 'public.member_pages', 'draft_updated_at', 'INSERT') AS can_insert_draft_updated_at,
          has_column_privilege(current_user, 'public.member_pages', 'published_doc', 'INSERT') AS can_insert_published_doc,
          has_column_privilege(current_user, 'public.member_pages', 'published_at', 'INSERT') AS can_insert_published_at,
          has_column_privilege(current_user, 'public.member_pages', 'unpublished_at', 'INSERT') AS can_insert_unpublished_at,
          has_column_privilege(current_user, 'public.member_pages', 'moderation_hold', 'INSERT') AS can_insert_moderation_hold,
          has_column_privilege(current_user, 'public.member_pages', 'moderation_held_at', 'INSERT') AS can_insert_moderation_held_at,
          (
            has_column_privilege(current_user, 'public.member_pages', 'asset_pending_count', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'asset_ready_count', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'asset_alloc_window_started_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_pages', 'asset_alloc_window_count', 'SELECT')
          ) AS can_select_asset_counters,
          (
            has_column_privilege(current_user, 'public.member_pages', 'asset_pending_count', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'asset_ready_count', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'asset_alloc_window_started_at', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_pages', 'asset_alloc_window_count', 'UPDATE')
          ) AS can_update_asset_counters,
          (
            has_column_privilege(current_user, 'public.member_pages', 'asset_pending_count', 'INSERT')
            OR has_column_privilege(current_user, 'public.member_pages', 'asset_ready_count', 'INSERT')
            OR has_column_privilege(current_user, 'public.member_pages', 'asset_alloc_window_started_at', 'INSERT')
            OR has_column_privilege(current_user, 'public.member_pages', 'asset_alloc_window_count', 'INSERT')
          ) AS can_insert_asset_counters,
          (
            has_column_privilege(current_user, 'public.member_page_assets', 'id', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'member_page_id', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'object_key', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'status', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'mime_type', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'byte_size', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'width', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'height', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'etag', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'created_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'ready_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'verified_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'pending_expires_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'deletion_claimed_at', 'SELECT')
          ) AS can_select_assets,
          (
            has_column_privilege(current_user, 'public.member_page_assets', 'member_page_id', 'INSERT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'object_key', 'INSERT')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'pending_expires_at', 'INSERT')
          ) AS can_insert_pending_asset,
          has_column_privilege(current_user, 'public.member_page_assets', 'status', 'INSERT') AS can_insert_asset_status,
          has_column_privilege(current_user, 'public.member_page_assets', 'etag', 'INSERT') AS can_insert_asset_etag,
          has_column_privilege(current_user, 'public.member_page_assets', 'verified_at', 'INSERT') AS can_insert_asset_verified_at,
          has_column_privilege(current_user, 'public.member_page_assets', 'id', 'INSERT') AS can_insert_asset_id,
          (
            has_column_privilege(current_user, 'public.member_page_assets', 'status', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'mime_type', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'byte_size', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'width', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'height', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'etag', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'ready_at', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'verified_at', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_assets', 'deletion_claimed_at', 'UPDATE')
          ) AS can_update_asset_lifecycle,
          has_column_privilege(current_user, 'public.member_page_assets', 'object_key', 'UPDATE') AS can_update_object_key,
          has_column_privilege(current_user, 'public.member_page_assets', 'member_page_id', 'UPDATE') AS can_update_asset_page,
          has_column_privilege(current_user, 'public.member_page_assets', 'pending_expires_at', 'UPDATE') AS can_update_pending_expiry,
          has_table_privilege(current_user, 'public.member_page_assets', 'DELETE') AS can_delete_assets,
          has_table_privilege(current_user, 'public.member_page_assets', 'TRUNCATE') AS can_truncate_assets,
          (
            has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'member_page_id', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'action', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'window_started_at', 'SELECT')
            AND has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'attempt_count', 'SELECT')
          ) AS can_select_mutation_limits,
          (
            has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'member_page_id', 'INSERT')
            AND has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'action', 'INSERT')
            AND has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'window_started_at', 'INSERT')
            AND has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'attempt_count', 'INSERT')
          ) AS can_insert_mutation_limits,
          (
            has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'window_started_at', 'UPDATE')
            AND has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'attempt_count', 'UPDATE')
          ) AS can_update_mutation_window,
          (
            has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'member_page_id', 'UPDATE')
            OR has_column_privilege(current_user, 'public.member_page_mutation_rate_limits', 'action', 'UPDATE')
            OR has_table_privilege(current_user, 'public.member_page_mutation_rate_limits', 'DELETE')
            OR has_table_privilege(current_user, 'public.member_page_mutation_rate_limits', 'TRUNCATE')
          ) AS can_mutate_limit_identity_or_delete
      `);
      expect(privileges.rows[0]).toEqual({
        can_select_page_v2: true,
        can_update_page_v2: true,
        can_insert_draft_doc: true,
        can_insert_draft_rev: false,
        can_insert_draft_updated_at: false,
        can_insert_published_doc: true,
        can_insert_published_at: true,
        can_insert_unpublished_at: false,
        can_insert_moderation_hold: false,
        can_insert_moderation_held_at: false,
        can_select_asset_counters: true,
        can_update_asset_counters: true,
        can_insert_asset_counters: false,
        can_select_assets: true,
        can_insert_pending_asset: true,
        can_insert_asset_status: false,
        can_insert_asset_etag: false,
        can_insert_asset_verified_at: false,
        can_insert_asset_id: false,
        can_update_asset_lifecycle: true,
        can_update_object_key: false,
        can_update_asset_page: false,
        can_update_pending_expiry: false,
        can_delete_assets: true,
        can_truncate_assets: false,
        can_select_mutation_limits: true,
        can_insert_mutation_limits: true,
        can_update_mutation_window: true,
        can_mutate_limit_identity_or_delete: false,
      });

      const { pageId } = await createV2Page(1020, 'v2-runtime-assets');
      const pending = await runtimePool.query<{
        id: string;
        object_key: string;
        status: string;
        etag: string | null;
        verified_at: Date | null;
      }>(
        `INSERT INTO public.member_page_assets (
           member_page_id, object_key, pending_expires_at
         ) VALUES ($1, 'runtime/pending', NOW() + INTERVAL '15 minutes')
         RETURNING id, object_key, status, etag, verified_at`,
        [pageId]
      );
      expect(pending.rows[0]).toMatchObject({
        object_key: 'runtime/pending',
        status: 'pending',
        etag: null,
        verified_at: null,
      });

      await expect(
        runtimePool.query(
          `INSERT INTO public.member_page_assets (
             member_page_id,
             object_key,
             status,
             mime_type,
             byte_size,
             width,
             height,
             etag,
             ready_at,
             verified_at,
             pending_expires_at
           ) VALUES (
             $1, 'runtime/forbidden-ready', 'ready', 'image/png', 1024, 100, 100,
             'forbidden-etag', NOW(), NOW(), NOW() + INTERVAL '15 minutes'
           )`,
          [pageId]
        )
      ).rejects.toMatchObject({ code: '42501' });

      await expect(
        runtimePool.query(`UPDATE public.member_page_assets SET object_key = 'changed' WHERE id = $1`, [
          pending.rows[0].id,
        ])
      ).rejects.toMatchObject({ code: '42501' });

      const ready = await runtimePool.query<{
        status: string;
        etag: string;
        verified_at: Date;
        deletion_claimed_at: Date | null;
      }>(
        `UPDATE public.member_page_assets
         SET status = 'ready',
             mime_type = 'image/jpeg',
             byte_size = 1024,
             width = 100,
             height = 100,
             etag = 'runtime-etag',
             ready_at = NOW(),
             verified_at = NOW()
         WHERE id = $1
         RETURNING status, etag, verified_at, deletion_claimed_at`,
        [pending.rows[0].id]
      );
      expect(ready.rows[0]).toMatchObject({
        status: 'ready',
        etag: 'runtime-etag',
        deletion_claimed_at: null,
      });
      expect(ready.rows[0].verified_at).toBeInstanceOf(Date);

      const claimed = await runtimePool.query<{ deletion_claimed_at: Date }>(
        `UPDATE public.member_page_assets
         SET deletion_claimed_at = NOW()
         WHERE id = $1
         RETURNING deletion_claimed_at`,
        [pending.rows[0].id]
      );
      expect(claimed.rows[0].deletion_claimed_at).toBeInstanceOf(Date);

      const deleted = await runtimePool.query(`DELETE FROM public.member_page_assets WHERE id = $1`, [
        pending.rows[0].id,
      ]);
      expect(deleted.rowCount).toBe(1);
    });

    it('durably bounds owner publish retries and resets the fixed window', async () => {
      const { ownerId, pageId } = await createV2Page(1040, 'publish-rate-limit');

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const allowed = await runtimePool.query(V2_PUBLISH_DRAFT_SQL, [
          'publish-rate-limit',
          ownerId,
        ]);
        expect(allowed.rowCount).toBe(1);
      }
      const limited = await runtimePool.query(V2_PUBLISH_DRAFT_SQL, [
        'publish-rate-limit',
        ownerId,
      ]);
      expect(limited.rows).toEqual([expect.objectContaining({ outcome: 'rate-limit' })]);

      const stored = await ownerPool.query<{
        action: string;
        attempt_count: number;
      }>(
        `SELECT action, attempt_count
         FROM public.member_page_mutation_rate_limits
         WHERE member_page_id = $1`,
        [pageId]
      );
      expect(stored.rows).toEqual([{ action: 'publish', attempt_count: 10 }]);

      await ownerPool.query(
        `UPDATE public.member_page_mutation_rate_limits
         SET window_started_at = NOW() - INTERVAL '6 minutes'
         WHERE member_page_id = $1 AND action = 'publish'`,
        [pageId]
      );
      const reset = await runtimePool.query(V2_PUBLISH_DRAFT_SQL, [
        'publish-rate-limit',
        ownerId,
      ]);
      expect(reset.rowCount).toBe(1);
      const resetCount = await ownerPool.query<{ attempt_count: number }>(
        `SELECT attempt_count
         FROM public.member_page_mutation_rate_limits
         WHERE member_page_id = $1 AND action = 'publish'`,
        [pageId]
      );
      expect(resetCount.rows).toEqual([{ attempt_count: 1 }]);
    });

    it('durably bounds finalize verification without charging unknown asset IDs', async () => {
      const { ownerId, pageId } = await createV2Page(1045, 'finalize-rate-limit');
      const [pendingId] = await insertPendingAssetFixtures(
        pageId,
        1,
        'finalize-rate-limit-pending'
      );

      const missing = await runtimePool.query(ASSET_FINALIZE_GUARD_SQL, [
        '00000000-0000-4000-8000-000000000001',
        'finalize-rate-limit',
        ownerId,
      ]);
      expect(missing.rows).toEqual([]);

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const allowed = await runtimePool.query(ASSET_FINALIZE_GUARD_SQL, [
          pendingId,
          'finalize-rate-limit',
          ownerId,
        ]);
        expect(allowed.rows).toEqual([
          expect.objectContaining({ outcome: 'success', id: pendingId }),
        ]);
      }
      const limited = await runtimePool.query(ASSET_FINALIZE_GUARD_SQL, [
        pendingId,
        'finalize-rate-limit',
        ownerId,
      ]);
      expect(limited.rows).toEqual([
        expect.objectContaining({ outcome: 'rate-limit', id: pendingId }),
      ]);

      const stored = await ownerPool.query<{
        action: string;
        attempt_count: number;
      }>(
        `SELECT action, attempt_count
         FROM public.member_page_mutation_rate_limits
         WHERE member_page_id = $1`,
        [pageId]
      );
      expect(stored.rows).toEqual([{ action: 'asset-finalize', attempt_count: 20 }]);
    });

    it('admits exactly one concurrent allocation when the pending counter starts at four', async () => {
      const { ownerId, pageId } = await createV2Page(1050, 'counter-pending-race');
      await insertPendingAssetFixtures(pageId, 4, 'counter-pending-seed');
      await setAssetCounterState({ pageId, pending: 4, ready: 0 });
      await expectNoAssetCounterMismatches();

      const clientA = await runtimePool.connect();
      const clientB = await runtimePool.connect();
      const presignedExpiresAt = new Date(Date.now() + 5 * 60_000);
      try {
        const results = await Promise.all([
          clientA.query<{ outcome: string }>(ASSET_ALLOCATION_SQL, [
            'counter-pending-race',
            ownerId,
            'counter-pending-race-a',
            presignedExpiresAt,
          ]),
          clientB.query<{ outcome: string }>(ASSET_ALLOCATION_SQL, [
            'counter-pending-race',
            ownerId,
            'counter-pending-race-b',
            presignedExpiresAt,
          ]),
        ]);
        expect(results.flatMap(({ rows }) => rows).filter(({ outcome }) => outcome === 'success')).toHaveLength(
          1
        );
      } finally {
        clientA.release();
        clientB.release();
      }

      const state = await runtimePool.query<{
        asset_pending_count: number;
        asset_alloc_window_count: number;
      }>(
        `SELECT asset_pending_count, asset_alloc_window_count
         FROM public.member_pages
         WHERE id = $1`,
        [pageId]
      );
      expect(state.rows[0]).toEqual({
        asset_pending_count: 5,
        asset_alloc_window_count: 1,
      });
      await expectNoAssetCounterMismatches();
    });

    it('admits exactly one concurrent allocation at fixed-window count nineteen', async () => {
      const { ownerId, pageId } = await createV2Page(1060, 'counter-window-race');
      await setAssetCounterState({
        pageId,
        pending: 0,
        ready: 0,
        windowStartedAt: new Date(),
        windowCount: 19,
      });

      const clientA = await runtimePool.connect();
      const clientB = await runtimePool.connect();
      const presignedExpiresAt = new Date(Date.now() + 5 * 60_000);
      try {
        const results = await Promise.all([
          clientA.query<{ outcome: string }>(ASSET_ALLOCATION_SQL, [
            'counter-window-race',
            ownerId,
            'counter-window-race-a',
            presignedExpiresAt,
          ]),
          clientB.query<{ outcome: string }>(ASSET_ALLOCATION_SQL, [
            'counter-window-race',
            ownerId,
            'counter-window-race-b',
            presignedExpiresAt,
          ]),
        ]);
        expect(results.flatMap(({ rows }) => rows).filter(({ outcome }) => outcome === 'success')).toHaveLength(
          1
        );
      } finally {
        clientA.release();
        clientB.release();
      }

      const state = await runtimePool.query<{
        asset_pending_count: number;
        asset_alloc_window_count: number;
      }>(
        `SELECT asset_pending_count, asset_alloc_window_count
         FROM public.member_pages
         WHERE id = $1`,
        [pageId]
      );
      expect(state.rows[0]).toEqual({
        asset_pending_count: 1,
        asset_alloc_window_count: 20,
      });
      await expectNoAssetCounterMismatches();
    });

    it('returns quota from the finalize WHERE guard without flipping the pending asset', async () => {
      const { ownerId, pageId } = await createV2Page(1065, 'counter-finalize-guard');
      await insertReadyAssetFixtures(pageId, 20, 'counter-finalize-guard-ready');
      const [pendingId] = await insertPendingAssetFixtures(
        pageId,
        1,
        'counter-finalize-guard-pending'
      );
      await setAssetCounterState({ pageId, pending: 1, ready: 20 });
      await expectNoAssetCounterMismatches();

      const result = await runtimePool.query<{ outcome: string }>(ASSET_FINALIZE_SQL, [
        pendingId,
        'counter-finalize-guard',
        ownerId,
        'image/png',
        1024,
        100,
        100,
        'counter-finalize-guard',
        new Date(),
      ]);
      expect(result.rows).toEqual([{
        outcome: 'quota',
        asset_id: null,
        mime_type: null,
        width: null,
        height: null,
        ready_at: null,
        verified_at: null,
      }]);

      const state = await runtimePool.query<{
        status: string;
        asset_pending_count: number;
        asset_ready_count: number;
      }>(
        `SELECT asset.status, page.asset_pending_count, page.asset_ready_count
         FROM public.member_page_assets asset
         JOIN public.member_pages page ON page.id = asset.member_page_id
         WHERE asset.id = $1`,
        [pendingId]
      );
      expect(state.rows[0]).toEqual({
        status: 'pending',
        asset_pending_count: 1,
        asset_ready_count: 20,
      });
      await expectNoAssetCounterMismatches();
    });

    it('serializes competing finalizations at the ready-asset quota', async () => {
      const { ownerId, pageId } = await createV2Page(1070, 'counter-finalize-race');
      await insertReadyAssetFixtures(pageId, 19, 'counter-finalize-ready');
      const pendingIds = await insertPendingAssetFixtures(pageId, 2, 'counter-finalize-pending');
      await setAssetCounterState({ pageId, pending: 2, ready: 19 });
      await expectNoAssetCounterMismatches();

      const blocker = await runtimePool.connect();
      const clientA = await runtimePool.connect();
      const clientB = await runtimePool.connect();
      let blockerInTransaction = false;
      try {
        await blocker.query('BEGIN');
        blockerInTransaction = true;
        await blocker.query(`SELECT id FROM public.member_pages WHERE id = $1 FOR UPDATE`, [pageId]);
        const backendPids = await Promise.all([
          clientA.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
          clientB.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
        ]);
        const pids = backendPids.map(({ rows }) => rows[0].pid);

        const finalizations = [
          clientA.query(ASSET_FINALIZE_SQL, [
            pendingIds[0],
            'counter-finalize-race',
            ownerId,
            'image/png',
            1024,
            100,
            100,
            'counter-finalize-a',
            new Date(),
          ]),
          clientB.query(ASSET_FINALIZE_SQL, [
            pendingIds[1],
            'counter-finalize-race',
            ownerId,
            'image/png',
            1024,
            100,
            100,
            'counter-finalize-b',
            new Date(),
          ]),
        ];

        let waitingCount = 0;
        for (let attempt = 0; attempt < 100 && waitingCount < 2; attempt += 1) {
          const waiting = await ownerPool.query<{ waiting_count: number }>(
            `SELECT COUNT(DISTINCT pid)::integer AS waiting_count
             FROM pg_locks
             WHERE pid = ANY($1::integer[])
               AND granted = FALSE`,
            [pids]
          );
          waitingCount = waiting.rows[0].waiting_count;
          if (waitingCount < 2) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waitingCount).toBe(2);

        await blocker.query('COMMIT');
        blockerInTransaction = false;
        const results = await Promise.allSettled(finalizations);
        expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
        const outcomes = results.flatMap((result) =>
          result.status === 'fulfilled'
            ? result.value.rows.map((row) => row.outcome)
            : []
        );
        expect(outcomes.sort()).toEqual(['quota', 'success']);
      } finally {
        if (blockerInTransaction) await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
        clientA.release();
        clientB.release();
      }

      const statuses = await runtimePool.query<{ status: string }>(
        `SELECT status
         FROM public.member_page_assets
         WHERE id = ANY($1::uuid[])
         ORDER BY status`,
        [pendingIds]
      );
      expect(statuses.rows).toEqual([{ status: 'pending' }, { status: 'ready' }]);
      await expectNoAssetCounterMismatches();
    });

    it('keeps counters exact when the same pending asset is finalized twice concurrently', async () => {
      const { ownerId, pageId } = await createV2Page(1080, 'counter-double-finalize');
      const [assetId] = await insertPendingAssetFixtures(pageId, 1, 'counter-double-finalize');
      await setAssetCounterState({ pageId, pending: 1, ready: 0 });

      const params = [
        assetId,
        'counter-double-finalize',
        ownerId,
        'image/png',
        1024,
        100,
        100,
        'counter-double-finalize',
        new Date(),
      ];
      const clientA = await runtimePool.connect();
      const clientB = await runtimePool.connect();
      try {
        const results = await Promise.all([
          clientA.query(ASSET_FINALIZE_SQL, params),
          clientB.query(ASSET_FINALIZE_SQL, params),
        ]);
        expect(results.map(({ rowCount }) => rowCount).sort()).toEqual([0, 1]);
      } finally {
        clientA.release();
        clientB.release();
      }

      await expectNoAssetCounterMismatches();
    });

    it('retains ready quota through claims and simulated R2 failure, then decrements on cleanup', async () => {
      const { ownerId, pageId } = await createV2Page(1090, 'counter-claim-retry');
      const [pendingId] = await insertPendingAssetFixtures(pageId, 1, 'counter-claim-pending');
      const [readyId] = await insertReadyAssetFixtures(pageId, 1, 'counter-claim-ready');
      await setAssetCounterState({ pageId, pending: 1, ready: 1 });

      const firstClaims = await Promise.all([
        runtimePool.query<{ outcome: string; newly_claimed: boolean }>(ASSET_DELETE_CLAIM_SQL, [
          pendingId,
          'counter-claim-retry',
          ownerId,
        ]),
        runtimePool.query<{ outcome: string; newly_claimed: boolean }>(ASSET_DELETE_CLAIM_SQL, [
          readyId,
          'counter-claim-retry',
          ownerId,
        ]),
      ]);
      expect(firstClaims.map(({ rows }) => rows[0])).toEqual([
        expect.objectContaining({ outcome: 'success', newly_claimed: true }),
        expect.objectContaining({ outcome: 'success', newly_claimed: true }),
      ]);
      const claimedState = await runtimePool.query<{
        asset_pending_count: number;
        asset_ready_count: number;
        claimed_ready_count: number;
      }>(
        `SELECT
           page.asset_pending_count,
           page.asset_ready_count,
           COUNT(asset.id) FILTER (
             WHERE asset.status = 'ready' AND asset.deletion_claimed_at IS NOT NULL
           )::integer AS claimed_ready_count
         FROM public.member_pages page
         LEFT JOIN public.member_page_assets asset ON asset.member_page_id = page.id
         WHERE page.id = $1
         GROUP BY page.id`,
        [pageId]
      );
      expect(claimedState.rows[0]).toEqual({
        asset_pending_count: 0,
        asset_ready_count: 1,
        claimed_ready_count: 1,
      });
      await expectNoAssetCounterMismatches();

      // A failed R2 delete performs no metadata statement. The claimed retry is
      // idempotent and the stored ready row must continue consuming quota.
      const retry = await runtimePool.query<{ outcome: string; newly_claimed: boolean }>(
        ASSET_DELETE_CLAIM_SQL,
        [readyId, 'counter-claim-retry', ownerId]
      );
      expect(retry.rows[0]).toMatchObject({ outcome: 'success', newly_claimed: false });
      const retainedQuota = await runtimePool.query<{ asset_ready_count: number }>(
        `SELECT asset_ready_count FROM public.member_pages WHERE id = $1`,
        [pageId]
      );
      expect(retainedQuota.rows[0].asset_ready_count).toBe(1);
      await expectNoAssetCounterMismatches();

      const beforeExpiry = await runtimePool.query<{ id: string; status: string }>(
        ASSET_DELETE_METADATA_SQL,
        [readyId, 'counter-claim-ready-1', 'counter-claim-ready-1']
      );
      expect(beforeExpiry.rows).toEqual([]);
      const retainedClaims = await runtimePool.query<{ id: string; object_key: string }>(
        `SELECT id, object_key
         FROM public.member_page_assets
         WHERE id = ANY($1::uuid[])
         ORDER BY id`,
        [[pendingId, readyId]]
      );
      expect(retainedClaims.rows).toHaveLength(2);
      expect(retainedClaims.rows.map(({ object_key }) => object_key).sort()).toEqual([
        'counter-claim-pending-1',
        'counter-claim-ready-1',
      ]);
      await ownerPool.query(
        `UPDATE public.member_page_assets
         SET pending_expires_at = NOW() - INTERVAL '1 second'
         WHERE id = ANY($1::uuid[])`,
        [[pendingId, readyId]]
      );

      const deletedReady = await runtimePool.query<{ id: string; status: string }>(
        ASSET_DELETE_METADATA_SQL,
        [readyId, 'counter-claim-ready-1', 'counter-claim-ready-1']
      );
      expect(deletedReady.rows).toEqual([{ id: readyId, status: 'ready' }]);
      const deletedPending = await runtimePool.query<{ id: string; status: string }>(
        ASSET_DELETE_METADATA_SQL,
        [pendingId, 'counter-claim-pending-1', null]
      );
      expect(deletedPending.rows).toEqual([{ id: pendingId, status: 'pending' }]);

      const cleanedState = await runtimePool.query<{
        asset_pending_count: number;
        asset_ready_count: number;
        asset_rows: number;
      }>(
        `SELECT
           page.asset_pending_count,
           page.asset_ready_count,
           COUNT(asset.id)::integer AS asset_rows
         FROM public.member_pages page
         LEFT JOIN public.member_page_assets asset ON asset.member_page_id = page.id
         WHERE page.id = $1
         GROUP BY page.id`,
        [pageId]
      );
      expect(cleanedState.rows[0]).toEqual({
        asset_pending_count: 0,
        asset_ready_count: 0,
        asset_rows: 0,
      });
      await expectNoAssetCounterMismatches();
    });

    it('authorizes exact moderation update and returning metadata as runtime', async () => {
      const page = await createV2Page(1095, 'runtime-moderation', 'Runtime Moderation');
      await runtimePool.query(BRIDGE_SET_PUBLICATION_SQL, [page.pageId, true]);

      const held = await runtimePool.query<{
        slug: string;
        is_published: boolean;
        moderation_hold: boolean;
        unpublished_at: Date;
        moderation_held_at: Date;
        updated_at: Date;
      }>(
        `UPDATE public.member_pages
         SET is_published = FALSE,
             moderation_hold = TRUE,
             unpublished_at = NOW(),
             moderation_held_at = NOW(),
             updated_at = NOW()
         WHERE slug = $1
         RETURNING
           slug,
           is_published,
           moderation_hold,
           unpublished_at,
           moderation_held_at,
           updated_at`,
        ['runtime-moderation']
      );
      expect(held.rows[0]).toMatchObject({
        slug: 'runtime-moderation',
        is_published: false,
        moderation_hold: true,
      });
      expect(held.rows[0].unpublished_at).toBeInstanceOf(Date);
      expect(held.rows[0].moderation_held_at).toBeInstanceOf(Date);
      expect(held.rows[0].updated_at).toBeInstanceOf(Date);

      const cleared = await runtimePool.query<{
        slug: string;
        is_published: boolean;
        moderation_hold: boolean;
        updated_at: Date;
      }>(
        `UPDATE public.member_pages
         SET is_published = FALSE,
             moderation_hold = FALSE,
             updated_at = NOW()
         WHERE slug = $1
           AND moderation_hold = TRUE
         RETURNING slug, is_published, moderation_hold, updated_at`,
        ['runtime-moderation']
      );
      expect(cleared.rows[0]).toMatchObject({
        slug: 'runtime-moderation',
        is_published: false,
        moderation_hold: false,
      });
      expect(cleared.rows[0].updated_at).toBeInstanceOf(Date);
    });

    it('executes bridge publication and V2 autosave/publish/claim SQL as runtime', async () => {
      const bridge = await createV2Page(1100, 'runtime-bridge-publication', 'Bridge Runtime');
      const publishedBridge = await runtimePool.query<{ slug: string }>(
        BRIDGE_SET_PUBLICATION_SQL,
        [bridge.pageId, true]
      );
      expect(publishedBridge.rows).toEqual([{ slug: 'runtime-bridge-publication' }]);
      const unpublishedBridge = await runtimePool.query<{ slug: string }>(
        BRIDGE_SET_PUBLICATION_SQL,
        [bridge.pageId, false]
      );
      expect(unpublishedBridge.rows).toEqual([{ slug: 'runtime-bridge-publication' }]);

      const v2 = await createV2Page(1110, 'runtime-v2-statements', 'Runtime V2 Statements');
      const [assetId] = await insertReadyAssetFixtures(v2.pageId, 1, 'runtime-v2-statements');
      await setAssetCounterState({ pageId: v2.pageId, pending: 0, ready: 1 });
      const referencedDocument = documentReferencingAsset(v2.draft, assetId);
      const assetIdsJson = JSON.stringify([assetId]);

      const autosaved = await runtimePool.query<{ outcome: string; draft_rev: string }>(
        V2_AUTOSAVE_SQL,
        [
          'runtime-v2-statements',
          v2.ownerId,
          assetIdsJson,
          referencedDocument,
          0,
          1,
        ]
      );
      expect(autosaved.rows[0]).toMatchObject({ outcome: 'success', draft_rev: '1' });

      const publishDraft = await runtimePool.query<{
        outcome: string;
        draft_doc: unknown;
        draft_rev: string;
        moderation_hold: boolean;
      }>(V2_PUBLISH_DRAFT_SQL, ['runtime-v2-statements', v2.ownerId]);
      expect(publishDraft.rows[0]).toEqual({
        outcome: 'success',
        draft_doc: referencedDocument,
        draft_rev: '1',
        moderation_hold: false,
      });

      const publisher = await runtimePool.connect();
      const claimant = await runtimePool.connect();
      let publisherInTransaction = false;
      try {
        await publisher.query('BEGIN');
        publisherInTransaction = true;
        const published = await publisher.query<{ outcome: string }>(V2_PUBLISH_SQL, [
          'runtime-v2-statements',
          v2.ownerId,
          assetIdsJson,
          referencedDocument,
          1,
          1,
          referencedDocument.frame.displayName,
          referencedDocument.frame.summary,
        ]);
        expect(published.rows[0]).toMatchObject({ outcome: 'success' });

        const claimPromise = claimant.query<{ outcome: string }>(ASSET_DELETE_CLAIM_SQL, [
          assetId,
          'runtime-v2-statements',
          v2.ownerId,
        ]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        await publisher.query('COMMIT');
        publisherInTransaction = false;
        const claim = await claimPromise;
        expect(claim.rows[0]).toMatchObject({ outcome: 'referenced' });
      } finally {
        if (publisherInTransaction) await publisher.query('ROLLBACK').catch(() => {});
        publisher.release();
        claimant.release();
      }

      const publishedState = await runtimePool.query<{
        is_published: boolean;
        draft_doc: unknown;
        published_doc: unknown;
      }>(
        `SELECT is_published, draft_doc, published_doc
         FROM public.member_pages
         WHERE id = $1`,
        [v2.pageId]
      );
      expect(publishedState.rows[0]).toEqual({
        is_published: true,
        draft_doc: referencedDocument,
        published_doc: referencedDocument,
      });
      await expectNoAssetCounterMismatches();
    });

    it('serializes deletion claims against concurrent autosave references in both orders', async () => {
      const autosaveFirst = await createV2Page(1120, 'runtime-autosave-first');
      const [autosaveFirstAssetId] = await insertReadyAssetFixtures(
        autosaveFirst.pageId,
        1,
        'runtime-autosave-first'
      );
      await setAssetCounterState({ pageId: autosaveFirst.pageId, pending: 0, ready: 1 });
      const autosaveFirstDocument = documentReferencingAsset(
        autosaveFirst.draft,
        autosaveFirstAssetId
      );

      const autosaver = await runtimePool.connect();
      const blockedClaimant = await runtimePool.connect();
      let autosaverInTransaction = false;
      try {
        await autosaver.query('BEGIN');
        autosaverInTransaction = true;
        const autosave = await autosaver.query<{ outcome: string }>(V2_AUTOSAVE_SQL, [
          'runtime-autosave-first',
          autosaveFirst.ownerId,
          JSON.stringify([autosaveFirstAssetId]),
          autosaveFirstDocument,
          0,
          1,
        ]);
        expect(autosave.rows[0]).toMatchObject({ outcome: 'success' });

        const claimPromise = blockedClaimant.query<{ outcome: string }>(ASSET_DELETE_CLAIM_SQL, [
          autosaveFirstAssetId,
          'runtime-autosave-first',
          autosaveFirst.ownerId,
        ]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        await autosaver.query('COMMIT');
        autosaverInTransaction = false;
        const claim = await claimPromise;
        expect(claim.rows[0]).toMatchObject({ outcome: 'referenced' });
      } finally {
        if (autosaverInTransaction) await autosaver.query('ROLLBACK').catch(() => {});
        autosaver.release();
        blockedClaimant.release();
      }
      await expectNoAssetCounterMismatches();

      const claimFirst = await createV2Page(1130, 'runtime-claim-first');
      const [claimFirstAssetId] = await insertReadyAssetFixtures(
        claimFirst.pageId,
        1,
        'runtime-claim-first'
      );
      await setAssetCounterState({ pageId: claimFirst.pageId, pending: 0, ready: 1 });
      const claimFirstDocument = documentReferencingAsset(claimFirst.draft, claimFirstAssetId);

      const claimant = await runtimePool.connect();
      const blockedAutosaver = await runtimePool.connect();
      let claimantInTransaction = false;
      try {
        await claimant.query('BEGIN');
        claimantInTransaction = true;
        const claimed = await claimant.query<{ outcome: string; newly_claimed: boolean }>(
          ASSET_DELETE_CLAIM_SQL,
          [claimFirstAssetId, 'runtime-claim-first', claimFirst.ownerId]
        );
        expect(claimed.rows[0]).toMatchObject({ outcome: 'success', newly_claimed: true });

        const autosavePromise = blockedAutosaver.query<{ outcome: string }>(V2_AUTOSAVE_SQL, [
          'runtime-claim-first',
          claimFirst.ownerId,
          JSON.stringify([claimFirstAssetId]),
          claimFirstDocument,
          0,
          1,
        ]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        await claimant.query('COMMIT');
        claimantInTransaction = false;
        const autosave = await autosavePromise;
        expect(autosave.rows[0]).toMatchObject({ outcome: 'invalid', draft_rev: '0' });
      } finally {
        if (claimantInTransaction) await claimant.query('ROLLBACK').catch(() => {});
        claimant.release();
        blockedAutosaver.release();
      }
      await expectNoAssetCounterMismatches();
    });

    it('republishes a canonical legacy external project with imported artwork', async () => {
      const bridge = await createV2Page(
        1140,
        'runtime-bridge-artwork',
        'Bridge Artwork'
      );
      const [assetId] = await insertReadyAssetFixtures(
        bridge.pageId,
        1,
        'runtime-bridge-artwork'
      );
      await setAssetCounterState({ pageId: bridge.pageId, pending: 0, ready: 1 });
      const showcase = {
        kind: 'external' as const,
        name: 'Linkless Project',
        shortDescription: 'Imported artwork must survive the bridge.',
        type: 'tool',
        status: 'released' as const,
      };
      const document = legacyToDoc(
        {
          displayName: 'Bridge Artwork',
          blurb: null,
          websiteUrl: null,
          socialLinks: {},
          showcase,
        },
        {
          ids: () => `legacy-featured-${bridge.pageId}`,
          externalArtworkAssetId: assetId,
        }
      );
      await ownerPool.query(
        `UPDATE public.member_pages
         SET showcase = $2::jsonb,
             draft_doc = $3::jsonb,
             published_doc = NULL,
             is_published = FALSE
         WHERE id = $1`,
        [bridge.pageId, JSON.stringify(showcase), JSON.stringify(document)]
      );

      const published = await runtimePool.query<{ published_doc: unknown }>(
        BRIDGE_SET_PUBLICATION_SQL.replace(
          'RETURNING slug',
          'RETURNING published_doc'
        ),
        [bridge.pageId, true]
      );

      expect(published.rows).toEqual([{ published_doc: document }]);
    });

    it('allows runtime creation of unpublished and immediate legacy-published pages', async () => {
      const unpublishedActors = await createV2Actors(1030);
      const unpublishedDraft = makeMinimalMemberV2Document('Runtime Unpublished');
      const unpublished = await runtimePool.query<{
        is_published: boolean;
        draft_doc: unknown;
        published_doc: unknown | null;
        published_at: Date | null;
      }>(
        `INSERT INTO public.member_pages (
           owner_account_id,
           created_by_account_id,
           slug,
           display_name,
           is_published,
           draft_doc,
           published_doc,
           published_at
         ) VALUES ($1, $2, 'runtime-unpublished', 'Runtime Unpublished', FALSE, $3::jsonb, NULL, NULL)
         RETURNING is_published, draft_doc, published_doc, published_at`,
        [
          unpublishedActors.ownerId,
          unpublishedActors.adminId,
          JSON.stringify(unpublishedDraft),
        ]
      );
      expect(unpublished.rows[0]).toEqual({
        is_published: false,
        draft_doc: unpublishedDraft,
        published_doc: null,
        published_at: null,
      });

      const publishedActors = await createV2Actors(1040);
      const publishedDraft = makeMinimalMemberV2Document('Runtime Published');
      const published = await runtimePool.query<{
        is_published: boolean;
        draft_doc: unknown;
        published_doc: unknown;
        published_at: Date;
      }>(
        `INSERT INTO public.member_pages (
           owner_account_id,
           created_by_account_id,
           slug,
           display_name,
           is_published,
           draft_doc,
           published_doc,
           published_at
         ) VALUES ($1, $2, 'runtime-published', 'Runtime Published', TRUE, $3::jsonb, $3::jsonb, NOW())
         RETURNING is_published, draft_doc, published_doc, published_at`,
        [publishedActors.ownerId, publishedActors.adminId, JSON.stringify(publishedDraft)]
      );
      expect(published.rows[0]).toMatchObject({
        is_published: true,
        draft_doc: publishedDraft,
        published_doc: publishedDraft,
      });
      expect(published.rows[0].published_at).toBeInstanceOf(Date);
    });
  });
});
