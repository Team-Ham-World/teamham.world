-- 0009_puff_puffdle_leaderboard.sql
-- Applied manually by maintainer using neondb_owner

CREATE TABLE public.puff_puffdle_scores (
    account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
    high_score INTEGER NOT NULL
        CHECK (high_score >= 0 AND high_score <= 1000000),
    games_played INTEGER NOT NULL DEFAULT 0
        CHECK (games_played >= 0),
    games_won INTEGER NOT NULL DEFAULT 0
        CHECK (games_won >= 0),
    current_streak INTEGER NOT NULL DEFAULT 0
        CHECK (current_streak >= 0),
    max_streak INTEGER NOT NULL DEFAULT 0
        CHECK (max_streak >= 0),
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_puff_puffdle_scores_ranking
    ON public.puff_puffdle_scores (high_score DESC, achieved_at ASC, account_id ASC);

-- The app can read rankings and upsert score and stats columns.
GRANT SELECT ON public.puff_puffdle_scores TO app_runtime_role;
GRANT INSERT (account_id, high_score, games_played, games_won, current_streak, max_streak, achieved_at, updated_at)
    ON public.puff_puffdle_scores TO app_runtime_role;
GRANT UPDATE (high_score, games_played, games_won, current_streak, max_streak, achieved_at, updated_at)
    ON public.puff_puffdle_scores TO app_runtime_role;
