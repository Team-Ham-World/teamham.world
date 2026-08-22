import { isValidDiscordUsername, isValidUuid } from "@/lib/auth/crypto";
import { getDbClient } from "@/lib/auth/db";

export const MAX_PUFF_SCORE = 1_000_000;
export const PUFF_LEADERBOARD_SIZE = 10;

export interface PuffLeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  mine: boolean;
}

export interface PuffLeaderboardSnapshot {
  personalBest: number;
  scores: PuffLeaderboardEntry[];
}

export function isValidPuffScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_PUFF_SCORE
  );
}

function requireAccountId(accountId: string): void {
  if (!isValidUuid(accountId)) {
    throw new Error("Invalid account ID format");
  }
}

export async function savePuffHighScore(
  accountId: string,
  score: number,
  databaseUrl?: string,
): Promise<number> {
  requireAccountId(accountId);
  if (!isValidPuffScore(score)) throw new Error("Invalid Puff score");

  const sql = getDbClient(databaseUrl);
  const rows = (await sql`
    INSERT INTO public.puff_flappy_scores (
      account_id,
      high_score,
      achieved_at,
      updated_at
    )
    VALUES (${accountId}, ${score}, NOW(), NOW())
    ON CONFLICT (account_id) DO UPDATE
    SET
      high_score = GREATEST(puff_flappy_scores.high_score, EXCLUDED.high_score),
      achieved_at = CASE
        WHEN EXCLUDED.high_score > puff_flappy_scores.high_score THEN NOW()
        ELSE puff_flappy_scores.achieved_at
      END,
      updated_at = NOW()
    RETURNING high_score;
  `) as Array<{ high_score: unknown }>;

  if (rows.length !== 1 || !isValidPuffScore(rows[0].high_score)) {
    throw new Error("Malformed Puff score query result");
  }
  return rows[0].high_score;
}

export async function getPuffLeaderboard(
  accountId: string,
  databaseUrl?: string,
): Promise<PuffLeaderboardSnapshot> {
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
        FROM public.puff_flappy_scores scores
        JOIN public.accounts accounts ON accounts.id = scores.account_id
        WHERE accounts.access_status = 'active'
          AND accounts.membership_status = 'eligible'
      ) ranked
      WHERE ranked.rank <= ${PUFF_LEADERBOARD_SIZE}
      ORDER BY ranked.rank ASC;
    `,
    sql`
      SELECT high_score
      FROM public.puff_flappy_scores
      WHERE account_id = ${accountId};
    `,
  ]);

  const scores = (leaderboardRows as Array<{
    account_id: unknown;
    discord_username: unknown;
    high_score: unknown;
    rank: unknown;
  }>).map((row) => {
    const rank = Number(row.rank);
    if (
      !isValidUuid(row.account_id) ||
      !isValidPuffScore(row.high_score) ||
      !Number.isInteger(rank) ||
      rank < 1 ||
      rank > PUFF_LEADERBOARD_SIZE
    ) {
      throw new Error("Malformed Puff leaderboard query result");
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
    throw new Error("Malformed Puff personal-best query result");
  }
  const personalBest =
    personalRows.length === 0
      ? 0
      : (personalRows[0] as { high_score: unknown }).high_score;
  if (!isValidPuffScore(personalBest)) {
    throw new Error("Malformed Puff personal-best query result");
  }

  return { personalBest, scores };
}
