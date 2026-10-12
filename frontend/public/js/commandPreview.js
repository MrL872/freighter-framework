// Command preview bar shared by every worker control panel. The command name
// (dirsearch.py, ffuf, ...) is fixed text. What follows it, the flags and their
// values, is an editable input, so a command can be typed or pasted over the
// generated flags. Once the typed text settles (see DEBOUNCE_MS below) it's
// parsed back into a flag set via commandParser.js and handed to the panel's
// own onApply(), which applies it exactly as if the equivalent buttons had
// been clicked -- a typed edit is never silently ignored. A typed command
// that doesn't parse shows an inline error instead of applying anything.
//
// [Reset] discards an in-progress (not yet applied) typed edit, rebuilding
// the bar from the panel's actual flags. Once a typed edit *has* applied
// (flagDefs panels only -- see bindCommandPreview's options), [Reset] stays
// visible and instead reverts the panel all the way back to whatever flags
// were active before that whole typing session started, however many
// overrides were typed and applied in a row since. Pressing a flag button
// directly afterward counts as a deliberate, separate change and retires
// that revert target -- [Reset] then goes back to only covering the
// in-progress edit, until the next typed override applies.
// [Clear] unpins every flag and empties the bar.
import { parseCommand } from './commandParser.js';

export function commandPreviewHtml(worker) {
  return `
    <div class="command-preview">
      <span class="prompt" aria-hidden="true">$</span>
      <span class="cmd-name">${worker}</span>
      <input type="text" class="cmd-text" spellcheck="false" autocomplete="off" aria-label="Flags and values">
      <div class="cmd-actions">
        <button type="button" class="bracket-copy-btn cmd-reset" hidden title="Undo the typed override(s) and rebuild the command from the control panel">[Reset]</button>
        <button type="button" class="bracket-copy-btn cmd-clear" title="Unpin every flag and clear the command">[Clear]</button>
        <button type="button" class="bracket-copy-btn" id="command-preview-copy" title="Copy to clipboard">[Copy]</button>
      </div>
    </div>
    <p class="cmd-error" role="alert" hidden></p>`;
}

// How long to wait after the last keystroke before parsing -- long enough
// that typing a flag name letter by letter (e.g. "-" then "-o" then "-o ")
// doesn't flash an "Unknown flag" error on every intermediate keystroke.
const DEBOUNCE_MS = 350;

// Call once the panel's markup is in place. Options:
//   onClear()       - [CLEAR] was pressed; unpin the panel's flags and call
//                     its own renderCommand().
//   flagDefs        - flat array of { flag, alias, takesValue, bare } (see
//                     commandParser.js) used to parse typed edits back into
//                     flags. Omitted (e.g. the generic unwired placeholder
//                     panel) means typing stays cosmetic, as before.
//   onApply(flags)  - a typed edit parsed cleanly into this flag -> value
//                     Map; apply it to the panel's own active state (clear
//                     and refill, resync button pressed-states) and call
//                     renderCommand() so the bar repaints in canonical form.
// Returns:
//   setGenerated(text) - text is the full command the flags build; the command
//                        name is split off because the bar shows it as fixed text.
//   text()             - the full command as it reads now (name + typed flags).
export function bindCommandPreview(container, { onClear, flagDefs, onApply } = {}) {
  const bar = container.querySelector('.command-preview');
  const name = bar.querySelector('.cmd-name').textContent;
  const input = bar.querySelector('.cmd-text');
  const resetBtn = bar.querySelector('.cmd-reset');
  const clearBtn = bar.querySelector('.cmd-clear');
  const errorEl = container.querySelector('.cmd-error');
  let generated = '';
  let edited = false;
  let debounceTimer = null;
  // The flags text (same shape as `generated`) to go back to on [Reset],
  // captured once when a typing session first diverges and kept through
  // however many typed overrides apply on top of each other -- see the
  // class comment above. null means there's nothing applied to revert
  // (either nothing's been typed yet, or a direct flag-button press already
  // retired it). Only ever set when flagDefs is given; cosmetic/placeholder
  // panels (no flagDefs, typing never applies) stay on the plain
  // edited-only behavior this always reduces to when revertTarget is null.
  let revertTarget = null;
  // True only while tryApply()'s own onApply() call is unwinding, so the
  // setGenerated() it triggers (via the panel's renderCommand()) can tell
  // "this re-render is the override committing" apart from "a flag button
  // was pressed directly" -- the latter is what retires revertTarget.
  let applyingOverride = false;

  const sync = () => {
    resetBtn.hidden = !(edited || revertTarget !== null);
  };

  function showError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  // Parses the box's current text and, if it's valid, applies it -- the
  // panel's own renderCommand() (called from onApply) then regenerates the
  // canonical text via setGenerated(), which is what actually repaints the
  // input once `edited` is false again. A parse failure leaves `edited` (and
  // whatever flags were last valid) untouched: never silently run something
  // other than what's on screen.
  function tryApply() {
    if (!flagDefs) return;
    const typed = input.value.trim();
    const parsed = typed ? parseCommand(typed, flagDefs) : { ok: true, flags: new Map() };
    if (!parsed.ok) {
      showError(parsed.error);
      return;
    }
    showError(null);
    edited = false;
    sync();
    if (onApply) {
      applyingOverride = true;
      try {
        onApply(parsed.flags);
      } finally {
        applyingOverride = false;
      }
    }
  }

  input.addEventListener('input', () => {
    edited = input.value !== generated;
    // Captured once per typing session (never overwritten while already
    // set) so reverting later always lands on the state from before the
    // *first* edit, not just the most recent one.
    if (flagDefs && edited && revertTarget === null) revertTarget = generated;
    sync();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryApply, DEBOUNCE_MS);
  });

  resetBtn.addEventListener('click', () => {
    clearTimeout(debounceTimer);
    showError(null);
    if (revertTarget !== null) {
      // Revert an applied (or in-progress) override: re-apply whatever
      // flags the pre-edit text itself parses back into, the same way a
      // typed command normally would. This text was `generated` at some
      // earlier point, so it's always valid input for flagDefs.
      const target = revertTarget;
      revertTarget = null;
      edited = false;
      input.value = target;
      if (onApply) onApply(target ? parseCommand(target, flagDefs).flags : new Map());
    } else {
      // Plain discard of an in-progress, not-yet-applied edit (or a
      // cosmetic panel with no flagDefs at all).
      edited = false;
      input.value = generated;
    }
    sync();
  });

  clearBtn.addEventListener('click', () => {
    clearTimeout(debounceTimer);
    edited = false;
    generated = '';
    input.value = '';
    showError(null);
    sync();
    if (onClear) onClear();
  });

  return {
    setGenerated(text) {
      generated = text.startsWith(name) ? text.slice(name.length).trimStart() : text;
      // A re-render NOT caused by tryApply()'s own onApply() -- a direct
      // flag-button press (including Clear and the revert click above,
      // which both route back through the panel's renderCommand()) -- is a
      // deliberate change that supersedes whatever override was pending or
      // applied before it.
      if (!applyingOverride) revertTarget = null;
      if (!edited) input.value = generated;
      sync();
    },
    text() {
      const typed = input.value.trim();
      return typed ? `${name} ${typed}` : name;
    },
  };
}
