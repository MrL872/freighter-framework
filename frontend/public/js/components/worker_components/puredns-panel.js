// PureDNS control panel. Same approach as shuffledns-panel.js: every button
// below corresponds to a flag/command documented in
// .github/worker_instructions/puredns.md. Toggling a flag builds up the
// command preview live. There is no backend to actually run this
// against — clicking "Send" on the worker's send-output panel is what stays
// unwired, not this.
//
// puredns has two subcommands (resolve, bruteforce) instead of a flat flag
// list, so the basic group offers a command picker first; the shared flags
// (-q, -r, ...) are appended regardless of which subcommand is active.
//
// A flag marked isFile expects an existing file (a domain list, a wordlist,
// a resolver list, ...) rather than an arbitrary typed value — for those,
// clicking the flag opens an expandable list of whatever's actually saved
// in the selected profile's Project Folder (see projectFolder.js) instead
// of a plain text popup.
import { store } from '../../store.js';
import { getSession } from '../../workerSession.js';
import { suppressTransition } from '../../domTransition.js';
import { projectFolder } from '../../projectFolder.js';
import { WORDLIST_BROWSE_HTML, bindWordlistBrowse } from '../../wordlistBrowser.js';
import { commandPreviewHtml, bindCommandPreview } from '../../commandPreview.js';
import { flagSearchHtml, bindFlagSearch } from '../../flagSearch.js';
import { addOutputDestination, destinationValue } from '../../outputDestination.js';

const COMMANDS = [
  { id: 'resolve', label: 'resolve', desc: 'Resolve a list of domains', takesValue: true, isFile: true, placeholder: 'domains.txt' },
  { id: 'bruteforce', label: 'bruteforce', desc: 'Bruteforce subdomains using a wordlist', takesValue: true, isFile: true, placeholder: 'wordlist.txt domain.com' },
];

const FLAG_SECTIONS = [
  {
    group: 'basic', title: 'FLAGS', flags: [
      { flag: '-r', alias: '--resolvers', takesValue: true, isFile: true, desc: 'Text file containing public resolvers' },
      { flag: '--resolvers-trusted', takesValue: true, isFile: true, desc: 'Text file containing trusted resolvers' },
    ],
  },
  {
    group: 'advanced', title: 'RATE-LIMIT', flags: [
      { flag: '-l', alias: '--rate-limit', takesValue: true, desc: 'Limit total queries per second for public resolvers (0 = unlimited)' },
      { flag: '--rate-limit-trusted', takesValue: true, desc: 'Limit total queries per second for trusted resolvers (0 = unlimited, default 500)' },
      { flag: '-t', alias: '--threads', takesValue: true, desc: 'Number of threads to use while filtering wildcards (default 100)' },
    ],
  },
  {
    group: 'advanced', title: 'WILDCARDS', flags: [
      { flag: '--skip-wildcard-filter', takesValue: false, desc: 'Do not perform wildcard detection and filtering' },
      { flag: '--wildcard-batch', takesValue: true, desc: 'Number of subdomains to test for wildcards in a single batch (0 = unlimited)' },
      { flag: '-n', alias: '--wildcard-tests', takesValue: true, desc: 'Number of tests to perform to detect DNS load balancing (default 3)' },
    ],
  },
  {
    group: 'advanced', title: 'GENERAL', flags: [
      { flag: '-q', alias: '--quiet', takesValue: false, desc: 'Quiet mode' },
      { flag: '--debug', takesValue: false, desc: 'Keep intermediate files' },
      { flag: '--skip-sanitize', takesValue: false, desc: 'Do not sanitize the list of domains to test' },
      { flag: '--skip-validation', takesValue: false, desc: 'Do not validate results with trusted resolvers' },
      { flag: '--trusted-only', takesValue: false, desc: 'Use only trusted resolvers (implies --skip-validation)' },
    ],
  },
];

