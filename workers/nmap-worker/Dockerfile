# syntax=docker/dockerfile:1.7
#
# nmap-worker: persistent HTTP+WS worker. A small Go server (main.go/ws.go) that
# stays idle between runs and execs `nmap` as its own subprocess per run,
# streaming output live and producing ledger findings.
#
# Set NMAP_TOOL_IMAGE in ./data/worker-images.env to the Docker Hub image
# you want (see that file's own header comment). The image must put the
# tool on PATH (see ../README.md).
ARG TOOL_IMAGE

# Build stage: compile the Go server only (no third-party Go modules).
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ws.go input.go control.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/nmap-worker .
RUN mkdir -p /data/project-storage /data/wordlists

# Runtime stage: the tool image plus the wrapper binary. The one package step
# is the libcap install below, which assumes an apt-based (Debian/Ubuntu) tool image.
FROM ${TOOL_IMAGE}

# Shared mount points (compose bind-mounts them read-only over these).
COPY --from=build --chown=10001:10001 /data/project-storage /data/project-storage
COPY --from=build --chown=10001:10001 /data/wordlists /data/wordlists

COPY --from=build --chown=10001:10001 /out/nmap-worker /app/nmap-worker

# NMAP_PRIVILEGED tells nmap to trust its file capabilities instead of
# requiring UID 0, which the raw scan types (-sS, -O) otherwise demand.
ENV HOME=/tmp \
    NMAP_WORKER_PORT=8080 \
    NMAP_PRIVILEGED=1

# Raw-socket access is granted to the binary itself (file capabilities),
# so the worker runs as UID 10001 and holds no capabilities of its own.
# setcap comes from libcap2-bin, installed here as root. Compose grants
# NET_RAW/NET_ADMIN to the container (bounding set) so the file capabilities
# can take effect.
USER 0:0
RUN apt-get update \
 && apt-get install -y --no-install-recommends libcap2-bin \
 && rm -rf /var/lib/apt/lists/* \
 && setcap cap_net_raw,cap_net_admin+eip "$(command -v nmap)"
USER 10001:10001

EXPOSE 8080

# The wrapper is PID 1 (no init shim). It reaps the tool processes it
# starts, which are its direct children.
ENTRYPOINT ["/app/nmap-worker"]
