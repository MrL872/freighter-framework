import { state, subscribe } from '../data.js';
import { store } from '../store.js';
import { makeSortable, locateHorizontal } from '../dragReorder.js';
import { openVulnCard } from './vulnCard.js';

const SELECT_WIDTH = 40;
const MIN_WIDTH = 60;

// Whether there's a profile to scope a layout customization to. Dragging to
// reorder columns and resizing them still works with none selected — it's a
// live demo of the feature — but nothing it produces is persisted (see
// loadColumnOrder/saveColumnOrder/loadColumnWidths/saveColumnWidths below),
// so it's a temporary, unsaved session that a reload or a profile switch
// just loses, back to the default layout.
function hasProfile() { return !!store.current(); }

// Column widths are scoped to the selected company profile — each profile
// keeps its own layout.
function columnsPrefKey() {
  const p = store.current();
  return `ledger-columns-${p.id}`;
}

// Columns shown in the ledger. `key` reads straight off a finding; `label`
// is what's printed after the ">_" trigger. The select column has no
// backing field, isn't resizable, and drives row.selected instead of a
// finding property. Resizable columns get their width computed at mount
// time so they always exactly fill the ledger box (see fitColumns below);
// dragging a handle only trades width with its neighbor, so the total
// never grows past the box.
const COLUMNS = [
  { key: 'select', label: '', resizable: false, width: SELECT_WIDTH },
  { key: 'severity', label: 'Severity', resizable: true },
  { key: 'target', label: 'Target', resizable: true },
  { key: 'path', label: 'Path', resizable: true },
  { key: 'port', label: 'Port', resizable: true },
  // Only the HTTP-probing tools (ffuf, dirsearch) set this today -- every
  // other worker's finding leaves it unset, and fieldValue()'s normal
  // undefined/null/'' -> '-' fallback already covers that, same as any
  // other column a given worker doesn't populate.
  { key: 'statusCode', label: 'Status Code', resizable: true },
  { key: 'title', label: 'Title', resizable: true },
  { key: 'description', label: 'Description', resizable: true },
  { key: 'remediation', label: 'Remediation', resizable: true },
  { key: 'worker', label: 'Worker', resizable: true },
  { key: 'date', label: 'Date', resizable: true },
];
const COLUMNS_BY_KEY = new Map(COLUMNS.map(c => [c.key, c]));
const DEFAULT_COLUMN_ORDER = COLUMNS.filter(c => c.key !== 'select').map(c => c.key);

function isValidColumnOrder(v) {
  return Array.isArray(v) && v.length === DEFAULT_COLUMN_ORDER.length && DEFAULT_COLUMN_ORDER.every(k => v.includes(k));
}

// Column order (drag-and-drop, like the links sidebar) is a per-user,
// per-profile preference, persisted server-side the same way the widths
// above are — via the generic /preferences key-value endpoint backed by
// V007__ui_preferences.sql — so it survives across devices/reloads too.
function orderPrefKey() {
  const p = store.current();
  return `ledger-column-order-${p.id}`;
}
async function loadColumnOrder() {
  if (!hasProfile()) return null;
  try {
    const res = await fetch(`/api/preferences/${orderPrefKey()}`);
    if (!res.ok) return null;
    const value = await res.json();
    return isValidColumnOrder(value) ? value : null;
  } catch (err) {
    return null;
  }
}
function saveColumnOrder(order) {
  if (!hasProfile()) return;
  fetch(`/api/preferences/${orderPrefKey()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(order),
  }).catch(() => { /* best-effort; the reorder already applied locally */ });
}

function toUtcDisplay(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// A finding's status (ACTIVE / N_A / FALSE_POSITIVE, see
// VulnerabilityStatusService.VALID_STATUSES on the backend) is set via the
// bulk action below and never overwrites the real underlying severity --
// that's still what reverting back to Active would show -- but whenever a
// finding isn't Active, the Severity column displays its status instead.
const STATUS_LABELS = { ACTIVE: 'Active', N_A: 'N/A', FALSE_POSITIVE: 'False Positive' };
function isExcludedStatus(f) { return f.status === 'N_A' || f.status === 'FALSE_POSITIVE'; }
function severityDisplay(f) { return isExcludedStatus(f) ? STATUS_LABELS[f.status] : f.severity; }

// Worker-set severities on the live feed are lowercase (e.g. Go/Python
// findings literally write "info"/"high"), but the aggregated vulnerabilities
// table (and so search results) normalize to uppercase (see
// VulnerabilityNormalizer.normalizeSeverity) -- toUpperCase() here so the
// ledger sorts the same way regardless of which source a row came from.
// Anything that isn't one of the five known severities (including the
// backend's own "UNKNOWN" fallback) ranks just above the excluded-status
// bucket in severityRank below, rather than being treated as critical.
const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
function severityRank(f) {
  if (isExcludedStatus(f)) return Object.keys(SEVERITY_RANK).length + 1;
  const rank = SEVERITY_RANK[String(f.severity || '').toUpperCase()];
  return rank != null ? rank : Object.keys(SEVERITY_RANK).length;
}

function fieldValue(f, key) {
  if (key === 'date') return toUtcDisplay(f.date);
  const v = key === 'severity' ? severityDisplay(f) : f[key];
  return v === undefined || v === null || v === '' ? '-' : String(v);
}

// A finding's full discovered URL/path (ffuf's fuzzed URL, dirsearch's
// path, gau's archived URL, ...) is a clickable link in the Path column --
// see renderRows()/buildRow() below -- only when it actually looks like one;
// a gitleaks file path or a jwt-tool token isn't navigable.
const PATH_LINK_RE = /^https?:\/\//i;

// Column widths are a per-user preference: persisted server-side (so they
// survive across devices/reloads, not just this browser's storage) via the
// generic /preferences key-value endpoint backed by V007__ui_preferences.sql.
async function loadColumnWidths() {
  if (!hasProfile()) return null;
  try {
    const res = await fetch(`/api/preferences/${columnsPrefKey()}`);
    if (!res.ok) return null;
    const widths = await res.json();
    return (widths && typeof widths === 'object') ? widths : null;
  } catch (err) {
    return null;
  }
}

let saveTimer = null;
function saveColumnWidths(widths) {
  if (!hasProfile()) return;
  clearTimeout(saveTimer);
  const key = columnsPrefKey();
  saveTimer = setTimeout(() => {
    fetch(`/api/preferences/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(widths),
    }).catch(() => { /* best-effort; layout still works locally if this fails */ });
  }, 400);
}