function flagLabel(f) { return f.alias ? `${f.flag}, ${f.alias}` : f.flag; }
// Safe for both an HTML attribute and a text node — used for flag/command
// descriptions (from this file, trusted) and, below, for Project Folder
// file names (user-entered via rename, not trusted).
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function renderCommandSection() {
  return `
    <div class="flag-section">
      <h4 class="flag-section-title">COMMAND</h4>
      <div class="flag-btns">
        ${COMMANDS.map(c => `
          <span class="flag-btn-wrap">
            <button type="button" class="flag-btn" data-command="${c.id}" data-takes-value="${c.takesValue}" data-is-file="${!!c.isFile}"
              aria-pressed="false" title="${escapeHtml(c.desc)}">${c.label}</button>
          </span>`).join('')}
      </div>
    </div>`;
}

function renderSection(section) {
  return `
    <div class="flag-section">
      <h4 class="flag-section-title">${section.title}</h4>
      <div class="flag-btns">
        ${section.flags.map(f => `
          <span class="flag-btn-wrap">
            <button type="button" class="flag-btn" data-flag="${f.flag}" data-takes-value="${f.takesValue}" data-is-file="${!!f.isFile}"
              aria-pressed="false" title="${escapeHtml(f.desc)}">${flagLabel(f)}</button>
          </span>`).join('')}
      </div>
    </div>`;
}

function renderGroup(id, title, sections, extraHtml) {
  return `
    <div class="flag-group">
      <button type="button" class="flag-group-head" aria-expanded="false" aria-controls="flags-${id}">
        <span class="glyph" aria-hidden="true">&gt;</span>${title}
      </button>
      <div class="flag-group-body-wrap">
        <div class="flag-group-body" id="flags-${id}">
          ${extraHtml || ''}
          ${sections.map(renderSection).join('')}
        </div>
      </div>
    </div>`;
}

