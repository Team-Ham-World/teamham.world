-- One canonical puzzle and one append-only game per member per UTC day.
CREATE TABLE public.puff_puffdle_daily_puzzles (
    puzzle_date DATE PRIMARY KEY,
    target_word TEXT NOT NULL CHECK (target_word ~ '^[A-Z]{5}$')
);

CREATE TABLE public.puff_puffdle_daily_games (
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    puzzle_date DATE NOT NULL REFERENCES public.puff_puffdle_daily_puzzles(puzzle_date),
    guesses TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (account_id, puzzle_date),
    CONSTRAINT ck_puffdle_daily_guesses CHECK (
        cardinality(guesses) BETWEEN 0 AND 6
        AND array_position(guesses, NULL) IS NULL
        AND array_to_string(guesses, ',') ~ '^([A-Z]{5}(,[A-Z]{5}){0,5})?$'
    ),
    CONSTRAINT ck_puffdle_daily_status CHECK (
        (status = 'IN_PROGRESS' AND cardinality(guesses) < 6 AND completed_at IS NULL)
        OR (status = 'WON' AND cardinality(guesses) BETWEEN 1 AND 6 AND completed_at IS NOT NULL)
        OR (status = 'LOST' AND cardinality(guesses) = 6 AND completed_at IS NOT NULL)
    ),
    CONSTRAINT ck_puffdle_daily_timestamps CHECK (
        updated_at >= created_at
        AND (completed_at IS NULL OR completed_at BETWEEN created_at AND updated_at)
    )
);

CREATE OR REPLACE FUNCTION public.enforce_puffdle_daily_progress()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
    answer TEXT;
    expected_status TEXT;
BEGIN
    IF OLD.status <> 'IN_PROGRESS'
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.puzzle_date IS DISTINCT FROM OLD.puzzle_date
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.updated_at < OLD.updated_at
       OR cardinality(NEW.guesses) <> cardinality(OLD.guesses) + 1
       OR NEW.guesses[1:cardinality(OLD.guesses)] IS DISTINCT FROM OLD.guesses THEN
        RAISE EXCEPTION 'Daily Puffdle progress cannot be reset or rewritten' USING ERRCODE = '23514';
    END IF;
    SELECT target_word INTO STRICT answer FROM public.puff_puffdle_daily_puzzles
      WHERE puzzle_date = OLD.puzzle_date;
    expected_status := CASE
      WHEN NEW.guesses[cardinality(NEW.guesses)] = answer THEN 'WON'
      WHEN cardinality(NEW.guesses) = 6 THEN 'LOST'
      ELSE 'IN_PROGRESS'
    END;
    IF NEW.status IS DISTINCT FROM expected_status THEN
        RAISE EXCEPTION 'Invalid Daily Puffdle outcome' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER puffdle_daily_append_only BEFORE UPDATE ON public.puff_puffdle_daily_games
    FOR EACH ROW EXECUTE FUNCTION public.enforce_puffdle_daily_progress();

REVOKE ALL ON FUNCTION public.enforce_puffdle_daily_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_puffdle_daily_progress() TO app_runtime_role;
GRANT SELECT ON public.puff_puffdle_daily_puzzles, public.puff_puffdle_daily_games TO app_runtime_role;
GRANT INSERT (puzzle_date, target_word) ON public.puff_puffdle_daily_puzzles TO app_runtime_role;
GRANT INSERT (account_id, puzzle_date) ON public.puff_puffdle_daily_games TO app_runtime_role;
GRANT UPDATE (guesses, status, updated_at, completed_at) ON public.puff_puffdle_daily_games TO app_runtime_role;
