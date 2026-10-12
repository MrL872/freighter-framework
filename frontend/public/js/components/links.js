import { store } from '../store.js';
import { makeSortable } from '../dragReorder.js';
import { linksGrouping } from '../linksGrouping.js';

// One worker directory under /workers in the repo == one entry here. Kept
// as a manual list (like data.js's other placeholder state) until workers
// are discoverable from the backend at runtime. This is only the DEFAULT
// grouping/order — the user can drag links and whole groups around, and
// that customized order then wins (see loadCachedOrder/persistOrder).
const DEFAULT_GROUPS = [
  { name: 'Content Discovery', workers: ['dirsearch-worker', 'ffuf-worker', 'gau-worker', 'katana-worker'] },
  { name: 'Recon', workers: ['subfinder-worker', 'puredns-worker', 'shuffledns-worker', 'masscan-worker', 'nmap-worker', 'gowitness-worker', 'wafw00f-worker'] },
  { name: 'Vulnerability Scanning', workers: ['nuclei-worker', 'gitleaks-worker'] },
  { name: 'Exploitation', workers: ['metasploit-worker'] },
  { name: 'Vulnerability Specific Tools', workers: ['xsstrike-worker', 'sqlmap-worker', 'hydra-worker', 'wpscan-worker', 'sstimap-worker', 'nosqlmap-worker', 'jwt-tool-worker', 'fuxploider-worker'] },
];

function linkBtn(name) {
  return `<li draggable="true" data-id="${name}"><button type="button" class="link-btn" data-worker="${name}" title="${name}"><span class="glyph">#</span><span class="link-label">${name}</span></button></li>`;
}

// Order survives more than a page reload — it's mirrored to a Derby-backed
// preference on the backend (see PreferencesController), so it also
// survives a backend restart or crash, not just this browser's local
// storage. localStorage still doubles as an instant local cache: it renders
// immediately on mount while the backend read is in flight, and as the
// fallback if that backend is unreachable.
//
// Both are scoped to the selected company profile — each profile gets its
// own link order — falling back to an unscoped key when no profile is
// selected yet.
function hasProfile() { return !!store.current(); }
function profileSuffix() {
  const p = store.current();
  return p ? `-${p.id}` : '';
}
function orderKey() { return 'fr-links-order' + profileSuffix(); }
function prefUrl() { return '/api/preferences/links-order' + profileSuffix(); }

function isValidOrder(v) {
  return v && Array.isArray(v.groupOrder) && v.itemsByGroup && typeof v.itemsByGroup === 'object' && Array.isArray(v.flatOrder);
}

function defaultOrder() {
  return {
    groupOrder: DEFAULT_GROUPS.map(g => g.name),
    itemsByGroup: Object.fromEntries(DEFAULT_GROUPS.map(g => [g.name, [...g.workers]])),
    flatOrder: DEFAULT_GROUPS.flatMap(g => g.workers),
  };
}

