import { state, subscribe, startPolling } from '../../data.js';
import { panel } from './panel.js';

export default {
  id: 'metric-totals',
  css: 'static/metrics.css',
  critical: false,
  mount(container) {
    function render() {
      const findings = state.findings;
      // A finding is Active unless the ledger's bulk action marked it N/A or
      // False Positive -- see VulnerabilityStatusService.VALID_STATUSES.
      const excluded = findings.filter(f => f.status === 'N_A' || f.status === 'FALSE_POSITIVE').length;
      container.replaceChildren(
        panel('Totals', [{ k: 'Found', v: String(findings.length) }, { k: 'Active', v: String(findings.length - excluded) }, { k: 'Excluded', v: String(excluded) }])
      );
    }
    subscribe(render);
    render();
    startPolling(10000);
  },
};
