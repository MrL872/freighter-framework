# Docker image cache

A local, offline backup of the base images `make build`/`make up`/`make
workers` pull from Docker Hub — every image named in a plain `FROM` line
anywhere in this repo's Dockerfiles (`maven`, `eclipse-temurin`, `golang`,
`node`, `alpine`, `python`, ...), plus whatever `TOOL_IMAGE` you've set in
`data/worker-images.env`.

Run `make save-images` once while the registry is reachable to populate this
folder with `docker save` tarballs. If a later build can't reach docker.io —
a registry outage, an auth/token-service hiccup, rate-limiting, no network at
all — run `make load-images` first: it restores every tarball here straight
into the local Docker image store with `docker load`, no network involved,
so the next build resolves those `FROM` lines purely from the local cache.

This is a backup/restore pair, not a permanent pin: it doesn't change any
Dockerfile, and a normal build still prefers whatever's newest once the
registry is reachable again. Re-run `make save-images` whenever you want a
fresher snapshot.

Nothing here is committed (see `.gitignore`) — these tarballs are per-machine
runtime state (tied to this machine's CPU architecture and whichever
`TOOL_IMAGE` values you configured), not a release artifact. This file exists
only to keep the otherwise-empty directory present in git.
