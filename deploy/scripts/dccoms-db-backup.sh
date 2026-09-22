#!/usr/bin/env bash
set -euo pipefail
umask 077

DEST="/data/dccoms/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DEST"

podman exec dccoms-postgres \
  pg_dump \
  -U synapse \
  -d synapse \
  -Fc \
  > "$DEST/synapse-$STAMP.dump"

find "$DEST" \
  -type f \
  -name 'synapse-*.dump' \
  -mtime +7 \
  -delete
