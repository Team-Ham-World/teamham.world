import { getDbClient } from "@/lib/auth/db";
import { isValidUuid } from "@/lib/auth/crypto";
import { createDefaultStats, createInitialPuffdleState, evaluateGuess, updateKeyboardStatus, calculatePuffdlePoints, type GameStatus, type PuffdleGameState, type PuffdleStats } from "./game";
import { getDailyWord, isValidGuess } from "./words";

export interface DailySnapshot {
  authenticated: true;
  accountId: string;
  puzzleDate: string;
  nextPuzzleAt: string;
  game: PuffdleGameState;
  stats: PuffdleStats;
}
export interface DailyGuess {
  accountId: string;
  puzzleDate: string;
  revision: number;
  guess: string;
}
export function isDailyGuess(value: unknown): value is DailyGuess {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return isValidUuid(v.accountId) && typeof v.puzzleDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.puzzleDate)
    && Number.isInteger(v.revision) && Number(v.revision) >= 0 && Number(v.revision) < 6
    && typeof v.guess === "string" && /^[A-Z]{5}$/.test(v.guess) && isValidGuess(v.guess);
}

async function ensureGame(accountId: string, databaseUrl?: string) {
  if (!isValidUuid(accountId)) throw new Error("Invalid account");
  const sql = getDbClient(databaseUrl);
  const [clock] = await sql`SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today`;
  const date = String((clock as { today: string }).today);
  const { word } = getDailyWord(`${date}T00:00:00Z`);
  await sql`INSERT INTO public.puff_puffdle_daily_puzzles (puzzle_date, target_word)
    VALUES (${date}::date, ${word.toUpperCase()}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO public.puff_puffdle_daily_games (account_id, puzzle_date)
    VALUES (${accountId}, ${date}::date) ON CONFLICT DO NOTHING`;
  return date;
}

export async function getDailyGame(accountId: string, databaseUrl?: string): Promise<DailySnapshot> {
  const date = await ensureGame(accountId, databaseUrl);
  const sql = getDbClient(databaseUrl);
  const rows = await sql`SELECT g.puzzle_date::text AS date, g.guesses, g.status, p.target_word
    FROM public.puff_puffdle_daily_games g JOIN public.puff_puffdle_daily_puzzles p USING (puzzle_date)
    WHERE g.account_id = ${accountId} AND g.puzzle_date = ${date}::date`;
  const row = rows[0] as { guesses: string[]; target_word: string; status: GameStatus } | undefined;
  if (!row) throw new Error("Missing daily game");
  const guesses = row.guesses as string[];
  const target = String(row.target_word);
  const status = row.status as GameStatus;
  const game = createInitialPuffdleState(status === "IN_PROGRESS" ? "" : target, "daily", getDailyWord(`${date}T00:00:00Z`).dayNumber);
  game.guesses = guesses;
  game.status = status;
  game.evaluations = guesses.map(guess => evaluateGuess(target, guess));
  game.keyboardStatus = guesses.reduce((keys, guess, i) => updateKeyboardStatus(keys, guess, game.evaluations[i]), {});
  game.pointsEarned = status === "WON" ? calculatePuffdlePoints(guesses.length) : 0;
  const history = await sql`SELECT puzzle_date::text AS date, status, cardinality(guesses) AS attempts
    FROM public.puff_puffdle_daily_games WHERE account_id = ${accountId} AND status <> 'IN_PROGRESS'
    ORDER BY puzzle_date`;
  const stats = createDefaultStats();
  let previousWin = 0;
  let streak = 0;
  for (const result of history as { date: string; status: GameStatus; attempts: number }[]) {
    stats.gamesPlayed++;
    const day = Date.parse(`${result.date}T00:00:00Z`);
    if (result.status === "WON") {
      stats.gamesWon++;
      stats.guessDistribution[Number(result.attempts)]++;
      streak = day - previousWin === 86_400_000 ? streak + 1 : 1;
      previousWin = day;
      stats.maxStreak = Math.max(stats.maxStreak, streak);
    } else { streak = 0; previousWin = 0; }
  }
  stats.currentStreak = Date.parse(`${date}T00:00:00Z`) - previousWin <= 86_400_000 ? streak : 0;
  return { authenticated: true, accountId, puzzleDate: date, nextPuzzleAt: new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString(), game, stats };
}

