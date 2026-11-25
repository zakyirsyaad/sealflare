#!/usr/bin/env bash
# Daily Postgres dump for Sealflare, run from the deploy user's crontab on the VPS.
# Keeps the last 7 dumps in ~/sealflare/backups. Copying them off the VPS is still to be decided
# (docs/service-accounts.md); until then this only protects against a bad migration, not a lost VPS.
set -euo pipefail

DIR="${HOME}/sealflare"
OUT="${DIR}/backups"
KEEP=7

mkdir -p "${OUT}"
chmod 700 "${OUT}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="${OUT}/sealflare-${stamp}.sql.gz"

docker compose --project-directory "${DIR}" exec -T postgres \
  pg_dump --no-owner -U sealflare -d sealflare | gzip -9 > "${file}.partial"
mv "${file}.partial" "${file}"
chmod 600 "${file}"

ls -1t "${OUT}"/sealflare-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "$(date -u +%FT%TZ) wrote ${file}"
