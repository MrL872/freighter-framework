import { theme } from '../theme.js';
import { metricsVisibility } from '../metricsVisibility.js';
import { terminalFocus } from '../terminalFocus.js';
import { linksGrouping } from '../linksGrouping.js';
import { projectFolder, ALLOWED_PROJECT_EXTENSIONS } from '../projectFolder.js';
import { pickAndUpload } from '../folderUpload.js';

// Component contract: see js/index.js for the full interface description.
export default {
  id: 'menu',
  css: 'static/menu.css',
  critical: false,
  mount(container, ctx) {
    container.innerHTML = `
      <nav class="menubar" aria-label="Main menu">
        <div class="menu">
          <button class="icon-btn" type="button" aria-haspopup="menu" aria-expanded="false">[ file ]</button>
          <ul role="menu">
            <li role="none"><button role="menuitem" data-act="upload-file" id="upload-file-item">Upload File to Project Storage</button></li>
            <li role="none"><button role="menuitem" data-act="upload-nuclei-templates" id="upload-nuclei-templates-item">Upload Nuclei Templates</button></li>
            <li role="none"><button role="menuitem" data-act="upload-wordlists" id="upload-wordlists-item">Upload Wordlists</button></li>
            <li role="none"><button role="menuitem" data-act="upload-configs" id="upload-configs-item">Upload Configs</button></li>
          </ul>
          <input type="file" id="menu-upload-input" hidden accept="${ALLOWED_PROJECT_EXTENSIONS.join(',')}">
        </div>
        <span class="menu-sep" aria-hidden="true">//</span>
        <div class="menu">
          <button class="icon-btn" type="button" aria-haspopup="menu" aria-expanded="false">[ view ]</button>
          <ul role="menu">
            <li role="none"><button role="menuitem" data-act="invert-colors" id="invert-colors-item"></button></li>
            <li role="none"><button role="menuitem" data-act="group-links" id="group-links-item"></button></li>
            <li role="none"><button role="menuitem" data-act="toggle-metrics" id="toggle-metrics-item"></button></li>
            <li role="none"><button role="menuitem" data-act="toggle-terminal-focus" id="toggle-terminal-focus-item"></button></li>
          </ul>
        </div>
        <span class="menu-sep" aria-hidden="true">//</span>
        <div class="menu">
          <button class="icon-btn" type="button" aria-haspopup="menu" aria-expanded="false">[ settings ]</button>
          <ul role="menu">
            <li role="none"><button role="menuitem" data-act="open-settings-telegram">Telegram bot...</button></li>
            <li role="none"><button role="menuitem" data-act="open-settings-mcp">MCP gateway...</button></li>
          </ul>
        </div>
        <span class="menu-sep" aria-hidden="true">//</span>
        <div class="menu">
          <button class="icon-btn" type="button" aria-haspopup="menu" aria-expanded="false">[ help ]</button>
          <ul role="menu">
            <li role="none"><button role="menuitem" data-act="open-documentation">Documentation</button></li>
            <li role="none"><button role="menuitem" disabled>About freighter-framework <span class="soon">soon</span></button></li>
          </ul>
        </div>
      </nav>`;

    // Label names the theme you'd switch TO, not the one currently active.
    const invertItem = container.querySelector('#invert-colors-item');
    function renderInvertLabel() { invertItem.textContent = theme.inverted ? 'Dark Theme' : 'Light Theme'; }
    renderInvertLabel();

    // Same "names the action, not the current state" convention as the
    // theme item above.
    const metricsItem = container.querySelector('#toggle-metrics-item');
    function renderMetricsLabel() { metricsItem.textContent = metricsVisibility.hidden ? 'Show Overview Metrics' : 'Hide Overview Metrics'; }
    renderMetricsLabel();

    // Worker view only, same "names the action" convention -- see
    // terminalFocus.js and the .worker-grid.terminal-focus rules in
    // worker-view.css that this flag actually drives.
    const terminalFocusItem = container.querySelector('#toggle-terminal-focus-item');
    function renderTerminalFocusLabel() { terminalFocusItem.textContent = terminalFocus.focused ? 'Un-focus Live Terminal' : 'Focus Live Terminal'; }
    renderTerminalFocusLabel();

    // Reads the shared linksGrouping module, so the label matches the grouping state however it was toggled.
    const groupLinksItem = container.querySelector('#group-links-item');
    function renderGroupLinksLabel() { groupLinksItem.textContent = linksGrouping.grouped ? 'Ungroup Links' : 'Group Links by Category'; }
    renderGroupLinksLabel();

    // Upload imports through projectFolder.importFile(), the same path as the Project Folder drop zone. The item's
    // label shows a short status line and then reverts, so the user stays on the current page.
    const uploadItem = container.querySelector('#upload-file-item');
    const uploadInput = container.querySelector('#menu-upload-input');
    const uploadItemDefaultLabel = uploadItem.textContent;
    let uploadStatusTimer = null;
    function setUploadStatus(text) {
      clearTimeout(uploadStatusTimer);
      uploadItem.textContent = text;
      uploadStatusTimer = setTimeout(() => { uploadItem.textContent = uploadItemDefaultLabel; }, 2000);
    }
    uploadInput.addEventListener('change', async () => {
      const file = uploadInput.files[0];
      uploadInput.value = '';
      if (!file) return;
      try {
        await projectFolder.importFile(file);
        setUploadStatus(`Uploaded "${file.name}"`);
      } catch (e) {
        setUploadStatus(e.message || `Failed to upload "${file.name}"`);
      }
    });

    // Nuclei Templates / Wordlists / Configs: whole-folder uploads to a shared, global
    // directory (not scoped to a company profile, unlike Project Storage
    // above) -- see folderUpload.js and WordlistsController/
    // NucleiTemplatesController/ConfigsController on the backend. Each item gets its own
    // status-label/timer pair (same transient-label convention as
    // setUploadStatus above) and is disabled for the duration of its own
    // upload so a second click can't start an overlapping one; a folder can
    // be thousands of files, so the label tracks live progress rather than
    // just flipping straight to a final result.
    function bindFolderUploadItem(itemId, endpoint) {
      const item = container.querySelector(`#${itemId}`);
      const defaultLabel = item.textContent;
      let statusTimer = null;
      function setStatus(text, { sticky = false } = {}) {
        clearTimeout(statusTimer);
        item.textContent = text;
        if (!sticky) statusTimer = setTimeout(() => { item.textContent = defaultLabel; }, 4000);
      }
      return async () => {
        item.disabled = true;
        try {
          const result = await pickAndUpload(endpoint, (done, total) => setStatus(`Uploading... ${done}/${total}`, { sticky: true }));
          if (!result) {
            item.textContent = defaultLabel; // cancelled -- nothing uploaded, nothing to report
          } else if (result.failed.length) {
            setStatus(`Uploaded ${result.total - result.failed.length}/${result.total} (${result.failed.length} failed)`);
          } else {
            setStatus(`Uploaded ${result.total} file${result.total === 1 ? '' : 's'}`);
          }
        } finally {
          item.disabled = false;
        }
      };
    }
    const uploadNucleiTemplates = bindFolderUploadItem('upload-nuclei-templates-item', '/api/nuclei-templates/upload');
    const uploadWordlists = bindFolderUploadItem('upload-wordlists-item', '/api/wordlists/upload');
    const uploadConfigs = bindFolderUploadItem('upload-configs-item', '/api/configs/upload');

    const menus = [...container.querySelectorAll('.menu')];
    // Visibility comes from the .open class (see menu.css), so dropdowns can fade and slide instead of snapping.
    function isOpen(m) { return m.querySelector('ul').classList.contains('open'); }
    function closeMenus() {
      menus.forEach(m => { m.querySelector('ul').classList.remove('open'); m.querySelector(':scope > button').setAttribute('aria-expanded', 'false'); });
    }
    function openMenu(m) {
      closeMenus();
      m.querySelector('ul').classList.add('open');
      m.querySelector(':scope > button').setAttribute('aria-expanded', 'true');
    }
    const menuActions = {
      'upload-file': () => uploadInput.click(),
      'upload-nuclei-templates': () => uploadNucleiTemplates(),
      'upload-wordlists': () => uploadWordlists(),
      'upload-configs': () => uploadConfigs(),
      'invert-colors': () => { theme.toggle(); renderInvertLabel(); },
      'group-links': () => { linksGrouping.toggle(); renderGroupLinksLabel(); ctx.emit('links:group'); },
      'toggle-metrics': () => { metricsVisibility.toggle(); renderMetricsLabel(); },
      'toggle-terminal-focus': () => { terminalFocus.toggle(); renderTerminalFocusLabel(); },
      // The settings dialog loads on first use. Its Telegram and MCP sections call the backend.
      'open-settings-telegram': () => import('./settings.js').then(m => m.openSettings('telegram')),
      'open-settings-mcp': () => import('./settings.js').then(m => m.openSettings('mcp')),
      // Same lazy-load-on-first-use pattern as Settings above.
      'open-documentation': () => import('./documentation.js').then(m => m.openDocumentation()),
    };
    menus.forEach(m => {
      const btn = m.querySelector(':scope > button');
      btn.addEventListener('click', () => isOpen(m) ? closeMenus() : openMenu(m));
      // Menus open and close on click only. Hover does not switch between them, so an open dropdown does not
      // take over when the pointer passes another header button.
      // Every dropdown stays open after an item is picked — e.g. toggling
      // metrics visibility and colour inversion back to back shouldn't
      // require reopening the menu each time — closing only when its own
      // toggle button above is clicked again (or Escape, or opening a
      // different menu, both handled elsewhere in this function).
      m.querySelectorAll('li button:not(:disabled)').forEach(b => b.addEventListener('click', () => {
        const fn = menuActions[b.dataset.act];
        if (fn) fn();
      }));
      m.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeMenus(); btn.focus(); }
        else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (!isOpen(m)) openMenu(m);
          const items = [...m.querySelectorAll('li button:not(:disabled)')];
          items[(items.indexOf(document.activeElement) + 1) % items.length].focus();
        }
      });
    });
  },
};
