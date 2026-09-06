-- 0010_puff_puffdle_leaderboard.sql
-- Applied manually by maintainer using neondb_owner

CREATE TABLE public.puff_puffdle_scores (
    account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
    high_score INTEGER NOT NULL
        CONSTRAINT ck_puffdle_high_score CHECK (high_score BETWEEN 0 AND 600 AND high_score % 100 = 0),
    games_played INTEGER NOT NULL DEFAULT 0
        CHECK (games_played BETWEEN 0 AND 1000000),
    games_won INTEGER NOT NULL DEFAULT 0
        CHECK (games_won BETWEEN 0 AND 1000000),
    current_streak INTEGER NOT NULL DEFAULT 0
        CHECK (current_streak BETWEEN 0 AND 1000000),
    max_streak INTEGER NOT NULL DEFAULT 0
        CHECK (max_streak BETWEEN 0 AND 1000000),
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_puffdle_stats CHECK (
        games_won <= games_played AND current_streak <= max_streak AND max_streak <= games_won
    ),
    CONSTRAINT ck_puffdle_timestamps CHECK (updated_at >= achieved_at)
);

CREATE INDEX idx_puff_puffdle_scores_ranking
    ON public.puff_puffdle_scores (high_score DESC, achieved_at ASC, account_id ASC);

-- The app can read rankings and upsert score and stats columns.
GRANT SELECT ON public.puff_puffdle_scores TO app_runtime_role;
GRANT INSERT (account_id, high_score, games_played, games_won, current_streak, max_streak, achieved_at, updated_at)
    ON public.puff_puffdle_scores TO app_runtime_role;
GRANT UPDATE (high_score, games_played, games_won, current_streak, max_streak, achieved_at, updated_at)
    ON public.puff_puffdle_scores TO app_runtime_role;
