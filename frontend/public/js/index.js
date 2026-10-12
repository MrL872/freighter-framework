// ---------------------------------------------------------------------------
// Application composition root.
//
// This module is the single authoritative source for which page elements
// (components) exist and where they mount. It does not implement any
// component's rendering logic itself — that lives in js/components/*.js and
// is loaded dynamically, on demand, only for the elements the current page
// actually needs.
//
// Component contract (each js/components/*.js default-exports one of these):
//   {
//     id:        string   — unique identifier, used for logging/composition.
//     css:       string?  — path to a stylesheet under /static, loaded
//                           independently of and in parallel with the module.
//     critical:  boolean  — if true, a load failure is fatal to that mount
//                           point (still isolated from other components); if
//                           false, failure renders a fallback and the rest of
//                           the page continues normally.
//     mount(container, ctx): called once the module resolves. `ctx` exposes
//                           a tiny pub/sub bus (ctx.on/ctx.emit) so components
//                           can talk to each other (e.g. the menu component
//                           toggling the chat sidebar) without importing one
//                           another or touching undocumented globals.
//   }
// ---------------------------------------------------------------------------
import './theme.js';
import { store } from './store.js';
import { makeSortable, makeFixedSortable, locateGrid } from './dragReorder.js';
import { suppressTransition } from './domTransition.js';
import { terminalFocus } from './terminalFocus.js';
import { projectFolder, ALLOWED_PROJECT_EXTENSIONS, MAX_PROJECT_FILE_BYTES } from './projectFolder.js';
import { imageFolder } from './imageFolder.js';

// The full composition. `selector` is the DOM mount point this element
// renders into — if that node isn't present on the current page, the
// element is simply not requested, let alone loaded or rendered.
const COMPOSITION = [
  { id: 'menu', selector: '[data-component="menu"]', load: () => import('./components/menu.js') },
  { id: 'search', selector: '[data-component="search"]', load: () => import('./components/search.js') },
  { id: 'profile', selector: '[data-component="profile"]', load: () => import('./components/profile.js') },
  { id: 'chat-toggle', selector: '[data-component="chat-toggle"]', load: () => import('./components/chat-toggle.js') },
  { id: 'links', selector: '#links-sidebar', load: () => import('./components/links.js') },
  { id: 'metric-backend', selector: '[data-component="metric-backend"]', load: () => import('./components/metrics/backend.js') },
  { id: 'metric-services', selector: '[data-component="metric-services"]', load: () => import('./components/metrics/services.js') },
  { id: 'metric-severity', selector: '[data-component="metric-severity"]', load: () => import('./components/metrics/severity.js') },
  { id: 'metric-totals', selector: '[data-component="metric-totals"]', load: () => import('./components/metrics/totals.js') },
  { id: 'ledger', selector: '[data-component="ledger"]', load: () => import('./components/ledger.js') },
  { id: 'chat', selector: '#chat-sidebar', load: () => import('./components/chat.js') },
];

// The worker view replaces main's own children (metrics + ledger) with these
// four instrument boxes, on demand, when a worker is selected from the links
// sidebar — it does not navigate to a new page. See
// showWorkerView()/showOverview().
const WORKER_IDS = ['control-panel', 'wordlist-template', 'live-terminal', 'send-output'];
// The control panel is the one worker-view box with real, tool-specific
// content (flags straight out of .github/worker_instructions/<tool>.md) —
// each tool gets its own module under components/worker_components/, named
// "<worker>-panel.js", picked here by the worker id set on
// main.dataset.worker (see showWorkerView below). Every other worker still
// falls back to the generic placeholder panel.
function loadControlPanel() {
  const worker = document.querySelector('main').dataset.worker || '';
  if (worker.startsWith('subfinder')) return import('./components/worker_components/subfinder-panel.js');
  if (worker.startsWith('shuffledns')) return import('./components/worker_components/shuffledns-panel.js');
  if (worker.startsWith('dirsearch')) return import('./components/worker_components/dirsearch-panel.js');
  if (worker.startsWith('nmap')) return import('./components/worker_components/nmap-panel.js');
  if (worker.startsWith('gau')) return import('./components/worker_components/gau-panel.js');
  if (worker.startsWith('gitleaks')) return import('./components/worker_components/gitleaks-panel.js');
  if (worker.startsWith('nuclei')) return import('./components/worker_components/nuclei-panel.js');
  if (worker.startsWith('ffuf')) return import('./components/worker_components/ffuf-panel.js');
  if (worker.startsWith('metasploit')) return import('./components/worker_components/metasploit-panel.js');
  if (worker.startsWith('gowitness')) return import('./components/worker_components/gowitness-panel.js');
  if (worker.startsWith('katana')) return import('./components/worker_components/katana-panel.js');
  if (worker.startsWith('puredns')) return import('./components/worker_components/puredns-panel.js');
  if (worker.startsWith('xsstrike')) return import('./components/worker_components/xsstrike-panel.js');
  if (worker.startsWith('sqlmap')) return import('./components/worker_components/sqlmap-panel.js');
  if (worker.startsWith('hydra')) return import('./components/worker_components/hydra-panel.js');
  if (worker.startsWith('wpscan')) return import('./components/worker_components/wpscan-panel.js');
  if (worker.startsWith('sstimap')) return import('./components/worker_components/sstimap-panel.js');
  if (worker.startsWith('wafw00f')) return import('./components/worker_components/wafw00f-panel.js');
  if (worker.startsWith('jwt-tool')) return import('./components/worker_components/jwt-tool-panel.js');
  if (worker.startsWith('fuxploider')) return import('./components/worker_components/fuxploider-panel.js');
  if (worker.startsWith('masscan')) return import('./components/worker_components/masscan-panel.js');
  if (worker.startsWith('nosqlmap')) return import('./components/worker_components/nosqlmap-panel.js');
  return import('./components/control-panel.js');
}
const WORKER_COMPOSITION = [
  { id: 'control-panel', selector: '[data-component="control-panel"]', load: loadControlPanel },
  { id: 'wordlist-template', selector: '[data-component="wordlist-template"]', load: () => import('./components/wordlist-template.js') },
  { id: 'live-terminal', selector: '[data-component="live-terminal"]', load: () => import('./components/live-terminal.js') },
  { id: 'send-output', selector: '[data-component="send-output"]', load: () => import('./components/send-output.js') },
];

