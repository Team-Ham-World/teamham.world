-- 0008_member_page_moderation_privileges.sql
--
-- PostgreSQL requires SELECT privilege for every column named by RETURNING.
-- Moderation updates already have UPDATE access to updated_at, but their
-- operation metadata also returns it to the server.

GRANT SELECT (updated_at) ON public.member_pages TO app_runtime_role;
