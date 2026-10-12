# Backend

Spring Boot API. It stores jobs, findings and project files, and it sends runs
to the worker containers over HTTP. It has no Docker access.

Browser requests reach this service under `/api/...`. The frontend server
strips the `/api` prefix, so `/api/nmap/run` is the `/nmap/run` mapping below.

## Packages

| Package | What it does |
|---|---|
| `Application.java` | Spring entry point |
| `controller/` | Shared endpoints: `ProjectFilesController` (`/project-files`), `ImagesController` (`/images`), `PreferencesController` (`/preferences`), `VulnerabilityController` (`GET /vulnerabilities/search`, `POST /vulnerabilities/status` for the ledger's bulk/single status actions, `DELETE /vulnerabilities/{vulnKey}`), `ApplicationController` (`/`) |
| `service/` | Storage and pipeline: `ProjectFileService`, `ImageFileService`, `WorkerOutputStager` (output files to a Project Folder), `WorkerResultService` (stores results), `VulnerabilityIngestService` and `ElasticsearchIndexer` (findings to Elasticsearch), `FindingTemplateService` and `VulnerabilityStatusService` (description/remediation and vulnKey/status, joined onto each `GET /<tool>/findings` response at read time -- not stored on the finding itself), `SessionService` |
| `persistence/` | Derby tables through `*Repository` classes. Each `*Record` is one row type |
| `workercontrollers/<tool>/` | One package per tool. See the next section |

## One tool package (`workercontrollers/<tool>/`)

| Class | Role |
|---|---|
| `<Tool>Controller` | HTTP endpoints: `POST /<tool>/run`, `/stop`, `/input`, `GET /<tool>/findings` (runs every finding through `FindingTemplateService.apply()` and `VulnerabilityStatusService.apply()` before returning) |
| `<Tool>Flags` | Validates the UI's flags into worker `args`. Some tools also remap file flags |
| `<Tool>RunService` | Creates the job and session, stages inputs and outputs, sends the run to the worker |
| `<Tool>WorkerClient` | HTTP calls to the worker: `/run`, `/stop`, `/input`, `/status`, `/output` |
| `<Tool>RelayHandler` | Relays the worker's WebSocket to the browser, and saves its `result` frame |
| `<Tool>WebSocketConfig` | Registers the relay endpoint |

Tool packages: `dirsearch`, `ffuf`, `fuxploider`, `gau`, `gitleaks`, `gowitness`,
`hydra`, `jwttool`, `katana`, `nmap`, `nosqlmap`, `nuclei`, `puredns`,
`shuffledns`, `sqlmap`, `sstimap`, `subfinder`, `wafw00f`, `wpscan`, `xsstrike`.
`masscan` and `metasploit` have no package yet.

## Flow of one run

1. The UI posts flags to `/api/<tool>/run`.
2. `<Tool>Controller` passes them to `<Tool>RunService`.
3. `<Tool>Flags` validates them, and `ProjectFileStager` copies the input files.
4. `<Tool>RunService` creates the job, and `WorkerOutputStager` rewrites any
   output flags to `/tmp/output/...`.
5. `<Tool>WorkerClient` sends `POST /run` to `http://<tool>-worker:8080`.
6. The UI opens `/api/ws/<tool>?jobId=...`. `<Tool>RelayHandler` forwards every
   worker frame to the browser.
7. On the `result` frame, `WorkerResultService` saves findings and output.

## Live terminal input

The live terminal starts a run with `interactive: true`, which opens the
worker's stdin. Runs started any other way (MCP, a direct API call) keep stdin
closed. `POST /api/<tool>/input` with `{"text": "..."}` goes to the worker's
`POST /input`. The controller answers 202 when the worker accepts the line and
409 when no run accepts input. The worker echoes the line as an `input` frame,
and the relay forwards it to every viewer.

## Configuration

`src/main/resources/application.yml` holds the defaults. Each tool has a
`<tool>.worker.base-url` that points at its compose service. Environment
variables override them (for example `NMAP_WORKER_URL`). The docker profile is
`application-docker.yml`.

## Vulnerability search (Elasticsearch)

| Class | Role |
|---|---|
| `ElasticsearchIndexInitializer` | Creates the index and its mapping on startup, retrying every 30 s until Elasticsearch is reachable. Also backfills a freshly created index from Derby (`VulnerabilityRepository.findAllActive()`), on a background thread, so existing records don't wait for their next upsert to become searchable |
| `ElasticsearchIndexer` | Pushes one `VulnerabilityRecord` into the index (`indexNow`/`indexAsync`), and deletes one (`deleteAsync`). Failures queue into `IndexQueueRepository` for `IndexRetryScheduler` instead of being retried inline |
| `ElasticsearchQueryService` | Builds and runs the query behind `GET /vulnerabilities/search` |

The index name is `vulnerabilities_v2`, versioned because Elasticsearch can't apply a mapping change to an existing index. Bumping it forces a fresh index (and the initializer's one-time backfill above) instead of silently keeping the old mapping on an upgrade.

