# Telegram-worker

A thin forwarding proxy to the Telegram Bot API. It is not a tool wrapper like the
other workers in this repo: the backend's own networks (`main-backend-network`,
`fourth-mcp-to-workers-network`) are internal and have no route to the internet, so
this container exists purely to give the backend a way to still reach
`api.telegram.org`, over its own dedicated egress network
(`ninth-telegram-to-web-network`).

## Files

- `Dockerfile` -- plain `python:3.12-slim`, non-root user. No `ARG TOOL_IMAGE`: there
  is no tool to wrap.
- `server.py` -- stdlib-only HTTP server. Forwards any `POST /bot<token>/<method>`
  request it receives to `TELEGRAM_API_BASE` (default `https://api.telegram.org`) at
  the same path, and relays the upstream response back unchanged.

## HTTP API (port `$TELEGRAM_WORKER_PORT`, default 8080)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/bot<token>/<method>` | forwarded as-is to `TELEGRAM_API_BASE/bot<token>/<method>`; any other path is 404 |

## Behavior

`backend/src/main/java/com/example/application/settings/TelegramClient.java` builds
the full request -- path, multipart body, `Content-Type` -- exactly as it would to
call `api.telegram.org` directly. Pointing `settings.telegram-api-base` at this
container (`SETTINGS_TELEGRAM_API_BASE=http://telegram-worker:8080` in the docker
profile) is the only change: `TelegramClient` itself needed none. This worker never
inspects the body, only validates that the path matches the Bot API's own shape
before forwarding, so it can't become a general-purpose relay to other hosts.

The bot token lives in the request path. `server.py`'s `log_message` redacts it
before writing to stderr.

## Called by

- Backend: `backend/src/main/java/com/example/application/settings/TelegramClient.java`,
  via `SettingsController`'s `POST /settings/telegram/send`.

## Notes

- Runs as UID 10001, read-only root filesystem (`read_only: true` in
  `docker-compose.yml`), all capabilities dropped.
- Not reachable from `mcp-gateway`: it is not an MCP-invokable tool.
