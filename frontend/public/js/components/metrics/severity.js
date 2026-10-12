import { state, subscribe, startPolling } from '../../data.js';
import { panel } from './panel.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const SEV_SHADE = { critical: 1, high: 0.8, medium: 0.6, low: 0.4, info: 0.25 };

// Fixed magnitude buckets, not proportional to whatever the largest severity
// happens to be that poll -- 5000 high findings next to 20 info findings
// used to fill high's bar and leave info's looking all but empty, even
// though 20 is still a real number of findings worth seeing. 0 findings is
// its own bucket (no ticks lit) rather than folding into "< 250", or every
// severity with nothing at all would still show as 1/5 full.
function tierFor(count) {
  if (count <= 0) return 0;
  if (count < 250) return 1;
  if (count < 500) return 2;
  if (count < 750) return 3;
  if (count < 1000) return 4;
  return 5;
}

export default {
  id: 'metric-severity',
  css: 'static/metrics.css',
  critical: false,
  mount(container) {
    function render() {
      // A finding marked N/A or False Positive is excluded from every stat here --
      // it keeps its original severity (so reverting to Active restores it
      // correctly), but should never count toward these totals.
      const findings = state.findings.filter(f => !f.status || f.status === 'ACTIVE');
      const counts = Object.fromEntries(SEVERITIES.map(x => [x, findings.filter(f => f.severity === x).length]));
      container.replaceChildren(
        panel('Severity', SEVERITIES.map(x => ({ k: x, tier: tierFor(counts[x]), shade: SEV_SHADE[x], v: String(counts[x]) })))
      );
    }
    subscribe(render);
    render();
    startPolling(10000);
  },
};
