// Shared "snap instead of animate" guard: forces an element's CSS
// transitions off for one paint, then lets the stylesheet's own transition
// resume on the next. Used wherever a DOM node's style could otherwise be
// misread by the browser as a value change worth animating from whatever it
// happened to be a moment before — page navigation swapping main's whole
// subtree (see showWorkerView/showOverview/... in index.js) or a worker
// panel mounting fresh markup whose collapsible .flag-group-body-wrap
// elements must start collapsed without a spurious "opening" transition.
export function suppressTransition(el) {
  el.style.transition = 'none';
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; }));
}
