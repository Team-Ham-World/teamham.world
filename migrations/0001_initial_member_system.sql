-- 0001_initial_member_system.sql
-- Applied manually by maintainer using neondb_owner

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE public.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_user_id VARCHAR(20) NOT NULL
        CHECK (discord_user_id ~ '^[0-9]{1,20}$'),
    membership_status VARCHAR(16) NOT NULL
        CHECK (membership_status IN ('eligible', 'ineligible')),
    access_status VARCHAR(16) NOT NULL
        CHECK (access_status IN ('active', 'suspended')),
    membership_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_accounts_discord_user_id UNIQUE (discord_user_id)
);

CREATE TABLE public.sessions (
    account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_sessions_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_sessions_expiry CHECK (
        expires_at > created_at AND
        expires_at <= created_at + INTERVAL '24 hours'
    )
);

-- Grant minimal permissions to app_runtime_role
GRANT SELECT ON public.accounts, public.sessions TO app_runtime_role;
GRANT INSERT (discord_user_id, membership_status, access_status, membership_checked_at)
    ON public.accounts TO app_runtime_role;
GRANT UPDATE (membership_status, membership_checked_at, updated_at)
    ON public.accounts TO app_runtime_role;
GRANT INSERT (account_id, token_hash, created_at, expires_at)
    ON public.sessions TO app_runtime_role;
GRANT UPDATE (token_hash, created_at, expires_at)
    ON public.sessions TO app_runtime_role;
GRANT DELETE ON public.sessions TO app_runtime_role;
