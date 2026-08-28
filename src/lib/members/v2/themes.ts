import type { MemberThemeId } from "@/lib/members/v2/document";

export const PAPER_DEFAULT_ACCENT_ID = "default" as const;
export const NEWSPRINT_DEFAULT_ACCENT_ID = "press-red" as const;
export const BLUEPRINT_DEFAULT_ACCENT_ID = "technical-blue" as const;
export const RISO_DEFAULT_ACCENT_ID = "soy-red" as const;

export interface MemberThemeSemanticTokens {
  readonly paper: string;
  readonly ink: string;
  readonly border: string;
  readonly muted: string;
  readonly surface: string;
  readonly decorativeRed: string;
  readonly interactiveBlue: string;
}

export interface MemberThemeAccentDefinition {
  readonly label: string;
  readonly tokens: MemberThemeSemanticTokens;
}

/**
 * Theme lifecycle.
 *
 * - `active`: selectable in the editor picker and renderable everywhere.
 * - `legacy`: renderable and valid for stored documents, but omitted from the
 *   picker so it cannot be newly selected.
 * - `revoked`: rejected by validation and rendering everywhere (fail closed).
 *
 * Retiring a theme moves it to `legacy` so existing pages keep rendering.
 * Only a reviewed safety revocation moves a theme to `revoked`, and only
 * after every stored draft and published snapshot has been audited.
 */
export type MemberThemeLifecycle = "active" | "legacy" | "revoked";

interface MemberThemeDefinitionBase {
  readonly id: MemberThemeId;
  readonly label: string;
  readonly description: string;
}

export type ActiveMemberThemeDefinition = MemberThemeDefinitionBase & {
  readonly lifecycle: "active";
  readonly defaultAccentId: string;
  readonly accents: Readonly<Record<string, MemberThemeAccentDefinition>>;
};

export type LegacyMemberThemeDefinition = MemberThemeDefinitionBase & {
  readonly lifecycle: "legacy";
  readonly defaultAccentId: string;
  readonly accents: Readonly<Record<string, MemberThemeAccentDefinition>>;
};

export type RevokedMemberThemeDefinition = MemberThemeDefinitionBase & {
  readonly lifecycle: "revoked";
  readonly defaultAccentId: null;
  readonly accents: Readonly<Record<string, never>>;
};

/** Themes a stored document may render: `active` and `legacy`. */
export type RenderableMemberThemeDefinition =
  | ActiveMemberThemeDefinition
  | LegacyMemberThemeDefinition;

export type MemberThemeDefinition =
  | ActiveMemberThemeDefinition
  | LegacyMemberThemeDefinition
  | RevokedMemberThemeDefinition;

/**
 * Closed, reviewed theme registry.
 *
 * Documents store only the IDs below. Colors and labels remain application
 * owned so arbitrary or revoked values fail validation instead of becoming
 * member-authored presentation. Retired themes stay here as `legacy`; only a
 * reviewed revocation flips an entry to `revoked` after auditing stored docs.
 */
