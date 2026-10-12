// Send output. Send to chat posts the raw output as a .md document through the
// backend, which holds the Telegram bot token (see backend/README.md, Settings).
// The chat list comes from the backend too, so the browser never sees the token.
// The review box
// above it, its copy action, and "Save to Project's Folder" are real —
// the latter writes through projectFolder.js to the same Derby-backed
// preferences store the sidebar's link order uses (see js/projectFolder.js
// and PreferencesController on the backend), scoped to the selected company
// profile — same as wordlist-template.js's own save action. The save format
// (.txt/.md) is picked from an expandable list next to the save button,
// same pattern as menu.js's own dropdowns.
import { store } from '../store.js';
import { projectFolder } from '../projectFolder.js';
import { currentWiredTool } from '../wiredWorkers.js';
import { getSession } from '../workerSession.js';

const FORMATS = [
  { ext: 'txt', label: '.txt' },
  { ext: 'md', label: '.md' },
];

// .md must actually read like Markdown, not just be a .txt file wearing a
// .md name — wrap the raw output in a heading + fenced code block so it
// renders sensibly wherever Markdown is viewed.
function formatOutputContent(text, ext) {
  if (ext === 'md') return `# Scan Output\n\n\`\`\`\n${text}\n\`\`\`\n`;
  return text;
}

// Each wired tool's one real results file, among the isOutput flags its own
// <tool>-panel.js/<Tool>Flags.java expose: whichever the backend's
// WorkerOutputStager actually stages into this profile's Project Folder once
// a run succeeds (see each *Flags.java's own OUTPUT_FLAGS comment). Send
// output shows that staged file's content -- the same bytes Project Folder
// itself would show -- instead of guessing at results from the raw terminal
// stream. A tool with several output-type flags (debug logs, alternate
// export formats, directories) only gets its one real report/results flag
// listed here; the rest (e.g. nuclei's -tlog/-elog, ffuf's -debug-log) are
// left out on purpose, same reasoning as WorkerOutputStager's own doc
// comment for why a directory flag never appears in any *Flags.java's
// OUTPUT_FLAGS. sqlmap's --report-json is picked over its sibling
// (--dump-file/--har) as the closest thing it has to "the scan's results"
// rather than raw traffic. sstimap has no such flag -- see below.
//
// A tool absent from this table never has a usable staged file:
// - puredns, jwt-tool, fuxploider, sstimap have no isOutput flag at all.
//   sstimap's real CLI has no dedicated findings/report flag -- --save-urls
//   and --save-forms are crawl data, not scan results, so neither qualifies.
// - gitleaks's -r/--report-path IS an isOutput flag on both sides (see
//   GitleaksFlags.java), but gitleaks-worker always overrides -r with its
//   own forced path appended at the very end of argv, so whatever
//   WorkerOutputStager rewrote -r to is never what gitleaks actually writes
//   -- staging silently finds nothing, every run.
// - gowitness's output is screenshots, not text -- handled by
//   renderGowitnessOutput below instead.
const PRIMARY_OUTPUT_FLAG = {
  dirsearch: '-o',
  nmap: '-oN',
  ffuf: '-o',
  gau: '--o',
  subfinder: '-o',
  shuffledns: '-o',
  katana: '-o',
  nuclei: '-o',
  hydra: '-o',
  wpscan: '-o',
  wafw00f: '-o',
  xsstrike: '--log-file',
  sqlmap: '--report-json',
};

// Same basename-only rewrite WorkerOutputStager.sanitizeProjectFolderName
// applies server-side -- the user's flag value and the Project Folder entry
// name must resolve to the same string for the lookup below to find it.
function outputFileName(rawValue) {
  const trimmed = (rawValue || '').trim();
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  if (!base || base === '.' || base === '..') return 'worker-output';
  return base;
}

