import { describe, expect, it } from "vitest";

import { resolveStorageUrl } from "../e2e/support/environment";
import {
  E2E_DISCORD_USER_ID,
  E2E_SLUG,
  FixtureCleanupError,
  cleanFixture,
  collectFixtureOwnedAssetObjects,
  createFixtureStorageObjectDeleter,
  runMemberFixtureLifecycle,
  type FixtureQueryable,
  type FixtureStorageObjectDeleter,
} from "../e2e/support/fixture";

/**
 * Focused regression checks for the browser-E2E fixture cleanup contract:
 * - cleanup runs in `finally` (a failing test never skips teardown);
 * - deletion is scoped through the fixture account identity, never the page
 *   slug alone, and never touches another account's rows;
 * - uploaded object bytes for fixture-owned keys are deleted, and any
 *   storage failure fails the run with a precise cleanup error instead of
 *   silently orphaning bytes.
 *
 * These tests run entirely against recorded fakes; no database or MinIO is
 * contacted.
 */

const ACCOUNT_ID = "0b9d6c1e-1111-4222-8333-444455556666";
const ASSET_ID_A = "1a1a1a1a-1111-4222-8333-444455556666";
const ASSET_ID_B = "2b2b2b2b-1111-4222-8333-444455556666";
const KEY_A = "member-page-assets/dirA/123-image-png-nonceA";
const KEY_B = "member-page-assets/dirB/456-image-png-nonceB";

interface RecordedQuery {
  text: string;
  values: readonly unknown[];
}

interface ScriptedResponse {
  match: RegExp;
  rows?: Array<Record<string, unknown>>;
  rowCount?: number | null;
}

function fakeDb(script: ScriptedResponse[] = []): FixtureQueryable & {
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    async query<T = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) {
      queries.push({ text, values: values ?? [] });
      const hit = script.find((entry) => entry.match.test(text));
      if (!hit) return { rows: [] as T[], rowCount: 0 };
      return {
        rows: (hit.rows ?? []) as T[],
        rowCount: hit.rowCount ?? (hit.rows ? hit.rows.length : 0),
      };
    },
  };
}

function recordingDeleter(
  failFor: string[] = [],
): FixtureStorageObjectDeleter & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    async deleteObject(objectKey: string) {
      if (failFor.includes(objectKey)) {
        throw new Error(`simulated storage outage for ${objectKey}`);
      }
      deleted.push(objectKey);
    },
  };
}

// Script that lets cleanFixture find the fixture account and one page with
// two assets. Every other statement (the DELETEs) gets the empty default.
const accountAndTwoAssets: ScriptedResponse[] = [
  {
    match: /SELECT id FROM public\.accounts WHERE discord_user_id/,
    rows: [{ id: ACCOUNT_ID }],
    rowCount: 1,
  },
  {
    match: /SELECT a\.id AS asset_id/,
    rows: [
      { asset_id: ASSET_ID_A, object_key: KEY_A },
      { asset_id: ASSET_ID_B, object_key: KEY_B },
    ],
    rowCount: 2,
  },
];

function queriesMatching(db: { queries: RecordedQuery[] }, pattern: RegExp) {
  return db.queries.filter((entry) => pattern.test(entry.text));
}

