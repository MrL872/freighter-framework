#!/usr/bin/env python3
"""dirsearch-worker is a persistent, long-running service wrapping the
dirsearch CLI -- the Python-server counterpart to the Go workers (see
subfinder-worker/main.go for the reference architecture this mirrors
exactly): GET /health, GET /status (idle/running), POST /run (validated argv
array, 409 if busy), POST /stop, GET /ws (broadcast, replays the current
run's backlog to new subscribers), runs dirsearch via subprocess.Popen with
an argv list (never shell=True), streams stdout/stderr live, and on exit
broadcasts {"type":"result","exitCode":N,"worker":"dirsearch","date":...,
"findings":[...]}.

Stdlib only -- no third-party pip dependency for this wrapper server itself
(dirsearch the TOOL is still pip-installed as before; see this directory's
Dockerfile). http.server/socketserver provide the HTTP side; the WebSocket
side is a small hand-rolled RFC 6455 implementation (server -> many browser
clients, text frames only), the same scope ws.go covers on the Go workers.

Findings: dirsearch's own JSON report is the parsing source (see
translate_findings below for exactly why). When the
caller gives no -o/--output-file, this worker appends its own
"--output-file <tmpfile> --output-formats json" and parses that report. When
the caller does give -o (the backend rewrites it into OUTPUT_DIR), that file is
the report: it is left in place for the backend to stage into Project Folder,
and findings are read from it only when it is JSON.
"""
import base64
import codecs
import hashlib
import json
import os
import selectors
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# Fixed, in-container directory an isOutput flag's value is rewritten to
# point at before a run (see the backend's own RunService/WorkerOutputStager)
# -- /output below serves files back out of this same directory once a run
# completes, for the backend to stage into the profile's real Project
# Folder. Never a path on the host; this directory lives and dies with the
# container.
OUTPUT_DIR = "/tmp/output"

STOP_GRACE_SECONDS = 5  # SIGKILL a tool that ignores SIGINT after this long
# Minimum gap between two "partial" (not-yet-newline-terminated line)
# broadcasts for the same stream -- a tool redrawing a progress bar on every
# byte would otherwise flood every connected client and the replay history
# with updates far faster than anyone can read them. Never throttles the
# frame that clears a partial back to "" (see _stream_lines), so the live
# line never visibly lags behind a run actually finishing.
PARTIAL_THROTTLE_SECONDS = 0.1
WEBSOCKET_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
OP_TEXT = 0x1
OP_CLOSE = 0x8
OP_PING = 0x9
OP_PONG = 0xA

# Whether a probed path's response status is worth a ledger finding at all,
# as opposed to noise: most of what directory/parameter fuzzing turns up at
# a 4xx/5xx is either expected (400/429/5xx -- malformed request, rate
# limiting, server trouble, not a discovery) or, for 403 specifically, just
# as likely a WAF block as an access-controlled real resource -- dropped
# here regardless, since this worker (unlike wafw00f) has no way to tell
# which. 401 and 404 are kept unconditionally: a 401 means something real is
# there behind auth, and a 404 can still leak information (a custom error
# page, a redirect chain, timing) worth a human glancing at. 2xx/3xx (an
# actual page, or a redirect to one) are always kept. A status dirsearch's
# own report didn't give as a real number at all (missing, or a placeholder
# like "-" for a request that errored out before getting a response) is
# rejected too, not kept -- there's no response to judge as a discovery in
# the first place, so defaulting to "keep" on unrelated grounds was wrong.
def keep_status(status):
    try:
        status = int(status)
    except (TypeError, ValueError):
        return False
    if 200 <= status < 400:
        return True
    return status in (401, 404)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def host_only(value):
    """Strips a URL's scheme, path, query and port so Target stays a bare
    host consistently across every worker. Falls back to the raw value if
    it doesn't parse as a URL."""
    v = (value or "").strip()
    if not v:
        return v
    candidate = v if "://" in v else "http://" + v
    try:
        hostname = urlparse(candidate).hostname
    except ValueError:
        hostname = None
    return hostname or v


def port_for(value):
    """Mirrors host_only's own URL handling: an explicit port in the URL if
    it has one, else the default for its scheme (80 for http, 443 for
    https), else 443 for a bare host with no scheme at all -- the same
    assumed-web default every scheme-less target gets."""
    v = (value or "").strip()
    if not v:
        return "443"
    has_scheme = "://" in v
    candidate = v if has_scheme else "http://" + v
    try:
        parsed = urlparse(candidate)
        port = parsed.port
    except ValueError:
        return "443"
    if port:
        return str(port)
    if not has_scheme or parsed.scheme == "https":
        return "443"
    return "80"


