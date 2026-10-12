// Whether the worker view's live terminal is given the bulk of the grid
// (control panel, wordlist/template and send output shrunk into a compact
// row above it) instead of the default even 2x2 split -- see .worker-grid's
// terminal-focus rules in worker-view.css. Same eager, apply-a-class pattern
// as metricsVisibility.js: the flag lives on <html> rather than on
// .worker-grid itself, since .worker-grid is torn down and rebuilt from
// scratch on every showWorkerView() call, so a class on <html> keeps
// applying across worker switches with no need to re-wire it per rebuild.
const KEY = 'fr-terminal-focus';
const TRANSITION_MS = 220;
let focused = false;
try { focused = localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }

function apply() {
  document.documentElement.classList.toggle('terminal-focus', focused);
}
apply();

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// FLIP (First-Last-Invert-Play): the 2x2 <-> compact-row-plus-terminal
// layouts differ in grid-template-columns/rows *track count*, and the
// terminal's own grid-column/row jumps between a single cell and a full
// span (see .worker-grid's terminal-focus rules in worker-view.css) --
// neither is something a plain CSS transition can tween (browsers only
// interpolate a grid-template when both sides have the same track count,
// and grid placement is all-or-nothing, not a range). So instead: read
// each box's rect before the class flips, let the new layout happen, then
// animate from the old rect to the new one with a transform. The grid
// itself never animates -- only the already-laid-out boxes do, which is
// what makes it look like the layout smoothly settles instead of jumping.
function animateGridChange() {
  const grid = document.querySelector('.worker-grid');
  if (!grid || prefersReducedMotion()) { apply(); return; }
  const items = Array.from(grid.children);
  const firstRects = items.map(el => el.getBoundingClientRect());
  apply();
  items.forEach((el, i) => {
    const first = firstRects[i];
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = last.width ? first.width / last.width : 1;
    const sy = last.height ? first.height / last.height : 1;
    if (!dx && !dy && sx === 1 && sy === 1) return;
    // transform-origin defaults to the box's center, which would need a
    // different dx/dy formula to compensate -- pinning it to the top-left
    // corner instead keeps the translate() distances above exactly right.
    el.style.transformOrigin = '0 0';
    const animation = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
      { duration: TRANSITION_MS, easing: 'ease' }
    );
    animation.finished.then(() => { el.style.transformOrigin = ''; }, () => {});
  });
}

export const terminalFocus = {
  get focused() { return focused; },
  toggle() {
    focused = !focused;
    try { localStorage.setItem(KEY, focused ? '1' : '0'); } catch (e) { /* ignore */ }
    animateGridChange();
  },
};
