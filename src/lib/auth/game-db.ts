import { getAuthConfig } from './config';
import { getDbClient } from './db';
import { isValidUuid } from './crypto';
import {
  isValidGameAudience,
  isValidGameClientId,
  isValidGamePkceChallenge,
  isValidGameRedirectUri,
  isValidSha256Hex,
  verifyClientSecret,
} from './game-oauth';

export interface GameOAuthClientRecord {
  clientId: string;
  audience: string;
  redirectUri: string;
  clientSecretHash: string;
  enabled: boolean;
}

export interface IssueGameAuthorizationCodeParams {
  accountId: string;
  clientId: string;
  codeHash: string;
  codeChallenge: string;
  sourceSessionHash: string;
  databaseUrl?: string;
}

export type IssueGameAuthorizationCodeResult =
  | {
      success: true;
      redirectUri: string;
      audience: string;
      expiresAt: string | Date;
    }
  | { success: false; reason: 'session_invalid' | 'client_disabled' | 'client_not_found' };

export interface ExchangeGameAuthorizationCodeParams {
  authenticatedClientId: string;
  codeHash: string;
  redirectUri: string;
  computedCodeChallenge: string;
  newTokenHash: string;
  databaseUrl?: string;
}

export type ExchangeGameAuthorizationCodeResult =
  | {
      success: true;
      subjectId: string;
      audience: string;
      expiresAt: string | Date;
    }
  | { success: false; reason: 'invalid_grant' };

export interface IntrospectGameAccessTokenParams {
  authenticatedClientId: string;
  tokenHash: string;
  databaseUrl?: string;
}

export type IntrospectGameAccessTokenResult =
  | {
      active: true;
      clientId: string;
      audience: string;
      subject: string;
      issuedAt: string | Date;
      expiresAt: string | Date;
    }
  | { active: false };

export interface RevokeGameAccessTokenParams {
  authenticatedClientId: string;
  tokenHash: string;
  databaseUrl?: string;
}

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

export async function getGameOAuthClient(
  clientId: string,
  databaseUrl?: string
): Promise<GameOAuthClientRecord | null> {
  if (!isValidGameClientId(clientId)) {
    return null;
  }

  const sql = getDbClient(databaseUrl);
  const mode = getAuthConfig().mode;

  const rows = (await sql`
    SELECT
        client_id,
        audience,
        redirect_uri,
        client_secret_hash,
        enabled
    FROM public.game_oauth_clients
    WHERE client_id = ${clientId};
  `) as Array<{
    client_id: string;
    audience: string;
    redirect_uri: string;
    client_secret_hash: string;
    enabled: boolean;
  }>;

  if (rows.length === 0) {
    return null;
  }

  if (rows.length === 1) {
    const row = rows[0];
    if (
      isValidGameClientId(row.client_id) &&
      isValidGameAudience(row.audience, row.client_id) &&
      isValidGameRedirectUri(row.redirect_uri, mode) &&
      isValidSha256Hex(row.client_secret_hash) &&
      typeof row.enabled === 'boolean'
    ) {
      return {
        clientId: row.client_id,
        audience: row.audience,
        redirectUri: row.redirect_uri,
        clientSecretHash: row.client_secret_hash,
        enabled: row.enabled,
      };
    }
    throw new Error('Malformed database query result shape for game oauth client');
  }

  throw new Error('Malformed database query result shape for game oauth client');
}

export async function authenticateGameClient(
  clientId: string,
  clientSecret: string,
  databaseUrl?: string
): Promise<GameOAuthClientRecord | null> {
  const client = await getGameOAuthClient(clientId, databaseUrl);
  const secretValid = verifyClientSecret(
    clientSecret,
    client ? client.clientSecretHash : '0000000000000000000000000000000000000000000000000000000000000000'
  );

  if (!client || !client.enabled || !secretValid) {
    return null;
  }

  return client;
}

