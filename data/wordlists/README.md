# Wordlists

Shared wordlist folder for the tools that take one (dirsearch, ffuf,
puredns, ...). The backend reads and writes this directory through
`WordlistService`, mounted read-write at `/data/wordlists`.

Place files here yourself, in subfolders if you like, or add them from
inside the app with **[ file ] → Upload Wordlists**. The control panel's
**Browse wordlists...** option lists them. Every profile shares this
folder.

Each worker that can take a wordlist mounts it read-only, so a tool can
read a wordlist but never writes here.

Contents are per-deployment runtime data and are not committed. This README
exists only so the directory stays in git.