class WSConn:
    """One upgraded, hijacked HTTP connection speaking the WebSocket wire
    protocol directly over the underlying TCP socket -- the Python
    equivalent of ws.go's WSConn."""

    def __init__(self, sock):
        self.sock = sock
        self.write_lock = threading.Lock()
        self.closed = False

    def write_text(self, payload: bytes):
        with self.write_lock:
            try:
                self._write_frame(OP_TEXT, payload)
            except OSError:
                self.closed = True

    def _write_frame(self, opcode, payload: bytes):
        length = len(payload)
        header = bytearray()
        header.append(0x80 | opcode)  # FIN=1, single-frame messages only
        if length <= 125:
            header.append(length)
        elif length <= 65535:
            header.append(126)
            header += struct.pack(">H", length)
        else:
            header.append(127)
            header += struct.pack(">Q", length)
        self.sock.sendall(bytes(header) + payload)

    def close(self):
        if self.closed:
            return
        self.closed = True
        with self.write_lock:
            try:
                self._write_frame(OP_CLOSE, b"")
            except OSError:
                pass
        try:
            self.sock.close()
        except OSError:
            pass

    def read_loop(self):
        """Blocks reading client frames until the connection closes or a
        close frame arrives, replying to pings. Browsers watching this relay
        never send application data, only protocol-level pings/close."""
        try:
            while True:
                opcode, payload = self._read_frame()
                if opcode is None or opcode == OP_CLOSE:
                    return
                if opcode == OP_PING:
                    with self.write_lock:
                        self._write_frame(OP_PONG, payload)
        except (OSError, ConnectionError, struct.error):
            return
        finally:
            self.close()

    def _read_frame(self):
        head = self._recv_exact(2)
        if head is None:
            return None, None
        opcode = head[0] & 0x0F
        masked = (head[1] & 0x80) != 0
        length = head[1] & 0x7F
        if length == 126:
            ext = self._recv_exact(2)
            if ext is None:
                return None, None
            length = struct.unpack(">H", ext)[0]
        elif length == 127:
            ext = self._recv_exact(8)
            if ext is None:
                return None, None
            length = struct.unpack(">Q", ext)[0]
        mask_key = b""
        if masked:
            mask_key = self._recv_exact(4)
            if mask_key is None:
                return None, None
        payload = self._recv_exact(length) if length else b""
        if payload is None:
            return None, None
        if masked:
            payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        return opcode, payload

    def _recv_exact(self, n):
        if n == 0:
            return b""
        chunks = []
        remaining = n
        while remaining > 0:
            chunk = self.sock.recv(remaining)
            if not chunk:
                return None
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)


def accept_key(key: str) -> str:
    sha1 = hashlib.sha1((key + WEBSOCKET_MAGIC_GUID).encode("utf-8")).digest()
    return base64.b64encode(sha1).decode("ascii")


