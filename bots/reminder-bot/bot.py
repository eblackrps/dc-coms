#!/usr/bin/env python3

import asyncio
import json
import logging
import os
import re
import signal
import sqlite3
import time

from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import dateparser

from nio import (
    AsyncClient,
    AsyncClientConfig,
    InviteMemberEvent,
    LoginResponse,
    MatrixRoom,
    RoomMessageText,
    RoomSendError,
)


MATRIX_URL = os.environ["DCREMINDER_MATRIX_URL"]
USER_ID = os.environ["DCREMINDER_USER"]
PASSWORD = os.environ["DCREMINDER_PASSWORD"]

DATA_DIR = Path(
    os.environ["DCREMINDER_DATA"]
)

STORE_DIR = Path(
    os.environ["DCREMINDER_STORE"]
)

DB_PATH = Path(
    os.environ["DCREMINDER_DB"]
)

TIMEZONE_NAME = os.environ.get(
    "DCREMINDER_TIMEZONE",
    "America/New_York",
)

TZ = ZoneInfo(
    TIMEZONE_NAME
)

SESSION_PATH = (
    DATA_DIR /
    "session.json"
)

SERVER_NAME = USER_ID.split(
    ":",
    1,
)[1]

START_MS = int(
    time.time() * 1000
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
    "dccoms-reminder"
)


COMMAND_RE = re.compile(
    r"""
    ^\s*
    (?:
        !remindme\b
        |
        remindme!(?=\s|$)
        |
        @reminderbot
        (?::[A-Za-z0-9.\-]+)?
        \b
    )
    \s*
    [,:]?
    \s*
    (.*)
    $
    """,
    re.IGNORECASE |
    re.VERBOSE,
)


DURATION_RE = re.compile(
    r"""
    ^
    (?:in\s+)?
    (\d+)
    \s*
    (
        seconds?|secs?|s
        |
        minutes?|mins?|m
        |
        hours?|hrs?|h
        |
        days?|d
        |
        weeks?|w
    )
    \b
    [\s,:-]*
    (.*)
    $
    """,
    re.IGNORECASE |
    re.VERBOSE,
)


HELP_TEXT = f"""⏰ Reminder Bot

CREATE A REMINDER

!remindme 20m check the backup
!remindme 2h call Joe
!remindme tomorrow 9am review DR results
!remindme Friday 3pm firmware window

You can also use:
@reminderbot 30m do the thing

REPLY REMINDERS

Reply to a message with:

!remindme 20m

The replied-to message becomes the reminder text.

You can also include your own text:

!remindme 20m follow up with Joe

PERSONAL REMINDERS

Use your private Reminder Bot conversation,
or choose:

Message ••• → Remind me → Personal

Personal reminders are visible only in your
Reminder Bot conversation.

CHANNEL REMINDERS

Choose:

Message ••• → Remind me → Channel

The reminder fires back into the channel
and keeps the original message as context.

MANAGE

!remindme list
!remindme cancel 12
!remindme help

Timezone: {TIMEZONE_NAME}
"""


def db_connect():
    db = sqlite3.connect(
        DB_PATH,
        timeout=10,
    )

    db.row_factory = (
        sqlite3.Row
    )

    return db


