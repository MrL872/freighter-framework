// gowitness control panel. Every button is a flag of gowitness v3's scan
// subcommands, checked against `gowitness scan <cmd> --help` (see
// .github/worker_instructions/gowitness.md for the usage examples). Pick one
// command (single, file, cidr, nmap or nessus) and only the flags that command
// takes stay visible. Toggling a flag builds up the command preview live.
//
// A flag marked isFile expects a Project Folder file (a target list, a JavaScript
// file, a headers file) instead of a typed value. A flag marked isOutput writes
// a result to disk: --screenshot-path is the one marked outputTarget: 'image',
// so screenshots land in Image Storage.
import { store } from '../../store.js';
import { getSession } from '../../workerSession.js';
import { suppressTransition } from '../../domTransition.js';
import { projectFolder } from '../../projectFolder.js';
import { WORDLIST_BROWSE_HTML, bindWordlistBrowse } from '../../wordlistBrowser.js';
import { commandPreviewHtml, bindCommandPreview } from '../../commandPreview.js';
import { flagSearchHtml, bindFlagSearch } from '../../flagSearch.js';
import { addOutputDestination, destinationValue } from '../../outputDestination.js';

const BARE_COMMANDS = new Set(['single', 'file', 'cidr', 'nmap', 'nessus']);

// cmds: the gowitness v3 scan subcommands a flag belongs to (checked against
// `gowitness scan <cmd> --help`). A flag outside the picked command is hidden.
const ALL_CMDS = ['single', 'file', 'cidr', 'nmap', 'nessus'];
const FILE_NMAP_NESSUS = ['file', 'nmap', 'nessus'];
const TARGET_CMDS = ['file', 'cidr', 'nmap', 'nessus'];

