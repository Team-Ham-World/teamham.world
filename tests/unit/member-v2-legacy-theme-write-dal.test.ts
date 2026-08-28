import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  currentAccount: vi.fn(),
  classifyThemeAccentPairForWrite: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => "development" }));
vi.mock("@/lib/auth/db", () => ({ getDbClient: () => mocks.query }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentVerifiedAccount: mocks.currentAccount,
}));

/**
 * The shipped registry has no legacy entries yet, so the DAL's legacy branch
 * is exercised by delegating to the real classifier by default and overriding
 * it per-test. The decision logic itself is proven against real fixtures in
 * member-v2-legacy-theme-write.test.ts; these tests prove the autosave wiring:
 * the guarded unchanged-legacy comparison runs inside the same atomic,
 * ownership-scoped statement.
 */
vi.mock("@/lib/members/v2/themes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/members/v2/themes")>();
  return {
    ...actual,
    classifyThemeAccentPairForWrite: mocks.classifyThemeAccentPairForWrite,
  };
});

import { autosaveOwnedMemberPageDraftV2 } from "@/lib/members/v2/dal";
import type { MemberPageDocumentV2 } from "@/lib/members/v2/document";
import type { MemberThemeWriteDecision } from "@/lib/members/v2/themes";

const OWNER = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  accessStatus: "active" as const,
  membershipStatus: "eligible" as const,
  expiresAt: new Date(Date.now() + 60_000),
  username: "hamfriend",
  siteRole: "member" as const,
};

const NOW = "2026-08-25T12:00:00.000Z";
const ORIGINAL_V2_ALLOWLIST = process.env.MEMBER_PAGE_V2_ALLOWLIST;
const ORIGINAL_V2_EDITOR_DISABLED = process.env.MEMBER_PAGE_V2_EDITOR_DISABLED;

const DOCUMENT: MemberPageDocumentV2 = {
  schemaVersion: 2,
  frame: {
    displayName: "HAM Friend",
    summary: "Makes tiny tools.",
    websiteUrl: "https://hamfriend.example",
    socialLinks: { github: "https://github.com/hamfriend" },
    portrait: null,
    theme: { id: "paper", accentId: "default" },
  },
  blocks: [],
};

const STORED_PAIR_JSON = '{"id":"paper","accentId":"default"}';

let actualClassifier: (
  themeId: unknown,
  accentId: unknown,
) => MemberThemeWriteDecision;

function queryText(callIndex: number): string {
  return mocks.query.mock.calls[callIndex][0].join("?");
}

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("member V2 autosave legacy theme write guard", () => {
  beforeAll(async () => {
    const actualThemes = await vi.importActual<
      typeof import("@/lib/members/v2/themes")
    >("@/lib/members/v2/themes");
    actualClassifier = actualThemes.classifyThemeAccentPairForWrite;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MEMBER_PAGE_V2_ALLOWLIST = "hamfriend";
    process.env.MEMBER_PAGE_V2_EDITOR_DISABLED = "false";
    mocks.currentAccount.mockResolvedValue(OWNER);
    mocks.classifyThemeAccentPairForWrite.mockImplementation(actualClassifier);
  });

  afterEach(() => {
    restoreEnvironmentVariable("MEMBER_PAGE_V2_ALLOWLIST", ORIGINAL_V2_ALLOWLIST);
    restoreEnvironmentVariable(
      "MEMBER_PAGE_V2_EDITOR_DISABLED",
      ORIGINAL_V2_EDITOR_DISABLED,
    );
  });

  it("keeps active-theme autosaves selectable and guarded in the same statement", async () => {
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      draft_rev: "8",
      draft_updated_at: NOW,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT,
    )).resolves.toEqual({
      status: "success",
      draftRev: 8,
      draftUpdatedAt: NOW,
    });

    const sql = queryText(0);
    const [, ...values] = mocks.query.mock.calls[0];
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(sql).toContain("?::text = 'selectable'");
    expect(sql).toContain(
      "OR page.draft_doc->'frame'->'theme' IS NOT DISTINCT FROM ?::jsonb",
    );
    expect(values).toContain("selectable");
    expect(values).toContain(STORED_PAIR_JSON);
    expect(sql).toContain("AND page.owner_account_id = ?");
  });

  it("returns typed invalid for a forged change onto a legacy pair", async () => {
    mocks.classifyThemeAccentPairForWrite.mockReturnValue({
      kind: "legacy-unchanged-only",
    });
    mocks.query.mockResolvedValueOnce([{
      outcome: "invalid",
      draft_rev: "7",
      draft_updated_at: null,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT,
    )).resolves.toEqual({ status: "invalid" });

    const sql = queryText(0);
    const [, ...values] = mocks.query.mock.calls[0];
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(sql).toContain(
      "OR page.draft_doc->'frame'->'theme' IS NOT DISTINCT FROM ?::jsonb",
    );
    expect(values).toContain(STORED_PAIR_JSON);
    expect(sql).toContain("?::text <> 'selectable'");
    expect(sql).toContain(
      "AND target.draft_doc->'frame'->'theme' IS DISTINCT FROM ?::jsonb",
    );
  });

  it("preserves an unchanged legacy pair through the guarded update", async () => {
    mocks.classifyThemeAccentPairForWrite.mockReturnValue({
      kind: "legacy-unchanged-only",
    });
    mocks.query.mockResolvedValueOnce([{
      outcome: "success",
      draft_rev: "8",
      draft_updated_at: NOW,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT,
    )).resolves.toEqual({
      status: "success",
      draftRev: 8,
      draftUpdatedAt: NOW,
    });

    const sql = queryText(0);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(sql.match(/UPDATE public\.member_pages/gu)).toHaveLength(1);
    expect(sql).toContain(
      "OR page.draft_doc->'frame'->'theme' IS NOT DISTINCT FROM ?::jsonb",
    );
    expect(sql).toContain("AND page.owner_account_id = ?");
  });

  it("classifies a stale revision as conflict before the legacy-pair guard as invalid", async () => {
    mocks.classifyThemeAccentPairForWrite.mockReturnValue({
      kind: "legacy-unchanged-only",
    });
    mocks.query.mockResolvedValueOnce([{
      outcome: "conflict",
      draft_rev: "8",
      draft_updated_at: null,
    }]);

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT,
    )).resolves.toEqual({ status: "conflict" });

    expect(queryText(0)).toMatch(
      /CASE\s+WHEN target\.draft_rev <> \? THEN 'conflict'\s+WHEN \?::text <> 'selectable'\s+AND target\.draft_doc->'frame'->'theme' IS DISTINCT FROM \?::jsonb\s+THEN 'invalid'\s+WHEN \(SELECT COUNT\(\*\) FROM matched_assets\) <> \?\s+THEN 'invalid'/u,
    );
  });

  it("returns typed invalid without querying when the write boundary rejects the pair", async () => {
    mocks.classifyThemeAccentPairForWrite.mockReturnValue({ kind: "rejected" });

    await expect(autosaveOwnedMemberPageDraftV2(
      "hamfriend",
      7,
      DOCUMENT,
    )).resolves.toEqual({ status: "invalid" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
