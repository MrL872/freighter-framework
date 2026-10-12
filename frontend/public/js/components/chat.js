import { store } from '../store.js';
import { chatState } from '../chatState.js';

// Chat sidebar. Two ways to act:
//   "/<worker> <args>"  runs that worker through the MCP gateway, no model involved.
//   anything else       goes to the model (mode: ask, agent or plan). In agent mode
//                       the model may run worker tools, and each run appears as a card.
// Every tool card has a Review button, which asks the model to summarize that output.

// Tool output sent back to the model with later messages. The backend caps it too.
const HISTORY_OUTPUT_LIMIT = 16 * 1024;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function ago(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
}
async function api(path, body) {
  const init = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch('/api' + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (HTTP ${res.status})`);
  return data;
}
// "/nmap -p 80 "example com"" -> worker "nmap", args ["-p", "80", "example com"]
function parseCommand(text) {
  const m = /^\/(\S+)\s*(.*)$/.exec(text);
  if (!m) return null;
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let t;
  while ((t = re.exec(m[2])) !== null) args.push(t[1] ?? t[2] ?? t[3]);
  return { worker: m[1], args };
}

export default {
  id: 'chat',
  css: 'static/chat.css',
  critical: false,
  mount(container, ctx) {
    container.innerHTML = `
      <div class="chat-inner">
        <div class="chat-bar">
          <button class="tool-btn" id="sessions-toggle" aria-pressed="false" title="Sessions" aria-label="Show sessions">[=]</button>
          <button class="title" id="session-title" title="Show sessions">New chat</button>
          <button class="tool-btn" id="new-session" title="New chat" aria-label="New chat">[+]</button>
        </div>
        <section id="sessions-view" hidden aria-label="Sessions">
          <div class="sessions-head"><span>Sessions</span><span id="sessions-count"></span></div>
          <ul id="sessions-list"></ul>
        </section>
        <section id="chat-view">
          <div id="chat-log" aria-live="polite"></div>
          <form class="composer" id="chat-form" autocomplete="off">
            <textarea id="chat-input" rows="2" placeholder="Ask, or run a tool with /worker args" aria-label="Message"></textarea>
            <div class="composer-bar">
              <select id="chat-mode" aria-label="Mode">
                <option value="ask">ask</option><option value="agent">agent</option><option value="plan">plan</option>
              </select>
              <select id="chat-model" aria-label="Model"><option value="">loading models…</option></select>
              <span class="spacer"></span>
              <button class="send" id="send-btn" type="submit" disabled>send</button>
            </div>
          </form>
          <div class="hint">Enter to send &middot; Shift+Enter for newline &middot; /worker args runs a tool directly</div>
        </section>
      </div>`;

    const logEl = container.querySelector('#chat-log');
    const titleEl = container.querySelector('#session-title');
    const sessionsView = container.querySelector('#sessions-view');
    const chatView = container.querySelector('#chat-view');
    const sessionsToggle = container.querySelector('#sessions-toggle');
    const listEl = container.querySelector('#sessions-list');
    const sendBtn = container.querySelector('#send-btn');
    const chatForm = container.querySelector('#chat-form');
    const chatBox = container.querySelector('#chat-input');
    const modeSel = container.querySelector('#chat-mode');
    const modelSel = container.querySelector('#chat-model');

    // ---- models -------------------------------------------------------------
    let models = [];
    const modelReady = () => models.length > 0;
    async function loadModels() {
      try { models = await api('/chat/models'); } catch (e) { models = []; }
      modelSel.replaceChildren();
      if (!models.length) {
        modelSel.append(el('option', null, 'no model configured'));
        modelSel.value = '';
      } else {
        models.forEach(m => {
          const o = el('option', null, m.provider + ' · ' + m.model);
          o.value = m.provider + '|' + m.model;
          modelSel.append(o);
        });
      }
      syncSend();
    }
    const selectedModel = () => {
      const [provider, model] = (modelSel.value || '|').split('|');
      return { provider, model };
    };

    // ---- sessions (stored in this browser only) -----------------------------
    const sessionsKey = () => 'fr-sessions:' + (store.profileId || '_none');
    let sessions = [], activeId = null;
    function loadSessions() {
      sessions = []; activeId = null;
      try { const d = JSON.parse(localStorage.getItem(sessionsKey()) || 'null'); if (d) { sessions = d.sessions || []; activeId = d.activeId; } } catch (e) { /* ignore */ }
      if (!sessions.some(x => x.id === activeId)) activeId = sessions[0] ? sessions[0].id : null;
    }
    loadSessions();
    const save = () => { try { localStorage.setItem(sessionsKey(), JSON.stringify({ sessions, activeId })); } catch (e) { /* ignore */ } };
    const current = () => sessions.find(x => x.id === activeId);

    function newSession() {
      const c = current();
      if (c && !c.messages.length) { showSessions(false); return c; }
      const n = { id: store.uid(), title: 'New chat', updated: Date.now(), messages: [] };
      sessions.unshift(n);
      activeId = n.id;
      save(); renderAll(); showSessions(false);
      return n;
    }
    function showSessions(show) {
      sessionsView.hidden = !show;
      chatView.hidden = show;
      sessionsToggle.setAttribute('aria-pressed', String(show));
      if (show) renderSessions(); else chatBox.focus();
    }

    // ---- rendering ----------------------------------------------------------
    function renderMessage(m) {
      if (m.role === 'tool') return renderTool(m);
      const d = el('div', 'msg ' + m.role);
      const who = m.role === 'user' ? 'you' : m.role === 'ai' ? 'ai' : 'error';
      d.append(el('span', 'who', who), el('div', 'body', m.text));
      return d;
    }
    function renderTool(m) {
      const t = m.tool;
      const r = t.result || {};
      const d = el('div', 'msg tool');
      const stateText = [r.state || 'unknown', r.exitCode != null ? 'exit ' + r.exitCode : '', r.error || ''].filter(Boolean).join(' · ');
      const details = document.createElement('details');
      details.append(el('summary', null, 'output'), el('pre', 'tool-output', r.output || '(no output)'));
      const review = el('button', 'tool-review', 'Review');
      review.type = 'button';
      review.disabled = !modelReady() || busy;
      review.title = modelReady() ? 'Ask the model to summarize this output' : 'No model configured';
      review.onclick = () => reviewCard(m);
      d.append(el('div', 'tool-head', 'tool · ' + t.worker + (t.args.length ? ' ' + t.args.join(' ') : '')), el('div', 'tool-state', stateText), details, review);
      return d;
    }
    function renderLog() {
      const c = current();
      titleEl.textContent = c ? c.title : 'New chat';
      logEl.replaceChildren();
      if (!c || !c.messages.length) {
        const e = el('div', 'empty');
        e.append(el('h3', null, 'Docker MCP Gateway'), el('div', null, 'Ask a question, or run a tool directly with /worker and its arguments, for example /subfinder -d example.com.'));
        logEl.append(e);
        return;
      }
      c.messages.forEach(m => logEl.append(renderMessage(m)));
      logEl.scrollTop = logEl.scrollHeight;
    }
    function renderSessions() {
      container.querySelector('#sessions-count').textContent = sessions.length;
      listEl.replaceChildren();
      if (!sessions.length) { listEl.append(el('li', 'sessions-empty', 'No sessions yet. Press [+] to start one.')); return; }
      sessions.forEach(x => {
        const li = el('li', 'session' + (x.id === activeId ? ' active' : ''));
        const open = el('button', 'open');
        open.type = 'button';
        open.append(el('span', 'name', x.title), el('span', 'meta', x.messages.length + ' msg · ' + ago(x.updated)));
        open.onclick = () => { activeId = x.id; save(); renderLog(); showSessions(false); };
        const ren = el('button', 'tool-btn', 'ren'); ren.type = 'button'; ren.title = 'Rename';
        ren.onclick = () => {
          const inp = el('input', 'rename-input'); inp.value = x.title; inp.setAttribute('aria-label', 'Rename session');
          let finished = false;
          const done = ok => {
            if (finished) return; finished = true;
            if (ok && inp.value.trim()) { x.title = inp.value.trim(); save(); }
            renderLog(); renderSessions();
          };
          inp.onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
          inp.onblur = () => done(true);
          open.replaceWith(inp); inp.focus(); inp.select();
        };
        const del = el('button', 'tool-btn', 'del'); del.type = 'button'; del.title = 'Delete';
        del.onclick = () => {
          if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'sure?'; del.style.visibility = 'visible'; return; }
          sessions = sessions.filter(s => s !== x);
          if (activeId === x.id) activeId = sessions[0] ? sessions[0].id : null;
          save(); renderLog(); renderSessions();
        };
        del.onblur = () => { del.dataset.armed = ''; del.textContent = 'del'; del.style.visibility = ''; };
        li.append(open, ren, del);
        listEl.append(li);
      });
    }
    function renderAll() { renderLog(); if (!sessionsView.hidden) renderSessions(); }

    // ---- sending ------------------------------------------------------------
    let busy = false;
    function syncSend() {
      sendBtn.disabled = busy || !chatBox.value.trim();
      sendBtn.textContent = busy ? 'working…' : 'send';
      chatBox.disabled = busy;
    }
    function setBusy(value) {
      busy = value;
      syncSend();
      renderLog();
    }

    // What the model sees from earlier turns: user and AI text, plus earlier tool output as context.
    function historyFor(c) {
      const out = [];
      c.messages.forEach(m => {
        if (m.role === 'user' || m.role === 'ai') out.push({ role: m.role, text: m.text });
        else if (m.role === 'tool') {
          const r = m.tool.result || {};
          const output = (r.output || '').slice(-HISTORY_OUTPUT_LIMIT);
          out.push({ role: 'user', text: `[tool ${m.tool.worker} ${m.tool.args.join(' ')}] state=${r.state} exit=${r.exitCode}\n${output}` });
        }
      });
      return out;
    }

    async function askModel(c) {
      const { provider, model } = selectedModel();
      if (!provider) throw new Error('no model is configured on the server, so only /worker commands can run');
      const body = await api('/chat/message', { provider, model, mode: modeSel.value, messages: historyFor(c) });
      (body.toolRuns || []).forEach(run => c.messages.push({ role: 'tool', tool: { worker: run.worker, args: run.args, result: run.result } }));
      c.messages.push({ role: 'ai', text: body.text || '(no text in the reply)' });
    }

    async function runCommand(c, text) {
      const cmd = parseCommand(text);
      if (!cmd || !cmd.worker) throw new Error('usage: /worker arg1 arg2 ...');
      const result = await api('/chat/command', { worker: cmd.worker, args: cmd.args });
      c.messages.push({ role: 'tool', tool: { worker: cmd.worker, args: cmd.args, result } });
    }

    async function reviewCard(m) {
      const c = current();
      if (!c || busy) return;
      const { provider, model } = selectedModel();
      setBusy(true);
      try {
        const body = await api('/chat/review', { provider, model, worker: m.tool.worker, result: m.tool.result.output || '' });
        c.messages.push({ role: 'ai', text: 'Review of ' + m.tool.worker + ':\n' + body.text });
      } catch (err) {
        c.messages.push({ role: 'error', text: err.message });
      } finally {
        setBusy(false);
        c.updated = Date.now(); save();
      }
    }

    chatBox.addEventListener('input', () => {
      chatBox.style.height = 'auto';
      chatBox.style.height = Math.min(chatBox.scrollHeight, 160) + 'px';
      syncSend();
    });
    chatBox.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatForm.requestSubmit(); }
    });
    chatForm.addEventListener('submit', async e => {
      e.preventDefault();
      const text = chatBox.value.trim();
      if (!text || busy) return;
      const c = current() || newSession();
      if (!c.messages.length) c.title = text.length > 40 ? text.slice(0, 40) + '…' : text;
      c.messages.push({ role: 'user', text });
      chatBox.value = '';
      chatBox.dispatchEvent(new Event('input'));
      setBusy(true);
      save();
      try {
        if (text.startsWith('/')) await runCommand(c, text);
        else await askModel(c);
      } catch (err) {
        c.messages.push({ role: 'error', text: err.message });
      } finally {
        setBusy(false);
        c.updated = Date.now(); save();
      }
    });
    sessionsToggle.addEventListener('click', () => showSessions(sessionsView.hidden));
    titleEl.addEventListener('click', () => showSessions(sessionsView.hidden));
    container.querySelector('#new-session').addEventListener('click', newSession);
    renderLog();
    syncSend();
    loadModels();
    // The Settings dialog's cloud-model toggle/API key take effect immediately on
    // the backend; re-fetch so the model dropdown reflects it without a page reload.
    document.addEventListener('settings:changed', loadModels);

    // Sidebar open/close is driven by the shared chatState module; this component only reacts to it.
    const sidebar = document.getElementById('chat-sidebar');
    function applyOpen(open) {
      sidebar.classList.toggle('open', open);
      sidebar.setAttribute('aria-hidden', String(!open));
      sidebar.inert = !open;
      if (open && (chatBox.offsetParent !== null || !chatView.hidden)) chatBox.focus();
    }
    chatState.subscribe(applyOpen);
    applyOpen(chatState.open);
    ctx.on('chat:new', () => { chatState.set(true); newSession(); });

    store.subscribe(() => { loadSessions(); sessionsView.hidden = true; chatView.hidden = false; sessionsToggle.setAttribute('aria-pressed', 'false'); renderLog(); });
  },
};
