# Frontend

Browser UI served by a small Node server.

## Files

- `server.js` -- Express server on port 3000. It serves `public/` and proxies
  `/api/*` to the backend (`BACKEND_URL`, default `http://localhost:8080`), with
  the `/api` prefix removed. It also proxies WebSocket upgrades for the live
  feed, hosts `/search-direct` for the ledger's own read-only Elasticsearch
  route, and hosts `/manual`, which reads `MANUAL.md` fresh on every request
  (`MANUAL_PATH`, default one directory above this file -- the project root)
  for the header's Documentation window.
- `public/index.html` -- the page shell. No CDN links -- see "No CDN
  dependencies" below.
- `public/js/index.js` -- wires the components together. `wiredWorkers.js`
  lists the tools that have a working panel.
- `public/js/components/` -- panels: `control-panel.js` (flags and the Send
  button), `live-terminal.js` (live feed, Answer line, Stop), `ledger.js`
  (findings, the bulk status action bar, opens `vulnCard.js`), `vulnCard.js`
  (one finding's detail dialog: status actions, delete), `send-output.js`,
  `profile.js`, `search.js`, `settings.js`, `documentation.js`, `metrics/`,
  and the per-tool panels in `worker_components/`.
- `public/js/commandPreview.js` -- the command preview bar every worker
  panel shares (name fixed, flags editable). Typing over the flags parses
  and applies on a short debounce, the same as clicking the equivalent
  buttons; `commandParser.js` does the parsing. See "Command preview Reset"
  below for what `[Reset]` does once an edit has applied.
- `public/js/markdown.js` -- small hand-rolled Markdown-to-HTML renderer
  (headings, lists, fenced code, inline code, bold, `#anchor` links) used
  only by `documentation.js`. Not a general-purpose parser -- it covers
  exactly what `MANUAL.md` uses.
- `public/js/store.js`, `data.js`, `projectFolder.js`, `imageFolder.js` --
  state and calls to the backend. `workerSession.js` holds each worker's
  control panel flags and live terminal/send-output state outside any one
  component's mount, so switching a worker's view away and back (within the
  same tab) does not reset or interrupt them. `terminalFocus.js` backs the
  `[ view ] → Focus Live Terminal` toggle.
- `public/static/` -- stylesheets, including `worker-view.css`.
- `public/fonts/` -- self-hosted woff2 font file(s); see "No CDN
  dependencies" below.

## Live terminal

`live-terminal.js` posts flags and `interactive: true` to `/api/<tool>/run`, then opens
`/api/ws/<tool>?jobId=...`. It shows `line` and `error` frames, and an `input`
frame as `> text`. The Answer line posts to `/api/<tool>/input` while a run is
active. Stop posts to `/api/<tool>/stop`.

Its socket and buffered output live on `workerSession.js`, keyed by tool, not in the
component's own closure. Remounting (switching to another worker or the overview and
back) repaints the buffered output immediately and re-binds to the same still-open
socket instead of starting over -- `ws.onmessage`/`onclose`/`onerror` are reassigned
(not `addEventListener`) on each mount, since the socket outlives any one mount and a
second stacked listener would double-process every frame.

## Vulnerability ledger

`ledger.js` renders findings from `data.js`'s poll of every `/api/<tool>/findings`, or
from a search (`search.js`, via `/api/vulnerabilities/search`). Ticking row checkboxes
shows a bar with Mark Active/N/A/False Positive, which calls `POST /api/vulnerabilities/status`
with the ticked rows' `vulnKey`s. Clicking a row (not its checkbox or a Path link) opens
`vulnCard.js`, a single-finding dialog with the same status actions plus a delete
(`DELETE /api/vulnerabilities/{vulnKey}`, confirmed with a second click). A finding's
`status` overrides what the Severity column shows and sinks it below every other row,
without touching its real `severity`.

## Running

`docker compose` builds it from this folder (see `Dockerfile`). Locally:
`npm install` and `node server.js`.

## Chat sidebar

