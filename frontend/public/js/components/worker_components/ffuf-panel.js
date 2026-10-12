// ffuf control panel. Same approach as subfinder-panel.js: every button
// below corresponds to a flag documented in
// .github/worker_instructions/ffuf.md, grouped the same way that doc groups
// them (HTTP OPTIONS, INPUT OPTIONS, OUTPUT OPTIONS, GENERAL OPTIONS,
// MATCHER OPTIONS, FILTER OPTIONS). Toggling a flag builds up the command
// preview live. There is no backend to actually run this against —
// clicking "Send" on the worker's send-output panel is what stays unwired,
// not this.
//
// A flag marked isFile expects an existing file (a wordlist, a client cert
// or key, a raw request, a config file, ...) rather than an arbitrary typed
// value — for those, clicking the flag opens an expandable list of
// whatever's actually saved in the selected profile's Project Folder (see
// projectFolder.js) instead of a plain text popup. A single target (-u) or
// a number (-t, -timeout, ...) has no such picker — it's still the plain
// text popup.
//
// A flag marked isOutput instead writes a result to disk (-o, -od,
// -debug-log) — its value popup adds a one-click suggestion to save into
// Project Folder instead of leaving the user to type an arbitrary path.
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
    group: 'basic', title: 'HTTP OPTIONS', flags: [
      { flag: '-u', takesValue: true, desc: 'Target URL' },
      { flag: '-H', takesValue: true, desc: 'Header "Name: Value", separated by colon. Multiple -H flags are accepted.' },
      { flag: '-X', takesValue: true, desc: 'HTTP method to use' },
      { flag: '-b', takesValue: true, desc: 'Cookie data "NAME1=VALUE1; NAME2=VALUE2" for copy as curl functionality.' },
      { flag: '-cc', takesValue: true, isFile: true, desc: 'Client cert for authentication. Client key needs to be defined as well for this to work' },
      { flag: '-ck', takesValue: true, isFile: true, desc: 'Client key for authentication. Client certificate needs to be defined as well for this to work' },
      { flag: '-d', takesValue: true, desc: 'POST data' },
      { flag: '-http2', takesValue: false, desc: 'Use HTTP2 protocol (default: false)' },
      { flag: '-ignore-body', takesValue: false, desc: 'Do not fetch the response content. (default: false)' },
      { flag: '-r', takesValue: false, desc: 'Follow redirects (default: false)' },
      { flag: '-raw', takesValue: false, desc: 'Do not encode URI (default: false)' },
      { flag: '-recursion', takesValue: false, desc: 'Scan recursively. Only FUZZ keyword is supported, and URL (-u) has to end in it. (default: false)' },
      { flag: '-recursion-depth', takesValue: true, desc: 'Maximum recursion depth. (default: 0)' },
      { flag: '-recursion-strategy', takesValue: true, desc: 'Recursion strategy: "default" for a redirect based, and "greedy" to recurse on all matches (default: default)' },
      { flag: '-replay-proxy', takesValue: true, desc: 'Replay matched requests using this proxy.' },
      { flag: '-sni', takesValue: true, desc: 'Target TLS SNI, does not support FUZZ keyword' },
      { flag: '-timeout', takesValue: true, desc: 'HTTP request timeout in seconds. (default: 10)' },
      { flag: '-x', takesValue: true, desc: 'Proxy URL (SOCKS5 or HTTP). For example: http://127.0.0.1:8080 or socks5://127.0.0.1:8080' },
    ],
  },
  {
    group: 'basic', title: 'INPUT OPTIONS', flags: [
      { flag: '-w', takesValue: true, isFile: true, desc: "Wordlist file path and (optional) keyword separated by colon. eg. '/path/to/wordlist:KEYWORD'" },
      { flag: '-D', takesValue: false, desc: 'DirSearch wordlist compatibility mode. Used in conjunction with -e flag. (default: false)' },
      { flag: '-e', takesValue: true, desc: 'Comma separated list of extensions. Extends FUZZ keyword.' },
      { flag: '-enc', takesValue: true, desc: "Encoders for keywords, eg. 'FUZZ:urlencode b64encode'" },
      { flag: '-ic', takesValue: false, desc: 'Ignore wordlist comments (default: false)' },
      { flag: '-input-cmd', takesValue: true, desc: 'Command producing the input. --input-num is required when using this input method. Overrides -w.' },
      { flag: '-input-num', takesValue: true, desc: 'Number of inputs to test. Used in conjunction with --input-cmd. (default: 100)' },
      { flag: '-input-shell', takesValue: true, desc: 'Shell to be used for running command' },
      { flag: '-mode', takesValue: true, desc: 'Multi-wordlist operation mode. Available modes: clusterbomb, pitchfork, sniper (default: clusterbomb)' },
      { flag: '-request', takesValue: true, isFile: true, desc: 'File containing the raw http request' },
      { flag: '-request-proto', takesValue: true, desc: 'Protocol to use along with raw request (default: https)' },
    ],
  },
  {
    group: 'basic', title: 'OUTPUT OPTIONS', flags: [
      { flag: '-debug-log', takesValue: true, isOutput: true, desc: 'Write all of the internal logging to the specified file.' },
      { flag: '-o', takesValue: true, isOutput: true, desc: 'Write output to file' },
      { flag: '-od', takesValue: true, isOutput: true, desc: 'Directory path to store matched results to.' },
      { flag: '-of', takesValue: true, desc: "Output file format. Available formats: json, ejson, html, md, csv, ecsv (or, 'all' for all formats) (default: json)" },
      { flag: '-or', takesValue: false, desc: "Don't create the output file if we don't have results (default: false)" },
    ],
  },
  {
    group: 'advanced', title: 'GENERAL OPTIONS', flags: [
      { flag: '-V', takesValue: false, desc: 'Show version information. (default: false)' },
      { flag: '-ac', takesValue: false, desc: 'Automatically calibrate filtering options (default: false)' },
      { flag: '-acc', takesValue: true, desc: 'Custom auto-calibration string. Can be used multiple times. Implies -ac' },
      { flag: '-ach', takesValue: false, desc: 'Per host autocalibration (default: false)' },
      { flag: '-ack', takesValue: true, desc: 'Autocalibration keyword (default: FUZZ)' },
      { flag: '-acs', takesValue: true, desc: 'Custom auto-calibration strategies. Can be used multiple times. Implies -ac' },
      { flag: '-c', takesValue: false, desc: 'Colorize output. (default: false)' },
      { flag: '-config', takesValue: true, isFile: true, desc: 'Load configuration from a file' },
      { flag: '-json', takesValue: false, desc: 'JSON output, printing newline-delimited JSON records (default: false)' },
      { flag: '-maxtime', takesValue: true, desc: 'Maximum running time in seconds for entire process. (default: 0)' },
      { flag: '-maxtime-job', takesValue: true, desc: 'Maximum running time in seconds per job. (default: 0)' },
      { flag: '-noninteractive', takesValue: false, desc: 'Disable the interactive console functionality (default: false)' },
      { flag: '-p', takesValue: true, desc: 'Seconds of delay between requests, or a range of random delay. For example "0.1" or "0.1-2.0"' },
      { flag: '-rate', takesValue: true, desc: 'Rate of requests per second (default: 0)' },
      { flag: '-s', takesValue: false, desc: 'Do not print additional information (silent mode) (default: false)' },
      { flag: '-sa', takesValue: false, desc: 'Stop on all error cases. Implies -sf and -se. (default: false)' },
      { flag: '-scraperfile', takesValue: true, isFile: true, desc: 'Custom scraper file path' },
      { flag: '-scrapers', takesValue: true, desc: 'Active scraper groups (default: all)' },
      { flag: '-se', takesValue: false, desc: 'Stop on spurious errors (default: false)' },
      { flag: '-search', takesValue: true, desc: 'Search for a FFUFHASH payload from ffuf history' },
      { flag: '-sf', takesValue: false, desc: 'Stop when > 95% of responses return 403 Forbidden (default: false)' },
      { flag: '-t', takesValue: true, desc: 'Number of concurrent threads. (default: 40)' },
      { flag: '-v', takesValue: false, desc: 'Verbose output, printing full URL and redirect location (if any) with the results. (default: false)' },
    ],
  },
  {
    group: 'advanced', title: 'MATCHER OPTIONS', flags: [
      { flag: '-mc', takesValue: true, desc: 'Match HTTP status codes, or "all" for everything. (default: 200-299,301,302,307,401,403,405,500)' },
      { flag: '-ml', takesValue: true, desc: 'Match amount of lines in response' },
      { flag: '-mmode', takesValue: true, desc: 'Matcher set operator. Either of: and, or (default: or)' },
      { flag: '-mr', takesValue: true, desc: 'Match regexp' },
      { flag: '-ms', takesValue: true, desc: 'Match HTTP response size' },
      { flag: '-mt', takesValue: true, desc: 'Match how many milliseconds to the first response byte, either greater or less than. EG: >100 or <100' },
      { flag: '-mw', takesValue: true, desc: 'Match amount of words in response' },
    ],
  },
  {
    group: 'advanced', title: 'FILTER OPTIONS', flags: [
      { flag: '-fc', takesValue: true, desc: 'Filter HTTP status codes from response. Comma separated list of codes and ranges' },
      { flag: '-fl', takesValue: true, desc: 'Filter by amount of lines in response. Comma separated list of line counts and ranges' },
      { flag: '-fmode', takesValue: true, desc: 'Filter set operator. Either of: and, or (default: or)' },
      { flag: '-fr', takesValue: true, desc: 'Filter regexp' },
      { flag: '-fs', takesValue: true, desc: 'Filter HTTP response size. Comma separated list of sizes and ranges' },
      { flag: '-ft', takesValue: true, desc: 'Filter by number of milliseconds to the first response byte, either greater or less than. EG: >100 or <100' },
      { flag: '-fw', takesValue: true, desc: 'Filter by amount of words in response. Comma separated list of word counts and ranges' },
    ],
  },
];