class Server:
    """Holds the single in-flight-run state, connected WS clients, and the
    current run's message backlog -- the Python counterpart to ws.go/main.go's
    Server struct. Only one run is ever in flight; a /run while running is
    rejected with 409 rather than queued."""

    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.process = None
        self.paused = False
        self.clients = set()
        self.clients_lock = threading.Lock()
        self.history = []
        # stream name ("stdout"/"stderr") -> index into self.history, present
        # only while that stream's latest history entry is a "partial" frame
        # (see broadcast() and _stream_lines() below) -- lets a stream's
        # continuously-redrawn progress line collapse into one history slot
        # instead of growing one entry per redraw.
        self.partial_slots = {}

    def status(self):
        with self.lock:
            return "running" if self.running else "idle"

    def reset_history(self):
        with self.clients_lock:
            self.history = []
            self.partial_slots = {}

    def history_frames(self):
        """Every frame of the in-flight or most recent run, decoded, in order."""
        with self.clients_lock:
            return [json.loads(data) for data in self.history]

    def broadcast(self, message: dict, partial: bool = False):
        """Sends message to every connected client and appends it to the
        replay history -- except a partial frame (see _stream_lines: the
        not-yet-newline-terminated tail of a stream, e.g. a progress bar
        mid-redraw) replaces that stream's last partial in place rather than
        growing the history by one entry per redraw."""
        data = json.dumps(message).encode("utf-8")
        stream = message.get("stream")
        with self.clients_lock:
            if partial and stream in self.partial_slots:
                self.history[self.partial_slots[stream]] = data
            else:
                self.partial_slots.pop(stream, None)
                self.history.append(data)
                if partial:
                    self.partial_slots[stream] = len(self.history) - 1
            dead = []
            for conn in self.clients:
                try:
                    conn.write_text(data)
                except OSError:
                    dead.append(conn)
            for conn in dead:
                self.clients.discard(conn)

    def add_client(self, conn: WSConn):
        with self.clients_lock:
            self.clients.add(conn)
            backlog = list(self.history)
        for msg in backlog:
            conn.write_text(msg)

    def remove_client(self, conn: WSConn):
        with self.clients_lock:
            self.clients.discard(conn)

    def start_run(self, args, interactive=False):
        with self.lock:
            if self.running:
                return False
            self.running = True
        self.reset_history()
        thread = threading.Thread(target=self._execute, args=(args, interactive), daemon=True)
        thread.start()
        return True

    def send_input(self, text: str) -> bool:
        """Writes one line to the running tool's stdin. False when no run accepts input."""
        with self.lock:
            proc = self.process
        if proc is None or proc.poll() is not None or proc.stdin is None:
            return False
        try:
            proc.stdin.write(text + "\n")
            proc.stdin.flush()
        except (BrokenPipeError, OSError):
            return False
        self.broadcast({"type": "input", "text": text})
        return True

    def _signal_run(self, sig):
        """Sends sig to the running tool's process group (the tool and its children). False when none."""
        proc = self.process
        if proc is None or proc.poll() is not None:
            return False
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return False
        return True

    def pause_run(self):
        """Ctrl+Z on the tool: SIGTSTP to its process group. Returns idle, paused, or ok."""
        with self.lock:
            if not self.running or self.process is None:
                return "idle"
            if self.paused:
                return "paused"
            if not self._signal_run(signal.SIGTSTP):
                return "idle"
            self.paused = True
            return "ok"

    def resume_run(self):
        """fg on the tool: SIGCONT to its process group. Returns idle, running, or ok."""
        with self.lock:
            if not self.running or self.process is None:
                return "idle"
            if not self.paused:
                return "running"
            if not self._signal_run(signal.SIGCONT):
                return "idle"
            self.paused = False
            return "ok"

    def stop_run(self):
        """Ctrl+C on the tool: continue it if it is stopped (fg), then SIGINT. The worker
        stays up and goes idle once the tool exits. SIGKILL is the fallback after
        STOP_GRACE_SECONDS. False when no run is in progress."""
        with self.lock:
            proc = self.process
            if not self.running or proc is None:
                return False
            self._signal_run(signal.SIGCONT)
            self.paused = False
            self._signal_run(signal.SIGINT)
        threading.Timer(STOP_GRACE_SECONDS, self._kill_if_alive, args=(proc,)).start()
        return True

    def _kill_if_alive(self, proc):
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def _execute(self, args, interactive=False):
        """Runs dirsearch to completion (or termination), streaming
        stdout/stderr live, then parses the forced JSON report
        (see module docstring) into ledger findings before broadcasting the
        final result frame and returning to idle."""
        # A caller's -o/--output-file is the run's report: it is kept, so the
        # backend can stage it into Project Folder, and findings are read from it
        # when it is JSON. Without one, the worker writes its own JSON report to a
        # temp file and removes it afterwards.
        caller_report = caller_report_path(args)
        if caller_report:
            report_path = caller_report
            full_args = ["dirsearch"] + list(args)
        else:
            result_fd, report_path = tempfile.mkstemp(prefix="dirsearch-result-", suffix=".json")
            os.close(result_fd)
            full_args = ["dirsearch"] + list(args) + ["--output-file", report_path, "--output-formats", "json"]

        exit_code = -1
        try:
            proc = subprocess.Popen(
                full_args,
                stdin=subprocess.PIPE if interactive else subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                preexec_fn=os.setpgrp,
            )
            with self.lock:
                self.process = proc

            threads = [
                threading.Thread(target=self._stream_lines, args=(proc.stdout, "stdout"), daemon=True),
                threading.Thread(target=self._stream_lines, args=(proc.stderr, "stderr"), daemon=True),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            exit_code = proc.wait()
        except FileNotFoundError as e:
            self.broadcast({"type": "error", "message": f"failed to start dirsearch: {e}"})
        except OSError as e:
            self.broadcast({"type": "error", "message": f"failed to start dirsearch: {e}"})
        finally:
            findings = translate_findings(report_path)
            if not caller_report:
                try:
                    os.remove(report_path)
                except OSError:
                    pass
            self.broadcast({
                "type": "result",
                "exitCode": exit_code,
                "worker": "dirsearch",
                "date": now_iso(),
                "findings": findings,
            })
            with self.lock:
                self.running = False
                self.process = None
                self.paused = False

    def _stream_lines(self, pipe, stream_name):
        """Streams pipe (the tool's stdout or stderr) to every connected client live.

        This reads raw chunks off the pipe's file descriptor instead of using
        readline(), for two reasons found by tracing dirsearch's actual output
        when its stdout isn't a tty (as a subprocess pipe never is): its progress
        bar writes successive updates with no separator at all -- no '\\r', no
        '\\n' -- so readline() (which only ever returns at a '\\n') would just
        block silently accumulating the entire scan's progress spam, then dump
        it as one giant "line" the moment the next real newline (e.g. the final
        banner line) finally arrived. That produced both reported symptoms at
        once: the feed freezing for the whole scan, then bursting; and, on
        tools that DO use a bare '\\r' to redraw a line, extra blank-looking
        broadcasts, since Python's own universal-newlines readline() treats a
        bare '\\r' as a line boundary too and broadcasts whatever (often
        whitespace) sat between two redraws as its own "line".

        Each chunk is scanned for '\\n' (a finished line -- broadcast as
        "line", permanent) and '\\r' (an in-place overwrite -- the text before
        it is discarded, exactly like a real terminal's cursor return, not
        broadcast at all). Whatever's left after the last boundary is the
        current, still-growing line; it's broadcast as "partial" so the
        frontend can show it updating live (e.g. a ticking percentage)
        instead of only ever seeing finished lines.
        """
        if pipe is None:
            return
        fd = pipe.fileno()
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        buf = ""
        last_partial = None
        last_emit = 0.0

        def flush_partial(force=False):
            nonlocal last_partial, last_emit
            # A trailing '\r' here is still ambiguous (the loop below left it
            # for the next chunk to resolve, in case it turns out to be half
            # of a split '\r\n') -- hide it from what's displayed so a bare
            # carriage return never flashes as visible text while we wait to
            # find out.
            display = buf[:-1] if buf.endswith("\r") else buf
            if display == last_partial:
                return
            now = time.monotonic()
            if not force and display and (now - last_emit) < PARTIAL_THROTTLE_SECONDS:
                return
            self.broadcast({"type": "partial", "stream": stream_name, "text": display}, partial=True)
            last_partial = display
            last_emit = now

        # dirsearch's own progress bar redraws with no '\r' and no '\n' at
        # all when stdout isn't a tty (confirmed by capturing its raw output
        # directly, bypassing this wrapper entirely) -- every redraw just
        # starts a fresh "[<bar>] N% ..." immediately after the previous
        # one's text, with nothing separating them. Without recognizing
        # that, those redraws (plus whatever real line eventually follows
        # them before the next '\n') all pile up as one giant, heavily
        # duplicated blob: the same request count repeated verbatim several
        # times in a row, since the redraw timer fires faster than the
        # count actually increments. A bare '[' after the start of the
        # buffer is treated as an implicit reset -- the same discard-and-
        # keep-going '\r' already gets below -- since it's always the start
        # of a fresh redraw here. Scoped to stdout only (stderr has no such
        # convention) and to this worker specifically: it is not a safe
        # general rule for other tools' output, which may contain a '['
        # as genuine content rather than a progress-bar marker.
        bracket_resets = stream_name == "stdout"
        try:
            while True:
                chunk = os.read(fd, 4096)
                if not chunk:
                    break
                buf += decoder.decode(chunk)
                while True:
                    nl = buf.find("\n")
                    cr = buf.find("\r")
                    br = buf.find("[", 1) if bracket_resets else -1
                    if nl == -1 and cr == -1 and br == -1:
                        break
                    earliest = min(x for x in (nl, cr, br) if x != -1)
                    if br == earliest:
                        buf = buf[br:]  # discard the stale redraw before this fresh one; keep the '[' itself
                        continue
                    if cr == earliest:
                        if cr == len(buf) - 1:
                            break  # might be a \r\n split across reads -- wait for the rest
                        if buf[cr + 1] == "\n":
                            line, buf = buf[:cr], buf[cr + 2:]
                        else:
                            buf = buf[cr + 1:]  # bare \r: discard what it overwrote, not a line
                            continue
                    else:
                        line, buf = buf[:nl], buf[nl + 1:]
                    self.broadcast({"type": "line", "stream": stream_name, "text": line})
                    last_partial = None
                flush_partial()
        except (OSError, ValueError):
            pass
        finally:
            buf += decoder.decode(b"", final=True)
            # A trailing bare '\r' reset is still meaningful even here at EOF
            # (the tool's last write before closing its pipe is often exactly
            # this, e.g. a final unresolved progress-bar redraw) -- keep only
            # what follows the last one, same as the loop above, instead of
            # dumping the whole accumulated-and-overwritten buffer as one
            # garbled line.
            if "\r" in buf:
                buf = buf.rsplit("\r", 1)[1]
            if buf:
                self.broadcast({"type": "line", "stream": stream_name, "text": buf})
            self.broadcast({"type": "partial", "stream": stream_name, "text": ""}, partial=True)
            try:
                pipe.close()
            except OSError:
                pass


def caller_report_path(args):
    """The value of the last -o/--output-file in argv, or None (argparse's last-flag-wins)."""
    path = None
    for i, arg in enumerate(args):
        if arg in ("-o", "--output-file") and i + 1 < len(args):
            path = args[i + 1]
    return path


def translate_findings(result_path):
    """Parses dirsearch's JSON report (--output-formats json) into ledger findings. That
    report's schema (maurosoria/dirsearch) is a top-level object whose
    "results" key maps each scanned target URL to a list of found-path
    entries (each with at least "status", "path"/"url", and usually
    "contentLength"/"content-length"/"redirect"). Rather than hard-coupling
    to that exact nesting (which has shifted across dirsearch releases),
    this walks the parsed JSON for any list of dict entries that look like a
    found-path record (a dict containing a "status" key), which is robust to
    the top-level report being either dict-of-lists or a flat list.

    One entry is one finding -- one discovered path is one vulnerability,
    full stop. (An earlier version of this function collapsed entries that
    shared the same (status, content length) into one grouped finding, to
    avoid spamming the ledger when --recursive chases the same boilerplate
    error page to dozens of guessed paths; that traded "one path = one
    vulnerability" for fewer rows, which is the wrong tradeoff, so it's
    gone.) keep_status below is what actually controls the dozens-of-rows
    case now: most of what a custom error page redirect loop generates is
    repeated 403/429/5xx noise, which never becomes a finding at all.
    """
    findings = []
    try:
        with open(result_path, "r", encoding="utf-8") as f:
            report = json.load(f)
    except (OSError, ValueError):
        return findings

    now = now_iso()

    def visit(node):
        if isinstance(node, list):
            for item in node:
                if isinstance(item, dict) and "status" in item:
                    add_finding(item)
                else:
                    visit(item)
        elif isinstance(node, dict):
            for value in node.values():
                visit(value)

    def add_finding(entry):
        status = entry.get("status")
        if not keep_status(status):
            return
        url = entry.get("url") or entry.get("path") or ""
        length = entry.get("contentLength", entry.get("content-length", entry.get("length", "")))
        description = f"HTTP {status}, {length} bytes" if length != "" else f"HTTP {status}"
        findings.append({
            "severity": "medium",
            "target": host_only(url),
            "path": url,
            "port": port_for(url),
            "statusCode": status,
            "title": "Path discovered",
            "description": description,
            "remediation": "",
            "worker": "dirsearch",
            "date": now,
        })

    visit(report)
    return findings


class Handler(BaseHTTPRequestHandler):
    server_version = "dirsearch-worker/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

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
        elif self.path == "/status":
            self._write_json(200, {"state": self.server.app.status()})
        elif self.path == "/history":
            self._write_json(200, {"frames": self.server.app.history_frames()})
        elif self.path.startswith("/output"):
            self._handle_output()
        elif self.path.startswith("/ws"):
            self._handle_ws()
        else:
            self._write_json(404, {"error": "not found"})

    def _handle_output(self):
        """Serves a file out of OUTPUT_DIR back to the backend after a run
        completes (see this tool's RunService.collectOutputs() on the backend
        side) -- the one place this worker's filesystem is read from outside
        the process that wrote to it. `name` is never trusted as a path:
        only its basename is used, so a crafted "../" can't escape
        OUTPUT_DIR."""
        query = parse_qs(urlparse(self.path).query)
        name = (query.get("name") or [""])[0]
        safe_name = os.path.basename(name) if name else ""
        if not safe_name or safe_name in (".", ".."):
            self._write_json(400, {"error": "name is required"})
            return
        path = os.path.join(OUTPUT_DIR, safe_name)
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            self._write_json(404, {"error": "no such output file"})
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path == "/run":
            self._handle_run()
        elif self.path == "/pause":
            self._handle_pause()
        elif self.path == "/resume":
            self._handle_resume()
        elif self.path == "/stop":
            self._handle_stop()
        elif self.path == "/input":
            self._handle_input()
        else:
            self._write_json(404, {"error": "not found"})

    def _handle_run(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > (1 << 20):
            self._write_json(400, {"error": "invalid JSON body"})
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw)
        except ValueError:
            self._write_json(400, {"error": "invalid JSON body"})
            return
        args = body.get("args")
        if not isinstance(args, list) or not args or not all(isinstance(a, str) for a in args):
            self._write_json(400, {"error": "args is required"})
            return
        started = self.server.app.start_run(args, body.get("interactive") is True)
        if not started:
            self._write_json(409, {"error": "already running"})
            return
        self._write_json(202, {"state": "running"})

    def _handle_input(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > (64 << 10):
            self._write_json(400, {"error": "body must be {\"text\": \"...\"}"})
            return
        try:
            text = json.loads(self.rfile.read(length)).get("text")
        except (ValueError, AttributeError):
            text = None
        if not isinstance(text, str):
            self._write_json(400, {"error": "body must be {\"text\": \"...\"}"})
            return
        if not self.server.app.send_input(text):
            self._write_json(409, {"error": "no run is accepting input"})
            return
        self._write_json(200, {"state": "sent"})

    def _discard_body(self):
        """Reads and drops the request body. Left unread, it would be parsed as the next request on this keep-alive connection."""
        length = int(self.headers.get("Content-Length", "0") or "0")
        if 0 < length <= (64 << 10):
            self.rfile.read(length)

    def _handle_pause(self):
        self._discard_body()
        result = self.server.app.pause_run()
        if result != "ok":
            self._write_json(409, {"error": "already paused" if result == "paused" else "job is not running"})
            return
        self._write_json(200, {"state": "paused"})

    def _handle_resume(self):
        self._discard_body()
        result = self.server.app.resume_run()
        if result != "ok":
            self._write_json(409, {"error": "not paused" if result == "running" else "job is not running"})
            return
        self._write_json(200, {"state": "running"})

    def _handle_stop(self):
        self._discard_body()
        stopped = self.server.app.stop_run()
        if not stopped:
            self._write_json(409, {"error": "idle"})
            return
        self._write_json(200, {"state": "stopping"})

    def _handle_ws(self):
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self._write_json(400, {"error": "missing Sec-WebSocket-Key"})
            return
        accept = accept_key(key)
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        )
        self.wfile.write(response.encode("utf-8"))
        self.connection.settimeout(None)
        conn = WSConn(self.connection)
        self.server.app.add_client(conn)
        try:
            conn.read_loop()
        finally:
            self.server.app.remove_client(conn)
        # Signal http.server's request-handling loop that this connection is
        # done -- it was hijacked above for raw WebSocket framing, so no
        # further HTTP requests will ever arrive on it.
        self.close_connection = True


class App(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr):
        super().__init__(addr, Handler)
        self.app = Server()


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    port = int(os.environ.get("DIRSEARCH_WORKER_PORT", "8080"))
    httpd = App(("0.0.0.0", port))

    def handle_signal(signum, frame):
        print("shutting down", file=sys.stderr)
        httpd.app.stop_run()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    print(f"dirsearch-worker listening on :{port}", file=sys.stderr)
    httpd.serve_forever()
    httpd.server_close()


if __name__ == "__main__":
    main()