`chat.js` keeps sessions in this browser. A message starting with `/worker args`
runs that worker through `POST /api/chat/command`. Any other message goes to
`POST /api/chat/message` with the chosen mode (ask, agent, plan) and model. Each
tool run appears as a card with its output and a Review button, which posts to
`/api/chat/review`. The model list comes from `GET /api/chat/models`, and it is
empty when the server has no provider configured.

## Settings dialog

`[ settings ] > Telegram bot...` and `[ settings ] > MCP gateway...` open `js/components/settings.js`, each showing only its own section. The Telegram section shows
status, the chats (`[+]` adds one), and a token field. The saved token is never sent back to the browser. The MCP gateway section shows
the gateway's default timeout and a checkbox per worker, plus two separate chat-agent backend controls unrelated to the gateway's own
worker routing: Cloud model (a checkbox and an API key field, for Anthropic) and Local model (a checkbox, a base URL field, an optional
API key field, and a model dropdown, for LM Studio/Ollama/any other OpenAI-compatible server). `[Fetch models]` calls
`POST /api/settings/llm-local/models` with whatever base URL/key is currently typed (not necessarily saved) and fills the dropdown from
the server's own reported model list. Saving either backend control fires `settings:changed`, which `chat.js`
listens for to re-fetch `/api/chat/models`, so the model dropdown picks up the change without a page reload. Every save goes to `/api/settings`.
The browser never reads a settings file.

Send Output's **Send to chat** posts the raw output as a `.md` document, through
`/api/settings/telegram/send`. It is enabled only when a bot is configured and there is output.

## Documentation window

`[ help ] → Documentation` lazy-loads `js/components/documentation.js`, the same
on-first-use pattern as the Settings dialog above. It fetches this server's own
`GET /manual` (not `/api/...` -- `MANUAL.md` isn't a backend concern) and renders
it with `markdown.js`, building a sidebar table of contents from the heading
outline that render pass returns. Closable the same way as Settings: the `[x]`
button, Escape, or a click on the backdrop.

Clicking a sidebar entry, or a link inside the rendered text itself (its own
"## Contents" section), scrolls the content pane to that heading's id. A few of
`MANUAL.md`'s own hand-written Contents links don't match their heading's
auto-generated id character-for-character (documentation drift, not a rendering
bug); `resolveAnchor()` falls back to matching by the leading section number so
those still work.

## Command preview Reset

`commandPreview.js`'s `[Reset]` button covers two different things depending on
whether a typed edit has applied yet (flag-panel worker views only -- see
`commandPreview.js`'s own header comment for the cosmetic-only placeholder
panel's simpler behavior):

- **Not yet applied** (still inside the ~350 ms debounce, or the parse failed):
  clicking it discards the typed text and restores the last canonical command.
- **Already applied**: it stays visible, and clicking it reverts every panel
  flag back to whatever was active before that whole typing session started --
  however many edits applied in a row since, not just the last one. Pressing a
  flag button directly, instead of typing, retires that revert target: the next
  `[Reset]` press (if any) only covers a fresh in-progress edit again.

This is tracked by one `revertTarget` variable private to each `bindCommandPreview()`
call, set the moment a typing session first diverges from the panel's own
generated text and cleared by any re-render **not** caused by the override
itself applying (a direct flag-button press, `[Clear]`, or the revert itself
completing all route through the same `setGenerated()` call that clears it).

## No CDN dependencies

Nothing in this app loads from a CDN -- no bundler, no third-party script or
stylesheet host, nothing at `cdn.*`/`unpkg.com`/`jsdelivr.net`/etc. The one
exception this used to have was `index.html` loading the "Share Tech Mono"
typeface from `fonts.googleapis.com`/`fonts.gstatic.com`; that font is now
self-hosted (`public/fonts/share-tech-mono.woff2`, declared via `@font-face`
in `static/base.css`), so the UI renders correctly with no internet access,
which matters for an air-gapped or offline pentest environment. `markdown.js`
(Documentation window) and every other hand-rolled parser in this app exist
for the same reason: reaching for a CDN-hosted library isn't an option here.
