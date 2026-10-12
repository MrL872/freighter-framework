// Settings dialog, opened from the header's [ settings ] menu.
//
// The browser never reads or writes settings files. Every value goes through the
// backend's /api/settings endpoints, and the backend checks it and does the
// writing. The Telegram token is write-only: the dialog shows whether one is set,
// and the field is cleared after each save.

const CSS_HREF = 'static/settings.css';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

async function api(path, init) {
  const res = await fetch('/api/settings' + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (HTTP ${res.status})`);
  return data;
}

function ensureStylesheet() {
  if (document.querySelector(`link[data-settings-css]`)) return;
  const link = el('link');
  link.rel = 'stylesheet';
  link.href = CSS_HREF;
  link.dataset.settingsCss = '1';
  document.head.append(link);
}

// Tells other components (Send Output's chat list) that the settings changed.
function announce() {
  document.dispatchEvent(new CustomEvent('settings:changed'));
}

// section is 'telegram' or 'mcp'. Each menu item opens the dialog with only its own section.
export async function openSettings(section = 'telegram') {
  if (document.querySelector('.settings-overlay')) return;
  ensureStylesheet();

  const overlay = el('div', 'settings-overlay');
  const panel = el('div', 'settings-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'settings-title');

  const head = el('header', 'settings-head');
  const title = el('h2', null, section === 'mcp' ? 'MCP gateway' : 'Telegram bot');
  title.id = 'settings-title';
  const close = el('button', 'settings-close', '[x]');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close settings');
  head.append(title, close);

  // --- Telegram ------------------------------------------------------------
  const tgSection = el('section', 'settings-section');
  tgSection.setAttribute('aria-label', 'Telegram bot');
  tgSection.append(el('h3', null, 'Telegram bot'));
  const tgStatus = el('p', 'settings-status', 'loading…');
  const tokenLabel = el('label', 'settings-field');
  tokenLabel.append(el('span', null, 'Bot token'));
  const tokenInput = el('input');
  tokenInput.type = 'text';
  tokenInput.autocomplete = 'off';
  tokenInput.placeholder = 'paste a token to set or change it';
  tokenInput.setAttribute('aria-label', 'Bot token');
  tokenLabel.append(tokenInput);
  const chatsWrap = el('div', 'settings-chats');
  const chatsHead = el('div', 'settings-chats-head');
  chatsHead.append(el('span', null, 'Chats'));
  const addChat = el('button', 'settings-add', '[+]');
  addChat.type = 'button';
  addChat.title = 'Add another chat';
  addChat.setAttribute('aria-label', 'Add another chat');
  chatsHead.append(addChat);
  const chatRows = el('div', 'settings-chat-rows');
  chatsWrap.append(chatsHead, chatRows);
  const tgSave = el('button', 'settings-save', 'save telegram');
  tgSave.type = 'button';
  const tgMsg = el('p', 'settings-msg');
  tgMsg.setAttribute('role', 'status');
  tgSection.append(tgStatus, tokenLabel, chatsWrap, tgSave, tgMsg);

  // --- MCP gateway ---------------------------------------------------------
  const mcpSection = el('section', 'settings-section');
  mcpSection.setAttribute('aria-label', 'MCP gateway');
  mcpSection.append(el('h3', null, 'MCP gateway'));
  const timeoutLabel = el('label', 'settings-field');
  timeoutLabel.append(el('span', null, 'Default timeout (seconds)'));
  const timeoutInput = el('input');
  timeoutInput.type = 'number';
  timeoutInput.min = '1';
  timeoutInput.max = '86400';
  timeoutLabel.append(timeoutInput);
  const workerList = el('div', 'settings-workers');
  workerList.setAttribute('aria-label', 'Workers offered over MCP');
  const mcpSave = el('button', 'settings-save', 'save mcp');
  mcpSave.type = 'button';
  const mcpMsg = el('p', 'settings-msg');
  mcpMsg.setAttribute('role', 'status');
  mcpSection.append(timeoutLabel, el('p', 'settings-hint', 'Unchecked workers are hidden from MCP clients.'), workerList, mcpSave, mcpMsg);

  // --- Cloud model (the chat agent's Anthropic backend) --------------------
  mcpSection.append(el('h4', null, 'Cloud model'));
  const llmStatus = el('p', 'settings-status', 'loading…');
  const cloudToggle = el('label', 'settings-toggle');
  const cloudBox = el('input');
  cloudBox.type = 'checkbox';
  cloudBox.setAttribute('aria-label', 'Enable cloud model');
  cloudToggle.append(cloudBox, el('span', null, 'Enable cloud model (Anthropic)'));
  const apiKeyLabel = el('label', 'settings-field');
  apiKeyLabel.append(el('span', null, 'API key'));
  const apiKeyInput = el('input');
  apiKeyInput.type = 'password';
  apiKeyInput.autocomplete = 'off';
  apiKeyInput.placeholder = 'paste a key to set or change it';
  apiKeyInput.setAttribute('aria-label', 'Cloud model API key');
  apiKeyLabel.append(apiKeyInput);
  const llmSave = el('button', 'settings-save', 'save cloud model');
  llmSave.type = 'button';
  const llmForget = el('button', 'settings-save', 'forget cloud model');
  llmForget.type = 'button';
  llmForget.title = 'Turn off the cloud model and delete its saved API key';
  const llmSaveRow = el('div', 'settings-save-row');
  llmSaveRow.append(llmSave, llmForget);
  const llmMsg = el('p', 'settings-msg');
  llmMsg.setAttribute('role', 'status');
  mcpSection.append(llmStatus, cloudToggle, apiKeyLabel, llmSaveRow, llmMsg);

  // --- Local model (LM Studio, Ollama, or any other OpenAI-compatible server) ---
  mcpSection.append(el('h4', null, 'Local model'));
  const localStatus = el('p', 'settings-status', 'loading…');
  const localToggle = el('label', 'settings-toggle');
  const localBox = el('input');
  localBox.type = 'checkbox';
  localBox.setAttribute('aria-label', 'Enable local model');
  localToggle.append(localBox, el('span', null, 'Enable local model (OpenAI-compatible)'));
  const localUrlLabel = el('label', 'settings-field');
  localUrlLabel.append(el('span', null, 'Base URL'));
  const localUrlInput = el('input');
  localUrlInput.type = 'text';
  localUrlInput.autocomplete = 'off';
  localUrlInput.placeholder = 'http://host.docker.internal:1234 (gets /v1 appended if missing)';
  localUrlInput.setAttribute('aria-label', 'Local model base URL');
  localUrlLabel.append(localUrlInput);
  // host.docker.internal is the one address that reliably reaches the host
  // from inside the backend's container network on every platform (Docker
  // Desktop defines it for free; docker-compose.yml sets it up for Linux's
  // Docker Engine too -- see MANUAL.md section 7.12). A host-specific
  // gateway/bridge IP, such as a WSL vEthernet address, may work from the
  // browser's own machine but still be unreachable from the backend
  // container, which is the confusing part worth calling out here.
  const localUrlHint = el('p', 'settings-hint',
    'Reaching a server on this machine? Use host.docker.internal (e.g. http://host.docker.internal:1234), not a gateway/bridge IP -- that\'s reachable from the backend container, the IP usually isn\'t.');
  const localKeyLabel = el('label', 'settings-field');
  localKeyLabel.append(el('span', null, 'API key (usually not needed)'));
  const localKeyInput = el('input');
  localKeyInput.type = 'password';
  localKeyInput.autocomplete = 'off';
  localKeyInput.placeholder = 'paste a key to set or change it';
  localKeyInput.setAttribute('aria-label', 'Local model API key');
  localKeyLabel.append(localKeyInput);
  const localModelLabel = el('label', 'settings-field');
  localModelLabel.append(el('span', null, 'Model'));
  const localModelRow = el('div', 'settings-model-row');
  const localModelSelect = el('select');
  localModelSelect.setAttribute('aria-label', 'Local model id');
  const localFetchBtn = el('button', null, '[Fetch models]');
  localFetchBtn.type = 'button';
  localFetchBtn.title = 'Ask the server at Base URL which models it has loaded';
  localModelRow.append(localModelSelect, localFetchBtn);
  localModelLabel.append(localModelRow);
  const localSave = el('button', 'settings-save', 'save local model');
  localSave.type = 'button';
  const localForget = el('button', 'settings-save', 'forget local model');
  localForget.type = 'button';
  localForget.title = 'Turn off the local model and delete its saved base URL, API key and model id';
  const localSaveRow = el('div', 'settings-save-row');
  localSaveRow.append(localSave, localForget);
  const localMsg = el('p', 'settings-msg');
  localMsg.setAttribute('role', 'status');
  mcpSection.append(localStatus, localToggle, localUrlLabel, localUrlHint, localKeyLabel, localModelLabel, localSaveRow, localMsg);

  tgSection.hidden = section !== 'telegram';
  mcpSection.hidden = section !== 'mcp';
  panel.append(head, tgSection, mcpSection);
  overlay.append(panel);
  document.body.append(overlay);

  // --- state and rendering -------------------------------------------------
  function addRow(label = '', chatId = '') {
    const row = el('div', 'settings-chat-row');
    const l = el('input');
    l.placeholder = 'label';
    l.value = label;
    l.setAttribute('aria-label', 'Chat label');
    const id = el('input');
    id.placeholder = '-1001234567890 or @channel';
    id.value = chatId;
    id.setAttribute('aria-label', 'Chat id');
    const remove = el('button', 'settings-remove', '[x]');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove chat');
    remove.onclick = () => row.remove();
    row.append(l, id, remove);
    chatRows.append(row);
    return row;
  }
  function readRows() {
    return [...chatRows.querySelectorAll('.settings-chat-row')].map(row => {
      const [label, chatId] = row.querySelectorAll('input');
      return { label: label.value, chatId: chatId.value };
    });
  }

  async function load() {
    try {
      const data = await api('');
      const tg = data.telegram;
      tgStatus.textContent = tg.configured
        ? `Configured · ${tg.chats.length} chat${tg.chats.length === 1 ? '' : 's'}`
        : 'Not configured. Paste a bot token and add at least one chat.';
      tgStatus.dataset.state = tg.configured ? 'ok' : 'off';
      chatRows.replaceChildren();
      tg.chats.forEach(c => addRow(c.label, c.chatId));
      if (!tg.chats.length) addRow();

      timeoutInput.value = data.mcp.defaultTimeoutSeconds;
      workerList.replaceChildren();
      data.mcp.workers.forEach(w => {
        const label = el('label', 'settings-worker');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = w.enabled;
        box.dataset.worker = w.name;
        label.append(box, el('span', null, `${w.name}`), el('span', 'settings-mode', w.mode));
        workerList.append(label);
      });

      const llm = data.llm;
      cloudBox.checked = llm.cloudEnabled;
      llmStatus.textContent = llm.cloudEnabled
        ? (llm.configured ? 'On · API key is set' : 'On, but no API key is set')
        : 'Off';
      llmStatus.dataset.state = llm.cloudEnabled && llm.configured ? 'ok' : 'off';

      const local = data.localLlm;
      localBox.checked = local.enabled;
      localUrlInput.value = local.baseUrl;
      setModelOptions(local.model ? [local.model] : [], local.model);
      localStatus.textContent = local.enabled
        ? (local.configured ? `On · ${local.baseUrl}${local.keySet ? ' · key set' : ''}` : 'On, but no base URL/model is set')
        : 'Off';
      localStatus.dataset.state = local.enabled && local.configured ? 'ok' : 'off';
    } catch (err) {
      tgStatus.textContent = 'Could not load settings: ' + err.message;
    }
  }

  // Replaces the model dropdown's options with `ids`, keeping `selected`
  // as an option (even if `ids` doesn't include it, e.g. it's what's saved
  // but a fresh [Fetch models] came back without it -- a stale/renamed
  // model shouldn't just silently vanish from the field) and selected.
  function setModelOptions(ids, selected) {
    const all = selected && !ids.includes(selected) ? [selected, ...ids] : ids;
    localModelSelect.replaceChildren();
    if (!all.length) {
      localModelSelect.append(el('option', null, 'Fetch models, or none saved yet'));
      localModelSelect.value = '';
      return;
    }
    all.forEach(id => {
      const opt = el('option', null, id);
      opt.value = id;
      localModelSelect.append(opt);
    });
    localModelSelect.value = selected || all[0];
  }

  async function saveTelegram() {
    tgMsg.textContent = '';
    tgSave.disabled = true;
    try {
      const token = tokenInput.value.trim();
      const body = await api('/telegram', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token || null, chats: readRows().filter(r => r.chatId.trim()) }),
      });
      tokenInput.value = '';
      tgMsg.textContent = `Saved. ${body.configured ? 'Bot configured' : 'No bot token set'}.`;
      await load();
      announce();
    } catch (err) {
      tgMsg.textContent = err.message;
    } finally {
      tgSave.disabled = false;
    }
  }

  async function saveMcp() {
    mcpMsg.textContent = '';
    mcpSave.disabled = true;
    try {
      const workers = {};
      workerList.querySelectorAll('input[type=checkbox]').forEach(b => { workers[b.dataset.worker] = b.checked; });
      await api('/mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultTimeoutSeconds: Number(timeoutInput.value), workers }),
      });
      mcpMsg.textContent = 'Saved. The gateway picks up the change on its next request.';
    } catch (err) {
      mcpMsg.textContent = err.message;
    } finally {
      mcpSave.disabled = false;
    }
  }

  async function saveLlm() {
    llmMsg.textContent = '';
    llmSave.disabled = true;
    try {
      const apiKey = apiKeyInput.value.trim();
      const body = await api('/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cloudEnabled: cloudBox.checked, apiKey: apiKey || null }),
      });
      apiKeyInput.value = '';
      llmMsg.textContent = `Saved. Cloud model is ${body.cloudEnabled ? 'on' : 'off'}${body.cloudEnabled && !body.configured ? ' (no API key set)' : ''}.`;
      await load();
      announce();
    } catch (err) {
      llmMsg.textContent = err.message;
    } finally {
      llmSave.disabled = false;
    }
  }

  // Same two-click arm-then-confirm pattern as profile.js's own delete
  // button: the first click only asks "sure?"; a second click (or Enter,
  // since this is a real button) actually sends the request. Losing focus
  // before that second click resets it, so leaving the field armed and
  // clicking elsewhere never fires it by accident.
  function armThenConfirm(btn, defaultLabel, onConfirm) {
    btn.addEventListener('click', () => {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = 'sure?';
        return;
      }
      btn.dataset.armed = '';
      btn.textContent = defaultLabel;
      onConfirm();
    });
    btn.addEventListener('blur', () => { btn.dataset.armed = ''; btn.textContent = defaultLabel; });
  }

  async function forgetLlm() {
    llmMsg.textContent = '';
    llmForget.disabled = true;
    try {
      await api('/llm', { method: 'DELETE' });
      apiKeyInput.value = '';
      llmMsg.textContent = 'Cloud model connection forgotten.';
      await load();
      announce();
    } catch (err) {
      llmMsg.textContent = err.message;
    } finally {
      llmForget.disabled = false;
    }
  }

  // Asks the server at the Base URL field (not necessarily saved yet) what
  // models it has loaded, so the dropdown can be filled before [save local
  // model] is ever pressed. The API key field is sent along unsaved too --
  // this is a plain lookup, not a save.
  async function fetchLocalModels() {
    localMsg.textContent = '';
    const baseUrl = localUrlInput.value.trim();
    if (!baseUrl) {
      localMsg.textContent = 'Enter a base URL first.';
      return;
    }
    localFetchBtn.disabled = true;
    localFetchBtn.textContent = '[Fetching…]';
    try {
      const apiKey = localKeyInput.value.trim();
      const body = await api('/llm-local/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || null }),
      });
      localUrlInput.value = body.baseUrl;
      const previous = localModelSelect.value;
      setModelOptions(body.models, body.models.includes(previous) ? previous : body.models[0]);
      localMsg.textContent = body.models.length ? `Found ${body.models.length} model${body.models.length === 1 ? '' : 's'}.` : 'Server reached, but it reported no models.';
    } catch (err) {
      localMsg.textContent = err.message;
    } finally {
      localFetchBtn.disabled = false;
      localFetchBtn.textContent = '[Fetch models]';
    }
  }

  async function saveLocalLlm() {
    localMsg.textContent = '';
    localSave.disabled = true;
    try {
      const apiKey = localKeyInput.value.trim();
      const body = await api('/llm-local', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: localBox.checked,
          baseUrl: localUrlInput.value.trim() || null,
          apiKey: apiKey || null,
          model: localModelSelect.value || null,
        }),
      });
      localKeyInput.value = '';
      localMsg.textContent = `Saved. Local model is ${body.enabled ? 'on' : 'off'}${body.enabled && !body.configured ? ' (base URL/model not set)' : ''}.`;
      await load();
      announce();
    } catch (err) {
      localMsg.textContent = err.message;
    } finally {
      localSave.disabled = false;
    }
  }

  async function forgetLocalLlm() {
    localMsg.textContent = '';
    localForget.disabled = true;
    try {
      await api('/llm-local', { method: 'DELETE' });
      localKeyInput.value = '';
      localMsg.textContent = 'Local model connection forgotten.';
      await load();
      announce();
    } catch (err) {
      localMsg.textContent = err.message;
    } finally {
      localForget.disabled = false;
    }
  }

  // --- wiring --------------------------------------------------------------
  function closeDialog() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(e) { if (e.key === 'Escape') closeDialog(); }
  close.addEventListener('click', closeDialog);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
  document.addEventListener('keydown', onKey);
  addChat.addEventListener('click', () => { addRow().querySelector('input').focus(); });
  tgSave.addEventListener('click', saveTelegram);
  mcpSave.addEventListener('click', saveMcp);
  llmSave.addEventListener('click', saveLlm);
  armThenConfirm(llmForget, 'forget cloud model', forgetLlm);
  localFetchBtn.addEventListener('click', fetchLocalModels);
  localSave.addEventListener('click', saveLocalLlm);
  armThenConfirm(localForget, 'forget local model', forgetLocalLlm);

  close.focus();
  await load();
}
