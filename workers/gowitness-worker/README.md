# GOwitness-worker

Web screenshots (needs Chromium in the image), in a container. Run-to-completion.

## Files

- `Dockerfile` -- builds the wrapper and declares `ARG TOOL_IMAGE` (no default). Set the Docker Hub image in `../../data/worker-images.env`, not here.
  The tool image must have `gowitness` on `PATH`.
- `main.go`, `ws.go`, `input.go` -- Go HTTP+WebSocket server. Runs the tool as a child
  process (`exec.Command`, never a shell). `input.go` holds the stdin pipe for `/input`.

- `control.go` -- job control: pause, resume, and stop act on the tool's own process group.

## HTTP API (port `$GOWITNESS_WORKER_PORT`, default 8080)

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

## Behavior

Run-to-completion: `POST /run` starts the tool, which exits when it finishes or when
`POST /stop` interrupts it (Ctrl+C). `POST /pause` and `POST /resume` suspend and continue it (Ctrl+Z and fg). After a stop the worker goes idle and is ready for the next run. stdin is `/dev/null` unless the run sets `interactive: true`. Then `POST /input` reaches the tool; otherwise it returns 409.

## Called by

- Backend: `backend/src/main/java/com/example/application/workercontrollers/gowitness/`: controller (`/api/gowitness/run|stop|input|findings`), run service, worker client (HTTP), relay handler (WebSocket).
- Frontend: `frontend/public/js/components/live-terminal.js` sends `/api/gowitness/input` from the Answer line.

## Notes

- Runs `gowitness scan <single|file|cidr|nmap|nessus> …`. The control panel picks the subcommand, and only the flags that subcommand takes are offered. gowitness v3 has no `screenshot` command, and the `report` subcommands are not exposed.
- Without `--screenshot-path`, the backend writes screenshots to `/tmp/screenshots`, the folder the worker reads them from.
- Every run also forces gowitness's own `--write-jsonl`/`--write-jsonl-file` (reusing the user's own path from the WRITERS section if they set one), so `emitScreenshots` can read the real crawled URL for each screenshot back out of that report afterward, instead of guessing from the screenshot's own collapsed file name. Each `"screenshot"` WS frame carries that URL as `"endpoint"`, plus its bare host as `"target"` -- both blank when the report is missing or doesn't cover that file. The ledger finding for each screenshot also carries `port` (derived from `endpoint` via `portFor`) and `statusCode` (the report's `response_code`) -- both unresolved the same way when the report doesn't cover that file.
- Runs as UID 10001 with `HOME=/tmp`.
- The image must include Chromium. Screenshots reach `./data/image-storage` through the backend, not this container -- see that directory's own README for the `<profileId>/<target>/<id>.<format>` layout "target" decides.