// Minimal event bus shared across components via ctx. Keeps coupling
// explicit (named events) instead of components reaching into each other's
// modules or into ad hoc globals.
function createBus() {
  const handlers = new Map();
  return {
    on(evt, fn) { (handlers.get(evt) || handlers.set(evt, new Set()).get(evt)).add(fn); },
    emit(evt, detail) { (handlers.get(evt) || []).forEach(fn => { try { fn(detail); } catch (e) { logError('bus:' + evt, e); } }); },
  };
}

const loadedCss = new Set();
function loadCss(href) {
  if (loadedCss.has(href)) return; // never load the same stylesheet twice
  loadedCss.add(href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function log(event, fields) {
  // Structured logging: which elements were requested/loaded/skipped/failed,
  // and how long each took, without leaking response bodies or secrets.
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}
function logError(id, err) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'component:error', id, message: String(err && err.message || err) }));
}

function renderFallback(container, id) {
  const div = document.createElement('div');
  div.className = 'component-error';
  div.textContent = `[${id}] unavailable`;
  container.replaceChildren(div);
}

async function loadElement(entry, ctx) {
  const container = document.querySelector(entry.selector);
  if (!container) {
    log('component:skipped', { id: entry.id, reason: 'no mount point on this page' });
    return;
  }
  const start = performance.now();
  log('component:requested', { id: entry.id });
  try {
    const mod = await entry.load();
    const component = mod.default;
    // CSS loads independently from /public/static, as soon as the module
    // resolves, rather than being bundled into the JS module itself. A
    // component may name more than one stylesheet (e.g. a tool-specific
    // panel reusing worker-view.css's shared classes alongside its own).
    if (component.css) (Array.isArray(component.css) ? component.css : [component.css]).forEach(loadCss);
    await component.mount(container, ctx);
    log('component:loaded', { id: entry.id, durationMs: Math.round(performance.now() - start) });
  } catch (err) {
    logError(entry.id, err);
    log('component:failed', { id: entry.id, durationMs: Math.round(performance.now() - start) });
    // Regardless of whether this element is marked critical, its failure
    // must not take down unrelated, already-loading/loaded elements — each
    // mount point is loaded and caught independently (see bootstrap()).
    if (!container.hasChildNodes()) renderFallback(container, entry.id);
  }
}

// Metrics panel order — drag-and-drop reorderable, same principle (and FLIP
// move animation, see dragReorder.js) as the links sidebar. Persisted
// locally only (a lighter-weight display preference than links' order,
// which also has to survive across devices via the backend), and scoped to
// the selected company profile the same way the ledger's column layout is.
// Dragging still works with no profile selected — a live demo of the
// feature — but saveMetricsOrder() below no-ops in that case, so it's a
// temporary session: a reload or a profile switch just loses it, back to
// the default order, instead of falling back to some unscoped shared key.
const METRICS_IDS = ['metric-backend', 'metric-services', 'metric-severity', 'metric-totals'];
function hasProfile() { return !!store.current(); }
function metricsOrderKey() {
  const p = store.current();
  return `fr-metrics-order-${p.id}`;
}
function loadMetricsOrder() {
  if (!hasProfile()) return [...METRICS_IDS];
  try {
    const saved = JSON.parse(localStorage.getItem(metricsOrderKey()));
    if (Array.isArray(saved) && saved.length === METRICS_IDS.length && METRICS_IDS.every(id => saved.includes(id))) {
      return saved;
    }
  } catch (e) { /* ignore */ }
  return [...METRICS_IDS];
}
function saveMetricsOrder(order) {
  if (!hasProfile()) return;
  try { localStorage.setItem(metricsOrderKey(), JSON.stringify(order)); } catch (e) { /* ignore */ }
}

// Applies the saved order to section.metrics's mount-point divs (each panel
// component still mounts into the same, now-reordered, container — see
// COMPOSITION above) and marks them as drag items. Safe to call whenever the
// metrics section exists in the DOM — including repeatedly, e.g. once per
// profile switch — since it only ever moves/relabels existing children.
// draggable stays true at all times: makeSortable's handleSelector below is
// what actually restricts a drag to only ever starting over the panel's
// '.panel-head', by refusing any drag that begins elsewhere — same
// native-HTML5-drag principle the ledger's column headers use, which is
// what gives the browser's own drag ghost image to show where the box is
// being moved to.
function applyMetricsOrder(section) {
  const order = loadMetricsOrder();
  order.forEach(id => {
    const el = section.querySelector(`[data-component="${id}"]`);
    if (el) section.append(el);
  });
  section.querySelectorAll('[data-component]').forEach(el => { el.draggable = true; el.dataset.id = el.dataset.component; });
}

// Wires up dragging on section.metrics and applies the current order. Only
// binds makeSortable's listeners once per actual `section` element (guarded
// by a marker attribute) — the section itself persists across profile
// switches, unlike a worker-view round trip which rebuilds it from scratch,
// so re-running this on every switch would otherwise stack duplicate
// listeners instead of just refreshing the order.
function setupMetricsSortable() {
  const section = document.querySelector('.metrics');
  if (!section) return;
  applyMetricsOrder(section);
  if (section.dataset.sortableBound) return;
  section.dataset.sortableBound = '1';
  makeSortable(section, ids => saveMetricsOrder(ids), { itemSelector: '[data-component]', locate: locateGrid, handleSelector: '.panel-head' });
}

