# Neon migration runbook

This is the source of truth for applying a committed SQL file from `migrations/` to TeamHam's Neon database.

## Target

- Neon organization: `TeamHam` (`org-little-star-80689271`)
- Neon project: `TeamHam` (`dawn-shadow-64303881`)
- Production branch: `production` (`br-wispy-cloud-axvw73sw`)
- Database: `neondb`
- Migration owner: `neondb_owner`
- Application role: `app_runtime_role`

Verify the project and production branch in Neon at the start of every run. Treat the names and IDs above as expected values, not permission to operate on a different target.

## Procedure

1. Read the project-installed `neon` and `neon-postgres` skills completely. Use the official Neon CLI and its current `--help` output for commands. Keep connection strings out of files and output; `neon psql` can connect with the authenticated CLI profile.

   Completion criterion: both skills have been read and the current CLI help confirms every flag used below.

2. Establish the exact migration and target before changing the database:

   ```bash
   export NEON_ORG_ID=org-little-star-80689271
   export NEON_PROJECT_ID=dawn-shadow-64303881
   export NEON_PRODUCTION_BRANCH=production
   export NEON_DATABASE=neondb
   export NEON_OWNER_ROLE=neondb_owner
   export NEON_RUNTIME_ROLE=app_runtime_role
   export NEON_MIGRATION_FILE=migrations/REPLACE_WITH_MIGRATION_FILE.sql

   npx -y neon@latest projects list --org-id "$NEON_ORG_ID"
   npx -y neon@latest branches list --project-id "$NEON_PROJECT_ID"
   ```

   Replace `REPLACE_WITH_MIGRATION_FILE` before continuing. Read the migration file and inspect the current production schema with read-only queries. The migration must be represented in source control rather than improvised at the prompt. Production execution requires an explicit user request to apply that migration.

   Completion criterion: the authenticated organization, project, branch name, and branch ID match the target above; the exact migration file and production pre-state are known; and production authorization is present.

3. Create an expiring rehearsal branch directly from production. Choose a unique name and a UTC expiration no more than 24 hours away:

   ```bash
   export NEON_REHEARSAL_BRANCH=REPLACE_WITH_UNIQUE_REHEARSAL_BRANCH
   export NEON_REHEARSAL_EXPIRES_AT=REPLACE_WITH_ISO_8601_UTC_TIMESTAMP

   npx -y neon@latest branches create \
     --project-id "$NEON_PROJECT_ID" \
     --parent "$NEON_PRODUCTION_BRANCH" \
     --name "$NEON_REHEARSAL_BRANCH" \
     --expires-at "$NEON_REHEARSAL_EXPIRES_AT"
   ```

   Completion criterion: Neon reports the new branch under the expected project with `production` as its parent and the requested expiration.

4. Apply the migration to the rehearsal branch through the direct, non-pooled owner connection:

   ```bash
   npx -y neon@latest psql "$NEON_REHEARSAL_BRANCH" \
     --project-id "$NEON_PROJECT_ID" \
     --database-name "$NEON_DATABASE" \
     --role-name "$NEON_OWNER_ROLE" \
     -- \
     --set ON_ERROR_STOP=1 \
     --single-transaction \
     --file "$NEON_MIGRATION_FILE"
   ```

   Completion criterion: the command exits successfully and every statement runs inside the single transaction. If the migration contains an operation that cannot run in a transaction, stop and write a migration-specific rollout and rollback plan before production execution.

5. Verify every schema object, constraint, index, and grant introduced by the migration. Then connect as `app_runtime_role` and execute the least-privileged query path the application needs. For `0004_puff_flappy_leaderboard.sql`, the checks include:

   ```sql
   SELECT
     to_regclass('public.puff_flappy_scores') IS NOT NULL AS table_exists,
     has_table_privilege('app_runtime_role', 'public.puff_flappy_scores', 'SELECT') AS can_select,
     has_column_privilege('app_runtime_role', 'public.puff_flappy_scores', 'high_score', 'UPDATE') AS can_update_score,
     has_column_privilege('app_runtime_role', 'public.puff_flappy_scores', 'account_id', 'INSERT') AS can_insert_account;
   ```

   ```bash
   npx -y neon@latest psql "$NEON_REHEARSAL_BRANCH" \
     --project-id "$NEON_PROJECT_ID" \
     --database-name "$NEON_DATABASE" \
     --role-name "$NEON_RUNTIME_ROLE" \
     -- \
     --set ON_ERROR_STOP=1 \
     --command "SELECT count(*) FROM public.puff_flappy_scores;"
   ```

   Completion criterion: every migration-specific assertion is true and the runtime-role query succeeds. Any failure stops the production run.

6. Recheck production immediately before execution. If the entire intended state already exists, report the migration as already applied and stop. If only part exists, stop and diagnose the drift. Otherwise apply the same file, unchanged, to production:

   ```bash
   npx -y neon@latest psql "$NEON_PRODUCTION_BRANCH" \
     --project-id "$NEON_PROJECT_ID" \
     --database-name "$NEON_DATABASE" \
     --role-name "$NEON_OWNER_ROLE" \
     -- \
     --set ON_ERROR_STOP=1 \
     --single-transaction \
     --file "$NEON_MIGRATION_FILE"
   ```

   Completion criterion: the production command exits successfully with no skipped or failed statements.

7. Repeat the complete migration-specific and runtime-role verification against `production`. Exercise the affected application endpoint when one exists. For the Puff leaderboard, verify that `https://teamham.world/api/puff/leaderboard` returns a successful signed-out response and, when a test member session is available, that a score can be saved and read back.

   Completion criterion: every database assertion and available application check passes against production.

8. Report the migration file, project, branch, rehearsal result, production result, privilege checks, application check, and rehearsal branch expiration. Never include credentials or connection strings in the report. Let the rehearsal branch expire, or delete it after validation if the user explicitly requests cleanup.

   Completion criterion: the report identifies every check and its result without exposing secrets, and the rehearsal branch has an explicit expiration or approved cleanup action.

## Failure handling

`ON_ERROR_STOP` plus `--single-transaction` makes a failed migration roll back as a unit. On failure, preserve the error, inspect production for drift, fix the SQL migration in source control, and repeat the rehearsal on a fresh child branch. Do not patch production manually or blindly rerun a partially understood migration.