def init_db():
    DATA_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    STORE_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    with db_connect() as db:
        db.execute(
            """
            PRAGMA journal_mode=WAL
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT NOT NULL,
                creator_id TEXT NOT NULL,
                creator_display TEXT,
                due_ts INTEGER NOT NULL,
                message TEXT NOT NULL,
                source_event_id TEXT UNIQUE,
                created_ts INTEGER NOT NULL,
                fired_ts INTEGER,
                status TEXT NOT NULL DEFAULT 'pending'
            )
            """
        )

        # DC COMS REPLY EVENT MIGRATION
        columns = {
            row["name"]
            for row in db.execute(
                "PRAGMA table_info(reminders)"
            ).fetchall()
        }

        if (
            "reply_event_id"
            not in columns
        ):
            db.execute(
                """
                ALTER TABLE reminders
                ADD COLUMN reply_event_id TEXT
                """
            )

        # DC COMS REMINDER V2 MIGRATION
        columns = {
            row["name"]
            for row in db.execute(
                "PRAGMA table_info(reminders)"
            ).fetchall()
        }

        migrations = (
            (
                "delivery_mode",
                "TEXT NOT NULL DEFAULT 'channel'",
            ),
            (
                "origin_room_id",
                "TEXT",
            ),
            (
                "origin_event_id",
                "TEXT",
            ),
            (
                "origin_preview",
                "TEXT",
            ),
        )

        for (
            column,
            definition,
        ) in migrations:
            if column not in columns:
                db.execute(
                    f"""
                    ALTER TABLE reminders
                    ADD COLUMN {column} {definition}
                    """
                )

        db.execute(
            """
            CREATE INDEX IF NOT EXISTS
            idx_reminders_due
            ON reminders (
                status,
                due_ts
            )
            """
        )

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_events (
                event_id TEXT PRIMARY KEY,
                processed_ts INTEGER NOT NULL
            )
            """
        )

        # If the service died while firing one,
        # make it eligible for retry.
        db.execute(
            """
            UPDATE reminders
            SET status = 'pending'
            WHERE status = 'firing'
            """
        )

        db.commit()


def claim_event(
    event_id: str,
) -> bool:
    if not event_id:
        return True

    try:
        with db_connect() as db:
            db.execute(
                """
                INSERT INTO processed_events (
                    event_id,
                    processed_ts
                )
                VALUES (?, ?)
                """,
                (
                    event_id,
                    int(time.time()),
                ),
            )

            db.commit()

        return True

    except sqlite3.IntegrityError:
        return False


def format_due(
    due_ts: int,
) -> str:
    dt = datetime.fromtimestamp(
        due_ts,
        TZ,
    )

    return dt.strftime(
        "%a %b %-d at %-I:%M %p %Z"
    )


def duration_seconds(
    amount: int,
    unit: str,
) -> int:
    unit = unit.lower()

    if unit.startswith("s"):
        return amount

    if (
        unit.startswith("m") and
        not unit.startswith("mon")
    ):
        return amount * 60

    if unit.startswith("h"):
        return amount * 3600

    if unit.startswith("d"):
        return amount * 86400

    if unit.startswith("w"):
        return amount * 604800

    raise ValueError(
        "Unsupported duration."
    )


def validate_due(
    due_ts: int,
) -> bool:
    now = int(
        time.time()
    )

    if due_ts < now + 5:
        return False

    if due_ts > (
        now +
        3660 * 86400
    ):
        return False

    return True


def parse_schedule(
    raw: str,
):
    raw = raw.strip()

    if not raw:
        return None

    now = datetime.now(
        TZ
    )

    # Reddit-style quoted reminder:
    #
    # !remindme tomorrow 9am "check backups"
    #
    quoted = re.match(
        r'^(.*?)\s+["“](.+)["”]\s*$',
        raw,
    )

    if quoted:
        time_text = (
            quoted
            .group(1)
            .strip()
        )

        message = (
            quoted
            .group(2)
            .strip()
        )

        parsed = dateparser.parse(
            time_text,
            languages=["en"],
            settings={
                "TIMEZONE":
                    TIMEZONE_NAME,

                "RETURN_AS_TIMEZONE_AWARE":
                    True,

                "PREFER_DATES_FROM":
                    "future",

                "RELATIVE_BASE":
                    now,
            },
        )

        if parsed:
            due_ts = int(
                parsed.timestamp()
            )

            if validate_due(
                due_ts
            ):
                return (
                    due_ts,
                    message or
                    "Reminder",
                )

    # Explicit relative duration.
    duration_match = (
        DURATION_RE.match(
            raw
        )
    )

    if duration_match:
        amount = int(
            duration_match
            .group(1)
        )

        unit = (
            duration_match
            .group(2)
        )

        message = (
            duration_match
            .group(3)
            .strip()
        )

        seconds = (
            duration_seconds(
                amount,
                unit,
            )
        )

        due_ts = int(
            time.time()
        ) + seconds

        if validate_due(
            due_ts
        ):
            return (
                due_ts,
                message or
                "Reminder",
            )

    # Natural language:
    #
    # tomorrow 9am review DR
    # Friday 3pm firmware window
    # 2026-09-21 14:30 update firmware
    #
    tokens = raw.split()

    max_prefix = min(
        len(tokens),
        6,
    )

    for length in range(
        max_prefix,
        0,
        -1,
    ):
        time_text = " ".join(
            tokens[:length]
        )

        message = " ".join(
            tokens[length:]
        ).strip()

        parsed = dateparser.parse(
            time_text,
            languages=["en"],
            settings={
                "TIMEZONE":
                    TIMEZONE_NAME,

                "RETURN_AS_TIMEZONE_AWARE":
                    True,

                "PREFER_DATES_FROM":
                    "future",

                "RELATIVE_BASE":
                    now,
            },
        )

        if not parsed:
            continue

        due_ts = int(
            parsed.timestamp()
        )

        if not validate_due(
            due_ts
        ):
            continue

        return (
            due_ts,
            message or
            "Reminder",
        )

    return None


def create_reminder(
    room_id: str,
    creator_id: str,
    creator_display: str,
    due_ts: int,
    message: str,
    event_id: str,
    delivery_mode: str = "channel",
    origin_room_id:
        str | None = None,
    origin_event_id:
        str | None = None,
    origin_preview:
        str | None = None,
):
    message = (
        message.strip()[:1000]
    )

    if not message:
        raise RuntimeError(
            "A reminder needs reminder text."
        )

    if delivery_mode not in (
        "channel",
        "personal",
    ):
        delivery_mode = (
            "channel"
        )

    if origin_preview:
        origin_preview = (
            origin_preview
            .strip()[:800]
        )

    with db_connect() as db:
        count = db.execute(
            """
            SELECT COUNT(*) AS total
            FROM reminders
            WHERE creator_id = ?
              AND status = 'pending'
            """,
            (
                creator_id,
            ),
        ).fetchone()["total"]

        if count >= 100:
            raise RuntimeError(
                "You already have 100 pending reminders."
            )

        cur = db.execute(
            """
            INSERT INTO reminders (
                room_id,
                creator_id,
                creator_display,
                due_ts,
                message,
                source_event_id,
                created_ts,
                status,
                delivery_mode,
                origin_room_id,
                origin_event_id,
                origin_preview
            )
            VALUES (
                ?, ?, ?, ?, ?, ?, ?, 'pending',
                ?, ?, ?, ?
            )
            """,
            (
                room_id,
                creator_id,
                creator_display,
                due_ts,
                message,
                event_id,
                int(time.time()),
                delivery_mode,
                origin_room_id,
                origin_event_id,
                origin_preview,
            ),
        )

        db.commit()

        return cur.lastrowid


def list_reminders(
    room_id: str,
    creator_id: str,
):
    with db_connect() as db:
        return db.execute(
            """
            SELECT
                id,
                due_ts,
                message,
                delivery_mode,
                origin_room_id,
                origin_event_id,
                origin_preview
            FROM reminders
            WHERE room_id = ?
              AND creator_id = ?
              AND status = 'pending'
            ORDER BY due_ts
            LIMIT 20
            """,
            (
                room_id,
                creator_id,
            ),
        ).fetchall()


def cancel_reminder(
    reminder_id: int,
    creator_id: str,
):
    with db_connect() as db:
        cur = db.execute(
            """
            UPDATE reminders
            SET status = 'cancelled'
            WHERE id = ?
              AND creator_id = ?
              AND status = 'pending'
            """,
            (
                reminder_id,
                creator_id,
            ),
        )

        db.commit()

        return (
            cur.rowcount == 1
        )


def claim_due_reminders():
    now = int(
        time.time()
    )

    claimed = []

    with db_connect() as db:
        rows = db.execute(
            """
            SELECT *
            FROM reminders
            WHERE status = 'pending'
              AND due_ts <= ?
            ORDER BY due_ts
            LIMIT 25
            """,
            (
                now,
            ),
        ).fetchall()

        for row in rows:
            cur = db.execute(
                """
                UPDATE reminders
                SET status = 'firing'
                WHERE id = ?
                  AND status = 'pending'
                """,
                (
                    row["id"],
                ),
            )

            if cur.rowcount == 1:
                claimed.append(
                    dict(row)
                )

        db.commit()

    return claimed


def mark_fired(
    reminder_id: int,
):
    with db_connect() as db:
        db.execute(
            """
            UPDATE reminders
            SET
                status = 'fired',
                fired_ts = ?
            WHERE id = ?
            """,
            (
                int(time.time()),
                reminder_id,
            ),
        )

        db.commit()


def mark_retry(
    reminder_id: int,
):
    with db_connect() as db:
        db.execute(
            """
            UPDATE reminders
            SET status = 'pending'
            WHERE id = ?
              AND status = 'firing'
            """,
            (
                reminder_id,
            ),
        )

        db.commit()


async def open_client():
    config = AsyncClientConfig(
        store_sync_tokens=True,
        encryption_enabled=True,
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
                session["device_id"],
            store_path=
                str(STORE_DIR),
            config=config,
        )

        client.restore_login(
            user_id=
                session["user_id"],

            device_id=
                session["device_id"],

            access_token=
                session["access_token"],
        )

        client.load_store()

        log.info(
            "Restored Matrix session %s",
            session["device_id"],
        )

        return client

    client = AsyncClient(
        MATRIX_URL,
        USER_ID,
        store_path=
            str(STORE_DIR),
        config=config,
    )

    response = await client.login(
        PASSWORD,
        device_name=
            "DC Coms Reminder Bot",
    )

    if not isinstance(
        response,
        LoginResponse,
    ):
        raise RuntimeError(
            f"Matrix login failed: {response}"
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
        "Created persistent Matrix session %s",
        response.device_id,
    )

    return client


class ReminderBot:
    def __init__(
        self,
        client: AsyncClient,
    ):
        self.client = client

    async def send_text(
        self,
        room_id: str,
        body: str,
        mention_user:
            str | None = None,
        reply_event_id:
            str | None = None,
        reminder_meta:
            dict | None = None,
    ):
        content = {
            "msgtype":
                "m.text",

            "body":
                body,
        }

        if mention_user:
            content[
                "m.mentions"
            ] = {
                "user_ids": [
                    mention_user
                ]
            }

        if reply_event_id:
            content[
                "m.relates_to"
            ] = {
                "m.in_reply_to": {
                    "event_id":
                        reply_event_id
                }
            }

        if reminder_meta:
            content[
                "com.dccoms.reminder"
            ] = reminder_meta

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
                str(response)
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

        # Do not auto-join rooms invited
        # by arbitrary federated users.
        if not event.sender.endswith(
            f":{SERVER_NAME}"
        ):
            log.warning(
                "Ignoring external invite from %s",
                event.sender,
            )

            return

        log.info(
            "Joining invited room %s from %s",
            room.room_id,
            event.sender,
        )

        await self.client.join(
            room.room_id
        )

    async def get_reply_context(
        self,
        room: MatrixRoom,
        event: RoomMessageText,
    ):
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

        reply_info = (
            relation.get(
                "m.in_reply_to",
                {},
            )
            if isinstance(
                relation,
                dict,
            )
            else {}
        )

        event_id = (
            reply_info.get(
                "event_id"
            )
            if isinstance(
                reply_info,
                dict,
            )
            else None
        )

        if not isinstance(
            event_id,
            str,
        ):
            return None

        try:
            response = (
                await self.client
                .room_get_event(
                    room.room_id,
                    event_id,
                )
            )

            target_event = getattr(
                response,
                "event",
                None,
            )

            if target_event is None:
                return None

            target_body = getattr(
                target_event,
                "body",
                None,
            )

            if not isinstance(
                target_body,
                str,
            ):
                target_source = getattr(
                    target_event,
                    "source",
                    {},
                )

                target_content = (
                    target_source.get(
                        "content",
                        {},
                    )
                    if isinstance(
                        target_source,
                        dict,
                    )
                    else {}
                )

                target_body = (
                    target_content.get(
                        "body"
                    )
                )

            if (
                not isinstance(
                    target_body,
                    str,
                )
                or
                not target_body.strip()
            ):
                return None

            target_sender = getattr(
                target_event,
                "sender",
                "",
            )

            if not isinstance(
                target_sender,
                str,
            ):
                target_sender = ""

            display_name = (
                room.user_name(
                    target_sender
                )
                if target_sender
                else None
            )

            if not display_name:
                display_name = (
                    target_sender
                    .split(
                        ":",
                        1,
                    )[0]
                    .replace(
                        "@",
                        "",
                    )
                    if target_sender
                    else "Message"
                )

            preview = (
                target_body
                .strip()
            )

            if len(preview) > 800:
                preview = (
                    preview[:797]
                    + "..."
                )

            return {
                "event_id":
                    event_id,

                "body":
                    preview,

                "sender":
                    target_sender,

                "display_name":
                    display_name,
            }

        except Exception:
            log.exception(
                "Unable to resolve reply event %s",
                event_id,
            )

            return None

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

        content = (
            event.source
            .get(
                "content",
                {},
            )
        )

        relates = (
            content.get(
                "m.relates_to",
                {},
            )
        )

        # Ignore edited copies of old
        # reminder commands.
        if (
            relates.get(
                "rel_type"
            ) ==
            "m.replace"
        ):
            return

        match = COMMAND_RE.match(
            event.body
        )

        if not match:
            return

        if not claim_event(
            event.event_id
        ):
            return

        command = (
            match.group(1)
            .strip()
        )

        creator_display = (
            room.user_name(
                event.sender
            )
            or
            event.sender
        )

        if (
            not command or
            command.lower() ==
            "help"
        ):
            await self.send_text(
                room.room_id,
                HELP_TEXT,
            )

            return

        if command.lower() == "list":
            reminders = (
                list_reminders(
                    room.room_id,
                    event.sender,
                )
            )

            if not reminders:
                await self.send_text(
                    room.room_id,
                    "⏰ You have no pending reminders in this conversation.",
                )

                return

            lines = [
                "⏰ Pending reminders"
            ]

            for reminder in reminders:
                mode_label = (
                    "PERSONAL"
                    if reminder[
                        "delivery_mode"
                    ] == "personal"
                    else "CHANNEL"
                )

                lines.extend(
                    [
                        "",
                        (
                            f"#{reminder['id']} · "
                            f"{mode_label}"
                        ),
                        (
                            "   "
                            f"{format_due(reminder['due_ts'])}"
                        ),
                        (
                            "   "
                            f"{reminder['message']}"
                        ),
                    ]
                )

                if reminder[
                    "origin_preview"
                ]:
                    preview = (
                        reminder[
                            "origin_preview"
                        ]
                        .replace(
                            "\n",
                            " ",
                        )
                        .strip()
                    )

                    if len(preview) > 180:
                        preview = (
                            preview[:177]
                            + "..."
                        )

                    lines.append(
                        (
                            "   ↩ "
                            f"{preview}"
                        )
                    )

            await self.send_text(
                room.room_id,
                "\n".join(
                    lines
                ),
            )

            return

        cancel_match = re.fullmatch(
            r"cancel\s+#?(\d+)",
            command,
            re.IGNORECASE,
        )

        if cancel_match:
            reminder_id = int(
                cancel_match.group(1)
            )

            cancelled = (
                cancel_reminder(
                    reminder_id,
                    event.sender,
                )
            )

            if cancelled:
                text = (
                    f"⏰ Reminder #{reminder_id} cancelled."
                )
            else:
                text = (
                    f"Reminder #{reminder_id} was not found "
                    "or does not belong to you."
                )

            await self.send_text(
                room.room_id,
                text,
            )

            return

        parsed = parse_schedule(
            command
        )

        if not parsed:
            await self.send_text(
                room.room_id,
                (
                    "I couldn't understand that reminder time.\n\n"
                    "Try:\n"
                    "!remindme 20m check the backup\n"
                    "!remindme tomorrow 9am review DR results\n"
                    "!remindme Friday 3pm firmware window"
                ),
            )

            return

        due_ts, message = parsed

        event_content = (
            event.source.get(
                "content",
                {},
            )
        )

        request_meta = (
            event_content.get(
                "com.dccoms.reminder.request",
                {},
            )
            if isinstance(
                event_content,
                dict,
            )
            else {}
        )

        if not isinstance(
            request_meta,
            dict,
        ):
            request_meta = {}

        room_users = set(
            getattr(
                room,
                "users",
                {},
            ).keys()
        )

        looks_like_bot_dm = (
            USER_ID in room_users and
            event.sender in room_users and
            len(room_users) == 2
        )

        delivery_mode = (
            "personal"
            if (
                looks_like_bot_dm or
                request_meta.get(
                    "mode"
                ) == "personal"
            )
            else "channel"
        )

        reply_context = (
            await self.get_reply_context(
                room,
                event,
            )
        )

        origin_room_id = None
        origin_event_id = None
        origin_preview = None

        if reply_context:
            origin_room_id = (
                room.room_id
            )

            origin_event_id = (
                reply_context[
                    "event_id"
                ]
            )

            origin_preview = (
                reply_context[
                    "body"
                ]
            )

        requested_origin_room = (
            request_meta.get(
                "origin_room_id"
            )
        )

        requested_origin_event = (
            request_meta.get(
                "origin_event_id"
            )
        )

        requested_origin_preview = (
            request_meta.get(
                "origin_preview"
            )
        )

        if (
            delivery_mode ==
            "personal"
        ):
            if isinstance(
                requested_origin_room,
                str,
            ):
                origin_room_id = (
                    requested_origin_room
                )

            if isinstance(
                requested_origin_event,
                str,
            ):
                origin_event_id = (
                    requested_origin_event
                )

            if isinstance(
                requested_origin_preview,
                str,
            ):
                origin_preview = (
                    requested_origin_preview
                    .strip()[:800]
                )

        if (
            message ==
            "Reminder"
        ):
            if origin_preview:
                message = (
                    origin_preview
                )
            else:
                await self.send_text(
                    room.room_id,
                    (
                        "Tell me what to remind you about.\n\n"
                        "Example:\n"
                        "!remindme 20m check the backup"
                    ),
                )

                return

        try:
            reminder_id = (
                create_reminder(
                    room.room_id,
                    event.sender,
                    creator_display,
                    due_ts,
                    message,
                    event.event_id,
                    delivery_mode,
                    origin_room_id,
                    origin_event_id,
                    origin_preview,
                )
            )

        except Exception as exc:
            await self.send_text(
                room.room_id,
                f"Unable to create reminder: {exc}",
            )

            return

        mode_label = (
            "Personal reminder"
            if delivery_mode ==
                "personal"
            else
            "Channel reminder"
        )

        confirmation = (
            f"⏰ {mode_label} #{reminder_id} set for "
            f"{format_due(due_ts)}\n"
            f"{message}"
        )

        if origin_preview:
            confirmation += (
                "\n\n"
                "↩ Source: "
                f"{origin_preview[:180]}"
            )

        await self.send_text(
            room.room_id,
            confirmation,
        )

    async def scheduler(
        self,
    ):
        await self.client.synced.wait()

        log.info(
            "Reminder scheduler active"
        )

        while True:
            for reminder in (
                claim_due_reminders()
            ):
                local_user = (
                    reminder[
                        "creator_id"
                    ]
                    .split(
                        ":",
                        1,
                    )[0]
                )

                mode = (
                    reminder.get(
                        "delivery_mode"
                    )
                    or
                    "channel"
                )

                reminder_text = (
                    reminder[
                        "message"
                    ]
                    .strip()
                )

                body = (
                    f"⏰ "
                    f"{'PERSONAL ' if mode == 'personal' else ''}"
                    f"REMINDER for {local_user}\n\n"
                    f"{reminder_text}\n\n"
                    f"Set for "
                    f"{format_due(reminder['due_ts'])}"
                )

                origin_preview = (
                    reminder.get(
                        "origin_preview"
                    )
                )

                if origin_preview:
                    body += (
                        "\n\n"
                        "↩ Source: "
                        f"{origin_preview[:240]}"
                    )

                reminder_meta = {
                    "version":
                        1,

                    "id":
                        reminder[
                            "id"
                        ],

                    "mode":
                        mode,

                    "due_ts":
                        reminder[
                            "due_ts"
                        ],

                    "text":
                        reminder_text,

                    "origin_room_id":
                        reminder.get(
                            "origin_room_id"
                        ),

                    "origin_event_id":
                        reminder.get(
                            "origin_event_id"
                        ),

                    "origin_preview":
                        origin_preview,
                }

                reply_event_id = None

                if (
                    mode ==
                        "channel" and
                    reminder.get(
                        "origin_room_id"
                    ) ==
                        reminder[
                            "room_id"
                        ] and
                    reminder.get(
                        "origin_event_id"
                    )
                ):
                    reply_event_id = (
                        reminder[
                            "origin_event_id"
                        ]
                    )

                try:
                    await self.send_text(
                        reminder[
                            "room_id"
                        ],
                        body,
                        reminder[
                            "creator_id"
                        ],
                        reply_event_id=
                            reply_event_id,
                        reminder_meta=
                            reminder_meta,
                    )

                    mark_fired(
                        reminder["id"]
                    )

                    log.info(
                        "Fired %s reminder %s",
                        mode,
                        reminder["id"],
                    )

                except Exception:
                    log.exception(
                        "Unable to fire reminder %s",
                        reminder["id"],
                    )

                    mark_retry(
                        reminder["id"]
                    )

            await asyncio.sleep(
                5
            )


async def main():
    init_db()

    client = await open_client()

    # Keep the bot profile deterministic even when
    # restoring an existing Matrix session.
    try:
        profile_response = (
            await client.set_displayname(
                "Reminder Bot"
            )
        )

        response_name = (
            profile_response
            .__class__
            .__name__
        )

        if response_name.endswith(
            "Error"
        ):
            log.warning(
                "Unable to set Reminder Bot display name: %s",
                profile_response,
            )
        else:
            log.info(
                "Reminder Bot display name confirmed"
            )

    except Exception:
        log.exception(
            "Unable to set Reminder Bot display name"
        )

    bot = ReminderBot(
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

    scheduler_task = (
        asyncio.create_task(
            bot.scheduler()
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
        signal_name: str,
    ):
        if shutdown_event.is_set():
            return

        log.info(
            "Received %s; shutting down cleanly",
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
                "Unable to install signal handler for %s",
                sig.name,
            )

    shutdown_task = (
        asyncio.create_task(
            shutdown_event.wait()
        )
    )

    log.info(
        "Starting DC Coms Reminder Bot as %s",
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
            # Surface a real sync failure rather
            # than silently treating it as shutdown.
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
        for sig in installed_signals:
            try:
                loop.remove_signal_handler(
                    sig
                )
            except Exception:
                pass

        if not shutdown_task.done():
            shutdown_task.cancel()

        scheduler_task.cancel()

        await asyncio.gather(
            shutdown_task,
            scheduler_task,
            return_exceptions=True,
        )

        try:
            await client.close()

        finally:
            log.info(
                "Reminder Bot shutdown complete"
            )


if __name__ == "__main__":
    asyncio.run(
        main()
    )
