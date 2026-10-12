// Documentation window, opened from the header's [ help ] menu. Fetches
// MANUAL.md from this server's own /manual route (see frontend/server.js)
// and renders it with markdown.js. Closable (the [x] button, Escape, or a
// click on the backdrop) and non-modal in spirit only in that it doesn't
// block the rest of the app's state -- it's still an overlay, same pattern
// as settings.js's dialog.
import { renderMarkdown } from '../markdown.js';

const CSS_HREF = 'static/documentation.css';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function ensureStylesheet() {
  if (document.querySelector('link[data-documentation-css]')) return;
  const link = el('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.dataset.documentationCss = '1';
  document.head.append(link);
}

// Builds the sidebar's table of contents from the heading outline
// markdown.js returns alongside the rendered HTML -- same headings, same
// ids, so every nav link always has a real target in the content pane.
// The document's own H1 title is skipped (it's one line, not worth a nav
// entry); H2 sections are top-level entries, and any H3 under one nests
// under it, giving genuinely useful navigation on a document this long
// instead of just a flat list of 11 items.
function buildNav(headings) {
  const nav = el('ul', 'doc-nav');
  let currentSubList = null;
  headings.forEach(h => {
    if (h.level === 1) return;
    if (h.level === 2) {
      const item = el('li', 'doc-nav-h2');
      const link = el('a', null, h.text);
      link.href = `#${h.id}`;
      link.dataset.manualAnchor = h.id;
      item.append(link);
      currentSubList = el('ul', 'doc-nav-sub');
      item.append(currentSubList);
      nav.append(item);
    } else if (h.level === 3 && currentSubList) {
      const item = el('li', 'doc-nav-h3');
      const link = el('a', null, h.text);
      link.href = `#${h.id}`;
      link.dataset.manualAnchor = h.id;
      item.append(link);
      currentSubList.append(item);
    }
  });
  return nav;
}

// Resolves an anchor id against the rendered headings. Falls back to
// matching by the leading "<number>-" prefix when there's no exact id --
// MANUAL.md's own "## Contents" section links its items by hand, and at
// least one of those (section 7's label vs. its actual heading text) no
// longer matches character-for-character. Rather than that one link
// silently doing nothing, this finds the one heading that starts with the
// same section number.
function resolveAnchor(content, rawId) {
  const exact = content.querySelector(`#${CSS.escape(rawId)}`);
  if (exact) return exact;
  const m = rawId.match(/^(\d+)-/);
  if (!m) return null;
  const candidates = [...content.querySelectorAll(`h2[id^="${m[1]}-"]`)];
  return candidates.length === 1 ? candidates[0] : null;
}

export async function openDocumentation() {
  if (document.querySelector('.doc-overlay')) return;
  ensureStylesheet();

  const overlay = el('div', 'doc-overlay');
  const panel = el('div', 'doc-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'doc-title');

  const head = el('header', 'doc-head');
  const title = el('h2', null, 'Documentation');
  title.id = 'doc-title';
  const close = el('button', 'doc-close', '[x]');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close documentation');
  head.append(title, close);

  const body = el('div', 'doc-body');
  const nav = el('nav', 'doc-sidebar');
  nav.setAttribute('aria-label', 'Manual sections');
  const content = el('div', 'doc-content');
  content.setAttribute('tabindex', '0');
  content.append(el('p', 'doc-status', 'Loading MANUAL.md…'));
  body.append(nav, content);

  panel.append(head, body);
  overlay.append(panel);
  document.body.append(overlay);

  function closeDialog() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(e) { if (e.key === 'Escape') closeDialog(); }
  close.addEventListener('click', closeDialog);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
  document.addEventListener('keydown', onKey);

  // One delegated handler covers both the sidebar's own links and any
  // "#anchor" link rendered inside the manual's own text (its Contents
  // section) -- both just need to scroll the content pane, never the
  // browser's own URL/history.
  body.addEventListener('click', e => {
    const link = e.target.closest('a[data-manual-anchor]');
    if (!link) return;
    e.preventDefault();
    const target = resolveAnchor(content, link.dataset.manualAnchor);
    if (target) target.scrollIntoView({ block: 'start' });
  });

  close.focus();

  try {
    const res = await fetch('/manual');
    const text = await res.text();
    if (!res.ok) throw new Error(text || `request failed (HTTP ${res.status})`);
    const { html, headings } = renderMarkdown(text);
    content.innerHTML = html;
    nav.append(buildNav(headings));
  } catch (err) {
    content.replaceChildren(el('p', 'doc-status doc-error', 'Could not load MANUAL.md: ' + err.message));
  }
}
