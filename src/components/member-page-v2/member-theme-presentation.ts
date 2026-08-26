import type { CSSProperties } from "react";

import type { ResolvedMemberThemeAccent } from "@/lib/members/v2/themes";

/**
 * One application-owned bridge from reviewed registry tokens to local CSS.
 *
 * Tailwind's color utilities read the `--color-*` aliases declared by the
 * theme-surface class; documents never provide any value here. The order is
 * fixed so the inline style and the stylesheet form below stay identical.
 */
const MEMBER_THEME_CUSTOM_PROPERTIES = [
  ["--member-paper", "paper"],
  ["--member-ink", "ink"],
  ["--member-border", "border"],
  ["--member-muted", "muted"],
  ["--member-surface", "surface"],
  ["--member-decorative-red", "decorativeRed"],
  ["--member-interactive-blue", "interactiveBlue"],
] as const satisfies ReadonlyArray<
  readonly [string, keyof ResolvedMemberThemeAccent["tokens"]]
>;

/** Registry tokens are literal six-digit hex; nothing else may reach CSS. */
const REVIEWED_TOKEN = /^#[0-9a-f]{6}$/i;

export function memberThemeStyle(
  theme: ResolvedMemberThemeAccent,
): CSSProperties {
  return Object.fromEntries(
    MEMBER_THEME_CUSTOM_PROPERTIES.map(([property, token]) => [
      property,
      theme.tokens[token],
    ]),
  ) as CSSProperties;
}

/**
 * The same declarations as text, for the one stylesheet a member page installs.
 *
 * A page's theme has to reach `body` for the whole sheet to carry it, and no
 * element inside the page can hand a custom property to an ancestor. React
 * escapes the `style` prop for us but not stylesheet text, so every value is
 * checked against the shape the reviewed registry is allowed to hold. The
 * registry is a closed `as const` map, so this can only fail if someone edits
 * it into something that is no longer a colour — which is exactly when a page
 * should refuse to install it.
 */
export function memberThemeCustomPropertyText(
  theme: ResolvedMemberThemeAccent,
): string {
  return MEMBER_THEME_CUSTOM_PROPERTIES.map(([property, token]) => {
    const value = theme.tokens[token];
    if (!REVIEWED_TOKEN.test(value)) {
      throw new Error(
        `member theme ${theme.themeId}/${theme.accentId} has a non-reviewed ${token} token`,
      );
    }
    return `${property}:${value}`;
  }).join(";");
}
