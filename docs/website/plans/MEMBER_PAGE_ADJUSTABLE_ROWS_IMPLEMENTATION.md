# Member Page Adjustable Rows Implementation Plan

**Document Status**: IMPLEMENTED IN CODE / NOT YET DEPLOYED
**Target Area**: V2 member-page document model, public renderer, and owner editor
**Related Specification**: [Member Page Personalization V2 Specification](MEMBER_PAGE_PERSONALIZATION_V2_SPEC.md)

## 1. Goal and scope

Keep the member page as a vertical sequence of entries. Each entry contains either one block or one row with exactly two blocks.

Every block type and variant may appear in a two-block row. This includes rich text, featured projects, galleries, and wide images. A block fills its assigned column rather than its normal full-page width.

The owner may select one of three width ratios for a two-block row:

- equal width, represented as `1:1`;
- a narrower left block and wider right block, represented as `1:2`; or
- a wider left block and narrower right block, represented as `2:1`.

Rows stack into one column below the `lg` breakpoint. The left block appears before the right block in the DOM, mobile layout, focus order, and screen-reader order.

This plan does not add nested layouts, rows with more than two blocks, freeform percentages, or drag-only resizing.

## 2. Document model

Replace the earlier proposed per-block `width?: "half"` field with a row entry. Width is a relationship between two blocks, so the row owns one ratio.

```ts
export interface MemberBlockRow {
  type: "row";
  ratio: "1:1" | "1:2" | "2:1";
  blocks: [left: MemberBlock, right: MemberBlock];
}

export type MemberPageEntry = MemberBlock | MemberBlockRow;

export interface MemberPageDocumentV2 {
  schemaVersion: typeof MEMBER_PAGE_DOCUMENT_SCHEMA_VERSION;
  frame: MemberPageFrameV2;
  blocks: MemberPageEntry[];
}
```

The tuple prevents rows with fewer or more than two blocks. The ratio union prevents unsupported widths. A row has no ID. The two blocks keep their existing IDs, and code may derive a stable row key from both IDs.

Existing V2 documents remain valid because each existing `MemberBlock` is also a `MemberPageEntry`. Do not run a database migration or rewrite stored documents. Do not change `legacy-to-doc.ts` output.

Keep the current `schemaVersion`. The updated validator accepts both leaf entries and row entries. Older validators fail closed on the unknown `row` type.

## 3. Composition rules

Apply these rules in one shared composition boundary used by the public renderer and the editor canvas:

1. A leaf entry renders as one full-width row.
2. A row entry renders its two blocks in the stored left-to-right order.
3. The row ratio selects the grid column fractions.
4. Below `lg`, every row becomes one column without changing DOM order.
5. If one block cannot render, render the surviving block at full width.
6. If neither block can render, omit the row.
7. Never pull a block from the next entry into a degraded row.
8. Any leading standalone leaf entry may occupy the existing profile showcase slot. Rows may not occupy it, and a featured project inside a row uses its standard body presentation.

Extend `src/components/member-page-v2/page-composition.ts` rather than duplicating these decisions in the public and editor render paths.

## 4. Public rendering

Render a two-block row with CSS Grid at `lg` and above:

| Ratio | Grid template |
|---|---|
| `1:1` | `minmax(0, 1fr) minmax(0, 1fr)` |
| `1:2` | `minmax(0, 1fr) minmax(0, 2fr)` |
| `2:1` | `minmax(0, 2fr) minmax(0, 1fr)` |

Reuse the existing page width, `lg` breakpoint, `gap-14`, and vertical `space-y-12` rhythm. Give each grid child `min-w-0` so long text and media cannot force the row wider than the page.

Wide images fill their assigned column. Extend the image render context so the `sizes` value reflects full, one-half, one-third, or two-thirds placement. Do not change the meaning of the image block's `wide` variant.

Keep the gallery's current internal grid. Do not thread column-width state through the gallery unless manual verification shows an actual layout failure.