export const MEMBER_PAGE_THEME_REGISTRY = {
  paper: {
    id: "paper",
    label: "Paper",
    description: "HAM's warm cut-and-paste house style.",
    lifecycle: "active",
    defaultAccentId: PAPER_DEFAULT_ACCENT_ID,
    accents: {
      [PAPER_DEFAULT_ACCENT_ID]: {
        label: "House accents",
        tokens: {
          paper: "#f6f1e5",
          ink: "#1c1a17",
          border: "#1c1a17",
          muted: "#5c5648",
          surface: "#fffdf6",
          decorativeRed: "#d93625",
          interactiveBlue: "#1d4ed8",
        },
      },
    },
  },
  newsprint: {
    id: "newsprint",
    label: "Newsprint",
    description: "Crisp editorial rules on a soft monochrome sheet.",
    lifecycle: "active",
    defaultAccentId: NEWSPRINT_DEFAULT_ACCENT_ID,
    accents: {
      [NEWSPRINT_DEFAULT_ACCENT_ID]: {
        label: "Press red",
        tokens: {
          paper: "#f1efe8",
          ink: "#161616",
          border: "#161616",
          muted: "#55534e",
          surface: "#fbfaf4",
          decorativeRed: "#a62b24",
          interactiveBlue: "#8f2f27",
        },
      },
      "archive-blue": {
        label: "Archive blue",
        tokens: {
          paper: "#f1efe8",
          ink: "#161616",
          border: "#161616",
          muted: "#55534e",
          surface: "#fbfaf4",
          decorativeRed: "#245875",
          interactiveBlue: "#174f78",
        },
      },
    },
  },
  blueprint: {
    id: "blueprint",
    label: "Blueprint",
    description: "A light drafting grid with precise technical ink.",
    lifecycle: "active",
    defaultAccentId: BLUEPRINT_DEFAULT_ACCENT_ID,
    accents: {
      [BLUEPRINT_DEFAULT_ACCENT_ID]: {
        label: "Technical blue",
        tokens: {
          paper: "#edf5f3",
          ink: "#102f39",
          border: "#1e5261",
          muted: "#43636b",
          surface: "#f8fcfb",
          decorativeRed: "#0e5a70",
          interactiveBlue: "#0b4f75",
        },
      },
      "survey-orange": {
        label: "Survey orange",
        tokens: {
          paper: "#edf5f3",
          ink: "#102f39",
          border: "#1e5261",
          muted: "#43636b",
          surface: "#f8fcfb",
          decorativeRed: "#a34a1b",
          interactiveBlue: "#873817",
        },
      },
    },
  },
  riso: {
    id: "riso",
    label: "Riso",
    description: "Warm stock with a restrained halftone ink texture.",
    lifecycle: "active",
    defaultAccentId: RISO_DEFAULT_ACCENT_ID,
    accents: {
      [RISO_DEFAULT_ACCENT_ID]: {
        label: "Soy red",
        tokens: {
          paper: "#f6eedf",
          ink: "#251d1d",
          border: "#251d1d",
          muted: "#665651",
          surface: "#fff9ee",
          decorativeRed: "#ad2443",
          interactiveBlue: "#8b244b",
        },
      },
      indigo: {
        label: "Indigo",
        tokens: {
          paper: "#f6eedf",
          ink: "#251d1d",
          border: "#251d1d",
          muted: "#665651",
          surface: "#fff9ee",
          decorativeRed: "#41529a",
          interactiveBlue: "#33458a",
        },
      },
    },
  },
} as const satisfies Record<MemberThemeId, MemberThemeDefinition>;

export interface ResolvedMemberThemeAccent {
  themeId: MemberThemeId;
  themeLabel: string;
  accentId: string;
  accentLabel: string;
  tokens: MemberThemeSemanticTokens;
}

/**
 * Exhaustiveness guard for the theme lifecycle union. Adding a lifecycle
 * state without updating the switches below becomes a compile error.
 */
export function assertNeverMemberThemeLifecycle(definition: never): never {
  throw new Error(
    `Unhandled member theme lifecycle: ${String(definition)}.`,
  );
}

export function isMemberThemeId(value: string): value is MemberThemeId {
  return Object.hasOwn(MEMBER_PAGE_THEME_REGISTRY, value);
}

export function isSelectableMemberThemeDefinition(
  definition: MemberThemeDefinition,
): definition is ActiveMemberThemeDefinition {
  return definition.lifecycle === "active";
}

export function isRenderableMemberThemeDefinition(
  definition: MemberThemeDefinition,
): definition is RenderableMemberThemeDefinition {
  return definition.lifecycle === "active" || definition.lifecycle === "legacy";
}

/** Pure picker filter: keeps only themes that may be newly selected. */
export function selectSelectableMemberThemes(
  definitions: readonly MemberThemeDefinition[],
): readonly ActiveMemberThemeDefinition[] {
  return definitions.filter(isSelectableMemberThemeDefinition);
}

/** Pure renderability filter: keeps themes stored documents may render. */
export function selectRenderableMemberThemes(
  definitions: readonly MemberThemeDefinition[],
): readonly RenderableMemberThemeDefinition[] {
  return definitions.filter(isRenderableMemberThemeDefinition);
}

function getMemberThemeDefinitions(): readonly MemberThemeDefinition[] {
  return Object.values(MEMBER_PAGE_THEME_REGISTRY);
}

/** Picker data: `active` themes only. Legacy themes are omitted. */
export function getSelectableMemberThemes(): readonly ActiveMemberThemeDefinition[] {
  return selectSelectableMemberThemes(getMemberThemeDefinitions());
}

/** Themes a stored document may render: `active` and `legacy`. */
export function getRenderableMemberThemes(): readonly RenderableMemberThemeDefinition[] {
  return selectRenderableMemberThemes(getMemberThemeDefinitions());
}

