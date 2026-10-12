// Shared data module for metrics + ledger components. A single fetch/poll
// loop backs both, instead of each component polling the backend itself.
import { store } from './store.js';
import { WIRED_WORKERS } from './wiredWorkers.js';

const listeners = new Set();
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { /* isolate subscriber errors */ } }); }

export const state = {
  findings: [],
  backend: { known: false, ok: false, status: '', app: '-', port: '' },
  frontend: { known: false, ok: false },
  // One entry per docker-compose service besides backend/frontend (see
  // ServicesStatusController): { id, kind: 'worker'|'service', state }.
  services: [],
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Findings are persisted per company profile, one endpoint per wired tool
// (see e.g. SubfinderController's /subfinder/findings, backed by
// WorkerResultService) -- there's nothing to load with no profile selected,
// same as ledger.js/projectFolder.js's own hasProfile() guards. Every wired
// tool is polled and merged into one findings list, not just whichever
// worker view happens to be open, so the ledger reflects every tool's
// results at once.
async function refreshFindings() {
  const profile = store.current();
  if (!profile) { state.findings = []; return; }
  const results = await Promise.allSettled(WIRED_WORKERS.map(tool =>
    fetch(`/api/${tool}/findings?profileId=${encodeURIComponent(profile.id)}`, { signal: AbortSignal.timeout(5000) })
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
  ));
  // Total failure (e.g. backend down) keeps whatever was last loaded rather
  // than blanking the ledger out on one missed poll; a mix of successes and
  // failures still updates with whichever tools did respond.
  if (!results.some(r => r.status === 'fulfilled')) return;
  state.findings = results
    .filter(r => r.status === 'fulfilled' && Array.isArray(r.value))
    .flatMap(r => r.value);
}

// Frontend liveness. /healthz is served by this same Express process (not
// proxied through /api), so this only fails if the frontend server itself
// stopped responding -- meaningful to check even though the page already
// loaded, since a later poll can still catch it going down.
async function refreshFrontend() {
  try {
    const res = await fetch('/healthz', { signal: AbortSignal.timeout(3000) });
    Object.assign(state.frontend, { known: true, ok: res.ok });
  } catch (err) {
    Object.assign(state.frontend, { known: true, ok: false });
  }
}

// Every other docker-compose service's live state, aggregated by the
// backend in one call (see ServicesStatusController) so the browser doesn't
// have to reach 25 containers itself. Degrades to an empty list -- same
// "keep whatever was last loaded" treatment as refreshFindings -- rather
// than blanking the panel out on one missed poll.
async function refreshServices() {
  try {
    const res = await fetch('/api/services/status', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.services = await res.json();
  } catch (err) {
    // leave state.services as-is
  }
}

export async function refresh() {
  try {
    const res = await fetch('/api/', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    Object.assign(state.backend, { known: true, ok: true, status: data.status || 'running', app: data.application || '-', port: data.port || '' });
  } catch (err) {
    Object.assign(state.backend, { known: true, ok: false, status: '', app: '-', port: '' });
  }
  await Promise.all([refreshFrontend(), refreshServices()]);
  // Only ask for findings once the backend has confirmed it's up; a down
  // backend keeps whatever findings were last loaded (see refreshFindings).
  if (state.backend.ok) await refreshFindings();
  emit();
}

let polling = false;
export function startPolling(intervalMs = 10000) {
  if (polling) return;
  polling = true;
  refresh();
  setInterval(refresh, intervalMs);
  // Don't make the ledger wait out the rest of the poll interval after a
  // profile switch before it shows that profile's own findings.
  let lastProfileId = store.profileId;
  store.subscribe(() => {
    if (store.profileId === lastProfileId) return;
    lastProfileId = store.profileId;
    if (state.backend.ok) refreshFindings().then(emit);
  });
}