// Each company profile keeps its own panel order: reload it (which also
// resets to the default order while no profile is selected) whenever the
// selected profile changes.
let lastMetricsProfileId = store.profileId;
store.subscribe(() => {
  if (store.profileId === lastMetricsProfileId) return;
  lastMetricsProfileId = store.profileId;
  setupMetricsSortable();
});

// The worker view's four instrument boxes are drag-and-drop reorderable,
// same principle (and same profile-scoped, demo-while-unscoped persistence)
// as the metrics grid above.
function workerGridOrderKey() {
  const p = store.current();
  return `fr-worker-panels-order-${p.id}`;
}
function loadWorkerGridOrder() {
  if (!hasProfile()) return [...WORKER_IDS];
  try {
    const saved = JSON.parse(localStorage.getItem(workerGridOrderKey()));
    if (Array.isArray(saved) && saved.length === WORKER_IDS.length && WORKER_IDS.every(id => saved.includes(id))) {
      return saved;
    }
  } catch (e) { /* ignore */ }
  return [...WORKER_IDS];
}
function saveWorkerGridOrder(order) {
  if (!hasProfile()) return;
  try { localStorage.setItem(workerGridOrderKey(), JSON.stringify(order)); } catch (e) { /* ignore */ }
}
// Unlike setupMetricsSortable, this doesn't need a rebind guard: the grid is
// rebuilt from scratch (main.innerHTML) on every showWorkerView() call, so
// there's always a fresh element here, never a persisting one that could
// accumulate duplicate listeners across calls.
function setupWorkerGridSortable() {
  const grid = document.querySelector('.worker-grid');
  if (!grid) return;
  const order = loadWorkerGridOrder();
  order.forEach(id => {
    const el = grid.querySelector(`[data-component="${id}"]`);
    if (el) grid.append(el);
  });
  grid.querySelectorAll('[data-component]').forEach(el => { el.dataset.id = el.dataset.component; });
  makeFixedSortable(grid, ids => saveWorkerGridOrder(ids), {
    itemSelector: '[data-component]',
    locate: locateGrid,
    handleSelector: '.panel-head',
    // While Terminal Focus pins the live terminal to its own full-width row
    // (see worker-view.css), it isn't draggable like the other three boxes --
    // there's nowhere else on the grid for it to go.
    isDraggable: item => !(terminalFocus.focused && item.dataset.component === 'live-terminal'),
  });
}

// main's original markup (metrics + ledger), captured once before it's ever
// replaced, so the overview can be restored after a worker view is shown.
let overviewMarkup = null;

function showWorkerView(ctx, name) {
  const main = document.querySelector('main');
  if (overviewMarkup == null) overviewMarkup = main.innerHTML;
  // base.css transitions main's grid-template-rows so the [ view ] menu's
  // metrics toggle can animate — but that selector is scoped to
  // main:not([data-worker]):not([data-page]), so flipping those attributes
  // during page navigation (worker <-> overview <-> Project/Image Folder)
  // itself flips whether the transition rule matches at all, right as
  // grid-template-rows also jumps between each page's very different row
  // shapes. The result was an unwanted animated resize on every navigation —
  // most visible as metrics briefly appearing then shrinking away when
  // returning to a metrics-hidden overview. suppressTransition() forces it
  // off for one frame around the swap so the new layout just snaps into
  // place, same as before the toggle existed, then lets the inline override
  // lapse so a deliberate same-page toggle still animates.
  suppressTransition(main);
  main.dataset.worker = name;
  main.innerHTML = `
    <div class="worker-bar">
      <button type="button" class="tool-btn" id="worker-back">&laquo; overview</button>
      <span class="worker-name">${name}</span>
    </div>
    <div class="worker-grid">
      <section data-component="control-panel" aria-label="Control panel"></section>
      <section data-component="wordlist-template" aria-label="Custom wordlist/template"></section>
      <section data-component="live-terminal" aria-label="Live caption terminal"></section>
      <section data-component="send-output" aria-label="Send output"></section>
    </div>`;
  main.querySelector('#worker-back').addEventListener('click', () => showOverview(ctx));
  setupWorkerGridSortable();
  Promise.allSettled(WORKER_COMPOSITION.map(entry => loadElement(entry, ctx)));
}

function showOverview(ctx) {
  const main = document.querySelector('main');
  suppressTransition(main);
  delete main.dataset.worker;
  delete main.dataset.page;
  main.innerHTML = overviewMarkup;
  setupMetricsSortable();
  const overviewIds = new Set(['metric-backend', 'metric-services', 'metric-severity', 'metric-totals', 'ledger']);
  Promise.allSettled(COMPOSITION.filter(e => overviewIds.has(e.id)).map(entry => loadElement(entry, ctx)));
}

