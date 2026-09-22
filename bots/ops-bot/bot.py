#!/usr/bin/env python3

import asyncio
import json
import logging
import os
import signal
import time

from pathlib import Path

import aiohttp

from nio import (
    AsyncClient,
    AsyncClientConfig,
    InviteMemberEvent,
    LoginResponse,
    MatrixRoom,
    RoomMessageText,
    RoomSendError,
)


MATRIX_URL = os.environ[
    "DCOPS_MATRIX_URL"
]

USER_ID = os.environ[
    "DCOPS_USER"
]

PASSWORD = os.environ[
    "DCOPS_PASSWORD"
]

DATA_DIR = Path(
    os.environ[
        "DCOPS_DATA"
    ]
)

STORE_DIR = Path(
    os.environ[
        "DCOPS_STORE"
    ]
)

COLLECTOR_URL = (
    os.environ[
        "DCOPS_COLLECTOR_URL"
    ].rstrip("/")
)

COLLECTOR_TOKEN = os.environ[
    "DCOPS_COLLECTOR_TOKEN"
]

ALLOWED_USERS = {
    value.strip()
    for value in
    os.environ.get(
        "DCOPS_ALLOWED_USERS",
        "",
    ).split(",")
    if value.strip()
}

# ALLOWED_USERS are DC Ops operators.
# All local DC Coms users may run read-only commands.
SERVER_NAME = (
    USER_ID.split(
        ":",
        1,
    )[1]
)

POLL_SECONDS = max(
    60,
    int(
        os.environ.get(
            "DCOPS_POLL_SECONDS",
            "60",
        )
    ),
)

SESSION_PATH = (
    DATA_DIR /
    "session.json"
)

STATE_PATH = (
    DATA_DIR /
    "state.json"
)

START_MS = int(
    time.time() *
    1000
)


logging.basicConfig(
    level=logging.INFO,
    format=(
        "%(asctime)s "
        "%(levelname)s "
        "%(message)s"
    ),
)

log = logging.getLogger(
    "dccoms-ops"
)


HELP_TEXT = """🛠 DC Ops

SERVER STATUS

!health
!server
!disk
!services
!containers
!backup
!top

ALERTING

!alerts status
!alerts on
!alerts off

OTHER

!commands
!cmds
!help

Read-only commands are available to
local DC Coms users.

Changing alert routing requires a
DC Ops operator.

DC Ops does not provide shell access.
"""


COMMANDS_TEXT = """🛠 DC Ops Commands

!health
!server
!disk
!services
!containers
!backup
!top
!alerts status
!alerts on
!alerts off
!commands
!cmds
!help

!alerts on/off are operator-only.
"""


def is_local_user(
    user_id,
):
    if not isinstance(
        user_id,
        str,
    ):
        return False

    return (
        user_id.startswith("@")
        and
        user_id.endswith(
            f":{SERVER_NAME}"
        )
    )


def load_state():
    if not STATE_PATH.exists():
        return {
            "alert_room_id":
                None,

            "last_health_signature":
                None,

            "last_health_status":
                None,
        }

    try:
        data = json.loads(
            STATE_PATH.read_text()
        )

        if not isinstance(
            data,
            dict,
        ):
            raise ValueError(
                "state is not an object"
            )

        return {
            "alert_room_id":
                data.get(
                    "alert_room_id"
                ),

            "last_health_signature":
                data.get(
                    "last_health_signature"
                ),

            "last_health_status":
                data.get(
                    "last_health_status"
                ),
        }

    except Exception:
        log.exception(
            "Unable to load state"
        )

        return {
            "alert_room_id":
                None,

            "last_health_signature":
                None,

            "last_health_status":
                None,
        }


def save_state(
    state,
):
    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp = (
        DATA_DIR /
        "state.json.tmp"
    )

    temp.write_text(
        json.dumps(
            state,
            indent=2,
            sort_keys=True,
        )
    )

    os.chmod(
        temp,
        0o600,
    )

    temp.replace(
        STATE_PATH
    )


