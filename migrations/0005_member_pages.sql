-- 0005_member_pages.sql
-- Additive member-page storage and site roles. Apply as neondb_owner.

ALTER TABLE public.accounts
    ADD COLUMN site_role VARCHAR(16) NOT NULL DEFAULT 'member',
    ADD CONSTRAINT ck_accounts_site_role
        CHECK (site_role IN ('member', 'admin'));

CREATE TABLE public.member_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_account_id UUID NOT NULL
        REFERENCES public.accounts(id) ON DELETE RESTRICT,
    created_by_account_id UUID NOT NULL
        REFERENCES public.accounts(id) ON DELETE RESTRICT,
    slug VARCHAR(63) NOT NULL,
    display_name VARCHAR(80) NOT NULL,
    blurb VARCHAR(500),
    website_url VARCHAR(2048),
    showcase JSONB,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_member_pages_owner_account_id UNIQUE (owner_account_id),
    CONSTRAINT uq_member_pages_slug UNIQUE (slug),
    CONSTRAINT ck_member_pages_slug CHECK (
        slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    ),
    CONSTRAINT ck_member_pages_display_name CHECK (
        LENGTH(BTRIM(display_name)) BETWEEN 1 AND 80
    ),
    CONSTRAINT ck_member_pages_blurb CHECK (
        blurb IS NULL OR LENGTH(blurb) <= 500
    ),
    CONSTRAINT ck_member_pages_website_url CHECK (
        website_url IS NULL OR (
            LENGTH(website_url) <= 2048
            AND website_url ~ '^https://[^[:space:]]+$'
        )
    ),
    CONSTRAINT ck_member_pages_showcase_object CHECK (
        showcase IS NULL OR JSONB_TYPEOF(showcase) = 'object'
    )
);

CREATE INDEX ix_member_pages_published_directory
    ON public.member_pages (LOWER(display_name), slug)
    WHERE is_published = TRUE;

-- Existing SELECT on accounts is table-wide; state the new read explicitly and
-- make the role boundary auditable. Role assignment remains owner-only.
GRANT SELECT (site_role) ON public.accounts TO app_runtime_role;
REVOKE UPDATE (site_role) ON public.accounts FROM app_runtime_role;

GRANT SELECT (
    id,
    owner_account_id,
    slug,
    display_name,
    blurb,
    website_url,
    showcase,
    is_published
) ON public.member_pages TO app_runtime_role;
GRANT INSERT (
    owner_account_id,
    created_by_account_id,
    slug,
    display_name,
    blurb,
    website_url,
    showcase,
    is_published
) ON public.member_pages TO app_runtime_role;
GRANT UPDATE (
    owner_account_id,
    display_name,
    blurb,
    website_url,
    showcase,
    is_published,
    updated_at
) ON public.member_pages TO app_runtime_role;
