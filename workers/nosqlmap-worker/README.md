# NOSQLmap-worker

NoSQL injection, menu-driven (answer prompts with /input), in a container. Long-lived session.

## Files

- `Dockerfile` -- builds the wrapper and declares `ARG TOOL_IMAGE` (no default). Set the Docker Hub image in `../../data/worker-images.env`, not here.
  The tool image must have `nosqlmap` on `PATH`.
- `main.go`, `ws.go`, `input.go` -- Go HTTP+WebSocket server. Runs the tool as a child
  process (`exec.Command`, never a shell). `input.go` holds the stdin pipe for `/input`.

## HTTP API (port `$NOSQLMAP_WORKER_PORT`, default 8080)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/status` | `idle` or `running` |
| POST | `/run` | body `{"args": [...], "interactive": false}`; `interactive: true` opens stdin; 202 started, 409 busy |
| POST | `/stop` | cancel the running tool; 409 when idle |
| POST | `/input` | body `{"text": "..."}`; writes one line to the tool's stdin; 409 when no run accepts input |
| GET | `/ws` | live feed: `line`, `input`, `error`, `result` frames; history replayed to new viewers |
| GET | `/history` | every frame of the current or latest run, as JSON; the MCP gateway reads it |

## Behavior

Long-lived: `POST /run` starts the tool and it keeps running until `POST /stop`
or until it exits. Use `POST /input` to answer its prompts.

## Called by

- Backend: `backend/src/main/java/com/example/application/workercontrollers/nosqlmap/`: controller (`/api/nosqlmap/run|stop|input|findings`), run service, worker client (HTTP), relay handler (WebSocket).
- Frontend: `frontend/public/js/components/live-terminal.js` sends `/api/nosqlmap/input` from the Answer line.

## Notes

- Runs as UID 10001 with `HOME=/tmp`.
- Session worker: the MCP gateway or an image with an MCP wrapper preinstalled can replace
  this worker. See `mcp-gateway/README.md`.
