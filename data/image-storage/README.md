# Image-storage

Backing storage for images the backend generates or receives on behalf
of a project — currently gowitness's screenshots.

This directory is bind-mounted into the backend container at
`/data/image-storage` — see the `volumes:` entry in `docker-compose.yml`.
The backend's `IMAGE_STORAGE_DIRECTORY` setting points here (see
`backend/src/main/resources/application.yml`), and `ImageFileService`
is what reads/writes it.

Images are kept here as real files on disk, one file per image, rather
than as base64 strings embedded in a database column (Derby's
`ui_preferences` table used to hold them that way) — this directory is
what replaced that, so image data survives independently of the
database and can be served/streamed without decoding a blob first.

Layout: `<profileId>/<target>/<id>.<format>`, where `target` is the bare
host gowitness-worker resolved for that screenshot from its own
`--write-jsonl` report (e.g. `vulnlab`) — see `GowitnessRelayHandler` and
`ImageFileService`. A screenshot whose target couldn't be resolved (every
image saved before this per-target split existed, plus any future one
where resolution genuinely fails) sits directly under `<profileId>/`
instead, with no target subfolder; the frontend groups those under an
"Unsorted" heading.

This file exists only to keep the otherwise-empty directory present in
git (Git does not track empty directories). The directory's actual
contents are per-deployment runtime data, not something meant to be
committed.