export async function issueGameAuthorizationCode(
  params: IssueGameAuthorizationCodeParams
): Promise<IssueGameAuthorizationCodeResult> {
  const { accountId, clientId, codeHash, codeChallenge, sourceSessionHash, databaseUrl } = params;

  if (
    !isValidUuid(accountId) ||
    !isValidGameClientId(clientId) ||
    !isValidSha256Hex(codeHash) ||
    !isValidGamePkceChallenge(codeChallenge) ||
    !isValidSha256Hex(sourceSessionHash)
  ) {
    throw new Error('Invalid input formats for game authorization code issuance');
  }

  const sql = getDbClient(databaseUrl);
  const mode = getAuthConfig().mode;

  const rows = (await sql`
    WITH verified_session AS (
        SELECT s.account_id, s.token_hash AS source_session_hash
        FROM public.sessions s
        JOIN public.accounts a ON s.account_id = a.id
        WHERE s.token_hash = ${sourceSessionHash}
          AND s.account_id = ${accountId}
          AND s.expires_at > NOW()
          AND a.access_status = 'active'
          AND a.membership_status = 'eligible'
          AND a.membership_checked_at + INTERVAL '24 hours' > NOW()
    ),
    verified_client AS (
        SELECT client_id, redirect_uri, audience
        FROM public.game_oauth_clients
        WHERE client_id = ${clientId}
          AND enabled = true
    )
    INSERT INTO public.game_authorization_codes (
        account_id,
        client_id,
        code_hash,
        redirect_uri,
        audience,
        code_challenge,
        source_session_hash,
        created_at,
        expires_at,
        consumed_at
    )
    SELECT
        vs.account_id,
        vc.client_id,
        ${codeHash},
        vc.redirect_uri,
        vc.audience,
        ${codeChallenge},
        vs.source_session_hash,
        NOW(),
        NOW() + INTERVAL '60 seconds',
        NULL
    FROM verified_session vs
    CROSS JOIN verified_client vc
    ON CONFLICT (account_id, client_id) DO UPDATE
    SET
        code_hash = EXCLUDED.code_hash,
        redirect_uri = EXCLUDED.redirect_uri,
        audience = EXCLUDED.audience,
        code_challenge = EXCLUDED.code_challenge,
        source_session_hash = EXCLUDED.source_session_hash,
        created_at = EXCLUDED.created_at,
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    RETURNING
        game_authorization_codes.account_id,
        game_authorization_codes.redirect_uri,
        game_authorization_codes.audience,
        game_authorization_codes.expires_at;
  `) as Array<{
    account_id: string;
    redirect_uri: string;
    audience: string;
    expires_at: string | Date;
  }>;

  if (rows.length === 1) {
    const row = rows[0];
    if (
      isValidUuid(row.account_id) &&
      isValidGameRedirectUri(row.redirect_uri, mode) &&
      isValidGameAudience(row.audience, clientId) &&
      isValidTimestamp(row.expires_at)
    ) {
      return {
        success: true,
        redirectUri: row.redirect_uri,
        audience: row.audience,
        expiresAt: row.expires_at,
      };
    }
    throw new Error('Malformed database query result shape for game authorization code issuance');
  }

  if (rows.length === 0) {
    return { success: false, reason: 'session_invalid' };
  }

  throw new Error('Malformed database query result shape for game authorization code issuance');
}

export async function exchangeGameAuthorizationCode(
  params: ExchangeGameAuthorizationCodeParams
): Promise<ExchangeGameAuthorizationCodeResult> {
  const {
    authenticatedClientId,
    codeHash,
    redirectUri,
    computedCodeChallenge,
    newTokenHash,
    databaseUrl,
  } = params;

  if (
    !isValidGameClientId(authenticatedClientId) ||
    !isValidSha256Hex(codeHash) ||
    !isValidGamePkceChallenge(computedCodeChallenge) ||
    !isValidSha256Hex(newTokenHash)
  ) {
    throw new Error('Invalid input formats for game authorization code exchange');
  }

  const sql = getDbClient(databaseUrl);

  const rows = (await sql`
    WITH verified_client AS (
        SELECT client_id, audience
        FROM public.game_oauth_clients
        WHERE client_id = ${authenticatedClientId}
          AND enabled = true
    ),
    consume_code AS (
        UPDATE public.game_authorization_codes gac
        SET consumed_at = NOW()
        FROM verified_client vc
        WHERE gac.code_hash = ${codeHash}
          AND gac.client_id = vc.client_id
          AND gac.redirect_uri = ${redirectUri}
          AND gac.code_challenge = ${computedCodeChallenge}
          AND gac.audience = vc.audience
          AND gac.consumed_at IS NULL
          AND gac.expires_at > NOW()
        RETURNING gac.account_id, gac.client_id, gac.audience, gac.source_session_hash
    ),
    verify_source_session AS (
        SELECT
            cc.account_id,
            cc.client_id,
            cc.audience,
            cc.source_session_hash,
            s.expires_at AS session_expires_at
        FROM consume_code cc
        JOIN public.sessions s ON s.account_id = cc.account_id AND s.token_hash = cc.source_session_hash
        JOIN public.accounts a ON a.id = cc.account_id
        WHERE s.expires_at > NOW()
          AND a.access_status = 'active'
          AND a.membership_status = 'eligible'
          AND a.membership_checked_at + INTERVAL '24 hours' > NOW()
    ),
    inserted_subject AS (
        INSERT INTO public.game_oauth_subjects (client_id, account_id)
        SELECT vss.client_id, vss.account_id
        FROM verify_source_session vss
        ON CONFLICT (client_id, account_id) DO NOTHING
        RETURNING client_id, account_id, subject_id
    ),
    resolved_subject AS (
        SELECT isub.subject_id
        FROM inserted_subject isub
        UNION ALL
        SELECT sub.subject_id
        FROM verify_source_session vss
        JOIN public.game_oauth_subjects sub ON sub.client_id = vss.client_id AND sub.account_id = vss.account_id
        WHERE NOT EXISTS (SELECT 1 FROM inserted_subject)
    ),
    upsert_token AS (
        INSERT INTO public.game_access_tokens (
            account_id,
            client_id,
            token_hash,
            audience,
            source_session_hash,
            created_at,
            expires_at
        )
        SELECT
            vss.account_id,
            vss.client_id,
            ${newTokenHash},
            vss.audience,
            vss.source_session_hash,
            NOW(),
            LEAST(NOW() + INTERVAL '24 hours', vss.session_expires_at)
        FROM verify_source_session vss
        ON CONFLICT (account_id, client_id) DO UPDATE
        SET
            token_hash = EXCLUDED.token_hash,
            audience = EXCLUDED.audience,
            source_session_hash = EXCLUDED.source_session_hash,
            created_at = EXCLUDED.created_at,
            expires_at = EXCLUDED.expires_at
        RETURNING game_access_tokens.token_hash, game_access_tokens.expires_at
    )
    SELECT
        vss.audience,
        rs.subject_id,
        ut.expires_at
    FROM verify_source_session vss
    CROSS JOIN resolved_subject rs
    CROSS JOIN upsert_token ut;
  `) as Array<{
    audience: string;
    subject_id: string;
    expires_at: string | Date;
  }>;

  if (rows.length === 1) {
    const row = rows[0];
    if (
      isValidUuid(row.subject_id) &&
      isValidGameAudience(row.audience, authenticatedClientId) &&
      isValidTimestamp(row.expires_at)
    ) {
      return {
        success: true,
        subjectId: row.subject_id,
        audience: row.audience,
        expiresAt: row.expires_at,
      };
    }
    throw new Error('Malformed database query result shape for game token exchange');
  }

  if (rows.length === 0) {
    // Replay-revocation defense: if code was already consumed for this client/redirect/challenge, revoke active token
    await sql`
      WITH consumed_code AS (
          SELECT account_id, client_id
          FROM public.game_authorization_codes
          WHERE code_hash = ${codeHash}
            AND client_id = ${authenticatedClientId}
            AND redirect_uri = ${redirectUri}
            AND code_challenge = ${computedCodeChallenge}
            AND consumed_at IS NOT NULL
      )
      DELETE FROM public.game_access_tokens gat
      USING consumed_code cc
      WHERE gat.account_id = cc.account_id
        AND gat.client_id = cc.client_id;
    `;

    return { success: false, reason: 'invalid_grant' };
  }

  throw new Error('Malformed database query result shape for game token exchange');
}