// Project Folder: where a manual "save results"/"save wordlist" action
// (see send-output.js, wordlist-template.js) lands, scoped to the selected
// company profile so one profile's saved files never show up under
// another's — same principle as the links order and metrics/worker panel
// layouts (see store.current()/profileSuffix() equivalents above). Backed
// by the same Derby-backed preferences store the sidebar's link order uses
// (see js/projectFolder.js) — a real, persisted list, not local-only.
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Light syntax coloring for the Project Folder's content window — single
// regex pass per format so tokens never get wrapped twice (matches are
// consumed left to right, no re-scanning of already-substituted HTML).
function highlightJson(raw) {
  const tokenRe = /("(?:[^"\\]|\\.)*")|(\btrue\b|\bfalse\b|\bnull\b)|(-?\b\d+(?:\.\d+)?\b)|([{}[\],])/g;
  return escapeHtml(raw).replace(tokenRe, (m, str, kw, num) => {
    if (str) return `<span class="tok-string">${m}</span>`;
    if (kw) return `<span class="tok-keyword">${m}</span>`;
    if (num) return `<span class="tok-number">${m}</span>`;
    return `<span class="tok-punct">${m}</span>`;
  });
}
function highlightYaml(raw) {
  return escapeHtml(raw).split('\n').map(line => {
    const m = line.match(/^(\s*)(-\s?)?(.*)$/);
    if (!m) return line;
    const [, indent, dash, rest] = m;
    let out = indent + (dash ? `<span class="tok-punct">${dash}</span>` : '');
    if (!rest) return out;
    const kv = rest.match(/^([\w.-]+):(\s?)(.*)$/);
    out += kv
      ? `<span class="tok-key">${kv[1]}</span><span class="tok-punct">:</span>${kv[2]}<span class="tok-string">${kv[3]}</span>`
      : `<span class="tok-string">${rest}</span>`;
    return out;
  }).join('\n');
}
function highlightForFormat(content, format) {
  if (format === 'json') return highlightJson(content);
  if (format === 'yaml') return highlightYaml(content);
  return escapeHtml(content);
}

function renderProjectFileList(filesEl, files) {
  filesEl.replaceChildren();
  if (!files.length) {
    const empty = document.createElement('li');
    empty.className = 'pf-empty';
    empty.textContent = 'Nothing saved here yet.';
    filesEl.append(empty);
    return;
  }
  files.slice().reverse().forEach(f => filesEl.append(buildProjectFileRow(f)));
}

// Builds one saved file's row from scratch as its own node (rather than a
// string joined into the rest of the list) — a flex container with the
// name/meta on the left and the rename/delete symbol buttons on the right,
// each independently addressable so a rename or delete only ever touches
// its own node instead of forcing a full list re-render.
function buildProjectFileRow(file) {
  const id = projectFolder.idOf(file);
  const li = document.createElement('li');
  li.className = 'pf-item';
  li.dataset.id = id;

  const row = document.createElement('div');
  row.className = 'pf-row';

  const info = document.createElement('span');
  info.className = 'pf-info';
  const nameRow = document.createElement('span');
  nameRow.className = 'pf-name-row';
  const nameEl = document.createElement('span');
  nameEl.className = 'pf-name';
  nameEl.textContent = file.name;
  const chevronBtn = document.createElement('button');
  chevronBtn.type = 'button';
  chevronBtn.className = 'pf-chevron';
  chevronBtn.setAttribute('aria-expanded', 'false');
  chevronBtn.setAttribute('aria-label', `Expand ${file.name}`);
  chevronBtn.innerHTML = '<span class="glyph" aria-hidden="true">&gt;</span>';
  nameRow.append(chevronBtn, nameEl);
  const metaEl = document.createElement('span');
  metaEl.className = 'pf-meta';
  metaEl.textContent = `${file.kind || ''} · ${new Date(file.savedAt).toLocaleString()}`;
  info.append(nameRow, metaEl);

  const actions = document.createElement('span');
  actions.className = 'pf-actions';
  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'pf-action';
  renameBtn.title = 'Rename';
  renameBtn.setAttribute('aria-label', `Rename ${file.name}`);
  renameBtn.textContent = '✎'; // pencil
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'pf-action pf-delete';
  delBtn.title = 'Delete';
  delBtn.setAttribute('aria-label', `Delete ${file.name}`);
  delBtn.textContent = '✕'; // multiplication x
  actions.append(renameBtn, delBtn);

  row.append(info, actions);

  // Expandable content window: collapsed by default, toggled by the
  // chevron next to the file's name — reveals the file exactly as saved
  // (see formatContent() in wordlist-template.js for why a .json/.yaml
  // save is actually shaped like one, not just named like one). Its own
  // toolbar (upper right) can copy the content out or edit it in place and
  // write the change back to the saved document.
  const contentWrap = document.createElement('div');
  contentWrap.className = 'pf-content-wrap';

  // Everything the window shows — toolbar and content alike — lives inside
  // this one inner node, so grid-collapsing .pf-content-wrap hides/reveals
  // the whole thing as a single unit instead of just the text.
  const contentInner = document.createElement('div');
  contentInner.className = 'pf-content-inner';

  const toolbar = document.createElement('div');
  toolbar.className = 'pf-content-toolbar';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'bracket-copy-btn';
  copyBtn.textContent = '[Copy]';
  copyBtn.title = 'Copy contents to clipboard';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'bracket-copy-btn';
  editBtn.textContent = '[Edit]';
  editBtn.title = 'Edit and save changes to this file';
  toolbar.append(copyBtn, editBtn);

  const pre = document.createElement('pre');
  pre.className = 'pf-content';
  pre.innerHTML = highlightForFormat(file.content || '', file.format);
  contentInner.append(toolbar, pre);
  contentWrap.append(contentInner);

  li.append(row, contentWrap);

  chevronBtn.addEventListener('click', () => {
    const open = chevronBtn.getAttribute('aria-expanded') !== 'true';
    chevronBtn.setAttribute('aria-expanded', String(open));
    contentWrap.classList.toggle('open', open);
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(file.content || '');
      copyBtn.textContent = '[Copied]';
    } catch {
      copyBtn.textContent = '[Copy failed]';
    }
    setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
  });

  let textarea = null;
  editBtn.addEventListener('click', async () => {
    if (!textarea) {
      textarea = document.createElement('textarea');
      textarea.className = 'pf-content-edit';
      textarea.value = file.content || '';
      pre.replaceWith(textarea);
      textarea.focus();
      editBtn.textContent = '[Save]';
      editBtn.title = 'Save changes to this file';
      return;
    }
    const value = textarea.value;
    editBtn.disabled = true;
    editBtn.textContent = 'Saving…';
    try {
      await projectFolder.updateContent(id, value);
      file.content = value;
      pre.innerHTML = highlightForFormat(value, file.format);
      textarea.replaceWith(pre);
      textarea = null;
      editBtn.textContent = '[Edit]';
      editBtn.title = 'Edit and save changes to this file';
    } catch (e) {
      editBtn.textContent = '[Save failed]';
      setTimeout(() => { editBtn.textContent = '[Save]'; }, 1500);
    }
    editBtn.disabled = false;
  });

  renameBtn.addEventListener('click', () => {
    if (row.querySelector('.pf-rename-input')) return; // already renaming
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pf-rename-input';
    input.value = file.name;
    input.setAttribute('aria-label', `New name for ${file.name}`);
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const restore = () => input.replaceWith(nameEl);
    const commit = async () => {
      const value = input.value.trim();
      if (!value || value === file.name) { restore(); return; }
      input.disabled = true;
      try {
        await projectFolder.rename(id, value);
        file.name = value;
        nameEl.textContent = value;
        renameBtn.setAttribute('aria-label', `Rename ${value}`);
        delBtn.setAttribute('aria-label', `Delete ${value}`);
        chevronBtn.setAttribute('aria-label', `Expand ${value}`);
      } catch (e) { /* leave the previous name in place on failure */ }
      restore();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); restore(); }
    });
    input.addEventListener('blur', () => { if (document.contains(input)) restore(); });
  });

  // Same arm-then-confirm pattern as the profile switcher's own delete
  // button (see profile.js) — one click arms it, a second within the same
  // focus session confirms; losing focus disarms it again.
  delBtn.addEventListener('click', () => {
    if (delBtn.dataset.armed !== '1') {
      delBtn.dataset.armed = '1';
      delBtn.textContent = '✓?';
      delBtn.title = 'Click again to confirm delete';
      return;
    }
    delBtn.disabled = true;
    projectFolder.remove(id).then(() => li.remove()).catch(() => {
      delBtn.disabled = false;
      delBtn.dataset.armed = '';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete';
    });
  });
  delBtn.addEventListener('blur', () => {
    delBtn.dataset.armed = '';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
  });

  return li;
}

