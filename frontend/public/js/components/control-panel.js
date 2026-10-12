// Control panel placeholder. Every worker exposes different instruments
// (flags, targets, schedules, ...) so this component does not yet know how
// to render any of them — it only reserves the layout (two expandable flag
// groups above a fixed command preview) that a future worker-specific
// control set replaces, keyed off main.dataset.worker.
import { suppressTransition } from '../domTransition.js';
import { commandPreviewHtml, bindCommandPreview } from '../commandPreview.js';

function flagGroup(id, title, hint) {
  return `
    <div class="flag-group">
      <button type="button" class="flag-group-head" aria-expanded="false" aria-controls="flags-${id}">
        <span class="glyph" aria-hidden="true">&gt;</span>${title}
      </button>
      <div class="flag-group-body-wrap">
        <div class="flag-group-body" id="flags-${id}">
          <p class="hint">${hint}</p>
        </div>
      </div>
    </div>`;
}

export default {
  id: 'control-panel',
  css: 'static/worker-view.css',
  critical: false,
  mount(container) {
    const worker = document.querySelector('main').dataset.worker || 'worker';
    container.innerHTML = `
      <div class="panel-head">Control panel</div>
      <div class="control-body">
        ${flagGroup('basic', 'Basic flags', `No basic flags defined yet for <strong>${worker}</strong>.`)}
        ${flagGroup('advanced', 'Advanced flags', 'Each worker takes different instruments (targets, schedule, rate limits, ...) — this panel will be built per worker.')}
      </div>
      ${commandPreviewHtml(worker)}`;

    // Every worker switch remounts this panel from scratch (see
    // showWorkerView() in index.js) — guard each collapsible group's fresh
    // .flag-group-body-wrap the same way page navigation guards main's own
    // grid-template-rows transition, so it can never misread its very first
    // style application as something worth animating.
    container.querySelectorAll('.flag-group-body-wrap').forEach(suppressTransition);
    container.querySelectorAll('.flag-group-head').forEach(btn => {
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
      });
    });

    const preview = bindCommandPreview(container);
    const copyBtn = container.querySelector('#command-preview-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(preview.text());
        copyBtn.textContent = '[Copied]';
      } catch {
        copyBtn.textContent = '[Copy failed]';
      }
      setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
    });
  },
};
