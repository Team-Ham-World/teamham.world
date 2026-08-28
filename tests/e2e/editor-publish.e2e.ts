import {
  anonymousContext,
  openEditor,
  ownerContext,
  publicPath,
  test,
  expect,
} from "./support/fixture";
import { resolveBaseUrl } from "./support/environment";
import { skipUnlessAppUp, skipWithoutDatabase } from "./support/skip";

/**
 * Scenario 1 (runbook "Browser-only editor failures"): the owner edits a
 * simple field, the autosave state reaches Saved, Preview shows the edit,
 * Publish makes it live, and a fresh anonymous context sees the public
 * content. Unpublish then revokes the public page for a fresh client.
 */
test.describe("member page V2 editor: edit through publish and public render", () => {
  skipWithoutDatabase();

  test("owner edit autosaves, previews, publishes, and renders for a signed-out visitor", async ({
    browser,
    member,
  }) => {
    skipUnlessAppUp();

    const renamed = "E2E Renamed Member";

    const owner = await ownerContext(browser, member.sessionToken);
    const editorPage = await owner.newPage();
    try {
      await openEditor(editorPage);

      // A simple field edit drives the real autosave debounce to Saved.
      const displayName = editorPage.locator("#frame-display-name");
      await displayName.fill(renamed);
      await expect(editorPage.locator("[data-autosave-state]")).toHaveAttribute(
        "data-autosave-state",
        "saved",
      );

      // Preview shows the same saved content inside the editor canvas.
      await editorPage.locator("#member-page-mode-preview").click();
      await expect(
        editorPage.getByRole("heading", { level: 1, name: renamed }),
      ).toBeVisible();

      // Publish waits for the saved revision and then reports success.
      await editorPage.locator("#member-page-publish").click();
      await expect(
        editorPage.getByText("Published. Your page is live."),
      ).toBeVisible();

      // A fresh anonymous context sees the published content.
      const anonymous = await anonymousContext(browser);
      const publicPage = await anonymous.newPage();
      const response = await publicPage.goto(publicPath());
      expect(response?.status()).toBe(200);
      await expect(
        publicPage.getByRole("heading", { level: 1, name: renamed }),
      ).toBeVisible();

      // Unpublish revokes the public page for another fresh client. The
      // tab's own publication token (issued with full Postgres microsecond
      // precision) must satisfy the stale-unpublish guard: the same tab that
      // published can immediately take its page back down.
      await editorPage.getByRole("button", { name: "Unpublish" }).click();
      await expect(
        editorPage.getByText("Unpublished. Only you can see this page now."),
      ).toBeVisible();
      const revoked = await anonymousContext(browser);
      const revokedPage = await revoked.newPage();
      const revokedResponse = await revokedPage.goto(publicPath());
      expect(revokedResponse?.status()).toBe(404);
      await revoked.close();
    } finally {
      await owner.close();
    }
  });

  test("a signed-out visitor gets 404 while the page is private", async ({
    browser,
  }) => {
    skipUnlessAppUp();

    // The fixture reseeds a private page per worker; this fresh context must
    // not see it while it is unpublished.
    const anonymous = await anonymousContext(browser);
    const page = await anonymous.newPage();
    const response = await page.goto(publicPath());
    expect(response?.status()).toBe(404);
    await anonymous.close();
  });
});

test.describe("environment sanity", () => {
  test("the configured base URL is the local development origin", () => {
    expect(resolveBaseUrl()).toMatch(/^https:\/\/(localhost|127\.0\.0\.1|::1)/);
  });
});
