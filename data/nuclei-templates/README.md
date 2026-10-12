# Nuclei-templates

Template collection for the nuclei worker.

This directory is bind-mounted into the `nuclei-worker` container at
`/home/worker/nuclei-templates` — see the `volumes:` entry for
`nuclei-worker` in `docker-compose.yml`. Templates are intentionally not
baked into the worker's image (see `workers/nuclei-worker/Dockerfile`),
so a user can drop their own template collection straight into this host
folder and have the worker pick it up — no `docker cp` or a throwaway
container needed to populate it, and no image rebuild needed to update
templates.

This file exists only to keep the otherwise-empty directory present in
git (Git does not track empty directories). The directory's actual
contents (the template files themselves) are per-deployment runtime
data, not something meant to be committed.
