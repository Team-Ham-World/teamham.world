#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ssh_host="${TEAMHAM_TEST_DB_SSH_HOST:-root@dockhand.cyr1en.dev}"
local_port="${TEAMHAM_TEST_DB_LOCAL_PORT:-55432}"
remote_port="55432"
control_dir="$(mktemp -d /tmp/teamham-dev-db.XXXXXX)"
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

"${repo_root}/scripts/start-local-s3.sh"

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

export DATABASE_URL="postgresql://app_runtime_role:test_only_runtime_secret_password_12345@127.0.0.1:${local_port}/teamham_test?sslmode=disable"
export MEMBER_PAGE_V2_ALLOWLIST="all"
export MEMBER_PAGE_V2_EDITOR_DISABLED="false"
export MEMBER_PAGE_R2_ENVIRONMENT="nonproduction"
export MEMBER_PAGE_R2_ACCOUNT_ID="00000000000000000000000000000000"
export MEMBER_PAGE_R2_ACCESS_KEY_ID="teamhamlocalaccess"
export MEMBER_PAGE_R2_SECRET_ACCESS_KEY="teamham-local-secret-key-12345678901234567890"
export MEMBER_PAGE_R2_BUCKET="teamham-member-assets-local"
export MEMBER_PAGE_R2_ENDPOINT="https://localhost:9000"

cd "${repo_root}"
./node_modules/.bin/next dev \
  --experimental-https \
  --experimental-https-key ./certificates/localhost-key.pem \
  --experimental-https-cert ./certificates/localhost.pem \
  --experimental-https-ca ./certificates/rootCA.pem
