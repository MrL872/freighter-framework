// sqlmap control panel. Same approach as gau-panel.js: toggling a flag
// builds up the command preview live and drives a real backend run via
// ctx.emit('sqlmap:flags', ...), consumed by live-terminal.js.
//
// Flags below are remapped from .github/worker_instructions/sqlmap.md (the
// real `sqlmap.py --help`/`-hh` dump) -- sqlmap's full option list runs well
// past 300 flags across ~18 categories, so this is a curated subset of the
// ones that make sense in a non-interactive, single-run model, not a 1:1
// dump like the smaller tools got. Left out entirely: -h/-hh/--version/
// --update (info/self-update, not a scan); interactive-prompt flags
// (--sql-shell, --os-shell, --os-pwn, --os-smbrelay, --gui, --wizard,
// --tui, --shell) since this worker has no stdin to answer them; Windows
// registry access and UDF injection (narrow, high-risk, rarely applicable
// through a web target); brute-force table/column guessing (--common-*).
//
// sqlmap's target is a flag (-u/--url), not a bare positional -- unlike
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
      { flag: '-u', alias: '--url', takesValue: true, desc: 'Target URL (e.g. "http://www.site.com/vuln.php?id=1")' },
      { flag: '-d', takesValue: true, desc: 'Connection string for direct database connection' },
      { flag: '-r', alias: '--request-file', takesValue: true, isFile: true, desc: 'Load HTTP request from a file' },
      { flag: '-l', takesValue: true, isFile: true, desc: 'Parse target(s) from a Burp or WebScarab proxy log file' },
      { flag: '-m', takesValue: true, isFile: true, desc: 'Scan multiple targets given in a textual file' },
      { flag: '-g', takesValue: true, desc: 'Process Google dork results as target URLs' },
      { flag: '-c', takesValue: true, isFile: true, desc: 'Load options from a configuration INI file' },
    ],
  },
  {
    group: 'basic', title: 'REQUEST', flags: [
      { flag: '-A', alias: '--user-agent', takesValue: true, desc: 'HTTP User-Agent header value' },
      { flag: '-H', alias: '--header', takesValue: true, desc: 'Extra header (e.g. "X-Forwarded-For: 127.0.0.1")' },
      { flag: '--method', takesValue: true, desc: 'Force usage of given HTTP method (e.g. PUT)' },
      { flag: '--data', takesValue: true, desc: 'Data string to be sent through POST (e.g. "id=1")' },
      { flag: '--cookie', takesValue: true, desc: 'HTTP Cookie header value (e.g. "PHPSESSID=a8d127e..")' },
      { flag: '--random-agent', takesValue: false, desc: 'Use randomly selected HTTP User-Agent header value' },
      { flag: '--host', takesValue: true, desc: 'HTTP Host header value' },
      { flag: '--referer', takesValue: true, desc: 'HTTP Referer header value' },
      { flag: '--proxy', takesValue: true, desc: 'Use a proxy to connect to the target URL' },
      { flag: '--tor', takesValue: false, desc: 'Use Tor anonymity network' },
      { flag: '--delay', takesValue: true, desc: 'Delay in seconds between each HTTP request' },
      { flag: '--timeout', takesValue: true, desc: 'Seconds to wait before timeout connection (default 30)' },
      { flag: '--retries', takesValue: true, desc: 'Retries when the connection timeouts (default 3)' },
    ],
  },
  {
    group: 'basic', title: 'DETECTION', flags: [
      { flag: '--level', takesValue: true, desc: 'Level of tests to perform (1-5, default 1)' },
      { flag: '--risk', takesValue: true, desc: 'Risk of tests to perform (1-3, default 1)' },
      { flag: '--string', takesValue: true, desc: 'String to match when query is evaluated to True' },
      { flag: '--not-string', takesValue: true, desc: 'String to match when query is evaluated to False' },
      { flag: '--text-only', takesValue: false, desc: 'Compare pages based only on the textual content' },
      { flag: '--batch', takesValue: false, desc: 'Never ask for user input, use the default behavior' },
    ],
  },
  {
    group: 'advanced', title: 'OPTIMIZATION', flags: [
      { flag: '-o', takesValue: false, desc: 'Turn on all optimization switches' },
      { flag: '--threads', takesValue: true, desc: 'Max number of concurrent HTTP(s) requests (default 1)' },
    ],
  },
  {
    group: 'advanced', title: 'INJECTION', flags: [
      { flag: '-p', takesValue: true, desc: 'Testable parameter(s)' },
      { flag: '--skip', takesValue: true, desc: 'Skip testing for given parameter(s)' },
      { flag: '--dbms', takesValue: true, desc: 'Force back-end DBMS to provided value' },
      { flag: '--os', takesValue: true, desc: 'Force back-end DBMS operating system to provided value' },
      { flag: '--tamper', takesValue: true, desc: 'Use given script(s) for tampering injection data' },
      { flag: '--prefix', takesValue: true, desc: 'Injection payload prefix string' },
      { flag: '--suffix', takesValue: true, desc: 'Injection payload suffix string' },
    ],
  },
  {
    group: 'advanced', title: 'TECHNIQUES', flags: [
      { flag: '--technique', takesValue: true, desc: 'SQL injection techniques to use (default "BEUSTQ")' },
      { flag: '--time-sec', takesValue: true, desc: 'Seconds to delay the DBMS response (default 5)' },
      { flag: '--union-cols', takesValue: true, desc: 'Range of columns to test for UNION query SQL injection' },
    ],
  },
  {
    group: 'advanced', title: 'FINGERPRINT', flags: [
      { flag: '-f', alias: '--fingerprint', takesValue: false, desc: 'Perform an extensive DBMS version fingerprint' },
    ],
  },
  {
    group: 'advanced', title: 'ENUMERATION', flags: [
      { flag: '-a', alias: '--all', takesValue: false, desc: 'Retrieve everything' },
      { flag: '-b', alias: '--banner', takesValue: false, desc: 'Retrieve DBMS banner' },
      { flag: '--current-user', takesValue: false, desc: 'Retrieve DBMS current user' },
      { flag: '--current-db', takesValue: false, desc: 'Retrieve DBMS current database' },
      { flag: '--hostname', takesValue: false, desc: 'Retrieve DBMS server hostname' },
      { flag: '--is-dba', takesValue: false, desc: 'Detect if the DBMS current user is DBA' },
      { flag: '--users', takesValue: false, desc: 'Enumerate DBMS users' },
      { flag: '--passwords', takesValue: false, desc: 'Enumerate DBMS users password hashes' },
      { flag: '--privileges', takesValue: false, desc: 'Enumerate DBMS users privileges' },
      { flag: '--roles', takesValue: false, desc: 'Enumerate DBMS users roles' },
      { flag: '--dbs', takesValue: false, desc: 'Enumerate DBMS databases' },
      { flag: '--tables', takesValue: false, desc: 'Enumerate DBMS database tables' },
      { flag: '--columns', takesValue: false, desc: 'Enumerate DBMS database table columns' },
      { flag: '--schema', takesValue: false, desc: 'Enumerate DBMS schema' },
      { flag: '--dump', takesValue: false, desc: 'Dump DBMS database table entries' },
      { flag: '--dump-all', takesValue: false, desc: 'Dump entries of all DBMS database tables' },
      { flag: '--search', takesValue: false, desc: 'Search column(s), table(s) and/or database name(s)' },
      { flag: '-D', takesValue: true, desc: 'DBMS database to enumerate' },
      { flag: '-T', takesValue: true, desc: 'DBMS database table(s) to enumerate' },
      { flag: '-C', takesValue: true, desc: 'DBMS database table column(s) to enumerate' },
      { flag: '-U', takesValue: true, desc: 'DBMS user to enumerate' },
      { flag: '-X', takesValue: true, desc: 'DBMS database identifier(s) to not enumerate' },
      { flag: '--exclude-sysdbs', takesValue: false, desc: 'Exclude DBMS system databases when enumerating tables' },
      { flag: '--count', takesValue: false, desc: 'Retrieve number of entries for table(s)' },
    ],
  },
  {
    group: 'advanced', title: 'FILE SYSTEM', flags: [
      { flag: '--file-read', takesValue: true, desc: 'Read a file from the back-end DBMS file system' },
      { flag: '--file-write', takesValue: true, isFile: true, desc: 'Write a local file on the back-end DBMS file system' },
      { flag: '--file-dest', takesValue: true, desc: 'Back-end DBMS absolute filepath to write to' },
    ],
  },
  {
    group: 'advanced', title: 'OS ACCESS', flags: [
      { flag: '--os-cmd', takesValue: true, desc: 'Execute an operating system command' },
    ],
  },
  {
    group: 'advanced', title: 'GENERAL', flags: [
      { flag: '-s', takesValue: true, isFile: true, desc: 'Load session from a stored (.sqlite) file' },
      { flag: '-t', takesValue: true, isOutput: true, desc: 'Log all HTTP traffic into a textual file' },
      { flag: '--crawl', takesValue: true, desc: 'Crawl the website starting from the target URL' },
      { flag: '--dump-file', takesValue: true, isOutput: true, desc: 'Store dumped data to a custom file' },
      { flag: '--flush-session', takesValue: false, desc: 'Flush session files for current target' },
      { flag: '--forms', takesValue: false, desc: 'Parse and test forms on target URL' },
      { flag: '--fresh-queries', takesValue: false, desc: 'Ignore query results stored in session file' },
      { flag: '--har', takesValue: true, isOutput: true, desc: 'Log all HTTP traffic into a HAR file' },
      { flag: '--eta', takesValue: false, desc: 'Display for each output the estimated time of arrival' },
    ],
  },
  {
    group: 'advanced', title: 'MISC', flags: [
      { flag: '--beep', takesValue: false, desc: 'Beep on question and/or when vulnerability is found' },
      { flag: '--disable-coloring', takesValue: false, desc: 'Disable console output coloring' },
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
  id: 'sqlmap-panel',
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
      ${commandPreviewHtml('sqlmap')}`;

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
    const session = getSession('sqlmap');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['sqlmap'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        if (btn.dataset.bare === 'true') { tokens.push(value); return; }
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      ctx.emit('sqlmap:flags', Object.fromEntries(active));
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
