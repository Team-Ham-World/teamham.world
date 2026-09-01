import { expect, test } from "@playwright/test";

import { skipUnlessAppUp } from "./support/skip";

const PUFF_SECRET_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "a",
  "b",
  "Enter",
] as const;

test.describe("Puffcade", () => {
  test.beforeEach(async () => {
    await skipUnlessAppUp();
  });

  test("loads directly with private route metadata and one playable game", async ({
    page,
  }) => {
    const response = await page.goto("/puffcade");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Puffcade");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Puffcade is where HAM's Puff-related games live.",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://teamham.world/puffcade",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Puffcade" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Play Flappy Puff" }),
    ).toHaveCount(1);
    await expect(page.getByText("PLAYABLE", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(
      page.locator('header a[href="/puffcade"], footer a[href="/puffcade"]'),
    ).toHaveCount(0);
  });

  test("navigates from the homepage after the keyboard sequence", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[role="img"] pre').first()).not.toBeEmpty();

    for (const key of PUFF_SECRET_SEQUENCE) {
      await page.keyboard.press(key);
    }

    await expect(page).toHaveURL(/\/puffcade$/);
    await expect(
      page.getByRole("button", { name: "Play Flappy Puff" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("keeps logo progress feedback and navigates after five clicks", async ({
    page,
  }) => {
    await page.goto("/");
    const logo = page.getByRole("link", { name: /HAM.*home/ });

    await logo.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("status")).toHaveText("Puff signal 1/5");

    for (let click = 0; click < 4; click += 1) {
      await logo.click();
    }

    await expect(page).toHaveURL(/\/puffcade$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("opens Flappy Puff and returns focus to its card after exit", async ({
    page,
  }) => {
    await page.goto("/puffcade");
    const card = page.getByRole("button", { name: "Play Flappy Puff" });

    await card.click();
    const dialog = page.getByRole("dialog", { name: "FLAPPY PUFF.EXE" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /exit transmission/i }).click();

    await expect(dialog).toHaveCount(0);
    await expect(card).toBeFocused();
  });

  test("keeps the logo as an ordinary home link outside the homepage", async ({
    page,
  }) => {
    await page.goto("/puffcade");

    await page.getByRole("link", { name: /HAM.*home/ }).click();

    await expect(page).toHaveURL(/\/$/);
  });

  test("stacks the card on mobile and splits it on desktop", async ({ page }) => {
    await page.goto("/puffcade");
    const card = page.getByRole("button", { name: "Play Flappy Puff" });
    const artwork = card.locator('span[aria-hidden="true"]').first();
    const title = card.getByText("Flappy Puff", { exact: true });

    const desktopArtwork = await artwork.boundingBox();
    const desktopTitle = await title.boundingBox();
    if (!desktopArtwork || !desktopTitle) {
      throw new Error("The desktop Puffcade card did not produce layout boxes.");
    }
    expect(desktopArtwork.x).toBeLessThan(desktopTitle.x);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileArtwork = await artwork.boundingBox();
    const mobileTitle = await title.boundingBox();
    if (!mobileArtwork || !mobileTitle) {
      throw new Error("The mobile Puffcade card did not produce layout boxes.");
    }
    expect(mobileArtwork.y + mobileArtwork.height).toBeLessThanOrEqual(
      mobileTitle.y,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
