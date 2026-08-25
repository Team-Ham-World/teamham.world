#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ssh_host="${TEAMHAM_TEST_DB_SSH_HOST:-root@dockhand.cyr1en.dev}"
local_port="${TEAMHAM_TEST_DB_LOCAL_PORT:-55432}"
remote_port="55432"
control_dir="$(mktemp -d /tmp/teamham-test-db.XXXXXX)"
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
export TEST_DATABASE_URL="postgresql://postgres:${db_password}@127.0.0.1:${local_port}/teamham_test"
unset db_password

cd "${repo_root}"
npm run test:integration
