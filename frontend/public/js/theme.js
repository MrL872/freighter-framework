// Colour inversion: the whole UI is grayscale (see the CSS custom
// properties in static/base.css), so a plain filter invert is enough to
// swap black<->white without needing a second, hand-maintained palette.
// Imported eagerly (not lazy like a component) so it applies before first
// paint instead of flashing the normal palette while menu.js loads.
const KEY = 'fr-inverted';
let inverted = false;
try { inverted = localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }

function apply() {
  document.documentElement.classList.toggle('inverted', inverted);
}
apply();

export const theme = {
  get inverted() { return inverted; },
  toggle() {
    inverted = !inverted;
    try { localStorage.setItem(KEY, inverted ? '1' : '0'); } catch (e) { /* ignore */ }
    apply();
  },
};