/**
 * Typed registry lookup. Returns `null` for values outside the registry; the
 * union return type (not the `as const` literal type) is what lets callers
 * switch over the lifecycle exhaustively.
 */
export function getMemberThemeDefinition(
  themeId: string,
): MemberThemeDefinition | null {
  if (!isMemberThemeId(themeId)) return null;
  return MEMBER_PAGE_THEME_REGISTRY[themeId];
}

/**
 * Looks up a theme definition that a stored document may render. Returns
 * `null` for unknown and revoked themes so callers fail closed.
 */
export function getRenderableMemberThemeDefinition(
  themeId: string,
): RenderableMemberThemeDefinition | null {
  if (!isMemberThemeId(themeId)) return null;
  const definition = MEMBER_PAGE_THEME_REGISTRY[themeId];
  return isRenderableMemberThemeDefinition(definition) ? definition : null;
}

/**
 * Resolves an accent against a single definition. This is the one place that
 * turns a lifecycle into renderability, so tests can exercise every state
 * without mutating the registry.
 */
export function resolveThemeAccentFromDefinition(
  definition: MemberThemeDefinition,
  accentId: string,
): ResolvedMemberThemeAccent | null {
  switch (definition.lifecycle) {
    case "active":
    case "legacy": {
      if (!Object.hasOwn(definition.accents, accentId)) return null;
      const accent = definition.accents[accentId];
      if (!accent) return null;
      return {
        themeId: definition.id,
        themeLabel: definition.label,
        accentId,
        accentLabel: accent.label,
        tokens: accent.tokens,
      };
    }
    case "revoked":
      return null;
    default:
      return assertNeverMemberThemeLifecycle(definition);
  }
}

/**
 * The stored-document acceptance decision used by validation: `active` and
 * `legacy` pairs are valid when the accent exists; `revoked` always fails.
 */
export function isRenderableThemeAccentPair(
  definition: MemberThemeDefinition,
  accentId: unknown,
): boolean {
  switch (definition.lifecycle) {
    case "active":
    case "legacy":
      return (
        typeof accentId === "string" &&
        Object.hasOwn(definition.accents, accentId)
      );
    case "revoked":
      return false;
    default:
      return assertNeverMemberThemeLifecycle(definition);
  }
}

/**
 * Write-boundary predicate for new selections: only an `active` theme with an
 * existing accent may be newly chosen. Legacy pairs are not selectable and
 * must reach writes only through the guarded unchanged comparison in autosave
 * (`classifyThemeAccentPairForWrite`).
 */
export function isSelectableThemeAccentPair(
  definition: MemberThemeDefinition,
  accentId: unknown,
): boolean {
  switch (definition.lifecycle) {
    case "active":
      return (
        typeof accentId === "string" &&
        Object.hasOwn(definition.accents, accentId)
      );
    case "legacy":
    case "revoked":
      return false;
    default:
      return assertNeverMemberThemeLifecycle(definition);
  }
}

/**
 * Write-acceptance decision for a theme pair submitted through a mutation.
 *
 * This is deliberately narrower than the read/render acceptance
 * (`isRenderableThemeAccentPair`) that validation applies to stored
 * documents:
 *
 * - `selectable`: an active pair; may be written freely.
 * - `legacy-unchanged-only`: a legacy pair; may be written only when it
 *   exactly equals the pair already stored on the draft. The comparison runs
 *   inside the guarded autosave statement so it stays atomic with the write.
 * - `rejected`: revoked or otherwise unknown pairs; never writable.
 */
export type MemberThemeWriteDecision =
  | { readonly kind: "selectable" }
  | { readonly kind: "legacy-unchanged-only" }
  | { readonly kind: "rejected" };

function classifyThemeAccentPairForWriteFromLifecycle(
  definition: MemberThemeDefinition,
  accentId: unknown,
): MemberThemeWriteDecision {
  switch (definition.lifecycle) {
    case "active":
      return isSelectableThemeAccentPair(definition, accentId)
        ? { kind: "selectable" }
        : { kind: "rejected" };
    case "legacy":
      return isRenderableThemeAccentPair(definition, accentId)
        ? { kind: "legacy-unchanged-only" }
        : { kind: "rejected" };
    case "revoked":
      return { kind: "rejected" };
    default:
      return assertNeverMemberThemeLifecycle(definition);
  }
}

/** Definition-level write-acceptance classification. */
export function classifyThemeAccentPairForWriteFromDefinition(
  definition: MemberThemeDefinition,
  accentId: unknown,
): MemberThemeWriteDecision {
  return classifyThemeAccentPairForWriteFromLifecycle(definition, accentId);
}

