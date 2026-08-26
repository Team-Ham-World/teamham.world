-- 0007_member_page_personalization_v2.sql
-- Add V2 draft/publication state and private member-page asset metadata.
-- Apply as neondb_owner.

-- Refuse to backfill legacy rows that cannot be converted canonically. Remote
-- external imageUrl values are intentionally allowed here; the operator-run
-- importer decides whether to import them, while the V2 document omits them.
-- PostgreSQL BTRIM removes only ASCII spaces by default, while the shared V2
-- parser applies NFC normalization and ECMAScript String#trim. Keep that
-- canonicalization local to this migration so backfilled JSON exactly matches
-- legacyToDoc() without adding a permanent database function.
-- URL predicates below deliberately implement a fail-closed ASCII-host subset
-- instead of pretending PostgreSQL regexes reproduce WHATWG URL/IDNA parsing.
-- The required Phase-0 audit must leave no valid legacy row outside this subset
-- (for example IPv6 or IDN hosts) before the unchanged migration is applied.
CREATE OR REPLACE FUNCTION pg_temp.member_page_v2_canonical_text(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
    SELECT BTRIM(
        NORMALIZE(value, NFC),
        U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
    );
$function$;

-- PostgreSQL POSIX character classes are collation-sensitive. Check the V2
-- control ranges by Unicode code point so C1 controls cannot vary by locale.
-- PostgreSQL text cannot contain U+0000, so the first representable range
-- begins at U+0001.
CREATE OR REPLACE FUNCTION pg_temp.member_page_v2_has_control(value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM GENERATE_SERIES(1, LENGTH(value)) AS codepoint_index(position)
        WHERE ASCII(SUBSTRING(value FROM codepoint_index.position FOR 1)) BETWEEN 1 AND 31
           OR ASCII(SUBSTRING(value FROM codepoint_index.position FOR 1)) BETWEEN 127 AND 159
    );
$function$;

-- The runbook applies this file in one transaction. Prevent a legacy write
-- from landing between the validation scan and the deterministic backfill.
LOCK TABLE public.member_pages IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
DECLARE
    malformed_page_id UUID;
BEGIN
    SELECT member_pages.id
    INTO malformed_page_id
    FROM public.member_pages
    WHERE pg_temp.member_page_v2_canonical_text(member_pages.display_name) = ''
       OR LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.display_name)) > 80
       OR pg_temp.member_page_v2_has_control(member_pages.display_name)
       OR (
            member_pages.blurb IS NOT NULL
            AND (
                LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.blurb)) > 500
                OR pg_temp.member_page_v2_has_control(member_pages.blurb)
            )
       )
       OR (
            member_pages.website_url IS NOT NULL
            AND pg_temp.member_page_v2_canonical_text(member_pages.website_url) <> ''
            AND (
                LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.website_url)) > 2048
                OR pg_temp.member_page_v2_has_control(member_pages.website_url)
                OR pg_temp.member_page_v2_canonical_text(member_pages.website_url) !~*
                    '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#].*)?$'
                OR COALESCE(
                    SUBSTRING(
                        pg_temp.member_page_v2_canonical_text(member_pages.website_url)
                        FROM '(?i)^https://[^/?#]+:([0-9]{1,5})([/?#]|$)'
                    ),
                    '0'
                )::INTEGER > 65535
                OR (
                    SUBSTRING(
                        pg_temp.member_page_v2_canonical_text(member_pages.website_url)
                        FROM '(?i)^https://([^:/?#]+)'
                    ) ~* '(^|[.])xn--|(^|[.])([0-9]+|0x[0-9a-f]*)$'
                    AND SUBSTRING(
                        pg_temp.member_page_v2_canonical_text(member_pages.website_url)
                        FROM '(?i)^https://([^:/?#]+)'
                    ) !~ '^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])[.]){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$'
                )
            )
       )
       OR CASE
            WHEN JSONB_TYPEOF(member_pages.social_links) IS DISTINCT FROM 'object' THEN TRUE
            ELSE EXISTS (
                SELECT 1
                FROM JSONB_EACH(member_pages.social_links) AS social_link(platform, value)
                WHERE social_link.platform NOT IN (
                    'github',
                    'bluesky',
                    'mastodon',
                    'instagram',
                    'youtube',
                    'twitch',
                    'x'
                )
                   OR CASE
                        WHEN JSONB_TYPEOF(social_link.value) = 'null' THEN FALSE
                        WHEN JSONB_TYPEOF(social_link.value) IS DISTINCT FROM 'string' THEN TRUE
                        WHEN pg_temp.member_page_v2_canonical_text(social_link.value #>> '{}') = '' THEN FALSE
                        ELSE
                            LENGTH(pg_temp.member_page_v2_canonical_text(social_link.value #>> '{}')) > 2048
                            OR pg_temp.member_page_v2_has_control(social_link.value #>> '{}')
                            OR pg_temp.member_page_v2_canonical_text(social_link.value #>> '{}') !~*
                                '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#].*)?$'
                            OR COALESCE(
                                SUBSTRING(
                                    pg_temp.member_page_v2_canonical_text(social_link.value #>> '{}')
                                    FROM '(?i)^https://[^/?#]+:([0-9]{1,5})([/?#]|$)'
                                ),
                                '0'
                            )::INTEGER > 65535
                            OR (
                                SUBSTRING(
                                    pg_temp.member_page_v2_canonical_text(social_link.value #>> '{}')
                                    FROM '(?i)^https://([^:/?#]+)'
                                ) ~* '(^|[.])xn--|(^|[.])([0-9]+|0x[0-9a-f]*)$'
                                AND SUBSTRING(
                                    pg_temp.member_page_v2_canonical_text(social_link.value #>> '{}')
                                    FROM '(?i)^https://([^:/?#]+)'
                                ) !~ '^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])[.]){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$'
                            )
                    END
            )
       END
       OR CASE
            WHEN member_pages.showcase IS NULL THEN FALSE
            WHEN JSONB_TYPEOF(member_pages.showcase) IS DISTINCT FROM 'object' THEN TRUE
            WHEN JSONB_TYPEOF(member_pages.showcase->'kind') IS DISTINCT FROM 'string' THEN TRUE
            WHEN member_pages.showcase->>'kind' = 'project' THEN
                EXISTS (
                    SELECT 1
                    FROM JSONB_OBJECT_KEYS(member_pages.showcase) AS showcase_key(key)
                    WHERE showcase_key.key NOT IN ('kind', 'projectSlug')
                )
                OR JSONB_TYPEOF(member_pages.showcase->'projectSlug') IS DISTINCT FROM 'string'
                -- Reviewed registry snapshot from src/data/projects.ts at migration
                -- authoring time. Update this list only with a reviewed registry change.
                OR member_pages.showcase->>'projectSlug' NOT IN ('untitled-quiz-show')
            WHEN member_pages.showcase->>'kind' = 'external' THEN
                EXISTS (
                    SELECT 1
                    FROM JSONB_OBJECT_KEYS(member_pages.showcase) AS showcase_key(key)
                    WHERE showcase_key.key NOT IN (
                        'kind',
                        'name',
                        'shortDescription',
                        'type',
                        'status',
                        'url',
                        'repository',
                        'imageUrl'
                    )
                )
                OR JSONB_TYPEOF(member_pages.showcase->'name') IS DISTINCT FROM 'string'
                OR pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'name') = ''
                OR LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'name')) > 80
                OR pg_temp.member_page_v2_has_control(member_pages.showcase->>'name')
                OR JSONB_TYPEOF(member_pages.showcase->'shortDescription') IS DISTINCT FROM 'string'
                OR pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'shortDescription') = ''
                OR LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'shortDescription')) > 500
                OR pg_temp.member_page_v2_has_control(member_pages.showcase->>'shortDescription')
                OR JSONB_TYPEOF(member_pages.showcase->'type') IS DISTINCT FROM 'string'
                OR pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'type') = ''
                OR LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'type')) > 80
                OR pg_temp.member_page_v2_has_control(member_pages.showcase->>'type')
                OR JSONB_TYPEOF(member_pages.showcase->'status') IS DISTINCT FROM 'string'
                OR member_pages.showcase->>'status' NOT IN (
                    'planning',
                    'in-development',
                    'playable',
                    'released',
                    'paused',
                    'retired'
                )
                OR CASE
                    WHEN NOT (member_pages.showcase ? 'url') THEN FALSE
                    WHEN JSONB_TYPEOF(member_pages.showcase->'url') = 'null' THEN FALSE
                    WHEN JSONB_TYPEOF(member_pages.showcase->'url') IS DISTINCT FROM 'string' THEN TRUE
                    WHEN pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'url') = '' THEN FALSE
                    ELSE
                        LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'url')) > 2048
                        OR pg_temp.member_page_v2_has_control(member_pages.showcase->>'url')
                        OR pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'url') !~*
                            '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#].*)?$'
                        OR COALESCE(
                            SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'url')
                                FROM '(?i)^https://[^/?#]+:([0-9]{1,5})([/?#]|$)'
                            ),
                            '0'
                        )::INTEGER > 65535
                        OR (
                            SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'url')
                                FROM '(?i)^https://([^:/?#]+)'
                            ) ~* '(^|[.])xn--|(^|[.])([0-9]+|0x[0-9a-f]*)$'
                            AND SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'url')
                                FROM '(?i)^https://([^:/?#]+)'
                            ) !~ '^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])[.]){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$'
                        )
                END
                OR CASE
                    WHEN NOT (member_pages.showcase ? 'repository') THEN FALSE
                    WHEN JSONB_TYPEOF(member_pages.showcase->'repository') = 'null' THEN FALSE
                    WHEN JSONB_TYPEOF(member_pages.showcase->'repository') IS DISTINCT FROM 'string' THEN TRUE
                    WHEN pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'repository') = '' THEN FALSE
                    ELSE
                        LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'repository')) > 2048
                        OR pg_temp.member_page_v2_has_control(member_pages.showcase->>'repository')
                        OR pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'repository') !~*
                            '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#].*)?$'
                        OR COALESCE(
                            SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'repository')
                                FROM '(?i)^https://[^/?#]+:([0-9]{1,5})([/?#]|$)'
                            ),
                            '0'
                        )::INTEGER > 65535
                        OR (
                            SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'repository')
                                FROM '(?i)^https://([^:/?#]+)'
                            ) ~* '(^|[.])xn--|(^|[.])([0-9]+|0x[0-9a-f]*)$'
                            AND SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'repository')
                                FROM '(?i)^https://([^:/?#]+)'
                            ) !~ '^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])[.]){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$'
                        )
                END
                OR CASE
                    WHEN NOT (member_pages.showcase ? 'imageUrl') THEN FALSE
                    WHEN JSONB_TYPEOF(member_pages.showcase->'imageUrl') = 'null' THEN FALSE
                    WHEN JSONB_TYPEOF(member_pages.showcase->'imageUrl') IS DISTINCT FROM 'string' THEN TRUE
                    WHEN pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'imageUrl') = '' THEN FALSE
                    ELSE
                        LENGTH(pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'imageUrl')) > 2048
                        OR pg_temp.member_page_v2_has_control(member_pages.showcase->>'imageUrl')
                        OR pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'imageUrl') !~*
                            '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#].*)?$'
                        OR COALESCE(
                            SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'imageUrl')
                                FROM '(?i)^https://[^/?#]+:([0-9]{1,5})([/?#]|$)'
                            ),
                            '0'
                        )::INTEGER > 65535
                        OR (
                            SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'imageUrl')
                                FROM '(?i)^https://([^:/?#]+)'
                            ) ~* '(^|[.])xn--|(^|[.])([0-9]+|0x[0-9a-f]*)$'
                            AND SUBSTRING(
                                pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'imageUrl')
                                FROM '(?i)^https://([^:/?#]+)'
                            ) !~ '^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])[.]){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$'
                        )
                END
            ELSE TRUE
       END
    ORDER BY member_pages.id
    LIMIT 1;

    IF malformed_page_id IS NOT NULL THEN
        RAISE EXCEPTION
            '0007 precondition failed: malformed or unsupported legacy member page %',
            malformed_page_id
            USING ERRCODE = 'check_violation';
    END IF;
