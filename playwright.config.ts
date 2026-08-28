import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E harness for the member-page V2 editor.
 *
 * Scope rules for this suite (see docs/LOCAL_TESTING.md):
 * - It only ever talks to the local disposable stack: the app at
 *   https://localhost:3000 and the disposable VPS test database reached over
 *   loopback. It refuses to run against any other host.
 * - HTTPS certificate handling stays inside this config
 *   (`ignoreHTTPSErrors` for the locally generated development CA). The
 *   application keeps serving real HTTPS.
 * - External services are named requirements. When one is absent the tests
 *   skip with a message that says exactly what is missing; the suite never
 *   fakes a pass.
 * - Test artifacts (traces, screenshots) are written to the OS temp directory
 *   so the repository tree stays clean.
 */

const baseURL = process.env.E2E_BASE_URL ?? "https://localhost:3000";

function assertLocalBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`E2E_BASE_URL is not a valid URL: ${value}`);
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (parsed.protocol !== "https:" || !loopback) {
    throw new Error(
      `E2E_BASE_URL refused: this suite only runs against the local HTTPS development origin (https://localhost:<port>), not "${value}".`,
    );
  }
  return value;
}

const artifactsDir = path.join(os.tmpdir(), "teamham-e2e-artifacts");

export default defineConfig({
  testDir: "./tests/e2e",
  // `.e2e.ts` keeps these files out of the Vitest default include
  // (`**/*.{test,spec}.*`), so `npm test` never tries to run browser tests.
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  // One deterministic worker: the fixture owns a single seeded account, page,
  // and session, and cleanup runs against those exact rows.
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["./tests/e2e/support/requirement-reporter.ts"]],
  outputDir: path.join(artifactsDir, "test-results"),
  use: {
    baseURL: assertLocalBaseUrl(baseURL),
    // Local development certificate (Next and MinIO share one localhost CA).
    // This is Playwright-only trust handling; it does not change the app.
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    navigationTimeout: 90_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
