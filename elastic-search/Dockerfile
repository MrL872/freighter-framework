# syntax=docker/dockerfile:1.7
#
# elasticsearch: single-node search index for the vulnerability ledger.
#
# Same pattern as the workers: the base is an official image from Docker Hub,
# named on the ARG line below. The only changes made on top of it are the node
# settings (elasticsearch.yml) and the heap size (jvm.options.d/heap.options).
# To use a different version, edit the ARG line.
ARG TOOL_IMAGE=elasticsearch:8.15.3

FROM ${TOOL_IMAGE}

# Replace the image's default node config with the one this project uses.
COPY elasticsearch.yml /usr/share/elasticsearch/config/elasticsearch.yml
COPY jvm.options.d/heap.options /usr/share/elasticsearch/config/jvm.options.d/heap.options

# The image's entrypoint creates the keystore at startup, which needs a
# writable config directory. The container's root filesystem is read-only, so
# create the (empty) keystore now instead. No secrets are stored in it.
RUN /usr/share/elasticsearch/bin/elasticsearch-keystore create

EXPOSE 9200 9300

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
    CMD curl --fail -s http://localhost:9200/_cluster/health || exit 1
