# Member Page V2 theme contrast evidence

Calculated from the reviewed sRGB hex tokens with the WCAG 2.x relative-luminance formula. Ratios are rounded to two decimals. Automated coverage in `tests/unit/member-v2-themes-assets.test.ts` recalculates every ratio below and fails if this table drifts.

- Normal text threshold: **4.5:1**. Checked for ink and muted text on paper/surface, links on paper/surface, paper text on interactive accent buttons, paper text on ink primary buttons, and ink error copy on paper.
- Structural threshold: **3:1**. Checked for semantic borders, muted disabled borders, focus indicators, and decorative-red error indicators on paper/surface.
- Paper's fixed `decorativeRed` is **4.14:1** on Paper paper. It is therefore used as a non-text error border/icon alongside ink error copy, not as normal-sized error text.
- Every `paper` and `surface` token remains a light surface; no dark theme pair is enabled.

| Theme/accent ID | paper | ink | border | muted | surface | decorativeRed | interactiveBlue | ink/paper | ink/surface | muted/paper | muted/surface | border/paper | border/surface | link+focus/paper | link+focus/surface | accent button text | error text | error mark/paper | error mark/surface |
|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| paper/default | #f6f1e5 | #1c1a17 | #1c1a17 | #5c5648 | #fffdf6 | #d93625 | #1d4ed8 | 15.40 | 17.06 | 6.47 | 7.16 | 15.40 | 17.06 | 5.95 | 6.58 | 5.95 | 15.40 | 4.14 | 4.58 |
| newsprint/press-red | #f1efe8 | #161616 | #161616 | #55534e | #fbfaf4 | #a62b24 | #8f2f27 | 15.73 | 17.31 | 6.68 | 7.35 | 15.73 | 17.31 | 7.01 | 7.71 | 7.01 | 15.73 | 6.10 | 6.71 |
| newsprint/archive-blue | #f1efe8 | #161616 | #161616 | #55534e | #fbfaf4 | #245875 | #174f78 | 15.73 | 17.31 | 6.68 | 7.35 | 15.73 | 17.31 | 7.52 | 8.28 | 7.52 | 15.73 | 6.69 | 7.36 |
| blueprint/technical-blue | #edf5f3 | #102f39 | #1e5261 | #43636b | #f8fcfb | #0e5a70 | #0b4f75 | 12.74 | 13.65 | 5.86 | 6.28 | 7.79 | 8.34 | 7.93 | 8.50 | 7.93 | 12.74 | 6.98 | 7.48 |
| blueprint/survey-orange | #edf5f3 | #102f39 | #1e5261 | #43636b | #f8fcfb | #a34a1b | #873817 | 12.74 | 13.65 | 5.86 | 6.28 | 7.79 | 8.34 | 7.27 | 7.79 | 7.27 | 12.74 | 5.34 | 5.72 |
| riso/soy-red | #f6eedf | #251d1d | #251d1d | #665651 | #fff9ee | #ad2443 | #8b244b | 14.32 | 15.75 | 6.04 | 6.65 | 14.32 | 15.75 | 7.43 | 8.17 | 7.43 | 14.32 | 5.86 | 6.44 |
| riso/indigo | #f6eedf | #251d1d | #251d1d | #665651 | #fff9ee | #41529a | #33458a | 14.32 | 15.75 | 6.04 | 6.65 | 14.32 | 15.75 | 7.72 | 8.49 | 7.72 | 14.32 | 6.28 | 6.91 |

## Visual treatments reviewed

- `paper/default`: unchanged Paper values and default; no extra theme decoration.
- `newsprint/*`: light monochrome stock with low-opacity press rules.
- `blueprint/*`: light drafting paper with restrained minor/major grid lines; never a dark blueprint field.
- `riso/*`: warm stock with sparse, offset halftone dots.

All treatments are background-only, pointer-transparent, clipped to the member theme surface by their containing box, static under reduced motion, and leave the fixed HAM fonts, DOM order, widths, spacing, and block variants unchanged.
