#!/usr/bin/env bash

umask 077

SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" &&
  pwd
)"

REPO_ROOT="$(
  cd "$SCRIPT_DIR/../.." &&
  pwd
)"

CONFIG_FILE="$REPO_ROOT/deploy/install.env"
GENERATED="$REPO_ROOT/deploy/generated"
SECRETS="$GENERATED/secrets.env"
RENDERED="$GENERATED/rendered"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -f "$CONFIG_FILE" ] ||
  fail "Missing $CONFIG_FILE"

[ -f "$SECRETS" ] ||
  fail "Missing generated secrets. Run generate-secrets.sh first."

# shellcheck disable=SC1090
. "$CONFIG_FILE"

# shellcheck disable=SC1090
. "$SECRETS"

required="
DC_COMS_FQDN
DC_COMS_TIMEZONE
DC_COMS_ROOT
DC_COMS_WEB_ROOT
DC_COMS_CONFIG_ROOT
DC_COMS_TLS_CERT
DC_COMS_TLS_KEY
DC_COMS_POSTGRES_DB
DC_COMS_POSTGRES_USER
DC_COMS_ADMIN_LOCALPART
DC_COMS_ENABLE_REMINDER_BOT
DC_COMS_ENABLE_OPS_BOT
DC_COMS_SYNAPSE_IMAGE
DC_COMS_POSTGRES_IMAGE
DC_COMS_POSTGRES_PASSWORD
DC_COMS_REGISTRATION_SHARED_SECRET
DC_COMS_RESET_SERVICE_PASSWORD
DC_COMS_REMINDER_PASSWORD
DC_COMS_OPS_PASSWORD
DC_COMS_OPS_COLLECTOR_TOKEN
"

for name in $required
do
  eval "value=\${$name:-}"

  [ -n "$value" ] ||
    fail "Missing value: $name"
done

[ "$DC_COMS_ROOT" = "/data/dccoms" ] ||
  fail "Community V1 requires /data/dccoms"

[ "$DC_COMS_WEB_ROOT" = "/data/dccoms/preview" ] ||
  fail "Community V1 requires /data/dccoms/preview"

[ "$DC_COMS_CONFIG_ROOT" = "/etc/dccoms" ] ||
  fail "Community V1 requires /etc/dccoms"

rm -rf "$RENDERED"

mkdir -p \
  "$RENDERED/etc/dccoms" \
  "$RENDERED/etc/containers/systemd" \
  "$RENDERED/etc/nginx/conf.d" \
  "$RENDERED/data/dccoms/synapse" \
  "$RENDERED/data/dccoms/preview"

export \
  DC_COMS_FQDN \
  DC_COMS_TIMEZONE \
  DC_COMS_ROOT \
  DC_COMS_WEB_ROOT \
  DC_COMS_CONFIG_ROOT \
  DC_COMS_TLS_CERT \
  DC_COMS_TLS_KEY \
  DC_COMS_POSTGRES_DB \
  DC_COMS_POSTGRES_USER \
  DC_COMS_ADMIN_LOCALPART \
  DC_COMS_ENABLE_REMINDER_BOT \
  DC_COMS_ENABLE_OPS_BOT \
  DC_COMS_SYNAPSE_IMAGE \
  DC_COMS_POSTGRES_IMAGE \
  DC_COMS_POSTGRES_PASSWORD \
  DC_COMS_REGISTRATION_SHARED_SECRET \
  DC_COMS_RESET_SERVICE_PASSWORD \
  DC_COMS_REMINDER_PASSWORD \
  DC_COMS_OPS_PASSWORD \
  DC_COMS_OPS_COLLECTOR_TOKEN \
  REPO_ROOT \
  RENDERED

python3 - <<'PY'
from pathlib import Path
import os

repo = Path(os.environ["REPO_ROOT"])
out = Path(os.environ["RENDERED"])

fqdn = os.environ["DC_COMS_FQDN"]

values = {
    "__DC_COMS_FQDN__":
        fqdn,
    "__POSTGRES_PASSWORD__":
        os.environ[
            "DC_COMS_POSTGRES_PASSWORD"
        ],
    "__POSTGRES_USER__":
        os.environ[
            "DC_COMS_POSTGRES_USER"
        ],
    "__POSTGRES_DB__":
        os.environ[
            "DC_COMS_POSTGRES_DB"
        ],
    "__TIMEZONE__":
        os.environ[
            "DC_COMS_TIMEZONE"
        ],
    "__SYNAPSE_IMAGE__":
        os.environ[
            "DC_COMS_SYNAPSE_IMAGE"
        ],
    "__POSTGRES_IMAGE__":
        os.environ[
            "DC_COMS_POSTGRES_IMAGE"
        ],
    "__TLS_CERT_PATH__":
        os.environ[
            "DC_COMS_TLS_CERT"
        ],
    "__TLS_KEY_PATH__":
        os.environ[
            "DC_COMS_TLS_KEY"
        ],
    "__DC_COMS_WEB_ROOT__":
        os.environ[
            "DC_COMS_WEB_ROOT"
        ],
}

def render(
    source: Path,
    target: Path,
):
    text = source.read_text()

    values[
        "__SYNAPSE_REGISTRATION_SECRET__"
    ] = os.environ[
        "DC_COMS_REGISTRATION_SHARED_SECRET"
    ]

    for old, new in values.items():
        text = text.replace(
            old,
            new,
        )

    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(text)

render(
    repo /
    "deploy/synapse/homeserver.yaml.template",
    out /
    "data/dccoms/synapse/homeserver.yaml",
)

