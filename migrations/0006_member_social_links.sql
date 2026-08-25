-- 0006_member_social_links.sql
-- Add member-owned social profile links. Apply as neondb_owner.

ALTER TABLE public.member_pages
    ADD COLUMN social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT ck_member_pages_social_links_object
        CHECK (JSONB_TYPEOF(social_links) = 'object');

-- Public page reads need the links, and the owner update path may replace them.
-- Page creation omits this column and uses its empty-object default, so the
-- runtime role does not need INSERT privilege for it.
GRANT SELECT (social_links) ON public.member_pages TO app_runtime_role;
GRANT UPDATE (social_links) ON public.member_pages TO app_runtime_role;
