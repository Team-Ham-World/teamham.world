-- 0004_puff_flappy_leaderboard.sql
-- Applied manually by maintainer using neondb_owner

CREATE TABLE public.puff_flappy_scores (
    account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
    high_score INTEGER NOT NULL
        CHECK (high_score >= 0 AND high_score <= 1000000),
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_puff_flappy_scores_ranking
    ON public.puff_flappy_scores (high_score DESC, achieved_at ASC, account_id ASC);

-- The app can read rankings and only upsert score-owned columns. Account IDs
-- still have to reference an existing member account.
GRANT SELECT ON public.puff_flappy_scores TO app_runtime_role;
GRANT INSERT (account_id, high_score, achieved_at, updated_at)
    ON public.puff_flappy_scores TO app_runtime_role;
GRANT UPDATE (high_score, achieved_at, updated_at)
    ON public.puff_flappy_scores TO app_runtime_role;
