# syntax=docker/dockerfile:1.7
#
# gowitness-worker: persistent HTTP+WS worker. A small Go server (main.go/ws.go) that
# stays idle between runs and execs `gowitness` as its own subprocess per run,
# streaming output live and producing ledger findings.
#
# The image MUST bundle Chromium: gowitness drives a headless browser, and
# this Dockerfile installs nothing itself. Screenshots reach disk through
# the backend, which saves each streamed screenshot into ./data/image-storage
# (the backend mounts that directory, and this worker does not need its own
# mount, so there is no second copy).
#
# Set GOWITNESS_TOOL_IMAGE in ./data/worker-images.env to the Docker Hub image
# you want (see that file's own header comment). The image must put the
# tool on PATH (see ../README.md).
ARG TOOL_IMAGE

# Build stage: compile the Go server only (no third-party Go modules).
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ws.go input.go control.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/gowitness-worker .
RUN mkdir -p /data/project-storage /data/wordlists

# Runtime stage: the tool image plus the wrapper binary. No package manager
# steps here, so the worker does not depend on the tool image's distro.
FROM ${TOOL_IMAGE}

# Shared mount points (compose bind-mounts them read-only over these).
COPY --from=build --chown=10001:10001 /data/project-storage /data/project-storage
COPY --from=build --chown=10001:10001 /data/wordlists /data/wordlists

COPY --from=build --chown=10001:10001 /out/gowitness-worker /app/gowitness-worker

ENV HOME=/tmp \
    GOWITNESS_WORKER_PORT=8080

USER 10001:10001

EXPOSE 8080

# The wrapper is PID 1 (no init shim). It reaps the tool processes it
# starts, which are its direct children.
ENTRYPOINT ["/app/gowitness-worker"]