END
$migration$;

ALTER TABLE public.member_pages
    ADD COLUMN draft_doc JSONB,
    ADD COLUMN published_doc JSONB,
    ADD COLUMN draft_rev BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN draft_updated_at TIMESTAMPTZ,
    ADD COLUMN published_at TIMESTAMPTZ,
    ADD COLUMN unpublished_at TIMESTAMPTZ,
    ADD COLUMN moderation_hold BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN moderation_held_at TIMESTAMPTZ,
    ADD COLUMN asset_pending_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN asset_ready_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN asset_alloc_window_started_at TIMESTAMPTZ,
    ADD COLUMN asset_alloc_window_count INTEGER NOT NULL DEFAULT 0;

-- Build each converted document once so published pages receive an identical
-- draft and published snapshot. Block IDs are deterministic from the page UUID.
WITH converted AS (
    SELECT
        member_pages.id,
        member_pages.is_published,
        member_pages.updated_at,
        jsonb_build_object(
            'schemaVersion', 2,
            'frame', jsonb_build_object(
                'displayName', pg_temp.member_page_v2_canonical_text(member_pages.display_name),
                'summary', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.blurb), ''),
                'websiteUrl', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.website_url), ''),
                'socialLinks', jsonb_strip_nulls(
                    jsonb_build_object(
                        'github', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.social_links->>'github'), ''),
                        'bluesky', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.social_links->>'bluesky'), ''),
                        'mastodon', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.social_links->>'mastodon'), ''),
                        'instagram', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.social_links->>'instagram'), ''),
                        'youtube', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.social_links->>'youtube'), ''),
                        'twitch', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.social_links->>'twitch'), ''),
                        'x', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.social_links->>'x'), '')
                    )
                ),
                'portrait', NULL,
                'theme', jsonb_build_object(
                    'id', 'paper',
                    'accentId', 'default'
                )
            ),
            'blocks', CASE
                WHEN member_pages.showcase IS NULL THEN '[]'::jsonb
                WHEN member_pages.showcase->>'kind' = 'project' THEN
                    jsonb_build_array(
                        jsonb_build_object(
                            'id', 'legacy-featured-' || member_pages.id::text,
                            'type', 'featuredProject',
                            'variant', 'card',
                            'project', jsonb_build_object(
                                'kind', 'ham',
                                'projectSlug', member_pages.showcase->>'projectSlug'
                            )
                        )
                    )
                WHEN member_pages.showcase->>'kind' = 'external' THEN
                    jsonb_build_array(
                        jsonb_build_object(
                            'id', 'legacy-featured-' || member_pages.id::text,
                            'type', 'featuredProject',
                            'variant', 'card',
                            'project', jsonb_strip_nulls(
                                jsonb_build_object(
                                    'kind', 'external',
                                    'name', pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'name'),
                                    'shortDescription', pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'shortDescription'),
                                    'type', pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'type'),
                                    'status', member_pages.showcase->>'status',
                                    'url', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'url'), ''),
                                    'repository', NULLIF(pg_temp.member_page_v2_canonical_text(member_pages.showcase->>'repository'), '')
                                )
                            )
                        )
                    )
            END
        ) AS doc
    FROM public.member_pages
)
UPDATE public.member_pages
SET
    draft_doc = converted.doc,
    published_doc = CASE
        WHEN converted.is_published THEN converted.doc
        ELSE NULL
    END,
    draft_rev = 0,
    draft_updated_at = converted.updated_at
