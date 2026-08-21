-- 0003_account_display_name.sql
-- Applied manually by maintainer using neondb_owner

-- Stores the Discord username so the site can greet a signed-in member by name.
-- Nullable and cosmetic: a login must still succeed when Discord omits the
-- field or returns a value outside the accepted shape, in which case the UI
-- falls back to a generic label.
ALTER TABLE public.accounts
    ADD COLUMN discord_username VARCHAR(32)
        CONSTRAINT ck_accounts_discord_username
        CHECK (discord_username IS NULL OR discord_username ~ '^[A-Za-z0-9._]{2,32}$');

-- Least-privilege: the runtime role may write this column during login only.
-- It still cannot touch discord_user_id or access_status.
GRANT INSERT (discord_username) ON public.accounts TO app_runtime_role;
GRANT UPDATE (discord_username) ON public.accounts TO app_runtime_role;