const FLAG_SECTIONS = [
  {
    group: 'basic', title: 'COMMAND', flags: [
      { flag: 'single', bare: true, takesValue: false, desc: 'Screenshot a single URL (gowitness scan single)' },
      { flag: 'file', bare: true, takesValue: false, desc: 'Screenshot targets from a file or stdin (gowitness scan file)' },
      { flag: 'cidr', bare: true, takesValue: false, desc: 'Screenshot the web services in CIDR ranges (gowitness scan cidr)' },
      { flag: 'nmap', bare: true, takesValue: false, desc: 'Screenshot the web services in an Nmap XML report (gowitness scan nmap)' },
      { flag: 'nessus', bare: true, takesValue: false, desc: 'Screenshot the web services in a Nessus XML export (gowitness scan nessus)' },
    ],
  },
  {
    group: 'basic', title: 'TARGET', flags: [
      { flag: '--url', alias: '-u', takesValue: true, cmds: ['single'], desc: 'The target to screenshot' },
      { flag: '--file', alias: '-f', takesValue: true, isFile: true, cmds: FILE_NMAP_NESSUS, desc: 'A file with targets to scan (plain list, or the Nmap / Nessus XML report). Use - for stdin' },
      { flag: '--cidr', alias: '-c', takesValue: true, cmds: ['cidr'], desc: 'A network CIDR to scan. Repeat the flag for more ranges' },
      { flag: '--cidr-file', alias: '-f', takesValue: true, isFile: true, cmds: ['cidr'], desc: 'A file with target CIDRs to scan. Use - for stdin' },
      { flag: '--no-http', takesValue: false, cmds: TARGET_CMDS, desc: "Do not add 'http://' to targets where missing" },
      { flag: '--no-https', takesValue: false, cmds: TARGET_CMDS, desc: "Do not add 'https://' to targets where missing" },
      { flag: '--port', alias: '-p', takesValue: true, cmds: TARGET_CMDS, desc: 'Ports to scan (file, cidr) or to filter by (nmap, nessus). Repeat the flag for more' },
      { flag: '--ports-small', takesValue: false, cmds: ['file', 'cidr'], desc: 'Include a small ports list when scanning targets' },
      { flag: '--ports-medium', takesValue: false, cmds: ['file', 'cidr'], desc: 'Include a medium ports list when scanning targets' },
      { flag: '--ports-large', takesValue: false, cmds: ['file', 'cidr'], desc: 'Include a large ports list when scanning targets' },
      { flag: '--random', takesValue: false, cmds: ['cidr'], desc: 'Randomize scan targets' },
    ],
  },
  {
    group: 'basic', title: 'NMAP REPORT', flags: [
      { flag: '--open-only', alias: '-o', takesValue: false, cmds: ['nmap'], desc: 'Only screenshot ports that are open' },
      { flag: '--service', takesValue: true, cmds: ['nmap'], desc: 'Only screenshot services with this name. Repeat the flag for more' },
      { flag: '--service-contains', takesValue: true, cmds: ['nmap'], desc: 'Only screenshot services whose name contains this text' },
      { flag: '--exclude-port', takesValue: true, cmds: ['nmap'], desc: 'Do not screenshot this port. Repeat the flag for more' },
      { flag: '--skip-port', takesValue: true, cmds: ['nmap'], desc: 'Skip this port when building targets. Repeat the flag for more' },
      { flag: '--hostnames', takesValue: false, cmds: ['nmap', 'nessus'], desc: 'Add hostnames as targets as well as IP addresses' },
    ],
  },
  {
    group: 'basic', title: 'NESSUS REPORT', flags: [
      { flag: '--plugin-name', takesValue: true, cmds: ['nessus'], desc: 'Plugin name filter. Repeat the flag for more' },
      { flag: '--plugin-output', takesValue: true, cmds: ['nessus'], desc: 'Plugin output contains filter. Repeat the flag for more' },
      { flag: '--service-name', takesValue: true, cmds: ['nessus'], desc: 'Service name filter. Repeat the flag for more' },
    ],
  },
  {
    group: 'basic', title: 'SCREENSHOT', flags: [
      { flag: '--screenshot-path', alias: '-s', takesValue: true, isOutput: true, outputTarget: 'image', cmds: ALL_CMDS, desc: 'Folder to store screenshots in (default ./screenshots). Screenshots go to Image Storage' },
      { flag: '--screenshot-format', takesValue: true, cmds: ALL_CMDS, desc: 'Format to save screenshots as: jpeg or png (default jpeg)' },
      { flag: '--screenshot-fullpage', takesValue: false, cmds: ALL_CMDS, desc: 'Full-page screenshots instead of just the viewport' },
      { flag: '--screenshot-jpeg-quality', takesValue: true, cmds: ALL_CMDS, desc: 'Quality of JPEG screenshots, 1-100 (default 60)' },
      { flag: '--screenshot-skip-save', takesValue: false, cmds: ALL_CMDS, desc: 'Do not save screenshots to the screenshot path (useful with --write-screenshots)' },
      { flag: '--write-screenshots', takesValue: false, cmds: ALL_CMDS, desc: 'Store screenshots with the writers as well as on disk' },
      { flag: '--javascript', takesValue: true, cmds: ALL_CMDS, desc: 'A JavaScript function to run on every page before its screenshot, e.g. () => console.log(1)' },
      { flag: '--javascript-file', takesValue: true, isFile: true, cmds: ALL_CMDS, desc: 'A file with a JavaScript function to run before each screenshot. See --javascript' },
      { flag: '--http-code-filter', takesValue: true, cmds: ALL_CMDS, desc: 'Only screenshot these HTTP response codes (comma-separated)' },
      { flag: '--uri-filter', takesValue: true, cmds: ALL_CMDS, desc: 'Valid URI schemes to scan (default http,https)' },
    ],
  },
  {
    group: 'advanced', title: 'CHROME', flags: [
      { flag: '--chrome-proxy', takesValue: true, cmds: ALL_CMDS, desc: 'HTTP or SOCKS5 proxy for the browser, as proto://address:port' },
      { flag: '--chrome-header', takesValue: true, cmds: ALL_CMDS, desc: 'Extra request header for the browser, "Name: Value". Repeat the flag for more' },
      { flag: '--chrome-wss-url', takesValue: true, cmds: ALL_CMDS, desc: 'Websocket URL of a running Chrome DevTools instance (started with --remote-debugging-port)' },
      { flag: '--chrome-path', takesValue: true, cmds: ALL_CMDS, desc: 'Path to a Chrome binary to use (default: a downloaded one)' },
      { flag: '--chrome-user-data-dir', takesValue: true, cmds: ALL_CMDS, desc: 'Chrome user data directory to reuse logged-in sessions from' },
      { flag: '--chrome-window-x', takesValue: true, cmds: ALL_CMDS, desc: 'Browser window width in pixels (default 1280)' },
      { flag: '--chrome-window-y', takesValue: true, cmds: ALL_CMDS, desc: 'Browser window height in pixels (default 720)' },
      { flag: '--chrome-user-agent', takesValue: true, cmds: ALL_CMDS, desc: 'User-agent string to use' },
      { flag: '--driver', takesValue: true, cmds: ALL_CMDS, desc: 'Scan driver: gorod or chromedp (default chromedp)' },
    ],
  },
  {
    group: 'advanced', title: 'WRITERS', flags: [
      { flag: '--write-db', takesValue: false, cmds: ALL_CMDS, desc: 'Write results to a SQLite database' },
      { flag: '--write-db-uri', takesValue: true, cmds: ALL_CMDS, desc: 'Database URI: SQLite, MySQL or PostgreSQL (default sqlite://gowitness.sqlite3)' },
      { flag: '--write-db-enable-debug', takesValue: false, cmds: ALL_CMDS, desc: 'Enable database query debug logging (verbose)' },
      { flag: '--write-csv', takesValue: false, cmds: ALL_CMDS, desc: 'Write results as CSV (limited columns)' },
      { flag: '--write-csv-file', takesValue: true, cmds: ALL_CMDS, desc: 'File to write CSV rows to (default gowitness.csv)' },
      { flag: '--write-jsonl', takesValue: false, cmds: ALL_CMDS, desc: 'Write results as JSON lines' },
      { flag: '--write-jsonl-file', takesValue: true, cmds: ALL_CMDS, desc: 'File to write JSON lines to (default gowitness.jsonl)' },
      { flag: '--write-none', takesValue: false, cmds: ALL_CMDS, desc: 'Use an empty writer to silence warnings' },
      { flag: '--write-stdout', takesValue: false, cmds: ALL_CMDS, desc: 'Write successful results to stdout' },
      { flag: '--save-content', takesValue: false, cmds: ALL_CMDS, desc: 'Save content from network requests to the writers. Can make storage grow very large' },
      { flag: '--skip-html', takesValue: false, cmds: ALL_CMDS, desc: "Do not include the first request's HTML response when writing results" },
      { flag: '--skip-network-logs', takesValue: false, cmds: ALL_CMDS, desc: 'Do not include per-request network logs when writing results (also disables --save-content)' },
    ],
  },
  {
    group: 'advanced', title: 'TIMING', flags: [
      { flag: '--delay', takesValue: true, cmds: ALL_CMDS, desc: 'Seconds between navigation and screenshot (default 3)' },
      { flag: '--timeout', alias: '-T', takesValue: true, cmds: ALL_CMDS, desc: 'Seconds before a page counts as timed out (default 60)' },
      { flag: '--threads', alias: '-t', takesValue: true, cmds: ALL_CMDS, desc: 'Concurrent threads (default 6)' },
    ],
  },
  {
    group: 'advanced', title: 'DEBUG', flags: [
      { flag: '--quiet', alias: '-q', takesValue: false, cmds: ALL_CMDS, desc: 'Silence (almost all) logging' },
      { flag: '--debug-log', alias: '-D', takesValue: false, cmds: ALL_CMDS, desc: 'Enable debug logging' },
      { flag: '--log-scan-errors', takesValue: false, cmds: ALL_CMDS, desc: 'Log scan errors (timeouts, DNS errors) to stderr. Can be verbose' },
      { flag: '--no-log-color', takesValue: false, cmds: ALL_CMDS, desc: 'Disable colours in log output' },
      { flag: '--profile', takesValue: false, cmds: ALL_CMDS, desc: 'Enable CPU, memory and trace profiling' },
    ],
  },
];