render(
    repo /
    "deploy/quadlet/dccoms-postgres.container.template",
    out /
    "etc/containers/systemd/dccoms-postgres.container",
)

render(
    repo /
    "deploy/quadlet/dccoms-synapse.container.template",
    out /
    "etc/containers/systemd/dccoms-synapse.container",
)

render(
    repo /
    "deploy/nginx/dccoms.conf.template",
    out /
    "etc/nginx/conf.d/dccoms.conf",
)

network = (
    repo /
    "deploy/quadlet/dccoms.network"
).read_text()

(
    out /
    "etc/containers/systemd/dccoms.network"
).write_text(network)

# PostgreSQL
(
    out /
    "etc/dccoms/postgres.env"
).write_text(
    "POSTGRES_DB="
    + os.environ[
        "DC_COMS_POSTGRES_DB"
    ]
    + "\n"
    "POSTGRES_USER="
    + os.environ[
        "DC_COMS_POSTGRES_USER"
    ]
    + "\n"
    "POSTGRES_PASSWORD="
    + os.environ[
        "DC_COMS_POSTGRES_PASSWORD"
    ]
    + "\n"
    "POSTGRES_INITDB_ARGS="
    "--encoding=UTF8 --locale=C\n"
)

# Reset service
(
    out /
    "etc/dccoms/dccoms-reset.env"
).write_text(
    "DC_RESET_MATRIX_BASE="
    "http://127.0.0.1:8008\n"
    "DC_RESET_PORT=8011\n"
    f"DC_RESET_SERVER_NAME={fqdn}\n"
    f"DC_RESET_SERVICE_USER=@dcreset:{fqdn}\n"
    "DC_RESET_SERVICE_PASSWORD="
    + os.environ[
        "DC_COMS_RESET_SERVICE_PASSWORD"
    ]
    + "\n"
    "DC_RESET_STATE=/var/lib/dccoms-reset\n"
    "DC_RESET_TTL=900\n"
)

# Reminder Bot
(
    out /
    "etc/dccoms/dccoms-reminder.env"
).write_text(
    f"DCREMINDER_MATRIX_URL=https://{fqdn}\n"
    f"DCREMINDER_USER=@reminderbot:{fqdn}\n"
    "DCREMINDER_PASSWORD="
    + os.environ[
        "DC_COMS_REMINDER_PASSWORD"
    ]
    + "\n"
    "DCREMINDER_DATA=/data/dccoms/reminder-bot\n"
    "DCREMINDER_STORE=/data/dccoms/reminder-bot/store\n"
    "DCREMINDER_DB=/data/dccoms/reminder-bot/reminders.sqlite3\n"
    "DCREMINDER_TIMEZONE="
    + os.environ[
        "DC_COMS_TIMEZONE"
    ]
    + "\n"
)

# DC Ops
admin = (
    "@"
    + os.environ[
        "DC_COMS_ADMIN_LOCALPART"
    ]
    + ":"
    + fqdn
)

(
    out /
    "etc/dccoms/dccoms-ops.env"
).write_text(
    f"DCOPS_MATRIX_URL=https://{fqdn}\n"
    f"DCOPS_USER=@dcops:{fqdn}\n"
    "DCOPS_PASSWORD="
    + os.environ[
        "DC_COMS_OPS_PASSWORD"
    ]
    + "\n"
    f"DCOPS_ALLOWED_USERS={admin}\n"
    "DCOPS_COLLECTOR_URL=http://127.0.0.1:8012\n"
    "DCOPS_COLLECTOR_TOKEN="
    + os.environ[
        "DC_COMS_OPS_COLLECTOR_TOKEN"
    ]
    + "\n"
    "DCOPS_DATA=/data/dccoms/ops-bot\n"
    "DCOPS_STORE=/data/dccoms/ops-bot/store\n"
    "DCOPS_POLL_SECONDS=60\n"
)

(
    out /
    "etc/dccoms/dccoms-ops-collector.env"
).write_text(
    "DCOPS_COLLECTOR_TOKEN="
    + os.environ[
        "DC_COMS_OPS_COLLECTOR_TOKEN"
    ]
    + "\n"
)

# Browser runtime config
(
    out /
    "data/dccoms/preview/config.js"
).write_text(
    "window.DC_COMS_CONFIG = {\n"
    f"  homeserverUrl: 'https://{fqdn}',\n"
    f"  serverName: '{fqdn}',\n"
    "  reminderBotLocalpart: 'reminderbot',\n"
    "  opsBotLocalpart: 'dcops',\n"
    "}\n"
)
PY

chmod 600 \
  "$RENDERED/etc/dccoms/"*.env \
  "$RENDERED/data/dccoms/synapse/homeserver.yaml"

chmod 644 \
  "$RENDERED/etc/containers/systemd/"* \
  "$RENDERED/etc/nginx/conf.d/dccoms.conf" \
  "$RENDERED/data/dccoms/preview/config.js"

UNRESOLVED="$(
  grep -RIl \
    -E '__[A-Z0-9_]+__' \
    "$RENDERED" \
    2>/dev/null \
    || true
)"

if [ -n "$UNRESOLVED" ]; then
  echo "ERROR: unresolved template placeholders remain:" >&2
  echo "$UNRESOLVED" >&2
  exit 1
fi

echo
echo "DC Coms configuration render: PASS"
echo
echo "Rendered tree:"
find "$RENDERED" \
  -type f \
  -print \
  | sort
echo
echo "Secret-bearing files were rendered but their contents were not printed."
