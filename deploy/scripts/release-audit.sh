#!/usr/bin/env bash

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" &&
  pwd
)"

REPO_ROOT="$(
  cd "$SCRIPT_DIR/../.." &&
  pwd
)"

FAILURES=0

pass() {
  echo "PASS: $*"
}

fail() {
  echo "FAIL: $*" >&2
  FAILURES=$((FAILURES + 1))
}

cd "$REPO_ROOT" || exit 1

echo "========================================"
echo " DC COMS COMMUNITY RELEASE AUDIT"
echo "========================================"

echo
echo "=== Local-only artifact check ==="

if [ -e deploy/install.env ]; then
  fail "deploy/install.env exists"
else
  pass "No local install.env"
fi

if [ -e deploy/generated ]; then
  fail "deploy/generated exists"
else
  pass "No generated secret/render tree"
fi

echo
echo "=== Historical/checkpoint baggage ==="

BAGGAGE="$(
  find . \
    -path './.git' -prune -o \
    \( \
      -name 'deployed-preview' -o \
      -name 'metadata' -o \
      -name '.community-*' -o \
      -name '*.before-*' -o \
      -name '*.backup-*' \
    \) \
    -print
)"

if [ -n "$BAGGAGE" ]; then
  echo "$BAGGAGE"
  fail "Historical/checkpoint baggage found"
else
  pass "No historical/checkpoint baggage"
fi

echo
echo "=== Sensitive file types ==="

SENSITIVE_FILES="$(
  find . \
    -path './.git' -prune -o \
    -type f \
    \( \
      -name '.env' -o \
      -name '*.key' -o \
      -name '*.pem' -o \
      -name '*.p12' -o \
      -name '*.pfx' -o \
      -name '*.csr' -o \
      -name '*.crt' -o \
      -name '*.sqlite' -o \
      -name '*.sqlite3' -o \
      -name '*.db' -o \
      -name '*.dump' \
    \) \
    -print
)"

if [ -n "$SENSITIVE_FILES" ]; then
  echo "$SENSITIVE_FILES"
  fail "Sensitive/runtime files found"
else
  pass "No sensitive/runtime files"
fi

echo
echo "=== Private production references ==="

PRIVATE_REFS="$(
  grep -RIlE \
    'dccoms\.rpsiaas\.rpscloud\.com|rpscloud|rpsiaas|Recovery Point|10\.101\.|emblack079' \
    . \
    --exclude-dir=.git \
    --exclude='release-audit.sh' \
    2>/dev/null \
    || true
)"

if [ -n "$PRIVATE_REFS" ]; then
  echo "$PRIVATE_REFS"
  fail "Private production references found"
else
  pass "No private production references"
fi

echo
echo "=== Embedded private-key material ==="

KEY_MATERIAL="$(
  grep -RIlE \
    'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' \
    . \
    --exclude-dir=.git \
    2>/dev/null \
    || true
)"

if [ -n "$KEY_MATERIAL" ]; then
  echo "$KEY_MATERIAL"
  fail "Embedded private-key material found"
else
  pass "No embedded private-key material"
fi

echo
echo "=== Unexpected Matrix access-token material ==="

ACCESS_TOKENS="$(
  grep -RIlE \
    'syt_[A-Za-z0-9._=-]{20,}' \
    . \
    --exclude-dir=.git \
    2>/dev/null \
    || true
)"

if [ -n "$ACCESS_TOKENS" ]; then
  echo "$ACCESS_TOKENS"
  fail "Possible Matrix access token found"
else
  pass "No Matrix access-token material detected"
fi

echo
echo "=== Placeholder contract ==="

PLACEHOLDERS="$(
  grep -RhoE \
    '__[A-Z0-9_]+__' \
    deploy/synapse \
    deploy/nginx \
    deploy/quadlet \
    2>/dev/null \
    | sort -u
)"

EXPECTED="$(
  cat <<'EXPECTED'
__DC_COMS_FQDN__
__DC_COMS_WEB_ROOT__
__POSTGRES_DB__
__POSTGRES_IMAGE__
__POSTGRES_PASSWORD__
__POSTGRES_USER__
__SYNAPSE_IMAGE__
__SYNAPSE_REGISTRATION_SECRET__
__TIMEZONE__
__TLS_CERT_PATH__
__TLS_KEY_PATH__
EXPECTED
)"

if [ "$PLACEHOLDERS" = "$EXPECTED" ]; then
  pass "Template placeholder inventory matches contract"
