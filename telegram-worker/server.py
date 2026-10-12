#!/usr/bin/env python3
"""telegram-worker is a thin forwarding proxy to the Telegram Bot API. Unlike
every other worker in this repo it does not wrap a security tool -- it is the
one container with a route to the internet for this purpose, so that the
backend (whose own networks have no route to the internet, see
docker-compose.yml) can still deliver a Telegram message without dialing out
itself.

The backend's TelegramClient.java builds the exact request it would have sent
straight to api.telegram.org -- method POST, path "/bot<token>/sendDocument",
a multipart body -- and sends it here instead (settings.telegram-api-base
points at this container in the docker profile). This worker forwards that
request byte-for-byte to TELEGRAM_API_BASE at the same path and relays the
upstream response back unchanged, so TelegramClient needed no other changes.

Stdlib only. Only paths shaped like the Bot API's own ("/bot<token>/<method>")
are forwarded, so this container can't become a general-purpose relay to
other hosts or paths even though it is network-reachable from the backend.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TELEGRAM_API_BASE = os.environ.get("TELEGRAM_API_BASE", "https://api.telegram.org").rstrip("/")
# A bit over TelegramClient's own 60s request timeout, so it times out first.
REQUEST_TIMEOUT_SECONDS = 65
# A bit over SettingsController.MAX_OUTPUT_BYTES (2 MB), to leave room for multipart overhead.
MAX_BODY_BYTES = 2 * 1024 * 1024 + 4096

PATH_RE = re.compile(r"^/bot[^/]+/[A-Za-z]+$")
# No anchors: this runs against a whole log line (e.g. '"POST /bot123:ABC/sendDocument HTTP/1.1" 200 -'),
# not a bare path, so the token has text on both sides.
TOKEN_RE = re.compile(r"/bot[^/\s]+/")


def redact(message: str) -> str:
    """Drops any bot token out of a message before it is ever logged."""
    return TOKEN_RE.sub("/bot[token]/", message)


class Handler(BaseHTTPRequestHandler):
    server_version = "telegram-worker/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), redact(fmt % args)))

    def _write_json(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._write_json(200, {"status": "ok"})
        else:
            self._write_json(404, {"error": "not found"})

    def do_POST(self):
        if not PATH_RE.match(self.path):
            self._write_json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > MAX_BODY_BYTES:
            self._write_json(400, {"ok": False, "description": "request body too large"})
            return
        body = self.rfile.read(length) if length else b""
        content_type = self.headers.get("Content-Type", "application/octet-stream")

        request = urllib.request.Request(
            TELEGRAM_API_BASE + self.path,
            data=body,
            method="POST",
            headers={"Content-Type": content_type},
        )
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                self._relay(resp.status, resp.read(), resp.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as e:
            self._relay(e.code, e.read(), e.headers.get("Content-Type", "application/json") if e.headers else "application/json")
        except (urllib.error.URLError, TimeoutError) as e:
            self._write_json(502, {"ok": False, "description": f"Telegram is unreachable: {e}"})

    def _relay(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class App(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    port = int(os.environ.get("TELEGRAM_WORKER_PORT", "8080"))
    httpd = App(("0.0.0.0", port), Handler)
    print(f"telegram-worker listening on :{port}, forwarding to {TELEGRAM_API_BASE}", file=sys.stderr)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
