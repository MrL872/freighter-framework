# Workers

Each folder here is one security tool, packaged as a worker container. A worker wraps a command-line tool in a small HTTP and WebSocket server. The backend starts runs on the worker and collects its output.

## Folders

Each worker folder contains:

- `Dockerfile`, which builds the wrapper and declares `ARG TOOL_IMAGE` (no default). Set the Docker Hub image that holds the tool in `../data/worker-images.env`, not in this file.
- The wrapper source. Go workers have `main.go`, `ws.go`, and `input.go`. Python workers have `server.py`.
- `go.mod` for Go workers.
- `.dockerignore`, which keeps unneeded files out of the image.
- `README.md`, which describes that tool's flags and output.

## Workers

The folders are: dirsearch, ffuf, fuxploider, gau, gitleaks, gowitness, hydra, jwt-tool, katana, masscan, metasploit, nmap, nosqlmap, nuclei, puredns, shuffledns, sqlmap, sstimap, subfinder, wafw00f, wpscan, and xsstrike.

Session workers, such as metasploit and nosqlmap, keep running until stopped or until a run times out. Other workers run one command per run.

## HTTP contract

Every worker serves the same API on port 8080, or on the port set in its `<TOOL>_WORKER_PORT` variable:

- `GET /health` returns `{"status":"ok"}`.
- `GET /status` returns `{"state":"running"}` or `{"state":"idle"}`.
- `POST /run` takes `{"args":[...]}`, returns 202 when it accepts the run, and returns 409 if a run is already in progress.
- `POST /pause` suspends the run in progress, like Ctrl+Z on the tool. It does not touch the container.
- `POST /resume` continues a paused run, like `fg`.
- `POST /stop` interrupts the run in progress, like Ctrl+C on the tool. The worker stays up and goes idle. If the tool ignores SIGINT, it is killed after 5 seconds.
- `POST /input` sends one line to the tool's stdin.
- `GET /history` returns the frames of the current run.
- `GET /ws` streams output lines and a final result frame, which carries the exit code and findings.
- `GET /output?name=` returns a file the tool wrote. Tools with output flags use this.

Only one run can be active per worker. The tool runs as a child process, never through a shell. Pause, resume, and stop act on the tool's own process group, so the container keeps running.

## Findings

A worker turns raw output into findings with the fields `severity`, `target`, `path`, `port`, `title`, `description`, `remediation`, `worker`, and `date`. `path` is the full URL or other location actually reached, when there is one; leave `port` empty and let the worker's own `portFor`/`port_for` helper derive it from `path` (an explicit port if the URL has one, else 80/443 by scheme, else 443 for a bare host) -- see any existing worker's `hostOnly`/`host_only` function for the pattern. The backend stores findings in the vulnerability ledger, and also attaches a `vulnKey` and `status` to each one at read time (see `VulnerabilityStatusService` and MANUAL.md section 9.5) -- neither is something a worker itself sets.

## Images

Each worker runs the tool from `TOOL_IMAGE`, supplied as a build arg from `../data/worker-images.env` (one `<WORKER>_TOOL_IMAGE=` line per worker, read by the `docker compose` CLI itself via `--env-file`, not mounted into any container). Set every line in that file before the first build, or `make check-images`/`make up`/`make build` refuse to start. The nmap and masscan images must be Debian- or Ubuntu-based, because their Dockerfiles install `libcap2-bin` with apt before calling `setcap`. The gowitness image must include Chromium.

## Adding a worker

See chapter 9 of [MANUAL.md](../MANUAL.md) for the full procedure, which covers the worker, backend classes, frontend panel, and optional MCP entry.
