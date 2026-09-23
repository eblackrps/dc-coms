#!/usr/bin/env bash
set -euo pipefail
umask 077

DEST="/data/dccoms/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST"

podman exec dccoms-postgres \
  sh -lc \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --exclude-table-data=e2e_one_time_keys_json' \
  > "$DEST/synapse-$STAMP.dump"

find "$DEST" \
  -type f \
  -name 'synapse-*.dump' \
  -mtime +7 \
  -delete
