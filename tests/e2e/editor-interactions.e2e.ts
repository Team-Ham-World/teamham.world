import {
  openEditor,
  ownerContext,
  test,
  expect,
} from "./support/fixture";
import { skipUnlessAppUp, skipWithoutDatabase } from "./support/skip";

/**
 * Scenario 4 (runbook): reorder with the keyboard and with a pointer, plus a
 * responsive editor-availability flow. Only existing, stable selectors are
 * used: the drag handle's aria-label, the canvas `[data-block-id]` order, and
 * the small-screen requirement region.
 *
 * The compact band (64–80rem, hover and fine pointer) mounts the editor with
 * bottom sheets instead of side rails; the sheet interaction depth — field
 * identity, focus trap, Escape, scroll locking — is covered in
 * member-v2-responsive-inspector.e2e.ts. Below 64rem, and on coarse-pointer
 * or touch-only devices, nothing mounts.
 */

const NOTE_BLOCK_ID = "e2e-block-note";
const LINKS_BLOCK_ID = "e2e-block-links";

async function canvasBlockOrder(page: import("@playwright/test").Page): Promise<string[]> {
  return page.$$eval("[data-block-id]", (elements) =>
    elements.map((element) => element.getAttribute("data-block-id") ?? ""),
  );
}

test.describe("member page V2 editor: reorder and responsive availability", () => {
  skipWithoutDatabase();

  test("keyboard reorder moves a block and autosaves the new order", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const owner = await ownerContext(browser, member.sessionToken);
    try {
      const page = await owner.newPage();
      await openEditor(page);

      expect(await canvasBlockOrder(page)).toEqual([
        NOTE_BLOCK_ID,
        LINKS_BLOCK_ID,
      ]);

      const handle = page.getByRole("button", {
        name: /Drag .*current position 1 of 2/,
      });
      await handle.focus();
      // dnd-kit keyboard flow, per the editor's own instructions: Space
      // lifts, arrows move, Space drops. Small gaps let dnd-kit measure and
      // register each step; zero-gap presses drop before the move registers.
      await page.keyboard.press("Space");
      await page.waitForTimeout(250);
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(250);
      await page.keyboard.press("Space");
      await page.waitForTimeout(400);

      await expect(page.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "saved",
      );
      expect(await canvasBlockOrder(page)).toEqual([
        LINKS_BLOCK_ID,
        NOTE_BLOCK_ID,
      ]);
    } finally {
      await owner.close();
    }
  });

  test("pointer drag reorder moves a block back and autosaves", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const owner = await ownerContext(browser, member.sessionToken);
    try {
      const page = await owner.newPage();
      await openEditor(page);

      // Self-contained: read the current order, drag the first block's
      // handle onto the second block, and expect the two blocks swapped.
      const before = await canvasBlockOrder(page);
      // The drag handle lives in the block's toolbar strip, which is
      // transparent and inert until its region is hovered, focused, or
      // selected (editor-canvas.module.css). Hovering the region first is
      // the same gesture a person makes before grabbing the handle.
      const firstRegion = page.locator(
        `[data-canvas-region="block"][data-block-id="${before[0]}"]`,
      );
      await firstRegion.hover();
      const handle = page.getByRole("button", {
        name: /Drag .*current position 1 of 2/,
      });
      await handle.hover();
      await page.mouse.down();
      // Move past dnd-kit's pointer activation distance in several steps so
      // the sortable registration sees a real drag gesture.
      const target = page.locator(`[data-block-id="${before[1]}"]`);
      const box = await target.boundingBox();
      if (!box) throw new Error("Target block is not visible.");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
        steps: 12,
      });
      await page.waitForTimeout(250);
      await page.mouse.up();
      await page.waitForTimeout(400);

      await expect(page.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "saved",
      );
      expect(await canvasBlockOrder(page)).toEqual([
        before[1],
        before[0],
      ]);
    } finally {
      await owner.close();
    }
  });

  test("the editor fails closed below 64rem, edits with sheets in the compact band, and shows rails on desktop", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const owner = await ownerContext(browser, member.sessionToken);
    try {
      const page = await owner.newPage();

      // Below 64rem nothing mounts; the autosave machine never starts.
      await page.setViewportSize({ width: 900, height: 700 });
      await page.goto(`/m/${member.slug}?edit=1`);
      await expect(
        page.locator('[data-editor-unavailable="small-screen"]'),
      ).toBeVisible();
      await expect(page.locator("[data-autosave-state]")).toHaveCount(0);

      // 64rem up to 80rem is the compact band: the editor mounts, and the
      // rail and inspector become bottom sheets instead of side columns.
      await page.setViewportSize({ width: 1152, height: 800 });
      await expect(page.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "saved",
      );
      await expect(page.locator("[data-editor-rail-region]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Outline" })).toBeVisible();

      // From 80rem the full three-column workbench takes over.
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.locator("[data-editor-rail-region]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Outline" })).toHaveCount(0);
      await expect(
        page.locator('[data-editor-unavailable="small-screen"]'),
      ).toHaveCount(0);
    } finally {
      await owner.close();
    }
  });
});