export async function introspectGameAccessToken(
  params: IntrospectGameAccessTokenParams
): Promise<IntrospectGameAccessTokenResult> {
  const { authenticatedClientId, tokenHash, databaseUrl } = params;

  if (!isValidGameClientId(authenticatedClientId) || !isValidSha256Hex(tokenHash)) {
    return { active: false };
  }

  const sql = getDbClient(databaseUrl);

  const rows = (await sql`
    SELECT
        gat.client_id,
        gat.audience,
        sub.subject_id,
        gat.created_at,
        gat.expires_at
    FROM public.game_access_tokens gat
    JOIN public.game_oauth_clients goc ON goc.client_id = gat.client_id AND goc.enabled = true
    JOIN public.game_oauth_subjects sub ON sub.client_id = gat.client_id AND sub.account_id = gat.account_id
    JOIN public.sessions s ON s.account_id = gat.account_id AND s.token_hash = gat.source_session_hash
    JOIN public.accounts a ON a.id = gat.account_id
    WHERE gat.token_hash = ${tokenHash}
      AND gat.client_id = ${authenticatedClientId}
      AND gat.audience = goc.audience
      AND gat.expires_at > NOW()
      AND s.expires_at > NOW()
      AND a.access_status = 'active'
      AND a.membership_status = 'eligible'
      AND a.membership_checked_at + INTERVAL '24 hours' > NOW();
  `) as Array<{
    client_id: string;
    audience: string;
    subject_id: string;
    created_at: string | Date;
    expires_at: string | Date;
  }>;

  if (rows.length === 1) {
    const row = rows[0];
    if (
      isValidGameClientId(row.client_id) &&
      isValidGameAudience(row.audience, row.client_id) &&
      isValidUuid(row.subject_id) &&
      isValidTimestamp(row.created_at) &&
      isValidTimestamp(row.expires_at)
    ) {
      return {
        active: true,
        clientId: row.client_id,
        audience: row.audience,
        subject: row.subject_id,
        issuedAt: row.created_at,
        expiresAt: row.expires_at,
      };
    }
    throw new Error('Malformed database query result shape for game token introspection');
  }

  if (rows.length === 0) {
    return { active: false };
  }

  throw new Error('Malformed database query result shape for game token introspection');
}

export async function revokeGameAccessToken(
  params: RevokeGameAccessTokenParams
): Promise<{ success: true }> {
  const { authenticatedClientId, tokenHash, databaseUrl } = params;

  if (!isValidGameClientId(authenticatedClientId) || !isValidSha256Hex(tokenHash)) {
    return { success: true };
  }

  const sql = getDbClient(databaseUrl);

  await sql`
    DELETE FROM public.game_access_tokens
    WHERE token_hash = ${tokenHash}
      AND client_id = ${authenticatedClientId};
  `;

  return { success: true };
}
