import { state, subscribe, startPolling } from '../../data.js';
import { touchRefreshedAt } from './panel.js';

// 'running'/'connected' is healthy, 'disconnected' is the only state worth
// visually flagging as bad -- 'idle' (a job worker that's reachable with
// nothing running) is normal, not a warning.
function stateCls(s) {
  if (s === 'running' || s === 'connected') return 'state-ok';
  if (s === 'disconnected') return 'state-bad';
  return '';
}

// mcp-gateway, elasticsearch, telegram-worker (kind: 'service' from
// ServicesStatusController) have no job state, just liveness -- pin them
// above the scrolling worker list like Frontend, and show 'running'
// instead of the backend's 'connected' so all pinned rows read the same way.
const PINNED_IDS = ['mcp-gateway', 'elasticsearch', 'telegram-worker'];

function pinnedText(s) {
  return s === 'connected' ? 'running' : s;
}

function row(k, v, cls) {
  const r = document.createElement('div');
  r.className = 'panel-row';
  const kEl = document.createElement('span'); kEl.className = 'k'; kEl.textContent = k;
  r.append(kEl);
  const vEl = document.createElement('span'); vEl.className = 'v' + (cls ? ' ' + cls : ''); vEl.textContent = v; vEl.title = v;
  r.append(vEl);
  return r;
}

export default {
  id: 'metric-services',
  css: 'static/metrics.css',
  critical: false,
  mount(container) {
    function render() {
      const p = document.createElement('div');
      p.className = 'panel';
      const head = document.createElement('div');
      head.className = 'panel-head';
      head.textContent = 'Services';
      p.append(head);

      const frontend = state.frontend;
      // Frontend is the only pinned metric with a host-mapped port (see
      // docker-compose.yml), so it's the only one worth naming it on.
      const frontendText = !frontend.known ? 'checking...' : frontend.ok ? 'running:3000' : 'unreachable';
      const frontendRow = row('Frontend', frontendText, frontend.ok ? 'state-ok' : (frontend.known ? 'state-bad' : ''));
      frontendRow.classList.add('fixed');
      p.append(frontendRow);

      const pinned = state.services.filter(s => s.kind === 'service');
      if (pinned.length) {
        pinned.forEach(s => {
          const r = row(s.id, pinnedText(s.state), stateCls(s.state));
          r.classList.add('fixed');
          p.append(r);
        });
      } else {
        PINNED_IDS.forEach(id => {
          const r = row(id, 'checking...', '');
          r.classList.add('fixed');
          p.append(r);
        });
      }

      const scroll = document.createElement('div');
      scroll.className = 'panel-scroll';
      const workers = state.services.filter(s => s.kind === 'worker');
      if (workers.length) {
        workers.forEach(s => scroll.append(row(s.id, s.state, stateCls(s.state))));
      } else {
        scroll.append(row('', 'checking...', ''));
      }
      p.append(scroll);

      container.replaceChildren(p);
      touchRefreshedAt();
    }
    subscribe(render);
    render();
    startPolling(10000);
  },
};
