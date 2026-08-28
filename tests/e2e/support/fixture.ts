/* eslint-disable react-hooks/rules-of-hooks -- Playwright test fixtures
 * receive a lifecycle `use` parameter; this is not a React hook. */

/**
 * Guarded browser-E2E fixture: one real account, one real session, one real
 * member page with a V2 draft, seeded into the disposable Postgres through
 * the same tables and token rules the application uses.
 *
 * Fixture data shape (fixed, idempotent, deterministically cleaned):
 * - account:  public.accounts row, discord_user_id 990000000000000901,
 *             discord_username "e2e.playwright", eligible + active,
 *             membership_checked_at NOW().
 * - session:  token from the real generateSessionToken(), stored through the
 *             real login CTE and the real hashSessionToken(). The raw token
 *             becomes the real `__Host-session` cookie in the browser; the
 *             server verifies it the ordinary way. There is no bypass.
 * - page:     public.member_pages row with slug "e2e-editor" owned by the
 *             fixture account, a valid MemberPageDocumentV2 draft
 *             (schemaVersion 2) with two blocks, draft_rev 0, unpublished,
 *             no published snapshot. Seeding stays inside the runtime role's
 *             column grants; the page id comes from the database default.
 * - assets:   never seeded. They exist only after the real browser upload
 *             path (allocate -> presigned PUT -> finalize) runs in a test.
 *
 * Cleanup data shape (named contract, exercised by unit tests):
 * - FixtureOwnedAssetObject { assetId, objectKey }: one storage object the
 *   fixture account owns, enumerated from public.member_page_assets through
 *   the fixture account identity BEFORE any row is deleted.
 * - FixtureQueryable: minimal `{ query }` seam over the owner/runtime pools.
 * - FixtureStorageObjectDeleter { deleteObject(objectKey) }: the only way
 *   bytes leave storage during cleanup.
 * - FixtureCleanupError: thrown, with the exact object keys, when uploaded
 *   bytes cannot be removed. The run fails precisely instead of silently
 *   orphaning bytes.
 *
 * Cleanup behavior:
 * - Runs in `finally`, so a failing test never skips teardown.
 * - Deletion is scoped through the fixture account identity
 *   (accounts.discord_user_id -> accounts.id -> owner_account_id), never
 *   through the page slug alone, and never touches another account's rows.
 * - Uploaded object bytes for the enumerated fixture-owned keys are deleted
 *   from the approved local storage origin; each key is re-validated with the
 *   application's own object-key rules before any DELETE is signed. Any
 *   failure throws FixtureCleanupError naming the unremoved keys.
 *
 * The application runtime role has no DELETE on member_pages/accounts, so
 * row cleanup uses the guarded owner-role URL; both database URLs pass the
 * disposable-database validation.
 */

import { AwsClient } from "aws4fetch";
import { Pool } from "pg";
import { test as base, expect, type Page } from "@playwright/test";

import {
  generateSessionToken,
  hashSessionToken,
} from "../../../src/lib/auth/crypto";
import { SESSION_COOKIE_NAME } from "../../../src/lib/auth/http";
import {
  encodeR2ObjectKey,
  isValidR2ObjectKey,
} from "../../../src/lib/members/assets/config";
import type { MemberPageDocumentV2 } from "../../../src/lib/members/v2/document";
import {
  isLoopbackHost,
  resolveBaseUrl,
  describeRequirements,
  resolveStorageUrl,
} from "./environment";

export const E2E_DISCORD_USER_ID = "990000000000000901";
// Matches the accounts table username constraint (^ [A-Za-z0-9._]{2,32}$).
export const E2E_DISCORD_USERNAME = "e2e.playwright";
export const E2E_SLUG = "e2e-editor";
export const E2E_DISPLAY_NAME = "E2E Playwright Member";
export const E2E_SUMMARY = "Seeded by the browser E2E harness.";