def parse_command(
    body,
):
    text = (
        body.strip()
    )

    if not text:
        return None

    if text.startswith("!"):
        return (
            text[1:]
            .strip()
        )

    lower = (
        text.lower()
    )

    for prefix in (
        "@dcops",
        "dcops",
    ):
        if lower.startswith(
            prefix
        ):
            return (
                text[
                    len(prefix):
                ]
                .lstrip(
                    " :,"
                )
            )

    return None


def health_signature(
    data,
):
    issues = []

    for item in (
        data.get(
            "issues",
            []
        )
    ):
        issues.append(
            (
                str(
                    item.get(
                        "severity",
                        "",
                    )
                ),

                str(
                    item.get(
                        "item",
                        "",
                    )
                ),

                str(
                    item.get(
                        "detail",
                        "",
                    )
                ),
            )
        )

    issues.sort()

    payload = {
        "status":
            data.get(
                "status",
                "unknown",
            ),

        "issues":
            issues,
    }

    return json.dumps(
        payload,
        sort_keys=True,
        separators=(
            ",",
            ":",
        ),
    )


def status_icon(
    status,
):
    return {
        "healthy":
            "🟢",

        "warning":
            "🟠",

        "critical":
            "🔴",
    }.get(
        status,
        "⚪",
    )


def format_uptime(
    seconds,
):
    seconds = int(
        seconds or 0
    )

    days, remainder = (
        divmod(
            seconds,
            86400,
        )
    )

    hours, remainder = (
        divmod(
            remainder,
            3600,
        )
    )

    minutes = (
        remainder //
        60
    )

    if days:
        return (
            f"{days}d "
            f"{hours}h "
            f"{minutes}m"
        )

    return (
        f"{hours}h "
        f"{minutes}m"
    )


def format_health(
    data,
):
    status = str(
        data.get(
            "status",
            "unknown",
        )
    )

    server = (
        data.get(
            "server",
            {}
        )
    )

    memory = (
        server.get(
            "memory",
            {}
        )
    )

    load = (
        server.get(
            "load",
            {}
        )
    )

    data_disk = (
        data.get(
            "disk",
            {}
        )
        .get(
            "mounts",
            {},
        )
        .get(
            "/data",
            {},
        )
    )

    backup = (
        data.get(
            "backup",
            {}
        )
        .get(
            "latest"
        )
    )

    lines = [
        (
            f"{status_icon(status)} "
            f"DC Ops "
            f"{status.upper()}"
        ),
        (
            "Host: "
            f"{server.get('hostname', 'unknown')}"
        ),
        (
            "Load: "
            f"{load.get('1m', '?')} / "
            f"{load.get('5m', '?')} / "
            f"{load.get('15m', '?')} "
            f"({server.get('cpu_count', '?')} vCPU)"
        ),
        (
            "Memory: "
            f"{memory.get('used', '?')} / "
            f"{memory.get('total', '?')} "
            f"({memory.get('used_percent', '?')}%)"
        ),
        (
            "/data: "
            f"{data_disk.get('used', '?')} / "
            f"{data_disk.get('total', '?')} "
            f"({data_disk.get('used_percent', '?')}%)"
        ),
    ]

    if backup:
        lines.append(
            (
                "Backup: "
                f"{backup.get('size', '?')}, "
                f"{backup.get('age_hours', '?')}h old"
            )
        )

    issues = (
        data.get(
            "issues",
            []
        )
    )

    if issues:
        lines.append(
            ""
        )

        lines.append(
            "Issues:"
        )

        for issue in issues:
            severity = (
                str(
                    issue.get(
                        "severity",
                        "unknown",
                    )
                )
            )

            lines.append(
                (
                    f"{status_icon(severity)} "
                    f"{issue.get('item', 'unknown')}: "
                    f"{issue.get('detail', '')}"
                )
            )

    return "\n".join(
        lines
    )


