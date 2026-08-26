# VPS test database

The real-Postgres integration suite uses a disposable database on
`dockhand.cyr1en.dev`. It is separate from Neon and contains no production data.

For the complete local application, authentication, MinIO, reset, and troubleshooting
workflow, see [LOCAL_TESTING.md](LOCAL_TESTING.md). This document covers the VPS
database specifically.

## Run the suite

```bash
npm run test:integration:vps
```

The command uses the saved root SSH credential, opens a loopback-only tunnel,
reads the database password into the test process, and closes the tunnel when
Vitest exits. It does not save a database URL or password locally.

Optional overrides:

```bash
TEAMHAM_TEST_DB_SSH_HOST=root@dockhand.cyr1en.dev \
TEAMHAM_TEST_DB_LOCAL_PORT=55432 \
npm run test:integration:vps
```

Only one destructive database test run should use this instance at a time.

## Run the development app against the VPS database

Initialize or refresh the disposable schema when needed, then start the app:

```bash
npm run test:integration:vps
npm run dev:vps
```

The integration command is destructive and may leave the final test's fixture rows
behind. It is a schema refresh, not a clean-slate command. Follow the database reset
procedure in [LOCAL_TESTING.md](LOCAL_TESTING.md#clean-database-data-without-rebuilding-the-schema)
before interactive testing when the data must be empty.

`dev:vps` opens the same loopback-only SSH tunnel, connects as the restricted
`app_runtime_role`, enables the member-page V2 editor, starts the local
S3-compatible store described below, and runs Next at
`https://localhost:3000`. The tunnel closes when the development server exits.
The database persists on the VPS, so do not run the destructive integration
suite while the development server is using it.

## Local S3-compatible asset storage

The development stack runs a private MinIO bucket with the same S3 operations
used by the R2 adapter. Its API and console bind only to loopback:

- S3 API: `https://localhost:9000`
- Console: `https://localhost:9001`
- Bucket: `teamham-member-assets-local`
- Local files: `infra/local-s3/data/` (ignored by Git)

Start or re-bootstrap it independently with `npm run storage:local`. Stop the
service with `npm run storage:local:stop`; stopping it preserves its files. Run
`npm run storage:local:verify` to exercise signed S3 operations and CORS. The
bucket is private, and the single-purpose server's CORS allowlist permits only
the local HTTPS development origins. Next and MinIO share
`certificates/localhost*.pem`; the storage bootstrap uses Next's certificate
helper to generate or reuse those ignored files and copy the matching local CA.

## VPS layout

- Compose file: `/opt/teamham-test-postgres/compose.yaml`
- Container: `teamham-test-postgres`
- Database: `teamham_test`
- Persistent volume: `teamham-test-postgres-data`
- Secret file: `/root/.config/teamham/test-postgres.env` (`0600`)
- Listener: VPS `127.0.0.1:55432` only

The container is resource-capped and uses an image digest, SCRAM host
authentication, data checksums, a health check, bounded logs, and an
`unless-stopped` restart policy.

## Operations

Run these from the VPS as root:

```bash
cd /opt/teamham-test-postgres
docker compose ps
docker compose logs --tail=100 postgres
docker compose up -d
```

The integration suite intentionally drops and recreates its tables. Do not put
durable or production data in this database. Removing the named volume destroys
the database and is not part of routine cleanup.
