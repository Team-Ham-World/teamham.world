import { test, expect, ownerContext } from "./support/fixture";
import { skipUnlessAppUp, skipWithoutDatabase } from "./support/skip";
import { getDailyWord, PUFFDLE_TARGET_WORDS } from "../../src/lib/puffdle/words";

const path = "/puffcade/puffdle";

test.describe("Puffdle member scores", () => {
  test.beforeEach(async () => { skipWithoutDatabase(); await skipUnlessAppUp(); });

  test("saves a solved game and reads the same score after reloading", async ({ browser, member }) => {
    const context = await ownerContext(browser, member.sessionToken);
    try {
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.getByRole("button", { name: "ENTER", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Member leaderboard" }).click();
      await expect(page.getByText("MEMBER: e2e.playwright", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "CLOSE", exact: true }).click();
      await page.locator("h1").click();
      await page.keyboard.type(getDailyWord().word);
      const save = page.waitForResponse(response => response.url().endsWith("/api/puffdle/leaderboard") && response.request().method() === "POST");
      await page.keyboard.press("Enter");
      const response = await save;
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ personalBest: 600, stats: { gamesPlayed: 1, gamesWon: 1, currentStreak: 1 } });
      await expect(page.getByText("Result saved to the member board.")).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: "TRANSMISSION DECODED" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Member leaderboard" }).click();
      await expect(page.getByText("HIGH SCORE: 600 PTS", { exact: true })).toBeVisible();
      await expect(page.getByText("e2e.playwright", { exact: true })).toBeVisible();
    } finally { await context.close(); }
  });

  test("shows a failed save and retries it without duplicating statistics", async ({ browser, member }) => {
    const context = await ownerContext(browser, member.sessionToken);
    try {
      const page = await context.newPage();
      let fail = true;
      await page.route("**/api/puffdle/leaderboard", async route => {
        if (route.request().method() === "POST" && fail) {
          fail = false;
          await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"service_unavailable"}' });
        } else await route.continue();
      });
      await page.goto(path);
      await expect(page.getByRole("button", { name: "ENTER", exact: true })).toBeEnabled();
      await page.keyboard.type(getDailyWord().word);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Retry save" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "TRANSMISSION DECODED" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Retry save" }).click();
      await expect(page.getByText("Result saved to the member board.")).toBeVisible();
      const response = await page.request.get("/api/puffdle/leaderboard");
      expect(await response.json()).toMatchObject({ personalBest: 600, stats: { gamesPlayed: 1, gamesWon: 1 } });
    } finally { await context.close(); }
  });

  test("queues a result until the initial member lookup finishes", async ({ browser, member }) => {
    const context = await ownerContext(browser, member.sessionToken);
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      const page = await context.newPage();
      let started = () => {};
      const lookupStarted = new Promise<void>(resolve => { started = resolve; });
      let first = true;
      await page.route("**/api/puffdle/leaderboard", async route => {
        if (route.request().method() === "GET" && first) {
          first = false;
          const response = await route.fetch();
          started();
          await gate;
          await route.fulfill({ response });
        } else await route.continue();
      });
      await page.goto(path);
      await expect(page.getByRole("button", { name: "ENTER", exact: true })).toBeEnabled();
      await lookupStarted;
      await page.keyboard.type(getDailyWord().word);
      await page.keyboard.press("Enter");
      await expect(page.getByText(/SOLVED IN 1 GUESSES!/)).toBeVisible();
      release();
      await expect(page.getByText("Result saved to the member board.")).toBeVisible();
      expect(await (await page.request.get("/api/puffdle/leaderboard")).json()).toMatchObject({ personalBest: 600 });
    } finally { release(); await context.close(); }
  });

  test("records a loss on the member board", async ({ browser, member }) => {
    const context = await ownerContext(browser, member.sessionToken);
    try {
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.getByRole("button", { name: "ENTER", exact: true })).toBeEnabled();
      const target = getDailyWord().word.toLowerCase();
      const guesses = PUFFDLE_TARGET_WORDS.filter(word => word.toLowerCase() !== target).slice(0, 6);
      for (const guess of guesses) {
        await page.keyboard.type(guess);
        await page.keyboard.press("Enter");
      }
      await expect(page.getByText("Result saved to the member board.")).toBeVisible();
      const response = await page.request.get("/api/puffdle/leaderboard");
      expect(await response.json()).toMatchObject({ personalBest: 0, stats: { gamesPlayed: 1, gamesWon: 0, currentStreak: 0 } });
    } finally { await context.close(); }
  });
});

test.describe("Puffdle browser resilience", () => {
  test.beforeEach(async () => { await skipUnlessAppUp(); });

  test("refreshes the daily puzzle when an open page crosses UTC midnight", async ({ page }) => {
    const before = new Date("2026-09-06T23:59:59Z");
    const after = new Date("2026-09-07T00:00:01Z");
    await page.clock.setFixedTime(before);
    await page.goto(path);
    await expect(page.getByRole("button", { name: "ENTER", exact: true })).toBeEnabled();
    await expect(page.getByText(`DAILY TRANSMISSION #${getDailyWord(before).dayNumber}`, { exact: true })).toBeVisible();
    await page.clock.setFixedTime(after);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText(`DAILY TRANSMISSION #${getDailyWord(after).dayNumber}`, { exact: true })).toBeVisible();
  });

  test("recovers from malformed local data and can start Unlimited after a finished daily game", async ({ page }) => {
    const daily = getDailyWord();
    await page.addInitScript(({ daily }) => {
      localStorage.setItem("ham:puffdle:stats:v1", JSON.stringify({ gamesPlayed: 1, gamesWon: 1, guessDistribution: {} }));
      localStorage.setItem(`ham:puffdle:daily:v1:${daily.dayNumber}`, JSON.stringify({
        mode: "daily", targetWord: daily.word, dayNumber: daily.dayNumber,
        guesses: [daily.word], currentGuess: "", evaluations: null, keyboardStatus: null, pointsEarned: 99999,
      }));
    }, { daily });
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "TRANSMISSION DECODED" })).toBeVisible();
    await page.getByRole("button", { name: "TRY UNLIMITED" }).click();
    await expect(page.getByRole("heading", { name: "TRANSMISSION DECODED" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "PUFFDLE UNLIMITED", exact: true })).toHaveAttribute("aria-selected", "true");
  });
});
