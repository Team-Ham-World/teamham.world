-- scripts/provision-runtime-role.sql
-- Executed as neondb_owner via psql.
-- Generate APP_RUNTIME_ROLE_PASSWORD as 32 random bytes encoded to 43 unpadded base64url characters.

\set ON_ERROR_STOP on

\getenv runtime_pw APP_RUNTIME_ROLE_PASSWORD

-- Validate password format (43 unpadded base64url characters) without leaking the secret
SELECT (:'runtime_pw' ~ '^[0-9A-Za-z_-]{43}$') AS valid_pw_format \gset

\if :valid_pw_format
  -- Password format matches expected 43-char base64url encoding
\else
  \echo 'Error: APP_RUNTIME_ROLE_PASSWORD must be exactly 43 unpadded base64url characters.'
  -- Trigger fatal SQL error under ON_ERROR_STOP to exit nonzero immediately
  SELECT format_error_app_runtime_role_password_invalid();
\endif

BEGIN;

DO $$
DECLARE
    v_role_oid OID;
    v_has_elevated BOOLEAN;
    v_has_memberships BOOLEAN;
    v_owns_objects BOOLEAN;
BEGIN
    SELECT oid INTO v_role_oid FROM pg_roles WHERE rolname = 'app_runtime_role';

    IF v_role_oid IS NULL THEN
        CREATE ROLE app_runtime_role WITH LOGIN NOINHERIT;
    ELSE
        -- Ensure existing role does not have elevated administrative flags
        SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
        INTO v_has_elevated
        FROM pg_roles
        WHERE oid = v_role_oid;

        IF v_has_elevated THEN
            RAISE EXCEPTION 'Existing app_runtime_role has elevated administrative flags.';
        END IF;

        -- Ensure existing role has no role memberships (prevent privilege escalation / SET ROLE)
        SELECT EXISTS (
            SELECT 1 FROM pg_auth_members WHERE member = v_role_oid
        ) INTO v_has_memberships;

        IF v_has_memberships THEN
            RAISE EXCEPTION 'Existing app_runtime_role belongs to other roles.';
        END IF;

        -- Ensure existing role owns no database, schema, table/sequence, function, or type objects in current DB
        SELECT EXISTS (
            SELECT 1 FROM pg_database WHERE datdba = v_role_oid
            UNION ALL
            SELECT 1 FROM pg_namespace WHERE nspowner = v_role_oid
            UNION ALL
            SELECT 1 FROM pg_class WHERE relowner = v_role_oid
            UNION ALL
            SELECT 1 FROM pg_proc WHERE proowner = v_role_oid
            UNION ALL
            SELECT 1 FROM pg_type WHERE typowner = v_role_oid
        ) INTO v_owns_objects;

        IF v_owns_objects THEN
            RAISE EXCEPTION 'Existing app_runtime_role owns database objects in current database.';
        END IF;
    END IF;
END $$;

-- Neon owners have neon_superuser privileges but are not PostgreSQL SUPERUSER,
-- so they cannot explicitly toggle the SUPERUSER attribute. New roles default
-- to all elevated flags disabled, and existing roles were validated above.
ALTER ROLE app_runtime_role WITH LOGIN NOINHERIT PASSWORD :'runtime_pw';

REVOKE ALL ON DATABASE neondb FROM app_runtime_role;
REVOKE TEMPORARY ON DATABASE neondb FROM PUBLIC;
GRANT CONNECT ON DATABASE neondb TO app_runtime_role;
REVOKE ALL ON SCHEMA public FROM app_runtime_role;
GRANT USAGE ON SCHEMA public TO app_runtime_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
DECLARE
    v_has_auth_tables BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('accounts', 'sessions', 'game_oauth_clients', 'game_oauth_subjects', 'game_authorization_codes', 'game_access_tokens', 'puff_flappy_scores')
    ) INTO v_has_auth_tables;

    IF NOT v_has_auth_tables THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_runtime_role;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_runtime_role;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_runtime_role;
    END IF;
END $$;

COMMIT;
