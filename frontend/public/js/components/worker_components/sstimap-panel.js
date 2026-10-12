// sstimap control panel. Same approach as gau-panel.js: toggling a flag
// builds up the command preview live and drives a real backend run via
// ctx.emit('sstimap:flags', ...), consumed by live-terminal.js.
//
// Flags below are remapped from .github/worker_instructions/sstimap.md (the
// real `sstimap.py --help` dump). Left out entirely: -h/-V/--module (help/
// version/info, not a scan); -i/--interactive and --run (interactive-mode
// only -- this worker has no stdin to drive a REPL); every shell/session
// flag (-t/--tpl-shell, -x/--eval-shell, -s/--os-shell, -B/--bind-shell,
// -R/--reverse-shell, --remote-shell) for the same reason the other tools'
// panels exclude interactive shells; and every flag argparse defines with
// more than one value (-L/--force-level, --bool-fuzzy, --bool-samples,
// -U/--upload, -D/--download) since this panel's flag model is one value
// per flag, same scope limit as every other tool here.
//
// sstimap's target is a flag (-u/--url), not a bare positional -- unlike
// gau/subfinder it has no bare-target entry.
import { store } from '../../store.js';
import { getSession } from '../../workerSession.js';
import { suppressTransition } from '../../domTransition.js';
import { projectFolder } from '../../projectFolder.js';
import { WORDLIST_BROWSE_HTML, bindWordlistBrowse } from '../../wordlistBrowser.js';
import { CONFIG_BROWSE_HTML, bindConfigBrowse } from '../../configBrowser.js';
import { commandPreviewHtml, bindCommandPreview } from '../../commandPreview.js';
import { flagSearchHtml, bindFlagSearch } from '../../flagSearch.js';
import { addOutputDestination, destinationValue } from '../../outputDestination.js';

