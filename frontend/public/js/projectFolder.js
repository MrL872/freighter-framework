// Per-profile Project Folder storage. Real files on disk under the backend's
// project-storage directory (see ProjectFileService/ProjectFilesController on
// the backend ), scoped per company profile so one profile's saved files never
// show up under another's. The frontend never touches that directory
// directly — every read/write goes through the backend's REST endpoints
// below, same as every other backend-mediated feature in this app.
//
// Host-filesystem drag-and-drop and click-to-browse imports are saved the same way as a manually saved file.
// importFile() reads the dropped File and calls save().
import { store } from './store.js';

// Nothing in this module (or the UI built on it) ever hands saved content
// back out as a download/file-system write, so there's no export path to
// guard separately — import is strictly one-directional (host -> Project
// Folder), regardless of which entry point (drag-drop or the file picker)
// produced it.
export const ALLOWED_PROJECT_EXTENSIONS = ['.txt', '.md', '.json', '.jsonl', '.xml', '.csv', '.html', '.sqlite', '.sqlite3', '.db', '.yaml', '.yml', '.js', '.ini', '.log', '.sarif', '.har', '.nmap', '.gnmap'];
export const MAX_PROJECT_FILE_BYTES = 1024 * 1024; // 1024 KB, as project-storage.max-file-bytes

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

// Throws with a user-facing message — every caller just wants one reason
// string to show on rejection, not a bool to re-derive it from.
function assertImportable(file) {
  const ext = extOf(file.name);
  if (!ALLOWED_PROJECT_EXTENSIONS.includes(ext)) {
    throw new Error(`${file.name}: unsupported file type${ext ? ` (${ext})` : ''}`);
  }
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    throw new Error(`${file.name}: too large (max ${Math.floor(MAX_PROJECT_FILE_BYTES / 1024)}KB)`);
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error(`could not read ${file.name}`));
    reader.readAsText(file);
  });
}

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

export const projectFolder = {
  available() { return !!store.current(); },
  idOf,

  async list(profileId = store.profileId) {
    if (!profileId) return [];
    try {
      const res = await fetch(`/api/project-files?profileId=${encodeURIComponent(profileId)}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return []; // includes "no profile" edge cases — nothing saved yet
      const value = await res.json();
      return Array.isArray(value) ? value : [];
    } catch (e) {
      return [];
    }
  },

  // file: { name, content, kind } — kind distinguishes what produced it
  // (e.g. 'wordlist', 'scan-output', 'imported') for whatever renders the
  // list later.
  async save(file) {
    const profileId = store.profileId;
    if (!profileId) throw new Error('no profile selected');
    const res = await fetch('/api/project-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, name: file.name, content: file.content, format: file.format, kind: file.kind, worker: file.worker }),
      signal: AbortSignal.timeout(5000),
    });
    await throwOnError(res);
    return res.json();
  },

  // Drag-and-drop (or browse-to-pick) entry point for host-filesystem
  // imports. Validates type/size before ever touching FileReader so a
  // rejected file never gets read, then saves it exactly like any other
  // Project Folder file.
  async importFile(file) {
    assertImportable(file);
    const ext = extOf(file.name);
    const format = ext.slice(1);
    const content = await readFile(file);
    // Same "<kind>-<uid>.<format>" scheme other app-side saves use (see
    // send-output.js's `${worker}-scan-output-${store.uid()}...` name) —
    // store.uid() is Date.now() base-36-encoded plus a random suffix, so
    // this carries the same encoded-date structure instead of the original
    // host filename or a bare decimal timestamp.
    return this.save({
      kind: 'imported',
      name: `imported-${store.uid()}.${format}`,
      format,
      content,
    });
  },

  async rename(id, name) {
    const profileId = store.profileId;
    if (!profileId) throw new Error('no profile selected');
    const res = await fetch(`/api/project-files/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, name }),
      signal: AbortSignal.timeout(5000),
    });
    await throwOnError(res);
    return res.json();
  },

  // Overwrites a saved file's content in place — the "write changes to the
  // existing document" side of the expandable content window's edit button.
  async updateContent(id, content) {
    const profileId = store.profileId;
    if (!profileId) throw new Error('no profile selected');
    const res = await fetch(`/api/project-files/${encodeURIComponent(id)}/content`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, content }),
      signal: AbortSignal.timeout(5000),
    });
    await throwOnError(res);
    return res.json();
  },

  async remove(id) {
    const profileId = store.profileId;
    if (!profileId) throw new Error('no profile selected');
    const res = await fetch(`/api/project-files/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 404) await throwOnError(res);
  },

  // Deletes every file the given profile has saved — called when the
  // company profile itself is deleted (see profile.js), so its files don't
  // linger on disk forever under a profile id nothing can address again.
  async deleteProfile(profileId) {
    if (!profileId) return;
    const res = await fetch(`/api/project-files/profile/${encodeURIComponent(profileId)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status !== 404) await throwOnError(res);
  },
};
