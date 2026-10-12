// nosqlmap control panel. Same approach as gau-panel.js: every button below
// corresponds to a real flag from the installed NoSQLMap build's own
// "nosqlmap --help" (confirmed live against /opt/NoSQLMap/nosqlmap.py),
// grouped here by purpose (ATTACK, TARGET, HTTP, NSMWEB) since --help lists
// them flat with no section headers. Toggling a flag builds up the command
// preview live, and drives a real backend run (see the
// ctx.emit('nosqlmap:flags', ...) call in renderCommand() below, same
// wiring as subfinder-panel.js).
//
// --attack is required (see NosqlmapFlags' class doc): without it,
// nosqlmap.py drops into its own fully interactive menu instead of running
// from these flags at all. Even with --attack set, nosqlmap.py still falls
// back to an input() prompt for any specific value its non-interactive path
// still needs but wasn't supplied here -- that's answered the same way any
// other tool's prompt is, by typing into live-terminal.js's input box,
// which reaches the run through this worker's existing /input route.
//
// No flag here is isFile: --savePath is a filename nosqlmap.py writes
// itself, not an existing file to read, so there is no Project Folder
// picker in this panel, unlike most others.
import { getSession } from '../../workerSession.js';
import { suppressTransition } from '../../domTransition.js';
import { commandPreviewHtml, bindCommandPreview } from '../../commandPreview.js';
import { flagSearchHtml, bindFlagSearch } from '../../flagSearch.js';

const FLAG_SECTIONS = [
  {
    group: 'basic', title: 'ATTACK', flags: [
      { flag: '--attack', takesValue: true, desc: '1 = NoSQL DB Access Attacks, 2 = NoSQL Web App attacks, 3 = Scan for Anonymous platform Access' },
      { flag: '--platform', takesValue: true, desc: 'Platform to attack (MongoDB, CouchDB)' },
    ],
  },
  {
    group: 'basic', title: 'TARGET', flags: [
      { flag: '--victim', takesValue: true, desc: 'Set target host/IP (ex: localhost or 127.0.0.1)' },
      { flag: '--dbPort', takesValue: true, desc: 'Set shell listener port' },
      { flag: '--myIP', takesValue: true, desc: 'Set my local platform/Shell IP' },
      { flag: '--myPort', takesValue: true, desc: 'Set my local platform/Shell port' },
    ],
  },
  {
    group: 'advanced', title: 'HTTP', flags: [
      { flag: '--uri', takesValue: true, desc: "Set App Path. For example '/a-path/'" },
      { flag: '--httpMethod', takesValue: true, desc: 'GET or POST' },
      { flag: '--https', takesValue: true, desc: 'Toggle HTTPS (ON, OFF)' },
      { flag: '--verb', takesValue: true, desc: 'Toggle Verbose Mode (ON, OFF)' },
      { flag: '--postData', takesValue: true, desc: 'POST data in a comma separated list (i.e. param name 1,value1,param name 2,value2)' },
      { flag: '--requestHeaders', takesValue: true, desc: 'Request headers in a comma separated list (i.e. param name 1,value1,param name 2,value2)' },
    ],
  },
  {
    group: 'advanced', title: 'NSMWEB', flags: [
      { flag: '--injectedParameter', takesValue: true, desc: 'Parameter to be injected' },
      { flag: '--injectSize', takesValue: true, desc: 'Size of payload' },
      { flag: '--injectFormat', takesValue: true, desc: '1-Alphanumeric, 2-Letters only, 3-Numbers only, 4-Email address' },
      { flag: '--params', takesValue: true, desc: 'Parameters to inject, in a comma separated list' },
      { flag: '--doTimeAttack', takesValue: true, desc: 'Start timing based tests (y/n)' },
      { flag: '--savePath', takesValue: true, desc: 'Output file name' },
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
            <button type="button" class="flag-btn" data-flag="${f.flag}" data-takes-value="${f.takesValue}"
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
  id: 'nosqlmap-panel',
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
      ${commandPreviewHtml('nosqlmap')}`;

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
    const session = getSession('nosqlmap');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['nosqlmap'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      // live-terminal.js's Send button has no other way to see what this
      // panel has built -- see subfinder-panel.js's matching comment.
      ctx.emit('nosqlmap:flags', Object.fromEntries(active));
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
      // Appended to <body> at a viewport-fixed position (computed from the
      // button's own rect) rather than left inside .flag-btn-wrap — a
      // wrap nested under overflow:hidden/auto ancestors (the scrollable
      // .control-body, the collapsing .flag-group-body) would otherwise
      // clip or bury the popup instead of floating it above everything.
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
          const value = input.value.trim();
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
          openValuePopup(btn);
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