const FLAG_SECTIONS = [
  {
    group: 'basic', title: 'TARGET', flags: [
      { flag: '-u', alias: '--url', takesValue: true, desc: "Target URL (e.g. 'https://example.com/?name=test')" },
      { flag: '--load-urls', takesValue: true, isFile: true, desc: 'File or directory to load URLs from' },
      { flag: '--load-forms', takesValue: true, isFile: true, desc: 'File or directory to load forms from' },
    ],
  },
  {
    group: 'basic', title: 'REQUEST', flags: [
      { flag: '-M', alias: '--marker', takesValue: true, desc: "Use string as injection marker (default '*')" },
      { flag: '-P', alias: '--injection-points', takesValue: true, desc: 'Injection points to test without markers: Q(uery) B(ody) H(eaders) C(ookies). Default: QBHC' },
      { flag: '-d', alias: '--data', takesValue: true, desc: "Request body data param to send (e.g. 'param=value')" },
      { flag: '--data-type', takesValue: true, desc: "Request body data type (default 'auto')" },
      { flag: '--data-params', takesValue: true, desc: 'Module params for plugins and request body data types (KEY=VALUE)' },
      { flag: '-H', alias: '--header', takesValue: true, desc: "Header to send (e.g. 'Header: Value')" },
      { flag: '-C', alias: '--cookie', takesValue: true, desc: "Cookie to send (e.g. 'Field=Value')" },
      { flag: '-m', alias: '--method', takesValue: true, desc: "HTTP method to use (default 'GET')" },
      { flag: '-a', alias: '--user-agent', takesValue: true, desc: 'User-Agent header value to use' },
      { flag: '-A', alias: '--random-user-agent', takesValue: false, desc: 'Random User-Agent header value from a list of desktop browsers on every request' },
      { flag: '--delay', takesValue: true, desc: 'Delay between requests (Default/0: no delay)' },
      { flag: '-p', alias: '--proxy', takesValue: true, desc: 'Use a proxy to connect to the target URL' },
      { flag: '--verify-ssl', takesValue: false, desc: 'Verify SSL certificates (not verified by default)' },
      { flag: '--log-response', takesValue: false, desc: 'Include HTTP responses into ~/.sstimap/sstimap.log' },
    ],
  },
  {
    group: 'advanced', title: 'CRAWLER', flags: [
      { flag: '-c', alias: '--crawl', takesValue: true, desc: "Depth to crawl (default/0: don't crawl)" },
      { flag: '-f', alias: '--forms', takesValue: false, desc: 'Scan page(s) for forms' },
      { flag: '--empty-forms', takesValue: false, desc: 'Treat pages without params as GET forms' },
      { flag: '--crawl-exclude', takesValue: true, desc: 'RegEx in URLs to not crawl' },
      { flag: '--crawl-domains', takesValue: true, desc: 'Crawl other domains: Y(es) / S(ubdomains) / N(o). Default: S' },
      { flag: '--save-urls', takesValue: true, isOutput: true, desc: 'File or directory to save crawled URLs to' },
      { flag: '--save-forms', takesValue: true, isOutput: true, desc: 'File or directory to save crawled forms to' },
    ],
  },
  {
    group: 'advanced', title: 'DETECTION', flags: [
      { flag: '-l', alias: '--level', takesValue: true, desc: 'Level of escaping to perform (1-5, Default: 1)' },
      { flag: '-e', alias: '--engine', takesValue: true, desc: "Comma-separated list of template engines to test, or '*' for all" },
      { flag: '-r', alias: '--technique', takesValue: true, desc: 'Techniques: R(endered) E(rror-based) B(oolean error-based blind) T(ime-based blind). Default: REBT' },
      { flag: '--bool-ok', takesValue: true, desc: 'RegEx to match when boolean error-based blind payload evaluates correctly' },
      { flag: '--bool-err', takesValue: true, desc: 'RegEx to match when boolean error-based blind payload causes an error' },
      { flag: '--bool-match', takesValue: true, desc: "Comma-separated list of matching params, or 'all'" },
      { flag: '--bool-match-min', takesValue: true, desc: 'Minimum amount of usable params for matching. Default: 7' },
      { flag: '--blind-delay', takesValue: true, desc: 'Delay to detect time-based blind injection (Default: 4 seconds)' },
      { flag: '--verify-blind-delay', takesValue: true, desc: 'Delay to verify and exploit time-based blind injection (Default: 30 seconds)' },
      { flag: '--legacy', takesValue: false, desc: 'Include old payloads that no longer work with newer versions of the engines' },
      { flag: '--generic', takesValue: false, desc: 'Try dedicated payloads for generic engines, detecting more context' },
    ],
  },
  {
    group: 'advanced', title: 'PAYLOAD', flags: [
      { flag: '-T', alias: '--tpl-code', takesValue: true, desc: 'Inject code in the template engine' },
      { flag: '-X', alias: '--eval-code', takesValue: true, desc: 'Evaluate code in the template engine base language' },
      { flag: '-S', alias: '--os-cmd', takesValue: true, desc: 'Execute an operating system command' },
      { flag: '-F', alias: '--force-overwrite', takesValue: false, desc: 'Force file overwrite when uploading' },
    ],
  },
  {
    group: 'advanced', title: 'GENERAL', flags: [
      { flag: '--config', takesValue: true, isFile: true, desc: 'Use custom config file or directory' },
      { flag: '--no-color', takesValue: false, desc: 'Disable color in output' },
    ],
  },
];

function flagLabel(f) { return f.alias ? `${f.flag}, ${f.alias}` : f.flag; }
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function renderSection(section) {
  return `
    <div class="flag-section">
      <h4 class="flag-section-title">${section.title}</h4>
      <div class="flag-btns">
        ${section.flags.map(f => `
          <span class="flag-btn-wrap">
            <button type="button" class="flag-btn" data-flag="${f.flag}" data-takes-value="${f.takesValue}" data-is-file="${!!f.isFile}" data-is-output="${!!f.isOutput}" data-output-target="${f.outputTarget || 'project'}" data-bare="${!!f.bare}"
              aria-pressed="false" title="${escapeHtml(f.desc)}">${flagLabel(f)}</button>
          </span>`).join('')}
      </div>
    </div>`;
}