FROM converted
WHERE public.member_pages.id = converted.id;

ALTER TABLE public.member_pages
    ALTER COLUMN draft_doc SET NOT NULL,
    ALTER COLUMN draft_updated_at SET DEFAULT NOW(),
    ALTER COLUMN draft_updated_at SET NOT NULL,
    ADD CONSTRAINT ck_member_pages_draft_doc_v2 CHECK (
        JSONB_TYPEOF(draft_doc) = 'object'
        AND draft_doc ? 'schemaVersion'
        AND JSONB_TYPEOF(draft_doc->'schemaVersion') = 'number'
        AND draft_doc->'schemaVersion' = '2'::jsonb
    ),
    ADD CONSTRAINT ck_member_pages_published_doc_v2 CHECK (
        published_doc IS NULL OR (
            JSONB_TYPEOF(published_doc) = 'object'
            AND published_doc ? 'schemaVersion'
            AND JSONB_TYPEOF(published_doc->'schemaVersion') = 'number'
            AND published_doc->'schemaVersion' = '2'::jsonb
        )
    ),
    ADD CONSTRAINT ck_member_pages_published_doc_required CHECK (
        is_published = FALSE OR published_doc IS NOT NULL
    ),
    ADD CONSTRAINT ck_member_pages_hold_not_public CHECK (
        moderation_hold = FALSE OR is_published = FALSE
    ),
    ADD CONSTRAINT ck_member_pages_draft_rev_nonnegative CHECK (
        draft_rev >= 0
    ),
    ADD CONSTRAINT ck_member_pages_draft_doc_size CHECK (
        pg_column_size(draft_doc) <= 524288
    ),
    ADD CONSTRAINT ck_member_pages_published_doc_size CHECK (
        published_doc IS NULL OR pg_column_size(published_doc) <= 524288
    ),
    ADD CONSTRAINT ck_member_pages_asset_pending_count CHECK (
        asset_pending_count BETWEEN 0 AND 5
    ),
    ADD CONSTRAINT ck_member_pages_asset_ready_count CHECK (
        asset_ready_count BETWEEN 0 AND 20
    ),
    ADD CONSTRAINT ck_member_pages_asset_alloc_window_count CHECK (
        asset_alloc_window_count >= 0
    ),
    ADD CONSTRAINT ck_member_pages_asset_alloc_window_state CHECK (
        asset_alloc_window_count = 0
        OR asset_alloc_window_started_at IS NOT NULL
    );

