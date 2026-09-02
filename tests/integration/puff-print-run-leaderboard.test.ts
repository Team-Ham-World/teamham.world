import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/puff/print-run/leaderboard/route";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/crypto";
import * as dbModule from "@/lib/auth/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth/http";
import * as leaderboardModule from "@/lib/puff/print-run-leaderboard";
import { VALID_PROD_ENV, clearAuthEnv, setTestEnv } from "../helpers/test-fixtures";

vi.mock("@/lib/auth/db", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/puff/print-run-leaderboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/puff/print-run-leaderboard")>();
  return {
    ...actual,
    getPrintRunLeaderboard: vi.fn(),
    savePrintRunHighScore: vi.fn(),
  };
});

describe("Puff Print Run leaderboard endpoint", () => {
  const originalEnv = { ...process.env };
  const accountId = "123e4567-e89b-42d3-a456-426614174000";

  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function request(
    method: "GET" | "POST",
    options: {
      token?: string;
      body?: unknown;
      rawBody?: string;
      origin?: string;
      host?: string;
    } = {},
  ): Request {
    const headers: Record<string, string> = {
      "x-forwarded-host": options.host ?? "teamham.world",
      "x-forwarded-proto": "https",
    };
    if (options.token) headers.cookie = `${SESSION_COOKIE_NAME}=${options.token}`;
    if (options.origin) headers.origin = options.origin;
    if (options.body !== undefined || options.rawBody !== undefined) {
      headers["content-type"] = "application/json";
    }
    return new Request("https://teamham.world/api/puff/print-run/leaderboard", {
      method,
      headers,
      body:
        options.rawBody ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  }

  function mockMember(token: string): string {
    vi.mocked(dbModule.verifySession).mockResolvedValueOnce({
      valid: true,
      account: {
        id: accountId,
        accessStatus: "active",
        membershipStatus: "eligible",
        siteRole: "member",
        expiresAt: new Date(Date.now() + 60_000),
        username: "hamfriend",
      },
    });
    return hashSessionToken(token);
  }

  function expectProtected(response: Response): void {
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(response.headers.get("vary")?.toLowerCase()).toContain("cookie");
  }

  it.each(["disabled", "invalid"])(
    "returns a protected generic 404 when auth mode is %s",
    async (mode) => {
      if (mode === "disabled") setTestEnv({ AUTH_MODE: "disabled" });
      else process.env.AUTH_MODE = "unexpected";

      const response = await GET(request("GET"));

      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
      expect(dbModule.verifySession).not.toHaveBeenCalled();
      expect(leaderboardModule.getPrintRunLeaderboard).not.toHaveBeenCalled();
      expectProtected(response);
    },
  );

  it("keeps initially signed-out GET requests private without a board query", async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: false,
      username: null,
      personalBest: 0,
      scores: [],
    });
    expect(dbModule.verifySession).not.toHaveBeenCalled();
    expect(leaderboardModule.getPrintRunLeaderboard).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it("treats an invalid, expired, or no-longer-eligible session as signed out", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    vi.mocked(dbModule.verifySession).mockResolvedValueOnce({ valid: false });

    const response = await GET(request("GET", { token }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: false,
      username: null,
      personalBest: 0,
      scores: [],
    });
    expect(leaderboardModule.getPrintRunLeaderboard).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it("returns the authenticated Print Run snapshot without exposing an identifier", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    const tokenHash = mockMember(token);
    vi.mocked(leaderboardModule.getPrintRunLeaderboard).mockResolvedValueOnce({
      personalBest: 25,
      scores: [{ rank: 1, username: "hamfriend", score: 25, mine: true }],
    });

    const response = await GET(request("GET", { token }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      authenticated: true,
      username: "hamfriend",
      personalBest: 25,
      scores: [{ rank: 1, username: "hamfriend", score: 25, mine: true }],
    });
    expect(payload).not.toHaveProperty("game");
    expect(payload).not.toHaveProperty("table");
    expect(dbModule.verifySession).toHaveBeenCalledWith(tokenHash, expect.any(String));
    expect(leaderboardModule.getPrintRunLeaderboard).toHaveBeenCalledWith(
      accountId,
      expect.any(String),
    );
    expectProtected(response);
  });

  it("degrades an authenticated GET eligibility race to the signed-out payload", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);
    vi.mocked(leaderboardModule.getPrintRunLeaderboard).mockResolvedValueOnce(null);

    const response = await GET(request("GET", { token }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: false,
      username: null,
      personalBest: 0,
      scores: [],
    });
    expectProtected(response);
  });

  it("rejects an invalid production host before session or board work", async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await GET(request("GET", { host: "evil.example" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request_host" });
    expect(dbModule.verifySession).not.toHaveBeenCalled();
    expect(leaderboardModule.getPrintRunLeaderboard).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it("requires authentication before accepting a score", async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await POST(
      request("POST", { body: { score: 25 }, origin: "https://teamham.world" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication_required" });
    expect(leaderboardModule.savePrintRunHighScore).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it.each([undefined, "https://evil.example"])(
    "rejects a missing or wrong score-submission origin (%s)",
    async (origin) => {
      setTestEnv(VALID_PROD_ENV);
      const token = generateSessionToken();
      mockMember(token);

      const response = await POST(request("POST", { token, body: { score: 25 }, origin }));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "invalid_request_origin" });
      expect(leaderboardModule.savePrintRunHighScore).not.toHaveBeenCalled();
      expectProtected(response);
    },
  );

  it("rejects malformed JSON separately from invalid score bodies", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);

    const response = await POST(
      request("POST", {
        token,
        rawBody: "{not-json",
        origin: "https://teamham.world",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request_body" });
    expect(leaderboardModule.savePrintRunHighScore).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it.each([
    [{ score: 25, extra: true }, "extra key"],
    [{ score: -5 }, "below range"],
    [{ score: 1_000_005 }, "above range"],
    [{ score: 24 }, "nonmultiple"],
    [{ score: 2.5 }, "fraction"],
    [{ score: "25" }, "wrong type"],
  ])("rejects an invalid score body: %s (%s)", async (body, _label) => {
    void _label;
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);

    const response = await POST(
      request("POST", { token, body, origin: "https://teamham.world" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_score" });
    expect(leaderboardModule.savePrintRunHighScore).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it("returns 401 when eligibility changes during a save", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);
    vi.mocked(leaderboardModule.savePrintRunHighScore).mockResolvedValueOnce(null);

    const response = await POST(
      request("POST", { token, body: { score: 25 }, origin: "https://teamham.world" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication_required" });
    expect(leaderboardModule.getPrintRunLeaderboard).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it("returns 401 when eligibility changes while refreshing after a save", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);
    vi.mocked(leaderboardModule.savePrintRunHighScore).mockResolvedValueOnce(25);
    vi.mocked(leaderboardModule.getPrintRunLeaderboard).mockResolvedValueOnce(null);

    const response = await POST(
      request("POST", { token, body: { score: 25 }, origin: "https://teamham.world" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication_required" });
    expectProtected(response);
  });

  it("saves a score and returns the refreshed snapshot", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);
    vi.mocked(leaderboardModule.savePrintRunHighScore).mockResolvedValueOnce(30);
    vi.mocked(leaderboardModule.getPrintRunLeaderboard).mockResolvedValueOnce({
      personalBest: 30,
      scores: [{ rank: 1, username: "hamfriend", score: 30, mine: true }],
    });

    const response = await POST(
      request("POST", { token, body: { score: 30 }, origin: "https://teamham.world" }),
    );

    expect(response.status).toBe(200);
    expect(leaderboardModule.savePrintRunHighScore).toHaveBeenCalledWith(
      accountId,
      30,
      expect.any(String),
    );
    expect(await response.json()).toEqual({
      authenticated: true,
      username: "hamfriend",
      personalBest: 30,
      scores: [{ rank: 1, username: "hamfriend", score: 30, mine: true }],
    });
    expectProtected(response);
  });

  it.each(["session", "get", "save"])(
    "turns unexpected %s database failures into a protected generic 503",
    async (failure) => {
      setTestEnv(VALID_PROD_ENV);
      const token = generateSessionToken();

      let response: Response;
      if (failure === "session") {
        vi.mocked(dbModule.verifySession).mockRejectedValueOnce(new Error("database detail"));
        response = await GET(request("GET", { token }));
      } else if (failure === "get") {
        mockMember(token);
        vi.mocked(leaderboardModule.getPrintRunLeaderboard).mockRejectedValueOnce(
          new Error("database detail"),
        );
        response = await GET(request("GET", { token }));
      } else {
        mockMember(token);
        vi.mocked(leaderboardModule.savePrintRunHighScore).mockRejectedValueOnce(
          new Error("database detail"),
        );
        response = await POST(
          request("POST", { token, body: { score: 25 }, origin: "https://teamham.world" }),
        );
      }

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "service_unavailable" });
      expectProtected(response);
    },
  );
});
