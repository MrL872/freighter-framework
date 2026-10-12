// hydra control panel. Same approach as gau-panel.js: toggling a flag
// builds up the command preview live and drives a real backend run via
// ctx.emit('hydra:flags', ...), consumed by live-terminal.js.
//
// Flags below are remapped 1:1 from .github/worker_instructions/hydra.md
// (the real `hydra` usage/options dump). Left out entirely: -h (more
// command line options -- prints help and exits) and -U (module usage
// details -- also prints and exits, same reasoning as -h).
//
// hydra takes its target as a bare positional argument in service://host
// form (e.g. `hydra -l admin -P pass.txt ssh://10.0.0.5`) -- that's the one
// entry below marked `bare: true`, same convention as gau-panel.js's
// "target".
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
      { flag: 'target', bare: true, takesValue: true, desc: 'Target in service://host form (e.g. ssh://10.0.0.5)' },
      { flag: '-s', takesValue: true, desc: 'Non-default port to connect to' },
      { flag: '-S', takesValue: false, desc: 'Perform an SSL connect' },
      { flag: '-m', takesValue: true, desc: 'Options specific for a module (see -U output)' },
    ],
  },
  {
    group: 'basic', title: 'CREDENTIALS', flags: [
      { flag: '-l', takesValue: true, desc: 'Login with LOGIN name' },
      { flag: '-L', takesValue: true, isFile: true, desc: 'Load several logins from FILE' },
      { flag: '-p', takesValue: true, desc: 'Try password PASS' },
      { flag: '-P', takesValue: true, isFile: true, desc: 'Load several passwords from FILE' },
      { flag: '-C', takesValue: true, isFile: true, desc: "Colon separated \"login:pass\" format file, instead of -L/-P" },
      { flag: '-x', takesValue: true, desc: 'Password bruteforce generation: MIN:MAX:CHARSET' },
      { flag: '-y', takesValue: false, desc: 'Disable use of symbols in bruteforce (-x)' },
      { flag: '-r', takesValue: false, desc: 'Use a non-random shuffling method for option -x' },
      { flag: '-e', takesValue: true, desc: 'Try "n" null password, "s" login as pass and/or "r" reversed login' },
      { flag: '-u', takesValue: false, desc: 'Loop around users, not passwords (implied with -x)' },
    ],
  },
  {
    group: 'advanced', title: 'SCOPE', flags: [
      { flag: '-M', takesValue: true, isFile: true, desc: "List of servers to attack, one entry per line, ':' to specify port" },
    ],
  },
  {
    group: 'advanced', title: 'OUTPUT', flags: [
      { flag: '-o', takesValue: true, isOutput: true, desc: 'Write found login/password pairs to FILE instead of stdout' },
      { flag: '-b', takesValue: true, desc: 'Format for the -o FILE: text (default), json, jsonv1' },
    ],
  },
  {
    group: 'advanced', title: 'BEHAVIOR', flags: [
      { flag: '-f', takesValue: false, desc: 'Exit when a login/pass pair is found (per host)' },
      { flag: '-F', takesValue: false, desc: 'Exit when a login/pass pair is found (global)' },
      { flag: '-t', takesValue: true, desc: 'TASKS number of connects in parallel per target (default: 16)' },
      { flag: '-T', takesValue: true, desc: 'TASKS connects in parallel overall, for -M (default: 64)' },
      { flag: '-w', takesValue: true, desc: 'Wait time for a response (default: 32)' },
      { flag: '-W', takesValue: true, desc: 'Wait time between connects per thread (default: 0)' },
      { flag: '-c', takesValue: true, desc: 'Wait time per login attempt over all threads (enforces -t 1)' },
      { flag: '-K', takesValue: false, desc: 'Do not redo failed attempts (good for -M mass scanning)' },
      { flag: '-q', takesValue: false, desc: 'Do not print messages about connection errors' },
    ],
  },
  {
    group: 'advanced', title: 'NETWORK', flags: [
      { flag: '-4', takesValue: false, desc: 'Use IPv4 addresses (default)' },
      { flag: '-6', takesValue: false, desc: 'Use IPv6 addresses' },
      { flag: '-O', takesValue: false, desc: 'Use old SSL v2 and v3' },
    ],
  },
  {
    group: 'advanced', title: 'LOGGING', flags: [
      { flag: '-v', takesValue: false, desc: 'Verbose mode' },
      { flag: '-V', takesValue: false, desc: 'Show login+pass combination for each attempt' },
      { flag: '-d', takesValue: false, desc: 'Debug mode' },
    ],
  },
  {
    group: 'advanced', title: 'SESSION', flags: [
      { flag: '-R', takesValue: false, desc: 'Restore a previous aborted/crashed session' },
      { flag: '-I', takesValue: false, desc: "Ignore an existing restore file (don't wait 10 seconds)" },
    ],
  },
];

function flagLabel(f) { return f.bare ? f.flag : (f.alias ? `${f.flag}, ${f.alias}` : f.flag); }
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
  id: 'hydra-panel',
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
      ${commandPreviewHtml('hydra')}`;

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
    const session = getSession('hydra');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['hydra'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        if (btn.dataset.bare === 'true') { tokens.push(value); return; }
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      ctx.emit('hydra:flags', Object.fromEntries(active));
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
