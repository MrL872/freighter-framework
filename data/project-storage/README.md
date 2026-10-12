# Project-storage

Project Folder files: every file a user saves to a project, plus the
`.index.json` that lists them. The backend reads and writes this directory
through `ProjectFileService`, mounted at `/data/project-storage`.

Each worker mounts it read-only, so a tool can read its input files but never
writes here. Only the backend writes results, after a run finishes.

Contents are per-deployment runtime data and are not committed. This README
exists only so the directory stays in git.