function renderGroup(id, title, sections) {
  return `
    <div class="flag-group">
      <button type="button" class="flag-group-head" aria-expanded="false" aria-controls="flags-${id}">
        <span class="glyph" aria-hidden="true">&gt;</span>${title}
      </button>
      <div class="flag-group-body-wrap">
        <div class="flag-group-body" id="flags-${id}">
          ${sections.map(renderSection).join('')}
        </div>
      </div>
    </div>`;
}

export default {
  id: 'sstimap-panel',
  css: ['static/worker-view.css', 'static/flag-panel.css'],
  critical: false,
  mount(container, ctx) {
    const basicSections = FLAG_SECTIONS.filter(s => s.group === 'basic');
    const advancedSections = FLAG_SECTIONS.filter(s => s.group === 'advanced');

    container.innerHTML = `
      <div class="panel-head">Control panel${flagSearchHtml()}</div>
      <div class="control-body">
        ${renderGroup('basic', 'Basic flags', basicSections)}
        ${renderGroup('advanced', 'Advanced flags', advancedSections)}
      </div>
      ${commandPreviewHtml('sstimap')}`;

    container.querySelectorAll('.flag-group-body-wrap').forEach(suppressTransition);
    container.querySelectorAll('.flag-group-head').forEach(btn => {
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
      });
    });

    const preview = bindCommandPreview(container, {
      onClear: clearAllFlags,
      flagDefs: FLAG_SECTIONS.flatMap(s => s.flags),
      onApply(parsed) {
        active.clear();
        parsed.forEach((v, k) => active.set(k, v));
        container.querySelectorAll('.flag-btn').forEach(btn => {
          const on = active.has(btn.dataset.flag);
          btn.setAttribute('aria-pressed', String(on));
          btn.classList.toggle('active', on);
        });
        renderCommand();
      },
    });
    bindFlagSearch(container);
    // Persisted across mounts (see workerSession.js) -- switching away from
    // this worker's view and back (or to a different worker and back)
    // shouldn't reset flags already built up here.
    const session = getSession('sstimap');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['sstimap'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        if (btn.dataset.bare === 'true') { tokens.push(value); return; }
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      ctx.emit('sstimap:flags', Object.fromEntries(active));
    }

    let closeOpenPopup = null;

    function openValuePopup(btn) {
      if (closeOpenPopup) closeOpenPopup();
      const flag = btn.dataset.flag;
      const wrap = btn.closest('.flag-btn-wrap');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'flag-value-popup';
      input.setAttribute('aria-label', `Value for ${flag}`);
      input.placeholder = 'value...';
      const popup = document.createElement('div');
      popup.className = 'flag-value-popup-wrap';
      popup.appendChild(input);
      if (btn.dataset.isOutput === 'true') addOutputDestination(popup, input, btn);
      const anchorRect = btn.getBoundingClientRect();
      popup.style.left = `${anchorRect.right + 4}px`;
      popup.style.top = `${anchorRect.top}px`;
      document.body.appendChild(popup);
      input.focus();

      const cleanup = () => {
        popup.remove();
        if (closeOpenPopup === cleanup) closeOpenPopup = null;
        document.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('scroll', onScroll, true);
      };
      const onOutside = e => { if (!wrap.contains(e.target) && !popup.contains(e.target)) cleanup(); };
      document.addEventListener('mousedown', onOutside, true);
      // Scroll events from inside the popup (its input scrolling sideways as text
      // is typed or pasted past its width) must not close it.
      const onScroll = e => { if (!(e.target instanceof Element && popup.contains(e.target))) cleanup(); };
      window.addEventListener('scroll', onScroll, true);

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const value = destinationValue(btn, input);
          if (value === null) return;
          cleanup();
          if (!value) return;
          active.set(flag, value);
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.add('active');
          renderCommand();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
        }
      });

      closeOpenPopup = cleanup;
    }

    function openFilePopup(btn) {
      if (closeOpenPopup) closeOpenPopup();
      const flag = btn.dataset.flag;
      const wrap = btn.closest('.flag-btn-wrap');
      const panel = document.createElement('div');
      panel.className = 'flag-file-popup';
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', `Project Folder files for ${flag}`);
      panel.innerHTML = '<div class="flag-file-status">Loading Project Folder…</div>';
      const anchorRect = btn.getBoundingClientRect();
      panel.style.left = `${anchorRect.left}px`;
      panel.style.top = `${anchorRect.bottom + 4}px`;
      document.body.appendChild(panel);

      const cleanup = () => {
        panel.remove();
        if (closeOpenPopup === cleanup) closeOpenPopup = null;
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onKeydown, true);
        window.removeEventListener('scroll', onScroll, true);
      };
      const onOutside = e => { if (!wrap.contains(e.target) && !panel.contains(e.target)) cleanup(); };
      const onKeydown = e => { if (e.key === 'Escape') { e.preventDefault(); cleanup(); } };
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onKeydown, true);
      // Scroll events from inside the popup (its input scrolling sideways as text
      // is typed or pasted past its width) must not close it.
      const onScroll = e => { if (!(e.target instanceof Element && panel.contains(e.target))) cleanup(); };
      window.addEventListener('scroll', onScroll, true);
      closeOpenPopup = cleanup;

      function pick(name) {
        cleanup();
        active.set(flag, name);
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('active');
        renderCommand();
      }

      if (!store.current()) {
        panel.innerHTML = '<div class="flag-file-status">Select a company profile to browse its Project Folder.</div>' + WORDLIST_BROWSE_HTML + CONFIG_BROWSE_HTML;
        bindWordlistBrowse(panel, pick);
        bindConfigBrowse(panel, pick);
        return;
      }
      projectFolder.list().then(files => {
        if (closeOpenPopup !== cleanup) return;
        panel.innerHTML = (files.length ? files.map(f => `<button type="button" class="flag-file-option" role="option" data-name="${escapeHtml(f.name)}">${escapeHtml(f.name)}</button>`).join('') : '<div class="flag-file-status">No files saved in the Project Folder yet.</div>') + WORDLIST_BROWSE_HTML + CONFIG_BROWSE_HTML;
        panel.querySelectorAll('.flag-file-option[data-name]').forEach(optBtn => {
          optBtn.addEventListener('click', () => pick(optBtn.dataset.name));
        });
        bindWordlistBrowse(panel, pick);
        bindConfigBrowse(panel, pick);
      });
    }

    container.querySelectorAll('.flag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const flag = btn.dataset.flag;
        const takesValue = btn.dataset.takesValue === 'true';
        if (active.has(flag)) {
          active.delete(flag);
          btn.setAttribute('aria-pressed', 'false');
          btn.classList.remove('active');
          renderCommand();
          return;
        }
        if (takesValue) {
          if (btn.dataset.isFile === 'true') openFilePopup(btn);
          else openValuePopup(btn);
          return;
        }
        active.set(flag, '');
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('active');
        renderCommand();
      });
    });

    // Repaint flags already active from a previous mount (see workerSession.js
    // above) instead of starting the button bar empty.
    if (active.size) {
      container.querySelectorAll('.flag-btn').forEach(btn => {
        if (active.has(btn.dataset.flag)) {
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.add('active');
        }
      });
      renderCommand();
    }

    // [CLEAR] unpins every flag and rebuilds the bar empty.
    function clearAllFlags() {
      active.clear();
      container.querySelectorAll('.flag-btn').forEach(btn => {
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('active');
      });
      renderCommand();
    }

    const copyBtn = container.querySelector('#command-preview-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(preview.text());
        copyBtn.textContent = '[Copied]';
      } catch {
        copyBtn.textContent = '[Copy failed]';
      }
      setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
    });
  },
};