// A saved order (local or remote) was captured at some point in the past —
// any worker added to DEFAULT_GROUPS since then (like wafw00f-worker joining
// Recon) is simply missing from it, so it would otherwise silently vanish
// from the sidebar for anyone who has ever dragged a link, forever, even
// after this file adds it. Patches a saved order in place to match
// DEFAULT_GROUPS' current set of groups/workers — adding anything missing
// and removing anything not in DEFAULT_GROUPS (a tool removed entirely, or
// moved to a different group) — and returns whether it actually changed
// anything. Existing customizations (manual drag order) among what's left
// are untouched either way.
function reconcileWithDefaults(order) {
  let changed = false;
  const defaultGroupNames = new Set(DEFAULT_GROUPS.map(g => g.name));
  const allDefaultWorkers = new Set(DEFAULT_GROUPS.flatMap(g => g.workers));
  const workersByGroup = new Map(DEFAULT_GROUPS.map(g => [g.name, new Set(g.workers)]));

  for (const group of DEFAULT_GROUPS) {
    if (!order.groupOrder.includes(group.name)) {
      order.groupOrder.push(group.name);
      changed = true;
    }
    if (!order.itemsByGroup[group.name]) {
      order.itemsByGroup[group.name] = [...group.workers];
      changed = true;
    } else {
      for (const worker of group.workers) {
        if (!order.itemsByGroup[group.name].includes(worker)) {
          order.itemsByGroup[group.name].push(worker);
          changed = true;
        }
      }
    }
    for (const worker of group.workers) {
      if (!order.flatOrder.includes(worker)) {
        order.flatOrder.push(worker);
        changed = true;
      }
    }
  }

  // Prune groups removed from DEFAULT_GROUPS entirely.
  const prunedGroupOrder = order.groupOrder.filter(name => defaultGroupNames.has(name));
  if (prunedGroupOrder.length !== order.groupOrder.length) {
    order.groupOrder = prunedGroupOrder;
    changed = true;
  }
  for (const name of Object.keys(order.itemsByGroup)) {
    if (!defaultGroupNames.has(name)) {
      delete order.itemsByGroup[name];
      changed = true;
    }
  }

  // Prune workers that do not belong to any current group — either the
  // tool was removed entirely, or it moved to a different group (in which
  // case the loop above already re-added it under its new group).
  for (const [name, workers] of Object.entries(order.itemsByGroup)) {
    const allowed = workersByGroup.get(name);
    const prunedWorkers = workers.filter(w => allowed.has(w));
    if (prunedWorkers.length !== workers.length) {
      order.itemsByGroup[name] = prunedWorkers;
      changed = true;
    }
  }
  const prunedFlat = order.flatOrder.filter(w => allDefaultWorkers.has(w));
  if (prunedFlat.length !== order.flatOrder.length) {
    order.flatOrder = prunedFlat;
    changed = true;
  }

  return changed;
}

function loadCachedOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(orderKey()));
    if (isValidOrder(saved)) {
      reconcileWithDefaults(saved);
      return saved;
    }
  } catch (e) { /* ignore */ }
  return defaultOrder();
}

async function fetchRemoteOrder() {
  try {
    const res = await fetch(prefUrl(), { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const value = await res.json();
    return isValidOrder(value) ? value : null;
  } catch (e) {
    return null;
  }
}

// Two failure modes let a drag silently fail to survive a reload if not
// guarded against:
//  1. A reload/navigation right after a drop otherwise cancels whatever PUT
//     is still in flight — `keepalive` tells the browser to send it anyway
//     instead of aborting it with the page.
//  2. Dragging several things in quick succession fires one PUT per drop;
//     without ordering, a later save's response can resolve before an
//     earlier one's, so the earlier (stale) request would win and silently
//     revert the backend to an older snapshot. `saveChain` serializes them
//     so each PUT only starts once the previous one has finished, so the
//     last drop always lands last.
let saveChain = Promise.resolve();
function persistOrder(order) {
  // No profile selected: dragging is still allowed as a live demo (see
  // bindListEvents' makeSortable calls), but there's nothing to scope a
  // saved customization to — it's a temporary session a reload would lose
  // anyway — so skip persisting it, both locally and to the backend.
  if (!hasProfile()) return;
  try { localStorage.setItem(orderKey(), JSON.stringify(order)); } catch (e) { /* ignore */ }
  const body = JSON.stringify(order);
  const url = prefUrl();
  // Best-effort: the drag already applied locally and to localStorage above,
  // so a slow/unreachable backend never blocks or breaks the UI.
  saveChain = saveChain.then(() => fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
    signal: AbortSignal.timeout(5000),
  })).catch(() => { /* ignore — local copy still applies this session; also
    guarantees the chain advances past a failed/timed-out request instead of
    stalling every save queued behind it */ });
}

