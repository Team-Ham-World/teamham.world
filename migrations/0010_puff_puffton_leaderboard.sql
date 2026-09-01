-- 0010_puff_puffton_leaderboard.sql
-- Applied manually by maintainer using neondb_owner

CREATE TABLE public.puff_puffton_scores (
    account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
    high_score INTEGER NOT NULL
        CHECK (high_score >= 0 AND high_score <= 1000000),
    games_played INTEGER NOT NULL DEFAULT 0
        CHECK (games_played >= 0),
    games_won INTEGER NOT NULL DEFAULT 0
        CHECK (games_won >= 0),
    total_vp INTEGER NOT NULL DEFAULT 0
        CHECK (total_vp >= 0),
    current_streak INTEGER NOT NULL DEFAULT 0
        CHECK (current_streak >= 0),
    max_streak INTEGER NOT NULL DEFAULT 0
        CHECK (max_streak >= 0),
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_puff_puffton_scores_ranking
    ON public.puff_puffton_scores (high_score DESC, games_won DESC, achieved_at ASC, account_id ASC);

-- The app can read rankings and upsert score and stats columns.
GRANT SELECT ON public.puff_puffton_scores TO app_runtime_role;
GRANT INSERT (account_id, high_score, games_played, games_won, total_vp, current_streak, max_streak, achieved_at, updated_at)
    ON public.puff_puffton_scores TO app_runtime_role;
GRANT UPDATE (high_score, games_played, games_won, total_vp, current_streak, max_streak, achieved_at, updated_at)
    ON public.puff_puffton_scores TO app_runtime_role;
