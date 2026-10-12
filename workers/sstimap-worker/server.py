#!/usr/bin/env python3
"""sstimap-worker is a persistent, long-running service wrapping the
sstimap CLI (https://github.com/vladko312/SSTImap) -- the Python-server
counterpart to the Go workers (see ../subfinder-worker/main.go for the
reference architecture this mirrors exactly): GET /health, GET /status
(idle/running), POST /run (validated argv array, 409 if busy), POST /stop,
GET /ws (broadcast, replays the current run's backlog to new subscribers),
runs sstimap via subprocess.Popen with an argv list (never shell=True),
streams stdout/stderr live, and on exit broadcasts
{"type":"result","exitCode":N,"worker":"sstimap","date":...,"findings":[...]}.

Stdlib only -- no third-party pip dependency for this wrapper server itself
(sstimap the TOOL is still pip/git-installed separately; see this
directory's Dockerfile). http.server provides the HTTP side; the WebSocket
side is a small hand-rolled RFC 6455 implementation (server -> many browser
clients, text frames only), the same scope ws.go covers on the Go workers.

Findings: sstimap has no single structured report file to force onto the
command line without fighting whatever flags the caller already chose.
translate_findings below instead does the same best-effort regex scrape over
the collected output lines that masscan-worker's Go code (main.go's
translateFindings) does over masscan's own plain-text output -- a documented
heuristic, not a structured parse.
"""
import base64
import codecs
import hashlib
import json
import os
import re
import selectors
import signal
import socket
import struct
import subprocess
import sys
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

# A small, documented heuristic (mirrors nmap-worker's wellKnownRiskyPorts):
# 2xx/3xx are informational (a page/redirect exists), 401/403 are "low" (an
# access-controlled path was still discovered), 5xx are "medium" (server
# error surfaced by probing). Anything else falls back to "info". This is a
# coarse triage hint, not a real vulnerability assessment.
def severity_for_status(status):
    try:
        status = int(status)
    except (TypeError, ValueError):
        return "info"
    if status in (401, 403):
        return "low"
    if 500 <= status < 600:
        return "medium"
    return "info"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


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
        """Runs sstimap to completion (or termination), streaming
        stdout/stderr live, collecting every line for translate_findings
        (see its own docstring for why this is regex-based rather than a
        structured report parse), then broadcasting the final result frame
        and returning to idle."""
        full_args = ["sstimap"] + list(args)
        lines = []
        lines_lock = threading.Lock()

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
                threading.Thread(target=self._stream_lines, args=(proc.stdout, "stdout", lines, lines_lock), daemon=True),
                threading.Thread(target=self._stream_lines, args=(proc.stderr, "stderr", lines, lines_lock), daemon=True),
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            exit_code = proc.wait()
        except FileNotFoundError as e:
            self.broadcast({"type": "error", "message": f"failed to start sstimap: {e}"})
        except OSError as e:
            self.broadcast({"type": "error", "message": f"failed to start sstimap: {e}"})
        finally:
            findings = translate_findings(lines, args)
            self.broadcast({
                "type": "result",
                "exitCode": exit_code,
                "worker": "sstimap",
                "date": now_iso(),
                "findings": findings,
            })
            with self.lock:
                self.running = False
                self.process = None
                self.paused = False

    def _stream_lines(self, pipe, stream_name, lines, lines_lock):
        """Streams pipe (the tool's stdout or stderr) to every connected client live.

        This reads raw chunks off the pipe's file descriptor instead of using
        readline(), which only ever returns at a '\n': some tools, when their
        stdout isn't a tty (as a subprocess pipe never is), redraw a progress
        indicator with no separator at all -- no '\r', no '\n' -- so
        readline() would just block silently accumulating the entire run's
        progress spam, then dump it as one giant "line" the moment the next
        real newline finally arrived. That produced both a frozen-then-bursty
        feed and, on tools that DO use a bare '\r' to redraw, extra
        blank-looking broadcasts (Python's own universal-newlines readline()
        treats a bare '\r' as a line boundary too).

        Each chunk is scanned for '\n' (a finished line -- broadcast as
        "line", permanent) and '\r' (an in-place overwrite -- the text
        before it is discarded, exactly like a real terminal's cursor
        return, not broadcast at all). Whatever's left after the last
        boundary is the current, still-growing line; it's broadcast as
        "partial" so the frontend can show it updating live (e.g. a ticking
        percentage) instead of only ever seeing finished lines.
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

        try:
            while True:
                chunk = os.read(fd, 4096)
                if not chunk:
                    break
                buf += decoder.decode(chunk)
                while True:
                    nl = buf.find("\n")
                    cr = buf.find("\r")
                    if nl == -1 and cr == -1:
                        break
                    if cr != -1 and (nl == -1 or cr < nl):
                        if cr == len(buf) - 1:
                            break  # might be a \r\n split across reads -- wait for the rest
                        if buf[cr + 1] == "\n":
                            line, buf = buf[:cr], buf[cr + 2:]
                        else:
                            buf = buf[cr + 1:]  # bare \r: discard what it overwrote, not a line
                            continue
                    else:
                        line, buf = buf[:nl], buf[nl + 1:]
                    with lines_lock:
                        lines.append(line)
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
                with lines_lock:
                    lines.append(buf)
                self.broadcast({"type": "line", "stream": stream_name, "text": buf})
            self.broadcast({"type": "partial", "stream": stream_name, "text": ""}, partial=True)
            try:
                pipe.close()
            except OSError:
                pass


def extract_flag_value(args, names):
    """Best-effort scrape of a value-taking flag's argument out of the argv
    list this worker was given (e.g. the target URL after -u/--url) --
    purely for labeling findings; never re-parsed back into argv."""
    for i, a in enumerate(args):
        if a in names and i + 1 < len(args):
            return args[i + 1]
    return ""


# sstimap's own confirmed-injection message is a structured, multi-line
# block (see checks.py's log.log(21, f"""SSTImap identified the following
# injection point: ...""") -- confirmed against its real source, not
# guessed):
#   SSTImap identified the following injection point:
#
#     GET parameter: content
#     Engine: Python (Jinja2)
#     Injection: {{ 7*7 }}
#     Context: code
#     OS: Linux
#     Technique: Boolean error-based blind
#     Capabilities:
#       ...
# This is what translate_findings keys findings off now (see its own
# docstring for why), not a bare "injectable" substring match -- that regex
# this replaced also matched sstimap's own NEGATIVE result line ("Tested
# parameters appear to be not injectable."), which is why a run that found
# nothing could still produce a "critical"-severity finding.
SSTIMAP_START_RE = re.compile(r"^SSTImap identified the following injection point:")
SSTIMAP_PARAM_RE = re.compile(r"^\s*(\w+) parameter:\s*(.+)")
SSTIMAP_ENGINE_RE = re.compile(r"^\s*Engine:\s*(.+)")
SSTIMAP_INJECTION_RE = re.compile(r"^\s*Injection:\s*(.+)")
SSTIMAP_TECHNIQUE_RE = re.compile(r"^\s*Technique:\s*(.+)")
SSTIMAP_CAPABILITIES_RE = re.compile(r"^\s*Capabilities:")


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


