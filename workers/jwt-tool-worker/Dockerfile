# syntax=docker/dockerfile:1.7
#
# jwt-tool-worker: persistent HTTP+WS worker. A Python stdlib server (server.py) that
# stays idle between runs and execs `jwt_tool` as its own subprocess per run,
# streaming output live and producing ledger findings.
#
# Set JWT_TOOL_TOOL_IMAGE in ./data/worker-images.env to the Docker Hub image
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

# Some published jwt_tool images install the script on PATH only as
# jwt_tool.py, not as a bare `jwt_tool` command (what server.py execs, and
# what this worker's README documents as the TOOL_IMAGE contract). Add that
# PATH entry here, conditionally, so an image that already provides a real
# `jwt_tool` on PATH is left alone rather than shadowed.
RUN if ! command -v jwt_tool >/dev/null 2>&1 && [ -f /usr/local/bin/jwt_tool.py ]; then \
      ln -s /usr/local/bin/jwt_tool.py /usr/local/bin/jwt_tool; \
    fi

ENV HOME=/tmp \
    JWT_TOOL_WORKER_PORT=8080

USER 10001:10001

EXPOSE 8080

ENTRYPOINT ["python3", "/app/server.py"]
