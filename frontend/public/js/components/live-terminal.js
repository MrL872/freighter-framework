// Live caption terminal. For every worker in wiredWorkers.js's WIRED_WORKERS
// list, this is real: Send starts a run against that tool's persistent
// worker container (built from its control panel's current flag selection,
// received over the shared ctx bus), and streams output live over a
// WebSocket the backend relays from the worker (see
// com.example.application.<tool>'s RelayHandler). The job's own process is
// driven, never the container:
//   Pause    = Ctrl+Z on the job (suspends it); it turns into Unpause
//   Unpause  = fg on the job (continues it)
//   Stop     = Ctrl+C on the job; the worker goes idle and the terminal stays,
//              so the next run can start
// Every other worker gets the inert placeholder.
//
// Every other worker gets the inert placeholder, since it has no persistent worker or backend route yet.
//
// A run's socket, buffered output and run/pause state all live in
// workerSession.js, keyed by tool, rather than in local variables here --
// switching the worker view away (to the overview, or to a different
// worker) and back remounts this module from scratch (see showWorkerView()
// in index.js), and a local variable wouldn't survive that. The session
// does, so a remount repaints the run's output so far instead of showing
// the empty placeholder, and picks the still-open socket (if the run is
// still going) back up instead of abandoning it.
import { store } from '../store.js';
import { currentWiredTool } from '../wiredWorkers.js';
import { getSession } from '../workerSession.js';

