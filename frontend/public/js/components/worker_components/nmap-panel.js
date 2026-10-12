// nmap control panel. Same approach as subfinder-panel.js: every button
// below corresponds to a flag documented in
// .github/worker_instructions/nmap.md, grouped the same way that doc groups
// them (TARGET SPECIFICATION, HOST DISCOVERY, SCAN TECHNIQUES, ...).
// Toggling a flag builds up the command preview live. There is no
// backend to actually run this against — clicking "Send" on the worker's
// send-output panel is what stays unwired, not this.
//
// A flag marked isFile expects an existing file (a host list, an exclude
// list, a script-args file, ...) rather than an arbitrary typed value — for
// those, clicking the flag opens an expandable list of whatever's actually
// saved in the selected profile's Project Folder (see projectFolder.js)
// instead of a plain text popup. A single target, port list, or number
// (-p, -T<0-5>, --host-timeout, ...) has no such picker — it's still the
// plain text popup.
//
// A flag marked isOutput instead writes a result to disk (-oN, -oX, -oS,
// -oG, -oA) — its value popup adds a one-click suggestion to save into
// Project Folder instead of leaving the user to type an arbitrary path.
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
    group: 'basic', title: 'TARGET SPECIFICATION', flags: [
      { flag: '-iL', takesValue: true, isFile: true, desc: 'Input from list of hosts/networks' },
      { flag: '-iR', takesValue: true, desc: 'Choose random targets (<num hosts>)' },
      { flag: '--exclude', takesValue: true, desc: 'Exclude hosts/networks (host1[,host2][,host3],...)' },
      { flag: '--excludefile', takesValue: true, isFile: true, desc: 'Exclude list from file' },
    ],
  },
  {
    group: 'basic', title: 'HOST DISCOVERY', flags: [
      { flag: '-sL', takesValue: false, desc: 'List Scan - simply list targets to scan' },
      { flag: '-sn', takesValue: false, desc: 'Ping Scan - disable port scan' },
      { flag: '-Pn', takesValue: false, desc: 'Treat all hosts as online -- skip host discovery' },
      { flag: '-PS', takesValue: true, desc: 'TCP SYN discovery to given ports [portlist]' },
      { flag: '-PA', takesValue: true, desc: 'TCP ACK discovery to given ports [portlist]' },
      { flag: '-PU', takesValue: true, desc: 'UDP discovery to given ports [portlist]' },
      { flag: '-PY', takesValue: true, desc: 'SCTP discovery to given ports [portlist]' },
      { flag: '-PE', takesValue: false, desc: 'ICMP echo discovery probe' },
      { flag: '-PP', takesValue: false, desc: 'ICMP timestamp discovery probe' },
      { flag: '-PM', takesValue: false, desc: 'ICMP netmask request discovery probe' },
      { flag: '-PO', takesValue: true, desc: 'IP Protocol Ping [protocol list]' },
      { flag: '-n', takesValue: false, desc: 'Never do DNS resolution [default: sometimes]' },
      { flag: '-R', takesValue: false, desc: 'Always resolve DNS [default: sometimes]' },
      { flag: '--dns-servers', takesValue: true, desc: 'Specify custom DNS servers (serv1[,serv2],...)' },
      { flag: '--system-dns', takesValue: false, desc: "Use OS's DNS resolver" },
      { flag: '--traceroute', takesValue: false, desc: 'Trace hop path to each host' },
    ],
  },
  {
    group: 'basic', title: 'SCAN TECHNIQUES', flags: [
      { flag: '-sS', takesValue: false, desc: 'TCP SYN scan' },
      { flag: '-sT', takesValue: false, desc: 'TCP Connect() scan' },
      { flag: '-sA', takesValue: false, desc: 'TCP ACK scan' },
      { flag: '-sW', takesValue: false, desc: 'TCP Window scan' },
      { flag: '-sM', takesValue: false, desc: 'TCP Maimon scan' },
      { flag: '-sU', takesValue: false, desc: 'UDP Scan' },
      { flag: '-sN', takesValue: false, desc: 'TCP Null scan' },
      { flag: '-sF', takesValue: false, desc: 'TCP FIN scan' },
      { flag: '-sX', takesValue: false, desc: 'TCP Xmas scan' },
      { flag: '--scanflags', takesValue: true, desc: 'Customize TCP scan flags' },
      { flag: '-sI', takesValue: true, desc: 'Idle scan <zombie host[:probeport]>' },
      { flag: '-sY', takesValue: false, desc: 'SCTP INIT scan' },
      { flag: '-sZ', takesValue: false, desc: 'SCTP COOKIE-ECHO scan' },
      { flag: '-sO', takesValue: false, desc: 'IP protocol scan' },
      { flag: '-b', takesValue: true, desc: 'FTP bounce scan <FTP relay host>' },
    ],
  },
  {
    group: 'basic', title: 'PORT SPECIFICATION AND SCAN ORDER', flags: [
      { flag: '-p', takesValue: true, desc: 'Only scan specified ports (e.g. -p22; -p1-65535; -p U:53,111,137,T:21-25,80,139,8080,S:9)' },
      { flag: '--exclude-ports', takesValue: true, desc: 'Exclude the specified ports from scanning' },
      { flag: '-F', takesValue: false, desc: 'Fast mode - Scan fewer ports than the default scan' },
      { flag: '-r', takesValue: false, desc: "Scan ports sequentially - don't randomize" },
      { flag: '--top-ports', takesValue: true, desc: 'Scan <number> most common ports' },
      { flag: '--port-ratio', takesValue: true, desc: 'Scan ports more common than <ratio>' },
    ],
  },
  {
    group: 'advanced', title: 'SERVICE/VERSION DETECTION', flags: [
      { flag: '-sV', takesValue: false, desc: 'Probe open ports to determine service/version info' },
      { flag: '--version-intensity', takesValue: true, desc: 'Set from 0 (light) to 9 (try all probes)' },
      { flag: '--version-light', takesValue: false, desc: 'Limit to most likely probes (intensity 2)' },
      { flag: '--version-all', takesValue: false, desc: 'Try every single probe (intensity 9)' },
      { flag: '--version-trace', takesValue: false, desc: 'Show detailed version scan activity (for debugging)' },
    ],
  },
  {
    group: 'advanced', title: 'SCRIPT SCAN', flags: [
      { flag: '-sC', takesValue: false, desc: 'equivalent to --script=default' },
      { flag: '--script', takesValue: true, desc: '<Lua scripts> comma separated list of directories, script-files or script-categories' },
      { flag: '--script-args', takesValue: true, desc: 'provide arguments to scripts (n1=v1,[n2=v2,...])' },
      { flag: '--script-args-file', takesValue: true, isFile: true, desc: 'provide NSE script args in a file' },
      { flag: '--script-trace', takesValue: false, desc: 'Show all data sent and received' },
      { flag: '--script-updatedb', takesValue: false, desc: 'Update the script database.' },
      { flag: '--script-help', takesValue: true, desc: 'Show help about scripts (comma-separated list of script-files or script-categories)' },
    ],
  },
  {
    group: 'advanced', title: 'OS DETECTION', flags: [
      { flag: '-O', takesValue: false, desc: 'Enable OS detection' },
      { flag: '--osscan-limit', takesValue: false, desc: 'Limit OS detection to promising targets' },
      { flag: '--osscan-guess', takesValue: false, desc: 'Guess OS more aggressively' },
    ],
  },
  {
    group: 'advanced', title: 'TIMING AND PERFORMANCE', flags: [
      { flag: '-T', takesValue: true, desc: 'Set timing template <0-5> (higher is faster)' },
      { flag: '--min-hostgroup', takesValue: true, desc: 'Parallel host scan group size (minimum)' },
      { flag: '--max-hostgroup', takesValue: true, desc: 'Parallel host scan group size (maximum)' },
      { flag: '--min-parallelism', takesValue: true, desc: 'Probe parallelization (minimum)' },
      { flag: '--max-parallelism', takesValue: true, desc: 'Probe parallelization (maximum)' },
      { flag: '--min-rtt-timeout', takesValue: true, desc: 'Specifies minimum probe round trip time' },
      { flag: '--max-rtt-timeout', takesValue: true, desc: 'Specifies maximum probe round trip time' },
      { flag: '--initial-rtt-timeout', takesValue: true, desc: 'Specifies initial probe round trip time' },
      { flag: '--max-retries', takesValue: true, desc: 'Caps number of port scan probe retransmissions.' },
      { flag: '--host-timeout', takesValue: true, desc: 'Give up on target after this long' },
      { flag: '--scan-delay', takesValue: true, desc: 'Adjust delay between probes' },
      { flag: '--max-scan-delay', takesValue: true, desc: 'Adjust max delay between probes' },
      { flag: '--min-rate', takesValue: true, desc: 'Send packets no slower than <number> per second' },
      { flag: '--max-rate', takesValue: true, desc: 'Send packets no faster than <number> per second' },
    ],
  },
  {
    group: 'advanced', title: 'FIREWALL/IDS EVASION AND SPOOFING', flags: [
      { flag: '-f', takesValue: false, desc: 'fragment packets' },
      { flag: '--mtu', takesValue: true, desc: 'fragment packets (optionally w/given MTU)' },
      { flag: '-D', takesValue: true, desc: 'Cloak a scan with decoys (decoy1,decoy2[,ME],...)' },
      { flag: '-S', takesValue: true, desc: 'Spoof source address <IP_Address>' },
      { flag: '-e', takesValue: true, desc: 'Use specified interface' },
      { flag: '-g', alias: '--source-port', takesValue: true, desc: 'Use given port number' },
      { flag: '--proxies', takesValue: true, desc: 'Relay connections through HTTP/SOCKS4 proxies (url1,[url2],...)' },
      { flag: '--data', takesValue: true, desc: 'Append a custom payload to sent packets (hex string)' },
      { flag: '--data-string', takesValue: true, desc: 'Append a custom ASCII string to sent packets' },
      { flag: '--data-length', takesValue: true, desc: 'Append random data to sent packets (num)' },
      { flag: '--ip-options', takesValue: true, desc: 'Send packets with specified ip options' },
      { flag: '--ttl', takesValue: true, desc: 'Set IP time-to-live field' },
      { flag: '--spoof-mac', takesValue: true, desc: 'Spoof your MAC address (mac address/prefix/vendor name)' },
      { flag: '--badsum', takesValue: false, desc: 'Send packets with a bogus TCP/UDP/SCTP checksum' },
    ],
  },
  {
    group: 'advanced', title: 'OUTPUT', flags: [
      { flag: '-oN', takesValue: true, isOutput: true, desc: 'Output scan in normal format to the given filename' },
      { flag: '-oX', takesValue: true, isOutput: true, desc: 'Output scan in XML format to the given filename' },
      { flag: '-oS', takesValue: true, isOutput: true, desc: 'Output scan in s|<rIpt kIddi3 format to the given filename' },
      { flag: '-oG', takesValue: true, isOutput: true, desc: 'Output scan in Grepable format to the given filename' },
      { flag: '-oA', takesValue: true, isOutput: true, desc: 'Output in the three major formats at once <basename>' },
      { flag: '-v', takesValue: false, desc: 'Increase verbosity level (use -vv or more for greater effect)' },
      { flag: '-d', takesValue: false, desc: 'Increase debugging level (use -dd or more for greater effect)' },
      { flag: '--reason', takesValue: false, desc: 'Display the reason a port is in a particular state' },
      { flag: '--open', takesValue: false, desc: 'Only show open (or possibly open) ports' },
      { flag: '--packet-trace', takesValue: false, desc: 'Show all packets sent and received' },
      { flag: '--iflist', takesValue: false, desc: 'Print host interfaces and routes (for debugging)' },
      { flag: '--append-output', takesValue: false, desc: 'Append to rather than clobber specified output files' },
      { flag: '--resume', takesValue: true, isFile: true, desc: 'Resume an aborted scan <filename>' },
      { flag: '--noninteractive', takesValue: false, desc: 'Disable runtime interactions via keyboard' },
      { flag: '--stylesheet', takesValue: true, desc: 'XSL stylesheet to transform XML output to HTML <path/URL>' },
      { flag: '--webxml', takesValue: false, desc: 'Reference stylesheet from Nmap.Org for more portable XML' },
      { flag: '--no-stylesheet', takesValue: false, desc: 'Prevent associating of XSL stylesheet w/XML output' },
    ],
  },
  {
    group: 'advanced', title: 'MISC', flags: [
      { flag: '-6', takesValue: false, desc: 'Enable IPv6 scanning' },
      { flag: '-A', takesValue: false, desc: 'Enable OS detection, version detection, script scanning, and traceroute' },
      { flag: '--datadir', takesValue: true, desc: 'Specify custom Nmap data file location <dirname>' },
      { flag: '--send-eth', takesValue: false, desc: 'Send using raw ethernet frames' },
      { flag: '--send-ip', takesValue: false, desc: 'Send using raw IP packets' },
      { flag: '--privileged', takesValue: false, desc: 'Assume that the user is fully privileged' },
      { flag: '--unprivileged', takesValue: false, desc: 'Assume the user lacks raw socket privileges' },
      { flag: '-V', takesValue: false, desc: 'Print version number' },
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
  id: 'nmap-panel',
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
      ${commandPreviewHtml('nmap')}`;

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
    const session = getSession('nmap');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['nmap'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      // live-terminal.js's Send button has no other way to see what this
      // panel has built -- see subfinder-panel.js's matching comment.
      ctx.emit('nmap:flags', Object.fromEntries(active));
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

    // File-taking flags (-iL, --excludefile, --script-args-file, --resume)
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
