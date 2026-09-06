export const MAX_PUFFDLE_SCORE = 600;
export const MAX_PUFFDLE_STAT = 1_000_000;
export const PUFFDLE_LEADERBOARD_SIZE = 10;

export interface PuffdleLeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  mine: boolean;
}

export interface PuffdleStatsSnapshot {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
}

export interface PuffdleLeaderboardSnapshot {
  personalBest: number;
  stats: PuffdleStatsSnapshot;
  scores: PuffdleLeaderboardEntry[];
}

export interface SavePuffdleScoreInput {
  score: number;
  gamesPlayed?: number;
  gamesWon?: number;
  currentStreak?: number;
  maxStreak?: number;
}

export function isValidPuffdleScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_PUFFDLE_SCORE &&
    value % 100 === 0
  );
}

export function isValidPuffdleStat(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_PUFFDLE_STAT
  );
}

export function isValidPuffdleStats(value: unknown): value is PuffdleStatsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const stats = value as Record<string, unknown>;
  return (
    isValidPuffdleStat(stats.gamesPlayed) &&
    isValidPuffdleStat(stats.gamesWon) &&
    isValidPuffdleStat(stats.currentStreak) &&
    isValidPuffdleStat(stats.maxStreak) &&
    stats.gamesWon <= stats.gamesPlayed &&
    stats.currentStreak <= stats.maxStreak &&
    stats.maxStreak <= stats.gamesWon
  );
}

export type PuffdleLeaderboardResponse =
  | { authenticated: false; username: null }
  | ({ authenticated: true; username: string | null } & PuffdleLeaderboardSnapshot);

export function parseLeaderboardPayload(value: unknown): PuffdleLeaderboardResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.authenticated === false) return { authenticated: false, username: null };
  if (
    payload.authenticated !== true ||
    !(typeof payload.username === "string" || payload.username === null) ||
    !isValidPuffdleScore(payload.personalBest) ||
    !isValidPuffdleStats(payload.stats) ||
    !Array.isArray(payload.scores) ||
    payload.scores.length > PUFFDLE_LEADERBOARD_SIZE
  ) return null;
  const scores: PuffdleLeaderboardEntry[] = [];
  for (const [index, value] of payload.scores.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (
      entry.rank !== index + 1 || typeof entry.username !== "string" ||
      !isValidPuffdleScore(entry.score) || typeof entry.mine !== "boolean"
    ) return null;
    scores.push({ rank: index + 1, username: entry.username, score: entry.score, mine: entry.mine });
  }
  return {
    authenticated: true, username: payload.username,
    personalBest: payload.personalBest, stats: payload.stats, scores,
  };
}
