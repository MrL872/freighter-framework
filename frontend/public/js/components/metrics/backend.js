import { state, subscribe, startPolling } from '../../data.js';
import { panel, touchRefreshedAt } from './panel.js';

export default {
  id: 'metric-backend',
  css: 'static/metrics.css',
  critical: true,
  mount(container) {
    function render() {
      const backend = state.backend;
      const statusText = backend.port ? `${backend.status || 'running'}:${backend.port}` : (backend.status || 'running');
      const bstate = !backend.known ? { v: 'checking...' } : backend.ok ? { v: statusText, cls: 'state-ok' } : { v: 'unreachable', cls: 'state-bad' };
      container.replaceChildren(
        panel('Backend', [{ k: 'Status', ...bstate }, { k: 'Application', v: backend.app }, { k: 'Poll', v: '10s' }])
      );
      touchRefreshedAt();
    }
    subscribe(render);
    render();
    startPolling(10000);
  },
};