def format_server(
    data,
):
    memory = (
        data.get(
            "memory",
            {}
        )
    )

    load = (
        data.get(
            "load",
            {}
        )
    )

    return "\n".join(
        [
            "🖥 DC Ops Server",
            (
                "Host: "
                f"{data.get('hostname', 'unknown')}"
            ),
            (
                "CPU: "
                f"{data.get('cpu_count', '?')} vCPU"
            ),
            (
                "Load: "
                f"{load.get('1m', '?')} / "
                f"{load.get('5m', '?')} / "
                f"{load.get('15m', '?')}"
            ),
            (
                "Memory: "
                f"{memory.get('used', '?')} / "
                f"{memory.get('total', '?')} "
                f"({memory.get('used_percent', '?')}%)"
            ),
            (
                "Available: "
                f"{memory.get('available', '?')}"
            ),
            (
                "Swap: "
                f"{memory.get('swap_used', '?')} / "
                f"{memory.get('swap_total', '?')}"
            ),
            (
                "Uptime: "
                f"{format_uptime(data.get('uptime_seconds', 0))}"
            ),
        ]
    )


def format_disk(
    data,
):
    lines = [
        "💾 DC Ops Storage"
    ]

    mounts = (
        data.get(
            "mounts",
            {}
        )
    )

    for path in (
        "/",
        "/data",
        "/boot",
    ):
        disk = (
            mounts.get(
                path
            )
        )

        if not disk:
            continue

        lines.append(
            (
                f"{path}: "
                f"{disk.get('used', '?')} / "
                f"{disk.get('total', '?')} "
                f"({disk.get('used_percent', '?')}%), "
                f"{disk.get('free', '?')} free"
            )
        )

    lines.append(
        (
            "Backup files: "
            f"{data.get('backup_storage', '?')}"
        )
    )

    return "\n".join(
        lines
    )


def format_services(
    data,
):
    lines = [
        "⚙️ DC Ops Services"
    ]

    for item in (
        data.get(
            "services",
            []
        )
    ):
        state = str(
            item.get(
                "state",
                "unknown",
            )
        )

        icon = (
            "🟢"
            if state == "active"
            else "🔴"
        )

        unit = str(
            item.get(
                "unit",
                "unknown",
            )
        )

        lines.append(
            f"{icon} {unit}: {state}"
        )

    return "\n".join(
        lines
    )


def format_containers(
    data,
):
    lines = [
        "📦 DC Ops Containers"
    ]

    error = str(
        data.get(
            "error",
            "",
        )
        or ""
    )

    if error:
        lines.append(
            f"🔴 Collector error: {error}"
        )

    for item in (
        data.get(
            "containers",
            []
        )
    ):
        lines.append(
            (
                "🟢 "
                f"{item.get('name', 'unknown')}: "
                f"{item.get('state', item.get('status', 'unknown'))}"
            )
        )

    for item in (
        data.get(
            "inactive",
            []
        )
    ):
        lines.append(
            (
                "🔴 "
                f"{item.get('name', 'unknown')}: "
                f"{item.get('state', 'inactive')}"
            )
        )

    return "\n".join(
        lines
    )


def format_backup(
    data,
):
    latest = (
        data.get(
            "latest"
        )
    )

    if not latest:
        return (
            "🔴 DC Ops Backup\n"
            "No Synapse backup found."
        )

    return "\n".join(
        [
            "🗄 DC Ops Backup",
            (
                "Latest: "
                f"{latest.get('name', '?')}"
            ),
            (
                "Size: "
                f"{latest.get('size', '?')}"
            ),
            (
                "Age: "
                f"{latest.get('age_hours', '?')} hours"
            ),
            (
                "Retained: "
                f"{data.get('count', '?')} backups"
            ),
            (
                "Total storage: "
                f"{data.get('total', '?')}"
            ),
        ]
    )