-- Server-side fixed-window limits bound direct/replayed mutation requests.
-- Normal editor cadence remains well below these deliberately generous caps;
-- the application owns the exact window durations and attempt ceilings.
CREATE TABLE public.member_page_mutation_rate_limits (
    member_page_id UUID NOT NULL,
    action VARCHAR(32) NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL,
    CONSTRAINT pk_member_page_mutation_rate_limits
        PRIMARY KEY (member_page_id, action),
    CONSTRAINT fk_member_page_mutation_rate_limits_page
        FOREIGN KEY (member_page_id)
        REFERENCES public.member_pages(id)
        ON DELETE CASCADE,
    CONSTRAINT ck_member_page_mutation_rate_limits_action CHECK (
        action IN ('autosave', 'publish', 'asset-finalize')
    ),
    CONSTRAINT ck_member_page_mutation_rate_limits_count CHECK (
        attempt_count >= 1
    )
);

-- member_page_assets is introduced empty below, so the zero counter defaults
-- are already exact and no counter backfill is needed. Pending counters track
-- unclaimed pending rows. Ready counters track every stored ready metadata row,
-- including deletion claims, until metadata deletion.
CREATE TABLE public.member_page_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_page_id UUID NOT NULL,
    object_key TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    mime_type VARCHAR(32),
    byte_size BIGINT,
    width INTEGER,
    height INTEGER,
    etag TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ready_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    pending_expires_at TIMESTAMPTZ NOT NULL,
    deletion_claimed_at TIMESTAMPTZ,
    CONSTRAINT fk_member_page_assets_member_page
        FOREIGN KEY (member_page_id)
        REFERENCES public.member_pages(id)
        ON DELETE RESTRICT,
    CONSTRAINT uq_member_page_assets_object_key UNIQUE (object_key),
    CONSTRAINT ck_member_page_assets_status CHECK (
        status IN ('pending', 'ready')
    ),
    CONSTRAINT ck_member_page_assets_mime_type CHECK (
        mime_type IS NULL OR mime_type IN (
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/avif'
        )
    ),
    CONSTRAINT ck_member_page_assets_byte_size CHECK (
        byte_size IS NULL OR byte_size BETWEEN 1 AND 5242880
    ),
    CONSTRAINT ck_member_page_assets_dimensions CHECK (
        (width IS NULL AND height IS NULL)
        OR (
            width IS NOT NULL
            AND height IS NOT NULL
            AND width BETWEEN 1 AND 4000
            AND height BETWEEN 1 AND 4000
        )
    ),
    CONSTRAINT ck_member_page_assets_etag CHECK (
        etag IS NULL OR (
            OCTET_LENGTH(etag) BETWEEN 1 AND 256
            AND etag ~ '^[A-Za-z0-9][A-Za-z0-9._:+/=-]{0,255}$'
        )
    ),
    CONSTRAINT ck_member_page_assets_ready_complete CHECK (
        status <> 'ready' OR (
            mime_type IS NOT NULL
            AND byte_size IS NOT NULL
            AND width IS NOT NULL
            AND height IS NOT NULL
            AND etag IS NOT NULL
            AND ready_at IS NOT NULL
            AND verified_at IS NOT NULL
        )
    ),
    CONSTRAINT ck_member_page_assets_pending_incomplete CHECK (
        status <> 'pending' OR (
            mime_type IS NULL
            AND byte_size IS NULL
            AND width IS NULL
            AND height IS NULL
            AND etag IS NULL
            AND ready_at IS NULL
            AND verified_at IS NULL
        )
    )
);

