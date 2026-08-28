import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => "development" }));
vi.mock("@/lib/auth/db", () => ({ getDbClient: () => mocks.query }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentVerifiedAccount: mocks.currentAccount,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  publishMemberPageV2Action,
  unpublishMemberPageV2Action,
} from "@/app/m/[member]/v2-actions";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import { getOwnedMemberPageDraftV2 } from "@/lib/members/v2/dal";

const OWNER = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  accessStatus: "active" as const,
  membershipStatus: "eligible" as const,
  expiresAt: new Date(Date.now() + 60_000),
  username: "hamfriend",
  siteRole: "member" as const,
};

const PAGE_ID = "550e8400-e29b-41d4-a716-446655440010";
const ORIGINAL_V2_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_V2_EDITOR_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

const DOCUMENT: MemberPageDocumentV2 = {
  schemaVersion: 2,
  frame: {
    displayName: "HAM Friend",
    summary: "Makes tiny tools.",
    websiteUrl: null,
    socialLinks: {},
    portrait: null,
    theme: { id: "paper", accentId: "default" },
  },
  blocks: [],
};

/** What Postgres stores: `NOW()` keeps microseconds (timestamptz). */
const STORED_PUBLISHED_AT = "2026-08-20T09:00:00.123456Z";
const DRAFT_UPDATED_AT = "2026-08-25T12:00:00.000Z";
const UNPUBLISHED_AT = "2026-08-25T16:00:00.000Z";

function sqlTextOf(callIndex: number): string {
  return mocks.query.mock.calls[callIndex][0].join("?");
}

function guardValues(callIndex: number): unknown[] {
  const [, ...values] = mocks.query.mock.calls[callIndex];
  return values;
}

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * Models the neon/pg drivers: a raw `timestamptz` column is parsed into a
 * JavaScript `Date`, which keeps only milliseconds. Sub-millisecond precision
 * is lost exactly here unless the value was projected as text in SQL.
 */
function driverDate(timestamptz: string): Date {
  return new Date(timestamptz);
}

/**
 * Microsecond-exact instant key, modeling Postgres `timestamptz` equality
 * (`IS NOT DISTINCT FROM`). Unlike a JS `Date`, it never truncates.
 */
