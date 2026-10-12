# Nmap-worker

Port and service scanning (raw sockets), in a container. Run-to-completion.

## Files

- `Dockerfile` -- builds the wrapper and declares `ARG TOOL_IMAGE` (no default). Set the Docker Hub image in `../../data/worker-images.env`, not here.
  The tool image must have `nmap` on `PATH`.
- `main.go`, `ws.go`, `input.go` -- Go HTTP+WebSocket server. Runs the tool as a child
  process (`exec.Command`, never a shell). `input.go` holds the stdin pipe for `/input`.

- `control.go` -- job control: pause, resume, and stop act on the tool's own process group.

## HTTP API (port `$NMAP_WORKER_PORT`, default 8080)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/status` | `idle` or `running` |
| POST | `/run` | body `{"args": [...], "interactive": false}`; `interactive: true` opens stdin; 202 started, 409 busy |
| POST | `/pause` | Ctrl+Z on the tool: suspends its process group, not the container; 409 when idle or already paused |
| POST | `/resume` | fg on the tool: continues a paused run; 409 when not paused |
| POST | `/stop` | Ctrl+C on the tool: SIGINT to its process group (continued first if paused), SIGKILL after 5 s if it ignores SIGINT; the worker stays up; 409 when idle |
| POST | `/input` | body `{"text": "..."}`; writes one line to the tool's stdin; 409 when no run accepts input |
| GET | `/ws` | live feed: `line`, `input`, `error`, `result` frames; history replayed to new viewers |
| GET | `/history` | every frame of the current or latest run, as JSON; the MCP gateway reads it |
| GET | `/output?name=` | read a file the run wrote to `/tmp/output` |

## Behavior

Run-to-completion: `POST /run` starts the tool, which exits when it finishes or when
`POST /stop` interrupts it (Ctrl+C). `POST /pause` and `POST /resume` suspend and continue it (Ctrl+Z and fg). After a stop the worker goes idle and is ready for the next run. stdin is `/dev/null` unless the run sets `interactive: true`. Then `POST /input` reaches the tool; otherwise it returns 409.

## Called by

- Backend: `backend/src/main/java/com/example/application/workercontrollers/nmap/`: controller (`/api/nmap/run|stop|input|findings`), run service, worker client (HTTP), relay handler (WebSocket).
- Frontend: `frontend/public/js/components/live-terminal.js` sends `/api/nmap/input` from the Answer line.

## Notes

- `-oN`, `-oS`, `-oG`, and `-oX` are saved to Project Folder when the run finishes. `-oA` is not, because it writes several files.
- Runs as UID 10001 with `HOME=/tmp`.
- Raw sockets: the binary gets `NET_RAW`/`NET_ADMIN` through `setcap`. The Dockerfile installs `libcap2-bin` with apt during the build, so the tool image must be Debian- or Ubuntu-based. The Dockerfile sets `NMAP_PRIVILEGED=1`, so nmap accepts those capabilities for raw scans (`-sS`, `-O`) instead of requiring UID 0. Compose grants the two capabilities to the container. Not yet verified on a live host.
