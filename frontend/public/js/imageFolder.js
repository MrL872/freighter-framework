// Per-profile Image Storage. Real image files on disk under the backend's
// image-storage directory (see ImageFileService/ImagesController on the
// backend ), kept as a separate module
// (and a separate storage directory) from Project Folder because it holds a
// distinct kind of artifact (gowitness screenshots) that the rest of the UI
// should never mix into the plain-text Project Folder list. The frontend
// never touches that directory directly — every read/write goes through the
// backend's REST endpoints below.
import { store } from './store.js';

// Entries saved before `id` existed have none — fall back to a value that's
// still unique per entry so rename/remove can address them without needing
// a migration write first.
function idOf(file) { return file.id || `${file.name}:${file.savedAt}`; }

async function throwOnError(res) {
  if (res.ok) return res;
  let message = `request failed: ${res.status}`;
  try { message = (await res.json()).error || message; } catch (e) { /* body wasn't JSON */ }
  throw new Error(message);
}

export const imageFolder = {
  available() { return !!store.current(); },
  idOf,

  // Each entry's `content` is set to a URL (GET
  // /api/images/{profileId}/{id}) the browser fetches the actual image
  // bytes from on demand — e.g. set directly as an <img>'s src — not an
  // embedded data: URL, so listing a profile's images doesn't require
  // downloading every one of them up front. Built here rather than trusted
  // verbatim from the backend's own response: the backend's path is
  // "/images/..." from its own point of view, and only frontend/server.js
  // knows that the browser-facing route needs the "/api" prefix its proxy
  // strips before forwarding (same as every other fetch() in this module).
  async list(profileId = store.profileId) {
    if (!profileId) return [];
    try {
      const res = await fetch(`/api/images?profileId=${encodeURIComponent(profileId)}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return []; // includes "no profile" edge cases — nothing saved yet
      const value = await res.json();
      if (!Array.isArray(value)) return [];
      return value.map(entry => ({ ...entry, content: `/api/images/${encodeURIComponent(profileId)}/${encodeURIComponent(entry.id)}` }));
    } catch (e) {
      return [];
    }
  },

  async rename(id, name) {
    const profileId = store.profileId;
    if (!profileId) throw new Error('no profile selected');
    const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, name }),
      signal: AbortSignal.timeout(5000),
    });
    await throwOnError(res);
    return res.json();
  },

  async remove(id) {
    const profileId = store.profileId;
    if (!profileId) throw new Error('no profile selected');
    const res = await fetch(`/api/images/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 404) await throwOnError(res);
  },

  // Deletes every screenshot the given profile has saved — called when the
  // company profile itself is deleted (see profile.js), so its images don't
  // linger on disk forever under a profile id nothing can address again.
  async deleteProfile(profileId) {
    if (!profileId) return;
    const res = await fetch(`/api/images/profile/${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 404) await throwOnError(res);
  },
};