function flagLabel(f) { return f.alias ? `${f.flag}, ${f.alias}` : f.flag; }
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
            <button type="button" class="flag-btn" data-flag="${f.flag}" data-takes-value="${f.takesValue}" data-is-file="${!!f.isFile}" data-is-output="${!!f.isOutput}" data-output-target="${f.outputTarget || 'project'}"
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
  id: 'ffuf-panel',
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
      ${commandPreviewHtml('ffuf')}`;

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
    // flag -> value ('' for boolean flags that are simply on/off)
    // Persisted across mounts (see workerSession.js) -- switching away from
    // this worker's view and back (or to a different worker and back)
    // shouldn't reset flags already built up here.
    const session = getSession('ffuf');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['ffuf'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      // live-terminal.js's Send button has no other way to see what this
      // panel has built -- it doesn't import this module (each worker's
      // control panel is loaded independently, see index.js's
      // loadControlPanel) -- so the current flag selection travels over the
      // shared ctx bus instead, same wiring as subfinder-panel.js.
      ctx.emit('ffuf:flags', Object.fromEntries(active));
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

    // File-taking flags (-w, -cc, -ck, -request, -config, -scraperfile)
    // pick from whatever the selected profile actually has saved in its
    // Project Folder, instead of a blind typed value — same storage
    // wordlist-template.js/send-output.js write into (see
    // js/projectFolder.js).
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
        panel.innerHTML = '<div class="flag-file-status">Select a company profile to browse its Project Folder.</div>' + WORDLIST_BROWSE_HTML + CONFIG_BROWSE_HTML;
        bindWordlistBrowse(panel, pick);
        bindConfigBrowse(panel, pick);
        return;
      }
      projectFolder.list().then(files => {
        if (closeOpenPopup !== cleanup) return; // closed/replaced while this was in flight
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
