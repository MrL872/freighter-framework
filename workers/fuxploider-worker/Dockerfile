# syntax=docker/dockerfile:1.7
#
# fuxploider-worker: persistent HTTP+WS worker. A Python stdlib server (server.py) that
# stays idle between runs and execs `fuxploider` as its own subprocess per run,
# streaming output live and producing ledger findings.
#
# Set FUXPLOIDER_TOOL_IMAGE in ./data/worker-images.env to the Docker Hub image
# you want (see that file's own header comment). The image must put the
# tool on PATH (see ../README.md) and `python3` (server.py is Python).

ARG TOOL_IMAGE

# Build stage: only creates the shared mount points as root, so the runtime
# stage can take them with the worker user's ownership.
FROM golang:1.23-alpine AS build
RUN mkdir -p /data/project-storage /data/wordlists

FROM ${TOOL_IMAGE}

# The base image may already default to a non-root user (some do); root is
# needed for the PATH symlink below. USER 10001:10001 further down still
# applies for everything the worker itself runs.
USER root

# Shared mount points (compose bind-mounts them read-only over these).
COPY --from=build --chown=10001:10001 /data/project-storage /data/project-storage
COPY --from=build --chown=10001:10001 /data/wordlists /data/wordlists

WORKDIR /app
COPY --chown=10001:10001 server.py /app/server.py

# Some published fuxploider images ship fuxploider.py as a script in /app
# instead of a `fuxploider` command on PATH (what server.py execs, and what
# this worker's README documents as the TOOL_IMAGE contract). Add that PATH
# entry here, conditionally, so an image that already provides a real
# `fuxploider` on PATH is left alone rather than shadowed.
RUN if ! command -v fuxploider >/dev/null 2>&1 && [ -f /app/fuxploider.py ]; then \
      ln -s /app/fuxploider.py /usr/local/bin/fuxploider; \
    fi

ENV HOME=/tmp \
    FUXPLOIDER_WORKER_PORT=8080

USER 10001:10001

EXPOSE 8080

ENTRYPOINT ["python3", "/app/server.py"]
