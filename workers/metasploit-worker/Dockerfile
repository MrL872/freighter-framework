# syntax=docker/dockerfile:1.7
#
# metasploit-worker: long-lived HTTP+WS session worker. A small Go server (main.go/ws.go) that
# starts the Metasploit Framework console (msfconsole) on POST /run, keeps it running until POST /stop, streams its
# output live, and forwards POST /input lines to its stdin, so interactive
# prompts can be answered from the live-feed terminal.
#
# The image MUST put `msfconsole` on PATH. Set METASPLOIT_TOOL_IMAGE in
# ./data/worker-images.env to the Docker Hub image you want (see that
# file's own header comment). An image with an MCP wrapper preinstalled
# can be used instead of this worker; see ../../mcp-gateway/README.md.
ARG TOOL_IMAGE

# Build stage: compile the Go server only (no third-party Go modules).
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ws.go input.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/metasploit-worker .

# Runtime stage: the tool image plus the wrapper binary. No package manager
# steps here, so the worker does not depend on the tool image's distro.
FROM ${TOOL_IMAGE}

COPY --from=build --chown=10001:10001 /out/metasploit-worker /app/metasploit-worker

ENV HOME=/tmp     METASPLOIT_WORKER_PORT=8080

USER 10001:10001

EXPOSE 8080

# The wrapper is PID 1 (no init shim). It reaps the tool processes it starts.
ENTRYPOINT ["/app/metasploit-worker"]
