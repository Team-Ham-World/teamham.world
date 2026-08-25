import { neon } from '@neondatabase/serverless';
import { getAuthConfig } from './config';
import {
  isValidDiscordId,
  isValidDiscordUsername,
  isValidTokenHash,
  isValidUuid,
} from './crypto';
import { isSiteRole, type SiteRole } from './roles';

export interface VerifiedAccount {
  id: string;
  accessStatus: 'active';
  membershipStatus: 'eligible';
  expiresAt: string | Date;
  /** Display-only Discord username; null when none was captured at login. */
  username: string | null;
  /** Site-wide authorization role; never writable by the runtime role. */
  siteRole: SiteRole;
}

export type SessionVerificationResult =
  | { valid: true; account: VerifiedAccount }
  | { valid: false };

export type IssueSessionResult =
  | { success: true; accountId: string; accessStatus: 'active' }
  | { success: false; suspended: true };

function isValidTimestamp(val: unknown): boolean {
  if (val instanceof Date) {
    return !isNaN(val.getTime());
  }
  if (typeof val === 'string' || typeof val === 'number') {
    const parsed = new Date(val).getTime();
    return !isNaN(parsed);
  }
  return false;
}

function isLoopbackDatabaseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

// Module-local state for lazy local PostgreSQL pool in development mode
let devPoolState: { url: string; pool: import('pg').Pool } | null = null;

async function getDevPgQuery(url: string) {
  if (devPoolState && devPoolState.url !== url) {
    const oldPool = devPoolState.pool;
    devPoolState = null;
    try {
      await oldPool.end();
    } catch {
      // Safely ignore teardown errors on old pool
    }
  }

  if (!devPoolState) {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: url,
      max: 5,
      allowExitOnIdle: true,
    });
    devPoolState = { url, pool };
  }

  const currentPool = devPoolState.pool;

  return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) {
      text += `$${i + 1}${strings[i + 1]}`;
    }
    const res = await currentPool.query(text, values);
    return res.rows;
  };
}

export function getDbClient(databaseUrl?: string) {
  const config = getAuthConfig();
  const url = databaseUrl || config.databaseUrl;

  if (config.mode === 'development' && isLoopbackDatabaseUrl(url)) {
    return async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
      const query = await getDevPgQuery(url);
      return query(strings, ...values);
    };
  }

  return neon(url);
}

export async function verifySession(
  tokenHash: string,
  databaseUrl?: string
): Promise<SessionVerificationResult> {
  if (!isValidTokenHash(tokenHash)) {
    return { valid: false };
  }

  const sql = getDbClient(databaseUrl);

  const rows = (await sql`
    SELECT
        a.id AS account_id,
        a.access_status,
        a.membership_status,
        a.discord_username,
        a.site_role,
        s.expires_at
    FROM public.sessions s
    JOIN public.accounts a ON s.account_id = a.id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > NOW()
      AND a.access_status = 'active'
      AND a.membership_status = 'eligible'
      AND a.membership_checked_at + INTERVAL '24 hours' > NOW();
  `) as Array<{
    account_id: string;
    access_status: string;
    membership_status: string;
    discord_username: string | null;
    site_role: string;
    expires_at: string | Date;
  }>;

  if (rows.length === 1) {
    const row = rows[0];
    if (
      isValidUuid(row.account_id) &&
      row.access_status === 'active' &&
      row.membership_status === 'eligible' &&
      isSiteRole(row.site_role) &&
      isValidTimestamp(row.expires_at)
    ) {
      return {
        valid: true,
        account: {
          id: row.account_id,
          accessStatus: 'active',
          membershipStatus: 'eligible',
          expiresAt: row.expires_at,
          // Cosmetic field: an unreadable username degrades to null instead of
          // failing an otherwise valid session.
          username: isValidDiscordUsername(row.discord_username) ? row.discord_username : null,
          siteRole: row.site_role,
        },
      };
    }
    throw new Error('Malformed database query result shape for session verification');
  }

  if (rows.length === 0) {
    return { valid: false };
  }

  throw new Error('Malformed database query result shape for session verification');
}

export async function issueLoginSession(
  discordUserId: string,
  discordUsername: string | null,
  tokenHash: string,
  databaseUrl?: string
): Promise<IssueSessionResult> {
  if (!isValidDiscordId(discordUserId) || !isValidTokenHash(tokenHash)) {
    throw new Error('Invalid Discord user ID or token hash format');
  }

  // The username is display-only, so an unusable value is dropped rather than
  // thrown: it must never be the reason a member cannot sign in.
  const username = isValidDiscordUsername(discordUsername) ? discordUsername : null;

  const sql = getDbClient(databaseUrl);

  const rows = (await sql`
    WITH upsert_account AS (
        INSERT INTO public.accounts (
            discord_user_id,
            discord_username,
            membership_status,
            access_status,
            membership_checked_at
        )
        VALUES (${discordUserId}, ${username}, 'eligible', 'active', NOW())
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
            ${tokenHash},
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
  `) as Array<{
    account_id: string;
    access_status: string;
  }>;

  if (rows.length === 1) {
    const row = rows[0];
    if (isValidUuid(row.account_id) && row.access_status === 'active') {
      return {
        success: true,
        accountId: row.account_id,
        accessStatus: 'active',
      };
    }
    throw new Error('Malformed database query result shape for session issuance');
  }

  if (rows.length === 0) {
    return {
      success: false,
      suspended: true,
    };
  }

  throw new Error('Malformed database query result shape for session issuance');
}

export async function recordIneligibleAccount(
  discordUserId: string,
  databaseUrl?: string
): Promise<{ success: true }> {
  if (!isValidDiscordId(discordUserId)) {
    throw new Error('Invalid Discord user ID format');
  }

  const sql = getDbClient(databaseUrl);

  await sql`
    WITH updated_account AS (
        UPDATE public.accounts
        SET
            membership_status = 'ineligible',
            membership_checked_at = NOW(),
            updated_at = NOW()
        WHERE discord_user_id = ${discordUserId}
          AND access_status = 'active'
        RETURNING accounts.id
    )
    DELETE FROM public.sessions
    WHERE account_id IN (SELECT id FROM updated_account);
  `;

  return { success: true };
}

export async function deleteSessionByTokenHash(
  tokenHash: string,
  databaseUrl?: string
): Promise<{ success: true }> {
  if (!isValidTokenHash(tokenHash)) {
    throw new Error('Invalid token hash format');
  }

  const sql = getDbClient(databaseUrl);

  await sql`DELETE FROM public.sessions WHERE token_hash = ${tokenHash};`;

  return { success: true };
}
