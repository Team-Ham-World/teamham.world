-- 0009_puff_print_run_leaderboard.sql
-- Applied manually by maintainer using neondb_owner

CREATE TABLE public.puff_print_run_scores (
    account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
    high_score INTEGER NOT NULL,
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_puff_print_run_scores_high_score CHECK (
        high_score >= 0 AND
        high_score <= 1000000 AND
        high_score % 5 = 0
    ),
    CONSTRAINT ck_puff_print_run_scores_timestamps CHECK (
        updated_at >= achieved_at
    )
);

CREATE INDEX idx_puff_print_run_scores_ranking
    ON public.puff_print_run_scores (high_score DESC, achieved_at ASC, account_id ASC);

REVOKE ALL ON public.puff_print_run_scores FROM PUBLIC;
REVOKE ALL ON public.puff_print_run_scores FROM app_runtime_role;

GRANT SELECT ON public.puff_print_run_scores TO app_runtime_role;
GRANT INSERT (account_id, high_score)
    ON public.puff_print_run_scores TO app_runtime_role;
GRANT UPDATE (high_score, achieved_at, updated_at)
    ON public.puff_print_run_scores TO app_runtime_role;
