// Vulnerability card: a closable detail dialog for one ledger row, opened by
// ledger.js on a row click. Same overlay/panel/Escape/click-outside pattern
// as settings.js's dialog -- this module isn't part of index.js's
// COMPOSITION (nothing mounts it into a fixed selector); it's opened
// on-demand the same way settings.js's openSettings() is.
//
// Status (Active/N/A/False Positive) goes through the same
// POST /api/vulnerabilities/status endpoint the ledger's own bulk action
// bar uses (see ledger.js's setSelectedStatus) -- this card is just a
// single-entry path to the same backend call.
//
// Delete permanently tombstones this vulnerability (see
// VulnerabilityRepository.deleteByKey's own doc) -- not a status. The raw
// job_results data behind it is untouched, but nothing reachable through
// this vulnKey, including the live feed, shows it again -- not on a
// reload, not even if the tool re-scans and finds the exact same thing a
// second time.
const STATUS_LABELS = { ACTIVE: 'Active', N_A: 'N/A', FALSE_POSITIVE: 'False Positive' };
const CSS_HREF = 'static/vuln-card.css';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function ensureStylesheet() {
  if (document.querySelector('link[data-vuln-card-css]')) return;
  const link = el('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.dataset.vulnCardCss = '1';
  document.head.append(link);
}

// Same formatting as ledger.js's own toUtcDisplay -- duplicated rather than
// imported to keep this module independent of ledger.js's internals.
function toUtcDisplay(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function field(label, value) {
  const row = el('div', 'vuln-card-field');
  row.append(el('span', 'vuln-card-label', label), el('span', 'vuln-card-value', value || '-'));
  return row;
}

// Same full-URL check as ledger.js's own PATH_LINK_RE -- kept independent
// rather than imported, same reasoning as toUtcDisplay above. A gitleaks
// file path or a jwt-tool token isn't navigable, so those stay plain text;
// a discovered URL becomes a real link, openable the same way the ledger's
// own Path column already lets you.
const PATH_LINK_RE = /^https?:\/\//i;

function pathField(label, value) {
  const row = el('div', 'vuln-card-field');
  row.append(el('span', 'vuln-card-label', label));
  if (value && PATH_LINK_RE.test(value)) {
    const a = document.createElement('a');
    a.href = value;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = value;
    a.className = 'vuln-card-value';
    row.append(a);
  } else {
    row.append(el('span', 'vuln-card-value', value || '-'));
  }
  return row;
}

// A "[Copy]" button next to a section heading, matching the one Project
// Folder's file viewer uses (see index.js's buildFileRow): copies getText()
// to the clipboard, flashes "[Copied]"/"[Copy failed]", then reverts.
function copyButton(getText) {
  const btn = el('button', 'bracket-copy-btn', '[Copy]');
  btn.type = 'button';
  btn.title = 'Copy to clipboard';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText() || '');
      btn.textContent = '[Copied]';
    } catch {
      btn.textContent = '[Copy failed]';
    }
    setTimeout(() => { btn.textContent = '[Copy]'; }, 1500);
  });
  return btn;
}

function sectionHead(heading, getText) {
  const head = el('div', 'vuln-card-section-head');
  head.append(el('h3', null, heading), copyButton(getText));
  return head;
}