export default {
  id: 'puredns-panel',
  css: ['static/worker-view.css', 'static/flag-panel.css'],
  critical: false,
  mount(container, ctx) {
    const basicSections = FLAG_SECTIONS.filter(s => s.group === 'basic');
    const advancedSections = FLAG_SECTIONS.filter(s => s.group === 'advanced');

    container.innerHTML = `
      <div class="panel-head">Control panel${flagSearchHtml()}</div>
      <div class="control-body">
        ${renderGroup('basic', 'Basic flags', basicSections, renderCommandSection())}
        ${renderGroup('advanced', 'Advanced flags', advancedSections)}
      </div>
      ${commandPreviewHtml('puredns')}`;

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

    // puredns dispatches on a subcommand (resolve/bruteforce) rather than a
    // flag, so each COMMANDS entry is fed to the parser as an ordinary
    // dash-less, value-taking flag (commandParser.js doesn't care whether a
    // flag name starts with "-" -- see its own module comment) -- onApply
    // below pulls whichever one matched back out into session.activeCommand.
    const preview = bindCommandPreview(container, {
      onClear: clearAllFlags,
      flagDefs: [...FLAG_SECTIONS.flatMap(s => s.flags), ...COMMANDS.map(c => ({ flag: c.id, takesValue: c.takesValue }))],
      onApply(parsed) {
        const command = COMMANDS.find(c => parsed.has(c.id));
        session.activeCommand = command ? { id: command.id, value: parsed.get(command.id) } : null;
        if (command) parsed.delete(command.id);
        active.clear();
        parsed.forEach((v, k) => active.set(k, v));
        container.querySelectorAll('.flag-btn[data-flag]').forEach(btn => {
          const on = active.has(btn.dataset.flag);
          btn.setAttribute('aria-pressed', String(on));
          btn.classList.toggle('active', on);
        });
        container.querySelectorAll('.flag-btn[data-command]').forEach(btn => {
          const on = !!command && btn.dataset.command === command.id;
          btn.setAttribute('aria-pressed', String(on));
          btn.classList.toggle('active', on);
        });
        renderCommand();
      },
    });
    bindFlagSearch(container);
    // Persisted across mounts (see workerSession.js) -- switching away from
    // this worker's view and back (or to a different worker and back)
    // shouldn't reset flags/command already built up here.
    const session = getSession('puredns');
    // flag -> value ('' for boolean flags that are simply on/off)
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['puredns'];
      // At most one command (resolve/bruteforce) is active at a time — it's
      // the first token after "puredns", not just another flag.
      if (session.activeCommand) {
        tokens.push(session.activeCommand.id);
        if (session.activeCommand.value) tokens.push(session.activeCommand.value);
      }
      container.querySelectorAll('.flag-btn[data-flag]').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      // live-terminal.js's Send button has no other way to see what this
      // panel has built -- it doesn't import this module (each worker's
      // control panel is loaded independently, see index.js's
      // loadControlPanel) -- so the current selection travels over the
      // shared ctx bus instead, same wiring as subfinder-panel.js. Sent as
      // {command, flags} rather than a flat map since puredns dispatches on
      // a subcommand (resolve/bruteforce), not just a set of flags -- the
      // backend's PurednsFlags.toArgs expects this exact shape.
      ctx.emit('puredns:flags', { command: session.activeCommand, flags: Object.fromEntries(active) });
    }

    // At most one value popup open at a time — opening another, or any
    // outside interaction, cancels whichever one is still open.
    let closeOpenPopup = null;

    function openValuePopup(btn, { placeholder, onSet } = {}) {
      if (closeOpenPopup) closeOpenPopup();
      const label = btn.dataset.flag || btn.dataset.command;
      const wrap = btn.closest('.flag-btn-wrap');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'flag-value-popup';
      input.setAttribute('aria-label', `Value for ${label}`);
      input.placeholder = placeholder || 'value...';
      const popup = document.createElement('div');
      popup.className = 'flag-value-popup-wrap';
      popup.appendChild(input);
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
          onSet(value);
          renderCommand();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
        }
      });

      closeOpenPopup = cleanup;
    }

    // File-taking flags/commands (-r, resolve, bruteforce) pick from
    // whatever the selected profile actually has saved in its Project
    // Folder, instead of a blind typed value — same storage
    // wordlist-template.js/send-output.js write into (see
    // js/projectFolder.js).
    function openFilePopup(btn, { onSet } = {}) {
      if (closeOpenPopup) closeOpenPopup();
      const label = btn.dataset.flag || btn.dataset.command;
      const wrap = btn.closest('.flag-btn-wrap');
      const panel = document.createElement('div');
      panel.className = 'flag-file-popup';
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', `Project Folder files for ${label}`);
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
        onSet(name);
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

    container.querySelectorAll('.flag-btn[data-command]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.command;
        const command = COMMANDS.find(c => c.id === id);
        if (session.activeCommand && session.activeCommand.id === id) {
          session.activeCommand = null;
          btn.setAttribute('aria-pressed', 'false');
          btn.classList.remove('active');
          renderCommand();
          return;
        }
        // Only one command active at a time — deselect whichever was picked before.
        container.querySelectorAll('.flag-btn[data-command]').forEach(b => {
          b.setAttribute('aria-pressed', 'false');
          b.classList.remove('active');
        });
        const setActive = value => {
          session.activeCommand = { id, value };
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.add('active');
        };
        if (command.takesValue) {
          if (command.isFile) openFilePopup(btn, { onSet: setActive });
          else openValuePopup(btn, { placeholder: command.placeholder, onSet: setActive });
          return;
        }
        setActive('');
        renderCommand();
      });
    });

    container.querySelectorAll('.flag-btn[data-flag]').forEach(btn => {
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
          const onSet = value => {
            active.set(flag, value);
            btn.setAttribute('aria-pressed', 'true');
            btn.classList.add('active');
          };
          if (btn.dataset.isFile === 'true') openFilePopup(btn, { onSet });
          else openValuePopup(btn, { onSet });
          return;
        }
        active.set(flag, '');
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('active');
        renderCommand();
      });
    });

    // Repaint flags and the command picker already active from a previous
    // mount (see workerSession.js above) instead of starting the bar empty.
    if (active.size || session.activeCommand) {
      container.querySelectorAll('.flag-btn[data-flag]').forEach(btn => {
        if (active.has(btn.dataset.flag)) {
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.add('active');
        }
      });
      if (session.activeCommand) {
        container.querySelectorAll('.flag-btn[data-command]').forEach(btn => {
          if (btn.dataset.command === session.activeCommand.id) {
            btn.setAttribute('aria-pressed', 'true');
            btn.classList.add('active');
          }
        });
      }
      renderCommand();
    }

    // [CLEAR] unpins every flag and rebuilds the bar empty.
    function clearAllFlags() {
      active.clear();
      session.activeCommand = null;
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
