#!/usr/bin/env python3

import json
import os
import shutil
import socket
import subprocess
import time

from datetime import (
    datetime,
    timezone,
)

from http.server import (
    BaseHTTPRequestHandler,
    ThreadingHTTPServer,
)

from pathlib import Path


TOKEN = os.environ[
    "DCOPS_COLLECTOR_TOKEN"
]

HOST = "127.0.0.1"
PORT = 8012

BACKUP_DIR = Path(
    "/data/dccoms/backups"
)

SERVICES = [
    "dccoms-synapse.service",
    "dccoms-postgres.service",
    "dccoms-reminder-bot.service",
    "dccoms-admin-api.service",
    "dccoms-reset-api.service",
    "nginx.service",
    "dccoms-db-backup.timer",
    "dccoms-storage-check.timer",
]

EXPECTED_CONTAINERS = [
    "dccoms-postgres",
    "dccoms-synapse",
    "dccoms-reminder-bot",
]


def run_command(
    args,
    timeout=8,
):
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )

        return {
            "returncode":
                result.returncode,

            "stdout":
                result.stdout.strip(),

            "stderr":
                result.stderr.strip(),
        }

    except Exception as exc:
        return {
            "returncode": 255,
            "stdout": "",
            "stderr": str(exc),
        }


def human_bytes(
    value,
):
    value = float(value)

    for unit in (
        "B",
        "KiB",
        "MiB",
        "GiB",
        "TiB",
    ):
        if value < 1024:
            return (
                f"{value:.1f} {unit}"
            )

        value /= 1024

    return (
        f"{value:.1f} PiB"
    )


def read_meminfo():
    values = {}

    with open(
        "/proc/meminfo",
        "r",
        encoding="utf-8",
    ) as handle:

        for line in handle:
            key, rest = (
                line.split(
                    ":",
                    1,
                )
            )

            number = (
                rest.strip()
                .split()[0]
            )

            values[key] = (
                int(number) * 1024
            )

    return values


def memory_payload():
    mem = read_meminfo()

    total = mem.get(
        "MemTotal",
        0,
    )

    available = mem.get(
        "MemAvailable",
        0,
    )

    used = max(
        0,
        total - available,
    )

    swap_total = mem.get(
        "SwapTotal",
        0,
    )

    swap_free = mem.get(
        "SwapFree",
        0,
    )

    swap_used = max(
        0,
        swap_total - swap_free,
    )

    used_percent = (
        round(
            used /
            total *
            100,
            1,
        )
        if total
        else 0
    )

    return {
        "total_bytes":
            total,

        "used_bytes":
            used,

        "available_bytes":
            available,

        "used_percent":
            used_percent,

        "total":
            human_bytes(total),

        "used":
            human_bytes(used),

        "available":
            human_bytes(
                available
            ),

        "swap_total":
            human_bytes(
                swap_total
            ),

        "swap_used":
            human_bytes(
                swap_used
            ),
    }


def disk_info(
    path,
):
    usage = shutil.disk_usage(
        path
    )

    percent = (
        round(
            usage.used /
            usage.total *
            100,
            1,
        )
        if usage.total
        else 0
    )

    return {
        "path":
            path,

        "total_bytes":
            usage.total,

        "used_bytes":
            usage.used,

        "free_bytes":
            usage.free,

        "used_percent":
            percent,

        "total":
            human_bytes(
                usage.total
            ),

        "used":
            human_bytes(
                usage.used
            ),

        "free":
            human_bytes(
                usage.free
            ),
    }


def disk_payload():
    mounts = {}

    for path in (
        "/",
        "/data",
        "/boot",
    ):
        if Path(path).exists():
            mounts[path] = (
                disk_info(path)
            )

    backup_bytes = 0

    if BACKUP_DIR.exists():
        backup_bytes = sum(
            item.stat().st_size
            for item in
            BACKUP_DIR.glob(
                "synapse-*.dump"
            )
            if item.is_file()
        )

    return {
        "mounts":
            mounts,

        "backup_storage":
            human_bytes(
                backup_bytes
            ),
    }


def server_payload():
    try:
        uptime_seconds = int(
            float(
                Path(
                    "/proc/uptime"
                )
                .read_text()
                .split()[0]
            )
        )

    except Exception:
        uptime_seconds = 0

    load1, load5, load15 = (
        os.getloadavg()
    )

    return {
        "hostname":
            socket.getfqdn(),

        "cpu_count":
            os.cpu_count() or 1,

        "uptime_seconds":
            uptime_seconds,

        "uptime_days":
            round(
                uptime_seconds /
                86400,
                2,
            ),

        "load":
            {
                "1m":
                    round(
                        load1,
                        2,
                    ),

                "5m":
                    round(
                        load5,
                        2,
                    ),

                "15m":
                    round(
                        load15,
                        2,
                    ),
            },

        "memory":
            memory_payload(),

        "timestamp":
            datetime.now(
                timezone.utc
            ).isoformat(),
    }