else
  echo "--- Expected ---"
  echo "$EXPECTED"
  echo "--- Found ---"
  echo "$PLACEHOLDERS"
  fail "Template placeholder inventory mismatch"
fi

echo
echo "=== Required package files ==="

REQUIRED_FILES="
VERSION
README.md
INSTALL.md
ADMIN-GUIDE.md
USER-GUIDE.md
BACKUP-RESTORE.md
TROUBLESHOOTING.md
SECURITY.md
CLEAN-INSTALL-TEST.md
GITHUB-RELEASE.md
CHANGELOG.md
LICENSE
frontend-src/package.json
frontend-src/public/config.js
deploy/install.env.example
deploy/nginx/dccoms.conf.template
deploy/quadlet/dccoms.network
deploy/quadlet/dccoms-postgres.container.template
deploy/quadlet/dccoms-synapse.container.template
deploy/synapse/homeserver.yaml.template
deploy/scripts/install.sh
deploy/scripts/render-install.sh
deploy/scripts/generate-secrets.sh
deploy/scripts/bootstrap-accounts.sh
deploy/scripts/dccoms-admin-api.py
deploy/scripts/dccoms-reset-api.py
deploy/scripts/dccoms-ops-collector.py
deploy/scripts/dccoms-db-backup.sh
deploy/scripts/dccoms-storage-check.sh
deploy/scripts/dccoms-storage-status
deploy/scripts/dccoms-build-deploy-frontend
bots/reminder-bot/Containerfile
bots/reminder-bot/bot.py
bots/ops-bot/Containerfile
bots/ops-bot/bot.py
"

MISSING=""

for file in $REQUIRED_FILES
do
  if [ ! -f "$file" ]; then
    MISSING="${MISSING}${file}
"
  fi
done

if [ -n "$MISSING" ]; then
  printf '%s' "$MISSING"
  fail "Required package files are missing"
else
  pass "Required package files exist"
fi

echo
echo "=== Shell syntax ==="

SHELL_FILES="
deploy/scripts/install.sh
deploy/scripts/render-install.sh
deploy/scripts/generate-secrets.sh
deploy/scripts/bootstrap-accounts.sh
deploy/scripts/dccoms-db-backup.sh
deploy/scripts/dccoms-storage-check.sh
deploy/scripts/dccoms-storage-status
deploy/scripts/dccoms-build-deploy-frontend
"

SHELL_BAD=""

for file in $SHELL_FILES
do
  if ! bash -n "$file"; then
    SHELL_BAD="${SHELL_BAD}${file}
"
  fi
done

if [ -n "$SHELL_BAD" ]; then
  printf '%s' "$SHELL_BAD"
  fail "Shell syntax failures found"
else
  pass "Shell syntax clean"
fi

echo
echo "=== Python syntax ==="

if python3 - <<'PY'
from pathlib import Path
import ast
import sys

bad = []

for path in sorted(Path(".").rglob("*.py")):
    if ".git" in path.parts:
        continue

    try:
        ast.parse(
            path.read_text(
                encoding="utf-8"
            ),
            filename=str(path),
        )
    except Exception as exc:
        bad.append(
            f"{path}: {exc}"
        )

if bad:
    print(
        "\n".join(bad)
    )
    sys.exit(1)
PY
then
  pass "Python syntax clean"
else
  fail "Python syntax failures found"
fi

echo
echo "=== Git ignore safety contract ==="

IGNORE_BAD=0

for pattern in \
  '/deploy/install.env' \
  'deploy/generated/' \
  '*.key' \
  '*.pem' \
  '*.sqlite3' \
  'backups/'
do
  if ! grep -Fq "$pattern" .gitignore; then
    echo "Missing .gitignore protection: $pattern"
    IGNORE_BAD=1
  fi
done

if [ "$IGNORE_BAD" -eq 0 ]; then
  pass ".gitignore protects local/runtime material"
else
  fail ".gitignore safety contract incomplete"
fi

echo
echo "=== Destructive command review ==="

grep -RnE \
  'rm[[:space:]]+-rf|rm[[:space:]]+-f' \
  deploy/scripts \
  || true

echo
echo "=== Release audit result ==="

if [ "$FAILURES" -eq 0 ]; then
  echo "DC Coms Community release audit: PASS"
  exit 0
fi

echo "DC Coms Community release audit: FAIL ($FAILURES)"
exit 1