def format_top(
    data,
):
    lines = [
        "📊 DC Ops Top Processes",
        "",
        "CPU:",
    ]

    for item in (
        data.get(
            "cpu",
            []
        )[:5]
    ):
        lines.append(
            (
                f"{item.get('command', '?')} "
                f"PID {item.get('pid', '?')} "
                f"CPU {item.get('cpu', '?')}% "
                f"MEM {item.get('memory', '?')}%"
            )
        )

    lines.extend(
        [
            "",
            "Memory:",
        ]
    )

    for item in (
        data.get(
            "memory",
            []
        )[:5]
    ):
        lines.append(
            (
                f"{item.get('command', '?')} "
                f"PID {item.get('pid', '?')} "
                f"CPU {item.get('cpu', '?')}% "
                f"MEM {item.get('memory', '?')}%"
            )
        )

    return "\n".join(
        lines
    )


async def open_client():
    config = AsyncClientConfig(
        store_sync_tokens=True,
        encryption_enabled=True,
    )

    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    STORE_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    if SESSION_PATH.exists():
        session = json.loads(
            SESSION_PATH.read_text()
        )

        client = AsyncClient(
            MATRIX_URL,
            USER_ID,
            device_id=
                session[
                    "device_id"
                ],
            store_path=
                str(
                    STORE_DIR
                ),
            config=config,
        )

        client.restore_login(
            user_id=
                session[
                    "user_id"
                ],

            device_id=
                session[
                    "device_id"
                ],

            access_token=
                session[
                    "access_token"
                ],
        )

        client.load_store()

        log.info(
            "Restored Matrix session %s",
            session[
                "device_id"
            ],
        )

        return client

    client = AsyncClient(
        MATRIX_URL,
        USER_ID,
        store_path=
            str(
                STORE_DIR
            ),
        config=config,
    )

    response = (
        await client.login(
            PASSWORD,
            device_name=
                "DC Ops Bot",
        )
    )

    if not isinstance(
        response,
        LoginResponse,
    ):
        raise RuntimeError(
            (
                "Matrix login failed: "
                f"{response}"
            )
        )

    session = {
        "user_id":
            response.user_id,

        "device_id":
            response.device_id,

        "access_token":
            response.access_token,
    }

    SESSION_PATH.write_text(
        json.dumps(
            session,
            indent=2,
        )
    )

    os.chmod(
        SESSION_PATH,
        0o600,
    )

    client.load_store()

    log.info(
        "Created Matrix session %s",
        response.device_id,
    )

    return client