// Image Storage's two grids (this folder-tile list, and each target's own
// screenshot grid in renderImageGrid below) are drag-and-drop reorderable,
// same FLIP-animated principle (see dragReorder.js) as the links sidebar/
// metrics panels/ledger columns -- but persisted through the backend's
// /api/preferences store like the ledger's column order, not localStorage
// like the metrics/worker-grid panels (see loadMetricsOrder above): this is
// an arrangement of real backend-held data (a profile's actual saved
// screenshots), not just a cosmetic panel layout, so it should survive
// across devices the same way the screenshots themselves already do.
async function loadSavedOrder(key) {
  try {
    const res = await fetch(`/api/preferences/${key}`);
    if (!res.ok) return null;
    const value = await res.json();
    return Array.isArray(value) ? value : null;
  } catch (e) {
    return null;
  }
}
function saveOrderPreference(key, order) {
  fetch(`/api/preferences/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(order),
  }).catch(() => { /* best-effort; the reorder already applied locally */ });
}
// PreferencesController's key route is constrained to [a-z0-9-]{1,64} --
// a target hostname can carry dots/uppercase/etc. that violate that pattern
// (a mismatched key 404s the whole request), so it's hashed into the grid's
// own order key below instead of used verbatim. FNV-1a: not a security
// boundary, just short, deterministic and already lowercase-hex.
function hashForKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function folderOrderKey(profileId) { return `image-folder-order-${profileId}`; }
function gridOrderKey(profileId, target) { return `image-grid-order-${profileId}-${hashForKey(target || '')}`; }

// Top-level Image Storage view: one folder box per target, mirroring the
// real on-disk layout (<profileId>/<target>/..., see ImageFileService) the
// way a plain filesystem browser would -- clicking a folder navigates into
// showImageTargetFolder() rather than expanding anything in place.
// gowitness-worker resolves each screenshot's real crawled host from its
// own --write-jsonl report (see GowitnessRelayHandler), and that's the
// folder it's actually saved under on disk, so this mirrors that grouping
// instead of listing every screenshot from every target in one pile. A
// screenshot with no resolved target (anything saved before this grouping
// existed, or one whose real URL genuinely couldn't be recovered) falls
// into an "Unsorted" folder, sorted last.
async function renderImageFolderList(container, files, ctx, profile) {
  container.replaceChildren();
  if (!files.length) {
    const empty = document.createElement('p');
    empty.className = 'hint image-empty';
    empty.textContent = 'Nothing saved here yet.';
    container.append(empty);
    return;
  }
  const groups = new Map();
  files.forEach(f => {
    const key = f.target || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  });
  const hasUnsorted = groups.has('');
  const defaultOrder = [...groups.keys()].filter(k => k !== '').sort((a, b) => a.localeCompare(b));
  const saved = await loadSavedOrder(folderOrderKey(profile.id));
  // The page may have navigated away (or the profile may have changed)
  // while that fetch was in flight -- don't paint into a container nobody's
  // looking at anymore, same guard showImageFolder() already applies
  // around its own files fetch.
  if (!document.contains(container) || store.profileId !== profile.id) return;
  let keys;
  if (saved && saved.length) {
    const known = new Set(defaultOrder);
    const kept = saved.filter(k => known.has(k));
    const missing = defaultOrder.filter(k => !kept.includes(k));
    keys = [...kept, ...missing];
  } else {
    keys = defaultOrder;
  }
  if (hasUnsorted) keys.push(''); // always last -- see the undraggable branch below

  const grid = document.createElement('div');
  grid.className = 'image-folder-grid';
  keys.forEach(key => {
    const count = groups.get(key).length;
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'image-folder-box';
    box.setAttribute('aria-label', `Open ${key || 'Unsorted'} (${count} screenshot${count === 1 ? '' : 's'})`);
    box.innerHTML = `
      <img class="image-folder-icon" src="icons/icons8-folder-24.png" alt="" width="44" height="44" draggable="false">
      <span class="image-folder-name">${escapeHtml(key || 'Unsorted')}</span>
      <span class="image-folder-count">${count} screenshot${count === 1 ? '' : 's'}</span>`;
    box.addEventListener('click', () => showImageTargetFolder(ctx, profile, key));
    // Unsorted (key === '') stays undraggable and pinned last -- excluded
    // from both the drag source itself and makeSortable's own itemSelector
    // below, so it can never become a drop target either (see the pinned
    // "select" column's identical exclusion in ledger.js).
    if (key !== '') {
      box.draggable = true;
      box.dataset.id = key;
    }
    grid.append(box);
  });
  container.append(grid);

  makeSortable(grid, ids => saveOrderPreference(folderOrderKey(profile.id), ids), {
    itemSelector: '.image-folder-box[draggable="true"]',
    locate: locateGrid,
  });
}

// Fills a target folder's own page with its screenshots -- same medium
// boxes regardless of which folder, just the set of files differs. Drag-
// and-drop reorderable too, same principle as renderImageFolderList above;
// the custom order is scoped per target (gridOrderKey), not just per
// profile, since each target's page shows a different subset of files.
async function renderImageGrid(container, files, profileId, target) {
  container.replaceChildren();
  if (!files.length) {
    const empty = document.createElement('p');
    empty.className = 'hint image-empty';
    empty.textContent = 'Nothing saved here yet.';
    container.append(empty);
    return;
  }
  const byDateDesc = files.slice().sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  const saved = await loadSavedOrder(gridOrderKey(profileId, target));
  // Same staleness guard as renderImageFolderList above.
  if (!document.contains(container) || store.profileId !== profileId) return;
  let ordered;
  if (saved && saved.length) {
    const byId = new Map(files.map(f => [imageFolder.idOf(f), f]));
    const keptIds = new Set(saved);
    const kept = saved.map(id => byId.get(id)).filter(Boolean);
    const missing = byDateDesc.filter(f => !keptIds.has(imageFolder.idOf(f)));
    ordered = [...kept, ...missing];
  } else {
    ordered = byDateDesc;
  }
  const grid = document.createElement('div');
  grid.className = 'image-grid';
  ordered.forEach(f => grid.append(buildImageBox(f)));
  container.append(grid);

  makeSortable(grid, ids => saveOrderPreference(gridOrderKey(profileId, target), ids), {
    itemSelector: '.image-box[draggable="true"]',
    locate: locateGrid,
  });
}

// One medium clickable thumbnail, labeled with the real endpoint it was
// captured from (file.endpoint -- falls back to the stored file name for an
// older/unresolved entry that has none). The thumbnail opens
// openImageLightbox() on click; the label below it is a real link to that
// endpoint when one is known, so it can be followed straight from the grid
// instead of only read. Rename/delete live as small corner icons (same
// arm-then-confirm delete pattern as buildProjectFileRow's row, just
// compact enough for a box instead of a full row).
function buildImageBox(file) {
  const id = imageFolder.idOf(file);
  const label = file.endpoint || file.name;

  const box = document.createElement('div');
  box.className = 'image-box';
  box.dataset.id = id;
  // Drag-and-drop reorderable (see renderImageGrid's makeSortable call
  // above) -- the descendants below each get draggable="false" since an
  // <img> or <a> is natively draggable by default in most browsers (you can
  // drag either straight out to save/bookmark it), which would otherwise
  // hijack the drag gesture from this box as a whole and start dragging
  // just that one element instead.
  box.draggable = true;

  const thumbBtn = document.createElement('button');
  thumbBtn.type = 'button';
  thumbBtn.className = 'image-box-thumb';
  thumbBtn.setAttribute('aria-label', `Open ${label} full size`);
  const img = document.createElement('img');
  img.src = file.content || '';
  img.alt = label;
  img.loading = 'lazy';
  img.draggable = false;
  thumbBtn.append(img);

  const actions = document.createElement('span');
  actions.className = 'image-box-actions';
  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'image-box-action';
  renameBtn.title = 'Rename';
  renameBtn.setAttribute('aria-label', `Rename ${file.name}`);
  renameBtn.textContent = '✎'; // pencil
  renameBtn.draggable = false;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'image-box-action image-box-delete';
  delBtn.title = 'Delete';
  delBtn.setAttribute('aria-label', `Delete ${file.name}`);
  delBtn.textContent = '✕'; // multiplication x
  delBtn.draggable = false;
  actions.append(renameBtn, delBtn);

  // A real link only when there's a real URL to follow -- the stored file
  // name alone (the fallback `label`) isn't one, so that case stays plain
  // text rather than linking to something meaningless.
  const caption = file.endpoint ? document.createElement('a') : document.createElement('div');
  caption.className = 'image-box-caption';
  caption.draggable = false;
  if (file.endpoint) {
    caption.href = file.endpoint;
    caption.target = '_blank';
    caption.rel = 'noopener noreferrer';
    caption.title = `Open ${label}`;
  } else {
    caption.title = label;
  }
  caption.textContent = label;

  box.append(thumbBtn, actions, caption);

  thumbBtn.addEventListener('click', () => openImageLightbox(file));

  renameBtn.addEventListener('click', () => {
    if (box.querySelector('.image-box-rename-input')) return; // already renaming
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'image-box-rename-input';
    input.value = file.name;
    input.setAttribute('aria-label', `New name for ${file.name}`);
    caption.replaceWith(input);
    input.focus();
    input.select();

    const restore = () => input.replaceWith(caption);
    const commit = async () => {
      const value = input.value.trim();
      if (!value || value === file.name) { restore(); return; }
      input.disabled = true;
      try {
        await imageFolder.rename(id, value);
        file.name = value;
        renameBtn.setAttribute('aria-label', `Rename ${value}`);
        delBtn.setAttribute('aria-label', `Delete ${value}`);
        // The caption/thumbnail alt only follow the renamed file name when
        // there's no real endpoint overriding it (see `label` above).
        if (!file.endpoint) {
          caption.textContent = value;
          caption.title = value;
          img.alt = value;
          thumbBtn.setAttribute('aria-label', `Open ${value} full size`);
        }
      } catch (e) { /* leave the previous name in place on failure */ }
      restore();
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); restore(); }
    });
    input.addEventListener('blur', () => { if (document.contains(input)) restore(); });
  });

  // Same arm-then-confirm pattern as buildProjectFileRow's delete button.
  delBtn.addEventListener('click', () => {
    if (delBtn.dataset.armed !== '1') {
      delBtn.dataset.armed = '1';
      delBtn.textContent = '✓?';
      delBtn.title = 'Click again to confirm delete';
      return;
    }
    delBtn.disabled = true;
    imageFolder.remove(id).then(() => {
      const grid = box.closest('.image-grid');
      box.remove();
      if (grid && !grid.children.length) {
        const empty = document.createElement('p');
        empty.className = 'hint image-empty';
        empty.textContent = 'Nothing saved here yet.';
        grid.replaceWith(empty);
      }
    }).catch(() => {
      delBtn.disabled = false;
      delBtn.dataset.armed = '';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete';
    });
  });
  delBtn.addEventListener('blur', () => {
    delBtn.dataset.armed = '';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete';
  });

  return box;
}

// At most one lightbox open at a time, same pattern as gowitness-panel.js's
// openValuePopup -- opening another one (there's only ever one trigger, a
// box's thumbnail, but keep the guard for safety) closes whichever is open.
let closeImageLightbox = null;

// Full-size, click-to-close preview of one screenshot: a mostly transparent
// backdrop (deliberately lighter than the app's other modals, e.g.
// .wordlist-overlay, so the grid behind it stays legible) with the image
// itself shown at near-full size. Closes on Escape, on a click outside the
// image, or the close button.
function openImageLightbox(file) {
  if (closeImageLightbox) closeImageLightbox();
  const label = file.endpoint || file.name;

  const overlay = document.createElement('div');
  overlay.className = 'image-lightbox-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', label);

  const frame = document.createElement('div');
  frame.className = 'image-lightbox-frame';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'image-lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';
  const img = document.createElement('img');
  img.className = 'image-lightbox-img';
  img.src = file.content || '';
  img.alt = label;
  const caption = document.createElement('div');
  caption.className = 'image-lightbox-caption';
  caption.textContent = label;

  frame.append(closeBtn, img, caption);
  overlay.append(frame);
  document.body.append(overlay);

  const cleanup = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
    if (closeImageLightbox === cleanup) closeImageLightbox = null;
  };
  closeImageLightbox = cleanup;

  // Only a direct click on the backdrop itself (not the frame/image/caption
  // inside it) closes -- same "outside click" reasoning as every other
  // dismissible popup in this app.
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) cleanup(); });
  closeBtn.addEventListener('click', cleanup);
  const onKeydown = e => { if (e.key === 'Escape') { e.preventDefault(); cleanup(); } };
  document.addEventListener('keydown', onKeydown);

  closeBtn.focus();
}

async function showImageFolder(ctx) {
  const main = document.querySelector('main');
  if (overviewMarkup == null) overviewMarkup = main.innerHTML;
  suppressTransition(main);
  delete main.dataset.worker;
  main.dataset.page = 'image-folder';
  loadCss('static/worker-view.css');
  const profile = store.current();
  main.innerHTML = `
    <div class="worker-bar">
      <button type="button" class="tool-btn" id="worker-back">&laquo; overview</button>
      <span class="worker-name">Image Storage</span>
    </div>
    <div class="image-storage-body">
      <p class="hint">${profile
        ? `Screenshot storage for <strong>${escapeHtml(profile.name)}</strong>.`
        : 'Select a company profile to use its image storage.'}</p>
      <div class="image-folders"></div>
    </div>`;
  main.querySelector('#worker-back').addEventListener('click', () => showOverview(ctx));
  if (!profile) return;

  const foldersEl = main.querySelector('.image-folders');
  const files = await imageFolder.list(profile.id);
  // The page may have navigated away (or the profile may have changed)
  // while that fetch was in flight — don't paint a stale/mismatched list.
  if (!document.contains(foldersEl) || store.profileId !== profile.id) return;
  await renderImageFolderList(foldersEl, files, ctx, profile);
}

// One target's own page, reached by clicking its folder box in
// showImageFolder() -- a plain "back to the folder list" bar above a grid
// of that target's screenshots, same shape as every other worker-view page.
async function showImageTargetFolder(ctx, profile, target) {
  const main = document.querySelector('main');
  suppressTransition(main);
  delete main.dataset.worker;
  main.dataset.page = 'image-target-folder';
  loadCss('static/worker-view.css');
  main.innerHTML = `
    <div class="worker-bar">
      <button type="button" class="tool-btn" id="worker-back">&laquo; Image Storage</button>
      <span class="worker-name">${escapeHtml(target || 'Unsorted')}</span>
    </div>
    <div class="image-storage-body">
      <div class="image-target-grid"></div>
    </div>`;
  main.querySelector('#worker-back').addEventListener('click', () => showImageFolder(ctx));

  const gridEl = main.querySelector('.image-target-grid');
  const files = await imageFolder.list(profile.id);
  if (!document.contains(gridEl) || store.profileId !== profile.id) return;
  await renderImageGrid(gridEl, files.filter(f => (f.target || '') === target), profile.id, target);
}

async function showProjectFolder(ctx) {
  const main = document.querySelector('main');
  if (overviewMarkup == null) overviewMarkup = main.innerHTML;
  suppressTransition(main);
  delete main.dataset.worker;
  main.dataset.page = 'project-folder';
  loadCss('static/worker-view.css');
  const profile = store.current();
  main.innerHTML = `
    <div class="worker-bar">
      <button type="button" class="tool-btn" id="worker-back">&laquo; overview</button>
      <span class="worker-name">Project Folder</span>
    </div>
    <div class="project-folder-body">
      <p class="hint">${profile
        ? `Storage for <strong>${escapeHtml(profile.name)}</strong>.`
        : 'Select a company profile to use its project folder.'}</p>
      ${profile ? `
      <div class="pf-dropzone" id="pf-dropzone" tabindex="0" role="button"
        aria-label="Import files: drag and drop, or press Enter to browse">
        <p>Drag files here to import, or click to browse<br>
          <span class="pf-dropzone-types">${ALLOWED_PROJECT_EXTENSIONS.join(' · ')} — max ${Math.floor(MAX_PROJECT_FILE_BYTES / 1024)}KB each</span></p>
        <input type="file" id="pf-file-input" multiple hidden
          accept="${ALLOWED_PROJECT_EXTENSIONS.join(',')}">
      </div>
      <p class="pf-import-status" id="pf-import-status" role="status" aria-live="polite"></p>` : ''}
      <ul class="project-folder-files"></ul>
    </div>`;
  main.querySelector('#worker-back').addEventListener('click', () => showOverview(ctx));
  if (!profile) return;

  const filesEl = main.querySelector('.project-folder-files');
  setupProjectFolderImport(main, filesEl, profile);
  const files = await projectFolder.list(profile.id);
  // The page may have navigated away (or the profile may have changed)
  // while that fetch was in flight — don't paint a stale/mismatched list.
  if (!document.contains(filesEl) || store.profileId !== profile.id) return;
  renderProjectFileList(filesEl, files);
}

// Wires the Project Folder page's drag-and-drop (and click-to-browse)
// import zone. Import is intentionally one-directional: files only ever
// flow host filesystem -> project storage through projectFolder.importFile,
// which enforces the type/size allowlist before anything is saved — there's
// no corresponding "save to disk" affordance anywhere on this page.
function setupProjectFolderImport(main, filesEl, profile) {
  const dropzone = main.querySelector('#pf-dropzone');
  if (!dropzone) return;
  const fileInput = main.querySelector('#pf-file-input');
  const statusEl = main.querySelector('#pf-import-status');

  const setStatus = (msg, isError) => {
    statusEl.textContent = msg;
    statusEl.classList.toggle('pf-import-error', !!isError);
  };

  const importFiles = async fileList => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const errors = [];
    for (const file of files) {
      try {
        await projectFolder.importFile(file);
      } catch (e) {
        errors.push(e.message || `${file.name}: import failed`);
      }
    }
    setStatus(errors.length
      ? errors.join(' · ')
      : `Imported ${files.length} file${files.length === 1 ? '' : 's'}.`, errors.length > 0);

    // The page may have navigated away (or the profile may have changed)
    // while imports were in flight — don't paint a stale/mismatched list.
    if (!document.contains(filesEl) || store.profileId !== profile.id) return;
    renderProjectFileList(filesEl, await projectFolder.list(profile.id));
  };

  ['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.add('pf-drag-active');
  }));
  ['dragleave', 'dragend'].forEach(evt => dropzone.addEventListener(evt, () => {
    dropzone.classList.remove('pf-drag-active');
  }));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('pf-drag-active');
    importFiles(e.dataTransfer && e.dataTransfer.files);
  });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    importFiles(fileInput.files);
    fileInput.value = '';
  });
}

// Below base.css's 640px breakpoint, the menu nav and the profile/chat-toggle
// group hide in normal flow and only reappear (as dropdown panels, see
// header.nav-open in base.css) while this hamburger button is toggled open.
// Above the breakpoint the button itself is hidden by CSS, so this wiring is
// simply inert there.
function setupHeaderHamburger() {
  const header = document.querySelector('header');
  const btn = document.querySelector('#header-hamburger');
  if (!header || !btn) return;
  const setOpen = open => {
    header.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', String(open));
  };
  btn.addEventListener('click', () => setOpen(!header.classList.contains('nav-open')));
  document.addEventListener('click', e => {
    if (header.classList.contains('nav-open') && !e.composedPath().includes(header)) setOpen(false);
  });
  header.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); btn.focus(); } });
  // A click on any actual menu/profile/chat-toggle item inside the open
  // panels should close the panel afterward, same as those components'
  // own dropdowns closing on selection.
  header.addEventListener('click', e => {
    if (e.target.closest('#header-hamburger')) return;
    if (e.target.closest('.header-left [data-component="menu"]') || e.target.closest('.header-right')) {
      if (e.target.closest('button')) setOpen(false);
    }
  });
}

async function bootstrap() {
  const ctx = createBus();
  ctx.on('worker:open', name => showWorkerView(ctx, name));
  ctx.on('storage:open', () => showProjectFolder(ctx));
  ctx.on('imageStorage:open', () => showImageFolder(ctx));
  setupHeaderHamburger();
  // Resolve which elements this request/page actually needs, then load the
  // independent ones concurrently — there is no ordering dependency between
  // mount points, so nothing should be blocked behind a sequential chain.
  const required = COMPOSITION.filter(e => document.querySelector(e.selector));
  log('composition:resolved', { requested: required.map(e => e.id) });
  setupMetricsSortable();
  await Promise.allSettled(required.map(entry => loadElement(entry, ctx)));
  log('composition:settled', {});
}

document.addEventListener('DOMContentLoaded', bootstrap);
