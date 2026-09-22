#!/usr/bin/env bash

ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." &&
  pwd
)"

VERSION="$(
  tr -d '[:space:]' < "$ROOT/VERSION"
)"

[ -n "$VERSION" ] || {
  echo "ERROR: VERSION is empty." >&2
  exit 1
}

OUT="/data/dccoms-release"
NAME="dc-coms-community-v${VERSION}"
ARCHIVE="$OUT/${NAME}.tar.gz"
CHECKSUM="$ARCHIVE.sha256"
MANIFEST="$OUT/${NAME}.manifest.txt"

mkdir -p "$OUT"

cd "$ROOT" || exit 1

./deploy/scripts/release-audit.sh || exit 1

rm -f \
  "$ARCHIVE" \
  "$CHECKSUM" \
  "$MANIFEST"

find . \
  -type f \
  ! -path './deploy/generated/*' \
  ! -path './deploy/install.env' \
  ! -path './.git/*' \
  -printf '%P\n' \
  | sort \
  > "$MANIFEST"

tar \
  --exclude='./deploy/generated' \
  --exclude='./deploy/install.env' \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='*/node_modules' \
  --transform="s|^\./|${NAME}/|" \
  -czf "$ARCHIVE" \
  .

sha256sum "$ARCHIVE" \
  > "$CHECKSUM"

chmod 0644 \
  "$ARCHIVE" \
  "$CHECKSUM" \
  "$MANIFEST"

echo
echo "Release package built:"
echo "  $ARCHIVE"
echo "  $CHECKSUM"
echo "  $MANIFEST"
