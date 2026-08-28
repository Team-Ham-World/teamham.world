import { expect, type Page } from "@playwright/test";

import { SESSION_COOKIE_NAME } from "../../src/lib/auth/http";

import { openEditor, ownerContext, test } from "./support/fixture";
import { resolveBaseUrl } from "./support/environment";
import { skipUnlessAppUp, skipWithoutDatabase } from "./support/skip";

/**
 * The responsive inspector, exercised live at the two capability thresholds.
 *
 * The compact band — 64rem inclusive to 80rem exclusive, with hover and a
 * fine pointer — mounts the editor and replaces the side rail and inspector
 * with bottom sheets. These tests hold that layout to the same standards as
 * the desktop workbench: one copy of every field id, a modal dialog that
 * traps focus, Escape to dismiss, and body scroll locking that releases.
 *
 * Below 64rem nothing mounts, and neither does anything on a coarse-pointer
 * or touch-only device at any width.
 */

/** Narrow window inside the compact band (72rem). */
const COMPACT_VIEWPORT = { width: 1152, height: 800 };

function bodyOverflow(page: Page): Promise<string> {
  return page.evaluate(() => document.body.style.overflow);
}

test.describe("member page V2 editor: responsive inspector", () => {
  skipWithoutDatabase();

  test("the compact band edits through bottom sheets with one copy of every field", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const owner = await ownerContext(browser, member.sessionToken);
    try {
      const page = await owner.newPage();
      await page.setViewportSize(COMPACT_VIEWPORT);
      await openEditor(page);

      // No side columns in the compact band; the tools live in sheets.
      await expect(page.locator("[data-editor-rail-region]")).toHaveCount(0);
      await expect(page.locator("[data-editor-inspector]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Outline" })).toBeVisible();

      // The rail sheet is a modal dialog and locks body scroll while open.
      await page.getByRole("button", { name: "Outline" }).click();
      const sheet = page.locator("[data-mobile-inspector-sheet]");
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute("role", "dialog");
      await expect(sheet).toHaveAttribute("aria-modal", "true");
      expect(await bodyOverflow(page)).toBe("hidden");

      // Escape dismisses the sheet and releases the scroll lock.
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      expect(await bodyOverflow(page)).toBe("");

      // Selecting the profile header opens the inspector sheet with the
      // real fields — exactly one copy of each id, never doubled.
      await page.locator("#member-page-frame-select").click();
      await expect(sheet).toBeVisible();
      await expect(page.locator("#frame-display-name")).toHaveCount(1);
      await expect(page.locator("#frame-display-name")).toBeVisible();

      // Focus starts on the sheet's close control and stays trapped:
      // Shift+Tab from the first control wraps to the last, Tab forward
      // again, and neither lands outside the dialog.
      await expect(
        page.getByRole("button", { name: "Close Profile header" }),
      ).toBeFocused();
      const focusInsideSheet = () =>
        page.evaluate(
          () =>
            document.activeElement?.closest("[data-mobile-inspector-sheet]") !==
            null,
        );
      await page.keyboard.press("Shift+Tab");
      expect(await focusInsideSheet()).toBe(true);
      await page.keyboard.press("Tab");
      expect(await focusInsideSheet()).toBe(true);

      // Escape returns focus to the invoker on the canvas.
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(
        "member-page-frame-select",
      );
      expect(await bodyOverflow(page)).toBe("");
    } finally {
      await owner.close();
    }
  });

  test("the full workbench keeps side regions and never mounts sheets", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const owner = await ownerContext(browser, member.sessionToken);
    try {
      // The configured project viewport (1440×900) is desktop.
      const page = await owner.newPage();
      await openEditor(page);

      await expect(page.locator("[data-editor-rail-region]")).toBeVisible();
      await expect(page.locator("[data-editor-inspector]")).toBeVisible();
      await expect(page.locator("#frame-display-name")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "Outline" }),
      ).toHaveCount(0);
      await expect(page.locator("[data-mobile-inspector-sheet]")).toHaveCount(0);
    } finally {
      await owner.close();
    }
  });

  test("touch-only input inside the compact band stays locked out", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    // `hasTouch` flips Chromium's (pointer: coarse) and (hover: none) media,
    // verified separately, so this exercises the capability half of the
    // gate, not just the width half.
    const context = await browser.newContext({
      hasTouch: true,
      viewport: COMPACT_VIEWPORT,
    });
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: member.sessionToken,
        url: resolveBaseUrl(),
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    try {
      const page = await context.newPage();
      await page.goto(member.editorUrl);

      await expect(
        page.locator('[data-editor-unavailable="small-screen"]'),
      ).toBeVisible();
      await expect(page.locator("[data-autosave-state]")).toHaveCount(0);
      await expect(
        page.locator('[data-editor-workspace="app-shell"]'),
      ).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