export async function submitDailyGuess(accountId: string, input: DailyGuess, databaseUrl?: string) {
  if (!isDailyGuess(input)) throw new Error("Invalid guess");
  const date = await ensureGame(accountId, databaseUrl);
  if (input.accountId !== accountId || input.puzzleDate !== date) {
    return { conflict: true, snapshot: await getDailyGame(accountId, databaseUrl) };
  }
  const sql = getDbClient(databaseUrl);
  const rows = await sql`
    WITH advanced AS (
      UPDATE public.puff_puffdle_daily_games g SET
        guesses = array_append(g.guesses, ${input.guess}::text),
        status = CASE WHEN p.target_word = ${input.guess} THEN 'WON' WHEN cardinality(g.guesses) = 5 THEN 'LOST' ELSE 'IN_PROGRESS' END,
        updated_at = GREATEST(statement_timestamp(), g.updated_at),
        completed_at = CASE WHEN p.target_word = ${input.guess} OR cardinality(g.guesses) = 5 THEN GREATEST(statement_timestamp(), g.updated_at) ELSE NULL END
      FROM public.puff_puffdle_daily_puzzles p
      WHERE g.account_id = ${accountId} AND g.puzzle_date = ${input.puzzleDate}::date
        AND g.puzzle_date = (statement_timestamp() AT TIME ZONE 'UTC')::date
        AND p.puzzle_date = g.puzzle_date AND g.status = 'IN_PROGRESS'
        AND cardinality(g.guesses) = ${input.revision}
      RETURNING g.*
    ), scored AS (
      INSERT INTO public.puff_puffdle_scores (account_id, high_score, games_played, games_won, current_streak, max_streak, achieved_at, updated_at)
      SELECT account_id, CASE WHEN status = 'WON' THEN (7-cardinality(guesses))*100 ELSE 0 END,
        1, (status='WON')::int, (status='WON')::int, (status='WON')::int, updated_at, updated_at
      FROM advanced WHERE status <> 'IN_PROGRESS'
      ON CONFLICT (account_id) DO UPDATE SET
        high_score = GREATEST(puff_puffdle_scores.high_score, EXCLUDED.high_score),
        games_played = LEAST(1000000, puff_puffdle_scores.games_played + 1),
        games_won = LEAST(1000000, puff_puffdle_scores.games_won + EXCLUDED.games_won),
        current_streak = CASE WHEN EXCLUDED.games_won = 1 THEN LEAST(1000000, puff_puffdle_scores.current_streak + 1) ELSE 0 END,
        max_streak = GREATEST(puff_puffdle_scores.max_streak, CASE WHEN EXCLUDED.games_won = 1 THEN LEAST(1000000, puff_puffdle_scores.current_streak + 1) ELSE 0 END),
        achieved_at = CASE WHEN EXCLUDED.high_score > puff_puffdle_scores.high_score THEN GREATEST(EXCLUDED.updated_at, puff_puffdle_scores.updated_at) ELSE puff_puffdle_scores.achieved_at END,
        updated_at = GREATEST(EXCLUDED.updated_at, puff_puffdle_scores.updated_at)
      RETURNING account_id
    ) SELECT cardinality(guesses) AS revision FROM advanced`;
  const snapshot = await getDailyGame(accountId, databaseUrl);
  const retry = snapshot.puzzleDate === input.puzzleDate && snapshot.game.guesses[input.revision] === input.guess;
  return { conflict: rows.length === 0 && !retry, snapshot };
}
