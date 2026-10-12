# syntax=docker/dockerfile:1.7
#
# wafw00f-worker: persistent HTTP+WS worker. A Python stdlib server (server.py) that
# stays idle between runs and execs `wafw00f` as its own subprocess per run,
# streaming output live and producing ledger findings.
#
# Set WAFW00F_TOOL_IMAGE in ./data/worker-images.env to the Docker Hub image
# you want (see that file's own header comment). The image must put the
# tool on PATH (see ../README.md) and `python3` (server.py is Python).

ARG TOOL_IMAGE

# Build stage: only creates the shared mount points as root, so the runtime
# stage can take them with the worker user's ownership.
FROM golang:1.23-alpine AS build
RUN mkdir -p /data/project-storage /data/wordlists

FROM ${TOOL_IMAGE}

# Shared mount points (compose bind-mounts them read-only over these).
COPY --from=build --chown=10001:10001 /data/project-storage /data/project-storage
COPY --from=build --chown=10001:10001 /data/wordlists /data/wordlists

WORKDIR /app
COPY --chown=10001:10001 server.py /app/server.py

ENV HOME=/tmp \
    WAFW00F_WORKER_PORT=8080

USER 10001:10001

EXPOSE 8080

ENTRYPOINT ["python3", "/app/server.py"]
