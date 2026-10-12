// Shared, dependency-free state module. Imported by multiple components
// (profile, ledger, chat) — ES module caching guarantees a single instance
// is ever constructed, so no component re-initializes or duplicates it.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const PROFILES_KEY = 'fr-profiles';
const PROFILE_KEY = 'fr-profile';

let profiles = [];
let profileId = null;
try {
  const p = JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
  if (Array.isArray(p)) profiles = p.filter(x => x && x.id && x.name);
  profileId = localStorage.getItem(PROFILE_KEY);
} catch (e) { /* storage unavailable; fall back to in-memory state */ }
if (!profiles.some(x => x.id === profileId)) profileId = profiles[0] ? profiles[0].id : null;

const listeners = new Set();
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { /* isolate subscriber errors */ } }); }

function persist() {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
    if (profileId) localStorage.setItem(PROFILE_KEY, profileId); else localStorage.removeItem(PROFILE_KEY);
  } catch (e) { /* ignore */ }
}

export const store = {
  uid,
  get profiles() { return profiles; },
  get profileId() { return profileId; },
  current() { return profiles.find(x => x.id === profileId); },
  select(id) { profileId = id; persist(); emit(); },
  add(name) {
    const pr = { id: uid(), name };
    profiles.push(pr);
    profileId = pr.id;
    persist(); emit();
    return pr;
  },
  remove(id) {
    profiles = profiles.filter(x => x.id !== id);
    try { localStorage.removeItem('fr-sessions:' + id); } catch (e) { /* ignore */ }
    if (profileId === id) profileId = profiles[0] ? profiles[0].id : null;
    persist(); emit();
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