/** A valid, minimal V2 document with two blocks so reorder flows have room. */
export function e2eMemberPageDocument(): MemberPageDocumentV2 {
  return {
    schemaVersion: 2,
    frame: {
      displayName: E2E_DISPLAY_NAME,
      summary: E2E_SUMMARY,
      websiteUrl: null,
      socialLinks: {},
      portrait: null,
      theme: { id: "paper", accentId: "default" },
    },
    blocks: [
      {
        id: "e2e-block-note",
        type: "calloutQuote",
        variant: "note",
        text: "First seeded block for ordering checks.",
        attribution: null,
      },
      {
        id: "e2e-block-links",
        type: "additionalLinks",
        variant: "list",
        links: [
          {
            id: "e2e-link-1",
            label: "E2E link",
            url: "https://example.com/e2e",
            description: null,
          },
        ],
      },
    ],
  };
}

export function editorPath(): string {
  return `/m/${E2E_SLUG}?edit=1`;
}

export function publicPath(): string {
  return `/m/${E2E_SLUG}`;
}

interface FixtureState {
  sessionToken: string;
}

export interface MemberFixture {
  sessionToken: string;
  slug: string;
  /** Editor URL for the seeded page. */
  editorUrl: string;
  /** Public URL for the seeded page. */
  publicUrl: string;
}

/** One storage object the fixture account owns (asset id plus object key). */
export interface FixtureOwnedAssetObject {
  assetId: string;
  objectKey: string;
}

/** Minimal database seam so cleanup is unit-testable without Postgres. */
export interface FixtureQueryable {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** The only path through which cleanup removes object bytes. */
export interface FixtureStorageObjectDeleter {
  deleteObject(objectKey: string): Promise<void>;
}

/**
 * Thrown when cleanup cannot complete: rows or uploaded bytes would be
 * orphaned. Names exactly what is left behind. Never includes credentials.
 */
export class FixtureCleanupError extends Error {
  readonly objectKeys: readonly string[];

  constructor(message: string, objectKeys: readonly string[] = []) {
    super(message);
    this.name = "FixtureCleanupError";
    this.objectKeys = objectKeys;
  }
}

// Dev-only local MinIO harness values. The exact values are already committed
// for the local stack in infra/local-s3/compose.yaml and
// scripts/dev-vps-local.sh; they are loopback-bound development values, never
// production credentials, and are never written to logs or errors.
const LOCAL_STORAGE_ACCESS_KEY_ID = "teamhamlocalaccess";
const LOCAL_STORAGE_SECRET_ACCESS_KEY =
  "teamham-local-secret-key-12345678901234567890";
const DEFAULT_STORAGE_BUCKET = "teamham-member-assets-local";
// Object keys uploaded by the application always live under this prefix.
const FIXTURE_OBJECT_KEY_PREFIX = "member-page-assets/";

/**
 * Builds the storage-object deleter for fixture cleanup. It only ever talks
 * to the approved storage origin from resolveStorageUrl() (HTTPS loopback,
 * validated again here), signs DELETE requests with aws4fetch like the
 * application's own local storage flow, and re-validates every object key
 * with the application's own key rules before signing.
 */
export function createFixtureStorageObjectDeleter(
  approvedStorageUrl: string,
): FixtureStorageObjectDeleter {
  const storageBase = resolveStorageUrl();
  let parsed: URL;
  try {
    parsed = new URL(storageBase);
  } catch {
    throw new FixtureCleanupError(
      "Fixture storage cleanup refused: the approved storage URL is not a valid URL.",
    );
  }
  if (parsed.protocol !== "https:" || !isLoopbackHost(parsed.hostname)) {
    throw new FixtureCleanupError(
      "Fixture storage cleanup refused: object deletion only runs against the approved local HTTPS loopback storage origin.",
    );
  }
  if (storageBase !== approvedStorageUrl) {
    throw new FixtureCleanupError(
      "Fixture storage cleanup refused: the approved storage URL changed between allocation and cleanup.",
    );
  }
  const bucket = process.env.E2E_STORAGE_BUCKET ?? DEFAULT_STORAGE_BUCKET;
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new FixtureCleanupError(
      "Fixture storage cleanup refused: the configured bucket name is not a valid bucket name.",
    );
  }
  const client = new AwsClient({
    accessKeyId: LOCAL_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: LOCAL_STORAGE_SECRET_ACCESS_KEY,
    service: "s3",
    region: "us-east-1",
    retries: 1,
  });

