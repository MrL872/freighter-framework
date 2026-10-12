// Turns a hand-typed/edited command-preview string back into a flag -> value
// Map, the same shape every control panel's own `active` Map already holds
// (see commandPreview.js). Shared by every wired tool's panel so there is
// exactly one tokenizer/matcher to get right, rather than one per tool.
//
// flagDefs is a flat array of { flag, alias, takesValue, bare }, normally
// built by flattening a panel's own FLAG_SECTIONS (and, for puredns, its
// COMMANDS too -- see puredns-panel.js). flag is the canonical spelling
// stored in the result Map regardless of which spelling (flag or alias) the
// user actually typed, so the backend's *Flags.java allowlist (which only
// recognizes the canonical short form) always sees something it accepts.
//
// `bare` only matters when paired with `takesValue: true`: it marks the one
// slot a dash-less, keyword-less token (a target URL, a JWT, ...) fills --
// see gau/wafw00f/hydra/jwt-tool-panel.js's own "target" entry. A dash-less
// KEYWORD flag (puredns's "resolve"/"bruteforce", gitleaks's "dir"/"git",
// gowitness's "single"/"file", ...) needs no special handling at all: it's
// matched by its literal flag name like any other flag, `bare` or not --
// only the lack of a leading "-" distinguishes it, and this parser never
// looks for one.

// Splits text into argv-like tokens, honoring '...' and "..." spans (quotes
// are stripped, no nested-escape handling -- this mirrors how little
// validation the plain flag-value popup applies, not a full shell grammar).
// Throws on an unterminated quote so the caller can surface that as a
// parse error instead of silently losing the rest of the line.
function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    let token = '';
    while (i < n && !/\s/.test(text[i])) {
      const ch = text[i];
      if (ch === '"' || ch === "'") {
        const quote = ch;
        i++;
        const start = i;
        while (i < n && text[i] !== quote) i++;
        if (i >= n) throw new Error(`Unterminated ${quote} quote`);
        token += text.slice(start, i);
        i++; // skip the closing quote
      } else {
        token += ch;
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

// Returns { ok: true, flags: Map } or { ok: false, error: string }. Never
// throws -- a malformed typed command is exactly the kind of untrusted
// input this exists to reject cleanly rather than half-apply.
export function parseCommand(text, flagDefs) {
  let tokens;
  try {
    tokens = tokenize(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!tokens.length) return { ok: true, flags: new Map() };

  const byName = new Map();
  for (const f of flagDefs) {
    byName.set(f.flag, f);
    if (f.alias) byName.set(f.alias, f);
  }
  // At most one flag is ever marked both bare and takesValue per tool (the
  // one true positional slot) -- see the module comment above.
  const bareValueFlag = flagDefs.find(f => f.bare && f.takesValue);

  const flags = new Map();
  let bareValueUsed = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const def = byName.get(tok);
    if (def) {
      if (def.takesValue) {
        if (i + 1 >= tokens.length) return { ok: false, error: `"${tok}" requires a value` };
        flags.set(def.flag, tokens[++i]);
      } else {
        flags.set(def.flag, '');
      }
      continue;
    }
    if (tok.startsWith('-')) return { ok: false, error: `Unknown flag: ${tok}` };
    if (bareValueFlag && !bareValueUsed) {
      flags.set(bareValueFlag.flag, tok);
      bareValueUsed = true;
      continue;
    }
    return { ok: false, error: `Unexpected argument: ${tok}` };
  }
  return { ok: true, flags };
}
