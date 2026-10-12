# Freighter-framework Manual

This project is a job-runner GUI for containerized cybersecurity tools. Each tool runs in its own worker container. The backend sends it HTTP requests, and the browser shows its output live.

## Contents

1. [How the application runs the workers](#1-how-the-application-runs-the-workers)
2. [Booting freighter-framework](#2-booting-freighter)
3. [Navigating the interface](#3-navigating-the-interface)
4. [Control panel](#4-control-panel)
5. [The remaining worker panels](#5-the-remaining-worker-panels)
6. [Telegram](#6-telegram)
7. [Connecting an MCP client](#7-connecting-an-mcp-client)
8. [Replacing a worker's Docker image](#8-replacing-a-workers-docker-image)
9. [Adding a new worker](#9-adding-a-new-worker)
10. [Activating the nosqlmap worker](#10-activating-the-nosqlmap-worker)
11. [Custom nuclei templates](#11-custom-nuclei-templates)

## 1. How the application runs the workers

Docker Compose creates and starts every worker. Each worker is a container that waits idle.

The backend never touches Docker. It has no Docker socket, no Docker CLI, and no proxy. To run a tool, the backend sends an HTTP request to that worker, and the worker runs the tool and streams its output back.

The steps for one run:

1. Startup. `make up` builds the images and starts the containers. Each worker listens on port 8080 inside the Compose network, under its service name, for example `http://nmap-worker:8080`. Workers publish no ports to the host.
2. Request. You start a run from the UI. The browser sends it to `/api/nmap/run`, and the frontend forwards it to the backend's `/nmap/run` endpoint, which is the controller for that tool.
3. Validation. The tool's `Flags` class checks the flags and turns them into an argument list. The run service creates a job record in the database.
4. Dispatch. The tool's worker client sends `POST /run` with the arguments. The worker starts the real tool as a child process, never through a shell.
5. Live output. The worker streams output lines and findings over its `/ws` WebSocket. The backend relays them to the browser and saves findings.
6. Result files. Tools with output flags write files that the backend fetches from the worker's `/output` endpoint and stores in the Project Folder. The file must have an allowed type and be at most 1024 KB (section 3.9).
7. Job control. `POST /pause` suspends the tool like Ctrl+Z, and `POST /resume` continues it like `fg`. `POST /stop` interrupts it like Ctrl+C. The worker returns to idle and is ready for the next run. Only the tool's own process group is affected, never the container.

Only one run can be in flight per worker. A second `POST /run` gets HTTP 409.

If a worker is down, its run fails with an error. The backend has no Docker access, so it does not start, stop, or replace containers.

Before the first build:

- Fill in every `<WORKER>_TOOL_IMAGE=` line in `data/worker-images.env`. `make up` lists any that are still blank.
- The nmap and masscan tool images must be Debian- or Ubuntu-based, because their Dockerfiles install `libcap2-bin` with apt during the build, then call `setcap`. The nmap worker also sets `NMAP_PRIVILEGED=1`, so nmap accepts its file capabilities for raw scans.
- gowitness needs a tool image that includes Chromium.
- Keep the host's Docker socket away from containers. Nothing in this project mounts it.

## 2. Booting freighter-framework

freighter-framework runs as Docker containers, one per service, plus one container per tool. Use the Makefile, which checks Docker and worker images before it starts anything. The same Docker Compose commands work without it.

### 2.1 Before you start

You need:

- Docker with a running daemon. On Windows, use Docker Desktop or Docker inside WSL2 Ubuntu. On Linux, use the Docker Engine.
- GNU make, only for the Makefile route.
- Git, only for the Makefile route on Windows. The Makefile runs its recipes with `sh`, `grep`, `tr`, and `awk`. Git for Windows provides these in `C:\Program Files\Git\usr\bin`, so add that folder to your PATH. Without them, `make` fails with "grep: command not found" or similar errors. Linux and macOS already include these tools.
- Docker Compose v2, run as `docker compose`.

Set the worker images. In `data/worker-images.env`, fill in each line:

```
SUBFINDER_TOOL_IMAGE=
SHUFFLEDNS_TOOL_IMAGE=
...
```

Use the Docker Hub image that each worker should run. `make check-images` lists the variables that are still blank. This file is read by the `docker compose` CLI itself, on the host, before any image is built -- it is never mounted into a container (see `data/README.md` and each worker's own `Dockerfile`, which declares `ARG TOOL_IMAGE` with no default).

`docker-compose.override.yml` in the project root pins some workers to one CPU architecture, `linux/arm64` or `linux/amd64`. Their images publish only that build. Compose reads the file automatically. On an amd64 host, the arm64-only workers run under emulation, which is slower. Its header explains how to check which architecture an image publishes.

The chat works without an AI provider, but then only `/worker` commands run. To enable the cloud model, create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODEL=claude-sonnet-5
```

To use a local, OpenAI-compatible server instead (LM Studio, Ollama, ...), set these instead or as well:

```
LLM_BASE_URL=http://host.docker.internal:1234
LLM_MODEL=the-model-id-it-has-loaded
LLM_API_KEY=
```

Alternatively, leave all of these unset and turn a model on later from **[ settings ] → MCP gateway...**: **Cloud model** (section 7.11) for Anthropic, **Local model** (section 7.12) for an OpenAI-compatible server. A value saved there takes effect on the chat agent's next message, with no restart, and takes precedence over its matching environment variable above.

### 2.2 Route A: Makefile (recommended)

Run these from the project root:

```
make help             # list all targets
```
```
make up               # check Docker and images, then build and start everything
```
```
make ps               # show service status
```
```
make logs             # follow all logs (Ctrl+C stops following, not the services)
```
```
make logs S=backend   # follow one service
```

`make up` runs `docker info`, then checks for blank `_TOOL_IMAGE=` lines in `data/worker-images.env`, then runs `docker compose up -d --build`.

Other targets:

- `make build` builds every image and starts nothing.
- `make core` starts backend, frontend, mcp-gateway, and elasticsearch only. Use it when you work on the UI.
- `make workers` starts the worker containers only.
- `make stop` stops containers and keeps them.
- `make down` stops and removes containers. `./data` is kept.
- `make restart` runs `down` and then `up`.
- `make save-images` backs up every base and tool image this project pulls to `data/docker-image-cache`, as `docker save` tarballs.
- `make load-images` restores those tarballs with `docker load`, no registry contact. Use it when Docker Hub is unreachable and a build needs an image already saved. See `data/docker-image-cache/README.md`.

To use Route A on Windows, install both GNU make and Git for Windows, and make sure Git's `usr\bin` folder is on PATH. If `make` or Git is missing, use Route B. The Docker commands are the same.

### 2.3 Route B: Manual

Check Docker first:

```
docker info
```

Start everything, or only the platform services. Pass `--env-file`, so compose picks up `data/worker-images.env` the same way the Makefile route does (`docker compose` does not read it automatically, since it is not named `.env` or in the default location):

```
docker compose --env-file ./data/worker-images.env up -d --build
```
This builds the worker images too, so every `<WORKER>_TOOL_IMAGE=` line in `data/worker-images.env` must be filled in first (see 2.1). Use the second command to start without them -- it does not touch the workers, so `--env-file` is not needed.
```
docker compose up -d --build backend frontend mcp-gateway elasticsearch
```

Check status and logs:

```
docker compose ps
```
```
docker compose logs -f --tail=100
```

Stop:

```
docker compose stop        # pause, keep containers
```
```
docker compose down        # remove containers, keep ./data
```

For development only, you can run the backend and frontend outside Docker. Start the workers, gateway, and Elasticsearch with Docker first.

Backend, on port 8080:

```
cd backend
```
```
mvn spring-boot:run
```

Run it from `backend/`. The Derby database path is `../data/derby`, so it lands in the project's `data/` folder only when Maven runs from `backend/`. Starting it from anywhere else creates a second, separate database.

Frontend, on port 3000:

```
cd frontend
```
```
npm install
```
```
npm start
```

The frontend forwards `/api` requests to `http://localhost:8080`. Set `BACKEND_URL` if the backend runs elsewhere, and `PORT` to change the frontend port.

### 2.4 Check that it is running

- UI: http://localhost:3000. The header shows the profile switcher.
- Backend: http://localhost:8080. A search request responds, for example `/vulnerabilities/search?severity=HIGH`. The backend has no `/api` prefix. The frontend strips `/api` when it forwards requests, so the same search is `/api/vulnerabilities/search` on port 3000.
- MCP gateway: http://localhost:8811/healthz returns `{"status":"ok"}`.
- Elasticsearch has no host port. Check it from the backend container: `docker compose exec backend wget -qO- http://elasticsearch:9200/_cluster/health` returns the cluster status.

Check workers with `docker compose ps`, because they have no host ports. If a metrics panel reports a service as down, check that service's logs with `make logs S=<service>`.

### 2.5 Where your data lives

Everything is stored under `./data` on the host:

- `data/derby` holds the main database.
- `data/project-storage` holds Project Folder files.
- `data/image-storage` holds screenshots.
- `data/telegram` holds the Telegram settings, including the bot token.
- `data/mcp-gateway` holds the MCP gateway configuration.
- `data/llm` holds the chat agent's cloud-model toggle and API key.
- `data/wordlists` holds shared wordlists for the tools. The control panel's **Browse wordlists...** option lists them. The backend can write here too, through **[ file ] → Upload Wordlists** (section 3.2); every tool worker still mounts it read-only.
- `data/nuclei-templates` holds the templates the nuclei worker scans with. Drop files in directly, or add them through **[ file ] → Upload Nuclei Templates** (section 3.2). The backend and the nuclei worker both mount it read-write.
- `data/docker-image-cache` holds offline backups of pulled images, made and restored by `make save-images`/`make load-images` (section 2.2). Per-machine only; not mounted into any container.
- `data/elasticsearch/data` holds the search index, and `data/elasticsearch/logs` holds its logs. Both are read-write. The index is a copy of the database and can be rebuilt.

`make down` and `docker compose down` keep this folder. Deleting it erases all profiles, files, and findings.

### 2.6 First-run checklist

1. Fill in every `<WORKER>_TOOL_IMAGE=` line in `data/worker-images.env`.
2. Run `make up`.
3. Run `make ps` and check that every service is running.
4. Open http://localhost:3000.
5. Create a company profile from the profile switcher. Most features need one.
6. Optionally configure Telegram and the MCP gateway from **[ settings ]**.

### 2.7 Troubleshooting

- "Docker daemon not reachable": Docker is not running. Start Docker Desktop, or the Docker Engine service on Linux.
- "These have no image set": fill in the `data/worker-images.env` lines that `make check-images` lists.
- Port already in use (3000, 8080, 8811): stop the other program, or change the host side of the port mapping in `docker-compose.yml`.
- Data disappears after a restart: the backend was started from a directory other than `backend/`, so it used a different database.
- A worker keeps restarting: check `make logs S=<worker>-worker`. A bad image name in `TOOL_IMAGE` is the usual cause.
- `no match for platform in manifest: not found`: Compose asked for an architecture the image doesn't publish. This happens when a `TOOL_IMAGE` only ships one architecture and your host is the other one, or when you changed `TOOL_IMAGE` to a different image without updating its pin in `docker-compose.override.yml`. Check what the image actually publishes:
  ```
  docker manifest inspect -v <image> | findstr architecture
  ```
  (use `grep` instead of `findstr` on Linux/macOS). Then fix `docker-compose.override.yml` to match: add a `platform: linux/arm64` or `platform: linux/amd64` entry for that worker if it has none yet, change the existing entry if the image's supported architecture changed, or delete the entry entirely once the image publishes a build matching your host's own architecture.
- Elasticsearch exits right after starting: on Linux it may need more memory mapping. Raise `vm.max_map_count` (for example, `sudo sysctl -w vm.max_map_count=262144`).
- The chat says no provider is configured: set `ANTHROPIC_API_KEY` and run `docker compose up -d backend`, or turn on **Cloud model** and paste a key in **[ settings ] → MCP gateway...** (section 7.11), which needs no restart.
- Search and ledger are empty: Elasticsearch is unreachable. Check `make logs S=elasticsearch`.
- Search returns `"degraded": true` for a while after startup: Elasticsearch isn't up yet. The backend creates the index (`vulnerabilities_v2`) as soon as Elasticsearch answers, retrying every 30 seconds, then backfills it from the database in the background. Check `make logs S=backend` for `elasticsearch-index-created`.

### 2.8 Fixes in this version

These changes are already in the repository.

- **Docker image names are lowercase.** Docker rejects names that start with an uppercase letter, so the build failed. The project is now called `freighter-framework`, and all images and containers use that name, for example `freighter-framework-frontend`.
- **Elasticsearch uses the official image.** `elastic-search/Dockerfile` builds on `elasticsearch:8.15.3` from Docker Hub, as the workers build on their tool images. The image's node settings are replaced by `elastic-search/elasticsearch.yml`, and its heap is set by `elastic-search/jvm.options.d/heap.options`. The Alpine build and its package pins were removed.
- **Elasticsearch keeps its data in `./data`.** The index and logs are bind-mounted read-write from `data/elasticsearch`. The container's root filesystem stays read-only.
- **Elasticsearch runs with an empty keystore.** The keystore is created at build time, because the container's config directory is read-only. Security is off, so it holds no secrets.
- **`/tmp` is executable.** Elasticsearch unpacks its JNA native library there, and Docker mounts tmpfs `noexec` by default. Compose mounts `/tmp:exec`.
- **Networks use Docker's default driver.** The `user-defined` driver name was invalid, so the nine networks in `docker-compose.yml` are now default bridge networks with the same names.
- **Six networks are internal.** `mcp-to-frontend`, `mcp-gateway`, `elasticsearch-to-backend`, `elasticsearch-to-frontend`, `main-backend` (backend<->worker RPC), and `fourth-mcp-to-workers` (mcp-gateway<->worker RPC) have no route to the internet. Three networks keep internet access, each scoped to one need: `frontend-network`, because the backend calls LLM providers over it; `eighth-workers-to-web`, attached only to workers, because they scan real targets; and `ninth-telegram-to-web`, attached only to the `telegram-worker` container, because sending to Telegram means reaching `api.telegram.org`. The backend itself cannot reach Telegram directly any more -- `TelegramClient.java` sends its request to `telegram-worker`, which relays it on (see `telegram-worker/README.md`).
- **Elasticsearch has no host port.** Its two networks are internal, and Docker does not publish ports on internal networks. Only the backend and frontend reach it.

- **Search filters on severity, status, vulnerability ID, and profile work.** The backend appended `.keyword` to every filtered field. Those fields are plain keyword fields with no `.keyword` subfield, so their filters matched nothing. Now they are queried by name. Target and affected-version filters still use their `.keyword` subfields, because those fields are text.

- **The search index is created even when Elasticsearch starts late.** The backend tried to create the `vulnerabilities` index once, at startup. If Elasticsearch wasn't ready, the index was never created, and search stayed empty until a backend restart. The backend now retries every 30 seconds until the index exists. The backend still starts when Elasticsearch is down; search is degraded until it comes up.

- **Pause, resume, and stop act on the job.** The live terminal's Pause was always disabled, and Stop killed the tool without a clear result. Pause is now Ctrl+Z on the job, and it turns into Unpause, which is fg. Stop is Ctrl+C on the job. The worker stays up, and the terminal stays open. The tool runs in its own process group, so the container is never touched.
- **Terminal buttons look enabled when they are.** The Send button and the other terminal buttons were always drawn as disabled.
- **Send output shows results only.** The box shows each tool's result lines, not its banner, flags, progress, or status. A run that found nothing, or that failed before finding anything, leaves the box blank.
- **Dirsearch runs with the flags of its installed version.** The `--format` flag does not exist in dirsearch v0.5.0, the version the tool image ships, so runs failed with "no such option". The flags now match that version, and `-o` saves its file to Project Folder.
- **Gowitness runs with its installed version's commands.** gowitness v3 has no `screenshot` command. A run now uses `scan single`, `scan file`, `scan cidr`, `scan nmap`, or `scan nessus`, picked in the control panel.
- **nmap `-oX` and gitleaks `-r` are saved.** Both were offered in the control panel but never reached the Project Folder.
- **Search matches the worker name, and ignores case.** The free-text search box now includes `worker` alongside title, description, remediation, target, and path, and both it and the Target/Version filters match regardless of case. Previously `worker` wasn't searched at all, and typing a different case than the stored value found nothing (section 3.3).
- **Command preview's Reset survives an applied edit.** Typing over the flags and letting it apply used to make **[Reset]** disappear immediately, with no way back to what the panel's buttons had built. It now stays available, and reverts all the way back to that pre-edit state across however many typed edits applied in a row, until you press a flag button directly (section 4.5).
- **Local model base URL reaches the host.** A gateway-style IP such as `172.17.208.1` (the old example for LM Studio) may answer from your own shell but is not reachable from inside the backend's container network, so **[Fetch models]** timed out there even when the server itself was up. `docker-compose.yml` now sets `host.docker.internal` on the backend service (`extra_hosts: host-gateway`), which Docker Desktop already provides for free on Windows/Mac; section 7.12's examples use it for both LM Studio and Ollama now.
- **The frontend's `/api` proxy no longer races the backend's own timeout.** It used a flat 10-second timeout, the same order of magnitude as several backend-side LLM calls, so the proxy's generic "backend unreachable" often won the race against the backend's own, more specific error -- or, for any chat completion slower than 10 seconds, cut it off outright. The proxy's timeout is now comfortably above the slowest such call (a local-model chat completion, capped at 10 minutes).

### 2.9 Added in this version

- **Shared wordlists folder.** `data/wordlists` is mounted into the backend (read-write) and into each worker whose tool reads wordlists (read-only). Put wordlist files in it, in any subfolder, directly on the host or through the **[ file ]** menu below.
- **Wordlist browser.** The file popup of a worker panel ends with **Browse wordlists...** (section 4.3). It opens a window on the folder, served by `GET /api/wordlists?path=...`, for listing and picking only -- it does not write. The listing hides names that start with a dot, and refuses paths that leave the folder, including through symlinks.
- **Wordlist paths reach the tool.** A picked wordlist is sent as `wordlists/<path>`. The backend's `ProjectFileStager` turns that into the file's path inside the worker container. The Project Folder works the same way, with the bare file name.
- **Worker images create their shared mount points.** Each worker Dockerfile creates `/data/project-storage`, and `/data/wordlists` where the worker mounts it, in its root build stage. The runtime stage copies them in owned by the worker user (uid 10001). Compose then bind-mounts the host folders over them, so the mount points have a known owner regardless of the tool image. Section 9.3 describes this for new workers.
- **Nuclei reads only its Project Folder and templates.** The nuclei worker mounts `data/project-storage` read-only and `data/nuclei-templates` read-write. It does not mount `data/wordlists`. Section 11.4 has the details.
- **Upload Wordlists and Upload Nuclei Templates.** `[ file ]` gained two folder pickers, alongside Upload File to Project Storage: **Upload Wordlists** adds a whole folder to `data/wordlists`, and **Upload Nuclei Templates** adds one to `data/nuclei-templates` (section 3.2). Both send one request per file, preserve the folder's internal subfolder structure, and overwrite a file already at the same path.
- **Gowitness findings in the ledger.** Besides saving each screenshot to Image Storage, a gowitness run now also adds one info-severity "Screenshot captured" finding per screenshot, so a run shows up in the ledger like every other tool's (sections 3.7, 6.4).
- **Image Storage grouped by target.** Image Storage now shows one folder per scanned host, instead of one flat list of screenshots. A screenshot gowitness couldn't resolve a host for falls into an "Unsorted" folder (section 3.9).
- **Named saves from Custom wordlist/template and Send output.** Both boxes now have a file name field, instead of always saving under a fixed, timestamp-only name (sections 5.1, 5.3).
- **Command preview editing.** The tool name is fixed. The flags after it can be typed over. **Reset** rebuilds them from the panel, **Clear** unpins every flag and empties the bar, and **Copy** copies the whole command (section 4.5).
- **Flag search.** A search box at the right of the control panel's heading finds flags by their syntax, such as `-o` or `--output-file`, or by their description (section 4.2).
- **One destination for output flags.** An output flag's popup offers one destination, Project Folder, and a field for the file name (section 4.3).
- **Project Folder file limits.** Each file must have an allowed type and be at most 1024 KB. The backend enforces both rules (section 3.9).
- **Scan commands for gowitness.** Pick a scan command first, and only the flags it takes stay visible (section 4.3).
- **Actionable remediation text.** Every finding template's remediation now says how to fix the issue (the command, config line, or code change), not just what the issue is.
- **Every finding gets a port.** Previously only nmap, hydra, and masscan ever filled in a port; every other worker's findings showed "-". Now each worker derives it from its own target/path, defaulting to 443 for a bare host with no scheme (section 9.3).
- **wafw00f flags a missing WAF.** A "No WAF detected" result is now a medium-severity finding, not silently dropped -- see `workers/wafw00f-worker/README.md`.
- **Vulnerability status: Active, N/A, False Positive.** Tick ledger rows for a bulk action bar, or open a row's vulnerability card, to set a finding's status. N/A and False Positive sink to the bottom of the ledger and drop out of the severity/totals metrics (section 3.7).
- **The vulnerability card.** Click a ledger row (not its checkbox or a Path link) for a closable dialog with the finding's full detail, its status actions, and a permanent delete (section 3.7).
- **Severity metrics read by magnitude, not by proportion.** The severity panel's 5 ticks per severity are fixed count thresholds, not scaled to whichever severity has the most findings that poll (section 3.7).
- **Focus Live Terminal.** A fourth `[ view ]` toggle shrinks the worker view's other three boxes into a compact row and gives the live terminal the rest of the grid (sections 3.2, 3.8).
- **Worker state survives switching away and back.** A worker's control panel flags, its live terminal's output and open connection, and its send output box all pick back up where they were, within the same browser tab, instead of resetting on every switch (sections 3.8, 3.11, 4.1, 5.2, 5.3).
- **Worker images live in one file.** Every worker's `TOOL_IMAGE` is now set in `data/worker-images.env`, read by `docker compose --env-file` on the host, instead of editing each Dockerfile's `ARG` line directly (section 2.1).
- **Local model (chat agent).** A **Local model** control next to **Cloud model** connects the chat agent to any OpenAI-compatible server -- LM Studio, Ollama, or similar -- with a base URL, an optional API key, and a model picker that fetches whatever the server has loaded (section 7.12).
- **Documentation window.** `[ help ] → Documentation` opens this manual in a closable window with its own section navigation, rendered live from `MANUAL.md` (section 3.2).
- **Project Folder and Image Storage icons.** Their sidebar links now use icon images instead of emoji glyphs (section 3.6).
- **No CDN dependencies.** Every font and icon the UI uses is served from this app itself. The typeface, previously loaded from Google Fonts, is self-hosted now, so the UI no longer needs internet access to render correctly.

## 3. Navigating the interface

freighter-framework is a single page. Nothing reloads and the URL never changes. The header, the links sidebar, and the chat panel swap content into one main area.

### 3.1 Layout

- Header, at the top: the menus `[ file ]`, `[ view ]`, `[ settings ]`, and `[ help ]`, the search bar, the profile switcher, and the chat toggle.
- Links sidebar, on the left: collapsed to a thin rail by default. It opens worker views, Image Storage, and Project Folder.
- Main area, in the centre: the overview, a worker view, or a storage page.
- Chat sidebar, on the right: hidden until opened. It overlays the main area.
- Footer, at the bottom: shows when the overview was last refreshed.

Below 640px wide, the header menus collapse behind a `[ ☰ ]` button at the top right. Tap it to open the menus. Press Escape or tap outside to close them.

### 3.2 Header menus

Each menu opens on click and stays open until you click its button again, press Escape, or open a different menu. Hovering does not switch menus. Inside an open menu, Arrow Down moves to the next item, and Escape closes the menu and returns focus to its button.

`[ file ]` contains three items:
- Upload File to Project Storage imports a file into the current profile's Project Folder without leaving the page.
- Upload Wordlists opens a folder picker and uploads every file inside it, preserving subfolders, into the shared `data/wordlists` folder (not scoped to a profile).
- Upload Nuclei Templates does the same into the shared `data/nuclei-templates` folder.

Each item is disabled while its own upload is running, and shows live progress ("Uploading... 3/120") for the two folder uploads, since a folder can hold thousands of files. Each item briefly shows the result when it finishes, then reverts to its default label. A file already at the same path is overwritten.

`[ view ]` contains four toggles:
- Light Theme or Dark Theme, switching the colour scheme.
- Group Links by Category or Ungroup Links.
- Show or Hide Overview Metrics.
- Focus Live Terminal or Un-focus Live Terminal, shrinking the worker view's other three boxes into a compact row and giving the live terminal the rest of the space below them (section 3.8).

`[ settings ]` contains Telegram bot... and MCP gateway..., which open the settings dialog on the matching section.

`[ help ]` contains Documentation and About freighter-framework. Documentation opens this manual (`MANUAL.md`) in a closable window: a sidebar lists every section (click one to jump to it), and clicking a link inside the text itself, such as one in the Contents section above, does the same. Close it with the `[x]` button, Escape, or a click outside it. About freighter-framework is still a placeholder marked "soon" and is disabled.

### 3.3 Search bar

Search runs against the vulnerability ledger. Results replace the ledger's rows. Typing runs the search after a short pause. Press Enter to run it at once. Clearing the box returns the ledger to the live list.

The search box matches title, description, remediation, target, path, and worker, regardless of case -- searching `nmap` finds a finding whose worker is stored as `Nmap`.

Press `/` anywhere outside a text field to jump to the search box.

Click **filters** to open Vulnerability ID, Target, Version, Severity, and Status filters. The filter panel opens in the ledger's header. Changing a dropdown runs the search immediately. Target and Version match the stored value exactly, but regardless of case.

### 3.4 Profile switcher

The button shows the active company profile. Click it to see the list, then click a name to switch. Each profile has its own Project Folder, Image Storage, link order, and panel layout.

The **del** button next to a profile arms a deletion. Click it again to confirm. Deleting a profile also deletes its saved files.

### 3.5 Chat toggle

The chat button in the header opens and closes the chat sidebar. The sidebar overlays the main area and does not push it aside. Messages that begin with `/` run as commands, not as model prompts.

### 3.6 Links sidebar

Click `»` to expand the sidebar and `«` to collapse it. The state is remembered in this browser.

Worker links are grouped by category by default: Content Discovery, Recon, Vulnerability Scanning, Exploitation, and Vulnerability Specific Tools. Click a worker to open its worker view. The current worker is marked with `aria-current`.

Drag links or whole groups to reorder them. The order is saved per profile on the server, so it survives a reload or restart. Use **[ view ] → Ungroup Links** for a flat list.

Image Storage and Project Folder sit at the bottom of the sidebar. Each opens its page for the current profile.

### 3.7 Overview

The overview has two parts.

Metrics are four panels: backend, services, severity, and totals. Drag a panel by its header to reorder it. Hide them with **[ view ] → Hide Overview Metrics**.

The severity panel shows each severity as 5 ticks, not a bar proportional to the largest severity that poll. A count under 250 lights 1 tick, under 500 lights 2, under 750 lights 3, under 1000 lights 4, and 1000 or more lights all 5 -- a severity with 0 findings lights none. This keeps a severity with a handful of findings from reading as empty just because another severity that poll has thousands. The totals panel shows Found (every finding), Active, and Excluded (N/A and False Positive findings, see below) -- both severity and totals only ever count Active findings.

The ledger is the vulnerability table. You can:
- Click a column's filter icon to filter that column. The popup opens in the ledger header.
- Drag column headers to reorder columns, and drag the handles between columns to resize them.
- Tick rows with the checkboxes. The header checkbox selects all visible rows. Ticking at least one row shows a bar above the table with **Mark Active**, **Mark N/A**, and **Mark False Positive** buttons, which set that status on every ticked row at once.
- Click anywhere on a row, other than its checkbox or a Path link, to open its vulnerability card, described below.

A finding marked N/A or False Positive shows that status in place of its severity, sinks below every other row regardless of the current sort, and is left out of the severity and totals panels above -- its real severity is kept underneath, so marking it back to Active restores it everywhere.

**The vulnerability card** opens as a closable dialog over the ledger. It shows the finding's ID (its backend record key), worker, severity, status, target/path/port, title, date, description, and remediation.

- **Mark Active / Mark N/A / Mark False Positive** set that finding's status, the same as the ledger's own bulk action bar.
- **Delete entry** permanently removes the finding's aggregated record. It asks you to click again to confirm. This does not touch the underlying scan data it was derived from, so the same finding can reappear, reset to Active, the next time that job's data is polled or the tool scans that target again -- deleting only removes this one record, now.
- A finding that has not reached the backend's vulnerability database yet (a very recent result) shows "not yet indexed" instead of an ID, and has no status or delete actions until the next poll catches up.

Escape, the `[x]` button, or clicking outside the card closes it.

### 3.8 Worker view

Clicking a worker in the sidebar replaces the overview with that worker's view. It has four boxes:

- Control panel: builds the command-line flags. Chapter 4.
- Custom wordlist/template: a text box for your own entries. Chapter 5.
- Live caption terminal: runs the command and shows its output. Chapter 5.
- Send output: holds the finished output. Chapter 5.

Drag a box by its heading to reorder it. The order is saved per profile.

**[ view ] → Focus Live Terminal** shrinks the other three boxes into a compact row across the top and gives the live terminal the rest of the grid below them, so its output has room to breathe in a small window instead of jittering a quarter-sized box. The terminal is not draggable while focused -- there is nowhere else on the grid for it to go -- but the other three boxes can still be reordered among themselves. **Un-focus Live Terminal** returns to the even four-box layout.

Click `« overview` at the top left to return to the overview. Your metrics visibility and ledger filters are kept. So are each worker's own control panel flags, its live terminal's output and connection to a run in progress, and its send output box -- switching away and back, to the overview or to a different worker, does not reset or interrupt any of them (sections 4.1, 5.2, 5.3). This holds only within the same browser tab; a page reload resets everything.

### 3.9 Project Folder and Image Storage pages

These pages replace the main area, with a `« overview` button to return.

Project Folder lists the profile's saved files, newest first. You can:
- Drag files into the drop zone, or click it to browse. Only these types are accepted: `.txt`, `.md`, `.json`, `.jsonl`, `.xml`, `.csv`, `.html`, `.sqlite`, `.sqlite3`, `.db`, `.yaml`, `.yml`, `.js`, `.ini`, `.log`, `.sarif`, `.har`, `.nmap`, and `.gnmap`. Each file can be at most 1024 KB. The backend enforces both rules, so a file saved from a tool is refused when it breaks them.
- Click `›` on a file to expand it. You can copy its text, or click `[Edit]` and then `[Save]` to change it.
- Click `✎` to rename a file, or `✕` to delete it. Deleting asks you to click again to confirm.

Image Storage groups the profile's screenshots into one folder per scanned host, the same host gowitness resolved the screenshot's real URL from. Click a folder to see its screenshots. A screenshot gowitness could not resolve a host for falls into an "Unsorted" folder, sorted last. Expand a file to see its preview, which links to the real URL it was captured from when one is known. Rename and delete work the same way as Project Folder.

If no profile is selected, both pages say so and show nothing.

### 3.10 Keyboard reference

- `/` anywhere outside a text field: focus the search box.
- Enter in the search box: run the search now.
- Escape in an open header menu: close it.
- Arrow Down in an open header menu: move to the next item.
- Escape in the settings dialog: close it.
- Enter or Escape while renaming a file: save or cancel the rename.
- Enter or Space on the Project Folder drop zone: open the file browser.
- Enter in the live terminal's Answer box: send the answer to the running job.
- Enter or Escape while renaming a chat: save or cancel the rename.

Settings dialogs and file pickers also close when you click outside them.

### 3.11 What is remembered, and where

- The links sidebar state, theme, metrics visibility, and Terminal Focus are kept in this browser only.
- Link order and grouping are saved per profile on the server, and cached in this browser.
- Metric and worker panel order is saved per profile in this browser. Without a profile, the order resets on reload.
- Ledger column layout and filters are saved per profile.
- A worker's control panel flags, live terminal output and connection, and send output are kept in this browser tab only, for as long as the tab stays open -- not saved to the server or to this browser long-term. A page reload resets them; switching between workers and the overview does not (sections 3.8, 4.1, 5.2, 5.3).

### 3.12 Troubleshooting

- A panel says `[name] unavailable`: reload the page. The browser console logs each component's status.
- Project Folder or Image Storage says "Select a company profile": choose a profile in the header.
- Send output is empty: output appears only after a run in that worker finishes.
- The ledger is empty after a search: clear the search box and filters. Check the Status and Severity dropdowns.
- A deleted finding came back: deleting a vulnerability card entry removes its record, not the scan data behind it, so the same finding can reappear, reset to Active, next poll or next scan. This is expected (section 3.7).
- The links sidebar is missing: it is collapsed. Click `»`.
- Header menus are missing on a phone: tap `[ ☰ ]`.
- A menu item does nothing: Documentation and About freighter-framework are placeholders.

## 4. Control panel

The control panel is the top-left box in a worker view. It builds the flags for one tool, shows the command as you build it, and passes that command to the live terminal when you press Send.

### 4.1 Opening it

Click a worker in the links sidebar. The control panel is rebuilt for that tool each time you switch workers, but its flag selections are kept in this browser tab: switch to another worker or back to the overview, then return, and the flags you had pinned are still pressed and the command preview still shows them. A full page reload still starts you with no flags.

### 4.2 Layout

The panel has a Basic flags group and an Advanced flags group. Each group contains sections, such as TARGET SPECIFICATION or HOST DISCOVERY for nmap, and each section contains flag buttons. Both groups start collapsed. Click a group heading to expand or collapse it. Collapsing a group does not clear the flags inside it.

The heading of the panel has a search box at its right. It finds flags by their syntax, such as `-o` or `--output-file`, or by their description. Only the groups with a match stay open. Clear the box, or press Escape, to restore the groups.

At the bottom is the command preview: the tool name, the flags, and the buttons **[Reset]** (shown while there is a typed edit to go back to), **[Clear]**, and **[Copy]**.

### 4.3 Choosing flags

A flag with no value, such as `-sV`, is turned on with one click and off with another.

A flag that takes a value, such as `-p`, opens a small popup with the placeholder `value...`. Type the value and press Enter. Escape, clicking outside the popup, or scrolling closes it without changing anything. An empty value is ignored.

A flag that takes a file, such as `-iL` or `--excludefile`, opens a list of the files in the current profile's Project Folder. Click a file to select it. If no profile is selected, or the folder is empty, the list says so.

The list ends with **Browse wordlists...**. It opens a window on `data/wordlists` on the host, including its subfolders. Click a folder to open it, `[ .. ]` to go up, and a file to select it. The tool receives the path as `wordlists/<path>`, which the backend turns into the file's location inside the container. The folder is shared by all profiles, so the option works even when no profile is selected.

An output flag, such as `-oN` or `-oX`, opens a popup with a dropdown that offers one destination, **Project Folder**, and a field for the file name. Type a name with an allowed file type, such as `scan.xml`. A name with a folder in it, or with a type that is not allowed, is refused and the popup stays open. An output that goes to Image Storage, such as gowitness's `--screenshot-path`, has one destination, **Image Storage**, with no type rule. A folder output, such as ffuf's `-od`, takes a folder name instead of a file name.

Hover over any flag to see its description.

Some tools start with a command, not a flag. gowitness is one: pick its scan command (`single`, `file`, `cidr`, `nmap`, or `nessus`) first, and only the flags that command takes stay visible. Picking another command replaces the first one, and any flag the new command does not take is unpinned.

### 4.4 Removing and changing flags

To remove a flag, click it while it is highlighted. To change a value, remove the flag first, then add it again with the new value. Clicking an active flag always removes it, and never opens the popup. **[Clear]** in the command preview removes every flag at once.

### 4.5 Command preview

The tool name is fixed text. The flags after it are added in the order their buttons appear on the panel, not in the order you clicked, and the preview updates on every change. You can also type or paste over the flags, for example to change a value; once you stop typing, it parses and applies, the same as if you had clicked the equivalent buttons.

**[Reset]** appears as soon as you start typing, and stays after the edit applies -- clicking it reverts the panel all the way back to whatever flags were active before you started, no matter how many typed edits applied in a row since. Clicking a flag button directly instead, rather than typing, retires that revert and goes back to only covering an in-progress, not-yet-applied edit. **[Clear]** unpins every flag and empties the bar. **[Copy]** copies the whole command, name included. Copying does not run anything.

### 4.6 Running the command

1. Select a company profile in the header. A run needs a profile.
2. Build your flags.
3. In the live caption terminal, press Send.

The terminal shows output line by line. Type into its Answer box and press Enter to answer a prompt. **Pause** suspends the job, like Ctrl+Z, and the button becomes **Unpause**, which continues it, like `fg`. **Stop** interrupts the job, like Ctrl+C. The terminal stays open, so you can change the flags and run again. Pause and Stop are enabled only while a run is in progress.

When the run ends, the terminal prints `[done] exit code <n>`. The result lines of the run are copied into the Send output box.

If Send does nothing, the terminal shows the reason:

- `select a company profile first`: choose a profile.
- `build a command in the control panel first`: select at least one flag.

### 4.7 Which workers are wired

Wired workers have a full flag panel, and Send runs them. These are subfinder, shuffledns, puredns, gau, gitleaks, nuclei, ffuf, katana, gowitness, nmap, dirsearch, xsstrike, sqlmap, hydra, wpscan, sstimap, wafw00f, jwt-tool, and fuxploider.

Other workers show the message "No basic flags defined yet", and Send is disabled. These include metasploit, which is excluded because it runs as a stateful session service. They also include nosqlmap, whose upstream tool has no command-line interface, and masscan, which has no wired backend. Use the MCP gateway for these, or see chapter 10 for nosqlmap.

### 4.8 Troubleshooting

- The flag list is empty: this worker has no wired panel. See section 4.7.
- The file list says no files are saved: save or import a file on the Project Folder page first.
- A value popup closed by itself: scrolling closes it. Reopen it and type the value.
- Flags disappeared: they are kept only within this browser tab (section 4.1). A page reload clears them; switching workers or returning to the overview does not.
- Send is greyed out: the worker is not wired, or a run is already in progress.
- The search box finds nothing: check the spelling, or search for a word from the description, such as `output`. Clear the box to show every flag again.
- The run started but shows no output: look for `[error]` lines, and check that the worker container is running with `make ps`.

## 5. The remaining worker panels

Besides the Control panel, a worker view has three boxes: Custom wordlist/template at the top right, Live caption terminal at the bottom left, and Send output at the bottom right.

### 5.1 Custom wordlist/template

This box is a text editor for your own entries, such as paths, subdomains, or payloads. It saves a file to the Project Folder. It does not feed that file into a run. To use the file in a scan, select it from a file-type flag in the Control panel, for example nmap's `-iL`.

Type or paste entries, one per line. Choose a format from the Render as dropdown:

- `txt` saves the entries as typed.
- `json` saves a JSON array of strings. Each line is trimmed, and blank lines are dropped.
- `yaml` saves a YAML list, with each entry starting with `- `. Blank lines are dropped, and lines are trimmed.

A Name field holds the file's name prefix, defaulting to `wordlist`. Click Save to Project Folder. The button shows Saving, then Saved or Save failed. Without a profile, it shows "No profile selected" and saves nothing. The file is named `<name>-<timestamp>.<format>`; a blank or path-containing name falls back to `wordlist`.

The box does not check for empty input, so saving an empty box creates an empty file, or `[]` for json.

`[Copy]` copies the text as typed, not the formatted output.

The text is not kept when you switch workers or return to the overview. Save it first.

### 5.2 Live caption terminal

This box runs the command built in the Control panel and shows its output. The terminal is the only place a run starts.

On a wired worker, the box says "Build a command in the control panel, then press Send", and Send is enabled. On other workers, it says "Waiting for the worker's terminal", and every control is disabled.

Send is disabled while a run is in progress, and Pause, Stop, and the Answer box are enabled instead. Refusals are shown as `[error]` lines, for example "select a company profile first".

Type an answer in the Answer box and press Enter when a tool asks a question. Your answer appears as `> your text`. If the tool is not waiting for input, the box shows `[error] the job is not accepting input right now`.

Pause suspends the job, like Ctrl+Z, and the button then reads Unpause, which continues the job, like `fg`. Stop interrupts the job, like Ctrl+C. The terminal stays open, and the run ends with its exit code, for example `[done] exit code 130`. A tool that ignores Ctrl+C is killed five seconds after the stop.

Switching to another worker or the overview and back does not interrupt a run in progress: the output printed so far reappears instantly, and the terminal picks the same live connection back up rather than starting over. This holds only within the same browser tab -- a page reload still shows an empty terminal, even if the job is still running on its worker.

### 5.3 Send output

This box holds the output of the most recent finished run. Starting another run replaces it when that run ends.

On wired workers, the box shows the run's result lines as text. Each tool has its own rule for what a result line looks like. ffuf shows the paths it found, and dirsearch shows each path with its status code. The banner, the flags used, the progress, and the status messages are left out. A run that finds nothing, or that fails before finding anything, leaves the box blank. Gowitness is different: it shows only "Scan finished successfully" or "Scan failed (exit code N)", because its screenshots go to Image Storage. Other workers show "No scan output yet" until a run ends.

`[Copy]` copies the box's text.

A File name field defaults to `<worker>-scan-output` and can be edited. To save, choose `[.txt]` or `[.md]` from the picker, then click Save to Project's Folder. The file is named `<name>-<timestamp>.<format>`; a blank or path-containing name falls back to the default. A `.md` file wraps the output under a `# Scan Output` heading in a code block. A `.txt` file holds the result lines. Saving needs a profile.

To send to Telegram, pick a chat from the Telegram chat dropdown, or leave All chats, then click Send to chat. Chapter 6 describes the setup.

If a run finishes while you are on another worker or the overview, its result is still waiting here when you come back to this worker, in this browser tab -- it is not lost just because the box was not open when the run ended.

### 5.4 Troubleshooting

- Save says "No profile selected": choose a profile in the header.
- The wordlist disappeared after switching workers: the text is not saved. Save it before leaving the worker view.
- A json or yaml file has fewer lines than you typed: blank lines are removed for these formats. This is intended.
- The wordlist does not appear in a scan: a saved wordlist is not used automatically. Select it in a file-type flag.
- The terminal shows `could not reach the backend`: the backend is not running. Start it with `make core`.
- Send output says "No scan output yet" after a run: the worker is not wired, or the `[done]` line has not appeared yet.
- Send output is blank after a run: the run found no results, or it failed before finding any. This is expected.
- Save to Project's Folder says "Save failed": check that the profile still exists and that the backend is running.
- Send to chat is greyed out: Telegram is not configured, or the output box is empty.

## 6. Telegram

freighter-framework can send a worker's output to a Telegram chat, channel, or group as a Markdown file. The integration is one-way. freighter-framework never reads messages from Telegram.

### 6.1 What you need

- A bot token from @BotFather. It looks like `123456789:ABCdef...`.
- The ID of each destination. A group or private chat uses a negative number, such as `-1001234567890`. A public channel uses `@channelname`.
- The bot must be a member of the group, or an admin of the channel. Otherwise Telegram refuses the message.

The backend itself has no route to `api.telegram.org`; sends go out through a small `telegram-worker` container that exists only to relay them (see `telegram-worker/README.md`). This is invisible from the UI's point of view.

### 6.2 Configuring the bot

1. Open **[ settings ]** and choose **Telegram bot...**.
2. Paste the token into **Bot token**. The token is write-only. The dialog never shows it again, only whether one is set.
3. Under **Chats**, add a row for each destination. The label is a name you choose, and it appears in the dropdown. The chat ID is the number or `@name`. Use `[+]` to add a row, and `[x]` to remove one. The limit is 20 chats.
4. Click **save telegram**. The status changes to "Configured · N chats".

The backend checks each value:

- The token must look like `digits:letters`, with at least 30 characters after the colon.
- A chat ID must be a number, or an `@name` of at least 5 characters.
- A label can be up to 60 characters. A blank label uses the chat ID.
- Leaving the token blank keeps the existing token.

### 6.3 Sending output

Open a wired worker and run it. When the run finishes, the output appears in the Send output box. Pick a chat from the dropdown, or leave All chats, then click Send to chat. The button is enabled only when Telegram is configured and the box holds output.

The hint line reports each destination, for example "Team channel: sent" or "Team channel: failed (...)".

Telegram receives a file named `freighter-output-YYYYMMDD-HHMMSS.md`. The output is wrapped in a code block.

Limits: the output must be 2 MB or less. Each send times out after 60 seconds. Sends are not queued, so retry a failed send by hand.

### 6.4 Things to know

- Gowitness has no text to send. Its screenshots go to Image Storage, and its ledger findings (section 3.7) are a one-line "Screenshot captured" per screenshot, not something worth sending as a chat message.
- Only wired workers produce output for this panel.
- The token is stored in `data/telegram/settings.json`. The file is git-ignored. On Linux and WSL it is restricted to its owner. Windows does not enforce this, so keep the project folder private there.
- The browser never sees the token. The chat list and sends go through the backend.
- Saving settings refreshes the chat list in open panels immediately.

### 6.5 Troubleshooting

- "the bot token does not look like a Telegram token": the token is mistyped or truncated. Copy it again from BotFather.
- "chat id must be a number such as -1001234567890, or @channelname": check the ID, including its minus sign.
- "the Telegram bot is not configured": save a token in settings.
- "no configured chat matches that chat id": reopen the worker view or save settings again.
- "Telegram is unreachable": the `telegram-worker` container cannot reach api.telegram.org, or is itself down. Check `make logs S=telegram-worker`.
- Telegram says "chat not found" or "bot was blocked": add the bot to the group or channel, and make it an admin for a channel.
- "output is larger than 2 MB": trim the output, or save it locally.
- Send stays disabled: the output box is empty, Telegram is not configured, or the worker has no output.

## 7. MCP client

The MCP gateway exposes freighter-framework's workers to MCP-compatible clients, such as Claude Desktop or LM Studio. A client calls a worker as a tool. The gateway runs it in the worker's container and returns the result. The client calls in to the gateway, so freighter-framework never needs the client's address.

### 7.1 How the pieces fit

Workers are the tool containers. The gateway listens on port 8811 and offers each enabled worker as an MCP tool. Settings **[ settings ] → MCP gateway...** controls which workers are offered and the default timeout. It writes `data/mcp-gateway/config.json`, and the gateway reloads that file on its next request.

The freighter-framework chat agent uses the same gateway. A worker hidden from MCP clients is also hidden from the chat agent.

### 7.2 Checking the gateway

```
curl http://localhost:8811/healthz
```

The response should be `{"status":"ok"}`. If the container does not start, check its logs. An invalid `data/mcp-gateway/config.json` is the usual cause, and the log names the problem.

### 7.3 The endpoint

```
http://<host>:8811/mcp
```

On the same machine, use `http://localhost:8811/mcp`. From another machine on your LAN, use the Docker host's LAN IP. Do not use `mcp-gateway:8811`, which resolves only inside the Docker network.

### 7.4 Client configuration

Most clients that support the Streamable HTTP transport accept a block like this:

```json
{
  "mcpServers": {
    "freighter": {
      "type": "http",
      "url": "http://localhost:8811/mcp"
    }
  }
}
```

Key names differ between clients, so check yours. Clients that only support stdio need a separate stdio-to-HTTP bridge, which this project does not include. Restart the client after saving the configuration.

### 7.5 Tools and results

Each enabled worker becomes one tool named after its config key, such as `nmap` or `jwt-tool`. Every tool takes two arguments:

```json
{
  "args": ["-sV", "-p", "80,443", "example.com"],
  "timeoutSeconds": 600
}
```

`args` is the command-line argument list, one element per token. Use the worker's own README in `workers/<name>-worker/` to find its flags. `timeoutSeconds` is optional, and it overrides the default for one call. The default comes from settings, which allow values from 1 to 86,400 seconds.

A call returns a JSON result with these fields:

- `state`: `completed`, `timeout`, or `error`.
- `output`: stdout and stderr in order. The newest 256 KB are kept.
- `exitCode`: the tool's exit code, when the run finished.
- `route`: `local` in the default setup.
- `error`: a message when `state` is `error`.

A call blocks until the tool finishes or times out. Calls to `nosqlmap` and `metasploit` run as session workers, so they usually end with `timeout` and the output produced so far.

An MCP client cannot answer a prompt from a running tool. If a tool asks a question, the call waits until it times out. Use the live terminal for prompts, or pass flags that skip them.

### 7.6 Choosing which workers are offered

Open **[ settings ] → MCP gateway...**. Set the default timeout, and tick or untick each worker. Unticked workers are hidden from MCP clients. A call to a hidden worker returns `unknown worker`. Click **save mcp**. The change takes effect on the gateway's next request, without a restart.

The mode shown beside each worker is read-only here. Change modes only in `config.json`.

### 7.7 Routing modes

Each worker runs in one of three modes:

- `local` runs on this host. It is the default, and the only mode that needs no extra setup.
- `cloud` sends the job to a remote endpoint. It needs `cloud.enabled` set to true, an endpoint URL, and an API key in an environment variable. The key itself is never stored in the file.
- `auto` tries local first, then cloud. It also needs cloud enabled.

Cloud is disabled by default. Keep every worker on `local` unless you have set up a cloud endpoint on purpose.

### 7.8 Testing by hand

```
curl -s http://localhost:8811/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}'
```

A working gateway replies with the server name `freighter-mcp-gateway`. Send `tools/list` to list the tools, and `tools/call` with `name` and `arguments` to run one.

### 7.9 Security

The gateway does not require authentication. Anyone who can reach port 8811 can run every enabled tool against any target. The gateway also sends `Access-Control-Allow-Origin: *`.

Before you expose port 8811 beyond your own machine, restrict who can reach it. Use a firewall, or bind the published port to `127.0.0.1` in `docker-compose.yml`. Enable only the workers you need. Use these tools only on systems you are authorized to test.

### 7.10 Troubleshooting

- The client shows no tools: check the URL, restart the client, and confirm at least one worker is enabled. Run the `tools/list` test.
- `connection refused` on 8811: the gateway container is not running.
- It works on the host but not from another machine: use the host's LAN IP, and check the firewall.
- `unknown worker "x"`: the worker is disabled in settings, or missing from `config.json`.
- `worker unreachable`: the worker container is down.
- `timeout` on every call: the run is longer than `timeoutSeconds`, or the tool is waiting for input.
- `local failed ... cloud fallback also failed`: in `auto` mode, check both the local worker and the cloud endpoint.
- The gateway logs "config reload failed, keeping previous config": the file is invalid. The gateway keeps the last good version, so fix the file and save it again.
- The Settings dialog says "Could not load settings": the backend cannot read `config.json`.

### 7.11 Cloud model (chat agent)

The same **[ settings ] → MCP gateway...** dialog has a **Cloud model** control, below the worker list. This is unrelated to the `cloud` routing mode in section 7.7: that switches worker *job execution* between local and remote; this switches the chat agent's *model* between the hosted Anthropic model and none.

Tick **Enable cloud model (Anthropic)**, paste an API key, and click **save cloud model**. The status line reads On or Off, and whether a key is set. The change takes effect on the chat agent's next message -- no restart, because the backend reads the toggle and key fresh on every request instead of only at startup.

The key is write-only, like the Telegram token (section 6): the dialog shows only whether one is set, and the field clears after saving. It is stored in `data/llm/settings.json`. When no key has been saved through the dialog, the chat agent falls back to the `ANTHROPIC_API_KEY` environment variable from section 2.1, so a deployment that only sets that variable needs no change here.

Unticking **Enable cloud model** turns the Anthropic option off even if `ANTHROPIC_API_KEY` is set. The chat's model dropdown drops to "no model configured" if that was the only provider, and only `/worker` commands still run.

### 7.12 Local model (chat agent)

Below **Cloud model** is a **Local model** control for an OpenAI-compatible server you run yourself -- LM Studio, Ollama, or anything else that speaks the same API. This is a separate, independent model from the cloud one above; the chat's model dropdown offers both together when both are configured.

1. Tick **Enable local model (OpenAI-compatible)**.
2. Enter the server's **Base URL**, for example `http://host.docker.internal:1234` for LM Studio or `http://host.docker.internal:11434` for Ollama -- `host.docker.internal` is the one address that reliably reaches the Docker host from inside the backend container on every platform (docker-compose.yml sets it up for Linux's Docker Engine too; Docker Desktop on Windows/Mac defines it already). A host-specific gateway IP, such as a Docker bridge or WSL vEthernet address, may work from your own shell but still be unreachable from the backend's own container network, so prefer this name over guessing one. If the URL has no path, `/v1` is appended automatically when it is saved.
3. Optionally paste an **API key** -- most local servers don't need one.
4. Click **[Fetch models]**. This asks the server (using whatever is currently typed, whether or not it's saved yet) which models it has loaded, and fills the dropdown with the answer. A server that reports none says so instead of listing anything.
5. Pick a model and click **save local model**.

The status line reads On or Off, the base URL, and whether a key is set. As with Cloud model, a save takes effect on the chat agent's next message, no restart needed. The API key is write-only: the dialog shows only whether one is set, and the field clears after saving. Settings are stored in `data/local-llm/settings.json`. When a field hasn't been saved through the dialog, it falls back to its matching environment variable from section 2.1 (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`), field by field.

Unticking **Enable local model** turns it off even if those environment variables are set. If it was the only configured provider, the chat's model dropdown drops to "no model configured", and only `/worker` commands still run.

## 8. Replacing a worker's Docker image

There are two ways to replace a worker's image. You can change the base image that our Dockerfile builds from, or you can point the service at a pre-built image and skip our Dockerfile.

### 8.1 The contract every worker must satisfy

Any replacement must serve the same API on its port, which defaults to 8080 and is set by `<TOOL>_WORKER_PORT`:

- `GET /health` returns `{"status":"ok"}`.
- `GET /status` returns `{"state":"running"}` or `{"state":"idle"}`.
- `POST /run` takes `{"args":[...]}`. It returns 202 to accept, and 409 if a run is already in progress.
- `POST /pause` suspends the run in progress, like Ctrl+Z on the tool. `POST /resume` continues it, like `fg`. Both act on the tool's process group, never the container.
- `POST /stop` interrupts the run in progress, like Ctrl+C on the tool. The worker goes idle and stays up. A tool that ignores SIGINT is killed after 5 seconds. A replacement without these two routes still runs tools, but the live terminal's Pause fails against it.
- `GET /ws` streams JSON frames with a `type` of `line`, `result`, or `error`. Findings arrive in the `findings` array of the `result` frame.
- `GET /output` serves files written by the tool. It is needed only if the tool has output flags.

If a replacement does not speak this API, the backend's worker client reports it as unreachable, and nothing works.

### 8.2 Method 1: Change the base image

Use this to keep our wrapper and change the tool's base image, for example to pin a version or use a different distribution.

1. In `data/worker-images.env`, change the worker's `<WORKER>_TOOL_IMAGE=` line to your chosen image (section 2.1). The runtime stage of `workers/<tool>-worker/Dockerfile` reads it as `FROM ${TOOL_IMAGE}` -- there is no literal image name in the Dockerfile to edit.
2. If the new image uses a different package manager than before and the Dockerfile installs anything into it (uncommon -- most workers only copy the wrapper binary in, see 9.3), update those install commands. Keep the non-root user and the `ENTRYPOINT`/`CMD` lines, which make the container stop and restart cleanly.
3. Run `docker compose --env-file ./data/worker-images.env build <tool>-worker` (`make build` if you use the Makefile route -- its `COMPOSE` variable already includes `--env-file`).

To hardcode an image directly in the Dockerfile instead of going through `data/worker-images.env` -- for a one-off, permanent pin that does not depend on the env file -- replace the runtime stage's `FROM ${TOOL_IMAGE}` with a literal `FROM your-chosen-image` and remove the `ARG TOOL_IMAGE` line above it. `mcp-gateway/Dockerfile` (which has no `TOOL_IMAGE` arg at all, by design) was changed this way; it moved from a prebuilt gateway image to a custom multi-stage Go build. Its header comment describes the change.

### 8.3 Method 2: Use an external pre-built image

Use this when another image already meets the contract above.

1. In `docker-compose.yml`, find the worker's service block. Delete its `build:` section, and add `image:` with the image name:

```yaml
gau-worker:
  image: your-registry/your-gau-fork:latest
  networks:
    - backend-network
    - mcp-to-workers-network
    - workers-to-web-network
  container_name: gau-job
  environment:
    - GAU_WORKER_PORT=8080
```

2. Keep these unchanged:
   - The service name, such as `gau-worker`. The backend finds the worker by this name, at `http://gau-worker:8080`.
   - The `networks:` entries. Without `backend-network` the backend cannot reach the worker, and without `workers-to-web-network` the worker has no route to the targets it scans.
   - The port variable. If the new image uses a different port, change the value. The image must also read that variable name, so check its documentation.
   - Any `volumes:` entries, such as `./data/project-storage:/data/project-storage:ro` and `./data/wordlists:/data/wordlists:ro`. Keep them if the tool uses file or output flags.
   - The `platform:` entry for this service in `docker-compose.override.yml`, if it has one. Remove the entry once the new image publishes an architecture that matches your host, or keep it if you want the pin.
3. Run `docker compose pull <tool>-worker`, then `docker compose up -d <tool>-worker`.

The nosqlmap worker is currently built from our own code. Chapter 10 describes that worker.

### 8.4 Verifying

Check that the worker answers. If its port is published, run `curl http://localhost:<port>/health`. Otherwise, run `docker compose exec <tool>-worker wget -qO- http://localhost:8080/health`. The reply must be `{"status":"ok"}`.

Then start one real run from the control panel. The result should reach the ledger with the standard fields. If the health check fails, the port or variable name does not match what the backend expects.

## 9. Adding a new worker

This chapter walks through adding a new tool, called `<tool>` here, across the worker container, the backend, and the frontend. Follow the steps in order, because each one depends on the last.

### 9.1 Choose the language

The wrapper can be Go or Python, whatever the tool itself uses. Go is the common choice. Clone the closest existing worker, such as nmap-worker or wpscan-worker, which wrap non-Go tools. Python is the alternative. See dirsearch-worker for a Python example.

### 9.2 Read the tool's help first

Before you map any flags, save the tool's help output to `.github/worker_instructions/<tool>.md`. Every flag list in this project is mapped one to one from these files. Guessed flags cause bugs. Leave out help and version flags, self-update flags, and anything that needs an interactive prompt.

### 9.3 Build the worker container

Create `workers/<tool>-worker/` with the wrapper code (`main.go` and `ws.go`, or `server.py`), a `Dockerfile`, and a `README.md`.

The wrapper must serve the API in section 8.1. Its `POST /run` takes an argument list and starts the tool directly, never through a shell. Only one run may be active at a time. Start the tool in its own process group, so pause, resume, and stop reach the tool and its children without touching the container. `workers/subfinder-worker/control.go` and `workers/dirsearch-worker/server.py` show the two patterns.

Each output line is broadcast over `/ws`. When the tool exits, the wrapper sends a `result` frame with the exit code and the findings.

Each finding has these fields: `severity`, `target`, `path`, `port`, `title`, `description`, `remediation`, `worker`, and `date`. Use exactly these names. `target` is the bare host; `path` is the full URL or other location the tool actually hit, when there is one (empty otherwise, e.g. gitleaks' finding is a file path, not a URL, so it has no `target`). Leave `port` empty rather than guessing -- every worker's own `portFor`/`port_for` helper (see `hostOnly`/`host_only` next to it) fills it in from `path`'s URL at read time: an explicit port if the URL has one, else 80/443 by scheme, else 443 for a bare host with no scheme. Copy the pattern from the closest existing worker rather than writing a new one.

The backend also attaches two fields your worker never sets: `vulnKey`, a deterministic identity derived from `worker`/`target`/`port`/`title`, and `status` (`ACTIVE`, `N_A`, or `FALSE_POSITIVE`), looked up by that key from the vulnerability database (`VulnerabilityStatusService`, called from the controller's `findings()` route the same way `FindingTemplateService` already is -- see 9.5). A new worker gets both automatically once its controller calls both, with no extra code of its own.

Add a row for the new worker to the `finding_templates` table (the latest `V0xx__*.sql` migration follows this one) so its findings get real description/remediation text instead of whatever it already wrote -- see `FindingTemplateService`'s own doc comment for the placeholders available ("how", not "what", tips work best: name the exact command, config line, or code change, not just the general idea).

Findings come from one of two sources:
- If the tool can write a structured report, parse that. dirsearch-worker forces JSON output this way.
- Otherwise, match a line pattern in stdout. masscan-worker matches open ports, and wpscan-worker matches lines that start with `[!]`.

Severity needs care. If the tool reports a range of severities, set the value per finding, as wpscan-worker does with its `resolveSeverity` function. If every finding is the same severity, a fixed value is fine.

Use a multi-stage Dockerfile, so build tools stay out of the final image. Run as a non-root user, under a small init process, as the existing workers do.

Create the shared mount points in the build stage, not in the tool image. Build-stage `RUN mkdir -p /data/project-storage /data/wordlists` runs as root, and the runtime stage then takes them with `COPY --from=build --chown=10001:10001`. Do not run `mkdir` or `chown` in the tool image, because that depends on the tool's distro and user. A Python-only worker has no Go build stage, so give it a small build stage on `golang:1.23-alpine` that only creates these directories. The existing Python workers do this. List only the directories the worker mounts.

### 9.4 Add the Compose service

Copy an existing worker's service block, and change the names:

```yaml
<tool>-worker:
  build:
    context: ./workers/<tool>-worker
    dockerfile: Dockerfile
    args:
      TOOL_IMAGE: ${<TOOL>_TOOL_IMAGE}
  networks:
    - backend-network
    - mcp-to-workers-network
    - workers-to-web-network
  container_name: <tool>-job
  environment:
    - <TOOL>_WORKER_PORT=8080
  restart: unless-stopped
```

Add the project-storage volume only if the tool uses file or output flags. Add the wordlists volume, `./data/wordlists:/data/wordlists:ro`, if the tool reads wordlists. The Dockerfile must create `/data/wordlists` as section 9.3 describes. The service name is how the backend finds the worker, so keep it.

Add a `<TOOL>_TOOL_IMAGE=` line to `data/worker-images.env` too -- that is where its value actually comes from (see 2.1), read by the `docker compose` CLI on the host via `--env-file`, never mounted into any container. The new worker's own `Dockerfile` declares `ARG TOOL_IMAGE` with no default, same as every existing one.

### 9.5 Backend classes

Create `backend/src/main/java/com/example/application/workercontrollers/<tool>/`. Copy the package from the closest existing tool. gau is a simple model for a tool that takes a bare target. sqlmap and xsstrike are models for tools that take flags.

The package needs six classes:
- `<Tool>Flags` holds the allowed flags, which flags take a value, which take files, which write output, and the required-flag check.
- `<Tool>Controller` exposes the `run`, `stop`, `pause`, `resume`, and `findings` routes. The pause and resume routes call the run service's `pause()` and `resume()`, which call the worker client's `POST /pause` and `POST /resume`. Copy them from the closest existing tool. The `findings` route calls both `findingTemplates.apply(findings, "<tool>")` and `vulnerabilityStatus.apply(findings, "<tool>")` right before returning -- independent of each other, so either order is fine; every existing controller just happens to call them in that order.
- `<Tool>RunService` manages the job. It stages file flags and output flags.
- `<Tool>WorkerClient` calls the worker.
- `<Tool>RelayHandler` relays the worker's WebSocket to the browser.
- `<Tool>WebSocketConfig` registers the relay path.

If a flag writes a file the user should keep, wire output staging as `SqlmapRunService`, `HydraRunService`, and `WpscanRunService` do. Check first that the worker does not depend on that file for its findings.

If the tool name contains a hyphen, leave it out of the Java class names only. Keep the hyphen in routes, worker IDs, and service names, as `jwt-tool` does.

File flags go through `ProjectFileStager.resolve`, which accepts both Project Folder names and `wordlists/` paths. A `RunService` that stages its file flags through it accepts a picked wordlist with no extra code.

Spring finds the new classes automatically. There is no registry file to edit.

### 9.6 Frontend

Create `frontend/public/js/components/worker_components/<tool>-panel.js`, using the closest existing panel as a model. Its flag list must match the backend's `<Tool>Flags` exactly.

Add a result rule for the tool in `RESULT_RULES` in `frontend/public/js/scanResults.js`. A rule is a line test that keeps only the lines that mean a result was found. Without one, the tool's Send output stays blank after every run.

In `frontend/public/js/index.js`, add the panel to `loadControlPanel()` before the generic fallback:

```js
if (worker.startsWith('<tool>')) return import('./components/worker_components/<tool>-panel.js');
```

In `frontend/public/js/wiredWorkers.js`, add `'<tool>'` to `WIRED_WORKERS`. Skip this only if the tool has no non-interactive command line.

In `frontend/public/js/components/links.js`, add `'<tool>-worker'` to a group in `DEFAULT_GROUPS`. Users who already have a saved sidebar order get the new entry automatically.

If the tool reads wordlists, the panel also offers **Browse wordlists...** in each file popup. In `frontend/public/js/wordlistBrowser.js`, import `WORDLIST_BROWSE_HTML` and `bindWordlistBrowse`. Append the HTML after the Project Folder options, and call `bindWordlistBrowse(panel, pick)`, where `pick` receives the value to put in the flag. The panels that already do this, such as `dirsearch-panel.js`, are the models.

### 9.7 MCP, optional

To expose the worker to MCP clients, add an entry to `data/mcp-gateway/config.json`:

```json
"<tool>": { "baseUrl": "http://<tool>-worker:8080", "mode": "local" }
```

The gateway lists every enabled entry as a tool, so no gateway code changes are needed. Restart the `mcp-gateway` container after editing the file.

### 9.8 Checklist

- The worker's `/health` returns `{"status":"ok"}`.
- A run through `POST /run` produces a `result` frame with findings in the eight-field shape.
- `/api/<tool>/run` reaches the worker.
- The sidebar shows the tool, and its flags match the real command line.
- A run from the UI produces a ledger row.
- Pause and Unpause suspend and continue a run, and Stop returns the worker to idle without closing the terminal.
- Send output shows only the result lines of a run, and is blank for a run that finds none.
- If wired to MCP, `tools/list` includes the tool, and `tools/call` returns a result.
- If the tool reads wordlists: the worker's image creates `/data/wordlists`, the command preview shows `wordlists/<path>` for a picked wordlist, and the tool reads that file when the run starts.

## 10. Activating the nosqlmap worker

The nosqlmap worker is built and wired at the infrastructure level, but its frontend panel is removed, and the tool is not in the wired list. This chapter describes how to bring it into the UI. It applies when you have a NoSQLMap build that can be run from the command line with flags, since the upstream tool is menu-driven.

### 10.1 Confirm the command-line interface

Before changing any file, run the build's help command and write down:
- Every flag.
- Which flags take a value.
- Which flags take a file, such as a wordlist or config file.
- Which flags write an output file.

### 10.2 Worker

The worker is a Go server, not a Python one. Its files are `main.go`, `ws.go`, and `input.go`. The command it runs is set by a constant named `toolCommand` in `main.go`. It is currently `nosqlmap`, so change it to the build's real binary name if it differs. The worker runs the tool as a child process, and it keeps the tool's stdin open for prompts sent through `/input`.

The worker's Dockerfile must install the build, and the image must have it on its `PATH`.

Review the parsing of the tool's output. If the build can print a structured report, parse that instead of matching text.

Update the worker's README. It currently describes the worker as a menu-driven, long-lived session.

### 10.3 Backend

The package `backend/src/main/java/com/example/application/workercontrollers/nosqlmap/` already has six classes. Only `NosqlmapFlags.java` needs real changes:

- Add each real flag to the allowed-flags map, with whether it takes a value.
- If some flags are required, add a required-flags set and check it in the argument builder. Copy the pattern from `FuxploiderFlags`, or from `SqlmapFlags` for a single required flag.
- If a flag takes a file from the Project Folder, add it to the file-flags set.
- If a flag writes an output file, add it to the output-flags set. Then wire `NosqlmapRunService` the same way `SqlmapRunService`, `HydraRunService`, and `WpscanRunService` do.

The other five classes need no structural change. Remove the "dormant" comments from their Javadoc once the worker is live.

### 10.4 Frontend

The panel file, `nosqlmap-panel.js`, has been deleted. To recreate it, copy `sqlmap-panel.js`, or `hydra-panel.js` or `gau-panel.js` if the tool takes a target. Replace its flag list with the flags from step 10.1, in the same shape as the other panels.

In `frontend/public/js/index.js`, add the panel back to `loadControlPanel()`:

```js
if (worker.startsWith('nosqlmap')) return import('./components/worker_components/nosqlmap-panel.js');
```

In `frontend/public/js/wiredWorkers.js`, add `'nosqlmap'` back to `WIRED_WORKERS`. Remove the comment that explains why it was excluded.

### 10.5 Compose

In `docker-compose.yml`, find the `nosqlmap-worker` service. It is marked as a long-lived session worker, like metasploit-worker. Remove the "dormant" comment. If you changed the build context or image, update it. Keep the project-storage volume if any flag uses files or outputs.

### 10.6 Checklist

- The worker runs the real binary, and its findings parse.
- `NosqlmapFlags.java` lists the real flags, with required, file, and output flags set.
- The output-staging wiring is in place, if the tool writes output.
- `nosqlmap-panel.js` exists, and its flags match the tool.
- `index.js` registers the panel.
- `wiredWorkers.js` includes `nosqlmap`.
- The Compose service builds the right image, and stale comments are gone.

When all of these are done, run a real scan from the UI. Confirm that a finding reaches the ledger with the standard fields.

## 11. Custom nuclei templates

Nuclei needs a templates directory. This chapter describes how to put your templates in place, and what the current configuration does with them.

### 11.1 Where templates go

The nuclei worker fetches its templates from `./data/nuclei-templates` in the project folder. Compose bind-mounts that host folder into the worker at `/home/worker/nuclei-templates`, and nuclei reads from there. Templates are not baked into the image, so you place them in the host folder yourself.

Subfolders are fine, because nuclei searches recursively. The mount is live, so new files appear immediately, with no container restart.

Nuclei finds that path because it looks in `$HOME/nuclei-templates`. `workers/nuclei-worker/Dockerfile` sets `HOME=/home/worker`, so nuclei reads the mounted folder. After changing templates, rebuild the worker only if you changed the Dockerfile itself.

### 11.2 Copying or cloning templates

You can copy `.yaml` or `.yml` templates into `data/nuclei-templates/` on the host. You can also clone a template repository into that folder:

```
git clone https://github.com/projectdiscovery/nuclei-templates.git data/nuclei-templates
git -C data/nuclei-templates pull
```

A private template collection works the same way.

You can also add templates without touching the host filesystem: **[ file ] → Upload Nuclei Templates** (section 3.2) opens a folder picker and uploads everything inside it, preserving subfolders, straight into `data/nuclei-templates`.

### 11.3 Updating templates from the UI

The nuclei panel has `-ut` (update templates) and `-ud` (update template directory). Toggle `-ut` and run it like any other job. Nuclei installs the update into its default template directory, `/home/worker/nuclei-templates`. That is the folder `data/nuclei-templates` on the host, so the update lands where the worker reads it.

### 11.4 Limiting a scan

The nuclei panel offers these options:

- `-t` (templates) and `-w` (workflows) take files. The file picker lists only files from the Project Folder, so you cannot choose a template directory from it. The nuclei worker does not mount `data/wordlists`, so a wordlist from that folder cannot be used here.
- `-tags` runs only templates with the given tags, as a comma-separated list.
- `-a` runs only templates by the given authors.
- `-nt` runs only templates added in the latest release.
- `-tl` lists the templates that match the current filters, without scanning.
- `-validate` checks the templates you pass for errors.

### 11.5 Checking the upload

Toggle `-tl` and run it. The terminal lists each template that nuclei found. If your upload is missing from the list, check that the file is inside `data/nuclei-templates` on the host, and that the worker was rebuilt after the Dockerfile change. A template with invalid YAML is reported by nuclei's loader, so check the terminal output after a run.
