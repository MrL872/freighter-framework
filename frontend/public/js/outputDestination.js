// Value popup for an output flag (isOutput on the flag definition). Such a flag
// saves its result into Project Folder, so its popup offers that one destination
// in a dropdown and asks only for a file name. The worker's output is staged into
// Project Folder when the run succeeds (see WorkerOutputStager on the backend).
//
// Directory outputs (a folder a tool writes many files into) use the same popup
// but skip the file-name rules, since a folder name has no file type.
import { ALLOWED_PROJECT_EXTENSIONS } from './projectFolder.js';

const DIRECTORY_FLAGS = new Set([
  '-od', '-oD', '-srd', '-sfd', '-store-response-dir', '-store-field-dir', '-store-resp-dir',
  '-me', '--screenshot-path', '--save-urls', '--save-forms',
]);

const DESTINATIONS = {
  project: { label: 'Project Folder', prefix: 'project-folder/' },
  image: { label: 'Image Storage', prefix: 'image-folder/' },
};

function destinationOf(btn) {
  return btn.dataset.outputTarget === 'image' ? DESTINATIONS.image : DESTINATIONS.project;
}

function isDirectory(btn) {
  return DIRECTORY_FLAGS.has(btn.dataset.flag);
}

function showError(input, message) {
  const popup = input.closest('.flag-value-popup-wrap');
  let error = popup.querySelector('.flag-value-error');
  if (!error) {
    error = document.createElement('div');
    error.className = 'flag-value-error';
    error.setAttribute('role', 'alert');
    popup.append(error);
  }
  error.textContent = message;
  return null;
}

// Puts the destination dropdown above the name input and a one-line hint below it.
export function addOutputDestination(popup, input, btn) {
  const dest = destinationOf(btn);
  const select = document.createElement('select');
  select.className = 'flag-value-dest';
  select.setAttribute('aria-label', 'Destination');
  select.innerHTML = `<option value="${dest.prefix}">${dest.label}</option>`;
  popup.insertBefore(select, input);
  input.placeholder = isDirectory(btn) ? 'folder name...' : 'file name...';
  const hint = document.createElement('div');
  hint.className = 'flag-value-hint';
  hint.textContent = isDirectory(btn)
    ? `Folder inside ${dest.label}.`
    : `File name, saved to ${dest.label}.`;
  popup.append(hint);
}

// The value a committed output popup stores: `<destination>/<name>`, or null when the
// name is refused (the reason is shown and the popup stays open). Ordinary flags get
// their typed text back unchanged.
export function destinationValue(btn, input) {
  const raw = input.value.trim();
  if (btn.dataset.isOutput !== 'true') return raw;
  if (!raw) return showError(input, 'Enter a name.');
  if (raw.includes('/') || raw.includes('\\')) return showError(input, 'Enter a name only, without folders.');
  const dest = destinationOf(btn);
  if (!isDirectory(btn) && dest === DESTINATIONS.project) {
    const dot = raw.lastIndexOf('.');
    const ext = dot < 0 ? '' : raw.slice(dot).toLowerCase();
    if (!ALLOWED_PROJECT_EXTENSIONS.includes(ext)) {
      return showError(input, `Use a file type: ${ALLOWED_PROJECT_EXTENSIONS.join(' ')}`);
    }
  }
  return dest.prefix + raw;
}
