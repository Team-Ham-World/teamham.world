# Local testing environment

This guide covers the full development environment used for authenticated member
pages and asset uploads. It combines the local Next.js process with the disposable
Postgres database on `dockhand.cyr1en.dev` and a local, S3-compatible MinIO bucket.

Nothing in this environment uses the production Neon database or production object
storage.

## Architecture

| Component | Location | Local endpoint | Persistence |
| --- | --- | --- | --- |
| Next.js | Local process | `https://localhost:3000` | None |
| Postgres | VPS container through an SSH tunnel | `127.0.0.1:55432` | VPS Docker volume |
| S3-compatible storage | Local MinIO container | `https://localhost:9000` | `infra/local-s3/data/` |
| MinIO console | Local MinIO container | `https://localhost:9001` | Same MinIO data directory |

The Postgres and MinIO states are independent. A truly clean environment requires
resetting both.

## Prerequisites

- Node.js `>=24 <25` and npm
- Docker with the Compose plugin
- SSH access to `root@dockhand.cyr1en.dev`
- The VPS host key already trusted locally; the scripts use strict host-key checking
- A populated, ignored `.env.local` for Discord development authentication

Install dependencies before the first run:

```bash
npm install
```

The required `.env.local` variable names are:

```text
AUTH_MODE
APP_BASE_URL
OAUTH_STATE_HMAC_SECRET
GAME_AUTH_REQUEST_HMAC_SECRET
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_GUILD_ID
DISCORD_REQUIRED_ROLE_ID
DATABASE_URL
```

For this stack, `AUTH_MODE` should be `development` and `APP_BASE_URL` should be
exactly `https://localhost:3000`. Do not commit the env file. `npm run dev:vps`
overrides `DATABASE_URL` and the member-page asset variables for the disposable
services, so the database value in `.env.local` is not used by that command.

## Start the complete environment

