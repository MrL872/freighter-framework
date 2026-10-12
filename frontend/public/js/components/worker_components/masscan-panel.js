// masscan control panel. Same approach as nmap-panel.js: every button below
// corresponds to a real "masscan --nmap" flag (the nmap-equivalent
// reference masscan ships for users coming from nmap), grouped the same way
// that reference groups them (TARGET SPECIFICATION, HOST DISCOVERY, SCAN
// TECHNIQUES, ...), plus "-c" (confirmed in "masscan --help") for an
// external config file. Toggling a flag builds up the command preview
// live and drives a real backend run (see the ctx.emit('masscan:flags', ...)
// call in renderCommand() below, same wiring as subfinder-panel.js).
//
// Unlike nmap, masscan takes its target as a bare positional argument too
// (`masscan 10.0.0.0/8 -p80`) -- the one entry below marked `bare: true`,
// same convention as gau-panel.js's own "target" entry. -iL is the
// alternative (a host list file); MasscanFlags.toArgs() on the backend
// accepts either.
//
// A flag marked isFile expects an existing file (a host list, an exclude
// list, a resume state file, a config file, ...) rather than an arbitrary
// typed value — for those, clicking the flag opens an expandable list of
// whatever's actually saved in the selected profile's Project Folder (see
// projectFolder.js) instead of a plain text popup. A single target, port
// list, or number (-p, --max-rate, ...) has no such picker — it's still the
// plain text popup.
//
// masscan-worker/main.go has no /output route (unlike nmap-worker), so the
// output-writing flags below (-oL, -oJ, -oD, -oG, -oB, -oX, -oU,
// --output-file) are plain value flags, not isOutput -- there is nothing on
// the worker side to fetch the written file back from.
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
    group: 'basic', title: 'TARGET SPECIFICATION', flags: [
      { flag: 'target', bare: true, takesValue: true, desc: 'IPv4/IPv6 addresses, CIDR networks, or ranges (ex: 10.0.0.0/8, 192.168.0.1, 10.0.0.1-10.0.0.254)' },
      { flag: '-iL', takesValue: true, isFile: true, desc: 'Input from list of hosts/networks' },
      { flag: '--exclude', takesValue: true, desc: 'Exclude hosts/networks (host1[,host2][,host3],...)' },
      { flag: '--excludefile', takesValue: true, isFile: true, desc: 'Exclude list from file' },
      { flag: '--randomize-hosts', takesValue: false, desc: 'Randomize order of hosts (default)' },
    ],
  },
  {
    group: 'basic', title: 'HOST DISCOVERY', flags: [
      { flag: '-Pn', takesValue: false, desc: 'Treat all hosts as online (default)' },
      { flag: '-n', takesValue: false, desc: 'Never do DNS resolution (default)' },
    ],
  },
  {
    group: 'basic', title: 'SCAN TECHNIQUES', flags: [
      { flag: '-sS', takesValue: false, desc: 'TCP SYN (always on, default)' },
    ],
  },
  {
    group: 'basic', title: 'SERVICE/VERSION DETECTION', flags: [
      { flag: '--banners', takesValue: false, desc: 'Get the banners of the listening service if available (default 30s timeout waiting for data)' },
    ],
  },
  {
    group: 'basic', title: 'PORT SPECIFICATION AND SCAN ORDER', flags: [
      { flag: '-p', takesValue: true, desc: 'Only scan specified ports (e.g. -p22; -p1-65535; -p 111,137,80,139,8080)' },
    ],
  },
  {
    group: 'advanced', title: 'TIMING AND PERFORMANCE', flags: [
      { flag: '--max-rate', takesValue: true, desc: 'Send packets no faster than <number> per second' },
      { flag: '--connection-timeout', takesValue: true, desc: 'Time in seconds a TCP connection will wait for banner data from a port' },
    ],
  },
  {
    group: 'advanced', title: 'FIREWALL/IDS EVASION AND SPOOFING', flags: [
      { flag: '-S', alias: '--source-ip', takesValue: true, desc: 'Spoof source address' },
      { flag: '-e', takesValue: true, desc: 'Use specified interface' },
      { flag: '-g', alias: '--source-port', takesValue: true, desc: 'Use given port number' },
      { flag: '--ttl', takesValue: true, desc: 'Set IP time-to-live field' },
      { flag: '--spoof-mac', takesValue: true, desc: 'Spoof your MAC address (mac address/prefix/vendor name)' },
    ],
  },
  {
    group: 'advanced', title: 'OUTPUT', flags: [
      { flag: '--output-format', takesValue: true, desc: 'Sets output to binary/list/unicornscan/json/ndjson/grepable/xml' },
      { flag: '--output-file', takesValue: true, desc: 'Write scan results to file (default format is xml unless --output-format is given)' },
      { flag: '-oL', takesValue: true, desc: 'Output scan in List format to the given filename' },
      { flag: '-oJ', takesValue: true, desc: 'Output scan in JSON format to the given filename' },
      { flag: '-oD', takesValue: true, desc: 'Output scan in nDjson format to the given filename' },
      { flag: '-oG', takesValue: true, desc: 'Output scan in Grepable format to the given filename' },
      { flag: '-oB', takesValue: true, desc: 'Output scan in Binary format to the given filename' },
      { flag: '-oX', takesValue: true, desc: 'Output scan in XML format to the given filename' },
      { flag: '-oU', takesValue: true, desc: 'Output scan in Unicornscan format to the given filename' },
      { flag: '-v', takesValue: false, desc: 'Increase verbosity level (use -vv or more for greater effect)' },
      { flag: '-d', takesValue: false, desc: 'Increase debugging level (use -dd or more for greater effect)' },
      { flag: '--open', takesValue: false, desc: 'Only show open (or possibly open) ports' },
      { flag: '--packet-trace', takesValue: false, desc: 'Show all packets sent and received' },
      { flag: '--iflist', takesValue: false, desc: 'Print host interfaces and routes (for debugging)' },
      { flag: '--append-output', takesValue: false, desc: 'Append to rather than clobber specified output files' },
      { flag: '--resume', takesValue: true, isFile: true, desc: 'Resume an aborted scan <filename>' },
    ],
  },
  {
    group: 'advanced', title: 'MISC', flags: [
      { flag: '--send-eth', takesValue: false, desc: 'Send using raw ethernet frames (default)' },
      { flag: '-c', takesValue: true, isFile: true, desc: 'Load a config file (parameters can also be set via the command line)' },
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
            <button type="button" class="flag-btn" data-flag="${f.flag}" data-takes-value="${f.takesValue}" data-is-file="${!!f.isFile}" data-bare="${!!f.bare}"
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
  id: 'masscan-panel',
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
      ${commandPreviewHtml('masscan')}`;

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
    const session = getSession('masscan');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['masscan'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        if (btn.dataset.bare === 'true') { tokens.push(value); return; }
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      // live-terminal.js's Send button has no other way to see what this
      // panel has built -- see subfinder-panel.js's matching comment. The
      // bare "target" key travels through unchanged -- MasscanFlags.toArgs
      // on the backend emits it first with no leading flag token.
      ctx.emit('masscan:flags', Object.fromEntries(active));
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

    // File-taking flags (-iL, --excludefile, --resume, -c) pick from
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
