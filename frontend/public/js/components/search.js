const SEVERITIES = ['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'];
// Status values the ledger's bulk action can set -- see VulnerabilityStatusService.VALID_STATUSES
// on the backend. N_A is stored name for "N/A", kept a valid identifier (no slash) for the DB/ES.
const STATUSES = ['', 'ACTIVE', 'N_A', 'FALSE_POSITIVE'];
const STATUS_LABELS = { ACTIVE: 'Active', N_A: 'N/A', FALSE_POSITIVE: 'False Positive' };

// Maps the backend's /vulnerabilities/search hit shape (worker, target,
// port, path, statusCode, title, severity, description, remediation,
// updatedAt -- see VulnerabilityRecord.java) onto the ledger's column keys
// (date -- "target" is already named the same on both sides). vulnKey and
// status are carried through too (not just used for "id") so the ledger's
// severity-column override, bottom-sort, and bulk status action all work
// the same way whether a row came from a live poll or a search result.
function toLedgerFinding(hit) {
  return {
    id: hit.vulnKey,
    vulnKey: hit.vulnKey,
    status: hit.status,
    severity: hit.severity,
    target: hit.target,
    port: hit.port,
    path: hit.path,
    statusCode: hit.statusCode,
    title: hit.title,
    description: hit.description,
    remediation: hit.remediation,
    worker: hit.worker,
    date: hit.updatedAt,
  };
}

export default {
  id: 'search',
  css: 'static/search.css',
  critical: false,
  mount(container, ctx) {
    container.innerHTML = `
      <form class="search" id="search-form" role="search" autocomplete="off">
        <span class="prompt" aria-hidden="true">&gt;</span>
        <input id="search-input" type="search" placeholder="search..." aria-label="Search">
        <kbd>/</kbd>
        <button type="button" class="search-filters-toggle" id="search-filters-toggle" aria-expanded="false" aria-controls="search-filters">filters</button>
      </form>
      <div class="search-filters" id="search-filters" hidden>
        <input type="text" id="search-vuln-id" placeholder="Vulnerability ID" aria-label="Vulnerability ID search">
        <input type="text" id="search-target" placeholder="Target / component" aria-label="Target filter">
        <input type="text" id="search-version" placeholder="Version" aria-label="Version filter">
        <select id="search-severity" aria-label="Severity filter"></select>
        <select id="search-status" aria-label="Status filter"></select>
      </div>`;

    const input = container.querySelector('#search-input');
    const filtersPanel = container.querySelector('#search-filters');
    const filtersToggle = container.querySelector('#search-filters-toggle');
    const vulnIdInput = container.querySelector('#search-vuln-id');
    const targetInput = container.querySelector('#search-target');
    const versionInput = container.querySelector('#search-version');
    const severitySelect = container.querySelector('#search-severity');
    const statusSelect = container.querySelector('#search-status');

    SEVERITIES.forEach(value => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value || 'Any severity';
      severitySelect.appendChild(opt);
    });
    STATUSES.forEach(value => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value ? STATUS_LABELS[value] : 'Any status';
      statusSelect.appendChild(opt);
    });

    // The panel floats (position: fixed, see search.css) right under this
    // toggle button instead of sitting in normal flow next to the search bar
    // or the ledger header -- it hovers over whatever's beneath it, so
    // neither one's height/width is ever affected by it opening. Opening
    // positions and shows the panel at once (the CSS animation fades it
    // in). Closing plays the fade-out first and hides the panel when it
    // ends. Reopening mid-fade cancels the pending hide.
    const FADE_OUT_MS = 260;
    let hideTimer = null;
    function positionFiltersPanel() {
      const rect = filtersToggle.getBoundingClientRect();
      filtersPanel.style.left = rect.left + 'px';
      filtersPanel.style.top = (rect.bottom + 4) + 'px';
    }
    filtersToggle.addEventListener('click', () => {
      // Open means visible and not already fading out, so a click mid-fade reopens it.
      const show = filtersPanel.hidden || filtersPanel.classList.contains('is-closing');
      filtersToggle.setAttribute('aria-expanded', String(show));
      if (show) {
        positionFiltersPanel();
        clearTimeout(hideTimer);
        filtersPanel.classList.remove('is-closing');
        filtersPanel.hidden = false;
        return;
      }
      filtersPanel.classList.add('is-closing');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        filtersPanel.classList.remove('is-closing');
        filtersPanel.hidden = true;
      }, FADE_OUT_MS);
    });

    // Empty criteria (no query text, no filters) means "show the live feed
    // again" -- ledger.js falls back to its normal state.findings source
    // when it gets vuln-search-clear, rather than an explicit empty result.
    function hasAnyCriteria() {
      return !!(input.value || vulnIdInput.value || targetInput.value || versionInput.value || severitySelect.value || statusSelect.value);
    }

    let activeController = null;
    async function runSearch() {
      if (!hasAnyCriteria()) {
        ctx.emit('vuln-search-clear');
        return;
      }
      if (activeController) activeController.abort();
      activeController = new AbortController();
      const params = new URLSearchParams();
      if (input.value) params.set('q', input.value);
      if (vulnIdInput.value) params.set('vulnId', vulnIdInput.value);
      if (targetInput.value) params.set('target', targetInput.value);
      if (versionInput.value) params.set('version', versionInput.value);
      if (severitySelect.value) params.set('severity', severitySelect.value);
      if (statusSelect.value) params.set('status', statusSelect.value);
      try {
        const res = await fetch(`/api/vulnerabilities/search?${params.toString()}`, { signal: activeController.signal });
        const payload = await res.json();
        ctx.emit('vuln-search', {
          results: (payload.results || []).map(toLedgerFinding),
          total: payload.total || 0,
          degraded: !!payload.degraded,
        });
      } catch (err) {
        if (err.name !== 'AbortError') ctx.emit('vuln-search', { results: [], total: 0, degraded: true });
      }
    }

    let debounce;
    function debouncedSearch() {
      clearTimeout(debounce);
      debounce = setTimeout(runSearch, 300);
    }

    container.querySelector('#search-form').addEventListener('submit', e => {
      e.preventDefault();
      runSearch();
    });
    input.addEventListener('input', debouncedSearch);
    [vulnIdInput, targetInput, versionInput].forEach(el => el.addEventListener('input', debouncedSearch));
    [severitySelect, statusSelect].forEach(el => el.addEventListener('change', runSearch));

    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        input.focus();
      }
    });
  },
};
