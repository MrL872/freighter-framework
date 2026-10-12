# Subfinder-worker

Subdomain enumeration, in a container. Run-to-completion.

## Files

- `Dockerfile` -- builds the wrapper and declares `ARG TOOL_IMAGE` (no default). Set the Docker Hub image in `../../data/worker-images.env`, not here.
  The tool image must have `subfinder` on `PATH`.
- `main.go`, `ws.go`, `input.go` -- Go HTTP+WebSocket server. Runs the tool as a child
  process (`exec.Command`, never a shell). `input.go` holds the stdin pipe for `/input`.

- `control.go` -- job control: pause, resume, and stop act on the tool's own process group.

## HTTP API (port `$SUBFINDER_WORKER_PORT`, default 8080)

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

- Backend: `backend/src/main/java/com/example/application/workercontrollers/subfinder/`: controller (`/api/subfinder/run|stop|input|findings`), run service, worker client (HTTP), relay handler (WebSocket).
- Frontend: `frontend/public/js/components/live-terminal.js` sends `/api/subfinder/input` from the Answer line.

## Notes

- Runs as UID 10001 with `HOME=/tmp`.