function flagLabel(f) { return f.bare ? f.flag : (f.alias ? `${f.flag}, ${f.alias}` : f.flag); }
// Safe for both an HTML attribute and a text node — used for flag
// descriptions (from this file, trusted) and, below, for Project Folder
// file names (user-entered via rename, not trusted).
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function renderSection(section) {
  return `
    <div class="flag-section">
      <h4 class="flag-section-title">${section.title}</h4>
      <div class="flag-btns">
        ${section.flags.map(f => `
          <span class="flag-btn-wrap">
            <button type="button" class="flag-btn" data-flag="${f.flag}" data-takes-value="${f.takesValue}" data-is-file="${!!f.isFile}" data-is-output="${!!f.isOutput}" data-output-target="${f.outputTarget || 'project'}" data-bare="${!!f.bare}" data-cmds="${(f.cmds || []).join(',')}"
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
  id: 'gowitness-panel',
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
      ${commandPreviewHtml('gowitness')}`;

    // Every worker switch remounts this panel from scratch (see
    // showWorkerView() in index.js) — guard each collapsible group's
    // fresh .flag-group-body-wrap the same way page navigation guards
    // main's own grid-template-rows transition, so it can never misread
    // its very first style application as something worth animating.
    container.querySelectorAll('.flag-group-body-wrap').forEach(suppressTransition);
    container.querySelectorAll('.flag-group-head').forEach(btn => {
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
      });
    });

    const preview = bindCommandPreview(container, {
      onClear: clearAllFlags,
      // "scan" is a literal keyword renderCommand() below writes into the
      // preview text (gowitness v3's CLI needs "scan <command>", not just
      // the bare command on its own -- see GowitnessFlags.toArgs on the
      // backend, which already reinserts it the same way). It isn't a real
      // flag -- no .flag-btn carries it, and the backend's allowlist would
      // reject it as an unsupported flag if it reached `active` -- so it's
      // registered here only so a hand-edited command that still says
      // "scan" parses instead of failing with "Unexpected argument: scan",
      // and onApply immediately discards it below, the same way
      // puredns-panel.js registers and discards its own resolve/bruteforce
      // command keyword.
      flagDefs: [...FLAG_SECTIONS.flatMap(s => s.flags), { flag: 'scan', takesValue: false }],
      onApply(parsed) {
        parsed.delete('scan');
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
    // flag -> value ('' for boolean flags that are simply on/off)
    // Persisted across mounts (see workerSession.js) -- switching away from
    // this worker's view and back (or to a different worker and back)
    // shouldn't reset flags already built up here.
    const session = getSession('gowitness');
    const active = session.activeFlags;

    function renderCommand() {
      // One scan command at a time. Flags that command does not take are hidden
      // and unpinned, so the command never carries a flag gowitness would reject.
      const command = [...active.keys()].find(key => BARE_COMMANDS.has(key));
      container.querySelectorAll('.flag-btn-wrap').forEach(wrap => {
        const btn = wrap.querySelector('.flag-btn');
        const applies = !command || btn.dataset.bare === 'true' || btn.dataset.cmds.split(',').includes(command);
        wrap.classList.toggle('cmd-na', !applies);
        if (!applies && active.has(btn.dataset.flag)) {
          active.delete(btn.dataset.flag);
          btn.setAttribute('aria-pressed', 'false');
          btn.classList.remove('active');
        }
      });
      const tokens = ['gowitness'];
      if (command) tokens.push('scan', command);
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag) || btn.dataset.bare === 'true') return;
        const value = active.get(flag);
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      // live-terminal.js's Send button gets the same selection over the ctx bus.
      // The picked scan command travels as its bare key; GowitnessFlags.toArgs
      // turns it into "scan <command>" on the backend.
      ctx.emit('gowitness:flags', Object.fromEntries(active));
    }

    // At most one value popup open at a time — opening another, or any
    // outside interaction, cancels whichever one is still open.
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
      // Output-writing flags (a scan result saved to disk) point at Project
      // Folder instead of leaving the user to type an arbitrary path -- the
      // one place a saved value later shows up again in this UI (see
      // js/projectFolder.js).
      // Appended to <body> at a viewport-fixed position (computed from the
      // button's own rect) rather than left inside .flag-btn-wrap — a
      // wrap nested under overflow:hidden/auto ancestors (the scrollable
      // .control-body, the collapsing .flag-group-body) would otherwise
      // clip or bury the popup instead of floating it above everything.
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
      // A detached, fixed-position popup doesn't track its anchor while a
      // scrollable ancestor (e.g. .control-body) scrolls under it, so close
      // it rather than let it drift away from the button that opened it.
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

    // File-taking flags (--file, --javascript-file) pick from whatever the
    // selected profile actually has saved in its Project Folder, instead of
    // a blind typed value — same storage wordlist-template.js/send-output.js
    // write into (see js/projectFolder.js).
    function openFilePopup(btn) {
      if (closeOpenPopup) closeOpenPopup();
      const flag = btn.dataset.flag;
      const wrap = btn.closest('.flag-btn-wrap');
      const panel = document.createElement('div');
      panel.className = 'flag-file-popup';
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', `Project Folder files for ${flag}`);
      panel.innerHTML = '<div class="flag-file-status">Loading Project Folder…</div>';
      // Appended to <body> at a viewport-fixed position (computed from the
      // button's own rect) rather than left inside .flag-btn-wrap — see the
      // matching comment in openValuePopup above for why.
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
      // See the matching scroll listener in openValuePopup above.
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
        if (closeOpenPopup !== cleanup) return; // closed/replaced while this was in flight
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
        if (btn.dataset.bare === 'true' && !active.has(flag)) {
          container.querySelectorAll('.flag-btn[data-bare="true"]').forEach(other => {
            if (other === btn || !active.has(other.dataset.flag)) return;
            active.delete(other.dataset.flag);
            other.setAttribute('aria-pressed', 'false');
            other.classList.remove('active');
          });
        }
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
