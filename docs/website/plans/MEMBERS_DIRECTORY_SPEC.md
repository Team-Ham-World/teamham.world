# Members Directory Experience Specification

**Document Status**: IMPLEMENTED IN CODE / NOT YET DEPLOYED
**Route**: `teamham.world/members`
**Scope**: The public page for discovering published HAM members and opening their pages at `/m/<slug>`.

## 1. Goal

Create a playful, animated members directory that feels like exploring a living HAM scrapbook. Visitors should be able to understand who is in HAM, select a member without guessing how the interface works, and continue into that member's personalized page.

The experience must remain a directory first. Motion and visual variation support discovery; they must never obscure names, links, or navigation.

## 2. Experience concept: the living scrapbook

Published members appear as paper cards arranged in a loose collage over the existing paper background. The underlying structure remains a normal semantic list and responsive grid. Controlled rotation, tape marks, stamps, underlines, and offset shadows create the scrapbook effect without using a canvas or absolute-positioned hit targets.

Each card receives a deterministic visual signature derived from its slug. The signature may select from approved tilt, tape, stamp, and accent treatments, and repeats as a small motif on `/m/<slug>`. It must not imply rank, role, activity, or personality.

Use the existing HAM design system only:

- Bricolage Grotesque and Atkinson Hyperlegible;
- paper, ink, surface, muted, decorative red, and interactive blue tokens;
- near-zero corner radii, hard offset shadows, and restrained handmade marks; and
- the existing paper grain, with no additional full-page texture.

## 3. Page structure

1. **Header** — Site navigation and the title “Meet HAM,” followed by one short line explaining that HAM is a group of friends who make things.
2. **Find a member** — A clearly labeled name search. Filtering is client-side over already-public data and does not introduce tags, rankings, or popularity sorting.
3. **Member field** — All published members in stable order. Each entire card is a link to `/m/<slug>` and contains the display name, optional short introduction, and the visible action “Explore their page.”
4. **No-results state** — Preserve the search input and provide a clear reset action. Do not invent suggestions or member facts.

The homepage “Who” section becomes a compact preview that links to `/members`. `/members` is the complete public directory and the primary discovery route into member pages.

## 4. Motion and interaction

- On first reveal, cards settle into place with a short opacity-and-transform entrance. Stagger only the first visible group so the full directory is usable within 400 ms.
- Hover, keyboard focus, and press lift the selected card, straighten its tilt slightly, and shift its shadow over 150–250 ms.
- Selecting a card may use a shared visual transition into `/m/<slug>` when supported. Navigation must begin immediately and cannot wait for animation completion.
- Search results crossfade or settle into their new grid positions without animating width, height, `top`, or `left`.
- Do not use infinite decorative motion, scroll-jacking, parallax, autoplay audio, or gesture-only navigation.
- All motion uses `transform` and `opacity`, is interruptible, and produces no layout shift.

With `prefers-reduced-motion: reduce`, cards render in their final positions, filtering updates immediately, and selection remains clear through border, shadow, and color states.

## 5. Responsive and accessible behavior

- Use one column on small phones, two on wider mobile/tablet layouts, and three or four on desktop as space permits.
- Disable card rotation below 400 px, matching the existing brand rule.
- Preserve DOM order as the reading, keyboard, and screen-reader order regardless of visual transforms.
- Every card has a minimum 44×44 px target, a visible focus outline, and an accessible name containing the member's display name.
- Hover cannot reveal information that is unavailable on focus or touch.
- Search has a persistent label, a result count announced politely, and a keyboard-operable reset control.
- Text and controls meet WCAG AA contrast, and zoom or large text must not hide names or actions.
- The directory remains fully navigable when JavaScript fails; search and animation are enhancements.

## 6. Data and states

- Render only published member-page DTOs: `slug`, `displayName`, and optional `blurb`.
- Never expose account IDs, Discord IDs, roles, ownership, or administrative fields.
- Use stable ordering from the member-page system; visual variation must not reorder members.
- Reserve card space before enhancement so loading and animation do not cause cumulative layout shift.
- If no pages are published, omit the homepage link and return the branded not-found experience for `/members` rather than displaying placeholder members.
- If directory data cannot be loaded, show a concise retry state while leaving the site navigation usable.

Personalization on `/m/<slug>` continues to come from the member-owned content defined in the member-page specification. This directory does not add arbitrary themes, custom code, or per-member layouts.

## 7. Acceptance criteria

- A signed-out visitor can open `/members`, find every published member, and navigate to the selected `/m/<slug>` page.
- Unknown and unpublished members never appear.
- Search filters by display name, can be cleared, and preserves a logical focus position.
- Every card works with keyboard, touch, pointer, screen reader, zoom, and large text.
- Reduced-motion mode contains no entrance, movement, or shared-element animation.
- The layout works without horizontal scrolling at 375 px and remains readable through desktop widths.
- Animation does not delay navigation, block input, or move content unexpectedly.
- The page uses only approved HAM tokens, fonts, textures, and public member facts.
- The homepage provides a clear route to the full directory once at least one member is published.

## 8. Out of scope

- Public membership applications or Discord invitations.
- Rankings, online status, activity feeds, likes, or featured-member ordering.
- Member photos, file uploads, freeform themes, or user-authored CSS/JavaScript.
- Dragging cards as the only way to browse.
- Editing member content from `/members`; editing remains on the owner's `/m/<slug>` page.

## Related documents

- [Member page self-service specification](MEMBER_PAGES_SPEC.md)
- [Member page implementation plan](MEMBER_PAGES_IMPLEMENTATION.md)
- [Brand guidelines](../../BRAND.md)