def services_payload():
    rows = []

    for unit in SERVICES:
        result = run_command(
            [
                "/usr/bin/systemctl",
                "is-active",
                unit,
            ]
        )

        state = (
            result["stdout"]
            or "unknown"
        )

        rows.append({
            "unit":
                unit,

            "state":
                state,
        })

    return {
        "services":
            rows,
    }


def containers_payload():
    managed = [
        (
            "dccoms-postgres",
            "dccoms-postgres.service",
        ),
        (
            "dccoms-synapse",
            "dccoms-synapse.service",
        ),
        (
            "dccoms-reminder-bot",
            "dccoms-reminder-bot.service",
        ),
    ]

    active = []
    inactive = []

    for (
        name,
        unit,
    ) in managed:

        result = run_command(
            [
                "/usr/bin/systemctl",
                "is-active",
                unit,
            ]
        )

        state = (
            result["stdout"]
            or "unknown"
        )

        row = {
            "name":
                name,

            "unit":
                unit,

            "state":
                state,

            "status":
                (
                    "Up"
                    if state == "active"
                    else state
                ),

            "source":
                "systemd",
        }

        if state == "active":
            active.append(
                row
            )
        else:
            inactive.append(
                row
            )

    return {
        "containers":
            active,

        "inactive":
            inactive,

        "error":
            "",
    }
def backup_payload():
    files = []

    if BACKUP_DIR.exists():
        files = sorted(
            (
                item
                for item in
                BACKUP_DIR.glob(
                    "synapse-*.dump"
                )
                if item.is_file()
            ),
            key=lambda item:
                item.stat().st_mtime,
        )

    if not files:
        return {
            "count": 0,
            "latest": None,
            "total_bytes": 0,
            "total": "0 B",
        }

    latest = files[-1]

    stat = latest.stat()

    age_seconds = max(
        0,
        time.time() -
        stat.st_mtime,
    )

    total_bytes = sum(
        item.stat().st_size
        for item in files
    )

    return {
        "count":
            len(files),

        "total_bytes":
            total_bytes,

        "total":
            human_bytes(
                total_bytes
            ),

        "latest":
            {
                "name":
                    latest.name,

                "size_bytes":
                    stat.st_size,

                "size":
                    human_bytes(
                        stat.st_size
                    ),

                "modified":
                    datetime.fromtimestamp(
                        stat.st_mtime,
                        timezone.utc,
                    ).isoformat(),

                "age_hours":
                    round(
                        age_seconds /
                        3600,
                        2,
                    ),
            },
    }


def top_payload():
    cpu = run_command(
        [
            "/usr/bin/ps",
            "-eo",
            "pid=,comm=,%cpu=,%mem=",
            "--sort=-%cpu",
        ]
    )

    memory = run_command(
        [
            "/usr/bin/ps",
            "-eo",
            "pid=,comm=,%cpu=,%mem=",
            "--sort=-%mem",
        ]
    )

    def parse(
        value,
    ):
        rows = []

        for line in (
            value
            .splitlines()[:6]
        ):
            parts = (
                line.split(
                    None,
                    3,
                )
            )

            if len(parts) != 4:
                continue

            rows.append({
                "pid":
                    parts[0],

                "command":
                    parts[1],

                "cpu":
                    parts[2],

                "memory":
                    parts[3],
            })

        return rows

    return {
        "cpu":
            parse(
                cpu["stdout"]
            ),

        "memory":
            parse(
                memory["stdout"]
            ),
    }


