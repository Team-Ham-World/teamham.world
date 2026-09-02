import { isValidDiscordUsername, isValidUuid } from "@/lib/auth/crypto";
import { getDbClient } from "@/lib/auth/db";
import {
  MAX_PUFF_SCORE,
  isValidPuffScore,
  type PuffLeaderboardEntry,
  type PuffLeaderboardSnapshot,
} from "@/lib/puff/leaderboard";

export const MAX_PRINT_RUN_SCORE = MAX_PUFF_SCORE;
export const PRINT_RUN_LEADERBOARD_SIZE = 10;

export type PrintRunLeaderboardEntry = PuffLeaderboardEntry;
export type PrintRunLeaderboardSnapshot = PuffLeaderboardSnapshot;

export function isValidPrintRunScore(value: unknown): value is number {
  return isValidPuffScore(value) && value % 5 === 0;
}

function requireAccountId(accountId: string): void {
  if (!isValidUuid(accountId)) {
    throw new Error("Invalid account ID format");
  }
}

export async function savePrintRunHighScore(
  accountId: string,
  score: number,
  databaseUrl?: string,
): Promise<number | null> {
  requireAccountId(accountId);
  if (!isValidPrintRunScore(score)) throw new Error("Invalid Print Run score");

  const sql = getDbClient(databaseUrl);
  const rows = (await sql`
    INSERT INTO public.puff_print_run_scores (account_id, high_score)
    SELECT accounts.id, ${score}
    FROM public.accounts
    WHERE accounts.id = ${accountId}
      AND accounts.access_status = 'active'
      AND accounts.membership_status = 'eligible'
      AND accounts.membership_checked_at + INTERVAL '24 hours' > NOW()
    ON CONFLICT (account_id) DO UPDATE
    SET
      high_score = GREATEST(puff_print_run_scores.high_score, EXCLUDED.high_score),
      achieved_at = CASE
        WHEN EXCLUDED.high_score > puff_print_run_scores.high_score THEN NOW()
        ELSE puff_print_run_scores.achieved_at
      END,
      updated_at = NOW()
    RETURNING high_score;
  `) as Array<{ high_score: unknown }>;

  if (rows.length === 0) return null;
  if (rows.length !== 1 || !isValidPrintRunScore(rows[0].high_score)) {
    throw new Error("Malformed Print Run score query result");
  }
  return rows[0].high_score;
}

export async function getPrintRunLeaderboard(
  accountId: string,
  databaseUrl?: string,
): Promise<PrintRunLeaderboardSnapshot | null> {
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
        FROM public.puff_print_run_scores scores
        JOIN public.accounts accounts ON accounts.id = scores.account_id
        WHERE accounts.access_status = 'active'
          AND accounts.membership_status = 'eligible'
          AND accounts.membership_checked_at + INTERVAL '24 hours' > NOW()
      ) ranked
      WHERE ranked.rank <= ${PRINT_RUN_LEADERBOARD_SIZE}
      ORDER BY ranked.rank ASC;
    `,
    sql`
      SELECT scores.high_score
      FROM public.accounts accounts
      LEFT JOIN public.puff_print_run_scores scores ON scores.account_id = accounts.id
      WHERE accounts.id = ${accountId}
        AND accounts.access_status = 'active'
        AND accounts.membership_status = 'eligible'
        AND accounts.membership_checked_at + INTERVAL '24 hours' > NOW();
    `,
  ]);

  const scores: PrintRunLeaderboardEntry[] = (leaderboardRows as Array<{
    account_id: unknown;
    discord_username: unknown;
    high_score: unknown;
    rank: unknown;
  }>).map((row) => {
    const rank = Number(row.rank);
    if (
      !isValidUuid(row.account_id) ||
      !isValidPrintRunScore(row.high_score) ||
      !Number.isInteger(rank) ||
      rank < 1 ||
      rank > PRINT_RUN_LEADERBOARD_SIZE
    ) {
      throw new Error("Malformed Print Run leaderboard query result");
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
    throw new Error("Malformed Print Run personal-best query result");
  }
  const personalValue = (personalRows[0] as { high_score: unknown }).high_score;
  const personalBest = personalValue === null ? 0 : personalValue;
  if (!isValidPrintRunScore(personalBest)) {
    throw new Error("Malformed Print Run personal-best query result");
  }

  return { personalBest, scores };
}
