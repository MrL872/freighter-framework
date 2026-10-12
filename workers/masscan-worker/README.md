# Masscan-worker

Fast port scanning (raw sockets), in a container. Run-to-completion.

## Files

- `Dockerfile` -- builds the wrapper and declares `ARG TOOL_IMAGE` (no default). Set the Docker Hub image in `../../data/worker-images.env`, not here.
  The tool image must have `masscan` on `PATH`.
- `main.go`, `ws.go`, `input.go` -- Go HTTP+WebSocket server. Runs the tool as a child
  process (`exec.Command`, never a shell). `input.go` holds the stdin pipe for `/input`.

## HTTP API (port `$MASSCAN_WORKER_PORT`, default 8080)

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

Run-to-completion: `POST /run` starts the tool, which exits when it finishes or when
`POST /stop` cancels it. stdin is `/dev/null` unless the run sets `interactive: true`. Then `POST /input` reaches the tool; otherwise it returns 409.

## Called by

- Backend: Not called by the backend yet. The MCP gateway config (`data/mcp-gateway/config.json`) lists it.
- Frontend: —

## Notes

- Runs as UID 10001 with `HOME=/tmp`.
- Raw sockets: the binary gets `NET_RAW`/`NET_ADMIN` through `setcap`. The Dockerfile installs `libcap2-bin` with apt during the build, so the tool image must be Debian- or Ubuntu-based. Compose grants the two capabilities to the container. Not yet verified on a live host.
