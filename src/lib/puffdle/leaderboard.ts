import { isValidDiscordUsername, isValidUuid } from "@/lib/auth/crypto";
import { getDbClient } from "@/lib/auth/db";

export const MAX_PUFFDLE_SCORE = 1_000_000;
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
    value <= MAX_PUFFDLE_SCORE
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

function requireAccountId(accountId: string): void {
  if (!isValidUuid(accountId)) {
    throw new Error("Invalid account ID format");
  }
}

export async function savePuffdleScore(
  accountId: string,
  input: SavePuffdleScoreInput,
  databaseUrl?: string,
): Promise<{ personalBest: number; stats: PuffdleStatsSnapshot }> {
  requireAccountId(accountId);
  if (!isValidPuffdleScore(input.score)) {
    throw new Error("Invalid Puffdle score");
  }

  const gamesPlayed = input.gamesPlayed ?? 0;
  const gamesWon = input.gamesWon ?? 0;
  const currentStreak = input.currentStreak ?? 0;
  const maxStreak = input.maxStreak ?? 0;

  if (
    !isValidPuffdleStat(gamesPlayed) ||
    !isValidPuffdleStat(gamesWon) ||
    !isValidPuffdleStat(currentStreak) ||
    !isValidPuffdleStat(maxStreak)
  ) {
    throw new Error("Invalid Puffdle stats");
  }

  const sql = getDbClient(databaseUrl);
  const rows = (await sql`
    INSERT INTO public.puff_puffdle_scores (
      account_id,
      high_score,
      games_played,
      games_won,
      current_streak,
      max_streak,
      achieved_at,
      updated_at
    )
    VALUES (
      ${accountId},
      ${input.score},
      ${gamesPlayed},
      ${gamesWon},
      ${currentStreak},
      ${maxStreak},
      NOW(),
      NOW()
    )
    ON CONFLICT (account_id) DO UPDATE
    SET
      high_score = GREATEST(puff_puffdle_scores.high_score, EXCLUDED.high_score),
      games_played = GREATEST(puff_puffdle_scores.games_played, EXCLUDED.games_played),
      games_won = GREATEST(puff_puffdle_scores.games_won, EXCLUDED.games_won),
      current_streak = EXCLUDED.current_streak,
      max_streak = GREATEST(puff_puffdle_scores.max_streak, EXCLUDED.max_streak),
      achieved_at = CASE
        WHEN EXCLUDED.high_score > puff_puffdle_scores.high_score THEN NOW()
        ELSE puff_puffdle_scores.achieved_at
      END,
      updated_at = NOW()
    RETURNING high_score, games_played, games_won, current_streak, max_streak;
  `) as Array<{
    high_score: unknown;
    games_played: unknown;
    games_won: unknown;
    current_streak: unknown;
    max_streak: unknown;
  }>;

  if (rows.length !== 1) {
    throw new Error("Malformed Puffdle score query result");
  }

  const row = rows[0];
  if (
    !isValidPuffdleScore(row.high_score) ||
    !isValidPuffdleStat(row.games_played) ||
    !isValidPuffdleStat(row.games_won) ||
    !isValidPuffdleStat(row.current_streak) ||
    !isValidPuffdleStat(row.max_streak)
  ) {
    throw new Error("Malformed Puffdle score query result");
  }

  return {
    personalBest: row.high_score,
    stats: {
      gamesPlayed: row.games_played,
      gamesWon: row.games_won,
      currentStreak: row.current_streak,
      maxStreak: row.max_streak,
    },
  };
}

export async function getPuffdleLeaderboard(
  accountId: string,
  databaseUrl?: string,
): Promise<PuffdleLeaderboardSnapshot> {
  requireAccountId(accountId);
  const sql = getDbClient(databaseUrl);

  const [leaderboardRows, personalRows] = await Promise.all([
    sql`
      SELECT
        ranked.account_id,
        ranked.discord_username,
        ranked.high_score,
        ranked.rank
      FROM (
        SELECT
          scores.account_id,
          accounts.discord_username,
          scores.high_score,
          ROW_NUMBER() OVER (
            ORDER BY scores.high_score DESC, scores.achieved_at ASC, scores.account_id ASC
          ) AS rank
        FROM public.puff_puffdle_scores scores
        JOIN public.accounts accounts ON accounts.id = scores.account_id
        WHERE accounts.access_status = 'active'
          AND accounts.membership_status = 'eligible'
      ) ranked
      WHERE ranked.rank <= ${PUFFDLE_LEADERBOARD_SIZE}
      ORDER BY ranked.rank ASC;
    `,
    sql`
      SELECT
        high_score,
        games_played,
        games_won,
        current_streak,
        max_streak
      FROM public.puff_puffdle_scores
      WHERE account_id = ${accountId};
    `,
  ]);

  const scores = (
    leaderboardRows as Array<{
      account_id: unknown;
      discord_username: unknown;
      high_score: unknown;
      rank: unknown;
    }>
  ).map((row) => {
    const rank = Number(row.rank);
    if (
      !isValidUuid(row.account_id) ||
      !isValidPuffdleScore(row.high_score) ||
      !Number.isInteger(rank) ||
      rank < 1 ||
      rank > PUFFDLE_LEADERBOARD_SIZE
    ) {
      throw new Error("Malformed Puffdle leaderboard query result");
    }

    return {
      rank,
      username: isValidDiscordUsername(row.discord_username)
        ? row.discord_username
        : "Member",
      score: row.high_score,
      mine: row.account_id === accountId,
    };
  });

  if (personalRows.length > 1) {
    throw new Error("Malformed Puffdle personal-best query result");
  }

  const personalRow = personalRows[0] as
    | {
        high_score: unknown;
        games_played: unknown;
        games_won: unknown;
        current_streak: unknown;
        max_streak: unknown;
      }
    | undefined;

  const personalBest = personalRow ? personalRow.high_score : 0;
  const gamesPlayed = personalRow ? personalRow.games_played : 0;
  const gamesWon = personalRow ? personalRow.games_won : 0;
  const currentStreak = personalRow ? personalRow.current_streak : 0;
  const maxStreak = personalRow ? personalRow.max_streak : 0;

  if (
    !isValidPuffdleScore(personalBest) ||
    !isValidPuffdleStat(gamesPlayed) ||
    !isValidPuffdleStat(gamesWon) ||
    !isValidPuffdleStat(currentStreak) ||
    !isValidPuffdleStat(maxStreak)
  ) {
    throw new Error("Malformed Puffdle personal-best query result");
  }

  return {
    personalBest,
    stats: {
      gamesPlayed,
      gamesWon,
      currentStreak,
      maxStreak,
    },
    scores,
  };
}