/** Registry-level write-acceptance classification for submitted theme pairs. */
export function classifyThemeAccentPairForWrite(
  themeId: unknown,
  accentId: unknown,
): MemberThemeWriteDecision {
  if (typeof themeId !== "string" || !isMemberThemeId(themeId)) {
    return { kind: "rejected" };
  }
  return classifyThemeAccentPairForWriteFromLifecycle(
    MEMBER_PAGE_THEME_REGISTRY[themeId],
    accentId,
  );
}

function resolveThemeAccentWithLifecycle(
  themeId: unknown,
  accentId: unknown,
  lifecycleAccepts: (definition: MemberThemeDefinition) => boolean,
): ResolvedMemberThemeAccent | null {
  if (typeof themeId !== "string" || typeof accentId !== "string") return null;
  if (!isMemberThemeId(themeId)) return null;
  const definition = MEMBER_PAGE_THEME_REGISTRY[themeId];
  if (!lifecycleAccepts(definition)) return null;
  return resolveThemeAccentFromDefinition(definition, accentId);
}

/** Resolution for new selections: `active` themes only. */
export function resolveSelectableThemeAccent(
  themeId: unknown,
  accentId: unknown,
): ResolvedMemberThemeAccent | null {
  return resolveThemeAccentWithLifecycle(
    themeId,
    accentId,
    isSelectableMemberThemeDefinition,
  );
}

/** Resolution for stored documents and rendering: `active` and `legacy`. */
export function resolveRenderableThemeAccent(
  themeId: unknown,
  accentId: unknown,
): ResolvedMemberThemeAccent | null {
  return resolveThemeAccentWithLifecycle(
    themeId,
    accentId,
    isRenderableMemberThemeDefinition,
  );
}

export function isSelectableThemeAccent(
  themeId: unknown,
  accentId: unknown,
): boolean {
  return resolveSelectableThemeAccent(themeId, accentId) !== null;
}

export function isRenderableThemeAccent(
  themeId: unknown,
  accentId: unknown,
): boolean {
  return resolveRenderableThemeAccent(themeId, accentId) !== null;
}

/** Default accent of a theme a stored document may render. */
export function getDefaultRenderableThemeAccent(
  themeId: unknown,
): ResolvedMemberThemeAccent | null {
  if (typeof themeId !== "string") return null;
  const definition = getRenderableMemberThemeDefinition(themeId);
  if (!definition) return null;
  return resolveThemeAccentFromDefinition(definition, definition.defaultAccentId);
}

/** Default accent of a theme that may be newly selected. */
export function getDefaultSelectableThemeAccent(
  themeId: unknown,
): ResolvedMemberThemeAccent | null {
  if (typeof themeId !== "string" || !isMemberThemeId(themeId)) return null;
  const definition = MEMBER_PAGE_THEME_REGISTRY[themeId];
  if (!isSelectableMemberThemeDefinition(definition)) return null;
  return resolveThemeAccentFromDefinition(definition, definition.defaultAccentId);
}

/**
 * @deprecated Backward-compatible alias for `getSelectableMemberThemes`.
 * Pickers must use selectable themes; stored-document iteration should use
 * `getRenderableMemberThemes` so legacy themes are not skipped.
 */
export function getEnabledMemberThemes(): readonly ActiveMemberThemeDefinition[] {
  return getSelectableMemberThemes();
}

/**
 * @deprecated Backward-compatible alias for `resolveRenderableThemeAccent`.
 * Use `resolveRenderableThemeAccent` for stored documents and public
 * rendering, or `resolveSelectableThemeAccent` for new selections.
 */
export function resolveEnabledThemeAccent(
  themeId: unknown,
  accentId: unknown,
): ResolvedMemberThemeAccent | null {
  return resolveRenderableThemeAccent(themeId, accentId);
}

/**
 * @deprecated Backward-compatible alias for `isRenderableThemeAccent`.
 */
export function isEnabledThemeAccent(
  themeId: unknown,
  accentId: unknown,
): boolean {
  return resolveRenderableThemeAccent(themeId, accentId) !== null;
}

/**
 * @deprecated Backward-compatible alias for `getDefaultRenderableThemeAccent`.
 */
export function getDefaultEnabledThemeAccent(
  themeId: unknown,
): ResolvedMemberThemeAccent | null {
  return getDefaultRenderableThemeAccent(themeId);
}
