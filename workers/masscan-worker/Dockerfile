# syntax=docker/dockerfile:1.7
#
# masscan-worker: persistent HTTP+WS worker. A small Go server (main.go/ws.go) that
# stays idle between runs and execs `masscan` as its own subprocess per run,
# streaming output live and producing ledger findings.
#
# Set MASSCAN_TOOL_IMAGE in ./data/worker-images.env to the Docker Hub image
# you want (see that file's own header comment). The image must put the
# tool on PATH (see ../README.md).
ARG TOOL_IMAGE

# Build stage: compile the Go server only (no third-party Go modules).
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ws.go input.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/masscan-worker .
RUN mkdir -p /data/project-storage /data/wordlists

# Runtime stage: the tool image plus the wrapper binary. The one package step
# is the libcap install below, which assumes an apt-based (Debian/Ubuntu) tool image.
FROM ${TOOL_IMAGE}

# Shared mount points (compose bind-mounts them read-only over these).
COPY --from=build --chown=10001:10001 /data/project-storage /data/project-storage
COPY --from=build --chown=10001:10001 /data/wordlists /data/wordlists

COPY --from=build --chown=10001:10001 /out/masscan-worker /app/masscan-worker

ENV HOME=/tmp \
    MASSCAN_WORKER_PORT=8080

# Raw-socket access is granted to the binary itself (file capabilities),
# so the worker runs as UID 10001 and holds no capabilities of its own.
# setcap comes from libcap2-bin, installed here as root. Compose grants
# NET_RAW/NET_ADMIN to the container (bounding set) so the file capabilities
# can take effect. libpcap0.8 is masscan's own packet-capture dependency --
# masscan dlopen()s it at runtime rather than linking it, so `ldd masscan`
# never shows it missing; without the package installed masscan fails every
# run with "failed to load libpcap shared library".
USER 0:0
RUN apt-get update \
 && apt-get install -y --no-install-recommends libcap2-bin libpcap0.8 \
 && rm -rf /var/lib/apt/lists/* \
 && setcap cap_net_raw,cap_net_admin+eip "$(command -v masscan)"
USER 10001:10001

EXPOSE 8080

# The wrapper is PID 1 (no init shim). It reaps the tool processes it
# starts, which are its direct children.
ENTRYPOINT ["/app/masscan-worker"]