  return {
    async deleteObject(objectKey: string): Promise<void> {
      if (
        !objectKey.startsWith(FIXTURE_OBJECT_KEY_PREFIX) ||
        !isValidR2ObjectKey(objectKey)
      ) {
        throw new FixtureCleanupError(
          `Fixture storage cleanup refused an unexpected object key, so it was not deleted: ${objectKey}`,
          [objectKey],
        );
      }
      const url = `${storageBase}/${bucket}/${encodeR2ObjectKey(objectKey)}`;
      let response: Response;
      try {
        const request = await client.sign(url, {
          method: "DELETE",
          aws: { service: "s3", region: "us-east-1", allHeaders: true },
        });
        response = await fetch(request);
      } catch {
        throw new FixtureCleanupError(
          `Fixture storage cleanup could not reach storage at ${storageBase} for object key: ${objectKey}`,
          [objectKey],
        );
      }
      // 404 counts as removed: cleanup is deterministic either way.
      if (!response.ok && response.status !== 404) {
        throw new FixtureCleanupError(
          `Fixture storage cleanup DELETE failed with status ${response.status} at ${storageBase} for object key: ${objectKey}`,
          [objectKey],
        );
      }
    },
  };
}

/** Adapts a real pg Pool to the cleanup seam. */
function poolAsQueryable(pool: Pool): FixtureQueryable {
  return {
    async query<T>(text: string, values?: readonly unknown[]) {
      const result = await pool.query(text, values ? [...values] : []);
      return { rows: result.rows as T[], rowCount: result.rowCount };
    },
  };
}

/**
 * Resolves the fixture account's identity (accounts.id) from the fixed
 * fixture Discord user id, or null when no fixture account row exists.
 */
async function resolveFixtureAccountId(
  db: FixtureQueryable,
): Promise<string | null> {
  const account = await db.query<{ id: string }>(
    `SELECT id FROM public.accounts WHERE discord_user_id = $1`,
    [E2E_DISCORD_USER_ID],
  );
  if (account.rowCount !== 1) return null;
  return account.rows[0].id;
}

/**
 * Enumerates every storage object the fixture account owns, through its
 * account identity. Must be called before any fixture row is deleted.
 * Throws FixtureCleanupError if a row cannot be interpreted, so cleanup
 * fails precisely instead of leaving bytes behind unknowingly.
 */
export async function collectFixtureOwnedAssetObjects(
  db: FixtureQueryable,
  accountId?: string,
): Promise<FixtureOwnedAssetObject[]> {
  const scopedAccountId = accountId ?? (await resolveFixtureAccountId(db));
  if (scopedAccountId === null) return [];
  const result = await db.query<{
    asset_id: unknown;
    object_key: unknown;
  }>(
    `SELECT a.id AS asset_id, a.object_key
       FROM public.member_page_assets AS a
       JOIN public.member_pages AS p ON p.id = a.member_page_id
      WHERE p.owner_account_id = $1::uuid`,
    [scopedAccountId],
  );
  return result.rows.map((row) => {
    if (
      typeof row.asset_id !== "string" ||
      typeof row.object_key !== "string"
    ) {
      throw new FixtureCleanupError(
        `Fixture cleanup found a member_page_assets row it cannot interpret (asset id: ${String(row.asset_id)}); refusing to delete rows or bytes blindly.`,
      );
    }
    return { assetId: row.asset_id, objectKey: row.object_key };
  });
}