CREATE INDEX ix_member_page_assets_page
    ON public.member_page_assets (member_page_id, status);

-- Opportunistic cleanup scans only outstanding pending expirations without
-- carrying ready assets in the cleanup index.
CREATE INDEX ix_member_page_assets_pending_expiry
    ON public.member_page_assets (pending_expires_at)
    WHERE status = 'pending';

-- V2 reads and guarded asset statements need documents, workflow metadata, and
-- the four counter/window fields. Existing V1 grants remain for the bridge.
GRANT SELECT (
    draft_doc,
    published_doc,
    draft_rev,
    draft_updated_at,
    published_at,
    unpublished_at,
    moderation_hold,
    moderation_held_at,
    asset_pending_count,
    asset_ready_count,
    asset_alloc_window_started_at,
    asset_alloc_window_count
) ON public.member_pages TO app_runtime_role;

-- Autosave, publication, moderation, and atomic asset transitions each update
-- a subset of these columns through guarded application statements.
GRANT UPDATE (
    draft_doc,
    published_doc,
    draft_rev,
    draft_updated_at,
    published_at,
    unpublished_at,
    moderation_hold,
    moderation_held_at,
    asset_pending_count,
    asset_ready_count,
    asset_alloc_window_started_at,
    asset_alloc_window_count
) ON public.member_pages TO app_runtime_role;

