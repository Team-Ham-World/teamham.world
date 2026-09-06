import { test, expect, ownerContext } from "./support/fixture";
import { skipUnlessAppUp, skipWithoutDatabase } from "./support/skip";
import { getDailyWord, PUFFDLE_TARGET_WORDS } from "../../src/lib/puffdle/words";

const path = "/puffcade/puffdle";
const enter = { name: "ENTER", exact: true };

test.describe("Puffdle account daily games", () => {
  test.beforeEach(async () => { skipWithoutDatabase(); await skipUnlessAppUp(); });

  test("resumes every guess on another device and cannot replay a finished daily", async ({ browser, member }) => {
    const first = await ownerContext(browser, member.sessionToken);
    const second = await ownerContext(browser, member.sessionToken);
    try {
      const a = await first.newPage();
      await a.goto(path);
      await expect(a.getByRole("button", enter)).toBeEnabled();
      const initial = await (await a.request.get("/api/puffdle/daily")).json();
      const answer = getDailyWord(`${initial.puzzleDate}T00:00:00Z`).word.toUpperCase();
      const wrong = PUFFDLE_TARGET_WORDS.find(w => w.toUpperCase() !== answer)!;
      await a.keyboard.type(wrong);
      const saved = a.waitForResponse(r => r.url().endsWith("/api/puffdle/daily") && r.request().method() === "POST");
      await a.keyboard.press("Enter");
      expect((await saved).status()).toBe(200);
      const b = await second.newPage();
      await b.goto(path);
      await expect(b.getByRole("button", enter)).toBeEnabled();
      const rows = b.getByRole("main", { name: "Wordle guess board" }).locator(":scope > div");
      await expect(rows.first()).toHaveText(wrong.toUpperCase());
      await b.keyboard.type(answer);
      await b.keyboard.press("Enter");
      await expect(b.getByRole("heading", { name: "TRANSMISSION DECODED" })).toBeVisible();
      await a.reload();
      await expect(a.getByRole("heading", { name: "TRANSMISSION DECODED" })).toBeVisible();
      await a.keyboard.press("Escape");
      await expect(a.getByRole("button", enter)).toBeDisabled();
      expect(await (await a.request.get("/api/puffdle/leaderboard")).json()).toMatchObject({ personalBest: 500, stats: { gamesPlayed: 1, gamesWon: 1 } });
      await a.evaluate(() => localStorage.clear());
      await a.reload();
      await expect(a.getByRole("heading", { name: "TRANSMISSION DECODED" })).toBeVisible();
    } finally { await first.close(); await second.close(); }
  });

  test("recovers a committed guess after its response is lost without adding an attempt", async ({ browser, member }) => {
    const context = await ownerContext(browser, member.sessionToken);
    try {
      const page = await context.newPage();
      let drop = true;
      await page.route("**/api/puffdle/daily", async route => {
        if (route.request().method() === "POST" && drop) {
          drop = false;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await page.goto(path);
      await expect(page.getByRole("button", enter)).toBeEnabled();
      const initial = await (await page.request.get("/api/puffdle/daily")).json();
      await page.keyboard.type(getDailyWord(`${initial.puzzleDate}T00:00:00Z`).word);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Retry daily game" })).toBeVisible();
      await expect(page.getByRole("button", enter)).toBeDisabled();
      await page.getByRole("button", { name: "Retry daily game" }).click();
      await expect(page.getByRole("heading", { name: "TRANSMISSION DECODED" })).toBeVisible();
      expect(await (await page.request.get("/api/puffdle/daily")).json()).toMatchObject({ game: { guesses: [getDailyWord(`${initial.puzzleDate}T00:00:00Z`).word.toUpperCase()] }, stats: { gamesPlayed: 1 } });
    } finally { await context.close(); }
  });

  test("a stale device adopts accepted progress and session loss disables play", async ({ browser, member }) => {
    const first = await ownerContext(browser, member.sessionToken);
    const second = await ownerContext(browser, member.sessionToken);
    try {
      const a = await first.newPage(); const b = await second.newPage();
      await a.goto(path); await b.goto(path);
      await expect(a.getByRole("button", enter)).toBeEnabled();
      await expect(b.getByRole("button", enter)).toBeEnabled();
      const initial = await (await a.request.get("/api/puffdle/daily")).json();
      const answer = getDailyWord(`${initial.puzzleDate}T00:00:00Z`).word.toUpperCase();
      const wrong = PUFFDLE_TARGET_WORDS.filter(w => w.toUpperCase() !== answer).slice(0, 2);
      await a.keyboard.type(wrong[0]);
      const saved = a.waitForResponse(r => r.url().endsWith("/api/puffdle/daily") && r.request().method() === "POST");
      await a.keyboard.press("Enter"); await saved;
      await b.keyboard.type(wrong[1]);
      await b.keyboard.press("Enter");
      await expect(b.getByText(/Your daily game changed on another device/)).toBeVisible();
      await expect(b.getByRole("main", { name: "Wordle guess board" }).locator(":scope > div").first()).toHaveText(wrong[0].toUpperCase());
      expect((await (await b.request.get("/api/puffdle/daily")).json()).game.guesses).toHaveLength(1);
      await second.clearCookies();
      await b.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(b.getByText(/to play one Daily Puffdle per UTC day/)).toBeVisible();
      await expect(b.getByRole("button", enter)).toBeDisabled();
    } finally { await first.close(); await second.close(); }
  });

  test("uses the server date even when the device clock changes", async ({ browser, member }) => {
    const context = await ownerContext(browser, member.sessionToken);
    try {
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.getByRole("button", enter)).toBeEnabled();
      const before = await (await page.request.get("/api/puffdle/daily")).json();
      await page.clock.setFixedTime(new Date("2030-01-01T12:00:00Z"));
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.getByText(`DAILY TRANSMISSION #${before.game.dayNumber}`, { exact: true })).toBeVisible();
    } finally { await context.close(); }
  });
});

test("guests must sign in for Daily and can play Unlimited", async ({ page }) => {
  await skipUnlessAppUp();
  await page.goto(path);
  await expect(page.getByText(/to play one Daily Puffdle per UTC day/)).toBeVisible();
  await expect(page.getByRole("button", enter)).toBeDisabled();
  await page.getByRole("tab", { name: "PUFFDLE UNLIMITED", exact: true }).click();
  await expect(page.getByRole("button", enter)).toBeEnabled();
  await page.keyboard.type("CRANE");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main", { name: "Wordle guess board" }).locator(":scope > div").first()).toHaveText("CRANE");
});
