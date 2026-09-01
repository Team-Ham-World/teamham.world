import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/puffdle/leaderboard/route";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/crypto";
import * as dbModule from "@/lib/auth/db";
import { SESSION_COOKIE_NAME } from "@/lib/auth/http";
import * as leaderboardModule from "@/lib/puffdle/leaderboard";
import {
  VALID_PROD_ENV,
  clearAuthEnv,
  setTestEnv,
} from "../helpers/test-fixtures";

vi.mock("@/lib/auth/db", () => ({
  verifySession: vi.fn(),
}));

vi.mock("@/lib/puffdle/leaderboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/puffdle/leaderboard")>();
  return {
    ...actual,
    getPuffdleLeaderboard: vi.fn(),
    savePuffdleScore: vi.fn(),
  };
});

describe("Puffdle leaderboard API endpoint", () => {
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
    return new Request("https://teamham.world/api/puffdle/leaderboard", {
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
    expect(leaderboardModule.getPuffdleLeaderboard).not.toHaveBeenCalled();
  });

  it("lets signed-out visitors play without exposing member scores", async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: false,
      username: null,
      personalBest: 0,
      stats: { gamesPlayed: 0, gamesWon: 0, currentStreak: 0, maxStreak: 0 },
      scores: [],
    });
    expect(leaderboardModule.getPuffdleLeaderboard).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns the private member leaderboard for a valid session", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    const tokenHash = mockMember(token);
    vi.mocked(leaderboardModule.getPuffdleLeaderboard).mockResolvedValueOnce({
      personalBest: 500,
      stats: { gamesPlayed: 5, gamesWon: 4, currentStreak: 2, maxStreak: 3 },
      scores: [{ rank: 1, username: "hamfriend", score: 500, mine: true }],
    });

    const response = await GET(request("GET", { token }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      username: "hamfriend",
      personalBest: 500,
      stats: { gamesPlayed: 5, gamesWon: 4, currentStreak: 2, maxStreak: 3 },
      scores: [{ rank: 1, username: "hamfriend", score: 500, mine: true }],
    });
    expect(dbModule.verifySession).toHaveBeenCalledWith(tokenHash, expect.any(String));
    expect(leaderboardModule.getPuffdleLeaderboard).toHaveBeenCalledWith(
      accountId,
      expect.any(String),
    );
  });

  it("requires a member session before accepting a score", async () => {
    setTestEnv(VALID_PROD_ENV);

    const response = await POST(
      request("POST", { body: { score: 400 }, origin: "https://teamham.world" }),
    );

    expect(response.status).toBe(401);
    expect(leaderboardModule.savePuffdleScore).not.toHaveBeenCalled();
  });

  it("rejects cross-origin score submissions", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);

    const response = await POST(
      request("POST", { token, body: { score: 400 }, origin: "https://evil.example" }),
    );

    expect(response.status).toBe(403);
    expect(leaderboardModule.savePuffdleScore).not.toHaveBeenCalled();
  });

  it("rejects malformed and out-of-range scores", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);

    const response = await POST(
      request("POST", {
        token,
        body: { score: -50 },
        origin: "https://teamham.world",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_score" });
    expect(leaderboardModule.savePuffdleScore).not.toHaveBeenCalled();
  });

  it("upserts the score and returns refreshed member board", async () => {
    setTestEnv(VALID_PROD_ENV);
    const token = generateSessionToken();
    mockMember(token);
    vi.mocked(leaderboardModule.savePuffdleScore).mockResolvedValueOnce({
      personalBest: 600,
      stats: { gamesPlayed: 1, gamesWon: 1, currentStreak: 1, maxStreak: 1 },
    });
    vi.mocked(leaderboardModule.getPuffdleLeaderboard).mockResolvedValueOnce({
      personalBest: 600,
      stats: { gamesPlayed: 1, gamesWon: 1, currentStreak: 1, maxStreak: 1 },
      scores: [{ rank: 1, username: "hamfriend", score: 600, mine: true }],
    });

    const response = await POST(
      request("POST", {
        token,
        body: {
          score: 600,
          gamesPlayed: 1,
          gamesWon: 1,
          currentStreak: 1,
          maxStreak: 1,
        },
        origin: "https://teamham.world",
      }),
    );

    expect(response.status).toBe(200);
    expect(leaderboardModule.savePuffdleScore).toHaveBeenCalledWith(
      accountId,
      {
        score: 600,
        gamesPlayed: 1,
        gamesWon: 1,
        currentStreak: 1,
        maxStreak: 1,
      },
      expect.any(String),
    );
    expect(await response.json()).toMatchObject({
      authenticated: true,
      personalBest: 600,
    });
  });
});
