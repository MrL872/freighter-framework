// wpscan control panel. Same approach as gau-panel.js: toggling a flag
// builds up the command preview live and drives a real backend run via
// ctx.emit('wpscan:flags', ...), consumed by live-terminal.js.
//
// Flags below are remapped 1:1 from .github/worker_instructions/wpscan.md
// (the real `wpscan --help` dump). Left out entirely: -h/--hh/--version
// (help/info, not a scan) and --update (self-update, not a scan -- same
// reasoning as every other tool's panel here).
//
// wpscan's target is a flag (--url), not a bare positional -- unlike
// gau/subfinder it has no bare-target entry.
//
// SEVERITY NOTE: wpscan can surface vulnerabilities across the full
// severity range (an outdated-version notice vs. an unauthenticated RCE),
// unlike e.g. hydra (a cracked credential is always "critical") -- so this
// worker does not hardcode one. See wpscan-worker/main.go's
// resolveSeverity() for the foundation laid for a future 3rd-party severity
// lookup; findings are staged with severity "unknown" until that's wired up.
import { store } from '../../store.js';
import { getSession } from '../../workerSession.js';
import { suppressTransition } from '../../domTransition.js';
import { projectFolder } from '../../projectFolder.js';
import { WORDLIST_BROWSE_HTML, bindWordlistBrowse } from '../../wordlistBrowser.js';
import { commandPreviewHtml, bindCommandPreview } from '../../commandPreview.js';
import { flagSearchHtml, bindFlagSearch } from '../../flagSearch.js';
import { addOutputDestination, destinationValue } from '../../outputDestination.js';

const FLAG_SECTIONS = [
  {
    group: 'basic', title: 'TARGET', flags: [
      { flag: '--url', takesValue: true, desc: 'The URL of the blog to scan' },
      { flag: '--force', takesValue: false, desc: 'Do not check if the target is running WordPress or returns a 403' },
    ],
  },
  {
    group: 'basic', title: 'ENUMERATION', flags: [
      { flag: '-e', alias: '--enumerate', takesValue: true, desc: 'Enumeration: vp, ap, p, vt, at, t, tt, cb, dbe, u, m (comma separated)' },
      { flag: '--exclude-content-based', takesValue: true, desc: 'Exclude all responses matching this Regexp during enumeration' },
      { flag: '--plugins-detection', takesValue: true, desc: 'Mode to enumerate plugins: mixed, passive, aggressive' },
      { flag: '--plugins-version-detection', takesValue: true, desc: "Mode to check plugins' versions: mixed, passive, aggressive" },
      { flag: '--exclude-usernames', takesValue: true, desc: 'Exclude usernames matching this Regexp/string' },
    ],
  },
  {
    group: 'basic', title: 'PASSWORD ATTACK', flags: [
      { flag: '-P', alias: '--passwords', takesValue: true, isFile: true, desc: 'List of passwords to use during the password attack' },
      { flag: '-U', alias: '--usernames', takesValue: true, desc: "List of usernames (e.g. 'a1', 'a1,a2,a3', or a file path)" },
      { flag: '--password-attack', takesValue: true, desc: 'Force the attack used: wp-login, xmlrpc, xmlrpc-multicall' },
      { flag: '--login-uri', takesValue: true, desc: 'The URI of the login page, if different from /wp-login.php' },
      { flag: '--multicall-max-passwords', takesValue: true, desc: 'Max passwords sent per XMLRPC multicall request (default 500)' },
      { flag: '--stealthy', takesValue: false, desc: 'Alias for --random-user-agent --detection-mode passive --plugins-version-detection passive' },
    ],
  },
  {
    group: 'advanced', title: 'AUTH / API', flags: [
      { flag: '--api-token', takesValue: true, desc: 'WPScan API token for vulnerability data' },
      { flag: '--http-auth', takesValue: true, desc: 'Basic HTTP authentication (login:password)' },
    ],
  },
  {
    group: 'advanced', title: 'NETWORK', flags: [
      { flag: '--user-agent', alias: '--ua', takesValue: true, desc: 'Custom User-Agent value' },
      { flag: '--random-user-agent', alias: '--rua', takesValue: false, desc: 'Use a random User-Agent for each HTTP request' },
      { flag: '-t', alias: '--max-threads', takesValue: true, desc: 'Max number of threads to use (default 5)' },
      { flag: '--throttle', takesValue: true, desc: 'Milliseconds to wait between requests (forces max threads to 1)' },
      { flag: '--request-timeout', takesValue: true, desc: 'Request timeout in seconds (default 60)' },
      { flag: '--connect-timeout', takesValue: true, desc: 'Connection timeout in seconds (default 30)' },
      { flag: '--disable-tls-checks', takesValue: false, desc: 'Disable TLS/SSL certificate verification' },
      { flag: '--proxy', takesValue: true, desc: 'HTTP/SOCKS5 proxy (protocol://IP:port)' },
      { flag: '--proxy-auth', takesValue: true, desc: 'Proxy authentication (login:password)' },
      { flag: '--cookie-string', takesValue: true, desc: 'Cookie string to use in requests (cookie1=value1; cookie2=value2)' },
      { flag: '--cookie-jar', takesValue: true, isOutput: true, desc: 'File to read and write cookies to' },
      { flag: '--detection-mode', takesValue: true, desc: 'Default: mixed. Available: mixed, passive, aggressive' },
    ],
  },
  {
    group: 'advanced', title: 'WORDPRESS', flags: [
      { flag: '--wp-content-dir', takesValue: true, desc: 'The wp-content directory, if custom or not detected' },
      { flag: '--wp-plugins-dir', takesValue: true, desc: 'The plugins directory, if custom or not detected' },
    ],
  },
  {
    group: 'advanced', title: 'OUTPUT', flags: [
      { flag: '-v', alias: '--verbose', takesValue: false, desc: 'Verbose mode' },
      { flag: '--no-banner', takesValue: false, desc: 'Do not display the banner' },
      { flag: '-o', alias: '--output', takesValue: true, isOutput: true, desc: 'Output to FILE' },
      { flag: '-f', alias: '--format', takesValue: true, desc: 'Output format: cli-no-colour, cli-no-color, cli, json' },
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
  id: 'wpscan-panel',
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
      ${commandPreviewHtml('wpscan')}`;

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
    const session = getSession('wpscan');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['wpscan'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        if (btn.dataset.bare === 'true') { tokens.push(value); return; }
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      ctx.emit('wpscan:flags', Object.fromEntries(active));
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
        panel.innerHTML = '<div class="flag-file-status">Select a company profile to browse its Project Folder.</div>' + WORDLIST_BROWSE_HTML;
        bindWordlistBrowse(panel, pick);
        return;
      }
      projectFolder.list().then(files => {
        if (closeOpenPopup !== cleanup) return;
        panel.innerHTML = (files.length ? files.map(f => `<button type="button" class="flag-file-option" role="option" data-name="${escapeHtml(f.name)}">${escapeHtml(f.name)}</button>`).join('') : '<div class="flag-file-status">No files saved in the Project Folder yet.</div>') + WORDLIST_BROWSE_HTML;
        panel.querySelectorAll('.flag-file-option[data-name]').forEach(optBtn => {
          optBtn.addEventListener('click', () => pick(optBtn.dataset.name));
        });
        bindWordlistBrowse(panel, pick);
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
