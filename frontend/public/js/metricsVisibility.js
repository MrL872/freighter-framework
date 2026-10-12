// Whether the overview page's metrics grid (backend/services/severity/totals
// panels, see static/metrics.css) is shown. Same eager, apply-a-class
// pattern as theme.js's colour inversion: the flag lives on <html> rather
// than on the .metrics element itself, since .metrics is torn down and
// rebuilt whenever the overview markup is replaced (worker view, Project
// Folder, ...) and restored later — a class on <html> keeps applying
// whenever .metrics comes back, with no need to re-wire it per rebuild.
const KEY = 'fr-metrics-hidden';
let hidden = false;
try { hidden = localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }

function apply() {
  document.documentElement.classList.toggle('metrics-hidden', hidden);
}
apply();

export const metricsVisibility = {
  get hidden() { return hidden; },
  toggle() {
    hidden = !hidden;
    try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch (e) { /* ignore */ }
    apply();
  },
};
