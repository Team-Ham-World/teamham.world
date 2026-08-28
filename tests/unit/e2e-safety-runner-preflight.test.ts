import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Focused regression checks for the run-e2e-vps.sh app preflight: a core app
 * outage must fail the runner nonzero BEFORE Playwright (and before any
 * tunnel infrastructure), never produce a green all-skipped run.
 */

const scriptPath = path.resolve(__dirname, "../../scripts/e2e/run-e2e-vps.sh");

/** Finds a loopback port that is currently closed. */
function findClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

function runRunner(extraEnv: Record<string, string>) {
  return spawnSync("bash", [scriptPath], {
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("e2e runner app preflight", () => {
  it(
    "fails nonzero and names the missing app when nothing answers at the app origin",
    async () => {
      const port = await findClosedPort();
      const result = runRunner({ E2E_BASE_URL: `https://127.0.0.1:${port}` });

      expect(result.status, `stderr was: ${result.stderr}`).not.toBeNull();
      expect(result.status, `stderr was: ${result.stderr}`).not.toBe(0);
      // The failure names the app and how to provide it.
      expect(result.stderr).toContain("nothing is answering");
      expect(result.stderr).toContain("npm run dev:vps");
      // It failed BEFORE infrastructure or Playwright were touched: no SSH
      // tunnel attempt, no Playwright invocation in the output.
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).not.toMatch(/tunnel/i);
      expect(output).not.toMatch(/playwright/i);
    },
    30_000,
  );

  it(
    "refuses non-loopback and non-HTTPS app origins before anything else runs",
    async () => {
      for (const refused of [
        "http://localhost:3000",
        "https://example.com",
        "https://e2e.example.cyr1en.dev",
      ]) {
        const result = runRunner({ E2E_BASE_URL: refused });
        expect(
          result.status,
          `E2E_BASE_URL=${refused} should be refused; stderr was: ${result.stderr}`,
        ).not.toBeNull();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("E2E_BASE_URL refused");
        const output = `${result.stdout}\n${result.stderr}`;
        expect(output).not.toMatch(/tunnel/i);
        expect(output).not.toMatch(/playwright/i);
      }
    },
    30_000,
  );
});
