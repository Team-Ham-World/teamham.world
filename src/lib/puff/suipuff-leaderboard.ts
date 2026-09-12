import { isValidDiscordUsername, isValidUuid } from "@/lib/auth/crypto";
import { getDbClient } from "@/lib/auth/db";
import {
  MAX_PUFF_SCORE,
  isValidPuffScore,
  type PuffLeaderboardEntry,
  type PuffLeaderboardSnapshot,
} from "@/lib/puff/leaderboard";

export const MAX_SUIPUFF_SCORE = MAX_PUFF_SCORE;
export const SUIPUFF_LEADERBOARD_SIZE = 10;

export type SuipuffLeaderboardEntry = PuffLeaderboardEntry;
export type SuipuffLeaderboardSnapshot = PuffLeaderboardSnapshot;

export function isValidSuipuffScore(value: unknown): value is number {
  return isValidPuffScore(value);
}

function requireAccountId(accountId: string): void {
  if (!isValidUuid(accountId)) {
    throw new Error("Invalid account ID format");
  }
}

export async function saveSuipuffHighScore(
  accountId: string,
  score: number,
  databaseUrl?: string,
): Promise<number | null> {
  requireAccountId(accountId);
  if (!isValidSuipuffScore(score)) throw new Error("Invalid Suipuff score");

  const sql = getDbClient(databaseUrl);
  const rows = (await sql`
    INSERT INTO public.puff_suipuff_scores (account_id, high_score)
    SELECT accounts.id, ${score}
    FROM public.accounts
    WHERE accounts.id = ${accountId}
      AND accounts.access_status = 'active'
      AND accounts.membership_status = 'eligible'
      AND accounts.membership_checked_at + INTERVAL '24 hours' > NOW()
    ON CONFLICT (account_id) DO UPDATE
    SET
      high_score = GREATEST(puff_suipuff_scores.high_score, EXCLUDED.high_score),
      achieved_at = CASE
        WHEN EXCLUDED.high_score > puff_suipuff_scores.high_score THEN NOW()
        ELSE puff_suipuff_scores.achieved_at
      END,
      updated_at = NOW()
    RETURNING high_score;
  `) as Array<{ high_score: unknown }>;

  if (rows.length === 0) return null;
  if (rows.length !== 1 || !isValidSuipuffScore(rows[0].high_score)) {
    throw new Error("Malformed Suipuff score query result");
  }
  return rows[0].high_score;
}

export async function getSuipuffLeaderboard(
  accountId: string,
  databaseUrl?: string,
): Promise<SuipuffLeaderboardSnapshot | null> {
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
        FROM public.puff_suipuff_scores scores
        JOIN public.accounts accounts ON accounts.id = scores.account_id
        WHERE accounts.access_status = 'active'
          AND accounts.membership_status = 'eligible'
          AND accounts.membership_checked_at + INTERVAL '24 hours' > NOW()
      ) ranked
      WHERE ranked.rank <= ${SUIPUFF_LEADERBOARD_SIZE}
      ORDER BY ranked.rank ASC;
    `,
    sql`
      SELECT scores.high_score
      FROM public.accounts accounts
      LEFT JOIN public.puff_suipuff_scores scores ON scores.account_id = accounts.id
      WHERE accounts.id = ${accountId}
        AND accounts.access_status = 'active'
        AND accounts.membership_status = 'eligible'
        AND accounts.membership_checked_at + INTERVAL '24 hours' > NOW();
    `,
  ]);

  const scores: SuipuffLeaderboardEntry[] = (leaderboardRows as Array<{
    account_id: unknown;
    discord_username: unknown;
    high_score: unknown;
    rank: unknown;
  }>).map((row) => {
    const rank = Number(row.rank);
    if (
      !isValidUuid(row.account_id) ||
      !isValidSuipuffScore(row.high_score) ||
      !Number.isInteger(rank) ||
      rank < 1 ||
      rank > SUIPUFF_LEADERBOARD_SIZE
    ) {
      throw new Error("Malformed Suipuff leaderboard query result");
    }

    return {
      rank,
      username: isValidDiscordUsername(row.discord_username) ? row.discord_username : "Member",
      score: row.high_score,
      mine: row.account_id === accountId,
    };
  });

  if (personalRows.length === 0) return null;
  if (personalRows.length !== 1) {
    throw new Error("Malformed Suipuff personal-best query result");
  }
  const personalValue = (personalRows[0] as { high_score: unknown }).high_score;
  const personalBest = personalValue === null ? 0 : personalValue;
  if (!isValidSuipuffScore(personalBest)) {
    throw new Error("Malformed Suipuff personal-best query result");
  }

  return { personalBest, scores };
}
