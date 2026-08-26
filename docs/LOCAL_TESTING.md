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
