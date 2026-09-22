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
SECRET_FILE="$REPO_ROOT/deploy/generated/secrets.env"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] ||
  fail "Run account bootstrap as root."

[ -f "$CONFIG_FILE" ] ||
  fail "Missing installer configuration: $CONFIG_FILE"

[ -f "$SECRET_FILE" ] ||
  fail "Missing generated secrets: $SECRET_FILE"

# shellcheck disable=SC1090
. "$CONFIG_FILE"

# shellcheck disable=SC1090
. "$SECRET_FILE"

required="
DC_COMS_FQDN
DC_COMS_ADMIN_LOCALPART
DC_COMS_ENABLE_REMINDER_BOT
DC_COMS_ENABLE_OPS_BOT
DC_COMS_REGISTRATION_SHARED_SECRET
DC_COMS_ADMIN_PASSWORD
DC_COMS_RESET_SERVICE_PASSWORD
DC_COMS_REMINDER_PASSWORD
DC_COMS_OPS_PASSWORD
"

for name in $required
do
  eval "value=\${$name:-}"

  [ -n "$value" ] ||
    fail "Missing value: $name"
done

export \
  DC_COMS_FQDN \
  DC_COMS_ADMIN_LOCALPART \
  DC_COMS_ENABLE_REMINDER_BOT \
  DC_COMS_ENABLE_OPS_BOT \
  DC_COMS_REGISTRATION_SHARED_SECRET \
  DC_COMS_ADMIN_PASSWORD \
  DC_COMS_RESET_SERVICE_PASSWORD \
  DC_COMS_REMINDER_PASSWORD \
  DC_COMS_OPS_PASSWORD

python3 - <<'PY'
import hashlib
import hmac
import json
import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8008"

SERVER = os.environ[
    "DC_COMS_FQDN"
]

SECRET = os.environ[
    "DC_COMS_REGISTRATION_SHARED_SECRET"
]

ADMIN_LOCALPART = os.environ[
    "DC_COMS_ADMIN_LOCALPART"
]

ADMIN_PASSWORD = os.environ[
    "DC_COMS_ADMIN_PASSWORD"
]

RESET_PASSWORD = os.environ[
    "DC_COMS_RESET_SERVICE_PASSWORD"
]

REMINDER_PASSWORD = os.environ[
    "DC_COMS_REMINDER_PASSWORD"
]

OPS_PASSWORD = os.environ[
    "DC_COMS_OPS_PASSWORD"
]

ENABLE_REMINDER = (
    os.environ[
        "DC_COMS_ENABLE_REMINDER_BOT"
    ] == "true"
)

ENABLE_OPS = (
    os.environ[
        "DC_COMS_ENABLE_OPS_BOT"
    ] == "true"
)


def request_json(
    method,
    path,
    body=None,
):
    data = None

    if body is not None:
        data = json.dumps(
            body
        ).encode("utf-8")

    request = Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "Content-Type":
                "application/json",
        },
    )

    try:
        with urlopen(
            request,
            timeout=10,
        ) as response:
            payload = response.read()

            if not payload:
                return (
                    response.status,
                    {},
                )

            return (
                response.status,
                json.loads(
                    payload.decode(
                        "utf-8"
                    )
                ),
            )

    except HTTPError as exc:
        payload = exc.read()

        try:
            result = json.loads(
                payload.decode(
                    "utf-8"
                )
            )
        except Exception:
            result = {
                "error":
                    payload.decode(
                        "utf-8",
                        errors="replace",
                    )
            }

        return (
            exc.code,
            result,
        )


def wait_for_synapse():
    for _ in range(60):
        try:
            status, _ = request_json(
                "GET",
                "/_matrix/client/versions",
            )

            if status == 200:
                return

        except (
            URLError,
            ConnectionError,
            TimeoutError,
        ):
            pass

        time.sleep(1)

    raise RuntimeError(
        "Synapse did not become ready."
    )


def register(
    localpart,
    password,
    admin,
):
    status, nonce_reply = request_json(
        "GET",
        "/_synapse/admin/v1/register",
    )

    if status != 200:
        raise RuntimeError(
            "Unable to obtain Synapse "
            "registration nonce: "
            + str(
                nonce_reply.get(
                    "error",
                    status,
                )
            )
        )

    nonce = nonce_reply.get(
        "nonce"
    )

    if not nonce:
        raise RuntimeError(
            "Synapse registration nonce "
            "was missing."
        )

    message = "\x00".join(
        (
            nonce,
            localpart,
            password,
            (
                "admin"
                if admin
                else "notadmin"
            ),
        )
    ).encode("utf-8")

    mac = hmac.new(
        key=SECRET.encode(
            "utf-8"
        ),
        msg=message,
        digestmod=hashlib.sha1,
    ).hexdigest()

    status, result = request_json(
        "POST",
        "/_synapse/admin/v1/register",
        {
            "nonce":
                nonce,
            "username":
                localpart,
            "password":
                password,
            "admin":
                admin,
            "mac":
                mac,
        },
    )

    if status != 200:
        raise RuntimeError(
            "Unable to create @"
            + localpart
            + ":"
            + SERVER
            + ": "
            + str(
                result.get(
                    "error",
                    status,
                )
            )
        )

    print(
        "Created "
        + "@"
        + localpart
        + ":"
        + SERVER
        + (
            " [admin]"
            if admin
            else ""
        )
    )


wait_for_synapse()

register(
    ADMIN_LOCALPART,
    ADMIN_PASSWORD,
    True,
)

register(
    "dcreset",
    RESET_PASSWORD,
    True,
)

if ENABLE_REMINDER:
    register(
        "reminderbot",
        REMINDER_PASSWORD,
        False,
    )

if ENABLE_OPS:
    register(
        "dcops",
        OPS_PASSWORD,
        False,
    )

print()
print(
    "Matrix account bootstrap: PASS"
)
PY

echo
echo "Passwords were not printed."
echo
echo "Initial administrator:"
echo "  @$DC_COMS_ADMIN_LOCALPART:$DC_COMS_FQDN"
echo
echo "Its generated initial password remains in:"
echo "  $SECRET_FILE"
