#!/usr/bin/env python3

import hashlib
import hmac
import json
import os
import secrets
import threading
import time

from http.server import (
    BaseHTTPRequestHandler,
    ThreadingHTTPServer,
)

from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


MATRIX_BASE = os.environ[
    "DC_RESET_MATRIX_BASE"
].rstrip("/")

SERVER_NAME = os.environ[
    "DC_RESET_SERVER_NAME"
]

SERVICE_USER = os.environ[
    "DC_RESET_SERVICE_USER"
]

SERVICE_PASSWORD = os.environ[
    "DC_RESET_SERVICE_PASSWORD"
]

STATE_PATH = os.environ.get(
    "DC_RESET_STATE",
    "/var/lib/dccoms-reset/tokens.json",
)

TOKEN_TTL = int(
    os.environ.get(
        "DC_RESET_TTL",
        "900",
    )
)

PORT = int(
    os.environ.get(
        "DC_RESET_PORT",
        "8011",
    )
)

MAX_BODY = 16384

CODE_ALPHABET = (
    "ABCDEFGHJKLMNPQRSTUVWXYZ"
    "23456789"
)

STATE_LOCK = threading.Lock()
FAIL_LOCK = threading.Lock()

FAILED_ATTEMPTS = {}


def matrix_request(
    method,
    path,
    token=None,
    body=None,
):
    headers = {
        "Accept":
            "application/json",
    }

    data = None

    if body is not None:
        headers[
            "Content-Type"
        ] = "application/json"

        data = json.dumps(
            body,
        ).encode("utf-8")

    if token:
        headers[
            "Authorization"
        ] = f"Bearer {token}"

    request = Request(
        MATRIX_BASE + path,
        data=data,
        headers=headers,
        method=method,
    )

    try:
        with urlopen(
            request,
            timeout=15,
        ) as response:
            raw = response.read()

            payload = {}

            if raw:
                try:
                    payload = json.loads(
                        raw.decode(
                            "utf-8"
                        )
                    )
                except Exception:
                    payload = {}

            return (
                response.status,
                payload,
            )

    except HTTPError as exc:
        raw = exc.read()

        payload = {}

        if raw:
            try:
                payload = json.loads(
                    raw.decode(
                        "utf-8"
                    )
                )
            except Exception:
                payload = {}

        return (
            exc.code,
            payload,
        )

    except Exception:
        return (
            599,
            {
                "error":
                    "Homeserver request failed."
            },
        )


def canonical_user(
    value,
):
    value = str(
        value or ""
    ).strip()

    if not value:
        raise ValueError(
            "Username is required."
        )

    if not value.startswith("@"):
        value = (
            f"@{value}:"
            f"{SERVER_NAME}"
        )

    if ":" not in value:
        value = (
            f"{value}:"
            f"{SERVER_NAME}"
        )

    localpart, server = (
        value[1:].split(
            ":",
            1,
        )
    )

    if not localpart:
        raise ValueError(
            "Invalid username."
        )

    if server.lower() != (
        SERVER_NAME.lower()
    ):
        raise ValueError(
            "That account is not on this DC Coms server."
        )

    return (
        f"@{localpart}:"
        f"{SERVER_NAME}"
    )


def normalize_code(
    value,
):
    return "".join(
        char
        for char in
        str(value or "").upper()
        if char.isalnum()
    )


def code_hash(
    code,
):
    normalized = normalize_code(
        code
    )

    return hashlib.sha256(
        normalized.encode(
            "utf-8"
        )
    ).hexdigest()


def make_code():
    raw = "".join(
        secrets.choice(
            CODE_ALPHABET
        )
        for _ in range(20)
    )

    return "-".join(
        raw[index:index + 4]
        for index
        in range(
            0,
            len(raw),
            4,
        )
    )


def empty_state():
    return {
        "tokens": [],
    }


def load_state():
    try:
        with open(
            STATE_PATH,
            "r",
            encoding="utf-8",
        ) as handle:
            state = json.load(
                handle
            )

        if not isinstance(
            state.get("tokens"),
            list,
        ):
            return empty_state()

        return state

    except FileNotFoundError:
        return empty_state()

    except Exception:
        return empty_state()


