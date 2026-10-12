// Custom wordlist/template placeholder. Lets the user type or paste entries
// and pick which format they'll eventually be rendered/exported as — no
// backend endpoint exists yet to actually run or save this per worker as a
// scan job. "Save to Project Folder" is real and backend-connected: it
// writes through projectFolder.js to the same Derby-backed preferences
// store the sidebar's link order uses (see js/projectFolder.js and
// PreferencesController on the backend), scoped to the selected company
// profile.
import { store } from '../store.js';
import { projectFolder } from '../projectFolder.js';

const FORMATS = ['txt', 'json', 'yaml'];
const DEFAULT_NAME_PREFIX = 'wordlist';

// Keeps the saved file inside its own profile folder (no path separators)
// and never blank -- the numeric suffix added at save time is what actually
// keeps the name unique, so this only has to be a safe, non-empty label.
function sanitizeNamePrefix(value) {
  const cleaned = (value || '').trim().replace(/[\\/]+/g, '-');
  return cleaned || DEFAULT_NAME_PREFIX;
}

// The saved file must actually be what its extension claims, not plain text
// wearing a .json/.yaml name — so the raw entries get shaped into that
// format before they're written, not just tagged with it.
function formatContent(value, format) {
  const lines = value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (format === 'json') return JSON.stringify(lines, null, 2) + '\n';
  if (format === 'yaml') return lines.map(l => `- ${l}`).join('\n') + '\n';
  return value; // txt: entries as typed, one per line, no reshaping needed
}

export default {
  id: 'wordlist-template',
  css: 'static/worker-view.css',
  critical: false,
  mount(container) {
    container.innerHTML = `
      <div class="panel-head">Custom wordlist/template</div>
      <div class="wordlist-body">
        <textarea class="wordlist-input" spellcheck="false" autocomplete="off"
          placeholder="Enter custom wordlist entries or a template body, one per line..."></textarea>
        <button type="button" class="bracket-copy-btn" id="wordlist-copy" title="Copy to clipboard">[Copy]</button>
      </div>
      <div class="wordlist-foot">
        <div class="wordlist-name-group">
          <label for="wordlist-name">Name</label>
          <input type="text" id="wordlist-name" class="wordlist-name" value="${DEFAULT_NAME_PREFIX}"
            placeholder="${DEFAULT_NAME_PREFIX}" maxlength="80" autocomplete="off" spellcheck="false">
        </div>
        <div class="wordlist-format-group">
          <label for="wordlist-format">Render as</label>
          <select id="wordlist-format" class="wordlist-format">
            ${FORMATS.map(f => `<option value="${f}">${f}</option>`).join('')}
          </select>
        </div>
        <div class="wordlist-right-group">
          <button type="button" id="wordlist-save-project">Save to Project Folder</button>
        </div>
      </div>`;

    const wordlistInput = container.querySelector('.wordlist-input');
    const copyBtn = container.querySelector('#wordlist-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(wordlistInput.value);
        copyBtn.textContent = '[Copied]';
      } catch {
        copyBtn.textContent = '[Copy failed]';
      }
      setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
    });

    const formatSelect = container.querySelector('#wordlist-format');
    const nameInput = container.querySelector('#wordlist-name');
    const saveBtn = container.querySelector('#wordlist-save-project');
    const saveBtnDefaultLabel = saveBtn.textContent;
    saveBtn.title = "Save this input to the profile's Project Folder";

    saveBtn.addEventListener('click', async () => {
      if (!store.current()) {
        saveBtn.textContent = 'No profile selected';
        setTimeout(() => { saveBtn.textContent = saveBtnDefaultLabel; }, 1500);
        return;
      }
      const format = formatSelect.value;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await projectFolder.save({
          kind: 'wordlist',
          name: `${sanitizeNamePrefix(nameInput.value)}-${Date.now()}.${format}`,
          format,
          content: formatContent(wordlistInput.value, format),
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
  },
};
