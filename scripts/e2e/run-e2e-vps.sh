#!/usr/bin/env bash

# Guarded runner for the browser E2E suite against the disposable VPS test
# database, mirroring scripts/test-integration-vps.sh.
#
# It exports the two validated loopback database URLs the suite requires:
#   E2E_DATABASE_URL        runtime-role connection (what the app itself uses)
#   E2E_DATABASE_OWNER_URL  owner-role connection, used only for deterministic
#                           fixture cleanup (INSERT/DELETE of fixture rows and
#                           deletion of fixture-owned storage objects)
# and then runs Playwright.
#
# The app under test is NOT started here. Run `npm run dev:vps` in another
# terminal first (it also starts local MinIO for the asset upload test).
#
# App preflight: the suite exists to exercise the real application, so when
# nothing answers at the configured app origin this runner refuses to start
# Playwright and exits nonzero. A core app outage must never produce a green,
# all-skipped run. MinIO absence stays a named skip for the single
# asset-upload test only.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ssh_host="${TEAMHAM_TEST_DB_SSH_HOST:-root@dockhand.cyr1en.dev}"
local_port="${TEAMHAM_TEST_DB_LOCAL_PORT:-55432}"
remote_port="55432"
control_dir="$(mktemp -d /tmp/teamham-e2e-db.XXXXXX)"
control_socket="${control_dir}/ssh"
tunnel_started=0

cleanup() {
  if [[ "${tunnel_started}" == "1" ]]; then
    ssh -S "${control_socket}" -O exit "${ssh_host}" >/dev/null 2>&1 || true
  fi
  rmdir "${control_dir}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if [[ ! "${local_port}" =~ ^[0-9]+$ ]] || (( local_port < 1024 || local_port > 65535 )); then
  echo "TEAMHAM_TEST_DB_LOCAL_PORT must be an unprivileged TCP port (1024-65535)." >&2
  exit 2
fi

# App preflight runs before any infrastructure is touched: if the app under
# test is not up, there is nothing honest to run and the run must fail here.
base_url="${E2E_BASE_URL:-https://localhost:3000}"
if [[ ! "${base_url}" =~ ^https://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/.*)?$ ]]; then
  echo "E2E_BASE_URL refused: it must be the local HTTPS development origin (https://localhost:<port>), not the configured value." >&2
  exit 2
fi
if ! curl -sk -o /dev/null -m 5 "${base_url}"; then
  echo "FAIL: nothing is answering at ${base_url}. The browser E2E suite requires the app under test." >&2
  echo "Start it with: npm run dev:vps" >&2
  exit 3
fi

ssh \
  -M \
  -S "${control_socket}" \
  -fNT \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "127.0.0.1:${local_port}:127.0.0.1:${remote_port}" \
  "${ssh_host}"
tunnel_started=1

db_password="$(
  ssh -S "${control_socket}" "${ssh_host}" \
    "test \"\$(stat -c %a /root/.config/teamham/test-postgres.env)\" = 600 && sed -n 's/^POSTGRES_PASSWORD=//p' /root/.config/teamham/test-postgres.env"
)"

if [[ ! "${db_password}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "The VPS test-database credential is missing or malformed." >&2
  exit 1
fi

export ALLOW_LOCAL_DB_TESTS=1
export E2E_DATABASE_URL="postgresql://app_runtime_role:test_only_runtime_secret_password_12345@127.0.0.1:${local_port}/teamham_test?sslmode=disable"
export E2E_DATABASE_OWNER_URL="postgresql://postgres:${db_password}@127.0.0.1:${local_port}/teamham_test"
unset db_password

if [[ -s "${repo_root}/certificates/rootCA.pem" ]]; then
  export NODE_EXTRA_CA_CERTS="${repo_root}/certificates/rootCA.pem"
fi

if ! npx playwright test "$@"; then
  echo "Playwright reported failures. Failure traces and screenshots are under" >&2
  echo "\$(os temp dir)/teamham-e2e-artifacts/ for inspection." >&2
  exit 1
fi