export default {
  id: 'links',
  css: 'static/links.css',
  critical: false,
  mount(container, ctx) {
    let openGroups = new Set();
    try { openGroups = new Set(JSON.parse(localStorage.getItem('fr-links-open-groups') || '[]')); } catch (e) { /* ignore */ }
    const saveOpenGroups = () => { try { localStorage.setItem('fr-links-open-groups', JSON.stringify([...openGroups])); } catch (e) { /* ignore */ } };

    // `order` is mutated in place by drag handlers below and re-persisted
    // (both locally and to the backend) on every drop — see persistOrder().
    // It's re-populated in place (not reassigned) on profile switches too,
    // via the store.subscribe handler below. With no profile selected,
    // there's nothing to scope a customization to, so it always starts from
    // the default order (instead of some unscoped cache) — dragging still
    // works from there as a demo, it just won't be saved (see persistOrder).
    const order = hasProfile() ? loadCachedOrder() : defaultOrder();
    const saveOrder = () => persistOrder(order);

    function renderList() {
      if (!linksGrouping.grouped) {
        return `<ul id="links-list">${order.flatOrder.map(linkBtn).join('')}</ul>`;
      }
      return `<ul id="links-list">${order.groupOrder.map(name => {
        const open = openGroups.has(name);
        const workers = order.itemsByGroup[name] || [];
        return `
          <li class="link-group" draggable="true" data-id="${name}">
            <button type="button" class="link-group-head" aria-expanded="${open}" data-group="${name}">
              <span class="glyph">&gt;</span><span class="link-label">${name}</span>
            </button>
            <div class="link-group-items-wrap${open ? ' open' : ''}"${open ? '' : ' inert'}>
              <ul class="link-group-items">${workers.map(linkBtn).join('')}</ul>
            </div>
          </li>`;
      }).join('')}</ul>`;
    }

    function render() {
      container.querySelector('.links-body').innerHTML = renderList();
      bindListEvents();
    }

    function bindListEvents() {
      const listEl = container.querySelector('#links-list');
      listEl.addEventListener('click', e => {
        const groupHead = e.target.closest('.link-group-head');
        if (groupHead) {
          const name = groupHead.dataset.group;
          const nowOpen = !openGroups.has(name);
          nowOpen ? openGroups.add(name) : openGroups.delete(name);
          saveOpenGroups();
          // Toggle in place (rather than a full render()) so the height
          // transition below actually has an existing element to animate —
          // a freshly re-created one would just appear in its end state.
          groupHead.setAttribute('aria-expanded', String(nowOpen));
          const wrap = groupHead.nextElementSibling;
          wrap.classList.toggle('open', nowOpen);
          wrap.toggleAttribute('inert', !nowOpen);
          return;
        }
        const btn = e.target.closest('.link-btn');
        if (!btn) return;
        container.querySelectorAll('.link-btn[aria-current]').forEach(b => b.removeAttribute('aria-current'));
        btn.setAttribute('aria-current', 'true');
        ctx.emit('worker:open', btn.dataset.worker);
      });

      // Dragging always works, profile or not — with none selected it's
      // just a live demo of the feature: the reorder still applies and
      // animates locally (see render() above), but saveOrder()/persistOrder
      // below no-ops without a profile to scope it to, so nothing survives
      // a reload or a profile switch.
      if (linksGrouping.grouped) {
        makeSortable(listEl, ids => { userReordered = true; order.groupOrder = ids; saveOrder(); });
        listEl.querySelectorAll('.link-group-items').forEach(itemsEl => {
          const groupName = itemsEl.closest('.link-group').dataset.id;
          makeSortable(itemsEl, ids => { userReordered = true; order.itemsByGroup[groupName] = ids; saveOrder(); });
        });
      } else {
        makeSortable(listEl, ids => { userReordered = true; order.flatOrder = ids; saveOrder(); });
      }
    }

    // True once the user drags anything this session, so a slow backend
    // read that resolves afterwards can't clobber a fresh local drag with
    // stale remote data.
    let userReordered = false;

    container.innerHTML = `
      <div class="links-head">
        <button id="links-toggle" aria-expanded="false" aria-controls="links-list" title="Expand links" aria-label="Toggle links sidebar">&raquo;</button>
        <h2 class="pane-title">Links</h2>
      </div>
      <div class="links-body"></div>
      <div class="links-storage">
        <button type="button" class="link-btn" id="image-folder-link" title="Image Storage">
          <span class="glyph" aria-hidden="true"><img src="icons/icons8-camera-24.png" alt="" width="16" height="16"></span><span class="link-label">Image Storage</span>
        </button>
        <button type="button" class="link-btn" id="project-folder-link" title="Project Folder">
          <span class="glyph" aria-hidden="true"><img src="icons/icons8-folder-24.png" alt="" width="16" height="16"></span><span class="link-label">Project Folder</span>
        </button>
      </div>`;
    render();

    // The two links outside the group/worker list — each opens a
    // per-profile storage page (see showImageFolder()/showProjectFolder()
    // in index.js) rather than a worker view, so they get their own events
    // instead of 'worker:open'.
    const imageFolderLink = container.querySelector('#image-folder-link');
    imageFolderLink.addEventListener('click', () => {
      container.querySelectorAll('.link-btn[aria-current]').forEach(b => b.removeAttribute('aria-current'));
      imageFolderLink.setAttribute('aria-current', 'true');
      ctx.emit('imageStorage:open');
    });

    const projectFolderLink = container.querySelector('#project-folder-link');
    projectFolderLink.addEventListener('click', () => {
      container.querySelectorAll('.link-btn[aria-current]').forEach(b => b.removeAttribute('aria-current'));
      projectFolderLink.setAttribute('aria-current', 'true');
      ctx.emit('storage:open');
    });

    // Render instantly from the local cache above, then reconcile with the
    // backend's durable copy once it resolves (it may differ if the order
    // was last changed from another session/device, or localStorage here
    // was cleared).
    function reconcileWithRemote() {
      if (!hasProfile()) return;
      fetchRemoteOrder().then(remote => {
        if (!remote || userReordered) return;
        order.groupOrder = remote.groupOrder;
        order.itemsByGroup = remote.itemsByGroup;
        order.flatOrder = remote.flatOrder;
        // The backend's saved copy can be just as stale as localStorage's
        // (see reconcileWithDefaults above) -- patch it the same way, and
        // persist the patched result so it doesn't need re-patching on every
        // future read, from this or any other session.
        if (reconcileWithDefaults(order)) saveOrder();
        try { localStorage.setItem(orderKey(), JSON.stringify(order)); } catch (e) { /* ignore */ }
        render();
      });
    }
    reconcileWithRemote();

    // Each company profile has its own link order. Reload it (cache first,
    // then reconcile with the backend) whenever the selected profile changes.
    let lastProfileId = store.profileId;
    store.subscribe(() => {
      if (store.profileId === lastProfileId) return;
      lastProfileId = store.profileId;
      userReordered = false;
      const cached = hasProfile() ? loadCachedOrder() : defaultOrder();
      order.groupOrder = cached.groupOrder;
      order.itemsByGroup = cached.itemsByGroup;
      order.flatOrder = cached.flatOrder;
      render();
      reconcileWithRemote();
    });

    // Toggling itself happens in menu.js (via linksGrouping.toggle()), since
    // that's also what keeps the [ view ] menu's own label in sync — this
    // just re-renders once the shared flag has already flipped.
    ctx.on('links:group', () => { render(); });

    container.classList.add('collapsed');
    const toggle = container.querySelector('#links-toggle');
    function setExpanded(expanded) {
      container.classList.toggle('collapsed', !expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.innerHTML = expanded ? '&laquo;' : '&raquo;';
      toggle.title = expanded ? 'Collapse links' : 'Expand links';
      try { localStorage.setItem('fr-links', expanded ? '1' : '0'); } catch (e) { /* ignore */ }
    }
    toggle.addEventListener('click', () => setExpanded(container.classList.contains('collapsed')));
    ctx.on('links:toggle', () => setExpanded(container.classList.contains('collapsed')));
    try { if (localStorage.getItem('fr-links') === '1') setExpanded(true); } catch (e) { /* ignore */ }
  },
};
