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

  type E2EPage = import("@playwright/test").Page;
  type GameLocator = ReturnType<E2EPage["locator"]>;
  const POSITIVE_RUN_SEED = 2161;

  async function setGameSeed(page: E2EPage, seed: number) {
    await page.addInitScript({ content: `Date.now = () => ${seed};` });
  }

  async function startRun(page: E2EPage): Promise<GameLocator> {
    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await game.getByRole("button", { name: /start the run/i }).click();
    return game;
  }
  async function waitForJam(game: GameLocator) {
    await expect(game.getByText("PAPER JAM", { exact: true })).toBeVisible({
      timeout: 20000,
    });
  }
  // Seed 0x48414d puts the first pickup at (18, 0), away from a straight run.
  async function zeroScoreJam(page: E2EPage) {
    const game = await startRun(page);
    await waitForJam(game);
    return game;
  }
  // The mounted run uses the engine's default seed. Replaying uses Date.now,
  // where seed 2161 puts the first pickup at (12, 8), one cell ahead of Puff.
  async function positiveScoreJam(page: E2EPage) {
    expect(await page.evaluate(() => Date.now())).toBe(POSITIVE_RUN_SEED);
    const game = await startRun(page);
    await waitForJam(game);
    await game.getByRole("button", { name: /run it again/i }).click();
    await expect(game.getByText("PAPER JAM", { exact: true })).toHaveCount(0);
    await waitForJam(game);
    await expect
      .poll(() =>
        game.evaluate(() =>
          window.localStorage.getItem("ham:puff-print-run:best:v1"),
        ),
      )
      .toBe("10");
    return game;
  }

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

    // Horizontal and vertical backing scales must agree. The renderer caps
    // devicePixelRatio for performance, so raw DPR is not the expected scale.
    await expect
      .poll(async () =>
        canvas.evaluate((el) => {
          if (!(el instanceof HTMLCanvasElement)) return Number.POSITIVE_INFINITY;
          const rect = el.getBoundingClientRect();
          const widthScale = el.width / rect.width;
          const heightScale = el.height / rect.height;
          return Math.abs(widthScale - heightScale);
        }),
      )
      .toBeLessThan(0.02);

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

  test("renders the member board and combined best for a signed-in player", async ({
    page,
  }) => {
    await setGameSeed(page, 0x48414d);
    let posts = 0;
    await page.route("/api/puff/print-run/leaderboard", async (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authenticated: true,
            username: "puffmaster",
            personalBest: 90,
            scores: [
              { rank: 1, username: "puffmaster", score: 90, mine: true },
            ],
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          username: "puffmaster",
          personalBest: 45,
          scores: [
            { rank: 1, username: "puffmaster", score: 45, mine: true },
            { rank: 2, username: "typesetter", score: 30, mine: false },
          ],
        }),
      });
    });

    await page.goto("/puffcade/puff-print-run");
    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();

    // HUD carries member identity and the combined best (45 from the member
    // record; no local storage entry beats it yet).
    await expect(game.getByText(/member: puffmaster/i)).toBeVisible();
    const stats = game.locator('[aria-label="Current game statistics"]');
    await expect(stats).toContainText("45");

    // Finish a deterministic zero run: the board shows member rows with the
    // mine highlight, and nothing is posted for a scoreless jam.
    await zeroScoreJam(page);
    await expect(
      game.getByText(/member high scores/i),
    ).toBeVisible();
    await expect(game.getByText("LIVE", { exact: true })).toBeVisible();
    await expect(
      game.getByRole("list", { name: /member leaderboard/i }),
    ).toBeVisible();
    await expect(game.getByText("typesetter")).toBeVisible();
    expect(posts).toBe(0);
    await expect(stats).toContainText("45");
  });

  test("falls back to a non-blocking error card when the board payload is malformed", async ({
    page,
  }) => {
    // Rank 0 is outside the Print Run board contract and score 7 is not a
    // 5-point step; both must be rejected without breaking the run.
    await page.route("**/api/puff/print-run/leaderboard**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          username: "puffmaster",
          personalBest: 7,
          scores: [{ rank: 0, username: "puffmaster", score: 45, mine: true }],
        }),
      });
    });

    await page.goto("/puffcade/puff-print-run");
    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();
    // The run still plays in local mode; the board reports the printer error.
    await expect(game.getByText(/local run/i)).toBeVisible();

    await game.getByRole("button", { name: /start the run/i }).click();
    await expect(game.getByText("PAPER JAM", { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(game.getByText("LOCKED", { exact: true })).toBeVisible();
    await expect(
      game.getByText(/score printer is offline/i),
    ).toBeVisible();
  });

  test("queues a score finished during the board load and posts it once after auth resolves", async ({
    page,
  }) => {
    await setGameSeed(page, POSITIVE_RUN_SEED);
    // Hold the initial GET so a positive run can complete while the board is
    // still loading; releasing it must trigger exactly one POST and a refresh.
    let resolveGet: (() => void) | null = null;
    let posts = 0;
    await page.route("/api/puff/print-run/leaderboard", async (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            authenticated: true,
            username: "puffmaster",
            personalBest: 10,
            scores: [{ rank: 1, username: "puffmaster", score: 10, mine: true }],
          }),
        });
        return;
      }
      await new Promise<void>((resolve) => {
        resolveGet = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          username: "puffmaster",
          personalBest: 0,
          scores: [],
        }),
      });
    });

    await page.goto("/puffcade/puff-print-run");
    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game).toBeVisible();

    // The GET is held; a positive run completes while the board is loading.
    const run = await positiveScoreJam(page);
    expect(posts).toBe(0);

    // Releasing the authenticated GET flushes the queued score exactly once.
    resolveGet!();
    await expect
      .poll(() => posts, { timeout: 10000 })
      .toBe(1);
    // The board reflects the POST result: live, with the updated member row.
    await expect(run.getByText("LIVE", { exact: true })).toBeVisible();
    await expect(
      run.getByRole("list", { name: /member leaderboard/i }),
    ).toContainText("puffmaster");
    expect(posts).toBe(1);
  });

  test("does not submit a queued score after leaving during the board load", async ({
    page,
  }) => {
    await setGameSeed(page, POSITIVE_RUN_SEED);
    let resolveGet: (() => void) | null = null;
    let posts = 0;
    await page.route("/api/puff/print-run/leaderboard", async (route) => {
      if (route.request().method() === "POST") {
        posts += 1;
        await route.fulfill({ status: 204 });
        return;
      }
      await new Promise<void>((resolve) => {
        resolveGet = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          username: "puffmaster",
          personalBest: 0,
          scores: [],
        }),
      });
    });

    await page.goto("/puffcade/puff-print-run");
    const game = await positiveScoreJam(page);
    expect(posts).toBe(0);

    await game.getByRole("button", { name: /back to ham/i }).click();
    await expect(page).toHaveURL(/\/puffcade$/);
    resolveGet!();
    await page.waitForTimeout(500);
    expect(posts).toBe(0);
  });

  test("locks the board on a mid-run sign-out while keeping the local best", async ({
    page,
  }) => {
    await setGameSeed(page, POSITIVE_RUN_SEED);
    // GET reports an authenticated member; POST answers 401 so the board must
    // drop to the signed-out/locked state without touching the local best.
    await page.route("/api/puff/print-run/leaderboard", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "authentication_required" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          username: "puffmaster",
          personalBest: 45,
          scores: [{ rank: 1, username: "puffmaster", score: 45, mine: true }],
        }),
      });
    });

    await page.goto("/puffcade/puff-print-run");
    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game.getByText(/member: puffmaster/i)).toBeVisible();

    const run = await positiveScoreJam(page);
    // The 401 locks the board into the signed-out state…
    await expect(run.getByText("LOCKED", { exact: true })).toBeVisible();
    // …and the local run's best survives in the results card.
    await expect(run.getByText(/best print:/i)).toContainText("10");
  });

  test("keeps the local best and restart after the member board save fails", async ({
    page,
  }) => {
    await setGameSeed(page, POSITIVE_RUN_SEED);
    // GET authenticates; POST 503s. The run keeps its local best, shows the
    // non-blocking fallback, and stays replayable in live member mode.
    await page.route("/api/puff/print-run/leaderboard", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "service_unavailable" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          username: "puffmaster",
          personalBest: 45,
          scores: [{ rank: 1, username: "puffmaster", score: 45, mine: true }],
        }),
      });
    });

    await page.goto("/puffcade/puff-print-run");
    const game = page.locator('[data-arcade-shell="fullscreen"]');
    await expect(game.getByText(/member: puffmaster/i)).toBeVisible();

    const run = await positiveScoreJam(page);
    // The fallback announcement reports a local save without locking the board.
    await expect(run.getByText("LIVE", { exact: true })).toBeVisible();
    await expect(
      run.getByText(/score saved locally/i),
    ).toBeVisible();
    // localStorage kept the run's best; localStorage score is preserved.
    expect(
      await run.evaluate(() =>
        window.localStorage.getItem("ham:puff-print-run:best:v1"),
      ),
    ).toBe("10");

    // The game is still usable: restart begins a fresh run.
    await run.getByRole("button", { name: /run it again/i }).click();
    await expect(
      run.getByText("PAPER JAM", { exact: true }),
    ).toHaveCount(0);
    await expect(
      run.getByRole("button", { name: /start the run/i }),
    ).toHaveCount(0);
  });
});