/**
 * Removes exactly the fixture-owned state, in this order:
 * 1. resolve the fixture account identity (never the slug) — if the account
 *    is absent, nothing fixture-owned can exist (member_pages.owner_account_id
 *    is ON DELETE RESTRICT) and another account's rows are never touched;
 * 2. enumerate the fixture account's storage objects from the database;
 * 3. delete the enumerated asset rows, then the account's page(s), then the
 *    account (which cascades its session) — FK-safe order;
 * 4. delete the enumerated object bytes. Every failure is aggregated into
 *    one FixtureCleanupError naming the unremoved keys.
 */
export async function cleanFixture(
  db: FixtureQueryable,
  storage?: FixtureStorageObjectDeleter,
): Promise<void> {
  const accountId = await resolveFixtureAccountId(db);
  if (accountId === null) {
    // No fixture account: there is nothing fixture-owned to remove, and a
    // slug match belonging to another account must never be deleted.
    return;
  }

  const ownedObjects = await collectFixtureOwnedAssetObjects(db, accountId);

  if (ownedObjects.length > 0) {
    await db.query(
      `DELETE FROM public.member_page_assets WHERE id = ANY($1::uuid[])`,
      [ownedObjects.map((object) => object.assetId)],
    );
  }
  await db.query(
    `DELETE FROM public.member_pages WHERE owner_account_id = $1::uuid`,
    [accountId],
  );
  // Cascades the fixture session row.
  await db.query(`DELETE FROM public.accounts WHERE discord_user_id = $1`, [
    E2E_DISCORD_USER_ID,
  ]);

  if (storage === undefined || ownedObjects.length === 0) return;

  const unremovedKeys: string[] = [];
  const reasons: string[] = [];
  for (const object of ownedObjects) {
    try {
      await storage.deleteObject(object.objectKey);
    } catch (cause) {
      unremovedKeys.push(object.objectKey);
      reasons.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (unremovedKeys.length > 0) {
    throw new FixtureCleanupError(
      `Fixture cleanup left ${unremovedKeys.length} uploaded object(s) unremoved at the approved storage origin; the run fails instead of orphaning bytes. Unremoved object keys: ${unremovedKeys.join(", ")}. ${reasons.join(" ")}`,
      unremovedKeys,
    );
  }
}

export const test = base.extend<{ member: MemberFixture }>({
  // Test-scoped on purpose: every test starts from the same freshly seeded
  // private page, so no test can inherit another test's publication state.
  member: async ({}, use) => {
    const requirements = describeRequirements();
    if (requirements.missing.length > 0) {
      throw new Error(
        `Fixture requirements missing, the tests should have skipped: ${requirements.missing.join("; ")}`,
      );
    }

    const runtimePool = new Pool({
      connectionString: process.env.E2E_DATABASE_URL,
      max: 2,
    });
    const ownerPool = new Pool({
      connectionString: process.env.E2E_DATABASE_OWNER_URL,
      max: 2,
    });

    try {
      await runMemberFixtureLifecycle(
        poolAsQueryable(runtimePool),
        poolAsQueryable(ownerPool),
        use,
        createFixtureStorageObjectDeleter(resolveStorageUrl()),
      );
    } finally {
      await runtimePool.end().catch(() => {});
      await ownerPool.end().catch(() => {});
    }
  },
});

/**
 * Seeds the fixture, hands it to the test, and guarantees cleanup in
 * `finally` — a failing test never skips teardown. Cleanup failures (rows or
 * bytes that could not be removed) propagate and fail the run precisely.
 * Exported for focused unit tests of that lifecycle contract.
 */
export async function runMemberFixtureLifecycle<T>(
  runtimeDb: FixtureQueryable,
  ownerDb: FixtureQueryable,
  use: (fixture: MemberFixture) => Promise<T>,
  storage?: FixtureStorageObjectDeleter,
): Promise<T> {
  // Deterministic start: remove any previous copy of the fixture, then seed
  // exactly one fresh copy.
  await cleanFixture(ownerDb, storage);
  const sessionToken = await seedFixture(runtimeDb);
  try {
    return await use({
      sessionToken,
      slug: E2E_SLUG,
      editorUrl: editorPath(),
      publicUrl: publicPath(),
    });
  } finally {
    await cleanFixture(ownerDb, storage);
  }
}

/**
 * A context that is signed in as the fixture owner through the real
 * `__Host-session` cookie. No route, flag, or credential is bypassed.
 */
export async function ownerContext(
  browser: import("@playwright/test").Browser,
  sessionToken: string,
): Promise<import("@playwright/test").BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: sessionToken,
      url: resolveBaseUrl(),
      // Mirror the server cookie attributes: HttpOnly, Secure, SameSite=Lax,
      // Path=/ (implied by the cookie URL).
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return context;
}

/** Fresh cookie-free context for asserting signed-out public behavior. */
export async function anonymousContext(
  browser: import("@playwright/test").Browser,
): Promise<import("@playwright/test").BrowserContext> {
  return browser.newContext();
}

/** Opens the editor and resolves once hydration reports the saved state. */
export async function openEditor(page: Page): Promise<void> {
  await page.goto(editorPath());
  const state = page.locator("[data-autosave-state]");
  await expect(state).toHaveAttribute("data-autosave-state", "saved");
}

async function seedFixture(db: FixtureQueryable): Promise<string> {
  // Real session token generation and hashing from the application source.
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);

  // Column set and conflict clause mirror the application's own login path;
  // the runtime role cannot update access_status, so a suspended leftover row
  // would return zero rows here instead of being silently reactivated.
  const account = await db.query<{ id: string }>(
    `INSERT INTO public.accounts (
        discord_user_id,
        discord_username,
        membership_status,
        access_status,
        membership_checked_at
     ) VALUES ($1, $2, 'eligible', 'active', NOW())
     ON CONFLICT (discord_user_id) DO UPDATE
     SET discord_username = EXCLUDED.discord_username,
         membership_status = 'eligible',
         membership_checked_at = NOW(),
         updated_at = NOW()
     WHERE public.accounts.access_status = 'active'
     RETURNING id`,
    [E2E_DISCORD_USER_ID, E2E_DISCORD_USERNAME],
  );
  if (account.rowCount !== 1) {
    throw new Error(
      "Fixture account could not be seeded: a non-active account row already uses the fixture Discord ID.",
    );
  }
  const accountId = account.rows[0].id;

  // The same guarded login CTE the application issues sessions with: one
  // session per account, token stored only as its SHA-256 hash.
  const session = await db.query(
    `WITH upsert_session AS (
        INSERT INTO public.sessions (account_id, token_hash, created_at, expires_at)
        SELECT $1::uuid, $2, NOW(), NOW() + INTERVAL '24 hours'
        WHERE EXISTS (
            SELECT 1 FROM public.accounts
            WHERE id = $1::uuid
              AND access_status = 'active'
              AND membership_status = 'eligible'
        )
        ON CONFLICT (account_id) DO UPDATE
        SET token_hash = EXCLUDED.token_hash,
            created_at = EXCLUDED.created_at,
            expires_at = EXCLUDED.expires_at
        RETURNING account_id
     )
     SELECT account_id FROM upsert_session`,
    [accountId, tokenHash],
  );
  if (session.rowCount !== 1) {
    throw new Error("Fixture session could not be seeded.");
  }

  // Columns stay inside the runtime role's INSERT grants for member_pages
  // (id, draft_rev, and draft_updated_at come from their database defaults).
  await db.query(
    `INSERT INTO public.member_pages (
        owner_account_id,
        created_by_account_id,
        slug,
        display_name,
        blurb,
        draft_doc,
        is_published
     ) VALUES (
        $1::uuid, $1::uuid, $2, $3, $4, $5::jsonb, FALSE
     )`,
    [
      accountId,
      E2E_SLUG,
      E2E_DISPLAY_NAME,
      E2E_SUMMARY,
      JSON.stringify(e2eMemberPageDocument()),
    ],
  );

  return token;
}

export { expect };
export type { FixtureState };
