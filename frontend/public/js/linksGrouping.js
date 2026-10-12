// Whether the links sidebar (links.js) shows a flat list or grouped-by-
// category. Pulled out into its own module — same reasoning as theme.js and
// metricsVisibility.js — so the [ view ] menu's "Group/Ungroup Links" item
// can read and flip the current state directly instead of only firing a
// one-way "toggle" event it has no way to reflect back into its own label.
const KEY = 'fr-links-grouped';
let grouped = false;
try { grouped = localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }

export const linksGrouping = {
  get grouped() { return grouped; },
  toggle() {
    grouped = !grouped;
    try { localStorage.setItem(KEY, grouped ? '1' : '0'); } catch (e) { /* ignore */ }
    return grouped;
  },
};
