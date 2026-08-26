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

export type EnabledMemberThemeDefinition = {
  readonly id: MemberThemeId;
  readonly label: string;
  readonly description: string;
  readonly enabled: true;
  readonly defaultAccentId: string;
  readonly accents: Readonly<Record<string, MemberThemeAccentDefinition>>;
};

export type DisabledMemberThemeDefinition = {
  readonly id: MemberThemeId;
  readonly label: string;
  readonly description: string;
  readonly enabled: false;
  readonly defaultAccentId: null;
  readonly accents: Readonly<Record<string, never>>;
};

export type MemberThemeDefinition =
  | EnabledMemberThemeDefinition
  | DisabledMemberThemeDefinition;

/**
 * Closed, reviewed theme registry.
 *
 * Documents store only the IDs below. Colors and labels remain application
 * owned so arbitrary or retired values fail validation instead of becoming
 * member-authored presentation.
 */
export const MEMBER_PAGE_THEME_REGISTRY = {
  paper: {
    id: "paper",
    label: "Paper",
    description: "HAM's warm cut-and-paste house style.",
    enabled: true,
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
    enabled: true,
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
    enabled: true,
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
    enabled: true,
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

function isMemberThemeId(value: string): value is MemberThemeId {
  return Object.hasOwn(MEMBER_PAGE_THEME_REGISTRY, value);
}

export function getEnabledMemberThemes(): readonly EnabledMemberThemeDefinition[] {
  return Object.values(MEMBER_PAGE_THEME_REGISTRY).filter(
    (theme) => theme.enabled,
  ) as readonly EnabledMemberThemeDefinition[];
}

export function resolveEnabledThemeAccent(
  themeId: unknown,
  accentId: unknown,
): ResolvedMemberThemeAccent | null {
  if (typeof themeId !== "string" || typeof accentId !== "string") return null;
  if (!isMemberThemeId(themeId)) return null;

  const theme = MEMBER_PAGE_THEME_REGISTRY[themeId];
  if (!theme.enabled) return null;
  const accents = theme.accents as Readonly<
    Record<string, MemberThemeAccentDefinition>
  >;
  if (!Object.hasOwn(accents, accentId)) return null;
  const accent = accents[accentId];
  if (!accent) return null;

  return {
    themeId,
    themeLabel: theme.label,
    accentId,
    accentLabel: accent.label,
    tokens: accent.tokens,
  };
}

export function isEnabledThemeAccent(themeId: unknown, accentId: unknown): boolean {
  return resolveEnabledThemeAccent(themeId, accentId) !== null;
}

export function getDefaultEnabledThemeAccent(
  themeId: unknown,
): ResolvedMemberThemeAccent | null {
  if (typeof themeId !== "string" || !isMemberThemeId(themeId)) return null;
  const theme = MEMBER_PAGE_THEME_REGISTRY[themeId];
  if (!theme.enabled) return null;
  return resolveEnabledThemeAccent(themeId, theme.defaultAccentId);
}