export default {
  id: 'ledger',
  css: 'static/ledger.css',
  critical: true,
  mount(container, ctx) {
    container.innerHTML = `
      <div class="ledger-head">
        <span>Vulnerability ledger // <span class="co" id="ledger-co">-</span></span>
        <div class="ledger-head-right">
          <div class="ledger-bulk" id="ledger-bulk" hidden>
            <span id="ledger-bulk-count"></span>
            <button type="button" data-status="ACTIVE">Mark Active</button>
            <button type="button" data-status="N_A">Mark N/A</button>
            <button type="button" data-status="FALSE_POSITIVE">Mark False Positive</button>
            <button type="button" class="ledger-bulk-delete-btn" id="ledger-bulk-delete">Delete</button>
            <span id="ledger-bulk-error" hidden></span>
          </div>
          <span class="tot"><span id="ledger-total"></span><span id="ledger-degraded" hidden> -- search unavailable, showing live feed</span></span>
        </div>
        <div class="col-menu" id="ledger-filter" hidden role="dialog" aria-label="Column filter">
          <div class="col-menu-title" id="ledger-filter-title"></div>
          <div id="ledger-filter-body"></div>
        </div>
      </div>
      <div class="ledger-table-head">
        <table>
          <colgroup id="ledger-colgroup-head"></colgroup>
          <thead><tr id="ledger-header-row"></tr></thead>
        </table>
      </div>
      <div class="ledger-scroll">
        <table>
          <colgroup id="ledger-colgroup"></colgroup>
          <tbody id="ledger-body"></tbody>
        </table>
      </div>`;

    const scroll = container.querySelector('.ledger-scroll');
    const tableHead = container.querySelector('.ledger-table-head');
    const colgroup = container.querySelector('#ledger-colgroup');
    const colgroupHead = container.querySelector('#ledger-colgroup-head');
    const headerRow = container.querySelector('#ledger-header-row');
    // One filter panel for every column, shown under the ledger header so an open
    // menu never changes the table header's size.
    const filterMenu = container.querySelector('#ledger-filter');
    const filterTitle = container.querySelector('#ledger-filter-title');
    const filterBody = container.querySelector('#ledger-filter-body');
    let openFilterKey = null;
    // Clicks inside the panel must not reach the document handler that closes it.
    filterMenu.addEventListener('click', e => e.stopPropagation());
    // active filter values per column; empty set means "no filter, show all"
    const filters = new Map(COLUMNS.map(c => [c.key, new Set()]));
    const selected = new Set();
    const cols = new Map();
    let selectAllBox = null;
    // Elasticsearch-backed search results, set by
    // search.js via the ctx bus. null means "no active search" -- render()
    // then falls back to the normal live state.findings feed, so search
    // is purely additive on top of the existing ledger rather than a
    // replacement data source.
    let searchResults = null;

    // Drag-and-drop reordered column order (see makeSortable below); COLUMNS
    // itself stays the fixed set of definitions, orderedColumns() is the
    // current display order derived from it. Starts from the default and is
    // overwritten once the saved order loads from the backend (see
    // loadLayoutForCurrentProfile below) — same fetch-then-reconcile shape
    // as the column widths.
    let columnOrder = [...DEFAULT_COLUMN_ORDER];
    // 'select' is always first and pinned to SELECT_WIDTH — it's excluded
    // from columnOrder/orderedColumns/resizableKeys entirely, so it can
    // never be dragged out of place or resized away from its predefined
    // size (see buildColgroup below).
    function orderedColumns() {
      return [COLUMNS_BY_KEY.get('select'), ...columnOrder.map(k => COLUMNS_BY_KEY.get(k))];
    }
    function resizableKeys() {
      return columnOrder.filter(k => COLUMNS_BY_KEY.get(k).resizable);
    }

    function findingId(f, i) { return f.id != null ? String(f.id) : String(i); }

    // Puts the filter panel directly under this column's name box, left-aligned
    // with it. The panel sits inside the ledger header, so positions are measured
    // relative to that bar. It is kept inside the bar's right edge, and it never
    // covers the chevrons of other columns, which are in the header row above.
    function placeFilterUnder(th) {
      const head = filterMenu.parentElement.getBoundingClientRect();
      const cell = th.getBoundingClientRect();
      const left = Math.max(0, Math.min(cell.left - head.left, head.width - filterMenu.offsetWidth));
      filterMenu.style.left = left + 'px';
      filterMenu.style.top = (cell.bottom - head.top) + 'px';
    }

    function closeMenus() {
      filterMenu.hidden = true;
      openFilterKey = null;
      headerRow.querySelectorAll('.col-toggle').forEach(b => b.setAttribute('aria-expanded', 'false'));
    }

    // Every column is really two <col> elements, one in each table (see the
    // markup above -- the header is its own non-scrolling table, not part
    // of .ledger-scroll, so its columns can't share a single <colgroup>
    // with the body's). These two helpers are the only places that read or
    // write a column's width from here on, so the pair always stays in
    // sync; everything below calls these instead of touching `cols` itself.
    function setColWidth(key, px) {
      const pair = cols.get(key);
      pair.head.style.width = px + 'px';
      pair.body.style.width = px + 'px';
    }
    function getColWidth(key) {
      return cols.get(key).body.offsetWidth;
    }

    // The body table lives inside a scrolling container -- a vertical
    // scrollbar (~15-17px, OS/browser-dependent) eats into its content
    // width, but the header table doesn't scroll and has no scrollbar of
    // its own doing the same. Without compensating, the header's columns
    // would be slightly wider than the body's and drift out of alignment.
    // Called from buildColgroup() (every layout rebuild) and the
    // ResizeObserver below (window resize, sidebar toggle, zoom, or rows
    // crossing the need-a-scrollbar threshold).
    function syncHeadGutter() {
      tableHead.style.paddingRight = (scroll.offsetWidth - scroll.clientWidth) + 'px';
    }

    function buildColgroup() {
      colgroup.replaceChildren();
      colgroupHead.replaceChildren();
      orderedColumns().forEach(col => {
        const bodyCol = document.createElement('col');
        const headCol = document.createElement('col');
        colgroup.append(bodyCol);
        colgroupHead.append(headCol);
        cols.set(col.key, { head: headCol, body: bodyCol });
      });
      // The select column has no explicit width of its own otherwise — with
      // table-layout: fixed, an unspecified <col> just gets whatever space
      // is left over once every other column's px width is subtracted,
      // which fitColumns/applyWidths/rescaleColumns all already do by
      // reserving SELECT_WIDTH out of `available`. Pinning it here directly
      // makes that explicit instead of implicit, so it can never collapse
      // or balloon to some other size (and overlap/steal the neighboring
      // column's hit area) if that reservation is ever off by a pixel.
      setColWidth('select', SELECT_WIDTH);
      fitColumns();
      syncHeadGutter();
    }

    // Spreads the box's full width evenly across the resizable columns
    // (standardized sizing), so the table never exceeds the ledger box.
    function fitColumns() {
      const keys = resizableKeys();
      const available = Math.max(0, scroll.clientWidth - SELECT_WIDTH);
      const each = Math.max(MIN_WIDTH, Math.floor(available / keys.length));
      keys.forEach((key, i) => {
        const w = i === keys.length - 1 ? available - each * (keys.length - 1) : each;
        setColWidth(key, Math.max(MIN_WIDTH, w));
      });
    }

    // Applies saved relative proportions (arbitrary px "weights" from a
    // previous session/window size) scaled to exactly fill the current box,
    // the same way rescaleColumns keeps a live drag from ever overflowing.
    function applyWidths(widths) {
      const keys = resizableKeys();
      const available = Math.max(0, scroll.clientWidth - SELECT_WIDTH);
      const total = keys.reduce((sum, key) => sum + (Number(widths[key]) || 0), 0);
      if (!available || !total) return false;
      let running = 0;
      keys.forEach((key, i) => {
        const w = i === keys.length - 1
          ? available - running
          : Math.max(MIN_WIDTH, Math.round((Number(widths[key]) || 0) / total * available));
        setColWidth(key, w);
        running += w;
      });
      return true;
    }

    function currentWidths() {
      return Object.fromEntries(resizableKeys().map(key => [key, getColWidth(key)]));
    }

    // Keep proportions the user dragged, but rescale them to keep filling
    // the box exactly whenever the ledger itself is resized (window resize,
    // sidebar toggling, etc.) instead of drifting into overflow.
    let lastFitWidth = 0;
    function rescaleColumns() {
      const keys = resizableKeys();
      const available = Math.max(0, scroll.clientWidth - SELECT_WIDTH);
      if (!available || available === lastFitWidth) return;
      const currentTotal = keys.reduce((sum, key) => sum + getColWidth(key), 0);
      if (!currentTotal) return;
      const scale = available / currentTotal;
      let running = 0;
      keys.forEach((key, i) => {
        const raw = i === keys.length - 1
          ? available - running
          : Math.max(MIN_WIDTH, Math.round(getColWidth(key) * scale));
        setColWidth(key, raw);
        running += raw;
      });
      lastFitWidth = available;
    }
    // A height change (not just width) can reveal more/fewer rows, so the
    // virtualized window needs rebuilding too, not just the column widths.
    // Also re-measure the row height (see measureRowHeight below): a
    // browser zoom change resizes the scroll box and every row's rendered
    // height together, so the previously-measured value could be stale.
    // syncHeadGutter() too: a scrollbar appearing/disappearing (e.g. once
    // enough rows load to need one) changes scroll.clientWidth without
    // necessarily firing for any other reason.
    new ResizeObserver(() => { rowHeightMeasured = false; rescaleColumns(); syncHeadGutter(); renderRows('resize'); }).observe(scroll);

    // Dragging a handle trades width with the next column so the row's
    // total width never changes — resizing can only redistribute space
    // inside the box, never push the table wider than it.
    function startResize(col, e) {
      e.preventDefault();
      // Resizing still works with no profile selected — see hasProfile()
      // above — it just won't be saved (saveColumnWidths no-ops below).
      const keys = resizableKeys();
      const idx = keys.indexOf(col.key);
      const neighborKey = keys[idx + 1];
      if (!neighborKey) return;
      const startX = e.clientX;
      const startWidth = getColWidth(col.key);
      const startNeighborWidth = getColWidth(neighborKey);
      const pairTotal = startWidth + startNeighborWidth;
      function onMove(ev) {
        const rawDelta = ev.clientX - startX;
        const delta = Math.max(MIN_WIDTH - startWidth, Math.min(pairTotal - MIN_WIDTH - startWidth, rawDelta));
        setColWidth(col.key, startWidth + delta);
        setColWidth(neighborKey, startNeighborWidth - delta);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveColumnWidths(currentWidths());
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function buildHeader() {
      headerRow.replaceChildren();
      const keys = resizableKeys();
      orderedColumns().forEach(col => {
        const th = document.createElement('th');
        th.className = 'col-' + col.key;
        if (col.key === 'select') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'select-box';
          btn.setAttribute('aria-label', 'Select all visible rows');
          btn.addEventListener('click', () => {
            const allSelected = lastRowIds.length > 0 && lastRowIds.every(id => selected.has(id));
            if (allSelected) selected.clear();
            else lastRowIds.forEach(id => selected.add(id));
            render();
          });
          selectAllBox = btn;
          th.append(btn);
          headerRow.append(th);
          return;
        }
        // Reorderable via drag-and-drop, like the links sidebar — see
        // makeSortable(headerRow, ...) below. The select column above is
        // excluded/left undraggable so it always stays leading.
        th.draggable = true;
        th.dataset.id = col.key;
        // The name box is the drag surface; only the ">_" button inside it
        // opts out (draggable=false), so clicking it to open the filter
        // menu never gets swallowed by — or itself starts — a column drag.
        const head = document.createElement('span');
        head.className = 'col-head';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'col-toggle';
        btn.draggable = false;
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', `Filter ${col.label}`);
        btn.innerHTML = `<span class="chevron" aria-hidden="true">&gt;</span>`;
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const willOpen = filterMenu.hidden || openFilterKey !== col.key;
          closeMenus();
          if (willOpen) {
            filterTitle.textContent = 'Filter: ' + col.label;
            renderMenu(col, filterBody);
            filterMenu.hidden = false;
            placeFilterUnder(btn.closest('th'));
            openFilterKey = col.key;
            btn.setAttribute('aria-expanded', 'true');
          }
        });
        const label = document.createElement('span');
        label.className = 'col-label';
        label.textContent = col.label;
        head.append(btn, label);
        th.append(head);
        // The last column has nothing to its right to trade width with, so
        // it gets no drag handle — it simply absorbs whatever space its
        // neighbor's resizing leaves behind.
        if (col.resizable && col.key !== keys[keys.length - 1]) {
          const handle = document.createElement('span');
          handle.className = 'col-resize-handle';
          // Not itself a drag source: without this, a mousedown here would
          // be picked up by the th's own draggable=true (column reordering)
          // instead of starting the width-resize drag below.
          handle.draggable = false;
          handle.addEventListener('mousedown', e => startResize(col, e));
          th.append(handle);
        }
        headerRow.append(th);
      });
    }

    // Column order itself is drag-and-drop reorderable, same principle (and
    // FLIP move animation) as the links sidebar — see dragReorder.js. Runs
    // horizontally since header cells sit in a single row. The select
    // column is excluded (see resizableKeys/orderedColumns above and the
    // itemSelector below), so it never becomes a drag source or a drop
    // target and always stays leading, at its pinned width.
    makeSortable(headerRow, ids => {
      // Capture pixel widths before the rebuild and reapply them after, so
      // reordering columns doesn't also reset everyone's carefully dragged
      // widths back to an even split (buildColgroup's own fitColumns() call
      // is only the fallback for when there's nothing to restore).
      const widths = currentWidths();
      columnOrder = ids;
      saveColumnOrder(columnOrder);
      buildColgroup();
      applyWidths(widths);
      buildHeader();
      render();
    }, { itemSelector: 'th[draggable="true"]', locate: locateHorizontal });

    function renderMenu(col, menu) {
      menu.replaceChildren();
      const source = searchResults !== null ? searchResults : state.findings;
      const values = [...new Set(source.map(f => fieldValue(f, col.key)))].sort();
      if (!values.length) {
        const empty = document.createElement('div');
        empty.className = 'col-menu-empty';
        empty.textContent = 'no values';
        menu.append(empty);
        return;
      }
      const active = filters.get(col.key);
      values.forEach(v => {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = active.has(v);
        cb.addEventListener('change', () => {
          if (cb.checked) active.add(v); else active.delete(v);
          render();
        });
        label.append(cb, document.createTextNode(v));
        menu.append(label);
      });
    }

    document.addEventListener('click', () => closeMenus());

    let lastRowIds = [];
    // The full filtered+sorted finding list behind the current render --
    // kept around so a pure scroll (no filter/data change) can recompute
    // just the visible window (renderRows()) without re-filtering/re-sorting
    // everything again (render() below does that part, once).
    let sortedCache = [];

    // Nominally matches ledger.css's `.ledger td { height: 32px; ...
    // border-bottom: 1px... }` -- every row is this same fixed height (no
    // wrapping text, see that rule's overflow/white-space), which is what
    // makes virtualizing the rows below possible at all. This hand-computed
    // guess (32 + 1 for the collapsed border) is only the seed value,
    // though: border-collapse's exact effect on a row's rendered height is
    // easy to get a pixel off, and that's enough to make the ledger
    // visibly jitter while scrolling -- every renderRows() call sizes its
    // spacer rows from this constant, so a wrong constant makes
    // scroll.scrollHeight drift a little on every single re-render, which
    // in turn nudges the scrollbar-thumb-driven scrollTop, which triggers
    // another re-render... measureRowHeight() below corrects it to the
    // real rendered height the first chance it gets (an actual row exists
    // in the DOM), after which it's a stable, re-used value -- no more
    // drift to feed a loop with.
    let ROW_HEIGHT = 33;
    let rowHeightMeasured = false;
    function measureRowHeight(body) {
      if (rowHeightMeasured) return;
      const sample = body.querySelector('tr:not([aria-hidden])');
      if (!sample) return;
      const h = sample.getBoundingClientRect().height;
      if (h) {
        ROW_HEIGHT = h;
        rowHeightMeasured = true;
      }
    }
    const ROW_BUFFER = 8; // extra rows rendered above/below the viewport, so a fast scroll/fling doesn't outrun the next frame's render

    function updateSelectAllBox() {
      if (!selectAllBox) return;
      const allSelected = lastRowIds.length > 0 && lastRowIds.every(id => selected.has(id));
      selectAllBox.setAttribute('aria-pressed', String(allSelected));
      selectAllBox.textContent = allSelected ? '[x]' : '[ ]';
    }

    // Bulk status action: select rows via their checkboxes (above), then one
    // of these three buttons sets ACTIVE / N_A / FALSE_POSITIVE on every
    // selected finding's underlying vulnerability record (looked up by
    // vulnKey, which every finding now carries -- see
    // VulnerabilityStatusService on the backend and toLedgerFinding in
    // search.js). The bar itself only shows once something is selected.
    const bulkBar = container.querySelector('#ledger-bulk');
    const bulkCount = container.querySelector('#ledger-bulk-count');
    const bulkError = container.querySelector('#ledger-bulk-error');
    const deleteBtn = container.querySelector('#ledger-bulk-delete');
    // Same two-click confirm as vuln-card.js's single-row delete, rather than
    // a native confirm() dialog -- reset any time the selection or bar
    // visibility changes (updateBulkBar runs on every checkbox toggle and
    // after every bulk action), so a stale "click again" never lingers
    // across a changed selection.
    let deleteConfirming = false;
    function resetDeleteConfirm() {
      deleteConfirming = false;
      if (deleteBtn) deleteBtn.textContent = 'Delete';
    }
    function updateBulkBar() {
      if (!bulkBar) return;
      bulkBar.hidden = selected.size === 0;
      bulkCount.textContent = selected.size + ' selected';
      resetDeleteConfirm();
    }
    function selectedVulnKeys() {
      // Selected ids come from whichever source was on screen when checked
      // (search results or the live feed) -- look in both, since switching
      // between them doesn't clear a prior selection.
      const pool = [...state.findings, ...(searchResults || [])];
      const keys = new Set();
      pool.forEach((f, i) => {
        if (selected.has(findingId(f, i)) && f.vulnKey) keys.add(f.vulnKey);
      });
      return [...keys];
    }
    // bulkError now lives inline in the header (see .ledger-head-right) and
    // truncates with an ellipsis instead of wrapping onto its own line (see
    // ledger.css) -- the title attribute carries the full text as a hover
    // tooltip for whenever it's cut off.
    function setBulkError(text) {
      bulkError.hidden = false;
      bulkError.textContent = text;
      bulkError.title = text;
    }
    async function setSelectedStatus(status) {
      const vulnKeys = selectedVulnKeys();
      if (!vulnKeys.length) return;
      bulkError.hidden = true;
      try {
        const res = await fetch('/api/vulnerabilities/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vulnKeys, status }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        // Optimistic local update -- same vulnKey can appear in both
        // state.findings and searchResults (live feed vs. search view of
        // the same underlying vulnerability), so both are patched rather
        // than waiting for the next poll/search to pick up the change.
        const keySet = new Set(vulnKeys);
        [state.findings, searchResults || []].forEach(list =>
          list.forEach(f => { if (keySet.has(f.vulnKey)) f.status = status; }));
        selected.clear();
        render();
      } catch (err) {
        setBulkError('failed to update status');
      }
    }
    // Permanently tombstones every selected finding's underlying
    // vulnerability. Same two-click confirm and wording as the single-row
    // delete in vuln-card.js -- this is the bulk equivalent of that same
    // action, just against DELETE /api/vulnerabilities/{vulnKey} once per
    // selected vulnKey, since there's no bulk delete route on the backend.
    async function deleteSelected() {
      const vulnKeys = selectedVulnKeys();
      if (!vulnKeys.length) return;
      if (!deleteConfirming) {
        deleteConfirming = true;
        deleteBtn.textContent = 'Click again to confirm delete';
        setBulkError('This permanently removes the record. It will not come back, even on a reload or a future re-scan.');
        return;
      }
      deleteBtn.disabled = true;
      setBulkError('Deleting…');
      try {
        const results = await Promise.allSettled(vulnKeys.map(vulnKey =>
          fetch(`/api/vulnerabilities/${encodeURIComponent(vulnKey)}`, { method: 'DELETE' })
            .then(res => { if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status); })
        ));
        if (results.some(r => r.status === 'rejected')) throw new Error('one or more deletes failed');
        // Same both-lists patch as setSelectedStatus above, but a removal
        // instead of an in-place field update. Clearing `selected` and
        // hiding the bulk bar (via updateBulkBar, inside render()) is this
        // view's equivalent of vuln-card.js's closeDialog() after a
        // successful delete there.
        const keySet = new Set(vulnKeys);
        state.findings = state.findings.filter(f => !keySet.has(f.vulnKey));
        if (searchResults) searchResults = searchResults.filter(f => !keySet.has(f.vulnKey));
        selected.clear();
        bulkError.hidden = true;
        deleteBtn.disabled = false;
        render();
      } catch (err) {
        setBulkError('Failed to delete.');
        deleteBtn.disabled = false;
        resetDeleteConfirm();
      }
    }
    if (bulkBar) {
      bulkBar.querySelectorAll('button[data-status]').forEach(btn => {
        btn.addEventListener('click', () => setSelectedStatus(btn.dataset.status));
      });
      if (deleteBtn) deleteBtn.addEventListener('click', deleteSelected);
    }

    function buildRow(f, id) {
      const tr = document.createElement('tr');
      orderedColumns().forEach(col => {
        const td = document.createElement('td');
        td.className = 'col-' + col.key;
        if (col.key === 'select') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'select-box';
          const checked = selected.has(id);
          btn.setAttribute('aria-pressed', String(checked));
          btn.setAttribute('aria-label', 'Select row');
          btn.textContent = checked ? '[x]' : '[ ]';
          // Toggling one row's checkbox only ever changes that row and the
          // header's "select all" state -- never the rest of the ledger --
          // so this updates both directly instead of going through the full
          // render(), which would otherwise re-filter/re-sort/rebuild the
          // whole visible window just to flip one button.
          btn.addEventListener('click', () => {
            selected.has(id) ? selected.delete(id) : selected.add(id);
            const nowChecked = selected.has(id);
            btn.setAttribute('aria-pressed', String(nowChecked));
            btn.textContent = nowChecked ? '[x]' : '[ ]';
            updateSelectAllBox();
            updateBulkBar();
          });
          td.append(btn);
        } else if (col.key === 'path') {
          // A full discovered URL is a real link (clicking it, with either
          // mouse button, opens it in a new tab -- target="_blank" covers
          // the left click, and a plain <a href> already gets the browser's
          // native "open in new tab"/"copy link" on a right click for
          // free); a gitleaks file path or jwt-tool token isn't navigable,
          // so those stay plain text. Truncation to the column's width is
          // the same overflow:hidden/text-overflow:ellipsis every other
          // column already gets from ledger.css -- the link doesn't grow
          // the cell, it just gets clipped like any other long cell value.
          const text = fieldValue(f, col.key);
          td.title = text;
          if (text !== '-' && PATH_LINK_RE.test(text)) {
            const a = document.createElement('a');
            a.href = text;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = text;
            a.className = 'path-link';
            td.append(a);
          } else {
            td.textContent = text;
          }
        } else {
          const text = fieldValue(f, col.key);
          td.textContent = text;
          td.title = text;
          // "N/A" slugifies to "n-a" so it's a valid CSS class token -- see
          // the .sev.n-a / .sev.false-positive rules in ledger.css.
          if (col.key === 'severity') td.classList.add('sev', text.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        }
        tr.append(td);
      });
      // Opens the vulnerability card for this row -- except a click on the
      // select checkbox (its own toggle, handled above) or a Path link
      // (opens the URL instead), neither of which should also pop the card.
      tr.addEventListener('click', e => {
        if (e.target.closest('.select-box') || e.target.closest('a.path-link')) return;
        openVulnCard(f, {
          onStatusChanged: (key, status) => {
            [state.findings, searchResults || []].forEach(list => {
              list.forEach(item => { if (item.vulnKey === key) item.status = status; });
            });
            render();
          },
          onDeleted: key => {
            [state.findings, searchResults].forEach(list => {
              if (!list) return;
              const idx = list.findIndex(item => item.vulnKey === key);
              if (idx !== -1) list.splice(idx, 1);
            });
            render();
          },
        });
      });
      return tr;
    }

    function spacerRow(height) {
      const tr = document.createElement('tr');
      tr.setAttribute('aria-hidden', 'true');
      const td = document.createElement('td');
      td.colSpan = orderedColumns().length;
      td.style.height = height + 'px';
      td.style.padding = '0';
      td.style.border = '0';
      tr.append(td);
      return tr;
    }

    // Renders only the rows currently scrolled into view (+ ROW_BUFFER on
    // each side), padded above/below by two spacer rows so the scrollbar
    // still reflects the full list's true height. This is what keeps the
    // DOM bounded to a small, constant number of rows no matter how many
    // findings there are -- re-run on every scroll tick (see the listener
    // below) and after render() recomputes sortedCache/lastRowIds.
    //
    // lastRenderedStart/End/Total guard against rebuilding when the visible
    // window hasn't actually changed -- this turned out to be the real
    // cause of the scroll jitter, not row-height drift or the sticky
    // header: replacing #ledger-body's content, even with the exact same
    // rows, still mutates a scrollable container's DOM, and that alone is
    // enough for the browser's own scroll-anchoring recalculation to fire
    // another 'scroll' event on it with no actual position change -- which
    // re-entered this function via the scroll listener below, rebuilt
    // again, and fired again, forever, independent of any real user input
    // (confirmed live: scrollTop stayed 0 across hundreds of consecutive
    // "source: scroll" calls). Skipping the rebuild when start/end/total
    // are unchanged makes a no-op scroll genuinely a no-op: no DOM
    // mutation, so nothing left to keep re-triggering itself.
    let lastRenderedStart = -1, lastRenderedEnd = -1, lastRenderedTotal = -1;
    function renderRows(source) {
      const total = sortedCache.length;
      let start = 0, end = 0;

      if (total > 0) {
        const viewportH = scroll.clientHeight || 0;
        const scrollTop = scroll.scrollTop || 0;
        start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - ROW_BUFFER);
        const visibleCount = Math.ceil(viewportH / ROW_HEIGHT) + ROW_BUFFER * 2;
        end = Math.min(total, start + visibleCount);
      }

      // Only "scroll" is safe to skip outright: a scroll tick can't itself
      // have changed sortedCache's contents, so an unchanged window really
      // is a no-op. "render" (data/filter/sort changed) and "resize" always
      // rebuild -- the window looking the same doesn't mean the rows in it
      // do, e.g. a poll updating a finding's own fields in place.
      if (source === 'scroll' && start === lastRenderedStart && end === lastRenderedEnd && total === lastRenderedTotal) return;
      lastRenderedStart = start; lastRenderedEnd = end; lastRenderedTotal = total;

      const body = container.querySelector('#ledger-body');
      body.replaceChildren();

      if (total > 0) {
        if (start > 0) body.append(spacerRow(start * ROW_HEIGHT));
        for (let i = start; i < end; i++) {
          body.append(buildRow(sortedCache[i], lastRowIds[i]));
        }
        if (end < total) body.append(spacerRow((total - end) * ROW_HEIGHT));
        measureRowHeight(body);
      }

      // TEMPORARY DIAGNOSTIC -- remove once the scroll-jitter bug is found.
      // Unconditional (runs even when total is 0) and tagged with which
      // caller triggered this render, so a runaway loop shows up as a flood
      // of lines all from the same source instead of looking ambiguous.
      window.__ledgerDebugCount = (window.__ledgerDebugCount || 0) + 1;
      window.__ledgerDebugLast = window.__ledgerDebugLast || 0;
      if (performance.now() - window.__ledgerDebugLast > 120) {
        window.__ledgerDebugLast = performance.now();
        console.log('[ledger-debug]', {
          n: window.__ledgerDebugCount,
          source: source || '?',
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight,
          headHeight: container.querySelector('.ledger-head').getBoundingClientRect().height,
          ROW_HEIGHT, start, end, total,
        });
      }

      if (!total) {
        const tr = document.createElement('tr');
        tr.className = 'empty';
        const c = document.createElement('td');
        c.colSpan = COLUMNS.length; c.style.maxWidth = 'none';
        c.textContent = '-- no entries recorded --';
        tr.append(c); body.append(tr);
      }
      for (let i = Math.max(total, 1); i < 14; i++) {
        const tr = document.createElement('tr');
        for (let j = 0; j < COLUMNS.length; j++) tr.append(document.createElement('td'));
        body.append(tr);
      }
    }

    // Coalesces scroll events to at most one renderRows() per animation
    // frame -- a fast fling/scrollwheel burst fires far more scroll events
    // than frames, and rebuilding the visible window once per frame (rather
    // than once per event) is what keeps rows from visibly lagging behind
    // the scroll position.
    let scrollScheduled = false;
    scroll.addEventListener('scroll', () => {
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(() => {
        scrollScheduled = false;
        renderRows('scroll');
      });
    }, { passive: true });

    function render() {
      const findings = searchResults !== null ? searchResults : state.findings;
      const cur = store.current();
      container.querySelector('#ledger-co').textContent = cur ? cur.name : 'no profile selected';

      const visibleFindings = findings.filter(f => COLUMNS.every(col => {
        if (col.key === 'select') return true;
        const active = filters.get(col.key);
        return active.size === 0 || active.has(fieldValue(f, col.key));
      }));

      container.querySelector('#ledger-total').textContent = visibleFindings.length + ' ' + (visibleFindings.length === 1 ? 'entry' : 'entries')
        + (visibleFindings.length !== findings.length ? ` (of ${findings.length})` : '');

      // Highest severity first (critical down to info); N/A and False
      // Positive sink below every real severity, including info, regardless
      // of how severe the underlying finding was -- see severityRank above.
      // Date-desc is still the tiebreaker within identical severity/status.
      sortedCache = visibleFindings.slice().sort((a, b) => {
        return (severityRank(a) - severityRank(b)) || (b.date || '').localeCompare(a.date || '');
      });
      lastRowIds = sortedCache.map((f, i) => findingId(f, i));

      renderRows('render');
      updateSelectAllBox();
      updateBulkBar();
    }

    // Order and widths are fetched together and applied in that sequence —
    // order first (it decides which key is "last" and needs a resize
    // handle), widths second — instead of two independent promises racing
    // to rebuild the colgroup/header and potentially clobbering each other
    // (e.g. widths landing first, then a later-resolving order rebuilding
    // the colgroup via its own fitColumns() fallback and discarding them).
    function loadLayoutForCurrentProfile() {
      Promise.all([loadColumnOrder(), loadColumnWidths()]).then(([order, widths]) => {
        if (order) columnOrder = order;
        buildColgroup();
        buildHeader();
        if (!widths || !applyWidths(widths)) fitColumns();
        render();
      });
    }

    buildColgroup();
    buildHeader();
    subscribe(render);

    const degradedBanner = container.querySelector('#ledger-degraded');
    if (ctx) {
      ctx.on('vuln-search', ({ results, degraded }) => {
        searchResults = results;
        degradedBanner.hidden = !degraded;
        render();
      });
      ctx.on('vuln-search-clear', () => {
        searchResults = null;
        degradedBanner.hidden = true;
        render();
      });
    }

    // Each company profile keeps its own column layout: reload it whenever
    // the selected profile changes, in addition to the normal re-render.
    let lastProfileId = store.profileId;
    store.subscribe(() => {
      render();
      if (store.profileId === lastProfileId) return;
      lastProfileId = store.profileId;
      columnOrder = [...DEFAULT_COLUMN_ORDER];
      buildColgroup();
      buildHeader();
      loadLayoutForCurrentProfile();
    });
    render();

    loadLayoutForCurrentProfile();
  },
};