describe("fixture cleanup is account-scoped", () => {
  it("resolves the fixture account identity and deletes rows through it, never through the slug alone", async () => {
    const db = fakeDb(accountAndTwoAssets.map((entry) => ({ ...entry })));
    const storage = recordingDeleter();

    await cleanFixture(db, storage);

    // Identity comes first and uses the fixture Discord user id.
    expect(db.queries[0].text).toMatch(/SELECT id FROM public\.accounts/);
    expect(db.queries[0].values).toEqual([E2E_DISCORD_USER_ID]);

    // Asset enumeration is joined through the owner account id.
    const enumeration = queriesMatching(db, /SELECT a\.id AS asset_id/);
    expect(enumeration).toHaveLength(1);
    expect(enumeration[0].values).toEqual([ACCOUNT_ID]);
    expect(enumeration[0].text).toMatch(/p\.owner_account_id = \$1::uuid/);

    // Assets are deleted by the enumerated ids.
    const assetDelete = queriesMatching(
      db,
      /DELETE FROM public\.member_page_assets/,
    );
    expect(assetDelete).toHaveLength(1);
    expect(assetDelete[0].values).toEqual([
      [ASSET_ID_A, ASSET_ID_B],
    ]);

    // The page is deleted by owner account id, not by slug.
    const pageDelete = queriesMatching(db, /DELETE FROM public\.member_pages/);
    expect(pageDelete).toHaveLength(1);
    expect(pageDelete[0].values).toEqual([ACCOUNT_ID]);
    expect(pageDelete[0].text).toMatch(/owner_account_id = \$1::uuid/);

    // The account delete uses the fixture identity and cascades the session.
    const accountDelete = queriesMatching(
      db,
      /DELETE FROM public\.accounts/,
    );
    expect(accountDelete).toHaveLength(1);
    expect(accountDelete[0].values).toEqual([E2E_DISCORD_USER_ID]);

    // The fixture slug is never a deletion parameter: a slug match owned by
    // another account can never be deleted.
    expect(
      db.queries.some((entry) =>
        entry.values.flat().includes(E2E_SLUG),
      ),
    ).toBe(false);

    // Exactly the enumerated fixture-owned objects were removed.
    expect(storage.deleted).toEqual([KEY_A, KEY_B]);
  });

  it("does nothing when the fixture account is absent", async () => {
    const db = fakeDb();
    const storage = recordingDeleter();

    await cleanFixture(db, storage);

    expect(queriesMatching(db, /DELETE FROM/)).toHaveLength(0);
    expect(storage.deleted).toEqual([]);
  });
});

describe("fixture cleanup removes uploaded bytes or fails precisely", () => {
  it("deletes exactly the enumerated fixture-owned object keys", async () => {
    const db = fakeDb(accountAndTwoAssets.map((entry) => ({ ...entry })));
    const storage = recordingDeleter();

    await cleanFixture(db, storage);
    expect(storage.deleted).toEqual([KEY_A, KEY_B]);
  });

  it("fails with a precise cleanup error naming unremoved keys, instead of orphaning bytes silently", async () => {
    const db = fakeDb(accountAndTwoAssets.map((entry) => ({ ...entry })));
    const storage = recordingDeleter([KEY_B]);

    const error = await cleanFixture(db, storage).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(FixtureCleanupError);
    const cleanupError = error as FixtureCleanupError;
    expect(cleanupError.message).toContain(KEY_B);
    // The successfully removed key is not part of the failure report.
    expect(cleanupError.message).not.toContain(KEY_A);
    expect(cleanupError.objectKeys).toEqual([KEY_B]);
    expect(cleanupError.message).toContain("unremoved");
    // Credentials must never appear in cleanup errors.
    expect(cleanupError.message).not.toContain("teamham-local-secret-key");
    expect(cleanupError.message).not.toContain("teamhamlocalaccess");
    // The row cleanup still ran; only the bytes are (loudly) left behind.
    expect(queriesMatching(db, /DELETE FROM public\.member_page_assets/))
      .toHaveLength(1);
  });

  it("refuses object keys outside the application's key rules without signing a DELETE", async () => {
    process.env.E2E_STORAGE_URL = "https://localhost:9000";
    try {
      const deleter = createFixtureStorageObjectDeleter(
        "https://localhost:9000",
      );
      for (const hostile of [
        "elsewhere-bucket/evil",
        "member-page-assets/../escape",
        "member-page-assets/a\\b",
      ]) {
        await expect(deleter.deleteObject(hostile), hostile).rejects.toBeInstanceOf(
          FixtureCleanupError,
        );
      }
    } finally {
      delete process.env.E2E_STORAGE_URL;
    }
  });

  it("refuses to build a deleter for anything but the approved storage origin", () => {
    process.env.E2E_STORAGE_URL = "https://localhost:9000";
    try {
      expect(() =>
        createFixtureStorageObjectDeleter("https://localhost:9999"),
      ).toThrow(FixtureCleanupError);
      process.env.E2E_STORAGE_URL = "https://minio.example.com:9000";
      expect(() => resolveStorageUrl()).toThrow();
    } finally {
      delete process.env.E2E_STORAGE_URL;
    }
  });

  it("fails before deleting anything when an asset row cannot be interpreted", async () => {
    const db = fakeDb([
      {
        match: /SELECT id FROM public\.accounts WHERE discord_user_id/,
        rows: [{ id: ACCOUNT_ID }],
        rowCount: 1,
      },
      {
        match: /SELECT a\.id AS asset_id/,
        rows: [{ asset_id: ASSET_ID_A, object_key: 12345 }],
        rowCount: 1,
      },
    ]);

    await expect(collectFixtureOwnedAssetObjects(db, ACCOUNT_ID)).rejects.toBeInstanceOf(
      FixtureCleanupError,
    );
    await expect(cleanFixture(db)).rejects.toBeInstanceOf(FixtureCleanupError);
    // No blind deletes happened.
    expect(queriesMatching(db, /DELETE FROM/)).toHaveLength(0);
  });
});