// Keeps the saved file inside its own profile folder (no path separators)
// and never blank -- the numeric suffix added at save time is what actually
// keeps the name unique, so this only has to be a safe, non-empty label.
// Mirrors wordlist-template.js's own sanitizeNamePrefix.
function sanitizeNamePrefix(value, fallback) {
  const cleaned = (value || '').trim().replace(/[\\/]+/g, '-');
  return cleaned || fallback;
}

export default {
  id: 'send-output',
  css: 'static/worker-view.css',
  critical: false,
  mount(container, ctx) {
    // Computed before the markup below so the name input's default value can
    // use it -- the same worker-derived prefix the save handler used to
    // build hardcoded, now just the input's starting value.
    const tool = currentWiredTool();
    const defaultNamePrefix = `${tool || 'worker'}-scan-output`;
    container.innerHTML = `
      <div class="panel-head">Send output</div>
      <div class="send-output-body">
        <div class="output-box-wrap">
          <div class="output-box" id="send-output-box" tabindex="0" aria-label="Worker scan output"><p class="hint">No scan output yet.</p></div>
          <button type="button" class="bracket-copy-btn" id="send-output-copy" title="Copy to clipboard">[Copy]</button>
        </div>
        <div>
          <label for="send-output-name">File name</label>
          <input type="text" id="send-output-name" value="${defaultNamePrefix}" placeholder="${defaultNamePrefix}"
            maxlength="80" autocomplete="off" spellcheck="false">
        </div>
        <div class="send-save-row">
          <button type="button" id="send-output-save-project">Save to Project's Folder</button>
          <span class="send-save-as" aria-hidden="true">as</span>
          <div class="send-format-picker">
            <button type="button" class="send-format-btn" id="send-format-btn" aria-haspopup="listbox" aria-expanded="false">
              [${FORMATS[0].label}]
            </button>
            <ul class="send-format-list" role="listbox" id="send-format-list" aria-label="Save format">
              ${FORMATS.map((f, i) => `<li role="option" data-ext="${f.ext}" aria-selected="${i === 0}">${f.label}</li>`).join('')}
            </ul>
          </div>
        </div>
        <p class="hint" id="send-output-chat-hint">Telegram bot is not configured. Open settings to add one.</p>
        <div>
          <label for="send-output-chat">Telegram chat</label>
          <select id="send-output-chat" disabled>
            <option value="">All chats</option>
          </select>
        </div>
        <button type="button" id="send-output-chat-send" disabled>Send to chat</button>
      </div>`;

    const outputBox = container.querySelector('#send-output-box');
    // live-terminal.js emits `${tool}:output` once a run finishes -- this box
    // has otherwise never had a way to learn of real scan output (see module
    // comment above), only ever showing the "No scan output yet." placeholder.
    // Mounts independently (see index.js's WORKER_COMPOSITION), so this
    // arrives over the shared ctx bus rather than a direct import. Only a
    // wired tool's worker view ever emits this event, so unwired workers
    // simply never receive it and keep the placeholder. (tool itself is
    // computed above the markup now, for the name input's default value.)
    // gowitness's raw output is CLI progress noise, not a result worth reading -- its actual
    // results (screenshots) go to Image Storage instead (see GowitnessRelayHandler), so this box
    // just confirms the run finished rather than dumping stdout/stderr like every other tool.
    function renderGowitnessOutput({ exitCode }) {
      outputBox.replaceChildren();
      const p = document.createElement('p');
      p.textContent = (exitCode === undefined || exitCode === null || exitCode === 0)
        ? 'Scan finished successfully.'
        : `Scan failed (exit code ${exitCode}).`;
      outputBox.append(p);
    }
    function renderMessage(text) {
      outputBox.replaceChildren();
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = text;
      outputBox.append(p);
    }
    function renderFileContent(content) {
      outputBox.replaceChildren();
      const pre = document.createElement('pre');
      pre.textContent = content;
      outputBox.append(pre);
    }
    // The backend only stages a run's output file into Project Folder AFTER
    // broadcasting the WS "result" frame this event fires on (see e.g.
    // DirsearchRelayHandler.handleMessage: forward() runs before
    // runService.acceptResult()), so the file is rarely there on the very
    // first look -- poll a few times, a short beat apart, before giving up.
    const LOOKUP_ATTEMPTS = 5;
    const LOOKUP_INTERVAL_MS = 400;
    async function findStagedFile(name) {
      const profileId = store.profileId;
      if (!profileId) return null;
      for (let attempt = 0; attempt < LOOKUP_ATTEMPTS; attempt++) {
        const files = await projectFolder.list(profileId);
        const match = files.find(f => f.worker === tool && f.kind === 'output' && f.name === name);
        if (match) return match;
        if (attempt < LOOKUP_ATTEMPTS - 1) await new Promise(r => setTimeout(r, LOOKUP_INTERVAL_MS));
      }
      return null;
    }
    // Guards against a slow lookup from an earlier run resolving after a
    // later run has already started a (or finished its) own lookup.
    let renderToken = 0;
    async function renderPrimaryOutput({ exitCode }) {
      const myToken = ++renderToken;
      const primaryFlag = PRIMARY_OUTPUT_FLAG[tool];
      if (!primaryFlag) { renderMessage('No output file was requested for this run.'); return; }
      // WorkerOutputStager.collect() only stages a file when the run
      // succeeded -- a failed run never produces one, so there's nothing to
      // look up.
      if (exitCode !== 0) { renderMessage('Scan did not finish successfully -- no output file.'); return; }
      const value = (getSession(tool).activeFlags.get(primaryFlag) || '').trim();
      if (!value) { renderMessage('No output file was requested for this run.'); return; }
      renderMessage('Loading output file…');
      const match = await findStagedFile(outputFileName(value));
      if (myToken !== renderToken) return; // superseded by a newer run's result
      if (!match) { renderMessage('Output file not available.'); return; }
      renderFileContent(match.content || '');
    }
    if (tool === 'gowitness') {
      // A run that finished while this box wasn't mounted is cached on the
      // shared session (see live-terminal.js's emitResults()/workerSession.js)
      // -- repaint it immediately instead of showing "No scan output yet."
      // just because the box missed the live event.
      const session = getSession(tool);
      if (session.output) renderGowitnessOutput(session.output);
      ctx.on(`${tool}:output`, renderGowitnessOutput);
    } else if (tool) {
      const session = getSession(tool);
      if (session.output) renderPrimaryOutput(session.output);
      ctx.on(`${tool}:output`, renderPrimaryOutput);
    }
    const copyBtn = container.querySelector('#send-output-copy');
    const nameInput = container.querySelector('#send-output-name');
    const saveBtn = container.querySelector('#send-output-save-project');
    const saveBtnDefaultLabel = saveBtn.textContent;
    saveBtn.title = "Save this output to the profile's Project Folder";

    const formatBtn = container.querySelector('#send-format-btn');
    const formatList = container.querySelector('#send-format-list');
    let selectedExt = FORMATS[0].ext;

    function closeFormatList() {
      formatList.classList.remove('open');
      formatBtn.setAttribute('aria-expanded', 'false');
    }
    function openFormatList() {
      formatList.classList.add('open');
      formatBtn.setAttribute('aria-expanded', 'true');
    }
    formatBtn.addEventListener('click', () => (formatList.classList.contains('open') ? closeFormatList() : openFormatList()));
    formatList.addEventListener('click', e => {
      const opt = e.target.closest('li[role="option"]');
      if (!opt) return;
      selectedExt = opt.dataset.ext;
      formatList.querySelectorAll('li').forEach(li => li.setAttribute('aria-selected', String(li === opt)));
      formatBtn.textContent = `[.${selectedExt}]`;
      closeFormatList();
      formatBtn.focus();
    });
    document.addEventListener('click', e => {
      if (formatList.classList.contains('open') && !e.target.closest('.send-format-picker')) closeFormatList();
    });
    formatList.addEventListener('keydown', e => { if (e.key === 'Escape') { closeFormatList(); formatBtn.focus(); } });

    copyBtn.addEventListener('click', async () => {
      const text = outputBox.innerText.trim();
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = '[Copied]';
      } catch {
        copyBtn.textContent = '[Copy failed]';
      }
      setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
    });

    saveBtn.addEventListener('click', async () => {
      if (!store.current()) {
        saveBtn.textContent = 'No profile selected';
        setTimeout(() => { saveBtn.textContent = saveBtnDefaultLabel; }, 1500);
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const rawText = outputBox.innerText.trim();
        // Worker id set on main.dataset.worker by showWorkerView() (see
        // index.js), e.g. "subfinder-worker" — trimmed to the tool name for
        // the saved entry's own `worker` metadata field (unrelated to the
        // editable file name below).
        const worker = (document.querySelector('main').dataset.worker || 'worker').replace(/-worker$/, '');
        await projectFolder.save({
          kind: 'scan-output',
          worker,
          name: `${sanitizeNamePrefix(nameInput.value, defaultNamePrefix)}-${Date.now()}.${selectedExt}`,
          format: selectedExt,
          content: formatOutputContent(rawText, selectedExt),
        });
        saveBtn.textContent = 'Saved';
      } catch (err) {
        saveBtn.textContent = 'Save failed';
      }
      setTimeout(() => {
        saveBtn.textContent = saveBtnDefaultLabel;
        saveBtn.disabled = false;
      }, 1500);
    });

    // Send to chat. The chat list and the send both go through /api/settings.
    // The backend checks each request and holds the bot token.
    const chatHint = container.querySelector('#send-output-chat-hint');
    const chatSelect = container.querySelector('#send-output-chat');
    const chatSend = container.querySelector('#send-output-chat-send');
    let botConfigured = false;

    function syncChatSend() {
      // The empty-state placeholder is a .hint paragraph, which is not output.
      const hasOutput = outputBox.innerText.trim().length > 0 && !outputBox.querySelector(':scope > p.hint');
      chatSend.disabled = !(botConfigured && hasOutput);
    }

    async function refreshChats() {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'settings unavailable');
        const tg = data.telegram;
        botConfigured = tg.configured;
        chatSelect.replaceChildren();
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'All chats';
        chatSelect.append(all);
        tg.chats.forEach(c => {
          const o = document.createElement('option');
          o.value = c.chatId;
          o.textContent = c.label;
          chatSelect.append(o);
        });
        chatSelect.disabled = !tg.configured || tg.chats.length === 0;
        chatHint.textContent = tg.configured
          ? (tg.chats.length ? '' : 'No chats yet. Add one in settings.')
          : 'Telegram bot is not configured. Open settings to add one.';
      } catch (err) {
        botConfigured = false;
        chatHint.textContent = 'Telegram settings are unavailable: ' + err.message;
      }
      syncChatSend();
    }

    chatSend.addEventListener('click', async () => {
      const raw = outputBox.innerText.trim();
      chatSend.disabled = true;
      chatHint.textContent = 'Sending…';
      try {
        const res = await fetch('/api/settings/telegram/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: formatOutputContent(raw, 'md'), chatId: chatSelect.value || null }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        chatHint.textContent = data.results
          .map(r => r.label + ': ' + (r.ok ? 'sent' : 'failed (' + r.error + ')'))
          .join(' · ');
      } catch (err) {
        chatHint.textContent = 'Not sent: ' + err.message;
      } finally {
        syncChatSend();
      }
    });

    // The send button follows the output box, and the chat list reloads when settings are saved.
    new MutationObserver(syncChatSend).observe(outputBox, { childList: true, characterData: true, subtree: true });
    document.addEventListener('settings:changed', refreshChats);
    refreshChats();
  },
};
