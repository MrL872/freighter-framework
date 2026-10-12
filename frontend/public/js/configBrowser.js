// Config browser for the control panel's file pickers. A worker panel whose
// tool can load an external config file ends its file popup with a "Browse
// configs..." option (see CONFIG_BROWSE_HTML and bindConfigBrowse below).
// Clicking it opens openConfigBrowser(), a window that walks data/configs on
// the backend the same way the host file browser walks a local disk, and
// picks one file.
//
// The chosen value is "configs/<relative path>". The backend's
// ProjectFileStager resolves that prefix to the file under the shared
// configs mount, so the same value works for every tool. The folder is
// shared by all profiles; this window itself is still read-only (it can
// list folders and pick a file, not write one) -- see folderUpload.js for
// the [ file ] menu's separate "Upload Configs" option, which does write.

export const CONFIG_PREFIX = 'configs/';

// Appended after a panel's Project Folder options. Carries the flag-file-option
// class for the shared look but not data-name, so the panel's own option
// binding skips it.
export const CONFIG_BROWSE_HTML =
  '<button type="button" class="flag-file-option flag-file-browse flag-config-browse">Browse configs...</button>';

// Adds the click handler to the browse option a panel just rendered. pick()
// receives the same "configs/<path>" value that Project Folder options pass.
export function bindConfigBrowse(panel, pick) {
  const browse = panel.querySelector('.flag-file-browse.flag-config-browse');
  if (!browse) return;
  browse.addEventListener('click', () => {
    openConfigBrowser(relativePath => pick(CONFIG_PREFIX + relativePath));
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// Parent of a relative path: "a/b" -> "a", "a" -> "".
function parentOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

// Opens the window at the configs root. onPick(relativePath) runs when a file
// is clicked, and then the window closes. Escape, the Cancel button, or a click
// outside the window closes it without picking.
export function openConfigBrowser(onPick) {
  if (document.querySelector('.wordlist-overlay')) return;

  const overlay = el('div', 'wordlist-overlay');
  const win = el('div', 'wordlist-window');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', 'Choose a config file');

  const title = el('div', 'wordlist-title', 'Configs');
  const pathLine = el('div', 'wordlist-path');
  const up = el('button', 'wordlist-up', '[ .. ]');
  up.type = 'button';
  up.title = 'Go up one folder';
  const list = el('div', 'wordlist-list');
  const status = el('div', 'wordlist-status');
  const foot = el('div', 'wordlist-foot');
  const cancel = el('button', null, 'Cancel');
  cancel.type = 'button';
  foot.append(cancel);

  const head = el('div', 'wordlist-head');
  head.append(title, up);
  win.append(head, pathLine, list, status, foot);
  overlay.append(win);
  document.body.append(overlay);

  let currentPath = '';

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown, true);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  document.addEventListener('keydown', onKeydown, true);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  cancel.addEventListener('click', close);
  up.addEventListener('click', () => { if (currentPath) load(parentOf(currentPath)); });

  async function load(path) {
    status.textContent = 'Loading...';
    list.replaceChildren();
    try {
      const res = await fetch(`/api/configs?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        let message = `request failed: ${res.status}`;
        try { message = (await res.json()).error || message; } catch (e) { /* body wasn't JSON */ }
        throw new Error(message);
      }
      const { path: shownPath, entries } = await res.json();
      currentPath = shownPath;
      pathLine.textContent = `/data/configs/${shownPath}`;
      up.disabled = !shownPath;
      status.textContent = entries.length ? '' : 'This folder is empty.';
      for (const entry of entries) {
        const childPath = shownPath ? `${shownPath}/${entry.name}` : entry.name;
        const row = el('button', `wordlist-row wordlist-${entry.type}`);
        row.type = 'button';
        row.append(el('span', 'wordlist-name', entry.type === 'dir' ? `${entry.name}/` : entry.name));
        if (entry.type === 'file') row.append(el('span', 'wordlist-size', formatSize(entry.size)));
        row.addEventListener('click', () => {
          if (entry.type === 'dir') load(childPath);
          else { close(); onPick(childPath); }
        });
        list.append(row);
      }
    } catch (e) {
      status.textContent = e.name === 'TimeoutError' ? 'The backend did not answer in time.' : (e.message || 'Could not read configs.');
    }
  }

  load('');
}
