-- 0002_game_backend_authorization.sql
-- Applied manually by maintainer using neondb_owner
-- Assumes 0001_initial_member_system.sql and app_runtime_role exist.

CREATE TABLE public.game_oauth_clients (
    client_id VARCHAR(64) PRIMARY KEY
        CHECK (client_id ~ '^[a-z][a-z0-9_-]{2,63}$'),
    audience VARCHAR(128) NOT NULL UNIQUE
        CHECK (
            audience ~ '^urn:teamham:game:[a-z][a-z0-9_-]{2,63}$' AND
            audience = ('urn:teamham:game:' || client_id)
        ),
    redirect_uri TEXT NOT NULL UNIQUE
        CHECK (
            octet_length(redirect_uri) <= 512 AND
            length(redirect_uri) <= 512 AND
            redirect_uri ~ '^https://([a-z0-9.-]+\.teamham\.world|(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?)/[^?#@\s]+$'
        ),
    client_secret_hash VARCHAR(64) NOT NULL
        CHECK (client_secret_hash ~ '^[0-9a-f]{64}$'),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.game_oauth_subjects (
    client_id VARCHAR(64) NOT NULL REFERENCES public.game_oauth_clients(client_id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_game_oauth_subjects PRIMARY KEY (client_id, account_id),
    CONSTRAINT uq_game_oauth_subjects_subject_id UNIQUE (subject_id)
);

CREATE TABLE public.game_authorization_codes (
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    client_id VARCHAR(64) NOT NULL REFERENCES public.game_oauth_clients(client_id) ON DELETE CASCADE,
    code_hash VARCHAR(64) NOT NULL
        CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    redirect_uri TEXT NOT NULL,
    audience VARCHAR(128) NOT NULL,
    code_challenge VARCHAR(43) NOT NULL
        CHECK (code_challenge ~ '^[0-9A-Za-z_-]{43}$'),
    source_session_hash VARCHAR(64) NOT NULL
        CHECK (source_session_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CONSTRAINT pk_game_authorization_codes PRIMARY KEY (account_id, client_id),
    CONSTRAINT uq_game_authorization_codes_code_hash UNIQUE (code_hash),
    CONSTRAINT ck_game_authorization_codes_expiry CHECK (
        expires_at > created_at AND
        expires_at <= created_at + INTERVAL '60 seconds'
    ),
    CONSTRAINT ck_game_authorization_codes_consumed CHECK (
        consumed_at IS NULL OR
        consumed_at >= created_at
    )
);

CREATE TABLE public.game_access_tokens (
    account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
    client_id VARCHAR(64) NOT NULL REFERENCES public.game_oauth_clients(client_id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    audience VARCHAR(128) NOT NULL,
    source_session_hash VARCHAR(64) NOT NULL
        CHECK (source_session_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_game_access_tokens PRIMARY KEY (account_id, client_id),
    CONSTRAINT uq_game_access_tokens_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_game_access_tokens_expiry CHECK (
        expires_at > created_at AND
        expires_at <= created_at + INTERVAL '24 hours'
    )
);

-- Revoke all permissions on the new tables from app_runtime_role
REVOKE ALL ON public.game_oauth_clients,
              public.game_oauth_subjects,
              public.game_authorization_codes,
              public.game_access_tokens
FROM app_runtime_role;

-- Grant minimal permissions to app_runtime_role
GRANT SELECT ON public.game_oauth_clients TO app_runtime_role;

GRANT SELECT ON public.game_oauth_subjects TO app_runtime_role;
GRANT INSERT (client_id, account_id)
    ON public.game_oauth_subjects TO app_runtime_role;

GRANT SELECT ON public.game_authorization_codes TO app_runtime_role;
GRANT INSERT (account_id, client_id, code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at, consumed_at)
    ON public.game_authorization_codes TO app_runtime_role;
GRANT UPDATE (code_hash, redirect_uri, audience, code_challenge, source_session_hash, created_at, expires_at, consumed_at)
    ON public.game_authorization_codes TO app_runtime_role;

GRANT SELECT ON public.game_access_tokens TO app_runtime_role;
GRANT INSERT (account_id, client_id, token_hash, audience, source_session_hash, created_at, expires_at)
    ON public.game_access_tokens TO app_runtime_role;
GRANT UPDATE (token_hash, audience, source_session_hash, created_at, expires_at)
    ON public.game_access_tokens TO app_runtime_role;
GRANT DELETE ON public.game_access_tokens TO app_runtime_role;
