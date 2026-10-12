// katana control panel. Same approach as subfinder-panel.js: every button
// below corresponds to a flag documented in
// .github/worker_instructions/katana.md, grouped the same way that doc
// groups them (INPUT, CONFIGURATION, DEBUG, SCOPE, FILTER,
// RATE-LIMIT, UPDATE, OUTPUT). Toggling a flag builds up the command
// preview live. There is no backend to actually run this against —
// clicking "Send" on the worker's send-output panel is what stays unwired,
// not this.
//
// The entire HEADLESS group (-headless, -hybrid, -system-chrome and the
// chrome-only options that depend on them) is excluded: it needs a headless
// Chromium runtime, which the katana-worker image in
// workers/katana-worker/Dockerfile does not install.
//
// A flag marked isFile expects an existing file (a resolver list, a
// katana/form/field config file, ...) rather than an arbitrary typed value
// — for those, clicking the flag opens an expandable list of whatever's
// actually saved in the selected profile's Project Folder (see
// projectFolder.js) instead of a plain text popup. A single target (-u) or
// a number (-d, -timeout, ...) has no such picker — it's still the plain
// text popup.
//
// A flag marked isOutput instead writes a result to disk (-o, -srd, -sfd,
// -elog) — its value popup adds a one-click suggestion to save into Project
// Folder instead of leaving the user to type an arbitrary path.
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
    group: 'basic', title: 'INPUT', flags: [
      { flag: '-u', alias: '-list', takesValue: true, desc: 'target url / list to crawl' },
      { flag: '-resume', takesValue: true, isFile: true, desc: 'resume scan using resume.cfg' },
      { flag: '-e', alias: '-exclude', takesValue: true, desc: "exclude host matching specified filter ('cdn', 'private-ips', cidr, ip, regex)" },
    ],
  },
  {
    group: 'basic', title: 'CONFIGURATION', flags: [
      { flag: '-r', alias: '-resolvers', takesValue: true, isFile: true, desc: 'list of custom resolver (file or comma separated)' },
      { flag: '-d', alias: '-depth', takesValue: true, desc: 'maximum depth to crawl (default 3)' },
      { flag: '-jc', alias: '-js-crawl', takesValue: false, desc: 'enable endpoint parsing / crawling in javascript file' },
      { flag: '-jsl', alias: '-jsluice', takesValue: false, desc: 'enable jsluice parsing in javascript file (memory intensive)' },
      { flag: '-ct', alias: '-crawl-duration', takesValue: true, desc: 'maximum duration to crawl the target for (s, m, h, d) (default s)' },
      { flag: '-kf', alias: '-known-files', takesValue: true, desc: 'enable crawling of known files (all,robotstxt,sitemapxml), a minimum depth of 3 is required to ensure all known files are properly crawled.' },
      { flag: '-mrs', alias: '-max-response-size', takesValue: true, desc: 'maximum response size to read (default 4194304)' },
      { flag: '-timeout', takesValue: true, desc: 'time to wait for request in seconds (default 10)' },
      { flag: '-time-stable', takesValue: true, desc: 'time to wait until the page is stable in seconds (default 1)' },
      { flag: '-aff', alias: '-automatic-form-fill', takesValue: false, desc: 'enable automatic form filling (experimental)' },
      { flag: '-fx', alias: '-form-extraction', takesValue: false, desc: 'extract form, input, textarea & select elements in jsonl output' },
      { flag: '-retry', takesValue: true, desc: 'number of times to retry the request (default 1)' },
      { flag: '-proxy', takesValue: true, desc: 'http/socks5 proxy to use' },
      { flag: '-td', alias: '-tech-detect', takesValue: false, desc: 'enable technology detection' },
      { flag: '-H', alias: '-headers', takesValue: true, desc: 'custom header/cookie to include in all http request in header:value format (file)' },
      { flag: '-config', takesValue: true, isFile: true, desc: 'path to the katana configuration file' },
      { flag: '-fc', alias: '-form-config', takesValue: true, isFile: true, desc: 'path to custom form configuration file' },
      { flag: '-flc', alias: '-field-config', takesValue: true, isFile: true, desc: 'path to custom field configuration file' },
      { flag: '-s', alias: '-strategy', takesValue: true, desc: 'Visit strategy (depth-first, breadth-first) (default "depth-first")' },
      { flag: '-iqp', alias: '-ignore-query-params', takesValue: false, desc: 'Ignore crawling same path with different query-param values' },
      { flag: '-fsu', alias: '-filter-similar', takesValue: false, desc: 'filter crawling of similar looking URLs (e.g., /users/123 and /users/456)' },
      { flag: '-fst', alias: '-filter-similar-threshold', takesValue: true, desc: 'number of distinct values before a path position is treated as parameter (default 10)' },
      { flag: '-tlsi', alias: '-tls-impersonate', takesValue: false, desc: 'enable experimental client hello (ja3) tls randomization' },
      { flag: '-dr', alias: '-disable-redirects', takesValue: false, desc: 'disable following redirects (default false)' },
      { flag: '-pc', alias: '-path-climb', takesValue: false, desc: 'enable path climb (auto crawl parent paths)' },
      { flag: '-kb', alias: '-knowledge-base', takesValue: false, desc: 'enable knowledge base classification' },
      { flag: '-mdp', alias: '-max-domain-pages', takesValue: true, desc: 'maximum number of pages to crawl per domain (default unlimited)' },
    ],
  },
  {
    group: 'basic', title: 'OUTPUT', flags: [
      { flag: '-o', alias: '-output', takesValue: true, isOutput: true, desc: 'file to write output to' },
      { flag: '-output-template', takesValue: true, desc: 'custom output template' },
      { flag: '-sr', alias: '-store-response', takesValue: false, desc: 'store http requests/responses' },
      { flag: '-srd', alias: '-store-response-dir', takesValue: true, isOutput: true, desc: 'store http requests/responses to custom directory' },
      { flag: '-ncb', alias: '-no-clobber', takesValue: false, desc: 'do not overwrite output file' },
      { flag: '-sfd', alias: '-store-field-dir', takesValue: true, isOutput: true, desc: 'store per-host field to custom directory' },
      { flag: '-or', alias: '-omit-raw', takesValue: false, desc: 'omit raw requests/responses from jsonl output' },
      { flag: '-ob', alias: '-omit-body', takesValue: false, desc: 'omit response body from jsonl output' },
      { flag: '-lof', alias: '-list-output-fields', takesValue: false, desc: 'list of fields to output in jsonl format' },
      { flag: '-eof', alias: '-exclude-output-fields', takesValue: false, desc: 'exclude fields from jsonl output' },
      { flag: '-j', alias: '-jsonl', takesValue: false, desc: 'write output in jsonl format' },
      { flag: '-nc', alias: '-no-color', takesValue: false, desc: 'disable output content coloring (ANSI escape codes)' },
      { flag: '-silent', takesValue: false, desc: 'display output only' },
      { flag: '-v', alias: '-verbose', takesValue: false, desc: 'display verbose output' },
      { flag: '-debug', takesValue: false, desc: 'display debug output' },
      { flag: '-version', takesValue: false, desc: 'display project version' },
    ],
  },
  {
    group: 'advanced', title: 'DEBUG', flags: [
      { flag: '-health-check', alias: '-hc', takesValue: false, desc: 'run diagnostic check up' },
      { flag: '-elog', alias: '-error-log', takesValue: true, isOutput: true, desc: 'file to write sent requests error log' },
      { flag: '-pprof-server', takesValue: false, desc: 'enable pprof server' },
    ],
  },
  {
    group: 'advanced', title: 'SCOPE', flags: [
      { flag: '-cs', alias: '-crawl-scope', takesValue: true, desc: 'in scope url regex to be followed by crawler' },
      { flag: '-cos', alias: '-crawl-out-scope', takesValue: true, desc: 'out of scope url regex to be excluded by crawler' },
      { flag: '-fs', alias: '-field-scope', takesValue: true, desc: "pre-defined scope field (dn,rdn,fqdn) or custom regex (e.g., '(company-staging.io|company.com)') (default \"rdn\")" },
      { flag: '-ns', alias: '-no-scope', takesValue: false, desc: 'disables host based default scope' },
      { flag: '-do', alias: '-display-out-scope', takesValue: false, desc: 'display external endpoint from scoped crawling' },
    ],
  },
  {
    group: 'advanced', title: 'FILTER', flags: [
      { flag: '-mr', alias: '-match-regex', takesValue: true, desc: 'regex or list of regex to match on output url (cli, file)' },
      { flag: '-fr', alias: '-filter-regex', takesValue: true, desc: 'regex or list of regex to filter on output url (cli, file)' },
      { flag: '-f', alias: '-field', takesValue: true, desc: 'field to display in output (url,path,fqdn,rdn,rurl,qurl,qpath,file,ufile,key,value,kv,dir,udir) (Deprecated: use -output-template instead)' },
      { flag: '-sf', alias: '-store-field', takesValue: true, desc: 'field to store in per-host output (url,path,fqdn,rdn,rurl,qurl,qpath,file,ufile,key,value,kv,dir,udir)' },
      { flag: '-em', alias: '-extension-match', takesValue: true, desc: 'match output for given extension (eg, -em php,html,js,none)' },
      { flag: '-ef', alias: '-extension-filter', takesValue: true, desc: 'filter output for given extension (eg, -ef png,css)' },
      { flag: '-ndef', alias: '-no-default-ext-filter', takesValue: false, desc: 'remove default extensions from the filter list' },
      { flag: '-mdc', alias: '-match-condition', takesValue: true, desc: 'match response with dsl based condition' },
      { flag: '-fdc', alias: '-filter-condition', takesValue: true, desc: 'filter response with dsl based condition' },
      { flag: '-duf', alias: '-disable-unique-filter', takesValue: false, desc: 'disable duplicate content filtering' },
      { flag: '-fpt', alias: '-filter-page-type', takesValue: true, desc: 'filter response with page type (e.g. error,captcha,parked)' },
    ],
  },
  {
    group: 'advanced', title: 'RATE-LIMIT', flags: [
      { flag: '-c', alias: '-concurrency', takesValue: true, desc: 'number of concurrent fetchers to use (default 10)' },
      { flag: '-p', alias: '-parallelism', takesValue: true, desc: 'number of concurrent inputs to process (default 10)' },
      { flag: '-rd', alias: '-delay', takesValue: true, desc: 'request delay between each request in seconds' },
      { flag: '-rl', alias: '-rate-limit', takesValue: true, desc: 'maximum requests to send per second (default 150)' },
      { flag: '-rlm', alias: '-rate-limit-minute', takesValue: true, desc: 'maximum number of requests to send per minute' },
      { flag: '-hrl', alias: '-host-rate-limit', takesValue: true, desc: 'maximum requests to send per second per host' },
      { flag: '-hrlm', alias: '-host-rate-limit-minute', takesValue: true, desc: 'maximum number of requests to send per minute per host' },
    ],
  },
  {
    group: 'advanced', title: 'UPDATE', flags: [
      { flag: '-up', alias: '-update', takesValue: false, desc: 'update katana to latest version' },
      { flag: '-duc', alias: '-disable-update-check', takesValue: false, desc: 'disable automatic katana update check' },
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
  id: 'katana-panel',
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
      ${commandPreviewHtml('katana')}`;

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
    const session = getSession('katana');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['katana'];
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
      ctx.emit('katana:flags', Object.fromEntries(active));
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

    // File-taking flags (-resume, -r, -config, -fc, -flc) pick from
    // whatever the selected profile actually has saved in its Project
    // Folder, instead of a blind typed value — same storage
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