describe("fixture lifecycle guarantees cleanup in finally", () => {
  const seedScript: ScriptedResponse[] = [
    {
      match: /SELECT id FROM public\.accounts WHERE discord_user_id/,
      rows: [{ id: ACCOUNT_ID }],
      rowCount: 1,
    },
    {
      match: /INSERT INTO public\.accounts/,
      rows: [{ id: ACCOUNT_ID }],
      rowCount: 1,
    },
    {
      match: /WITH upsert_session/,
      rows: [{ account_id: ACCOUNT_ID }],
      rowCount: 1,
    },
  ];

  it("cleans up even when the test body throws, and the original failure still propagates", async () => {
    const runtimeDb = fakeDb(seedScript.map((entry) => ({ ...entry })));
    const ownerDb = fakeDb(seedScript.map((entry) => ({ ...entry })));
    const storage = recordingDeleter();

    await expect(
      runMemberFixtureLifecycle(
        runtimeDb,
        ownerDb,
        async () => {
          throw new Error("test body failed");
        },
        storage,
      ),
    ).rejects.toThrow("test body failed");

    // Cleanup ran twice: once for the deterministic start, once in finally.
    expect(queriesMatching(ownerDb, /DELETE FROM public\.member_pages/))
      .toHaveLength(2);
    // The very last statement is the final account delete: teardown finished.
    expect(ownerDb.queries.at(-1)?.text).toMatch(
      /DELETE FROM public\.accounts/,
    );
    // Seeding happened exactly once.
    expect(queriesMatching(runtimeDb, /INSERT INTO public\.accounts/))
      .toHaveLength(1);
  });

  it("returns the seeded fixture and cleans up on success", async () => {
    const runtimeDb = fakeDb(seedScript.map((entry) => ({ ...entry })));
    const ownerDb = fakeDb(seedScript.map((entry) => ({ ...entry })));
    const storage = recordingDeleter();

    const fixture = await runMemberFixtureLifecycle(
      runtimeDb,
      ownerDb,
      async (member) => member,
      storage,
    );

    expect(fixture.sessionToken).toEqual(expect.any(String));
    expect(fixture.slug).toBe(E2E_SLUG);
    expect(queriesMatching(ownerDb, /DELETE FROM public\.member_pages/))
      .toHaveLength(2);
  });

  it("propagates a cleanup failure from the finally block instead of passing silently", async () => {
    const runtimeDb = fakeDb(seedScript.map((entry) => ({ ...entry })));
    const ownerDb = fakeDb([
      ...seedScript.map((entry) => ({ ...entry })),
      {
        match: /SELECT a\.id AS asset_id/,
        rows: [{ asset_id: ASSET_ID_A, object_key: KEY_A }],
        rowCount: 1,
      },
    ]);
    const storage = recordingDeleter([KEY_A]);

    await expect(
      runMemberFixtureLifecycle(
        runtimeDb,
        ownerDb,
        async (member) => member,
        storage,
      ),
    ).rejects.toBeInstanceOf(FixtureCleanupError);
  });
});
