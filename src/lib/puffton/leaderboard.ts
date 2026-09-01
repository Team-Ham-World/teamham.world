import { isValidDiscordUsername, isValidUuid } from "@/lib/auth/crypto";
import { getDbClient } from "@/lib/auth/db";

export const MAX_PUFFTON_SCORE = 1_000_000;
export const PUFFTON_LEADERBOARD_SIZE = 10;

export interface PufftonLeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  gamesPlayed: number;
  gamesWon: number;
  totalVp: number;
  currentStreak: number;
  maxStreak: number;
  mine: boolean;
}

export interface PufftonStats {
  gamesPlayed: number;
  gamesWon: number;
  totalVp: number;
  currentStreak: number;
  maxStreak: number;
}

export interface PufftonLeaderboardSnapshot {
  personalBest: number;
  stats: PufftonStats;
  scores: PufftonLeaderboardEntry[];
}

export interface PufftonScorePayload {
  score: number;
  gamesPlayed?: number;
  gamesWon?: number;
  totalVp?: number;
  currentStreak?: number;
  maxStreak?: number;
}

export function isValidPufftonScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_PUFFTON_SCORE
  );
}

export function isValidPufftonStat(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_PUFFTON_SCORE
  );
}

function requireAccountId(accountId: string): void {
  if (!isValidUuid(accountId)) {
    throw new Error("Invalid account ID format");
  }
}

export async function savePufftonScore(
  accountId: string,
  payload: PufftonScorePayload,
  databaseUrl?: string,
): Promise<{ highScore: number; stats: PufftonStats }> {
  requireAccountId(accountId);
  if (!isValidPufftonScore(payload.score)) {
    throw new Error("Invalid Puffton score");
  }

  const gamesPlayed = payload.gamesPlayed ?? 0;
  const gamesWon = payload.gamesWon ?? 0;
  const totalVp = payload.totalVp ?? 0;
  const currentStreak = payload.currentStreak ?? 0;
  const maxStreak = payload.maxStreak ?? 0;

  if (
    !isValidPufftonStat(gamesPlayed) ||
    !isValidPufftonStat(gamesWon) ||
    !isValidPufftonStat(totalVp) ||
    !isValidPufftonStat(currentStreak) ||
    !isValidPufftonStat(maxStreak)
  ) {
    throw new Error("Invalid Puffton stats");
  }

  const sql = getDbClient(databaseUrl);
  const rows = (await sql`
    INSERT INTO public.puff_puffton_scores (
      account_id,
      high_score,
      games_played,
      games_won,
      total_vp,
      current_streak,
      max_streak,
      achieved_at,
      updated_at
    )
    VALUES (
      ${accountId},
      ${payload.score},
      ${gamesPlayed},
      ${gamesWon},
      ${totalVp},
      ${currentStreak},
      ${maxStreak},
      NOW(),
      NOW()
    )
    ON CONFLICT (account_id) DO UPDATE
    SET
      high_score = GREATEST(puff_puffton_scores.high_score, EXCLUDED.high_score),
      games_played = GREATEST(puff_puffton_scores.games_played, EXCLUDED.games_played),
      games_won = GREATEST(puff_puffton_scores.games_won, EXCLUDED.games_won),
      total_vp = GREATEST(puff_puffton_scores.total_vp, EXCLUDED.total_vp),
      current_streak = EXCLUDED.current_streak,
      max_streak = GREATEST(puff_puffton_scores.max_streak, EXCLUDED.max_streak),
      achieved_at = CASE
        WHEN EXCLUDED.high_score > puff_puffton_scores.high_score THEN NOW()
        ELSE puff_puffton_scores.achieved_at
      END,
      updated_at = NOW()
    RETURNING high_score, games_played, games_won, total_vp, current_streak, max_streak;
  `) as Array<{
    high_score: unknown;
    games_played: unknown;
    games_won: unknown;
    total_vp: unknown;
    current_streak: unknown;
    max_streak: unknown;
  }>;

  if (rows.length !== 1 || !isValidPufftonScore(rows[0].high_score)) {
    throw new Error("Malformed Puffton score query result");
  }

  return {
    highScore: rows[0].high_score,
    stats: {
      gamesPlayed: Number(rows[0].games_played) || 0,
      gamesWon: Number(rows[0].games_won) || 0,
      totalVp: Number(rows[0].total_vp) || 0,
      currentStreak: Number(rows[0].current_streak) || 0,
      maxStreak: Number(rows[0].max_streak) || 0,
    },
  };
}

