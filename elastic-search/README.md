# Elastic-search

The search index for freighter-framework's vulnerability ledger. The backend writes each finding into the index, and the frontend reads search results directly from it. The index is a derived copy. The authoritative data lives in the backend's Derby database, so the index can be rebuilt at any time.

## Files

- `Dockerfile` builds on the official `elasticsearch` image from Docker Hub. The base image is named on its `ARG TOOL_IMAGE` line, the same way the worker images name their tool images. The Dockerfile only copies in the node settings and creates an empty keystore.
- `elasticsearch.yml` holds the node settings: single-node discovery, the HTTP and transport ports, and security set to off.
- `jvm.options.d/heap.options` sets the heap size.

## Network

The node is reachable only on two private Docker networks defined in `docker-compose.yml`. The backend uses one, and the frontend uses the other. The node is published to the host on port 9200 for local inspection only.

## Security

X-Pack security is disabled. The node relies on the private networks to stay unreachable from outside. If you ever expose this node beyond those networks, turn security on first.

## Container settings

The container runs with a read-only root filesystem, all capabilities dropped, and `no-new-privileges`. Three details of that setup are needed for Elasticsearch to start:

- The keystore is created at build time. The image's entrypoint would otherwise create it at startup, and the config directory is read-only.
- `/tmp` is mounted with `exec`. Elasticsearch unpacks its JNA native library there and maps it as executable. Docker mounts tmpfs `noexec` by default, which breaks startup.
- `path.data` and the logs directory are tmpfs mounts.

## Data

`path.data` points to a temporary filesystem in the container. The `./data/elasticsearch` folder is mounted read-only and does not hold the live index. Restarting the container drops the index. The authoritative findings remain in Derby.