The mapping defines a custom `lowercase_normalizer` (a `lowercase` filter) on the `target.keyword`, `affectedVersion.keyword` and `worker.keyword` subfields. Elasticsearch applies a normalizer to a `term`/`terms` query's value the same way it applies it at index time, so `ElasticsearchQueryService`'s exact-match filters (target, version) stay exact but case-insensitive with no code-side lowercasing needed. `worker` itself is `text` (not just `keyword`), so it's tokenized and searchable from the free-text box the same way `title`/`description`/`remediation`/`target`/`path` already were -- the free-text `multi_match` query covers all six fields.

## Chat agent (`chat/`)

Serves the right-hand chat sidebar. Browser calls go to `/api/chat/...`.

| Class | Role |
|---|---|
| `ChatController` | `GET /chat/models`, `GET /chat/tools`, `POST /chat/message`, `POST /chat/command`, `POST /chat/review` |
| `ChatService` | Agent loop (at most 8 tool rounds), direct commands, review. Caps tool output sent to the model at 32 KB |
| `McpGatewayClient` | JSON-RPC to the gateway's `POST /mcp`: `tools/list` and `tools/call` |
| `AnthropicLlmClient` | Anthropic Messages API |
| `OpenAiCompatibleLlmClient` | Any OpenAI-compatible server: Ollama, LM Studio, OpenAI |

Modes: `ask` (no tools), `agent` (the model may run worker tools through the
gateway, and each run is returned as a tool card), `plan` (no tools, proposes
commands). A `/worker args` line in the chat skips the model and calls
`POST /chat/command` directly.

Configuration (host environment, read by compose; keys never reach the browser):

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | blank | Enables the Anthropic provider when set. Fallback only -- a key saved through Settings' Cloud model control (see below) takes precedence |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Anthropic model |
| `LLM_BASE_URL` | blank | Enables the OpenAI-compatible provider, e.g. `http://host.docker.internal:11434/v1` for Ollama. Fallback only -- a base URL saved through Settings' Local model control (see below) takes precedence |
| `LLM_MODEL` | blank | Model name on that server. Same fallback-only precedence as `LLM_BASE_URL` |
| `LLM_API_KEY` | blank | Optional, for servers that require one. Same fallback-only precedence as `LLM_BASE_URL` |
| `MCP_GATEWAY_URL` | `http://mcp-gateway:8811` | Gateway the agent calls |

The backend joins `mcp-to-frontend-network` to reach the gateway. Without a
configured provider the chat still runs `/worker` commands.

## Settings (`settings/`)

The header's `[ settings ]` menu opens a dialog that reads and writes these through
`/api/settings/...`. The backend is the only process that writes these files. It checks
every value before it writes, and it writes through a temporary file that it then moves
into place.

| Class | Role |
|---|---|
| `SettingsController` | `GET /settings`, `PUT /settings/telegram`, `PUT /settings/mcp`, `PUT /settings/llm`, `PUT /settings/llm-local`, `POST /settings/llm-local/models`, `POST /settings/telegram/send` |
| `TelegramSettingsStore` | Bot token and chats in `data/telegram/settings.json` (`SETTINGS_TELEGRAM_DIR`) |
| `McpSettingsStore` | Default timeout and each worker's `enabled` flag in `data/mcp-gateway/config.json` (`SETTINGS_MCP_GATEWAY_CONFIG`) |
| `LlmSettingsStore` | The chat agent's cloud-model toggle and API key in `data/llm/settings.json` (`SETTINGS_LLM_DIR`) |
| `LocalLlmSettingsStore` | The chat agent's local-model toggle, base URL, API key and model id in `data/local-llm/settings.json` (`SETTINGS_LOCAL_LLM_DIR`) |
| `TelegramClient` | Sends one document through the Bot API (`sendDocument`). Outgoing only |

- The Telegram token and both LLM API keys are never returned. `GET /settings` says only whether each is set.
- Telegram: the token must look like `123456:...`. A chat id is a number such as `-1001234567890`, or `@channel`. Up to 20 chats.
- Send to chat posts the raw output as a `.md` file (up to 2 MB) to one chat, or to every configured chat.
- MCP: the timeout is 1 to 86400 seconds. Unknown worker names are rejected. A disabled worker is hidden from MCP clients. The gateway re-reads its config when the file changes, and a file that fails to load leaves the previous config in place.
- The gateway mounts `data/mcp-gateway` read-only. Only the backend has write access.
- LLM: `ChatService` calls `LlmSettingsStore.effectiveApiKey()` on every request instead of reading a fixed value at startup, so toggling the cloud model or saving a new key in Settings takes effect immediately, with no restart. When no key has been saved there, it falls back to the `ANTHROPIC_API_KEY` environment variable.
- Local model: same immediate-effect pattern through `LocalLlmSettingsStore.effective()`, falling back field-by-field to `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`. Saving a base URL with no path (e.g. `http://172.17.208.1:1234`) appends `/v1`, the prefix LM Studio, Ollama and most other OpenAI-compatible servers expect. `POST /settings/llm-local/models` calls that server's own `GET {base}/models` with whatever base URL/key the form currently has (not necessarily saved yet) so the Settings dialog can offer a dropdown of the models it has loaded.