export default {
  id: 'live-terminal',
  css: 'static/worker-view.css',
  critical: false,
  mount(container, ctx) {
    const tool = currentWiredTool();

    container.innerHTML = `
      <div class="panel-head">Live caption terminal</div>
      <div class="terminal-output" aria-live="polite" id="terminal-output">
        <p class="hint">${tool
          ? 'Build a command in the control panel, then press Send.<span class="cursor" aria-hidden="true"></span>'
          : 'Waiting for the worker&#39;s terminal — no live session connected yet.<span class="cursor" aria-hidden="true"></span>'}</p>
      </div>
      <div class="terminal-input-row">
        <input type="text" id="terminal-input" placeholder="Answer a prompt in the running job" autocomplete="off" disabled>
        <button type="button" id="terminal-input-send" disabled>Enter</button>
      </div>
      <div class="terminal-control">
        <button type="button" id="terminal-send" ${tool ? '' : 'disabled'}>Send</button>
        <button type="button" id="terminal-pause" disabled title="Pause the job (Ctrl+Z)">Pause</button>
        <button type="button" id="terminal-stop" disabled title="Stop the job (Ctrl+C); the worker stays up">Stop</button>
      </div>`;

    if (!tool) return; // rest of this module only wires up real behavior for a wired tool

    const outputEl = container.querySelector('#terminal-output');
    const sendBtn = container.querySelector('#terminal-send');
    const stopBtn = container.querySelector('#terminal-stop');
    const pauseBtn = container.querySelector('#terminal-pause');
    const inputEl = container.querySelector('#terminal-input');
    const inputBtn = container.querySelector('#terminal-input-send');

    const session = getSession(tool);

    // Seeded from the control panel's own persisted Map (see
    // workerSession.js) so flags built up before this mount aren't lost --
    // kept in sync afterward the same way as before, over the shared ctx bus.
    let flags = Object.fromEntries(session.activeFlags);
    ctx.on(`${tool}:flags`, f => { flags = f || {}; });

    // Whether the placeholder hint has been cleared yet *this mount* -- see
    // the repaint-from-session block below, which sets this immediately when
    // there's already buffered history to show instead of the hint.
    let cleared = false;

    // Tells send-output.js a run just ended, once per run -- it reads the
    // result straight out of this tool's staged Project Folder output file
    // rather than from anything carried here (see send-output.js).
    function emitResults(exitCode = -1) {
      if (session.resultsEmitted) return;
      session.resultsEmitted = true;
      // Cached on the session too (not just emitted), so send-output.js can
      // recover it on a later mount even if it wasn't mounted to catch this
      // event live -- see workerSession.js.
      const payload = { exitCode };
      session.output = payload;
      ctx.emit(`${tool}:output`, payload);
    }

    // Live, not-yet-finished lines (see renderPartial below) -- stream name
    // -> that stream's <p>, local to this mount since session.partials
    // (the text) is what survives a remount, not the DOM node itself.
    const liveEls = {};

    // stream is the finalized line's own stream (every "line" frame carries
    // one -- see e.g. dirsearch-worker's _stream_lines), or omitted for a
    // line that isn't tied to a live stream at all (e.g. the synthetic
    // "[done] exit code N"/"[error] ..." lines this module appends itself
    // below).
    function appendLine(text, stream) {
      if (!cleared) { outputEl.replaceChildren(); cleared = true; }
      session.history.push(text);
      // A finalized "line" frame's text is always exactly (or a superset
      // of) whatever that same stream's live preview was already showing
      // -- both come from the same worker-side buffer, just read at
      // different points (see keepStatus/_stream_lines' own doc). If that
      // preview element still exists, promote it into the permanent line
      // in place instead of appending a second element: without this, the
      // user watches a progress bar tick up live, then sees that same
      // (often long) text appear *again* as a brand new line once it's
      // finalized -- which reads as the terminal duplicating stdout, even
      // though no frame was actually sent twice.
      const liveEl = stream != null ? liveEls[stream] : null;
      if (liveEl) {
        liveEl.textContent = text;
        liveEl.classList.remove('terminal-live');
        delete liveEls[stream];
      } else {
        const p = document.createElement('p');
        p.textContent = text;
        outputEl.append(p);
      }
      // Keep any OTHER stream's still-live partial line pinned below every
      // finished line, instead of a newly-appended line landing underneath it.
      Object.values(liveEls).forEach(el => outputEl.append(el));
      outputEl.scrollTop = outputEl.scrollHeight;
    }

    // Renders a worker's "partial" frame: the current, still-growing tail of
    // one stream (e.g. a progress bar mid-redraw) -- updated in place on its
    // own <p> instead of appending a new one each time, so it reads as a
    // live-ticking line rather than spamming the feed. An empty text clears
    // it (the worker sends this once that tail is finalized into a real
    // line, or the stream ends).
    function renderPartial(stream, text) {
      session.partials[stream] = text;
      if (!text) {
        if (liveEls[stream]) { liveEls[stream].remove(); delete liveEls[stream]; }
        return;
      }
      if (!cleared) { outputEl.replaceChildren(); cleared = true; }
      let el = liveEls[stream];
      if (!el) {
        el = document.createElement('p');
        el.className = 'terminal-live';
        liveEls[stream] = el;
      }
      el.textContent = text;
      outputEl.append(el); // (re-)append moves it to the end if already present
      outputEl.scrollTop = outputEl.scrollHeight;
    }

    function setRunning(running) {
      session.running = running;
      sendBtn.disabled = running;
      stopBtn.disabled = !running;
      pauseBtn.disabled = !running;
      inputEl.disabled = !running;
      inputBtn.disabled = !running;
      if (!running) setPaused(false);
    }

    // Pause and Unpause are one button: it reads what pressing it will do.
    function setPaused(on) {
      session.paused = on;
      pauseBtn.textContent = on ? 'Unpause' : 'Pause';
      pauseBtn.title = on ? 'Unpause the job (fg)' : 'Pause the job (Ctrl+Z)';
    }

    // POST /api/<tool>/input: one line to the running job's stdin. The worker
    // echoes it as an "input" frame, which the feed shows (see bindSocket below).
    async function sendInput() {
      const text = inputEl.value;
      if (!text) return;
      inputEl.value = '';
      try {
        const res = await fetch(`/api/${tool}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (res.status === 409) appendLine('[error] the job is not accepting input right now');
        else if (!res.ok) appendLine(`[error] input rejected: HTTP ${res.status}`);
      } catch (e) {
        appendLine('[error] could not reach the backend');
      }
    }
    inputBtn.addEventListener('click', sendInput);
    inputEl.addEventListener('keydown', evt => { if (evt.key === 'Enter') sendInput(); });

    function wsUrl(jobId) {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${location.host}/api/ws/${tool}?jobId=${encodeURIComponent(jobId)}`;
    }

    function closeSocket() {
      if (session.ws) { try { session.ws.close(); } catch (e) { /* already closing */ } }
      session.ws = null;
    }

    // (Re-)attaches this mount's handlers to a run's WebSocket -- used both
    // for a brand-new run (right after it's started below) and for picking a
    // still-open one back up on mount (see the repaint block below).
    // Property assignment (onmessage/onclose/onerror), not addEventListener,
    // is deliberate: the socket is held on `session`, so it can outlive any
    // one mount, and each mount's bindSocket() call must *replace* the
    // previous mount's handler rather than stack another one alongside it --
    // addEventListener would otherwise leave the old mount's handler (still
    // pointed at its now-detached DOM) attached too, double-processing every
    // frame into session.history once two mounts' handlers were both still
    // live.
    function bindSocket(socket) {
      socket.onmessage = evt => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch (e) { return; }
        if (msg.type === 'line') {
          appendLine(msg.text, msg.stream);
        } else if (msg.type === 'partial') {
          renderPartial(msg.stream, msg.text);
        } else if (msg.type === 'input') {
          appendLine(`> ${msg.text}`);
        } else if (msg.type === 'error') {
          appendLine(`[error] ${msg.message}`);
        } else if (msg.type === 'result') {
          appendLine(`[done] exit code ${msg.exitCode}`);
          setRunning(false);
          closeSocket();
          // send-output.js mounts independently (see index.js's
          // WORKER_COMPOSITION) -- hand the run's result lines across on
          // the shared ctx bus, same pattern as `${tool}:flags` above.
          emitResults(msg.exitCode);
        }
      };
      socket.onclose = () => { setRunning(false); session.ws = null; emitResults(); };
      socket.onerror = () => appendLine('[error] live stream connection failed');
    }

    // Repaint a run already in progress (or just finished) from the
    // session's buffered history instead of starting from the placeholder
    // hint, and pick its socket back up if the run is still going -- see the
    // module doc comment above.
    if (session.history.length) {
      outputEl.replaceChildren();
      session.history.forEach(text => {
        const p = document.createElement('p');
        p.textContent = text;
        outputEl.append(p);
      });
      outputEl.scrollTop = outputEl.scrollHeight;
      cleared = true;
    }
    Object.entries(session.partials).forEach(([stream, text]) => renderPartial(stream, text));
    setRunning(session.running);
    setPaused(session.paused);
    if (session.ws) bindSocket(session.ws);

    sendBtn.addEventListener('click', async () => {
      if (!store.current()) { appendLine('[error] select a company profile first'); return; }
      if (!Object.keys(flags).length) { appendLine('[error] build a command in the control panel first'); return; }
      setRunning(true);
      session.history = [];
      session.partials = {};
      session.resultsEmitted = false;
      cleared = false;
      outputEl.replaceChildren();
      Object.keys(liveEls).forEach(k => delete liveEls[k]);
      try {
        const res = await fetch(`/api/${tool}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // interactive: stdin stays open for this run, so the Answer line can reach the tool.
          body: JSON.stringify({ profileId: store.current().id, flags, interactive: true }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          appendLine(`[error] ${body.error || 'failed to start run'}`);
          setRunning(false);
          emitResults();
          return;
        }
        session.ws = new WebSocket(wsUrl(body.jobId));
        bindSocket(session.ws);
      } catch (e) {
        appendLine('[error] could not reach the backend');
        setRunning(false);
      }
    });

    // Ctrl+Z (pause) or fg (unpause) on the running job. The worker answers 409
    // when the job is not in the state asked for, and the button stays as it was.
    pauseBtn.addEventListener('click', async () => {
      const resuming = session.paused;
      try {
        const res = await fetch(`/api/${tool}/${resuming ? 'resume' : 'pause'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (res.ok) {
          setPaused(!resuming);
          appendLine(resuming ? '[resumed] job continued (fg)' : '[paused] job suspended (Ctrl+Z); press Unpause to continue');
        } else {
          appendLine(`[error] ${res.status === 409 ? 'the job is not in a state to ' + (resuming ? 'unpause' : 'pause') : 'pause request failed'}`);
        }
      } catch (e) {
        appendLine('[error] could not reach the backend');
      }
    });

    // Ctrl+C on the job. The terminal stays open; the result frame ends the run
    // and re-enables Send so the user can change the flags and start over.
    stopBtn.addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/${tool}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (res.ok) appendLine('[stopping] Ctrl+C sent to the job');
        else appendLine('[error] no running job to stop');
      } catch (e) {
        appendLine('[error] could not reach the backend');
      }
    });
  },
};