class OpsBot:
    def __init__(
        self,
        client,
    ):
        self.client = client

        self.state = (
            load_state()
        )

        self.seen_events = set()

    async def collector(
        self,
        endpoint,
    ):
        timeout = (
            aiohttp.ClientTimeout(
                total=10
            )
        )

        headers = {
            "Authorization":
                (
                    "Bearer "
                    f"{COLLECTOR_TOKEN}"
                )
        }

        async with (
            aiohttp.ClientSession(
                timeout=timeout
            )
        ) as session:

            async with session.get(
                (
                    f"{COLLECTOR_URL}"
                    f"/v1/{endpoint}"
                ),
                headers=headers,
            ) as response:

                data = (
                    await response.json()
                )

                if (
                    response.status !=
                    200
                ):
                    raise RuntimeError(
                        (
                            "Collector HTTP "
                            f"{response.status}: "
                            f"{data}"
                        )
                    )

                return data

    async def send_text(
        self,
        room_id,
        body,
        mention=False,
    ):
        content = {
            "msgtype":
                "m.text",

            "body":
                body,
        }

        if mention:
            content[
                "m.mentions"
            ] = {
                "user_ids":
                    sorted(
                        ALLOWED_USERS
                    )
            }

        response = (
            await self.client.room_send(
                room_id=
                    room_id,

                message_type=
                    "m.room.message",

                content=
                    content,

                ignore_unverified_devices=
                    True,
            )
        )

        if isinstance(
            response,
            RoomSendError,
        ):
            raise RuntimeError(
                str(
                    response
                )
            )

    async def on_invite(
        self,
        room: MatrixRoom,
        event: InviteMemberEvent,
    ):
        if (
            event.state_key !=
            USER_ID
        ):
            return

        if (
            event.membership !=
            "invite"
        ):
            return

        if not is_local_user(
            event.sender
        ):
            log.warning(
                (
                    "Ignoring DC Ops invite "
                    "from non-local user %s"
                ),
                event.sender,
            )

            return

        log.info(
            "Joining room %s invited by %s",
            room.room_id,
            event.sender,
        )

        await self.client.join(
            room.room_id
        )

    async def command_error(
        self,
        room_id,
        exc,
    ):
        log.exception(
            "DC Ops command failed"
        )

        await self.send_text(
            room_id,
            (
                "🔴 DC Ops could not complete "
                "that health check.\n"
                f"{str(exc)[:240]}"
            ),
        )

    async def on_message(
        self,
        room: MatrixRoom,
        event: RoomMessageText,
    ):
        if (
            event.sender ==
            USER_ID
        ):
            return

        event_id = getattr(
            event,
            "event_id",
            None,
        )

        if event_id:
            if (
                event_id in
                self.seen_events
            ):
                return

            self.seen_events.add(
                event_id
            )

            if (
                len(
                    self.seen_events
                ) >
                2000
            ):
                self.seen_events.clear()

                self.seen_events.add(
                    event_id
                )

        event_ts = getattr(
            event,
            "server_timestamp",
            0,
        )

        if (
            event_ts and
            event_ts <
            START_MS
        ):
            return

        content = (
            event.source
            .get(
                "content",
                {},
            )
        )

        relation = (
            content.get(
                "m.relates_to",
                {},
            )
        )

        if (
            relation.get(
                "rel_type"
            ) ==
            "m.replace"
        ):
            return

        command = (
            parse_command(
                event.body
            )
        )

        if command is None:
            return

        if not is_local_user(
            event.sender
        ):
            log.warning(
                (
                    "Ignoring command from "
                    "non-local user %s"
                ),
                event.sender,
            )

            return

        command = (
            command.strip()
        )

        if not command:
            command = "help"

        parts = (
            command.split()
        )

        action = (
            parts[0]
            .lower()
        )

        args = [
            value.lower()
            for value in
            parts[1:]
        ]

        try:
            if action in (
                "commands",
                "cmds",
            ):
                await self.send_text(
                    room.room_id,
                    COMMANDS_TEXT,
                )

                return

            if action in (
                "help",
                "ops",
            ):
                await self.send_text(
                    room.room_id,
                    HELP_TEXT,
                )

                return

            if action == "health":
                data = (
                    await self.collector(
                        "health"
                    )
                )

                await self.send_text(
                    room.room_id,
                    format_health(
                        data
                    ),
                )

                return

            if action == "server":
                data = (
                    await self.collector(
                        "server"
                    )
                )

                await self.send_text(
                    room.room_id,
                    format_server(
                        data
                    ),
                )

                return

            if action == "disk":
                data = (
                    await self.collector(
                        "disk"
                    )
                )

                await self.send_text(
                    room.room_id,
                    format_disk(
                        data
                    ),
                )

                return

            if action == "services":
                data = (
                    await self.collector(
                        "services"
                    )
                )

                await self.send_text(
                    room.room_id,
                    format_services(
                        data
                    ),
                )

                return

            if action == "containers":
                data = (
                    await self.collector(
                        "containers"
                    )
                )

                await self.send_text(
                    room.room_id,
                    format_containers(
                        data
                    ),
                )

                return

            if action == "backup":
                data = (
                    await self.collector(
                        "backup"
                    )
                )

                await self.send_text(
                    room.room_id,
                    format_backup(
                        data
                    ),
                )

                return

            if action == "top":
                data = (
                    await self.collector(
                        "top"
                    )
                )

                await self.send_text(
                    room.room_id,
                    format_top(
                        data
                    ),
                )

                return

            if action == "alerts":
                mode = (
                    args[0]
                    if args
                    else "status"
                )

                if (
                    mode in (
                        "on",
                        "off",
                    )
                    and
                    event.sender not in
                    ALLOWED_USERS
                ):
                    await self.send_text(
                        room.room_id,
                        (
                            "🔒 Alert routing can only "
                            "be changed by a DC Ops "
                            "operator."
                        ),
                    )

                    return

                if mode == "on":
                    health = (
                        await self.collector(
                            "health"
                        )
                    )

                    self.state[
                        "alert_room_id"
                    ] = (
                        room.room_id
                    )

                    self.state[
                        "last_health_signature"
                    ] = (
                        health_signature(
                            health
                        )
                    )

                    self.state[
                        "last_health_status"
                    ] = (
                        health.get(
                            "status",
                            "unknown",
                        )
                    )

                    save_state(
                        self.state
                    )

                    await self.send_text(
                        room.room_id,
                        (
                            "🔔 DC Ops proactive "
                            "alerts enabled in this room.\n\n"
                            +
                            format_health(
                                health
                            )
                        ),
                    )

                    return

                if mode == "off":
                    self.state[
                        "alert_room_id"
                    ] = None

                    self.state[
                        "last_health_signature"
                    ] = None

                    self.state[
                        "last_health_status"
                    ] = None

                    save_state(
                        self.state
                    )

                    await self.send_text(
                        room.room_id,
                        (
                            "🔕 DC Ops proactive "
                            "alerts disabled."
                        ),
                    )

                    return

                if mode == "status":
                    alert_room = (
                        self.state.get(
                            "alert_room_id"
                        )
                    )

                    if not alert_room:
                        message = (
                            "🔕 DC Ops alerts "
                            "are disabled."
                        )

                    elif (
                        alert_room ==
                        room.room_id
                    ):
                        message = (
                            "🔔 DC Ops alerts "
                            "are enabled in this room."
                        )

                    else:
                        message = (
                            "🔔 DC Ops alerts are "
                            "enabled in another room.\n"
                            f"Room: {alert_room}"
                        )

                    await self.send_text(
                        room.room_id,
                        message,
                    )

                    return

                await self.send_text(
                    room.room_id,
                    (
                        "Usage:\n"
                        "!alerts on\n"
                        "!alerts off\n"
                        "!alerts status"
                    ),
                )

                return

            await self.send_text(
                room.room_id,
                (
                    "Unknown DC Ops command.\n\n"
                    +
                    HELP_TEXT
                ),
            )

        except Exception as exc:
            await self.command_error(
                room.room_id,
                exc,
            )

    async def alert_loop(
        self,
    ):
        log.info(
            (
                "DC Ops alert monitor active "
                "at %s second intervals"
            ),
            POLL_SECONDS,
        )

        await asyncio.sleep(
            15
        )

        while True:
            try:
                alert_room = (
                    self.state.get(
                        "alert_room_id"
                    )
                )

                if not alert_room:
                    await asyncio.sleep(
                        POLL_SECONDS
                    )

                    continue

                try:
                    health = (
                        await self.collector(
                            "health"
                        )
                    )

                    signature = (
                        health_signature(
                            health
                        )
                    )

                    status = (
                        health.get(
                            "status",
                            "unknown",
                        )
                    )

                    previous_signature = (
                        self.state.get(
                            "last_health_signature"
                        )
                    )

                    previous_status = (
                        self.state.get(
                            "last_health_status"
                        )
                    )

                    if (
                        previous_signature is None
                    ):
                        self.state[
                            "last_health_signature"
                        ] = signature

                        self.state[
                            "last_health_status"
                        ] = status

                        save_state(
                            self.state
                        )

                    elif (
                        signature !=
                        previous_signature
                    ):
                        if (
                            status ==
                            "healthy" and
                            previous_status !=
                            "healthy"
                        ):
                            message = (
                                "🟢 DC Ops RECOVERY\n"
                                "All monitored checks "
                                "are healthy again."
                            )

                            mention = False

                        else:
                            message = (
                                "DC OPS ALERT\n\n"
                                +
                                format_health(
                                    health
                                )
                            )

                            mention = (
                                status in (
                                    "warning",
                                    "critical",
                                )
                            )

                        await self.send_text(
                            alert_room,
                            message,
                            mention=mention,
                        )

                        self.state[
                            "last_health_signature"
                        ] = signature

                        self.state[
                            "last_health_status"
                        ] = status

                        save_state(
                            self.state
                        )

                except Exception as exc:
                    error_text = (
                        str(exc)[:180]
                    )

                    signature = (
                        "collector-error:"
                        +
                        error_text
                    )

                    previous_signature = (
                        self.state.get(
                            "last_health_signature"
                        )
                    )

                    if (
                        signature !=
                        previous_signature
                    ):
                        await self.send_text(
                            alert_room,
                            (
                                "🔴 DC Ops ALERT\n"
                                "Host collector is unavailable.\n"
                                f"{error_text}"
                            ),
                            mention=True,
                        )

                        self.state[
                            "last_health_signature"
                        ] = signature

                        self.state[
                            "last_health_status"
                        ] = (
                            "collector-error"
                        )

                        save_state(
                            self.state
                        )

            except asyncio.CancelledError:
                raise

            except Exception:
                log.exception(
                    "DC Ops alert loop error"
                )

            await asyncio.sleep(
                POLL_SECONDS
            )


