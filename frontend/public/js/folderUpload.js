// Whole-folder uploads for the [ file ] menu's "Upload Nuclei Templates" and
// "Upload Wordlists" options (menu.js) -- unlike Project Folder's one-file-
// at-a-time import (projectFolder.js), these two targets are shared, global
// directories (data/nuclei-templates, data/wordlists), not scoped to a
// company profile, and a real folder (a cloned template repo, a wordlist
// collection) can be thousands of files -- see WordlistsController/
// NucleiTemplatesController on the backend, one POST per file here.
//
// input.webkitRelativePath (set by the non-standard but universally
// supported `webkitdirectory` attribute below) is "<picked-folder>/<rest>"
// for every file under the folder the user chose. The picked folder's own
// name is just whatever it happened to be called on their machine, not
// meaningful structure, so it's stripped -- "my-templates/http/cve.yaml"
// uploads as "http/cve.yaml", landing the folder's *contents* at the
// destination root instead of nesting everything one level deeper under an
// arbitrary name.
function relativePathOf(file) {
  const full = file.webkitRelativePath || file.name;
  const i = full.indexOf('/');
  return i === -1 ? full : full.slice(i + 1);
}

// Opens the host's folder picker (a directory, not a single file) and
// resolves with the FileList it returns — every file anywhere under that
// folder, recursively. Resolves to null if the user cancels.
//
// A cancelled <input type="file"> fires no 'change' event at all (unlike a
// <select> or a text input, there's no neutral "nothing changed" signal) --
// without the two listeners below, cancelling left this promise (and so
// pickAndUpload()'s caller, and the menu item's disabled state in menu.js)
// hanging forever. 'cancel' is the direct signal modern Chromium (and so
// Edge) fires for a dismissed file picker; the window 'focus' listener is a
// fallback for any browser/situation that doesn't fire it, using the same
// "the OS dialog stealing focus, then returning it, brackets the whole
// picker interaction" trick file-upload code has used for years. Whichever
// fires first wins -- `settled` just stops the other from re-resolving an
// already-settled promise (e.g. 'change' firing before 'focus' returns on an
// actual selection).
function pickFolder() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';
    document.body.append(input);
    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener('focus', onWindowFocus);
      resolve(result);
    }
    function onWindowFocus() {
      // 'change' (a real selection) fires before the browser returns focus
      // to the window, so if nothing settled this already, there was no
      // selection -- a short delay covers 'change' still being queued right
      // as focus lands, instead of racing it outright.
      setTimeout(() => finish(null), 300);
    }
    input.addEventListener('change', () => {
      finish(input.files && input.files.length ? [...input.files] : null);
    }, { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    window.addEventListener('focus', onWindowFocus);
    input.click();
  });
}

async function throwOnError(res, label) {
  if (res.ok) return;
  let message = `${label}: request failed (${res.status})`;
  try { message = (await res.json()).error || message; } catch (e) { /* body wasn't JSON */ }
  throw new Error(message);
}

// Uploads every file in `files` to `endpoint` (one POST each, multipart
// {path, file}), `concurrency` at a time so a large folder (thousands of
// small nuclei templates) doesn't serialize into one file at a time, but
// also doesn't fire them all at once against the backend. onProgress(done,
// total) fires after every single file finishes (succeeded or failed), so
// the caller can show live status. Returns { total, failed: [{name, error}] }
// — never throws itself, since one bad file shouldn't stop the rest of a
// thousand-file folder from uploading.
async function uploadFiles(files, endpoint, { concurrency = 4, onProgress } = {}) {
  const total = files.length;
  let done = 0;
  const failed = [];
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      const path = relativePathOf(file);
      try {
        const body = new FormData();
        body.append('path', path);
        body.append('file', file);
        const res = await fetch(endpoint, { method: 'POST', body });
        await throwOnError(res, path);
      } catch (e) {
        failed.push({ name: path, error: e.message || 'upload failed' });
      }
      done++;
      if (onProgress) onProgress(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return { total, failed };
}

// pickAndUpload(endpoint, onProgress) — the one call menu.js needs: opens the
// folder picker, uploads everything it returns to endpoint, and resolves to
// the same { total, failed } summary uploadFiles returns, or null if the
// user cancelled the picker (nothing to upload, not a failure).
export async function pickAndUpload(endpoint, onProgress) {
  const files = await pickFolder();
  if (!files) return null;
  return uploadFiles(files, endpoint, { onProgress });
}