// opts: { onStatusChanged(vulnKey, status), onDeleted(vulnKey) }, both optional.
export function openVulnCard(finding, opts = {}) {
  if (document.querySelector('.vuln-card-overlay')) return;
  ensureStylesheet();

  const vulnKey = finding.vulnKey || null;

  const overlay = el('div', 'vuln-card-overlay');
  const panel = el('div', 'vuln-card-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'vuln-card-title');

  const head = el('header', 'vuln-card-head');
  const title = el('h2', null, 'Vulnerability Card');
  title.id = 'vuln-card-title';
  const close = el('button', 'vuln-card-close', '[x]');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close vulnerability card');
  head.append(title, close);

  const body = el('div', 'vuln-card-body');
  body.append(
    field('ID', vulnKey || 'not yet indexed'),
    field('Worker', finding.worker),
    field('Severity', finding.severity),
    field('Status', finding.status ? (STATUS_LABELS[finding.status] || finding.status) : 'Active'),
  );

  const urlSection = el('section', 'vuln-card-section');
  urlSection.append(el('h3', null, 'URL details'));
  urlSection.append(field('Target', finding.target), pathField('Path', finding.path), field('Port', finding.port), field('Status Code', finding.statusCode));
  body.append(urlSection);

  body.append(field('Title', finding.title), field('Date', toUtcDisplay(finding.date)));

  const textSection = el('section', 'vuln-card-section');
  textSection.append(
    sectionHead('Description', () => finding.description || ''),
    el('p', 'vuln-card-text', finding.description || '-'),
    sectionHead('Remediation', () => finding.remediation || ''),
    el('p', 'vuln-card-text', finding.remediation || '-'),
  );
  body.append(textSection);

  const actions = el('div', 'vuln-card-actions');
  const statusMsg = el('p', 'vuln-card-msg');
  statusMsg.setAttribute('role', 'status');

  if (!vulnKey) {
    statusMsg.textContent = 'This finding has not been indexed yet -- status and delete are unavailable until the next poll picks it up.';
    body.append(actions, statusMsg);
  } else {
    const statusRow = el('div', 'vuln-card-action-row');
    ['ACTIVE', 'N_A', 'FALSE_POSITIVE'].forEach(status => {
      const btn = el('button', 'vuln-card-status-btn', `Mark ${STATUS_LABELS[status]}`);
      btn.type = 'button';
      btn.disabled = finding.status === status || (!finding.status && status === 'ACTIVE');
      btn.addEventListener('click', async () => {
        statusRow.querySelectorAll('button').forEach(b => { b.disabled = true; });
        statusMsg.textContent = 'Updating…';
        try {
          const res = await fetch('/api/vulnerabilities/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vulnKeys: [vulnKey], status }),
          });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          finding.status = status;
          statusMsg.textContent = `Marked ${STATUS_LABELS[status]}.`;
          statusRow.querySelectorAll('button').forEach((b, i) => {
            b.disabled = ['ACTIVE', 'N_A', 'FALSE_POSITIVE'][i] === status;
          });
          if (opts.onStatusChanged) opts.onStatusChanged(vulnKey, status);
        } catch (err) {
          statusMsg.textContent = 'Failed to update status.';
          statusRow.querySelectorAll('button').forEach((b, i) => {
            b.disabled = ['ACTIVE', 'N_A', 'FALSE_POSITIVE'][i] === finding.status;
          });
        }
      });
      statusRow.append(btn);
    });
    actions.append(statusRow);

    const deleteRow = el('div', 'vuln-card-action-row');
    const deleteBtn = el('button', 'vuln-card-delete-btn', 'Delete entry');
    deleteBtn.type = 'button';
    let confirming = false;
    deleteBtn.addEventListener('click', async () => {
      if (!confirming) {
        confirming = true;
        deleteBtn.textContent = 'Click again to confirm delete';
        statusMsg.textContent = 'This permanently removes the record. It will not come back, even on a reload or a future re-scan.';
        return;
      }
      deleteBtn.disabled = true;
      statusMsg.textContent = 'Deleting…';
      try {
        const res = await fetch(`/api/vulnerabilities/${encodeURIComponent(vulnKey)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
        if (opts.onDeleted) opts.onDeleted(vulnKey);
        closeDialog();
      } catch (err) {
        statusMsg.textContent = 'Failed to delete.';
        deleteBtn.disabled = false;
        confirming = false;
        deleteBtn.textContent = 'Delete entry';
      }
    });
    deleteRow.append(deleteBtn);
    actions.append(deleteRow);

    body.append(actions, statusMsg);
  }

  panel.append(head, body);
  overlay.append(panel);
  document.body.append(overlay);

  // Matches vuln-card.css's .is-closing animation duration (0.18s) -- the
  // overlay stays in the DOM (and keeps blocking a second card via the
  // querySelector guard above) until the close animation actually finishes.
  const CLOSE_MS = 180;
  function closeDialog() {
    if (overlay.classList.contains('is-closing')) return;
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), CLOSE_MS);
  }
  function onKey(e) { if (e.key === 'Escape') closeDialog(); }
  close.addEventListener('click', closeDialog);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
  document.addEventListener('keydown', onKey);
  close.focus();
}