Use the collision-safe namespaced `rowEntryKey` helper for a row's composite React/DnD key: `row:${JSON.stringify([left.id, right.id])}`, the JSON-encoded pair of child IDs. `MemberPageV2Body` cannot assume that every top-level entry has an `id`.

## 5. Editor behavior

### 5.1 Create and remove rows

For a selected single block, provide these actions when the adjacent entry is also a single block:

- **Pair with previous**;
- **Pair with next**.

For a block inside a row, provide these actions:

- **Equal width**;
- **Left wider**;
- **Right wider**;
- **Swap sides**;
- **Split row**.

Pairing replaces two adjacent leaf entries with one row entry. Splitting replaces one row entry with its two leaf entries in left-to-right order.

Move and duplicate a row as one entry. Use **Swap sides** to change the order inside a row. Do not add nested drag-and-drop targets.

If the owner deletes one block from a row, replace the row with the surviving block. Undo restores the deleted block as a single entry at the former row position. Undo does not reconstruct the pair.

### 5.2 Width adjustment

Use a select or segmented buttons for the three ratios. Every ratio control must work with a keyboard and expose its current value to assistive technology.

Do not require a drag handle. A drag handle may be considered later as an optional enhancement, but the buttons or select must remain the complete accessible control.

### 5.3 Ordering and announcements

Treat a row as one position in editor movement and position announcements. The row's blocks remain individually selectable for content editing.

Announce pair, split, ratio, swap, move, delete, and restore results. Keep the static button controls available when drag-and-drop is unavailable.

## 6. Document operations and limits

Update `src/components/member-page-editor/document-ops.ts` so every operation understands both leaf entries and row entries.

Required operations include:

- `pairBlocks`;
- `splitRow`;
- `swapRowSides`;
- `setRowRatio`;
- moving an entry;
- replacing a block inside a row;
- duplicating a row;
- deleting one row child and promoting the survivor; and
- restoring a deleted child as a single entry.

Update `src/components/member-page-editor/ids.ts` so duplicating a row assigns new IDs to both child blocks.

The existing 12-block limit counts leaf blocks, not top-level entries. A page with six two-block rows has 12 blocks. Both `validation.ts` and `document-ops.ts` must use the same flattened leaf count.

Count featured projects across all leaf blocks, including blocks inside rows. The existing one-featured-project limit still applies.

Keep ID uniqueness global across single entries and both children of every row.

## 7. Validation

Update `src/lib/members/v2/validation.ts` to parse `MemberPageEntry` values at the document boundary.

The validator must reject:

- unknown row keys;
- unsupported ratio values;
- rows with missing or extra children;
- nested rows;
- duplicate block IDs across any entry;
- more than 12 leaf blocks; and
- more than one featured project across all entries.

The validator must continue to accept existing all-leaf documents without changing their parsed output.

## 8. Affected files

### 8.1 Document and validation

- `src/lib/members/v2/document.ts`
- `src/lib/members/v2/validation.ts`

### 8.2 Shared composition and public rendering

- `src/components/member-page-v2/page-composition.ts`
- `src/components/member-page-v2/MemberPageV2View.tsx`
- `src/components/member-page-v2/blocks/MemberPageV2Body.tsx`
- `src/components/member-page-v2/blocks/MemberPageV2LeafBlock.tsx`
- image and project leaf components that assume full-page image sizing

### 8.3 Editor

- `src/components/member-page-editor/document-ops.ts`
- `src/components/member-page-editor/ids.ts`
- `src/components/member-page-editor/editor-canvas.tsx`
- `src/components/member-page-editor/block-inspector.tsx`

### 8.4 Tests

- `tests/unit/member-v2-validation.test.ts`
- `tests/unit/member-v2-renderer.test.tsx`
- `tests/unit/member-v2-renderer-parity.test.tsx`
- `tests/unit/member-v2-editor-blocks.test.ts`
- `tests/unit/member-v2-legacy-to-doc.test.ts`

## 9. Implementation sequence

### Phase 0: confirm framework guidance

