// Minimal, dependency-free Markdown -> HTML renderer. Not a general-purpose
// parser -- it covers exactly what MANUAL.md actually uses (headings up to
// ###, fenced code blocks, ordered/unordered lists with one level of
// nesting, inline code, bold, and "#anchor" links from its own Contents
// section). No tables, blockquotes, images, italics or external links exist
// in that file today; if one gets added later, it degrades gracefully
// (prints as plain text) rather than breaking the render.
//
// Used by documentation.js. Kept as its own module (no CDN script, no
// bundler) because nothing else in this app pulls in a third-party library --
// see commandPreview.js and friends, which are all plain hand-rolled parsers
// for the same reason.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// GitHub's own heading-anchor algorithm: lowercase, drop anything that
// isn't a letter, digit, space or hyphen, then turn spaces into hyphens.
// MANUAL.md's own "## Contents" links were hand-written against exactly
// this scheme (e.g. "9. Adding a new worker" -> "#9-adding-a-new-worker"),
// so matching it means those links resolve correctly against the ids this
// module generates, with no special-casing.
export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

// Inline spans: code, bold, links. Code is pulled out first and restored
// last so nothing inside a code span (literal "**", "[", a stray "<") is
// ever mistaken for bold/link syntax or needs its own escaping twice.
function renderInline(raw) {
  const codeSpans = [];
  let text = raw.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  text = escapeHtml(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (whole, label, href) => {
    if (href.startsWith('#')) {
      return `<a href="${escapeAttr(href)}" data-manual-anchor="${escapeAttr(href.slice(1))}">${label}</a>`;
    }
    if (/^https?:\/\//.test(href)) {
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    // Anything else (a relative file path, a mailto:, ...) has nothing on
    // this page to link to -- show the label as plain text rather than a
    // link that would 404 or navigate away from the manual.
    return label;
  });
  text = text.replace(/\u0000(\d+)\u0000/g, (_, idx) => `<code>${escapeHtml(codeSpans[Number(idx)])}</code>`);
  return text;
}

function matchListLine(line) {
  const m = line.match(/^(\s*)(?:([-*])|(\d+)\.)\s+(.*)$/);
  if (!m) return null;
  return { indent: m[1].length, ordered: m[3] !== undefined, text: m[4] };
}

// Consumes every contiguous list line at `indent`, recursing into any more
// deeply indented run right under an item as that item's nested sub-list
// (MANUAL.md only ever nests one level deep, but this handles any depth the
// same way regardless). Returns the rendered <ul>/<ol> and the next line
// index to resume the outer parse at.
function parseList(lines, start, indent) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = matchListLine(lines[i]);
    if (!m || m.indent !== indent) break;
    i++;
    let nested = '';
    const next = i < lines.length ? matchListLine(lines[i]) : null;
    if (next && next.indent > indent) {
      const sub = parseList(lines, i, next.indent);
      nested = sub.html;
      i = sub.next;
    }
    items.push({ ordered: m.ordered, text: m.text, nested });
  }
  const tag = items.length && items[0].ordered ? 'ol' : 'ul';
  const html = `<${tag}>${items.map(it => `<li>${renderInline(it.text)}${it.nested}</li>`).join('')}</${tag}>`;
  return { html, next: i };
}

/**
 * Renders `src` to HTML and returns the heading outline alongside it, so
 * the caller (documentation.js) can build a table of contents from the
 * same pass instead of re-scanning the text.
 */
export function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  const slugCounts = new Map();
  let html = '';
  let paragraph = [];
  let i = 0;

  function uniqueSlug(text) {
    const base = slugify(text) || 'section';
    const count = (slugCounts.get(base) || 0) + 1;
    slugCounts.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  }
  function flushParagraph() {
    if (paragraph.length) {
      html += `<p>${renderInline(paragraph.join(' '))}</p>`;
      paragraph = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { flushParagraph(); i++; continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = uniqueSlug(text);
      headings.push({ level, id, text });
      html += `<h${level} id="${id}">${renderInline(text)}</h${level}>`;
      i++;
      continue;
    }

    if (line.trim().startsWith('```')) {
      flushParagraph();
      i++;
      const code = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i++; }
      i++; // the closing fence
      html += `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
      continue;
    }

    const list = matchListLine(line);
    if (list) {
      flushParagraph();
      const result = parseList(lines, i, list.indent);
      html += result.html;
      i = result.next;
      continue;
    }

    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return { html, headings };
}