async def main():
    client = (
        await open_client()
    )

    try:
        response = (
            await client.set_displayname(
                "DC Ops"
            )
        )

        name = (
            response
            .__class__
            .__name__
        )

        if name.endswith(
            "Error"
        ):
            log.warning(
                (
                    "Unable to set DC Ops "
                    "display name: %s"
                ),
                response,
            )
        else:
            log.info(
                (
                    "DC Ops display name "
                    "confirmed"
                )
            )

    except Exception:
        log.exception(
            (
                "Unable to set DC Ops "
                "display name"
            )
        )

    bot = OpsBot(
        client
    )

    client.add_event_callback(
        bot.on_invite,
        InviteMemberEvent,
    )

    client.add_event_callback(
        bot.on_message,
        RoomMessageText,
    )

    alert_task = (
        asyncio.create_task(
            bot.alert_loop()
        )
    )

    sync_task = (
        asyncio.create_task(
            client.sync_forever(
                timeout=30000,
                full_state=True,
            )
        )
    )

    shutdown_event = (
        asyncio.Event()
    )

    loop = (
        asyncio.get_running_loop()
    )

    def request_shutdown(
        signal_name,
    ):
        if (
            shutdown_event.is_set()
        ):
            return

        log.info(
            (
                "Received %s; "
                "shutting down cleanly"
            ),
            signal_name,
        )

        shutdown_event.set()

    installed_signals = []

    for sig in (
        signal.SIGTERM,
        signal.SIGINT,
    ):
        try:
            loop.add_signal_handler(
                sig,
                request_shutdown,
                sig.name,
            )

            installed_signals.append(
                sig
            )

        except (
            NotImplementedError,
            RuntimeError,
        ):
            log.warning(
                (
                    "Unable to install "
                    "handler for %s"
                ),
                sig.name,
            )

    shutdown_task = (
        asyncio.create_task(
            shutdown_event.wait()
        )
    )

    log.info(
        "Starting DC Ops as %s",
        USER_ID,
    )

    try:
        done, _ = (
            await asyncio.wait(
                {
                    sync_task,
                    shutdown_task,
                },
                return_when=
                    asyncio.FIRST_COMPLETED,
            )
        )

        if (
            sync_task in done
        ):
            await sync_task

        elif (
            shutdown_task in done and
            not sync_task.done()
        ):
            sync_task.cancel()

            try:
                await sync_task

            except asyncio.CancelledError:
                pass

    finally:
        for sig in (
            installed_signals
        ):
            try:
                loop.remove_signal_handler(
                    sig
                )

            except Exception:
                pass

        if not shutdown_task.done():
            shutdown_task.cancel()

        alert_task.cancel()

        await asyncio.gather(
            shutdown_task,
            alert_task,
            return_exceptions=True,
        )

        try:
            await client.close()

        finally:
            log.info(
                "DC Ops shutdown complete"
            )


if __name__ == "__main__":
    asyncio.run(
        main()
    )
