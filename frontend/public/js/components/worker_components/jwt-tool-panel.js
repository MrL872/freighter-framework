// jwt-tool control panel. Same approach as gau-panel.js: toggling a flag
// builds up the command preview live and drives a real backend run via
// ctx.emit('jwt-tool:flags', ...), consumed by live-terminal.js.
//
// Flags below follow jwt_tool's own `--help` output (the authoritative
// source -- no .github/worker_instructions/jwt-tool.md exists for this
// tool). -T (Tamper, interactive mode) is deliberately left out -- this
// worker has no stdin to drive a REPL, same reasoning as every other
// tool's panel excluding interactive modes. -h/--help is likewise skipped
// as not useful in this UI.
//
// The backend package is named `jwttool` (no hyphen -- Java identifiers
// can't contain one -- see JwttoolController's own route strings for where
// "jwt-tool" is kept).
//
// jwt_tool takes the JWT itself as a bare positional argument (`jwt_tool.py
// <token> [options]`) -- that's the one entry below marked `bare: true`,
// same convention as gau-panel.js's "target".
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
      { flag: 'target', bare: true, takesValue: true, desc: 'The JWT to analyze/tamper with' },
      { flag: '-t', takesValue: true, desc: 'Send the token directly to this target URL' },
      { flag: '-r', takesValue: true, isFile: true, desc: 'File containing a raw HTTP request to base the attack on, instead of -t' },
      { flag: '-rh', takesValue: true, desc: 'Request header needed by the application (must contain the token, or use -rc)' },
      { flag: '-rc', takesValue: true, desc: 'Request cookies needed by the application (must contain the token, or use -rh)' },
      { flag: '-pd', takesValue: true, desc: 'POST data to send with the forged request' },
      { flag: '-cv', takesValue: true, desc: 'Canary value expected on a successful use of the token (e.g. "Welcome")' },
      { flag: '-rt', takesValue: true, desc: 'Max. number of requests per minute' },
      { flag: '-i', takesValue: false, desc: 'Use HTTP (instead of HTTPS) for the passed request' },
      { flag: '-np', takesValue: false, desc: 'Disable proxy for this request' },
      { flag: '-nr', takesValue: false, desc: 'Disable following redirects for this request' },
      { flag: '-b', takesValue: false, desc: 'Return tokens only (bare output)' },
      { flag: '-v', takesValue: false, desc: 'Verbose output' },
    ],
  },
  {
    group: 'basic', title: 'MODE', flags: [
      { flag: '-M', takesValue: true, desc: 'Scanning mode: pb (playbook audit), er (fuzz claims to force errors), cc (fuzz common claims), at (all tests)' },
      { flag: '-V', takesValue: false, desc: 'Verify signatures' },
      { flag: '-I', takesValue: false, desc: 'Inject/Fuzz claims' },
      { flag: '-C', takesValue: false, desc: 'Check/Crack the signing secret' },
      { flag: '-Q', takesValue: true, desc: 'Query the logfile for a request/token by its unique ID' },
    ],
  },
  {
    group: 'advanced', title: 'EXPLOITS', flags: [
      { flag: '-X', takesValue: true, desc: 'Exploit: a (alg:none), n (null signature), b (blank password accepted), p (psychic ECDSA signature), s (spoof JWKS, use with -ju), k (key confusion, use with -pk), i (inject inline JWKS)' },
      { flag: '-ju', takesValue: true, desc: 'JWKS URL to serve for a spoofed-JWKS attack (-X s)' },
      { flag: '-pk', takesValue: true, isFile: true, desc: 'Public key file (verify with -V, or key-confusion attack with -X k)' },
      { flag: '-pr', takesValue: true, isFile: true, desc: 'Private/RSA/EC key file to sign a token with (-S)' },
      { flag: '-jw', takesValue: true, isFile: true, desc: 'Public JWKS JSON file to verify against (-V)' },
    ],
  },
  {
    group: 'advanced', title: 'SIGNING', flags: [
      { flag: '-S', takesValue: true, desc: 'Signing algorithm: hs256/hs384/hs512, rs256/rs384/rs512, es256/es384/es512, ps256/ps384/ps512' },
      { flag: '-p', takesValue: true, desc: 'Password/secret to try (HMAC signing or -C cracking)' },
    ],
  },
  {
    group: 'advanced', title: 'CRACKING', flags: [
      { flag: '-d', takesValue: true, isFile: true, desc: 'Dictionary file of secrets to try (used with -C)' },
      { flag: '-kf', takesValue: true, isFile: true, desc: 'Keyfile for cracking (used with \'kid\' attacks)' },
    ],
  },
  {
    group: 'advanced', title: 'CLAIM INJECTION', flags: [
      { flag: '-hc', takesValue: true, desc: 'Header claim name to inject/edit (used with -I) [stackable]' },
      { flag: '-hv', takesValue: true, desc: 'Header claim value, or a fuzz-list file (used with -I, max one fuzz file)' },
      { flag: '-pc', takesValue: true, desc: 'Payload claim name to inject/edit (used with -I) [stackable]' },
      { flag: '-pv', takesValue: true, desc: 'Payload claim value, or a fuzz-list file (used with -I, max one fuzz file)' },
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
  id: 'jwt-tool-panel',
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
      ${commandPreviewHtml('jwt_tool.py')}`;

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
    const session = getSession('jwt-tool');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['jwt_tool.py'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        if (btn.dataset.bare === 'true') { tokens.push(value); return; }
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      ctx.emit('jwt-tool:flags', Object.fromEntries(active));
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
