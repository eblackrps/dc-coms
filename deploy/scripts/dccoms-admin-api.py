#!/usr/bin/env python3

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 8010
SYNAPSE = "http://127.0.0.1:8008"

MAX_BODY = 8192


class Handler(BaseHTTPRequestHandler):
    server_version = "DCComsAdminAPI/1.0"

    def log_message(self, fmt, *args):
        print(
            "%s - %s" %
            (self.address_string(), fmt % args),
            flush=True,
        )

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")

        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json",
        )
        self.send_header(
            "Content-Length",
            str(len(body)),
        )
        self.send_header(
            "Cache-Control",
            "no-store",
        )
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(
                200,
                {"status": "ok"},
            )
            return

        self.send_json(
            404,
            {"error": "not_found"},
        )

    def do_POST(self):
        if self.path != "/api/admin/delete-room":
            self.send_json(
                404,
                {"error": "not_found"},
            )
            return

        authorization = self.headers.get(
            "Authorization",
            "",
        )

        if not authorization.startswith("Bearer "):
            self.send_json(
                401,
                {
                    "error": "missing_authorization",
                    "message":
                        "Matrix authorization required.",
                },
            )
            return

        try:
            length = int(
                self.headers.get(
                    "Content-Length",
                    "0",
                )
            )
        except ValueError:
            length = 0

        if length <= 0 or length > MAX_BODY:
            self.send_json(
                400,
                {"error": "invalid_body"},
            )
            return

        try:
            payload = json.loads(
                self.rfile.read(length)
            )
        except Exception:
            self.send_json(
                400,
                {"error": "invalid_json"},
            )
            return

        room_id = payload.get("roomId")

        if (
            not isinstance(room_id, str)
            or not room_id.startswith("!")
            or len(room_id) > 512
        ):
            self.send_json(
                400,
                {
                    "error": "invalid_room_id",
                    "message":
                        "A valid Matrix room ID is required.",
                },
            )
            return

        encoded_room = quote(
            room_id,
            safe="",
        )

        url = (
            f"{SYNAPSE}"
            f"/_synapse/admin/v2/rooms/"
            f"{encoded_room}"
        )

        delete_body = json.dumps({
            "block": True,
            "purge": True,
        }).encode("utf-8")

        request = Request(
            url,
            data=delete_body,
            method="DELETE",
            headers={
                "Authorization": authorization,
                "Content-Type": "application/json",
            },
        )

        try:
            with urlopen(
                request,
                timeout=30,
            ) as response:
                raw = response.read()

                try:
                    result = json.loads(raw)
                except Exception:
                    result = {
                        "raw":
                            raw.decode(
                                "utf-8",
                                errors="replace",
                            )
                    }

                self.send_json(
                    response.status,
                    result,
                )

        except HTTPError as exc:
            raw = exc.read()

            try:
                result = json.loads(raw)
            except Exception:
                result = {
                    "error": "synapse_error",
                    "message":
                        raw.decode(
                            "utf-8",
                            errors="replace",
                        ),
                }

            self.send_json(
                exc.code,
                result,
            )

        except URLError as exc:
            self.send_json(
                502,
                {
                    "error": "synapse_unavailable",
                    "message": str(exc),
                },
            )

        except Exception as exc:
            self.send_json(
                500,
                {
                    "error": "internal_error",
                    "message": str(exc),
                },
            )


if __name__ == "__main__":
    server = ThreadingHTTPServer(
        (LISTEN_HOST, LISTEN_PORT),
        Handler,
    )

    print(
        f"DC Coms admin API listening on "
        f"{LISTEN_HOST}:{LISTEN_PORT}",
        flush=True,
    )

    server.serve_forever()
