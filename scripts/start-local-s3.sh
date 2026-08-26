#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repo_root}/infra/local-s3/compose.yaml"
certificate="${repo_root}/certificates/localhost.pem"
certificate_key="${repo_root}/certificates/localhost-key.pem"
root_ca="${repo_root}/certificates/rootCA.pem"

node "${repo_root}/scripts/prepare-local-certificate.mjs"

if [[ ! -s "${certificate}" || ! -s "${certificate_key}" || ! -s "${root_ca}" ]]; then
  echo "Missing the localhost HTTPS certificate used by Next and MinIO." >&2
  exit 1
fi

mkdir -p "${repo_root}/infra/local-s3/data"

docker compose -f "${compose_file}" up -d --wait minio
docker compose -f "${compose_file}" --profile bootstrap run --rm bootstrap

echo "Local S3 API:     https://localhost:9000"
echo "MinIO console:    https://localhost:9001"
echo "Persistent files: ${repo_root}/infra/local-s3/data"