test.describe("member page V2 editor: header slot and row round-trip", () => {
  skipWithoutDatabase();

  test("generic header slot yields to a paired row and returns when a child takes itself out", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const owner = await ownerContext(browser, member.sessionToken);
    try {
      const page = await owner.newPage();
      await openEditor(page);

      const surface = page
        .locator("[data-editor-sheet]")
        .locator("[data-member-theme-surface][data-member-layout]");
      await expect(surface).toHaveAttribute("data-member-layout", "showcase");
      await expect(surface.locator('[data-profile-showcase="true"]')).toHaveCount(1);
      await expect(
        surface.locator(
          `ol[data-editor-block-list] > li:first-child [data-block-id="${NOTE_BLOCK_ID}"]`,
        ),
      ).toBeVisible();
      await expect(
        surface.getByText("First seeded block for ordering checks."),
      ).toHaveCount(1);

      await page.locator(`#member-page-block-${NOTE_BLOCK_ID}-select`).focus();
      await page.keyboard.press("Enter");
      const pairWithNext = page.getByRole("button", { name: "Pair with next" });
      await expect(pairWithNext).toBeVisible();
      await pairWithNext.click();

      const rowRegion = page.locator('[data-canvas-region="row"]');
      await expect(rowRegion).toBeVisible();
      await expect(rowRegion.locator('[data-canvas-region="block"]')).toHaveCount(2);
      await expect(rowRegion.locator(`[data-block-id="${NOTE_BLOCK_ID}"]`)).toBeVisible();
      await expect(rowRegion.locator(`[data-block-id="${LINKS_BLOCK_ID}"]`)).toBeVisible();
      await expect(surface).toHaveAttribute("data-member-layout", "blocks");
      await expect(surface.locator('[data-profile-showcase="true"]')).toHaveCount(0);
      await expect(page.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "saved",
      );

      const inspector = page.locator('[data-editor-inspector="true"]');
      await expect(
        page.getByRole("button", { name: "Pair with next" }),
      ).toHaveCount(0);
      await expect(inspector.getByRole("button", { name: "Split row" })).toBeVisible();
      await expect(
        inspector.getByRole("button", { name: "Take out", exact: true }),
      ).toHaveCount(0);

      const takeOutOfRow = page.getByRole("button", {
        name: "Take Callout or quote out of row",
        exact: true,
      });
      await expect(takeOutOfRow).toBeAttached();
      await takeOutOfRow.focus();
      await page.keyboard.press("Enter");

      await expect(page.locator('[data-canvas-region="row"]')).toHaveCount(0);
      await expect.poll(async () => canvasBlockOrder(page)).toEqual([
        NOTE_BLOCK_ID,
        LINKS_BLOCK_ID,
      ]);
      await expect(
        page.locator(`[data-canvas-region="block"][data-block-id="${NOTE_BLOCK_ID}"][data-selected="true"]`),
      ).toBeVisible();
      await expect(
        page.locator(`#member-page-block-${NOTE_BLOCK_ID}-select`),
      ).toBeFocused();
      await expect(surface).toHaveAttribute("data-member-layout", "showcase");
      await expect(surface.locator('[data-profile-showcase="true"]')).toHaveCount(1);
      await expect(page.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "saved",
      );
    } finally {
      await owner.close();
    }
  });
});
test.describe("member page V2 editor: rich-text alignment", () => {
  skipWithoutDatabase();

  test("alignment applied from the keyboard survives autosave and reload", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const owner = await ownerContext(browser, member.sessionToken);
    try {
      const page = await owner.newPage();
      await openEditor(page);

      // The fixture seeds no rich-text block, so add one through the real
      // add flow and type into its editor.
      await page.getByRole("button", { name: "Add a block" }).click();
      await page.getByRole("button", { name: "Add Rich text" }).click();
      const draftEditor = page.getByRole("textbox", {
        name: "New rich text block",
      });
      await expect(draftEditor).toBeVisible();
      await draftEditor.click();
      await page.keyboard.type("Paragraph to align.");
      await page.getByRole("button", { name: "Add block", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Add block", exact: true }),
      ).toHaveCount(0);

      const toolbar = page.getByRole("toolbar", {
        name: "Rich text formatting",
      });
      const alignLeft = toolbar.getByRole("button", {
        name: "Align left",
        exact: true,
      });
      const alignCenter = toolbar.getByRole("button", {
        name: "Align center",
        exact: true,
      });
      const alignRight = toolbar.getByRole("button", {
        name: "Align right",
        exact: true,
      });
      await expect(alignLeft).toBeVisible();
      await expect(alignCenter).toBeVisible();
      await expect(alignRight).toBeVisible();
      await expect(toolbar.getByRole("button", { name: /justify/i })).toHaveCount(
        0,
      );

      await alignCenter.focus();
      await page.keyboard.press("Enter");
      await expect(alignCenter).toHaveAttribute("aria-pressed", "true");
      await expect(alignLeft).toHaveAttribute("aria-pressed", "false");
      await expect(
        page
          .locator("[data-editor-sheet] .prose-member p.text-center")
          .last(),
      ).toContainText("Paragraph to align.");

      // Wait for the edit to register, then for the real round trip to finish,
      // so the reload below cannot race the save.
      const autosave = page.locator("[data-autosave-state]");
      await expect(autosave).not.toHaveAttribute("data-autosave-state", "saved");
      await expect(autosave).toHaveAttribute("data-autosave-state", "saved");

      await page.reload();
      await expect(autosave).toHaveAttribute("data-autosave-state", "saved");
      await expect(
        page
          .locator("[data-editor-sheet] .prose-member p.text-center")
          .last(),
      ).toContainText("Paragraph to align.");

      // Nothing is selected after a reload; select the block from the outline
      // rail and confirm Center is pressed from the loaded document.
      await page
        .getByRole("button", { name: /Rich text/ })
        .filter({ hasText: "Paragraph to align." })
        .click();
      await expect(alignCenter).toHaveAttribute("aria-pressed", "true");

      await alignRight.focus();
      await page.keyboard.press("Enter");
      await expect(alignRight).toHaveAttribute("aria-pressed", "true");
      await expect(alignCenter).toHaveAttribute("aria-pressed", "false");

      await alignLeft.focus();
      await page.keyboard.press("Enter");
      await expect(alignLeft).toHaveAttribute("aria-pressed", "true");
      await expect(alignRight).toHaveAttribute("aria-pressed", "false");
      await expect(
        page.locator("[data-editor-sheet] .prose-member p.text-center"),
      ).toHaveCount(0);
      await expect(
        page.locator("[data-editor-sheet] .prose-member p.text-right"),
      ).toHaveCount(0);
      await expect(autosave).not.toHaveAttribute("data-autosave-state", "saved");
      await expect(autosave).toHaveAttribute("data-autosave-state", "saved");
    } finally {
      await owner.close();
    }
  });
});