Read `AGENTS.md` and the relevant installed Next.js guides under `node_modules/next/dist/docs/` before changing application code. Record any guidance that changes the Server Component, Client Component, or editor boundary.

### Phase 1: add the entry model and validator

1. Add `MemberBlockRow` and `MemberPageEntry`.
2. Parse both entry variants at the document boundary.
3. Add shared flattening and leaf-count helpers.
4. Prove that existing all-leaf fixtures parse unchanged.

### Phase 2: update editor operations

1. Update lookup, replacement, duplication, deletion, restoration, limits, and featured-project counting.
2. Add pair, split, swap, and ratio operations.
3. Keep entry positions and announcements consistent.
4. Verify this phase before changing either renderer.

### Phase 3: update shared composition and public rendering

1. Compose leaf entries and row entries through one shared function.
2. Render the three ratio grids at `lg`.
3. Stack rows below `lg`.
4. Update placement-aware image sizes.
5. Handle degraded row children without holes or neighbor reassignment.

### Phase 4: update the editor canvas and inspector

1. Render the same row composition in the editor canvas.
2. Add pair, split, ratio, and swap controls.
3. Preserve individual block selection inside each row.
4. Keep every action keyboard-operable.

### Phase 5: verify the complete behavior

Run the focused tests and manually check one page at 375, 768, and 1280 CSS pixels.

## 10. Acceptance criteria

- Every existing block type and variant can render in either side of a row.
- A wide image fills its assigned column without overflowing the page.
- The owner can create, split, swap, move, duplicate, and resize a row through keyboard-operable controls.
- The type and validator prevent rows with anything other than two leaf blocks.
- The three ratios render consistently in the public page and editor canvas.
- Rows stack left then right below `lg` without changing DOM or focus order.
- A degraded row child does not leave a hole or pull in a neighboring block.
- Deleting one row child promotes the survivor to a single entry.
- Undo restores the deleted child as a single entry at the former row position.
- The 12-block limit counts leaf blocks inside rows.
- Featured-project limits include featured projects inside rows.
- Duplicating a row generates two new block IDs.
- Existing all-leaf documents validate and render unchanged.
- `legacy-to-doc.ts` output remains unchanged.

## 11. Verification

Extend the existing tests rather than creating new suites:

| Test file | Required coverage |
|---|---|
| `tests/unit/member-v2-validation.test.ts` | Valid rows, malformed rows, nested-row rejection, duplicate IDs, leaf-count limits, and unchanged flat fixtures. |
| `tests/unit/member-v2-renderer.test.tsx` | All-leaf regression, ratio grids, degraded-row fallback, all block types in rows, and placement-aware image sizes. |
| `tests/unit/member-v2-renderer-parity.test.tsx` | Public and editor parity for row documents. |
| `tests/unit/member-v2-editor-blocks.test.ts` | Pair, split, swap, ratio, move, replace, delete, restore, duplicate IDs, and featured-project limits. |
| `tests/unit/member-v2-legacy-to-doc.test.ts` | Existing migration-free document output remains valid. |

Run:

```bash
npm run test -- tests/unit/member-v2-validation tests/unit/member-v2-renderer tests/unit/member-v2-renderer-parity tests/unit/member-v2-editor-blocks tests/unit/member-v2-legacy-to-doc
```

Then check one representative page at:

- 375 CSS pixels;
- 768 CSS pixels; and
- 1280 CSS pixels.

Verify keyboard operation, focus order, public and editor parity, wide images, galleries, long rich text, featured projects, and degraded media.

## 12. Explicit non-goals

- Continuous percentage widths.
- Drag-only resizing.
- Row IDs or row-level content.
- Rows with more than two blocks.
- Nested rows.
- Automatic pairing based on block type.
- A new layout dependency.
- A database migration or stored-document rewrite.
- A separate layout system for the editor.

Add continuous resizing only if the three presets fail a demonstrated author need. Add more columns or nested rows only through a new product and document-model decision.