The disposable database must already have the current schema. If it does not, run
the destructive integration suite once as described in [Schema refresh](#schema-refresh).

Start the application from the repository root:

```bash
npm run dev:vps
```

This command:

1. generates or reuses the local HTTPS certificate;
2. starts MinIO and creates the private local bucket if needed;
3. opens a loopback-only SSH tunnel to the VPS database;
4. supplies the restricted `app_runtime_role` database connection;
5. enables the member-page V2 editor and local asset adapter; and
6. starts Next.js at `https://localhost:3000`.

Useful routes are:

- application: `https://localhost:3000`
- member administration: `https://localhost:3000/admin/members`
- member editor: `https://localhost:3000/m/<member>?edit=1#edit-page`
- MinIO console: `https://localhost:9001`

The development-only MinIO console credentials are the values committed in
`infra/local-s3/compose.yaml`. They must never be reused outside this local stack.

Stop Next and the SSH tunnel with `Ctrl-C` in the terminal running `dev:vps`.
MinIO intentionally remains available and preserves its files. Stop it separately:

```bash
npm run storage:local:stop
```

Do not run `npm run test:integration:vps` while `dev:vps` is running. The integration
suite drops and recreates the application's tables.

## Authentication and administrator access

Sign in through Discord once to create the local account row. The Discord account
must satisfy the guild and required-role settings in `.env.local`.

The application runtime role cannot grant administrator access. Use the database
owner on the disposable VPS database:

```bash
ssh root@dockhand.cyr1en.dev
docker exec -it teamham-test-postgres psql -U postgres -d teamham_test
```

Find the account first. Usernames are display data and are not the durable identity:

```sql
SELECT id, discord_user_id, discord_username, site_role
FROM public.accounts
WHERE LOWER(discord_username) = LOWER('cyr1en');
```

Confirm the Discord user ID, then promote the exact account ID returned above:

```sql
UPDATE public.accounts
SET site_role = 'admin', updated_at = NOW()
WHERE id = '<confirmed-account-uuid>'
RETURNING id, discord_user_id, discord_username, site_role;
```

Use `\q` to leave `psql`, then `exit` to leave the VPS. Authorization reads the
current database role on each verified request, so a new login should not normally
be necessary; refresh the application after the update.

## Database lifecycle

### Schema refresh

Run the real-Postgres suite to drop the known application tables, apply migrations
`0001` through `0008`, recreate the restricted runtime role, and validate the schema
and privileges:

```bash
npm run test:integration:vps
```

This suite is destructive and must have exclusive use of the disposable database.
It is deliberately guarded so it can connect only through loopback to an allowed
test database name.

Important: this command refreshes the schema, but it does **not** guarantee an empty
database when it finishes. Each test clears earlier fixtures before it runs, while
the final test may leave its own rows behind. Use the clean-slate procedure below
before interactive testing when existing accounts or assigned pages would matter.

### Clean database data without rebuilding the schema

Stop `dev:vps` first. Connect to the VPS owner shell and inspect the target before
changing it:

```bash
ssh root@dockhand.cyr1en.dev
docker exec -it teamham-test-postgres psql -U postgres -d teamham_test
```

Inside `psql`, confirm the database and then clear every application's table in one
transaction:

```sql
SELECT current_database(), current_user;

BEGIN;
TRUNCATE TABLE
    public.member_page_mutation_rate_limits,
    public.member_page_assets,
    public.member_pages,
    public.puff_flappy_scores,
    public.game_access_tokens,
    public.game_authorization_codes,
    public.game_oauth_subjects,
    public.game_oauth_clients,
    public.sessions,
    public.accounts;
COMMIT;
```

This keeps the schema, constraints, indexes, and runtime grants intact. It removes
all accounts and sessions, so sign in again before assigning an administrator.
It does not remove objects stored by MinIO.

## Local S3-compatible storage

Start or re-bootstrap MinIO independently:

```bash
npm run storage:local
```

Verify the operations used by the application:

```bash
npm run storage:local:verify
```

The verifier exercises a presigned PUT, HEAD, ranged GET, full GET, browser CORS
preflight, and DELETE. It deletes its temporary object on success or failure.

The local bucket is private and bound only to loopback. It implements the S3 API
shape used by the R2 adapter, but it is not a complete emulator of Cloudflare R2 or
its production delivery path.

### Clean all local object data

Stop MinIO before moving its data directory:

```bash
npm run storage:local:stop
mv infra/local-s3/data /tmp/teamham-local-s3-data-backup
npm run storage:local
npm run storage:local:verify
```

The move is intentionally recoverable. Choose a different explicit backup path if
that path already exists. After the new store is verified and the old objects are no
longer needed, the backup can be removed manually.

To obtain a complete clean slate, perform both the database truncation and this
object-data reset. Clearing only one side can leave orphaned database metadata or
unreferenced object bytes.

## Validation commands

Use these during normal development:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

Without `TEST_DATABASE_URL`, the real-database portion of the ordinary integration
command skips safely. Use `npm run test:integration:vps` only when an exclusive,
destructive schema-and-privilege run is intended.

After starting `dev:vps`, a useful environment check is:

```bash
npm run storage:local:verify
```

Then verify sign-in, `/admin/members`, the target member editor, upload preparation,
asset placement, publication, and the signed-out public member page in a browser.

## Browser E2E suite (Playwright)

A small Playwright suite in `tests/e2e/` drives the real V2 member-page editor
in Chromium against the same local stack described above. It seeds a real
account, session, member page, and V2 draft into the disposable database and
sets the real `__Host-session` cookie. There is no authentication bypass, no
application-only test route, and no shared production credential. Tests skip
with a message naming the missing service; they never fake a pass.

`test:e2e:vps` probes the app origin before it touches anything else and
exits nonzero when nothing answers there, so a core app outage can never
produce a green, all-skipped run. Only local MinIO absence remains a skip,
and only for the asset-upload test.

Install dependencies and the browser binary separately (the suite never
downloads a browser on its own):

```bash
npm install
npm run test:e2e:browsers
```

Start the full stack in one terminal:

```bash
npm run dev:vps
```

Then run the suite in another terminal:

```bash
npm run test:e2e:vps
```

`test:e2e:vps` opens the guarded loopback SSH tunnel, exports the validated
disposable database URLs (`E2E_DATABASE_URL` for the runtime role, and
`E2E_DATABASE_OWNER_URL` used only to delete fixture rows deterministically),
and runs `playwright test`. `npm run test:e2e` runs Playwright directly for
any already-exported environment. The base URL defaults to
`https://localhost:3000` and can be overridden with `E2E_BASE_URL`; both the
base URL and both database URLs are refused unless they are loopback and, for
the database, a disposable database name with `ALLOW_LOCAL_DB_TESTS=1`.

Covered today:

1. Owner edit, autosave to Saved, Preview, Publish, signed-out public render.
2. Two-tab revision conflict: the losing tab keeps its local version, offers
   "Open latest draft in a new tab", keeps the destructive reload labeled,
   stops autosaving, and blocks publish.
3. Keyboard and pointer block reorder, and the sub-breakpoint editor
   requirement notice returning to the live editor after resizing.
4. Asset upload, finalize, select as portrait, publish, anonymous asset
   access, and unpublish revocation — only when local MinIO is answering
   (Docker required). Before the browser uploads image bytes, the suite
   checks the server-issued upload URL against the approved local storage
   origin (HTTPS loopback only) so bytes are never sent anywhere else.

The fixture cleans up after itself whether a test passes or fails: it deletes
the rows it seeded through its own account identity (never through the page
slug alone), and it deletes the uploaded object bytes for the storage objects
it owns from the local MinIO bucket. If those bytes cannot be removed, the
run fails with a cleanup error naming the unremoved object keys instead of
silently orphaning them.

Unpublish is exercised from the same tab that published. The suite requires
the editor to report success and then requires a fresh anonymous page request
and asset request to return 404; a publication-generation conflict is a test
failure, not an accepted outcome.

Failed runs keep traces and screenshots under
`$(os temp dir)/teamham-e2e-artifacts/` so the repository stays clean.

CI runs this suite in the `validate` job of `.github/workflows/ci.yml`. That
job already provides the disposable `neondb` Postgres service and applies the
migrations through the PostgreSQL integration step; the browser steps then
reuse the same local stack documented above: MinIO through `npm run
storage:local` (which also generates the HTTPS localhost certificate) and
Next.js development HTTPS with synthetic development-mode configuration
(`AUTH_MODE=development`, synthetic Discord OAuth values, the V2 cohort
variables, and the local R2 adapter). Both services must answer before the
suite runs, and named-requirement skips are not permitted in CI: a run that
reports missing requirements or skipped tests fails. Failed runs upload the
`/tmp/teamham-e2e-artifacts` traces and screenshots, and cleanup of the dev
server and MinIO always runs. The local VPS workflow documented above remains
the way to run the suite during development; the manual checklist in the
member-page editor troubleshooting runbook is a diagnostic fallback, not the
only CI-adjacent evidence.

## Ports and overrides

The defaults are:

- Next.js: `3000`
- local forwarded Postgres: `55432`
- MinIO S3 API: `9000`
- MinIO console: `9001`

If local port `55432` is occupied, override only the forwarded Postgres port:

```bash
TEAMHAM_TEST_DB_LOCAL_PORT=55433 npm run dev:vps
```

The same override is supported by `npm run test:integration:vps`. The SSH target can
be changed with `TEAMHAM_TEST_DB_SSH_HOST`, but only use an explicitly approved
disposable database host.

## Troubleshooting

### SSH tunnel fails immediately

The scripts use `BatchMode=yes`, `StrictHostKeyChecking=yes`, and
`ExitOnForwardFailure=yes`. Confirm that SSH authentication works without a prompt,
that the host key is already trusted, and that the requested local port is unused.

### HTTPS certificate is rejected or mismatched

Next and MinIO must use the same localhost certificate. `npm run storage:local`
generates or reuses the Next development certificate and copies its matching local
CA to `certificates/rootCA.pem`. The entire `certificates/` directory is ignored by
Git.

If the certificate files are stale, stop the services, move the localhost
certificate, key, and root CA out of `certificates/`, then run
`npm run storage:local` again. Do not fall back to plain HTTP: secure session cookies
and exact-origin logout checks are configured for `https://localhost:3000`.

Some automation browsers reject locally trusted development CAs even when the
regular system browser accepts them. That is a browser-runner limitation, not a
reason to change the application to HTTP.

### MinIO is healthy but uploads fail

Run `npm run storage:local:verify`. If verification succeeds, inspect the application
request and the corresponding row in `public.member_page_assets`. Asset metadata is
stored in Postgres while bytes are stored in MinIO, so failures can come from either
side.

### The UI says an account already owns a page

Inspect the database instead of relying only on the currently rendered list:

```sql
SELECT
    page.id,
    page.slug,
    page.is_published,
    page.moderation_hold,
    account.discord_user_id,
    account.discord_username
FROM public.member_pages AS page
JOIN public.accounts AS account ON account.id = page.owner_account_id
ORDER BY page.slug;
```

Each account can own only one member page. If stale fixtures are present after an
integration run, use the documented clean-database procedure rather than deleting a
single row and leaving related state behind.

## VPS service operations

The lower-level VPS container layout, health checks, logs, and persistent-volume
details are documented in [VPS_TEST_DATABASE.md](VPS_TEST_DATABASE.md).
