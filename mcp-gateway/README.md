# MCP-gateway

Routes MCP tool-calls to the freighter-framework worker containers (local) or a
configured cloud endpoint. `router.go` has the routing logic.

## Two APIs on one server

- **`/mcp`** -- real [Model Context Protocol](https://modelcontextprotocol.io)
  (JSON-RPC 2.0 over the "Streamable HTTP" transport). This is the endpoint
  any actual MCP client (Claude Desktop, LM Studio, Open WebUI, a local-LLM
  agent framework, ...) talks to. See `mcpprotocol.go`.
- **`/mcp/jobs`** and **`/mcp/workers`** -- this project's own
  non-standard REST API (plain JSON over HTTP, no JSON-RPC envelope). Useful
  for `curl`/debugging or a custom integration, but no compliant MCP client
  understands it. See `main.go`.

Every configured worker in `data/mcp-gateway/config.json` is exposed over
`/mcp` as one MCP tool, named after that worker's config key (e.g. `nmap`,
`sqlmap`, `wafw00f`). Each tool takes the same two arguments regardless of
which worker it targets:

```json
{
  "args": ["-u", "https://example.com"],
  "timeoutSeconds": 900
}
```

`args` is the argv the underlying CLI tool receives, exactly what
`/mcp/jobs` already expects -- see each worker's own `*Flags.java` /
`*-panel.js` for that tool's real flags. `timeoutSeconds` is optional and
overrides the gateway's configured default for that one call.

## Connecting a local LLM / MCP client

The gateway container's port 8811 is published to the host (see
`docker-compose.yml`'s `mcp-gateway` service: `ports: ["8811:8811"]`) --
nothing in this gateway needs to know your LLM's IP, because the connection
direction is the LLM's MCP client calling **in** to the gateway, not the
other way around. Point your client at:

```
http://<the host running docker compose>:8811/mcp
```

- Same machine as Docker: `http://localhost:8811/mcp`
- A different machine on your LAN: `http://<that host's LAN IP>:8811/mcp`
  (the host's IP, not any container's internal Docker-network address --
  `mcp-gateway:8811` only resolves inside the Docker network)

### Example client configuration

Most MCP clients that support the Streamable HTTP transport use a config
block shaped like this (exact key names vary by client -- check yours, but
the `url` + `type: "http"` shape below is the common one):

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

A client that only supports stdio-based MCP servers cannot connect directly
-- it would need a local stdio-to-HTTP bridge process pointed at the URL
above (several exist as small open-source shims); this gateway does not
ship one, since every mainstream client (Claude Desktop, LM Studio, Open
WebUI, etc.) already supports Streamable HTTP natively.

## What's deliberately not implemented

See `mcpprotocol.go`'s own module doc for the full list (resources, prompts,
sampling, JSON-RPC batching, server-initiated SSE push) and why none of
them are needed for this gateway's job-routing use case.

## Workers that already speak MCP

The gateway reaches a worker over HTTP: it sends `POST /run` to the worker's
`baseUrl` from `data/mcp-gateway/config.json`. Any worker image can therefore
replace an HTTP worker if it serves the same `/run` endpoint.

Two workers, `nosqlmap` and `metasploit`, are session workers. Their own HTTP wrappers are the default, and an image
that already ships an MCP wrapper can take the same place. Set that image in
`data/worker-images.env`, on the worker's `_TOOL_IMAGE=` line.

## How a call returns

The gateway starts the run with `POST /run`, then polls the worker's `/status`
until it is idle. It reads the run's frames from `GET /history` and returns:

- `state`: `completed` when the tool finished, `timeout` when the call's
  `timeoutSeconds` ran out first (the gateway then sends `POST /stop`), or `error`
- `output`: stdout and stderr lines in order, with `> text` for input you sent and
  `[error]` lines. The newest 256 KB are kept.
- `exitCode`: the tool's exit code, when the run finished

A session worker (`nosqlmap`, `metasploit`) keeps running until the timeout, so
its call returns `timeout` with the output produced so far.

MCP clients cannot send input to a running tool yet. Answering prompts is
possible only from the live-feed terminal.
