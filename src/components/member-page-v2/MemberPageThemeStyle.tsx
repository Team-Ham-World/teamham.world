import type { ResolvedMemberThemeAccent } from "@/lib/members/v2/themes";

import { memberThemeCustomPropertyText } from "./member-theme-presentation";

/**
 * Hands a member's palette to the document root.
 *
 * A theme that stops at the article is not a theme; it is a coloured panel
 * sitting on HAM's own sheet, with the header, the footer, and every margin
 * around it still in house colours. Making the whole page carry it means the
 * values have to reach `body`, and nothing rendered inside the page can pass a
 * custom property upwards — hence one stylesheet rather than an inline style.
 *
 * `globals.css` is what acts on these: it adopts them as the Tailwind colour
 * tokens for any document showing a page-scope member surface. Only the public
 * view declares that scope, so the editor's workbench and the theme swatches
 * in its inspector keep HAM's palette while the canvas shows the member's.
 *
 * Keyed by theme and accent, so React installs one copy and reuses it across
 * navigations between pages that share a palette.
 */
export function MemberPageThemeStyle({
  theme,
}: {
  theme: ResolvedMemberThemeAccent;
}) {
  return (
    <style
      href={`member-theme-${theme.themeId}-${theme.accentId}`}
      precedence="medium"
    >
      {`:root{${memberThemeCustomPropertyText(theme)}}`}
    </style>
  );
}
