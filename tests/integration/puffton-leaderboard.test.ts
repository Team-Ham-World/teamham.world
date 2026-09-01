import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/puffton/leaderboard/route";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/crypto";
import * as dbModule from "@/lib/auth/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth/http";
import * as leaderboardModule from "@/lib/puffton/leaderboard";
import {
  VALID_PROD_ENV,
  clearAuthEnv,
  setTestEnv,
} from "../helpers/test-fixtures";

vi.mock("@/lib/auth/db", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/puffton/leaderboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/puffton/leaderboard")>();
  return {
    ...actual,
    getPufftonLeaderboard: vi.fn(),
    savePufftonScore: vi.fn(),
  };
});

describe("Puffton leaderboard endpoint", () => {
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
    options: { token?: string; body?: unknown; origin?: string } = {},
  ): Request {
    const headers: Record<string, string> = {
      "x-forwarded-host": "teamham.world",
      "x-forwarded-proto": "https",
    };
    if (options.token) headers.cookie = `${SESSION_COOKIE_NAME}=${options.token}`;
    if (options.origin) headers.origin = options.origin;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    return new Request("https://teamham.world/api/puffton/leaderboard", {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  }

  function mockMember(token: string) {
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

  it("returns a generic 404 when membership auth is disabled", async () => {
    setTestEnv({ AUTH_MODE: "disabled" });

    const response = await GET(request("GET"));

    expect(response.status).toBe(404);
    expect(dbModule.verifySession).not.toHaveBeenCalled();
    expect(leaderboardModule.getPufftonLeaderboard).not.toHaveBeenCalled();
  });

  it("returns anonymous stats payload for unauthenticated GET request", async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await GET(request("GET"));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.authenticated).toBe(false);
    expect(data.username).toBeNull();
    expect(data.personalBest).toBe(0);
    expect(data.scores).toEqual([]);
  });

  it("returns member leaderboard for authenticated session", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);

    vi.mocked(leaderboardModule.getPufftonLeaderboard).mockResolvedValueOnce({
      personalBest: 12,
      stats: { gamesPlayed: 5, gamesWon: 4, totalVp: 48, currentStreak: 3, maxStreak: 3 },
      scores: [
        {
          rank: 1,
          username: "hamfriend",
          score: 12,
          gamesPlayed: 5,
          gamesWon: 4,
          totalVp: 48,
          currentStreak: 3,
          maxStreak: 3,
          mine: true,
        },
      ],
    });

    const response = await GET(request("GET", { token }));
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.authenticated).toBe(true);
    expect(data.username).toBe("hamfriend");
    expect(data.personalBest).toBe(12);
    expect(data.stats.gamesWon).toBe(4);
    expect(data.scores).toHaveLength(1);
  });

  it("requires authentication for POST requests", async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await POST(
      request("POST", {
        body: { score: 10 },
        origin: "https://teamham.world",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects invalid score payloads", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);

    const response = await POST(
      request("POST", {
        token,
        body: { score: -5 },
        origin: "https://teamham.world",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("saves valid score and returns updated leaderboard", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);

    vi.mocked(leaderboardModule.savePufftonScore).mockResolvedValueOnce({
      highScore: 10,
      stats: { gamesPlayed: 1, gamesWon: 1, totalVp: 10, currentStreak: 1, maxStreak: 1 },
    });

    vi.mocked(leaderboardModule.getPufftonLeaderboard).mockResolvedValueOnce({
      personalBest: 10,
      stats: { gamesPlayed: 1, gamesWon: 1, totalVp: 10, currentStreak: 1, maxStreak: 1 },
      scores: [],
    });

    const response = await POST(
      request("POST", {
        token,
        body: {
          score: 10,
          gamesPlayed: 1,
          gamesWon: 1,
          totalVp: 10,
          currentStreak: 1,
          maxStreak: 1,
        },
        origin: "https://teamham.world",
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.authenticated).toBe(true);
    expect(data.personalBest).toBe(10);
  });
});
