# freighter-framework launcher. Run `make help` for the list of targets.
# Needs GNU make, awk, and a running Docker daemon on this machine.
#
#   make up                 everything
#   make core               backend, frontend, mcp-gateway, elasticsearch
#   make workers            all worker containers
#   make logs S=backend     follow one service (S optional)

COMPOSE ?= docker compose --env-file ./data/worker-images.env
CORE := backend frontend mcp-gateway elasticsearch
# Worker service names, read from the compose file (keys named *-worker).
WORKERS := $(shell grep -E '^  [a-z0-9-]+-worker:' docker-compose.yml | tr -d ' :')

# Local, offline image cache (see save-images/load-images below) -- a backup
# of the base images this project's own builds pull, restorable without
# contacting docker.io when the registry itself is flaky/rate-limiting.
# Never committed (see .gitignore) -- it is per-machine runtime state, not a
# release artifact, and it only ever holds plain public Docker Hub images
# this repo already names, nothing specific to who ran the backup.
IMAGE_CACHE_DIR := data/docker-image-cache
# Every image pulled by a fixed, literal FROM tag somewhere in this repo
# (every worker's own ${TOOL_IMAGE} build arg has no fixed value here, so it
# can't appear in a plain FROM grep -- see TOOL_IMAGES below instead).
# Re-derived from the Dockerfiles themselves so this never drifts out of
# sync with a base image bump.
BASE_IMAGES := $(shell grep -rhE '^FROM ' --include=Dockerfile . 2>/dev/null | grep -v TOOL_IMAGE | awk '{print $$2}' | sort -u)
# Every TOOL_IMAGE actually set in data/worker-images.env -- a blank (not yet
# configured) line is skipped, same check check-images already does below.
TOOL_IMAGES := $(shell grep -E '^[A-Z0-9_]+_TOOL_IMAGE=.+' data/worker-images.env | cut -d= -f2-)
CACHE_IMAGES := $(BASE_IMAGES) $(TOOL_IMAGES)

.DEFAULT_GOAL := help
.PHONY: help check-docker check-images build up core workers down restart stop logs ps save-images load-images

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check-docker: ## Verify the Docker daemon is reachable
	@docker info >/dev/null 2>&1 || { echo "Docker daemon not reachable. Start it, see docs/rootless-docker.md"; exit 1; }

check-images: ## List data/worker-images.env variables whose image is still blank
	@blank=$$(grep -E '^[A-Z0-9_]+_TOOL_IMAGE=$$' data/worker-images.env | cut -d= -f1); \
	if [ -n "$$blank" ]; then \
		echo "These have no image set. Put a Docker Hub image on each line in data/worker-images.env:"; \
		echo "$$blank"; \
		exit 1; \
	fi

build: check-docker check-images ## Build every image without starting anything
	$(COMPOSE) build

up: check-docker check-images ## Build and start everything
	$(COMPOSE) up -d --build

core: check-docker ## Build and start backend, frontend, mcp-gateway and elasticsearch
	$(COMPOSE) up -d --build $(CORE)

workers: check-docker check-images ## Build and start all worker containers
	$(COMPOSE) up -d --build $(WORKERS)

stop: ## Stop containers without removing them
	$(COMPOSE) stop

down: ## Stop and remove containers (./data is kept)
	$(COMPOSE) down

restart: down up ## Stop everything, then start everything again

logs: ## Follow logs (all services, or one with S=<service>)
	$(COMPOSE) logs -f --tail=100 $(S)

ps: ## Show service status
	$(COMPOSE) ps

save-images: check-docker ## Back up every base/tool image this project uses to data/docker-image-cache, so load-images can restore them without the registry
	@mkdir -p $(IMAGE_CACHE_DIR)
	@for img in $(CACHE_IMAGES); do \
		if docker image inspect "$$img" >/dev/null 2>&1; then \
			file="$(IMAGE_CACHE_DIR)/$$(echo "$$img" | tr '/:@' '___').tar"; \
			echo "Saving $$img -> $$file"; \
			docker save -o "$$file" "$$img"; \
		else \
			echo "Skipping $$img (not pulled locally yet -- nothing to save)"; \
		fi; \
	done

load-images: check-docker ## Restore data/docker-image-cache's tarballs into the local image store -- no registry contact, for when docker.io is down or rate-limiting
	@if [ -z "$$(ls -A $(IMAGE_CACHE_DIR) 2>/dev/null)" ]; then \
		echo "Nothing saved yet -- run 'make save-images' first while the registry is reachable."; \
		exit 1; \
	fi
	@for f in $(IMAGE_CACHE_DIR)/*.tar; do \
		echo "Loading $$f"; \
		docker load -i "$$f"; \
	done
