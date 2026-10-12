import { chatState } from '../chatState.js';

export default {
  id: 'chat-toggle',
  css: 'static/chat.css',
  critical: false,
  mount(container, ctx) {
    container.innerHTML = `
      <button class="icon-btn chat-toggle" id="chat-toggle" aria-expanded="false" aria-controls="chat-sidebar" aria-label="Toggle AI chat" title="Toggle AI chat">
        <span aria-hidden="true">[</span>
        <img src="icons/icons8-chatbot-24.png" alt="" width="20" height="20">
        <span aria-hidden="true">]</span>
      </button>`;
    const btn = container.querySelector('#chat-toggle');
    const sync = open => btn.setAttribute('aria-expanded', String(open));
    btn.addEventListener('click', () => chatState.toggle());
    // The menu's "Toggle AI Chat" action reuses this same intent — chat.js
    // itself only ever reacts to chatState, so there is exactly one writer
    // per trigger and no double-toggle.
    ctx.on('chat:toggle', () => chatState.toggle());
    chatState.subscribe(sync);
    sync(chatState.open);
  },
};
