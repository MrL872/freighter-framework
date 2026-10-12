// Per-tool session state that survives switching a worker's view away and
// back -- to the overview, to a different worker, and back again -- within
// the same browser tab. Same "persistent module outside any component's own
// mount()" pattern data.js already uses for the ledger's findings: the
// worker view's four boxes are torn down and rebuilt from scratch on every
// switch (main.innerHTML = ..., see showWorkerView()/showOverview() in
// index.js), which otherwise loses everything a component held in a local
// closure variable. The backend worker containers themselves keep a run
// going regardless of what the browser currently shows (see RunService and
// each worker's own WS relay, which replays its buffered history to any new
// subscriber) -- this is what lets the frontend side act the same way,
// rather than a switched-away-from run looking as if it had been reset.
//
// Scope: this is in-memory only, not persisted to localStorage or the
// backend -- a full page reload still loses it, same as before. Surviving
// that would need the backend to expose which job (if any) is currently
// running per tool/profile, which nothing here does yet.
const sessions = new Map();

export function getSession(tool) {
  let s = sessions.get(tool);
  if (!s) {
    s = {
      // Control panel: flag -> value ('' for boolean flags), reused in place
      // (not replaced) by every <tool>-panel.js mount so edits always land
      // on the same persistent Map. activeCommand is puredns-panel.js's own
      // extra bit of state (its resolve/bruteforce subcommand, if any) --
      // every other panel ignores it.
      activeFlags: new Map(),
      activeCommand: null,
      // Live terminal: the open run's WebSocket (null when no run is live),
      // every rendered line's text in append order (repaint source for a
      // remount), and the run/pause/result bookkeeping live-terminal.js's
      // buttons reflect.
      ws: null,
      history: [],
      // The current, not-yet-newline-terminated tail of each stream (e.g. a
      // progress bar mid-redraw) -- stream name -> text, "" meaning nothing
      // pending. Kept separately from history/rawLines (see each worker's
      // "partial" frame): it's a live, still-changing preview, never a
      // finished line, so it's never parsed for results and a remount
      // restores it by re-rendering it live rather than replaying it.
      partials: {},
      running: false,
      paused: false,
      resultsEmitted: false,
      // Send output: the most recent `${tool}:output` payload live-terminal.js
      // emitted (see its emitResults()) -- send-output.js mounts
      // independently and otherwise only ever learns of a finished run by
      // catching that event live, so a run that completed while its box
      // wasn't mounted would have nothing to show on remount without this.
      output: null,
    };
    sessions.set(tool, s);
  }
  return s;
}
