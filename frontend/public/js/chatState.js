// Shared open/closed state for the chat sidebar. Both the header toggle
// button and the chat panel itself need to read/drive this, so it lives in
// its own module rather than being owned by either component.
const listeners = new Set();
let open = false;
try { open = localStorage.getItem('fr-chat') === '1'; } catch (e) { /* ignore */ }

export const chatState = {
  get open() { return open; },
  set(value) {
    open = !!value;
    try { localStorage.setItem('fr-chat', open ? '1' : '0'); } catch (e) { /* ignore */ }
    listeners.forEach(fn => { try { fn(open); } catch (e) { /* isolate subscriber errors */ } });
  },
  toggle() { chatState.set(!open); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
