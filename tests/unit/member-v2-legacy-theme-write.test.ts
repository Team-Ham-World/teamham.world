import { describe, expect, it } from "vitest";

import { MEMBER_THEME_IDS } from "@/lib/members/v2/document";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";
import {
  MEMBER_PAGE_THEME_REGISTRY,
  classifyThemeAccentPairForWrite,
  classifyThemeAccentPairForWriteFromDefinition,
  isRenderableThemeAccentPair,
  type ActiveMemberThemeDefinition,
  type LegacyMemberThemeDefinition,
  type RevokedMemberThemeDefinition,
} from "@/lib/members/v2/themes";
import { minimalMemberPageDocument } from "../fixtures/member-v2/documents";

/**
 * One fixture per lifecycle state, mirroring member-v2-theme-lifecycle.test.ts.
 * The shipped registry currently has no legacy or revoked entries, so the
 * write boundary's legacy branch is proven at the definition level against
 * these fixtures.
 */
const ACTIVE_FIXTURE: ActiveMemberThemeDefinition = {
  id: "paper",
  label: "Paper",
  description: "Selectable and renderable.",
  lifecycle: "active",
  defaultAccentId: "default",
  accents: {
    default: {
      label: "House accents",
      tokens: MEMBER_PAGE_THEME_REGISTRY.paper.accents.default.tokens,
    },
  },
};

const LEGACY_FIXTURE: LegacyMemberThemeDefinition = {
  id: "newsprint",
  label: "Newsprint",
  description: "Retired from the picker; stored pages keep rendering.",
  lifecycle: "legacy",
  defaultAccentId: "press-red",
  accents: {
    "press-red": {
      label: "Press red",
      tokens: MEMBER_PAGE_THEME_REGISTRY.newsprint.accents["press-red"].tokens,
    },
  },
};

const REVOKED_FIXTURE: RevokedMemberThemeDefinition = {
  id: "riso",
  label: "Riso",
  description: "Revoked for safety; rejected everywhere.",
  lifecycle: "revoked",
  defaultAccentId: null,
  accents: {},
};

describe("member V2 legacy theme write boundary", () => {
  it("classifies every active registry pair as freely selectable", () => {
    for (const themeId of MEMBER_THEME_IDS) {
      const definition = MEMBER_PAGE_THEME_REGISTRY[themeId];
      expect(definition.lifecycle, `${themeId} lifecycle`).toBe("active");
      for (const accentId of Object.keys(definition.accents)) {
        expect(classifyThemeAccentPairForWrite(themeId, accentId)).toEqual({
          kind: "selectable",
        });
        expect(
          classifyThemeAccentPairForWriteFromDefinition(definition, accentId),
        ).toEqual({ kind: "selectable" });
      }
    }
    expect(
      classifyThemeAccentPairForWriteFromDefinition(ACTIVE_FIXTURE, "default"),
    ).toEqual({ kind: "selectable" });
  });

  it("rejects unknown accents and unknown or non-string theme IDs at the write boundary", () => {
    expect(classifyThemeAccentPairForWrite("paper", "missing")).toEqual({
      kind: "rejected",
    });
    expect(classifyThemeAccentPairForWrite("nightshift", "default")).toEqual({
      kind: "rejected",
    });
    expect(classifyThemeAccentPairForWrite(null, "default")).toEqual({
      kind: "rejected",
    });
    expect(classifyThemeAccentPairForWrite(7, "default")).toEqual({
      kind: "rejected",
    });
    expect(classifyThemeAccentPairForWrite("paper", 7)).toEqual({
      kind: "rejected",
    });
    expect(classifyThemeAccentPairForWrite(undefined, undefined)).toEqual({
      kind: "rejected",
    });
  });

  it("classifies a legacy pair as unchanged-only rather than selectable or rejected", () => {
    expect(
      classifyThemeAccentPairForWriteFromDefinition(LEGACY_FIXTURE, "press-red"),
    ).toEqual({ kind: "legacy-unchanged-only" });
    expect(
      classifyThemeAccentPairForWriteFromDefinition(
        LEGACY_FIXTURE,
        LEGACY_FIXTURE.defaultAccentId,
      ),
    ).toEqual({ kind: "legacy-unchanged-only" });
  });

  it("keeps a legacy pair renderable for reads but not freely writable", () => {
    // Read/render acceptance: stored documents with legacy pairs stay valid.
    expect(isRenderableThemeAccentPair(LEGACY_FIXTURE, "press-red")).toBe(true);
    // Write acceptance: the same pair may never be newly selected; it may
    // only pass the guarded unchanged comparison in autosave.
    expect(
      classifyThemeAccentPairForWriteFromDefinition(LEGACY_FIXTURE, "press-red"),
    ).not.toEqual({ kind: "selectable" });
    expect(
      classifyThemeAccentPairForWriteFromDefinition(LEGACY_FIXTURE, "press-red"),
    ).toEqual({ kind: "legacy-unchanged-only" });
  });

  it("rejects legacy pairs with unknown accents and revoked themes at the write boundary", () => {
    expect(
      classifyThemeAccentPairForWriteFromDefinition(
        LEGACY_FIXTURE,
        "archive-blue",
      ),
    ).toEqual({ kind: "rejected" });
    expect(
      classifyThemeAccentPairForWriteFromDefinition(REVOKED_FIXTURE, "soy-red"),
    ).toEqual({ kind: "rejected" });
    expect(
      classifyThemeAccentPairForWriteFromDefinition(ACTIVE_FIXTURE, "missing"),
    ).toEqual({ kind: "rejected" });
  });

  it("documents that the shipped registry currently exposes no legacy pairs", () => {
    for (const themeId of MEMBER_THEME_IDS) {
      const definition = MEMBER_PAGE_THEME_REGISTRY[themeId];
      for (const accentId of Object.keys(definition.accents)) {
        expect(classifyThemeAccentPairForWrite(themeId, accentId).kind).not.toBe(
          "legacy-unchanged-only",
        );
      }
    }
  });

  it("keeps read/render acceptance of stored documents unchanged", () => {
    const stored = minimalMemberPageDocument();
    stored.frame.theme = { id: "paper", accentId: "default" };
    expect(parseMemberPageDocumentV2(stored)).toEqual({
      success: true,
      doc: stored,
    });
  });
});
