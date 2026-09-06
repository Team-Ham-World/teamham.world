import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/puffdle/daily/route";
import { generateSessionToken } from "@/lib/auth/crypto";
import { verifySession } from "@/lib/auth/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth/http";
import { getDailyGame, submitDailyGuess } from "@/lib/puffdle/daily";
import { VALID_PROD_ENV, clearAuthEnv, setTestEnv } from "../helpers/test-fixtures";

vi.mock("@/lib/auth/db", () => ({ verifySession: vi.fn() }));
vi.mock("@/lib/puffdle/daily", async original => ({ ...await original<typeof import("@/lib/puffdle/daily")>(), getDailyGame: vi.fn(), submitDailyGuess: vi.fn() }));
const accountId = "123e4567-e89b-42d3-a456-426614174000";
const payload = { accountId, puzzleDate: "2026-09-06", revision: 0, guess: "CRANE" };
function request(method: "GET" | "POST", body?: unknown, origin = "https://teamham.world", signedIn = true) {
  return new Request("https://teamham.world/api/puffdle/daily", { method, headers: {
    "x-forwarded-host": "teamham.world", "x-forwarded-proto": "https", origin,
    "content-type": "application/json", ...(signedIn ? { cookie: `${SESSION_COOKIE_NAME}=${generateSessionToken()}` } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}
describe("Daily Puffdle API", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.clearAllMocks(); clearAuthEnv(); setTestEnv(VALID_PROD_ENV);
    vi.mocked(verifySession).mockResolvedValue({ valid: true, account: { id: accountId, accessStatus: "active", membershipStatus: "eligible", siteRole: "member", expiresAt: new Date(Date.now() + 60000), username: "hamfriend" } });
  });
  afterEach(() => { process.env = { ...env }; });
  it("requires a session and never creates a guest game", async () => {
    expect(await (await GET(request("GET", undefined, undefined, false))).json()).toEqual({ authenticated: false });
    expect((await POST(request("POST", payload, undefined, false))).status).toBe(401);
    expect(getDailyGame).not.toHaveBeenCalled(); expect(submitDailyGuess).not.toHaveBeenCalled();
  });
  it("rejects foreign origins and invalid revisions or words", async () => {
    expect((await POST(request("POST", payload, "https://other.example"))).status).toBe(403);
    for (const invalid of [{ ...payload, revision: -1 }, { ...payload, revision: 6 }, { ...payload, revision: 1.5 }, { ...payload, guess: "ZZZZZ" }, { ...payload, accountId: "invalid" }]) {
      expect((await POST(request("POST", invalid))).status).toBe(400);
    }
    expect(submitDailyGuess).not.toHaveBeenCalled();
  });
  it("returns canonical state for stale-device conflicts and never caches it", async () => {
    vi.mocked(submitDailyGuess).mockResolvedValue({ conflict: true, snapshot: { authenticated: true } as Awaited<ReturnType<typeof getDailyGame>> });
    const response = await POST(request("POST", payload));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(submitDailyGuess).toHaveBeenCalledWith(accountId, payload, expect.any(String));
  });
  it("fails closed when persistence is unavailable", async () => {
    vi.mocked(getDailyGame).mockRejectedValue(new Error("Unavailable"));
    vi.mocked(submitDailyGuess).mockRejectedValue(new Error("Unavailable"));
    expect((await GET(request("GET"))).status).toBe(503);
    expect((await POST(request("POST", payload))).status).toBe(503);
  });
});
