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

  test("loads directly with private route metadata and links to Flappy Puff", async ({
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

    const card = page.getByRole("link", { name: "Play Flappy Puff" });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("href", "/puffcade/flappy-puff");
    await expect(page.getByText("PLAYABLE", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "FLAPPY PUFF.EXE" }),
    ).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.locator("body > header")).toBeVisible();
    await expect(
      page.locator('header a[href="/puffcade"], footer a[href="/puffcade"]'),
    ).toHaveCount(0);
  });

  test("serves Flappy Puff at its own route with metadata and fullscreen shell", async ({
    page,
  }) => {
    const response = await page.goto("/puffcade/flappy-puff");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Flappy Puff");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://teamham.world/puffcade/flappy-puff",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();
    await expect(
      game.getByRole("heading", { level: 1, name: "FLAPPY PUFF.EXE" }),
    ).toBeVisible();
    await expect(
      game.getByRole("button", { name: /flap to start/i }),
    ).toBeVisible();
    await expect(game.locator("canvas")).toBeVisible();
    await expect(
      game.getByRole("button", { name: /exit transmission/i }),
    ).toBeVisible();

    await expect(page.locator("body > header")).toBeHidden();
    expect(
      await page.evaluate(() => {
        const overflow = getComputedStyle(document.body).overflow;
        return (
          (overflow === "hidden" || overflow === "clip") &&
          document.documentElement.scrollWidth <= window.innerWidth
        );
      }),
    ).toBe(true);
  });

  test("catalog Link opens the game and native Back returns to the catalog", async ({
    page,
  }) => {
    await page.goto("/puffcade");
    await page.getByRole("link", { name: "Play Flappy Puff" }).click();
    await expect(page).toHaveURL(/\/puffcade\/flappy-puff$/);

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(
      game.getByRole("heading", { level: 1, name: "FLAPPY PUFF.EXE" }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/puffcade$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Puffcade" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Play Flappy Puff" }),
    ).toBeVisible();
  });

  test("explicit exit replaces history so Back cannot reopen the game", async ({
    page,
  }) => {
    await page.goto("/puffcade");
    await page.getByRole("link", { name: "Play Flappy Puff" }).click();

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();

    await game.getByRole("button", { name: /exit transmission/i }).click();
    await expect(page).toHaveURL(/\/puffcade$/);
    await expect(
      page.getByRole("link", { name: "Play Flappy Puff" }),
    ).toBeVisible();
    await expect(game).toHaveCount(0);

    await page.goBack();
    await expect(page).not.toHaveURL(/\/puffcade\/flappy-puff/);
    await expect(
      page.locator('[data-arcade-shell="fullscreen"]'),
    ).toHaveCount(0);
  });

  test("keeps exit reachable without horizontal overflow on the game route at mobile size", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/puffcade/flappy-puff");

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();
    await expect(
      game.getByRole("button", { name: /exit transmission/i }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("navigates from the homepage after the keyboard sequence", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('[role="img"] pre').first()).not.toBeEmpty();

    for (const key of PUFF_SECRET_SEQUENCE) {
      await page.keyboard.press(key);
    }

    await expect(page).toHaveURL(/\/puffcade$/);
    await expect(
      page.getByRole("link", { name: "Play Flappy Puff" }),
    ).toBeVisible();
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
    await expect(page.locator("body > header")).toBeVisible();
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
    const card = page.getByRole("link", { name: "Play Flappy Puff" });
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
