# syntax=docker/dockerfile:1.7
#
# mcp-gateway: the execution/routing layer between the frontend and MCP
# worker containers (see main.go's header comment). Multi-stage build: the Go
# toolchain is used only in the build stage and never ships in the runtime image,
# the same pattern as workers/subfinder-worker/Dockerfile.

# --------------------------------
# Build stage: compile the gateway only. No third-party Go modules (see
# go.mod) -- config/router/job handling are all stdlib.
# --------------------------------
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/mcp-gateway .

# --------------------------------
# Runtime stage: minimal Alpine base with only dumb-init, CA certs (for
# outbound HTTPS to a cloud MCP endpoint), and the compiled binary -- no
# shell-dependent tooling, package managers, or dev dependencies.
# --------------------------------
FROM alpine:3.20

ARG APP_USER=gateway
ARG APP_GROUP=gateway

# dumb-init as PID 1. Non-root user with no home
# directory and no login shell -- this service never needs one.
RUN apk add --no-cache dumb-init ca-certificates \
    && addgroup -S ${APP_GROUP} \
    && adduser -S -D -H -G ${APP_GROUP} -s /sbin/nologin ${APP_USER} \
    && mkdir -p /freighter-framework/data \
    && chown -R ${APP_USER}:${APP_GROUP} /freighter-framework/data

WORKDIR /app
COPY --from=build --chown=${APP_USER}:${APP_GROUP} /out/mcp-gateway /app/mcp-gateway

# Required configuration lives under /freighter-framework/data, supplied at
# runtime via a volume/bind mount -- never baked into the image. See
# docker-compose.yml's mcp-gateway service for the actual mount and
# docker-compose.yml's networks: section for the dedicated gateway/worker
# networks this process talks over.
ENV MCP_GATEWAY_CONFIG=/freighter-framework/data/config.json \
    MCP_GATEWAY_PORT=8811

USER ${APP_USER}

EXPOSE 8811

# dumb-init execs the gateway binary directly -- no shell wrapper as its
# direct child, forwarding SIGTERM/SIGINT so the gateway can shut
# down cleanly (main.go's own signal handling) instead of being killed.
ENTRYPOINT ["dumb-init", "--"]
CMD ["/app/mcp-gateway"]
