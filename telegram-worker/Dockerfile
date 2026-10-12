# syntax=docker/dockerfile:1.7
#
# telegram-worker: thin forwarding proxy to the Telegram Bot API. Unlike
# every other worker here it wraps no CLI tool -- see server.py's own header
# comment for why it exists and what it forwards. No TOOL_IMAGE arg, no
# multi-stage build: there is nothing to pull in beyond the stdlib and a
# non-root user.

FROM python:3.12-slim

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin worker

WORKDIR /app
COPY --chown=10001:10001 server.py /app/server.py

ENV TELEGRAM_WORKER_PORT=8080

USER 10001:10001

EXPOSE 8080

ENTRYPOINT ["python3", "/app/server.py"]