function instantKey(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::00)?)$/.exec(
      value,
    );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(6, "0")}`;
}

function conflictRow(): Array<Record<string, unknown>> {
  return [{ outcome: "conflict", slug: null, unpublished_at: null }];
}

function draftReadRow(sqlText: string): Array<Record<string, unknown>> {
  // `to_char(...)` projects the token as exact text; a raw column comes back
  // through the driver as a millisecond `Date`.
  return [{
    id: PAGE_ID,
    slug: "hamfriend",
    draft_doc: DOCUMENT,
    draft_rev: "7",
    is_published: true,
    moderation_hold: false,
    has_published_snapshot: true,
    draft_updated_at: driverDate(DRAFT_UPDATED_AT),
    published_at: sqlText.includes("to_char(")
      ? STORED_PUBLISHED_AT
      : driverDate(STORED_PUBLISHED_AT),
    unpublished_at: null,
  }];
}

/**
 * Stale-unpublish publication-token precision defect: Postgres keeps
 * microseconds in `published_at`, so the unpublish guard only accepts a token
 * that still carries the full server-issued precision. A token normalized
 * through a JavaScript `Date` (millisecond precision) makes the same tab's
 * immediate unpublish after its own successful publish fail as stale.
 */
describe("member V2 publication token precision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "false";
    mocks.currentAccount.mockResolvedValue(OWNER);
  });

  afterEach(() => {
    restoreEnvironmentVariable("MEMBER_PAGE_V2_ALLOWLIST", ORIGINAL_V2_ALLOWLIST);
    restoreEnvironmentVariable(
      "MEMBER_PAGE_V2_EDITOR_DISABLED",
      ORIGINAL_V2_EDITOR_DISABLED,
    );
  });

  it("issues the publish response token with the stored microseconds intact", async () => {
    mocks.query
      .mockImplementationOnce(() =>
        Promise.resolve([{
          draft_doc: DOCUMENT,
          draft_rev: 7,
          moderation_hold: false,
        }]),
      )
      .mockImplementationOnce((strings: TemplateStringsArray) => {
        const sqlText = strings.join("?");
        return Promise.resolve([{
          outcome: "success",
          slug: "hamfriend",
          draft_rev: 7,
          published_at: sqlText.includes("to_char(")
            ? STORED_PUBLISHED_AT
            : driverDate(STORED_PUBLISHED_AT),
        }]);
      });

    const result = await publishMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
    });

    expect(result.status).toBe("published");
    if (result.status !== "published") return;
    expect(result.publishedAt).toBe(STORED_PUBLISHED_AT);
    // The token is projected as text in SQL, never as a raw timestamptz that
    // the driver would parse into a millisecond Date.
    expect(sqlTextOf(1)).toContain("to_char(");
  });

  it("types both UNION arms of the publish outcome CTE as text for the token", async () => {
    mocks.query
      .mockImplementationOnce(() =>
        Promise.resolve([{
          draft_doc: DOCUMENT,
          draft_rev: 7,
          moderation_hold: false,
        }]),
      )
      .mockResolvedValueOnce([{
        outcome: "success",
        slug: "hamfriend",
        draft_rev: 7,
        published_at: STORED_PUBLISHED_AT,
      }]);

    await publishMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
    });

    const sql = sqlTextOf(1);
    expect(sql).toContain("UNION ALL");
    // The success arm projects the opaque token as text via to_char, so the
    // fallback arm's NULL must be text as well — a timestamptz NULL gives the
    // arms different column types and Postgres rejects the whole statement
    // with "UNION types text and timestamp with time zone cannot be matched".
    expect(sql).toContain("NULL::text AS published_at");
    expect(sql).not.toContain("NULL::timestamptz AS published_at");
  });

  it("lets the same tab that published immediately unpublish its own generation", async () => {
    // The guard compares instants exactly; only the exact stored generation
    // (microseconds included) may take the page down.
    mocks.query.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sqlText = strings.join("?");
      if (!sqlText.includes("IS NOT DISTINCT FROM")) {
        throw new Error(`unexpected query: ${sqlText.slice(0, 80)}`);
      }
      if (instantKey(values[values.length - 1]) === instantKey(STORED_PUBLISHED_AT)) {
        return Promise.resolve([{
          outcome: "success",
          slug: "hamfriend",
          unpublished_at: driverDate(UNPUBLISHED_AT),
        }]);
      }
      return Promise.resolve(conflictRow());
    });

    // Publish issues the generation for this tab...
    mocks.query
      .mockImplementationOnce(() =>
        Promise.resolve([{
          draft_doc: DOCUMENT,
          draft_rev: 7,
          moderation_hold: false,
        }]),
      )
      .mockImplementationOnce((strings: TemplateStringsArray) => {
        const sqlText = strings.join("?");
        return Promise.resolve([{
          outcome: "success",
          slug: "hamfriend",
          draft_rev: 7,
          published_at: sqlText.includes("to_char(")
            ? STORED_PUBLISHED_AT
            : driverDate(STORED_PUBLISHED_AT),
        }]);
      });
    const published = await publishMemberPageV2Action({
      slug: "hamfriend",
      expectedDraftRev: 7,
    });
    expect(published.status).toBe("published");
    const issuedToken = published.status === "published"
      ? published.publishedAt
      : null;

    // ...and its immediate unpublish must not be rejected as stale.
    const result = await unpublishMemberPageV2Action({
      slug: "hamfriend",
      expectedPublishedAt: issuedToken,
    });

    expect(result.status).toBe("unpublished");
    // The unpublish query is the third store call in this chain.
    expect(guardValues(2)).toContain(STORED_PUBLISHED_AT);
  });

  it("returns an existing published row's microsecond token verbatim on draft read", async () => {
    mocks.query.mockImplementationOnce((strings: TemplateStringsArray) =>
      Promise.resolve(draftReadRow(strings.join("?"))),
    );

    const result = await getOwnedMemberPageDraftV2("hamfriend");

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.publishedAt).toBe(STORED_PUBLISHED_AT);
    expect(sqlTextOf(0)).toContain("to_char(");
  });

  it("hands the guard the exact token without renormalizing it through a Date", async () => {
    mocks.query.mockResolvedValueOnce(conflictRow());

    await unpublishMemberPageV2Action({
      slug: "hamfriend",
      expectedPublishedAt: STORED_PUBLISHED_AT,
    });

    const values = guardValues(0);
    expect(values).toContain(STORED_PUBLISHED_AT);
    expect(values).not.toContain("2026-08-20T09:00:00.123Z");
  });

  it("accepts legacy millisecond tokens verbatim instead of reformatting them", async () => {
    mocks.query.mockResolvedValueOnce(conflictRow());

    await unpublishMemberPageV2Action({
      slug: "hamfriend",
      expectedPublishedAt: "2026-08-20T09:00:00.123Z",
    });

    expect(guardValues(0)).toContain("2026-08-20T09:00:00.123Z");
  });

  it.each([
    ["more than six fractional digits", "2026-08-20T09:00:00.1234567Z"],
    ["an impossible calendar day", "2026-02-30T09:00:00.123456Z"],
    ["a Postgres text rendering with a space separator", "2026-08-20 09:00:00.123456Z"],
  ])("rejects a malformed token (%s) before the store", async (_label, token) => {
    const result = await unpublishMemberPageV2Action({
      slug: "hamfriend",
      expectedPublishedAt: token,
    });

    expect(result.status).toBe("invalid");
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
