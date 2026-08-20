# Fonts

Both faces are self-hosted here as `latin`-subset WOFF2 and declared with
`next/font/local` in `src/app/layout.tsx`. Nothing is fetched from Google at
build time or at runtime.

| Role      | Family                | File                                | Size  |
| --------- | --------------------- | ----------------------------------- | ----- |
| Display   | Bricolage Grotesque   | `BricolageGrotesque-Variable.woff2` | 77 KB |
| Body / UI | Atkinson Hyperlegible | `AtkinsonHyperlegible-Regular.woff2`| 11 KB |
| Body / UI | Atkinson Hyperlegible | `AtkinsonHyperlegible-Bold.woff2`   | 11 KB |

## Notes

- **Bricolage Grotesque** is a variable font covering weight 400–800 plus an
  optical-size axis the browser drives from `font-size`. `.font-display` in
  `globals.css` sets weight 800; do not ask for 900, there isn't one.
- `font-synthesis: none` on `.font-display` stops the browser faking a heavier
  weight if the file ever fails to load.
- Only the `latin` subset is included. If copy ever needs `latin-ext`,
  Vietnamese, or Greek glyphs, pull those subsets too — otherwise they will
  silently fall back to `system-ui`.

## Licences

Both are SIL Open Font License 1.1, and the licence text ships alongside the
fonts as required:

- `OFL-BricolageGrotesque.txt` — © 2022 The Bricolage Grotesque Project Authors
- `OFL-AtkinsonHyperlegible.txt` — © 2020 Braille Institute of America, Inc.

## Constraint

Per BRAND.md §2 the display font must **never** be used to typeset the word
"HAM". The wordmark is an independent graphic asset — see
`src/components/ham-wordmark.tsx`.