export async function getPufftonLeaderboard(
  accountId: string,
  databaseUrl?: string,
): Promise<PufftonLeaderboardSnapshot> {
  requireAccountId(accountId);
  const sql = getDbClient(databaseUrl);

  const [leaderboardRows, personalRows] = await Promise.all([
    sql`
      SELECT
        ranked.account_id,
        ranked.discord_username,
        ranked.high_score,
        ranked.games_played,
        ranked.games_won,
        ranked.total_vp,
        ranked.current_streak,
        ranked.max_streak,
        ranked.rank
      FROM (
        SELECT
          scores.account_id,
          accounts.discord_username,
          scores.high_score,
          scores.games_played,
          scores.games_won,
          scores.total_vp,
          scores.current_streak,
          scores.max_streak,
          ROW_NUMBER() OVER (
            ORDER BY scores.high_score DESC, scores.games_won DESC, scores.achieved_at ASC, scores.account_id ASC
          ) AS rank
        FROM public.puff_puffton_scores scores
        JOIN public.accounts accounts ON accounts.id = scores.account_id
        WHERE accounts.access_status = 'active'
          AND accounts.membership_status = 'eligible'
      ) ranked
      WHERE ranked.rank <= ${PUFFTON_LEADERBOARD_SIZE}
      ORDER BY ranked.rank ASC;
    `,
    sql`
      SELECT high_score, games_played, games_won, total_vp, current_streak, max_streak
      FROM public.puff_puffton_scores
      WHERE account_id = ${accountId};
    `,
  ]);

  const scores = (leaderboardRows as Array<{
    account_id: unknown;
    discord_username: unknown;
    high_score: unknown;
    games_played: unknown;
    games_won: unknown;
    total_vp: unknown;
    current_streak: unknown;
    max_streak: unknown;
    rank: unknown;
  }>).map((row) => {
    const rank = Number(row.rank);
    if (
      !isValidUuid(row.account_id) ||
      !isValidPufftonScore(row.high_score) ||
      !Number.isInteger(rank) ||
      rank < 1 ||
      rank > PUFFTON_LEADERBOARD_SIZE
    ) {
      throw new Error("Malformed Puffton leaderboard query result");
    }

    return {
      rank,
      username: isValidDiscordUsername(row.discord_username)
        ? row.discord_username
        : "Member",
      score: row.high_score,
      gamesPlayed: Number(row.games_played) || 0,
      gamesWon: Number(row.games_won) || 0,
      totalVp: Number(row.total_vp) || 0,
      currentStreak: Number(row.current_streak) || 0,
      maxStreak: Number(row.max_streak) || 0,
      mine: row.account_id === accountId,
    };
  });

  if (personalRows.length > 1) {
    throw new Error("Malformed Puffton personal-best query result");
  }

  const personalBest =
    personalRows.length === 0
      ? 0
      : (personalRows[0] as { high_score: unknown }).high_score;

  const stats: PufftonStats =
    personalRows.length === 0
      ? { gamesPlayed: 0, gamesWon: 0, totalVp: 0, currentStreak: 0, maxStreak: 0 }
      : {
          gamesPlayed: Number((personalRows[0] as { games_played: unknown }).games_played) || 0,
          gamesWon: Number((personalRows[0] as { games_won: unknown }).games_won) || 0,
          totalVp: Number((personalRows[0] as { total_vp: unknown }).total_vp) || 0,
          currentStreak: Number((personalRows[0] as { current_streak: unknown }).current_streak) || 0,
          maxStreak: Number((personalRows[0] as { max_streak: unknown }).max_streak) || 0,
        };

  if (!isValidPufftonScore(personalBest)) {
    throw new Error("Malformed Puffton personal-best query result");
  }

  return { personalBest, stats, scores };
}
