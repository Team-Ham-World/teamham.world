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
    await expect(card.getByText("PLAYABLE", { exact: true })).toBeVisible();
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

  test("renders only the ground motif as live gameplay text", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const fillText = CanvasRenderingContext2D.prototype.fillText;

      Reflect.set(
        CanvasRenderingContext2D.prototype,
        "fillText",
        function (
          this: CanvasRenderingContext2D,
          text: string,
          x: number,
          y: number,
          maxWidth?: number,
        ) {
          if (this.canvas.isConnected) {
            const calls = this.canvas.dataset.connectedFillTextCalls;
            this.canvas.dataset.connectedFillTextCalls = calls
              ? `${calls}\n${text}`
              : text;
          }

          return maxWidth === undefined
            ? fillText.call(this, text, x, y)
            : fillText.call(this, text, x, y, maxWidth);
        },
      );
    });
    await page.goto("/puffcade/flappy-puff");

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();
    await page.evaluate(() => {
      for (const canvas of document.querySelectorAll("canvas")) {
        delete canvas.dataset.connectedFillTextCalls;
      }
    });
    await game.getByRole("button", { name: /flap to start/i }).click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let frames = 0;
          const onFrame = () => {
            frames += 1;
            if (frames === 6) {
              resolve();
              return;
            }
            requestAnimationFrame(onFrame);
          };
          requestAnimationFrame(onFrame);
        }),
    );

    const calls = await page.evaluate(() =>
      Array.from(document.querySelectorAll("canvas"))
        .filter((canvas) => canvas.isConnected)
        .flatMap((canvas) =>
          (canvas.dataset.connectedFillTextCalls ?? "")
            .split("\n")
            .filter(Boolean),
        ),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((text) => text === "__/\\__HAM__")).toBe(true);
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

test.describe("Puff Print Run", () => {
  test.beforeEach(async () => {
    await skipUnlessAppUp();
  });

  test("is discoverable from the catalog beside Flappy Puff", async ({
    page,
  }) => {
    await page.goto("/puffcade");

    await expect(
      page.getByRole("link", { name: "Play Flappy Puff" }),
    ).toBeVisible();
    const card = page.getByRole("link", { name: "Play Puff Print Run" });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("href", "/puffcade/puff-print-run");
  });

  test("catalog Link opens the game and native Back returns to the catalog", async ({
    page,
  }) => {
    await page.goto("/puffcade");
    await page.getByRole("link", { name: "Play Puff Print Run" }).click();
    await expect(page).toHaveURL(/\/puffcade\/puff-print-run$/);

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(
      game.getByRole("heading", { level: 1, name: "PUFF PRINT RUN.EXE" }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/puffcade$/);
    await expect(
      page.getByRole("link", { name: "Play Puff Print Run" }),
    ).toBeVisible();
  });

  test("serves at its own route with metadata, fullscreen shell, and start via Space", async ({
    page,
  }) => {
    const response = await page.goto("/puffcade/puff-print-run");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Puff Print Run");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://teamham.world/puffcade/puff-print-run",
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();
    await expect(
      game.getByRole("heading", { level: 1, name: "PUFF PRINT RUN.EXE" }),
    ).toBeVisible();
    await expect(game.locator("[data-puff-print-run-canvas]")).toBeVisible();
    await expect(
      game.getByRole("button", { name: /start the run/i }),
    ).toBeVisible();
    await expect(
      game.getByRole("button", { name: /exit transmission/i }),
    ).toBeVisible();

    await expect(page.locator("body > header")).toBeHidden();

    await page.keyboard.press("Space");
    await expect(
      game.getByRole("button", { name: /start the run/i }),
    ).toHaveCount(0);
  });

  test("Escape pauses while playing and exits from paused", async ({
    page,
  }) => {
    await page.goto("/puffcade/puff-print-run");

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await game.getByRole("button", { name: /start the run/i }).click();

    await page.keyboard.press("Escape");
    await expect(game.getByRole("button", { name: /^resume$/i })).toBeVisible();

    // A second Escape leaves the game instead of resuming it.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/puffcade$/);
    await expect(
      page.locator('[data-arcade-shell="fullscreen"]'),
    ).toHaveCount(0);
  });

  test("shows accessible direction controls at mobile size without covering the exit", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/puffcade/puff-print-run");

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();

    const controls = game.locator("[data-puff-print-run-controls]");
    await expect(controls).toBeVisible();
    for (const name of [/steer up/i, /steer down/i, /steer left/i, /steer right/i]) {
      const button = controls.getByRole("button", { name });
      await expect(button).toBeVisible();
      // Default focusable: no negative tabindex on these real controls.
      await expect(button).not.toHaveAttribute("tabindex", "-1");
      expect(await button.evaluate((el) => el.tabIndex)).toBe(0);
    }

    const canvas = game.locator("[data-puff-print-run-canvas]");
    await expect(canvas).toBeVisible();

    // The arena gets nearly the full viewport width; the controls stack below
    // it rather than sharing its width. Generous floor so this stays
    // non-brittle across small padding changes.
    const canvasBox = await canvas.boundingBox();
    const controlsBox = await controls.boundingBox();
    if (!canvasBox || !controlsBox) {
      throw new Error("The mobile game layout did not produce layout boxes.");
    }
    expect(canvasBox.width).toBeGreaterThanOrEqual(330);
    expect(controlsBox.y).toBeGreaterThanOrEqual(
      canvasBox.y + canvasBox.height,
    );

    // Backing store and CSS box must agree — a mismatch leaves unpainted
    // pixels inside the arena.
    const coherence = await canvas.evaluate((el) => {
      const target = el as HTMLCanvasElement;
      const rect = target.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      return {
        cssWidth: rect.width,
        cssHeight: rect.height,
        backingWidth: target.width,
        backingHeight: target.height,
        ratio,
      };
    });
    expect(
      Math.abs(coherence.backingWidth - coherence.cssWidth * coherence.ratio),
    ).toBeLessThanOrEqual(coherence.ratio + 1);
    expect(
      Math.abs(coherence.backingHeight - coherence.cssHeight * coherence.ratio),
    ).toBeLessThanOrEqual(coherence.ratio + 1);

    await expect(
      game.getByRole("button", { name: /exit transmission/i }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("explicit exit replaces history so Back cannot reopen the game", async ({
    page,
  }) => {
    await page.goto("/puffcade");
    await page.getByRole("link", { name: "Play Puff Print Run" }).click();

    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();

    await game.getByRole("button", { name: /exit transmission/i }).click();
    await expect(page).toHaveURL(/\/puffcade$/);
    await expect(
      page.getByRole("link", { name: "Play Puff Print Run" }),
    ).toBeVisible();

    await page.goBack();
    await expect(page).not.toHaveURL(/\/puffcade\/puff-print-run/);
    await expect(
      page.locator('[data-arcade-shell="fullscreen"]'),
    ).toHaveCount(0);
  });
});
