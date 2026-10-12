# Data

Everything freighter-framework stores on the host lives in this folder. Docker Compose bind-mounts each subfolder into the container that uses it. Deleting this folder erases all profiles, saved files, screenshots, findings, and settings.

## Folders

- `derby/` holds the main embedded database (profiles, jobs, findings). The backend creates it on first start.
- `project-storage/` holds Project Folder files, plus `.index.json`, which lists them. The backend writes it. Workers mount it read-only, to read input files.
- `image-storage/` holds screenshots, such as gowitness output, grouped per profile and then per scanned target. Only the backend writes here.
- `wordlists/` holds shared wordlists for the tools, such as dirsearch, ffuf, and puredns. Place files here yourself, or in subfolders, or add them from inside the app with **[ file ] → Upload Wordlists**. The control panel's **Browse wordlists...** option lists them. Every profile shares this folder. The backend mounts it read-write (so the upload option can write to it); every tool worker mounts it read-only, at `/data/wordlists`.
- `configs/` holds shared external config files for tools that can load one (dirsearch, ffuf, gau, gitleaks, katana, nuclei, subfinder, sqlmap, sstimap). Same shape as `wordlists/` above: place files here yourself, or in subfolders, or add them from inside the app with **[ file ] → Upload Configs**; the control panel's **Browse configs...** option lists them. Every profile shares this folder. The backend mounts it read-write; only the tool workers that accept a config-file flag mount it read-only, at `/data/configs`.
- `telegram/` holds `settings.json`, which contains the Telegram bot token and chat list. The backend writes it. The browser never reads it. Git ignores it.
- `mcp-gateway/` holds `config.json`, which controls which workers the MCP gateway offers and the default timeout. The backend writes it, and the gateway reads it.
- `llm/` holds `settings.json`, which contains the chat agent's cloud-model toggle and Anthropic API key. The backend writes and reads it. The browser never reads it. Git ignores it.
- `local-llm/` holds `settings.json`, which contains the chat agent's local-model toggle, base URL, API key and model id (LM Studio, Ollama, or any other OpenAI-compatible server). The backend writes and reads it. The browser never reads it. Git ignores it.
- `nuclei-templates/` holds the templates the nuclei worker uses. Place them here yourself, clone a template repo into it, or add them from inside the app with **[ file ] → Upload Nuclei Templates**. The backend and the nuclei worker both mount it read-write; the worker reads the folder at `/home/worker/nuclei-templates`.
- `docker-image-cache/` holds offline backups of the images this project pulls, made by `make save-images` and restored by `make load-images`. Per-machine runtime state, not bind-mounted into any container. Git ignores its contents.
- `elasticsearch/` holds everything the Elasticsearch container writes. `data/` is its index and `logs/` is its logs. Both are read-write mounts. The index is a derived copy of the Derby database, so it can be rebuilt. Git ignores its contents.
- `worker-images.env` is the one exception to "bind-mounted into the container that uses it" above: it holds every worker's `TOOL_IMAGE` Docker Hub reference (one `<WORKER>_TOOL_IMAGE=` line each), and the `docker compose` CLI reads it directly, on the host, via `--env-file` (see the `Makefile`'s `COMPOSE` variable) to fill in each worker's build args -- entirely before any image is built or any container exists. Nothing mounts it. See `../workers/README.md`.

## Keeping data

Stopping or removing containers keeps this folder. Back it up before you delete anything.