-- Bridge page creation explicitly supplies the draft and publication snapshot
-- fields, including NULL publication values for unpublished pages. Other V2
-- state continues to use database defaults.
GRANT INSERT (
    draft_doc,
    published_doc,
    published_at
) ON public.member_pages TO app_runtime_role;

-- Object keys are server-only but are required by runtime upload, serving, and
-- cleanup paths. Column grants keep the boundary explicit and auditable.
GRANT SELECT (
    id,
    member_page_id,
    object_key,
    status,
    mime_type,
    byte_size,
    width,
    height,
    etag,
    created_at,
    ready_at,
    verified_at,
    pending_expires_at,
    deletion_claimed_at
) ON public.member_page_assets TO app_runtime_role;

-- Pending allocation relies on defaults for id, status, and created_at.
GRANT INSERT (
    member_page_id,
    object_key,
    pending_expires_at
) ON public.member_page_assets TO app_runtime_role;

-- Finalization writes verified metadata; guarded cleanup first claims a row.
GRANT UPDATE (
    status,
    mime_type,
    byte_size,
    width,
    height,
    etag,
    ready_at,
    verified_at,
    deletion_claimed_at
) ON public.member_page_assets TO app_runtime_role;

-- This is the runtime role's first DELETE outside session/token lifecycle
-- tables. It is required only after the application has guarded ownership,
-- document references, and the cross-service deletion claim.
GRANT DELETE ON public.member_page_assets TO app_runtime_role;

-- Mutation limit UPSERTs read the current window and update only its counter
-- and start time. The runtime cannot delete rows or change their page/action.
GRANT SELECT (
    member_page_id,
    action,
    window_started_at,
    attempt_count
) ON public.member_page_mutation_rate_limits TO app_runtime_role;

GRANT INSERT (
    member_page_id,
    action,
    window_started_at,
    attempt_count
) ON public.member_page_mutation_rate_limits TO app_runtime_role;

GRANT UPDATE (
    window_started_at,
    attempt_count
) ON public.member_page_mutation_rate_limits TO app_runtime_role;

DROP FUNCTION pg_temp.member_page_v2_has_control(TEXT);
DROP FUNCTION pg_temp.member_page_v2_canonical_text(TEXT);
