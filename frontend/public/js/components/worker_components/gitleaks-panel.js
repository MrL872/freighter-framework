// gitleaks control panel. Same approach as subfinder-panel.js: every button
// below corresponds to a flag documented in
// .github/worker_instructions/gitleaks.md, grouped by purpose (that doc
// lists flags flat) — COMMAND, COMMAND OPTIONS, CONFIGURATION, RULES, OUTPUT,
// DIAGNOSTICS, LIMITS, DEBUG. Toggling a flag builds up the command preview live, and
// also drives a real backend run (see the
// ctx.emit('gitleaks:flags', ...) call in renderCommand() below, same
// wiring as subfinder-panel.js).
//
// gitleaks dispatches on a subcommand (dir/git/stdin/version), not a flag —
// those live in the COMMAND section as `bare: true` entries: each
// contributes just its own token to the command, no leading dash, same
// toggle as any other flag (nothing stops more than one being active at
// once client-side, though the backend's GitleaksFlags rejects more than
// one bare command in a single run).
//
// A flag marked isFile expects an existing file (a config file, a baseline,
// a .gitleaksignore, a report template) rather than an arbitrary typed
// value — for those, clicking the flag opens an expandable list of
// whatever's actually saved in the selected profile's Project Folder (see
// projectFolder.js) instead of a plain text popup. A number or path meant to
// be typed (--timeout, ...) has no such picker — it's still the plain text
// popup.
//
// A flag marked isOutput instead writes a result to disk (-r/--report-path)
// — its value popup adds a one-click suggestion to save into Project Folder
// instead of leaving the user to type an arbitrary path. Note: the backend
// worker always forces its own -f json -r <tmpfile> when actually running a
// scan (see gitleaks-worker/main.go), so this panel's -f/-r selections are
// currently decorative -- kept here since they're still valid gitleaks
// flags and may matter once/if that override is revisited.
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
    group: 'basic', title: 'COMMAND', flags: [
      { flag: 'dir', bare: true, takesValue: false, desc: 'scan directories or files for secrets' },
      { flag: 'git', bare: true, takesValue: false, desc: 'scan git repositories for secrets' },
      { flag: 'stdin', bare: true, takesValue: false, desc: 'detect secrets from stdin' },
      { flag: 'version', bare: true, takesValue: false, desc: 'display gitleaks version' },
    ],
  },
  {
    group: 'basic', title: 'COMMAND OPTIONS', flags: [
      { flag: '--follow-symlinks', takesValue: false, desc: 'scan files that are symlinks to other files (dir)' },
      { flag: '--log-opts', takesValue: true, desc: 'git log options (git)' },
      { flag: '--platform', takesValue: true, desc: 'the target platform used to generate links (github, gitlab) (git)' },
      { flag: '--pre-commit', takesValue: false, desc: 'scan using git diff (git)' },
      { flag: '--staged', takesValue: false, desc: 'scan staged commits (good for pre-commit) (git)' },
    ],
  },
  {
    group: 'basic', title: 'CONFIGURATION', flags: [
      { flag: '-c', alias: '--config', takesValue: true, isFile: true, desc: 'config file path (order of precedence: --config/-c, env var GITLEAKS_CONFIG, env var GITLEAKS_CONFIG_TOML, (target path)/.gitleaks.toml, else default config)' },
      { flag: '-b', alias: '--baseline-path', takesValue: true, isFile: true, desc: 'path to baseline with issues that can be ignored' },
      { flag: '-i', alias: '--gitleaks-ignore-path', takesValue: true, isFile: true, desc: 'path to .gitleaksignore file or folder containing one (default ".")' },
    ],
  },
  {
    group: 'basic', title: 'OUTPUT', flags: [
      { flag: '-f', alias: '--report-format', takesValue: true, desc: 'output format (json, csv, junit, sarif, template)' },
      { flag: '-r', alias: '--report-path', takesValue: true, isOutput: true, desc: 'report file (use "-" for stdout)' },
      { flag: '--report-template', takesValue: true, isFile: true, desc: 'template file used to generate the report (implies --report-format=template)' },
      { flag: '--redact', takesValue: true, desc: 'redact secrets from logs and stdout; percent value 0..100 (default 100%)' },
    ],
  },
  {
    group: 'advanced', title: 'RULES', flags: [
      { flag: '--enable-rule', takesValue: true, desc: 'only enable specific rules by id' },
      { flag: '--ignore-gitleaks-allow', takesValue: false, desc: 'ignore gitleaks:allow comments' },
    ],
  },
  {
    group: 'advanced', title: 'LIMITS', flags: [
      { flag: '--exit-code', takesValue: true, desc: 'exit code when leaks have been encountered (default 1)' },
      { flag: '--max-archive-depth', takesValue: true, desc: 'allow scanning into nested archives up to this depth (default "0", no archive traversal is done)' },
      { flag: '--max-decode-depth', takesValue: true, desc: 'allow recursive decoding up to this depth (default 5)' },
      { flag: '--max-target-megabytes', takesValue: true, desc: 'files larger than this will be skipped' },
      { flag: '--timeout', takesValue: true, desc: 'set a timeout for gitleaks commands in seconds (default "0", no timeout is set)' },
    ],
  },
  {
    group: 'advanced', title: 'DIAGNOSTICS', flags: [
      { flag: '--diagnostics', takesValue: true, desc: 'enable diagnostics (http OR comma-separated list: cpu,mem,trace). cpu=CPU prof, mem=memory prof, trace=exec tracing, http=serve via net/http/pprof' },
      { flag: '--diagnostics-dir', takesValue: true, desc: 'directory to store diagnostics output files when not using http mode (defaults to current directory)' },
    ],
  },
  {
    group: 'advanced', title: 'DEBUG', flags: [
      { flag: '-l', alias: '--log-level', takesValue: true, desc: 'log level (trace, debug, info, warn, error, fatal) (default "info")' },
      { flag: '-v', alias: '--verbose', takesValue: false, desc: 'show verbose output from scan' },
      { flag: '--no-banner', takesValue: false, desc: 'suppress banner' },
      { flag: '--no-color', takesValue: false, desc: 'turn off color for verbose output' },
      { flag: '--version', takesValue: false, desc: 'version for gitleaks' },
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
  id: 'gitleaks-panel',
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
      ${commandPreviewHtml('gitleaks')}`;

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
    const session = getSession('gitleaks');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['gitleaks'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        if (btn.dataset.bare === 'true') { tokens.push(flag); return; }
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      // live-terminal.js's Send button has no other way to see what this
      // panel has built -- it doesn't import this module (each worker's
      // control panel is loaded independently, see index.js's
      // loadControlPanel) -- so the current flag selection travels over the
      // shared ctx bus instead, same principle as chat-toggle.js/menu.js.
      ctx.emit('gitleaks:flags', Object.fromEntries(active));
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

    // File-taking flags (-c, -b, -i, --report-template) pick from whatever
    // the selected profile actually has saved in its Project Folder,
    // instead of a blind typed value — same storage
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
