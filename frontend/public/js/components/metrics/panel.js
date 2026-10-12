// Shared render helper for the metrics panels. Not a component itself —
// each metrics/*.js component imports this to build its panel markup.
export function panel(title, rows) {
  const p = document.createElement('div');
  p.className = 'panel';
  const h = document.createElement('div');
  h.className = 'panel-head';
  h.textContent = title;
  p.append(h);
  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'panel-row';
    const k = document.createElement('span'); k.className = 'k'; k.textContent = r.k;
    row.append(k);
    if (r.bar != null) {
      const t = document.createElement('span'); t.className = 'track';
      const f = document.createElement('span'); f.className = 'fill';
      f.style.display = 'block'; f.style.width = r.bar + '%'; f.style.opacity = r.shade;
      t.append(f); row.append(t);
    }
    // Tier gauge: 5 fixed ticks, the first r.tier of them lit -- a magnitude
    // bucket (see severity.js's tierFor), not a proportion against whatever
    // the largest row happens to be. That's what keeps a severity with a
    // handful of findings from reading as "basically empty" just because
    // another severity that poll has thousands.
    if (r.tier != null) {
      const t = document.createElement('span'); t.className = 'ticks';
      for (let i = 0; i < 5; i++) {
        const tick = document.createElement('span');
        tick.className = 'tick';
        if (i < r.tier) {
          tick.classList.add('lit');
          tick.style.opacity = r.shade;
        }
        t.append(tick);
      }
      row.append(t);
    }
    const v = document.createElement('span'); v.className = 'v' + (r.cls ? ' ' + r.cls : ''); v.textContent = r.v; v.title = r.v;
    row.append(v);
    p.append(row);
  });
  return p;
}

export function touchRefreshedAt() {
  const refreshedAt = document.getElementById('refreshed-at');
  if (refreshedAt) refreshedAt.textContent = new Date().toLocaleTimeString();
}