def save_state(
    state,
):
    temp = (
        STATE_PATH +
        ".tmp"
    )

    with open(
        temp,
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(
            state,
            handle,
            separators=(
                ",",
                ":",
            ),
        )

    os.chmod(
        temp,
        0o600,
    )

    os.replace(
        temp,
        STATE_PATH,
    )


def prune_state(
    state,
):
    now = time.time()

    state["tokens"] = [
        record
        for record
        in state["tokens"]
        if (
            float(
                record.get(
                    "expires",
                    0,
                )
            ) > now
        )
    ]


def issue_token(
    user,
    logout_devices,
):
    code = make_code()

    record = {
        "hash":
            code_hash(code),

        "user":
            user,

        "expires":
            time.time() +
            TOKEN_TTL,

        "logout_devices":
            bool(
                logout_devices
            ),

        "claimed":
            False,
    }

    with STATE_LOCK:
        state = load_state()
        prune_state(state)

        state["tokens"] = [
            existing
            for existing
            in state["tokens"]
            if (
                existing.get(
                    "user"
                ) != user
            )
        ]

        state[
            "tokens"
        ].append(
            record
        )

        save_state(state)

    return code


def cancel_token(
    user,
):
    with STATE_LOCK:
        state = load_state()
        prune_state(state)

        before = len(
            state["tokens"]
        )

        state["tokens"] = [
            record
            for record
            in state["tokens"]
            if (
                record.get(
                    "user"
                ) != user
            )
        ]

        save_state(state)

        return (
            before !=
            len(
                state["tokens"]
            )
        )


def claim_token(
    user,
    code,
):
    digest = code_hash(
        code
    )

    with STATE_LOCK:
        state = load_state()
        prune_state(state)

        for record in (
            state["tokens"]
        ):
            stored = str(
                record.get(
                    "hash",
                    "",
                )
            )

            if (
                record.get(
                    "user"
                ) == user
                and
                not record.get(
                    "claimed",
                    False,
                )
                and
                hmac.compare_digest(
                    stored,
                    digest,
                )
            ):
                record[
                    "claimed"
                ] = True

                save_state(state)

                return {
                    **record,
                }

        save_state(state)

    return None


def release_token(
    user,
    digest,
):
    with STATE_LOCK:
        state = load_state()
        prune_state(state)

        for record in (
            state["tokens"]
        ):
            if (
                record.get(
                    "user"
                ) == user
                and
                hmac.compare_digest(
                    str(
                        record.get(
                            "hash",
                            "",
                        )
                    ),
                    digest,
                )
            ):
                record[
                    "claimed"
                ] = False

        save_state(state)


def consume_token(
    user,
    digest,
):
    with STATE_LOCK:
        state = load_state()
        prune_state(state)

        state["tokens"] = [
            record
            for record
            in state["tokens"]
            if not (
                record.get(
                    "user"
                ) == user
                and
                hmac.compare_digest(
                    str(
                        record.get(
                            "hash",
                            "",
                        )
                    ),
                    digest,
                )
            )
        ]

        save_state(state)


def check_rate_limit(
    address,
):
    now = time.time()

    with FAIL_LOCK:
        attempts = [
            timestamp
            for timestamp
            in FAILED_ATTEMPTS.get(
                address,
                [],
            )
            if (
                now -
                timestamp
            ) < 600
        ]

        FAILED_ATTEMPTS[
            address
        ] = attempts

        return (
            len(attempts)
            < 8
        )


def record_failure(
    address,
):
    with FAIL_LOCK:
        FAILED_ATTEMPTS.setdefault(
            address,
            [],
        ).append(
            time.time()
        )


def clear_failures(
    address,
):
    with FAIL_LOCK:
        FAILED_ATTEMPTS.pop(
            address,
            None,
        )


def authenticate_admin(
    access_token,
):
    if not access_token:
        return (
            None,
            "Missing authentication.",
        )

    status, who = (
        matrix_request(
            "GET",
            "/_matrix/client/v3/account/whoami",
            token=access_token,
        )
    )

    if (
        status != 200
        or
        not who.get(
            "user_id"
        )
    ):
        return (
            None,
            "Invalid Matrix session.",
        )

    user_id = who[
        "user_id"
    ]

    encoded = quote(
        user_id,
        safe="",
    )

    status, admin = (
        matrix_request(
            "GET",
            (
                "/_synapse/admin/v1/users/"
                f"{encoded}/admin"
            ),
            token=access_token,
        )
    )

    if (
        status != 200
        or
        admin.get(
            "admin"
        ) is not True
    ):
        return (
            None,
            "Server administrator access required.",
        )

    return (
        user_id,
        None,
    )


def target_account(
    access_token,
    user_id,
):
    encoded = quote(
        user_id,
        safe="",
    )

    return matrix_request(
        "GET",
        (
            "/_synapse/admin/v2/users/"
            f"{encoded}"
        ),
        token=access_token,
    )


def service_admin_login():
    status, result = (
        matrix_request(
            "POST",
            "/_matrix/client/v3/login",
            body={
                "type":
                    "m.login.password",

                "identifier": {
                    "type":
                        "m.id.user",

                    "user":
                        SERVICE_USER,
                },

                "password":
                    SERVICE_PASSWORD,

                "initial_device_display_name":
                    "DC Coms Password Reset Service",
            },
        )
    )

    if (
        status != 200
        or
        not result.get(
            "access_token"
        )
    ):
        raise RuntimeError(
            "Password-reset service authentication failed."
        )

    return result[
        "access_token"
    ]


def logout_token(
    token,
):
    if not token:
        return

    matrix_request(
        "POST",
        "/_matrix/client/v3/logout",
        token=token,
        body={},
    )


def admin_reset_password(
    target,
    password,
    logout_devices,
):
    token = None

    try:
        token = (
            service_admin_login()
        )

        encoded = quote(
            target,
            safe="",
        )

        status, result = (
            matrix_request(
                "PUT",
                (
                    "/_synapse/admin/v2/users/"
                    f"{encoded}"
                ),
                token=token,
                body={
                    "password":
                        password,

                    "logout_devices":
                        bool(
                            logout_devices
                        ),
                },
            )
        )

        if status != 200:
            raise RuntimeError(
                result.get(
                    "error"
                )
                or
                (
                    "Synapse rejected "
                    "the password reset."
                )
            )

    finally:
        logout_token(
            token
        )


def verify_password(
    target,
    password,
):
    status, result = (
        matrix_request(
            "POST",
            "/_matrix/client/v3/login",
            body={
                "type":
                    "m.login.password",

                "identifier": {
                    "type":
                        "m.id.user",

                    "user":
                        target,
                },

                "password":
                    password,

                "initial_device_display_name":
                    "DC Coms Password Reset Verification",
            },
        )
    )

    if (
        status != 200
        or
        not result.get(
            "access_token"
        )
    ):
        return False

    logout_token(
        result[
            "access_token"
        ]
    )

    return True


class Handler(
    BaseHTTPRequestHandler
):

    server_version = (
        "DCComsReset/1.0"
    )

    def log_message(
        self,
        format,
        *args,
    ):
        return

    def client_ip(
        self,
    ):
        forwarded = (
            self.headers.get(
                "X-Real-IP"
            )
        )

        if forwarded:
            return forwarded.strip()

        return self.client_address[
            0
        ]

    def send_json(
        self,
        status,
        payload,
    ):
        raw = json.dumps(
            payload,
            separators=(
                ",",
                ":",
            ),
        ).encode("utf-8")

        self.send_response(
            status
        )

        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8",
        )

        self.send_header(
            "Content-Length",
            str(
                len(raw)
            ),
        )

        self.send_header(
            "Cache-Control",
            "no-store",
        )

        self.send_header(
            "X-Content-Type-Options",
            "nosniff",
        )

        self.end_headers()

        self.wfile.write(
            raw
        )

    def bearer_token(
        self,
    ):
        value = (
            self.headers.get(
                "Authorization",
                "",
            )
        )

        if not value.startswith(
            "Bearer "
        ):
            return None

        return value[
            len(
                "Bearer "
            ):
        ].strip()

    def read_json(
        self,
    ):
        try:
            length = int(
                self.headers.get(
                    "Content-Length",
                    "0",
                )
            )
        except ValueError:
            raise ValueError(
                "Invalid request."
            )

        if (
            length <= 0
            or
            length > MAX_BODY
        ):
            raise ValueError(
                "Invalid request size."
            )

        raw = self.rfile.read(
            length
        )

        try:
            value = json.loads(
                raw.decode(
                    "utf-8"
                )
            )
        except Exception:
            raise ValueError(
                "Invalid JSON request."
            )

        if not isinstance(
            value,
            dict,
        ):
            raise ValueError(
                "Invalid request."
            )

        return value

    def do_GET(
        self,
    ):
        if (
            self.path ==
            "/health"
        ):
            self.send_json(
                200,
                {
                    "ok": True,
                },
            )
            return

        if (
            self.path ==
            "/admin/users"
        ):
            access_token = (
                self.bearer_token()
            )

            admin_user, error = (
                authenticate_admin(
                    access_token
                )
            )

            if error:
                self.send_json(
                    403,
                    {
                        "error":
                            error,
                    },
                )
                return

            users = []
            next_token = None

            for _page in range(20):
                endpoint = (
                    "/_synapse/admin/v3/users"
                    "?limit=100"
                    "&guests=false"
                )

                if next_token is not None:
                    endpoint += (
                        "&from="
                        + quote(
                            str(next_token),
                            safe="",
                        )
                    )

                status, result = (
                    matrix_request(
                        "GET",
                        endpoint,
                        token=access_token,
                    )
                )

                if status != 200:
                    self.send_json(
                        502,
                        {
                            "error":
                                (
                                    result.get(
                                        "error"
                                    )
                                    or
                                    "Unable to list users."
                                ),
                        },
                    )
                    return

                page_users = (
                    result.get(
                        "users"
                    )
                    or []
                )

                users.extend(
                    page_users
                )

                next_token = (
                    result.get(
                        "next_token"
                    )
                )

                if next_token is None:
                    break

            output = []

            for account in users:
                user_id = (
                    account.get(
                        "name"
                    )
                    or ""
                )

                if (
                    not user_id
                    or
                    user_id == SERVICE_USER
                ):
                    continue

                is_admin = bool(
                    account.get(
                        "admin"
                    )
                )

                deactivated = bool(
                    account.get(
                        "deactivated"
                    )
                )

                is_self = (
                    user_id ==
                    admin_user
                )

                output.append(
                    {
                        "name":
                            user_id,

                        "displayname":
                            account.get(
                                "displayname"
                            ),

                        "admin":
                            is_admin,

                        "deactivated":
                            deactivated,

                        "locked":
                            bool(
                                account.get(
                                    "locked"
                                )
                            ),

                        "creation_ts":
                            account.get(
                                "creation_ts"
                            ),

                        "last_seen_ts":
                            account.get(
                                "last_seen_ts"
                            ),

                        "user_type":
                            account.get(
                                "user_type"
                            ),

                        "is_self":
                            is_self,

                        "can_manage":
                            (
                                not is_admin
                                and
                                not deactivated
                                and
                                not is_self
                            ),
                    }
                )

            output.sort(
                key=lambda item:
                    item[
                        "name"
                    ].lower()
            )

            self.send_json(
                200,
                {
                    "users":
                        output,

                    "admin_user":
                        admin_user,
                },
            )
            return

        if (
            self.path ==
            "/admin/status"
        ):
            admin_user, error = (
                authenticate_admin(
                    self.bearer_token()
                )
            )

            if error:
                self.send_json(
                    403,
                    {
                        "admin":
                            False,
                    },
                )
                return

            self.send_json(
                200,
                {
                    "admin":
                        True,

                    "user_id":
                        admin_user,
                },
            )
            return

        self.send_json(
            404,
            {
                "error":
                    "Not found.",
            },
        )

    def do_POST(
        self,
    ):
        try:
            body = self.read_json()
        except ValueError as exc:
            self.send_json(
                400,
                {
                    "error":
                        str(exc),
                },
            )
            return

        if (
            self.path ==
            "/admin/create-user"
        ):
            access_token = (
                self.bearer_token()
            )

            admin_user, error = (
                authenticate_admin(
                    access_token
                )
            )

            if error:
                self.send_json(
                    403,
                    {
                        "error":
                            error,
                    },
                )
                return

            localpart = str(
                body.get(
                    "username",
                    "",
                )
            ).strip().lower()

            allowed = (
                "abcdefghijklmnopqrstuvwxyz"
                "0123456789"
                "._=-"
            )

            if (
                not localpart
                or
                len(localpart) > 64
                or
                any(
                    char not in allowed
                    for char in localpart
                )
            ):
                self.send_json(
                    400,
                    {
                        "error":
                            (
                                "Username may contain only "
                                "lowercase letters, numbers, "
                                "periods, underscores, equals "
                                "signs and hyphens."
                            ),
                    },
                )
                return

            target = (
                f"@{localpart}:"
                f"{SERVER_NAME}"
            )

            if (
                target ==
                SERVICE_USER
            ):
                self.send_json(
                    409,
                    {
                        "error":
                            "That username is reserved.",
                    },
                )
                return

            status, existing_user = (
                target_account(
                    access_token,
                    target,
                )
            )

            if status == 200:
                self.send_json(
                    409,
                    {
                        "error":
                            "That user already exists.",
                    },
                )
                return

            if status != 404:
                self.send_json(
                    502,
                    {
                        "error":
                            "Unable to verify username availability.",
                    },
                )
                return

            display_name = str(
                body.get(
                    "display_name",
                    "",
                )
            ).strip()

            if len(display_name) > 128:
                self.send_json(
                    400,
                    {
                        "error":
                            "Display name is too long.",
                    },
                )
                return

            if not display_name:
                display_name = (
                    localpart
                )

            #
            # Admin never sees this password.
            # It exists only long enough to create
            # the account. The user immediately
            # replaces it using a one-time code.
            #
            temporary_password = (
                secrets.token_urlsafe(
                    48
                )
            )

            encoded = quote(
                target,
                safe="",
            )

            status, result = (
                matrix_request(
                    "PUT",
                    (
                        "/_synapse/admin/v2/users/"
                        f"{encoded}"
                    ),
                    token=access_token,
                    body={
                        "password":
                            temporary_password,

                        "logout_devices":
                            False,

                        "displayname":
                            display_name,

                        "admin":
                            False,

                        "deactivated":
                            False,
                    },
                )
            )

            temporary_password = None

            if status != 201:
                if status == 200:
                    self.send_json(
                        409,
                        {
                            "error":
                                "The account already exists.",
                        },
                    )
                else:
                    self.send_json(
                        status
                        if status < 500
                        else 500,
                        {
                            "error":
                                result.get(
                                    "error"
                                )
                                or
                                "Unable to create the user.",
                        },
                    )

                return

            try:
                code = issue_token(
                    target,
                    False,
                )
            except Exception:
                self.send_json(
                    500,
                    {
                        "error":
                            (
                                "The account was created, "
                                "but its setup code could "
                                "not be issued. Use Password "
                                "Reset Administration to "
                                "issue a reset code."
                            ),
                    },
                )
                return

            self.send_json(
                201,
                {
                    "user":
                        target,

                    "display_name":
                        display_name,

                    "code":
                        code,

                    "expires_in":
                        TOKEN_TTL,
                },
            )
            return

        if (
            self.path ==
            "/admin/user-delete"
        ):
            access_token = (
                self.bearer_token()
            )

            admin_user, error = (
                authenticate_admin(
                    access_token
                )
            )

            if error:
                self.send_json(
                    403,
                    {
                        "error":
                            error,
                    },
                )
                return

            try:
                target = (
                    canonical_user(
                        body.get(
                            "user"
                        )
                    )
                )
            except ValueError as exc:
                self.send_json(
                    400,
                    {
                        "error":
                            str(exc),
                    },
                )
                return

            confirmation = str(
                body.get(
                    "confirm",
                    "",
                )
            ).strip()

            if confirmation != target:
                self.send_json(
                    400,
                    {
                        "error":
                            (
                                "Type the exact Matrix ID "
                                "to confirm deletion."
                            ),
                    },
                )
                return

            if (
                target ==
                SERVICE_USER
            ):
                self.send_json(
                    403,
                    {
                        "error":
                            "The service account cannot be deleted.",
                    },
                )
                return

            if (
                target ==
                admin_user
            ):
                self.send_json(
                    403,
                    {
                        "error":
                            "You cannot delete your own administrator account.",
                    },
                )
                return

            status, account = (
                target_account(
                    access_token,
                    target,
                )
            )

            if status != 200:
                self.send_json(
                    404,
                    {
                        "error":
                            "User not found.",
                    },
                )
                return

            if (
                account.get(
                    "admin"
                )
                is True
            ):
                self.send_json(
                    403,
                    {
                        "error":
                            (
                                "Administrator accounts require "
                                "host-side management."
                            ),
                    },
                )
                return

            if (
                account.get(
                    "deactivated"
                )
                is True
            ):
                self.send_json(
                    409,
                    {
                        "error":
                            "This account is already deleted.",
                    },
                )
                return

            encoded = quote(
                target,
                safe="",
            )

            status, result = (
                matrix_request(
                    "POST",
                    (
                        "/_synapse/admin/v1/deactivate/"
                        f"{encoded}"
                    ),
                    token=access_token,
                    body={
                        "erase":
                            False,
                    },
                )
            )

            if status != 200:
                self.send_json(
                    502,
                    {
                        "error":
                            (
                                result.get(
                                    "error"
                                )
                                or
                                "Synapse could not deactivate the account."
                            ),
                    },
                )
                return

            #
            # Also invalidate any pending
            # DC Coms password-reset code.
            #
            cancel_token(
                target
            )

            self.send_json(
                200,
                {
                    "user":
                        target,

                    "deleted":
                        True,

                    "messages_retained":
                        True,
                },
            )
            return

        if (
            self.path ==
            "/admin/user-lock"
        ):
            access_token = (
                self.bearer_token()
            )

            admin_user, error = (
                authenticate_admin(
                    access_token
                )
            )

            if error:
                self.send_json(
                    403,
                    {
                        "error":
                            error,
                    },
                )
                return

            try:
                target = (
                    canonical_user(
                        body.get(
                            "user"
                        )
                    )
                )
            except ValueError as exc:
                self.send_json(
                    400,
                    {
                        "error":
                            str(exc),
                    },
                )
                return

            if (
                target ==
                SERVICE_USER
            ):
                self.send_json(
                    403,
                    {
                        "error":
                            "The service account cannot be managed here.",
                    },
                )
                return

            if (
                target ==
                admin_user
            ):
                self.send_json(
                    403,
                    {
                        "error":
                            "You cannot lock your own administrator account.",
                    },
                )
                return

            status, account = (
                target_account(
                    access_token,
                    target,
                )
            )

            if status != 200:
                self.send_json(
                    404,
                    {
                        "error":
                            "User not found.",
                    },
                )
                return

            if (
                account.get(
                    "admin"
                )
                is True
            ):
                self.send_json(
                    403,
                    {
                        "error":
                            "Administrator accounts require host-side management.",
                    },
                )
                return

            if (
                account.get(
                    "deactivated"
                )
                is True
            ):
                self.send_json(
                    409,
                    {
                        "error":
                            "Deactivated accounts cannot be managed here.",
                    },
                )
                return

            locked = bool(
                body.get(
                    "locked"
                )
            )

            encoded = quote(
                target,
                safe="",
            )

            status, result = (
                matrix_request(
                    "PUT",
                    (
                        "/_synapse/admin/v2/users/"
                        f"{encoded}"
                    ),
                    token=access_token,
                    body={
                        "locked":
                            locked,
                    },
                )
            )

            if status not in (
                200,
                201,
            ):
                self.send_json(
                    502,
                    {
                        "error":
                            (
                                result.get(
                                    "error"
                                )
                                or
                                "Unable to update account lock state."
                            ),
                    },
                )
                return

            revoked_devices = 0

            #
            # Locking should immediately
            # remove active DC Coms device
            # sessions as well as prevent
            # future password logins.
            #
            if locked:
                device_status, devices = (
                    matrix_request(
                        "GET",
                        (
                            "/_synapse/admin/v2/users/"
                            f"{encoded}/devices"
                        ),
                        token=access_token,
                    )
                )

                if device_status != 200:
                    self.send_json(
                        502,
                        {
                            "error":
                                (
                                    "Account was locked, "
                                    "but existing devices "
                                    "could not be enumerated."
                                ),

                            "locked":
                                True,
                        },
                    )
                    return

                device_ids = [
                    device.get(
                        "device_id"
                    )
                    for device
                    in (
                        devices.get(
                            "devices"
                        )
                        or []
                    )
                    if device.get(
                        "device_id"
                    )
                ]

                if device_ids:
                    delete_status, delete_result = (
                        matrix_request(
                            "POST",
                            (
                                "/_synapse/admin/v2/users/"
                                f"{encoded}/delete_devices"
                            ),
                            token=access_token,
                            body={
                                "devices":
                                    device_ids,
                            },
                        )
                    )

                    if delete_status != 200:
                        self.send_json(
                            502,
                            {
                                "error":
                                    (
                                        "Account was locked, "
                                        "but one or more existing "
                                        "device sessions could not "
                                        "be revoked."
                                    ),

                                "locked":
                                    True,
                            },
                        )
                        return

                    revoked_devices = len(
                        device_ids
                    )

            self.send_json(
                200,
                {
                    "user":
                        target,

                    "locked":
                        locked,

                    "revoked_devices":
                        revoked_devices,
                },
            )
            return

        if (
            self.path ==
            "/admin/issue"
        ):
            access_token = (
                self.bearer_token()
            )

            admin_user, error = (
                authenticate_admin(
                    access_token
                )
            )

            if error:
                self.send_json(
                    403,
                    {
                        "error":
                            error,
                    },
                )
                return

            try:
                target = (
                    canonical_user(
                        body.get(
                            "user"
                        )
                    )
                )
            except ValueError as exc:
                self.send_json(
                    400,
                    {
                        "error":
                            str(exc),
                    },
                )
                return

            if (
                target ==
                SERVICE_USER
            ):
                self.send_json(
                    403,
                    {
                        "error":
                            "The reset-service account cannot be reset here.",
                    },
                )
                return

            status, account = (
                target_account(
                    access_token,
                    target,
                )
            )

            if status != 200:
                self.send_json(
                    404,
                    {
                        "error":
                            "User not found.",
                    },
                )
                return

            if account.get(
                "admin"
            ) is True:
                self.send_json(
                    403,
                    {
                        "error":
                            "Administrator accounts require host-side break-glass recovery.",
                    },
                )
                return

            if (
                account.get(
                    "deactivated"
                ) is True
            ):
                self.send_json(
                    409,
                    {
                        "error":
                            "That account is deactivated.",
                    },
                )
                return

            logout_devices = bool(
                body.get(
                    "logout_devices",
                    False,
                )
            )

            code = issue_token(
                target,
                logout_devices,
            )

            self.send_json(
                200,
                {
                    "user":
                        target,

                    "code":
                        code,

                    "expires_in":
                        TOKEN_TTL,

                    "logout_devices":
                        logout_devices,
                },
            )
            return

        if (
            self.path ==
            "/admin/cancel"
        ):
            access_token = (
                self.bearer_token()
            )

            admin_user, error = (
                authenticate_admin(
                    access_token
                )
            )

            if error:
                self.send_json(
                    403,
                    {
                        "error":
                            error,
                    },
                )
                return

            try:
                target = (
                    canonical_user(
                        body.get(
                            "user"
                        )
                    )
                )
            except ValueError as exc:
                self.send_json(
                    400,
                    {
                        "error":
                            str(exc),
                    },
                )
                return

            cancelled = (
                cancel_token(
                    target
                )
            )

            self.send_json(
                200,
                {
                    "cancelled":
                        cancelled,
                },
            )
            return

        if (
            self.path ==
            "/change"
        ):
            access_token = (
                self.bearer_token()
            )

            if not access_token:
                self.send_json(
                    401,
                    {
                        "error":
                            "Authentication required.",
                    },
                )
                return

            status, who = (
                matrix_request(
                    "GET",
                    "/_matrix/client/v3/account/whoami",
                    token=access_token,
                )
            )

            if (
                status != 200
                or
                not who.get(
                    "user_id"
                )
            ):
                self.send_json(
                    401,
                    {
                        "error":
                            "Your Matrix session is no longer valid.",
                    },
                )
                return

            target = who[
                "user_id"
            ]

            current_password = str(
                body.get(
                    "current_password",
                    "",
                )
            )

            new_password = str(
                body.get(
                    "new_password",
                    "",
                )
            )

            if not current_password:
                self.send_json(
                    400,
                    {
                        "error":
                            "Current password is required.",
                    },
                )
                return

            if (
                len(new_password) < 12
                or
                len(new_password) > 512
            ):
                self.send_json(
                    400,
                    {
                        "error":
                            "New password must be between 12 and 512 characters.",
                    },
                )
                return

            if (
                current_password ==
                new_password
            ):
                self.send_json(
                    400,
                    {
                        "error":
                            "Choose a new password that differs from the current password.",
                    },
                )
                return

            endpoint = (
                "/_matrix/client/v3/"
                "account/password"
            )

            #
            # Start Matrix UI authentication.
            #
            status, challenge = (
                matrix_request(
                    "POST",
                    endpoint,
                    token=access_token,
                    body={
                        "new_password":
                            new_password,

                        "logout_devices":
                            False,
                    },
                )
            )

            if status == 429:
                self.send_json(
                    429,
                    {
                        "error":
                            "Synapse is temporarily rate limiting password changes. Wait and try again.",

                        "retry_after_ms":
                            challenge.get(
                                "retry_after_ms"
                            ),
                    },
                )
                return

            #
            # It is possible for Synapse to accept
            # without another UIA stage.
            #
            if status == 200:
                self.send_json(
                    200,
                    {
                        "ok":
                            True,

                        "user":
                            target,
                    },
                )
                return

            if status != 401:
                self.send_json(
                    status
                    if status < 500
                    else 500,
                    {
                        "error":
                            challenge.get(
                                "error"
                            )
                            or
                            "Synapse rejected the password change.",
                    },
                )
                return

            session = challenge.get(
                "session"
            )

            flows = challenge.get(
                "flows",
                [],
            )

            password_supported = any(
                "m.login.password"
                in flow.get(
                    "stages",
                    [],
                )
                for flow in flows
            )

            if (
                not session
                or
                not password_supported
            ):
                self.send_json(
                    400,
                    {
                        "error":
                            "Synapse did not offer password authentication for this operation.",
                    },
                )
                return

            #
            # Complete UI authentication using the
            # user's CURRENT password.
            #
            status, result = (
                matrix_request(
                    "POST",
                    endpoint,
                    token=access_token,
                    body={
                        "new_password":
                            new_password,

                        "logout_devices":
                            False,

                        "auth": {
                            "type":
                                "m.login.password",

                            "session":
                                session,

                            "identifier": {
                                "type":
                                    "m.id.user",

                                "user":
                                    target,
                            },

                            "password":
                                current_password,
                        },
                    },
                )
            )

            if status == 429:
                self.send_json(
                    429,
                    {
                        "error":
                            "Synapse is temporarily rate limiting password changes. Wait and try again.",

                        "retry_after_ms":
                            result.get(
                                "retry_after_ms"
                            ),
                    },
                )
                return

            if status == 403:
                self.send_json(
                    403,
                    {
                        "error":
                            "Current password is incorrect.",
                    },
                )
                return

            if status != 200:
                self.send_json(
                    status
                    if status < 500
                    else 500,
                    {
                        "error":
                            result.get(
                                "error"
                            )
                            or
                            "Synapse rejected the password change.",
                    },
                )
                return

            self.send_json(
                200,
                {
                    "ok":
                        True,

                    "user":
                        target,

                    "message":
                        "Password changed.",

                    "logout_current_device":
                        True,
                },
            )
            return

        if (
            self.path ==
            "/reset"
        ):
            address = (
                self.client_ip()
            )

            if not check_rate_limit(
                address
            ):
                self.send_json(
                    429,
                    {
                        "error":
                            "Too many reset attempts. Try again later.",
                    },
                )
                return

            try:
                target = (
                    canonical_user(
                        body.get(
                            "user"
                        )
                    )
                )
            except ValueError:
                record_failure(
                    address
                )

                self.send_json(
                    400,
                    {
                        "error":
                            "Invalid or expired reset code.",
                    },
                )
                return

            code = str(
                body.get(
                    "code",
                    "",
                )
            )

            password = str(
                body.get(
                    "new_password",
                    "",
                )
            )

            if (
                len(password) < 12
                or
                len(password) > 512
            ):
                self.send_json(
                    400,
                    {
                        "error":
                            "Password must be between 12 and 512 characters.",
                    },
                )
                return

            record = claim_token(
                target,
                code,
            )

            if not record:
                record_failure(
                    address
                )

                self.send_json(
                    400,
                    {
                        "error":
                            "Invalid or expired reset code.",
                    },
                )
                return

            digest = str(
                record[
                    "hash"
                ]
            )

            try:
                admin_reset_password(
                    target,
                    password,
                    bool(
                        record.get(
                            "logout_devices",
                            False,
                        )
                    ),
                )

                if not verify_password(
                    target,
                    password,
                ):
                    consume_token(
                        target,
                        digest,
                    )

                    self.send_json(
                        500,
                        {
                            "error":
                                "Synapse accepted the reset but fresh-login verification failed. Contact an administrator.",
                        },
                    )
                    return

                consume_token(
                    target,
                    digest,
                )

                clear_failures(
                    address
                )

                self.send_json(
                    200,
                    {
                        "ok":
                            True,

                        "user":
                            target,

                        "history_notice":
                            (
                                "A newly signed-in device "
                                "may require the user's "
                                "encryption recovery key "
                                "to decrypt earlier history."
                            ),
                    },
                )
                return

            except Exception:
                release_token(
                    target,
                    digest,
                )

                self.send_json(
                    500,
                    {
                        "error":
                            "Unable to complete the password reset.",
                    },
                )
                return

        self.send_json(
            404,
            {
                "error":
                    "Not found.",
            },
        )


if __name__ == "__main__":
    server = ThreadingHTTPServer(
        (
            "127.0.0.1",
            PORT,
        ),
        Handler,
    )

    server.serve_forever()
