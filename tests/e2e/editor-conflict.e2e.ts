import {
  openEditor,
  ownerContext,
  test,
  expect,
} from "./support/fixture";
import { skipUnlessAppUp, skipWithoutDatabase } from "./support/skip";

/**
 * Scenario 2 (runbook "Autosave stops after another tab wins a revision
 * race"): a second tab that saves against a moved revision enters the
 * conflict state, keeps its local text, offers the safe recovery link
 * ("Open latest draft in a new tab"), keeps the destructive reload explicitly
 * labeled, stops autosaving, and blocks publish.
 */
test.describe("member page V2 editor: two-tab revision conflict", () => {
  skipWithoutDatabase();

  test("the losing tab preserves both versions and stops saving", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const contextA = await ownerContext(browser, member.sessionToken);
    const contextB = await ownerContext(browser, member.sessionToken);
    try {
      const tabA = await contextA.newPage();
      const tabB = await contextB.newPage();

      // Both tabs load the same stored draft at the same revision.
      await openEditor(tabA);
      await openEditor(tabB);

      // Tab A saves first; its revision wins.
      await tabA.locator("#frame-display-name").fill("Conflict Tab A");
      await expect(tabA.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "saved",
      );

      // Tab B edits against the stale revision and must land in conflict.
      await tabB.locator("#frame-display-name").fill("Conflict Tab B");
      await expect(tabB.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "conflict",
      );
      await expect(tabB.locator("[data-autosave-state]")).toHaveText(
        "Conflict detected",
      );

      // The local version stays on screen; nothing overwrote it.
      await expect(tabB.locator("#frame-display-name")).toHaveValue(
        "Conflict Tab B",
      );

      // The safe recovery first: a plain link that opens the stored draft in
      // a new tab.
      const recoveryLink = tabB.getByRole("link", {
        name: "Open latest draft in a new tab",
      });
      await expect(recoveryLink).toBeVisible();

      // The destructive way out says what it destroys.
      const discardButton = tabB.getByRole("button", {
        name: "Discard this local version and reload",
      });
      await expect(discardButton).toBeVisible();

      // Conflict blocks publish, and further edits do not resume autosaving.
      await expect(tabB.locator("#member-page-publish")).toBeDisabled();
      await tabB.locator("#frame-summary").fill("Edited after the conflict.");
      await expect(tabB.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "conflict",
      );

      // Following the recovery link loads the server version (Tab A's save).
      const recoveryTabPromise = contextB.waitForEvent("page");
      await recoveryLink.click();
      const recoveryTab = await recoveryTabPromise;
      await recoveryTab.waitForLoadState("domcontentloaded");
      const recoveryState = recoveryTab.locator("[data-autosave-state]");
      await expect(recoveryState).toHaveAttribute(
        "data-autosave-state",
        "saved",
        { timeout: 30_000 },
      );
      await expect(recoveryTab.locator("#frame-display-name")).toHaveValue(
        "Conflict Tab A",
      );
      await recoveryTab.close();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
