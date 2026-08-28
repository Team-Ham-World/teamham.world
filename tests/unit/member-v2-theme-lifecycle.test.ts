import { describe, expect, it } from "vitest";

import { MEMBER_THEME_IDS } from "@/lib/members/v2/document";
import { parseMemberPageDocumentV2 } from "@/lib/members/v2/validation";
import {
  MEMBER_PAGE_THEME_REGISTRY,
  getDefaultEnabledThemeAccent,
  getEnabledMemberThemes,
  getRenderableMemberThemes,
  getSelectableMemberThemes,
  isRenderableMemberThemeDefinition,
  isRenderableThemeAccentPair,
  isSelectableMemberThemeDefinition,
  resolveEnabledThemeAccent,
  resolveRenderableThemeAccent,
  resolveSelectableThemeAccent,
  resolveThemeAccentFromDefinition,
  selectRenderableMemberThemes,
  selectSelectableMemberThemes,
  type ActiveMemberThemeDefinition,
  type LegacyMemberThemeDefinition,
  type RevokedMemberThemeDefinition,
} from "@/lib/members/v2/themes";
import { minimalMemberPageDocument } from "../fixtures/member-v2/documents";

/**
 * One fixture per lifecycle state. Tokens come from the reviewed registry so
 * the fixtures stay realistic without duplicating palettes.
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

describe("member V2 theme lifecycle", () => {
  it("keeps every current theme active, selectable, and renderable", () => {
    for (const themeId of MEMBER_THEME_IDS) {
      const definition = MEMBER_PAGE_THEME_REGISTRY[themeId];
      expect(definition.lifecycle, `${themeId} lifecycle`).toBe("active");
      expect(isSelectableMemberThemeDefinition(definition)).toBe(true);
      expect(isRenderableMemberThemeDefinition(definition)).toBe(true);
    }

    expect(getSelectableMemberThemes().map((theme) => theme.id)).toEqual([
      ...MEMBER_THEME_IDS,
    ]);
    expect(getRenderableMemberThemes().map((theme) => theme.id)).toEqual([
      ...MEMBER_THEME_IDS,
    ]);
  });

  it("resolves every active theme/accent pair through both resolutions", () => {
    for (const theme of getSelectableMemberThemes()) {
      for (const accentId of Object.keys(theme.accents)) {
        const expected = {
          themeId: theme.id,
          accentId,
        };
        expect(resolveSelectableThemeAccent(theme.id, accentId)).toMatchObject(
          expected,
        );
        expect(resolveRenderableThemeAccent(theme.id, accentId)).toMatchObject(
          expected,
        );
      }
      expect(
        resolveThemeAccentFromDefinition(theme, theme.defaultAccentId),
      ).toMatchObject({ themeId: theme.id, accentId: theme.defaultAccentId });
    }
  });

  it("keeps deprecated enabled aliases behavior-compatible", () => {
    expect(getEnabledMemberThemes()).toEqual(getSelectableMemberThemes());
    for (const theme of getSelectableMemberThemes()) {
      expect(
        resolveEnabledThemeAccent(theme.id, theme.defaultAccentId),
      ).toEqual(resolveRenderableThemeAccent(theme.id, theme.defaultAccentId));
      expect(getDefaultEnabledThemeAccent(theme.id)).toMatchObject({
        themeId: theme.id,
        accentId: theme.defaultAccentId,
      });
    }
    expect(resolveEnabledThemeAccent("nightshift", "default")).toBeNull();
  });

  it("omits legacy themes from the picker data while keeping them renderable", () => {
    const definitions = [ACTIVE_FIXTURE, LEGACY_FIXTURE, REVOKED_FIXTURE];

    expect(
      selectSelectableMemberThemes(definitions).map((theme) => theme.id),
    ).toEqual(["paper"]);
    expect(
      selectRenderableMemberThemes(definitions).map((theme) => theme.id),
    ).toEqual(["paper", "newsprint"]);
    expect(getSelectableMemberThemes().map((theme) => theme.id)).not.toContain(
      "nightshift",
    );
  });

  it("renders and validates legacy themes for stored documents without new selection", () => {
    expect(isSelectableMemberThemeDefinition(LEGACY_FIXTURE)).toBe(false);
    expect(isRenderableMemberThemeDefinition(LEGACY_FIXTURE)).toBe(true);

    expect(
      resolveThemeAccentFromDefinition(LEGACY_FIXTURE, "press-red"),
    ).toMatchObject({
      themeId: "newsprint",
      accentId: "press-red",
    });
    expect(
      resolveThemeAccentFromDefinition(
        LEGACY_FIXTURE,
        LEGACY_FIXTURE.defaultAccentId,
      ),
    ).not.toBeNull();
    expect(isRenderableThemeAccentPair(LEGACY_FIXTURE, "press-red")).toBe(true);
    expect(isRenderableThemeAccentPair(LEGACY_FIXTURE, "archive-blue")).toBe(
      false,
    );
  });

  it("rejects revoked themes everywhere without substituting another theme", () => {
    expect(isSelectableMemberThemeDefinition(REVOKED_FIXTURE)).toBe(false);
    expect(isRenderableMemberThemeDefinition(REVOKED_FIXTURE)).toBe(false);

    expect(resolveThemeAccentFromDefinition(REVOKED_FIXTURE, "soy-red")).toBe(
      null,
    );
    expect(resolveThemeAccentFromDefinition(REVOKED_FIXTURE, "indigo")).toBe(
      null,
    );
    expect(isRenderableThemeAccentPair(REVOKED_FIXTURE, "soy-red")).toBe(false);
    expect(selectRenderableMemberThemes([REVOKED_FIXTURE])).toEqual([]);
    expect(selectSelectableMemberThemes([REVOKED_FIXTURE])).toEqual([]);
  });

  it("fails closed on unknown pairs through every resolution entry point", () => {
    expect(resolveRenderableThemeAccent("nightshift", "default")).toBeNull();
    expect(resolveSelectableThemeAccent("nightshift", "default")).toBeNull();
    expect(resolveRenderableThemeAccent("paper", "missing")).toBeNull();
    expect(resolveSelectableThemeAccent("paper", "missing")).toBeNull();
    expect(resolveRenderableThemeAccent(null, undefined)).toBeNull();
  });

  it("keeps stored documents with renderable themes parsing and rejects unknown themes", () => {
    const stored = minimalMemberPageDocument();
    stored.frame.theme = { id: "paper", accentId: "default" };
    expect(parseMemberPageDocumentV2(stored)).toEqual({
      success: true,
      doc: stored,
    });

    const unknownTheme = {
      ...minimalMemberPageDocument(),
      frame: {
        ...minimalMemberPageDocument().frame,
        theme: { id: "nightshift", accentId: "default" },
      },
    };
    const result = parseMemberPageDocumentV2(unknownTheme);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.map((error) => error.path)).toContainEqual([
        "frame",
        "theme",
        "id",
      ]);
    }

    // The exact acceptance decision parseTheme applies to stored legacy and
    // revoked themes, proven at the definition level because the shipped
    // registry currently has no legacy or revoked entries.
    expect(isRenderableThemeAccentPair(LEGACY_FIXTURE, "press-red")).toBe(true);
    expect(isRenderableThemeAccentPair(REVOKED_FIXTURE, "soy-red")).toBe(false);
  });

  it("keeps every active registry entry consistent about its default accent", () => {
    for (const definition of getSelectableMemberThemes()) {
      expect(
        Object.hasOwn(definition.accents, definition.defaultAccentId),
        `${definition.id} default accent must exist`,
      ).toBe(true);
    }
    for (const definition of Object.values(MEMBER_PAGE_THEME_REGISTRY)) {
      const selectable = isSelectableMemberThemeDefinition(definition);
      const renderable = isRenderableMemberThemeDefinition(definition);
      if (selectable) expect(renderable).toBe(true);
      expect(["active", "legacy", "revoked"]).toContain(definition.lifecycle);
    }
  });
});