def health_payload():
    server = (
        server_payload()
    )

    disks = (
        disk_payload()
    )

    services = (
        services_payload()
    )

    containers = (
        containers_payload()
    )

    backup = (
        backup_payload()
    )

    issues = []

    def issue(
        severity,
        item,
        detail,
    ):
        issues.append({
            "severity":
                severity,

            "item":
                item,

            "detail":
                detail,
        })

    for path in (
        "/",
        "/data",
    ):
        disk = (
            disks[
                "mounts"
            ].get(path)
        )

        if not disk:
            issue(
                "critical",
                path,
                "filesystem unavailable",
            )

            continue

        percent = (
            disk[
                "used_percent"
            ]
        )

        if percent >= 90:
            issue(
                "critical",
                path,
                f"{percent}% used",
            )

        elif percent >= 80:
            issue(
                "warning",
                path,
                f"{percent}% used",
            )

    mem_percent = (
        server[
            "memory"
        ][
            "used_percent"
        ]
    )

    if mem_percent >= 95:
        issue(
            "critical",
            "memory",
            f"{mem_percent}% used",
        )

    elif mem_percent >= 85:
        issue(
            "warning",
            "memory",
            f"{mem_percent}% used",
        )

    load5 = (
        server[
            "load"
        ][
            "5m"
        ]
    )

    cpus = (
        server[
            "cpu_count"
        ]
    )

    if load5 >= (
        cpus * 2.5
    ):
        issue(
            "critical",
            "load",
            (
                f"5m load "
                f"{load5} "
                f"on {cpus} CPUs"
            ),
        )

    elif load5 >= (
        cpus * 1.5
    ):
        issue(
            "warning",
            "load",
            (
                f"5m load "
                f"{load5} "
                f"on {cpus} CPUs"
            ),
        )

    for row in (
        services[
            "services"
        ]
    ):
        if (
            row["state"]
            != "active"
        ):
            issue(
                "critical",
                row["unit"],
                row["state"],
            )

    running = {
        row["name"]
        for row in
        containers[
            "containers"
        ]
        if (
            row.get(
                "state"
            ) ==
            "active"
        )
    }

    for name in (
        EXPECTED_CONTAINERS
    ):
        if name not in running:
            issue(
                "critical",
                name,
                "container not running",
            )

    latest = (
        backup.get(
            "latest"
        )
    )

    if not latest:
        issue(
            "critical",
            "backup",
            "no Synapse backup found",
        )

    else:
        age = (
            latest[
                "age_hours"
            ]
        )

        if age >= 48:
            issue(
                "critical",
                "backup",
                (
                    f"latest backup "
                    f"{age}h old"
                ),
            )

        elif age >= 30:
            issue(
                "warning",
                "backup",
                (
                    f"latest backup "
                    f"{age}h old"
                ),
            )

    severities = {
        row["severity"]
        for row in issues
    }

    if "critical" in severities:
        status = "critical"

    elif "warning" in severities:
        status = "warning"

    else:
        status = "healthy"

    return {
        "status":
            status,

        "issues":
            issues,

        "server":
            server,

        "disk":
            disks,

        "services":
            services,

        "containers":
            containers,

        "backup":
            backup,
    }


ROUTES = {
    "/v1/health":
        health_payload,

    "/v1/server":
        server_payload,

    "/v1/disk":
        disk_payload,

    "/v1/services":
        services_payload,

    "/v1/containers":
        containers_payload,

    "/v1/backup":
        backup_payload,

    "/v1/top":
        top_payload,
}


class Handler(
    BaseHTTPRequestHandler
):
    server_version = (
        "DCComsOps/1.0"
    )

    def send_json(
        self,
        status,
        payload,
    ):
        data = json.dumps(
            payload,
            separators=(
                ",",
                ":",
            ),
        ).encode(
            "utf-8"
        )

        self.send_response(
            status
        )

        self.send_header(
            "Content-Type",
            "application/json",
        )

        self.send_header(
            "Cache-Control",
            "no-store",
        )

        self.send_header(
            "Content-Length",
            str(
                len(data)
            ),
        )

        self.end_headers()

        self.wfile.write(
            data
        )

    def do_GET(
        self,
    ):
        expected = (
            f"Bearer {TOKEN}"
        )

        supplied = (
            self.headers.get(
                "Authorization",
                "",
            )
        )

        if supplied != expected:
            self.send_json(
                403,
                {
                    "error":
                        "forbidden",
                },
            )

            return

        handler = (
            ROUTES.get(
                self.path
            )
        )

        if not handler:
            self.send_json(
                404,
                {
                    "error":
                        "not found",
                },
            )

            return

        try:
            self.send_json(
                200,
                handler(),
            )

        except Exception as exc:
            self.send_json(
                500,
                {
                    "error":
                        str(exc),
                },
            )

    def log_message(
        self,
        fmt,
        *args,
    ):
        return


def main():
    server = (
        ThreadingHTTPServer(
            (
                HOST,
                PORT,
            ),
            Handler,
        )
    )

    print(
        (
            "DC Ops collector "
            f"listening on "
            f"{HOST}:{PORT}"
        ),
        flush=True,
    )

    server.serve_forever()


if __name__ == "__main__":
    main()