def translate_findings(lines, args):
    """Best-effort scrape of sstimap's own console output into ledger
    findings -- see module docstring for why this isn't a structured report
    parse, and SSTIMAP_START_RE's own doc comment above for the exact block
    this parses. One finding per confirmed injection point block; Path
    carries the real injection string sstimap actually used (e.g.
    "{{ 7*7 }}"), not a placeholder, and Description states the detected
    template engine and technique.
    """
    target = extract_flag_value(args, ("-u", "--url"))
    now = now_iso()
    findings = []
    in_block = False
    param = ""
    engine = ""
    injection = ""
    technique = ""
    for line in lines:
        if SSTIMAP_START_RE.search(line):
            in_block = True
            param = engine = injection = technique = ""
            continue
        if not in_block:
            continue
        m = SSTIMAP_PARAM_RE.match(line)
        if m:
            param = f"{m.group(1)} parameter '{m.group(2).strip()}'"
            continue
        m = SSTIMAP_ENGINE_RE.match(line)
        if m:
            engine = m.group(1).strip()
            continue
        m = SSTIMAP_INJECTION_RE.match(line)
        if m:
            injection = m.group(1).strip()
            continue
        m = SSTIMAP_TECHNIQUE_RE.match(line)
        if m:
            technique = m.group(1).strip()
            continue
        if SSTIMAP_CAPABILITIES_RE.match(line):
            # "Capabilities:" is always the last field before the block's
            # trailing detail lines -- emit the finding now, then wait for
            # the next SSTIMAP_START_RE (a second injectable parameter)
            # before capturing anything else.
            in_block = False
            path = f"{target} -- {injection}" if target and injection else (injection or target)
            description = f"{engine} template engine, {technique}" if engine else technique
            findings.append({
                "severity": "critical",
                "target": host_only(target),
                "path": path,
                "port": port_for(target),
                "title": f"Possible SSTI vulnerability ({param})" if param else "Possible SSTI vulnerability",
                "description": description or "sstimap confirmed a server-side template injection",
                "remediation": "",
                "worker": "sstimap",
                "date": now,
            })
    return findings


class Handler(BaseHTTPRequestHandler):
    server_version = "sstimap-worker/1.0"
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
    port = int(os.environ.get("SSTIMAP_WORKER_PORT", "8080"))
    httpd = App(("0.0.0.0", port))

    def handle_signal(signum, frame):
        print("shutting down", file=sys.stderr)
        httpd.app.stop_run()
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    print(f"sstimap-worker listening on :{port}", file=sys.stderr)
    httpd.serve_forever()
    httpd.server_close()


if __name__ == "__main__":
    main()
