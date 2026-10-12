// Generic HTML5 drag-and-drop reordering, shared by every reorderable list
// in the app (links sidebar, metrics panels, ledger columns). Each caller
// supplies its own `itemSelector` (the direct-child tag being dragged) and,
// optionally, its own `locate` strategy for where a drop would land — the
// default suits a vertical list; ledger's column header uses the horizontal
// one; the metrics grid uses the 2D one.

// A soft spring/overshoot curve (slight bounce past the resting point before
// settling) instead of a linear ease, for the "water-like" fluid feel the
// FLIP animation below plays siblings' displacement with — a plain `ease`
// reads as a mechanical snap by comparison.
const FLIP_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const FLIP_DURATION = '0.32s';

// FLIP (First, Last, Invert, Play): after `mutate()` changes the DOM, every
// direct child of `listEl` that ended up somewhere new gets a transform
// transition played from its old position back to its new one — so the
// rest of the list/row/grid slides smoothly out of the way instead of
// snapping. `skip` (typically the element actively being dragged) is
// repositioned along with everything else but excluded from the animation
// itself — animating it too would fight the cursor/native drag ghost that
// already visually tracks it, which is what made the whole thing read as
// clunky rather than fluid.
export function withFlipAnimation(listEl, mutate, skip = null) {
  const children = [...listEl.children];
  const first = new Map(children.map(c => [c, c.getBoundingClientRect()]));
  mutate();
  for (const c of children) {
    if (c === skip) continue;
    const firstBox = first.get(c);
    const lastBox = c.getBoundingClientRect();
    const dx = firstBox.left - lastBox.left;
    const dy = firstBox.top - lastBox.top;
    if (!dx && !dy) continue;
    c.style.transition = 'none';
    c.style.transform = `translate(${dx}px, ${dy}px)`;
    // Force layout so the transform above is applied before the transition
    // below is enabled, otherwise the browser would coalesce both into a
    // single no-op frame instead of animating from the offset to zero.
    c.getBoundingClientRect();
    c.style.transition = `transform ${FLIP_DURATION} ${FLIP_EASING}`;
    c.style.transform = '';
    c.addEventListener('transitionend', () => { c.style.transition = ''; }, { once: true });
  }
}

// Fraction of a candidate's own size the cursor must be past its center by
// before a swap registers, instead of the instant a boundary is crossed.
// Without it, hovering right at the seam between two items is a coin flip
// that reorders on every tiny mouse jitter; this carves out a dead zone
// around that seam (shrinking the effective "sweet spot" that immediately
// triggers a move) so a swap only happens once the cursor has decisively
// moved into the neighboring slot.
const SWAP_MARGIN = 0.1;

// Nearest-sibling-by-vertical-midpoint — suits a single-column list.
export function locateVertical(e, siblings) {
  const nearest = siblings.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = e.clientY - box.top - box.height / 2;
    return (offset < 0 && offset > closest.offset) ? { offset, element: child, size: box.height } : closest;
  }, { offset: -Infinity, element: null, size: 0 });
  if (!nearest.element) return null; // past every sibling → insert at the end
  // Still within the dead zone near the seam → undefined means "no change
  // yet", distinct from null's "insert at the end".
  return nearest.offset <= -(nearest.size * SWAP_MARGIN) ? nearest.element : undefined;
}

// Nearest-sibling-by-horizontal-midpoint — suits a single-row list.
export function locateHorizontal(e, siblings) {
  const nearest = siblings.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = e.clientX - box.left - box.width / 2;
    return (offset < 0 && offset > closest.offset) ? { offset, element: child, size: box.width } : closest;
  }, { offset: -Infinity, element: null, size: 0 });
  if (!nearest.element) return null;
  return nearest.offset <= -(nearest.size * SWAP_MARGIN) ? nearest.element : undefined;
}

// Nearest-sibling-by-2D-center-distance, with the sign of the dominant axis
// deciding before/after — suits a wrapping grid where items can sit either
// beside or below the one being dragged.
export function locateGrid(e, siblings) {
  let best = null;
  let bestDist = Infinity;
  for (const child of siblings) {
    const box = child.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; best = { child, dx, dy, box }; }
  }
  if (!best) return null;
  const dominant = Math.abs(best.dx) > Math.abs(best.dy);
  const magnitude = dominant ? Math.abs(best.dx) : Math.abs(best.dy);
  const size = dominant ? best.box.width : best.box.height;
  // Within the dead zone around the nearest item's center → no change yet.
  if (magnitude < (size / 2) * SWAP_MARGIN) return undefined;
  // Past the nearest item's own center means "insert after it"; the caller
  // treats a null return as "insert at the end".
  const past = dominant ? best.dx > 0 : best.dy > 0;
  if (!past) return best.child;
  return best.child.nextElementSibling;
}

// Minimal HTML5 drag-and-drop reordering of `listEl`'s direct children
// matching `itemSelector`. Each list gets its own closure/dragEl, so a drag
// started inside a nested sortable list never gets picked up by an outer
// one's listeners, and vice versa — both only ever act on their own direct
// children.
export function makeSortable(listEl, onReorder, opts = {}) {
  const itemSelector = opts.itemSelector || 'li';
  const locate = opts.locate || locateVertical;
  // Optional gate. When it returns false, dragging is refused outright (the native drag never starts)
  // instead of only skipping the persisted result. Layout stays at its default while there is no profile to
  // scope the customization to.
  const enabled = opts.enabled || (() => true);
  let dragEl = null;
  // Whether the mousedown that's about to (maybe) turn into a drag started
  // over `opts.handleSelector`. This can't be read off the dragstart event
  // itself: a dragstart's `target` is the resolved drag source —
  // here, the nearest ancestor with draggable="true", i.e. the item — not
  // the original descendant under the pointer. Since '.panel-head' is a
  // descendant of the item, not an ancestor-or-self, e.target.closest(...)
  // on dragstart would never match it, which made every handle-gated drag
  // get refused unconditionally. Tracking it on mousedown, before the
  // browser resolves that target, is what actually reflects where the
  // gesture began.
  let handleGrabbed = true;
  if (opts.handleSelector) {
    listEl.addEventListener('mousedown', e => {
      handleGrabbed = !!e.target.closest(opts.handleSelector);
    });
  }
  listEl.addEventListener('dragstart', e => {
    const item = e.target.closest(itemSelector);
    if (!item || item.parentElement !== listEl) return;
    if (!enabled()) { e.preventDefault(); return; }
    // With a handle configured, the item stays draggable="true" at all
    // times (see the caller) — dragging is restricted to starting from the
    // handle via the mousedown tracking above.
    if (opts.handleSelector && !handleGrabbed) { e.preventDefault(); return; }
    dragEl = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.id || '');
    requestAnimationFrame(() => item.classList.add('dragging'));
  });
  listEl.addEventListener('dragend', () => {
    if (dragEl) dragEl.classList.remove('dragging');
    dragEl = null;
  });
  listEl.addEventListener('dragover', e => {
    if (!dragEl) return;
    e.preventDefault();
    // Only elements that are themselves valid drag items (e.g. not the
    // ledger's fixed, undraggable select column) can be a drop target —
    // otherwise a fixed item could get shuffled out of its pinned spot by
    // something dropping "before" it.
    const siblings = [...listEl.children].filter(c => c !== dragEl && c.matches(itemSelector));
    const after = locate(e, siblings);
    // undefined means the cursor is still in the dead zone around a
    // candidate's center (see SWAP_MARGIN) — too soon to commit to a move.
    if (after === undefined) return;
    // Skip if this drop position wouldn't actually move anything — dragover
    // fires continuously while hovering, and re-running the FLIP below on
    // every event (even a no-op reorder) would restart transitions and
    // fight itself.
    if (after === dragEl.nextElementSibling || (after == null && dragEl === listEl.lastElementChild)) return;
    withFlipAnimation(listEl, () => {
      if (after == null) listEl.appendChild(dragEl); else listEl.insertBefore(dragEl, after);
    }, dragEl);
  });
  listEl.addEventListener('drop', e => {
    if (!dragEl) return;
    e.preventDefault();
    // Only report actual drag items — a fixed, non-sortable child (e.g. the
    // ledger's pinned select column) has no data-id and must stay out of
    // the reported order entirely, not show up as an undefined entry in it.
    onReorder([...listEl.children].filter(el => el.matches(itemSelector)).map(el => el.dataset.id));
  });
}

// Mouse-driven reordering (as opposed to makeSortable's native HTML5 drag
// API above) for the worker-view boxes: dragging starts only from
// `opts.handleSelector` (e.g. '.panel-head'), and the grabbed item is
// switched to `position: fixed` and moved by hand so it visibly follows the
// cursor, instead of relying on the browser's own drag ghost. Reordering of
// the *other* items still goes through locate()/withFlipAnimation() above,
// same as makeSortable.
export function makeFixedSortable(listEl, onReorder, opts = {}) {
  const itemSelector = opts.itemSelector || '[data-component]';
  const handleSelector = opts.handleSelector;
  const locate = opts.locate || locateGrid;
  const enabled = opts.enabled || (() => true);
  // Per-item gate, checked in addition to enabled() above -- e.g. the worker
  // view's live terminal is pinned to its own grid cell by CSS while
  // Terminal Focus is on (see worker-view.css), so picking it up to reorder
  // it would have no visible effect; this is what refuses that drag at the
  // source instead of letting it start and silently do nothing.
  const isDraggable = opts.isDraggable || (() => true);

  let dragEl = null;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  function mouseDown(e) {
    if (e.button !== 0 || !enabled()) return;
    // Defensive: a still-active drag here means an earlier one's mouseup
    // never reached us (see the e.buttons === 0 check in mouseMove) and it
    // was never cleaned up — finish it now rather than starting a second
    // drag on top of it, which would otherwise leave the first box stuck
    // permanently mid-drag and stack a second, redundant pair of
    // mousemove/mouseup listeners on document.
    if (dragEl) mouseUp();
    const handle = handleSelector ? e.target.closest(handleSelector) : e.target;
    if (!handle) return;
    const item = handle.closest(itemSelector);
    if (!item || item.parentElement !== listEl) return;
    if (!isDraggable(item)) return;
    e.preventDefault();

    startX = e.clientX;
    startY = e.clientY;

    const box = item.getBoundingClientRect();
    origLeft = box.left;
    origTop = box.top;
    dragEl = item;
    // position: fixed takes the item out of the grid's flow and pins it to
    // the viewport, so it can be moved by hand (via left/top below) without
    // the layout dragging it back — the item is locked to its current
    // on-screen size/position first so it doesn't jump or resize when the
    // positioning scheme changes.
    dragEl.style.position = 'fixed';
    dragEl.style.left = origLeft + 'px';
    dragEl.style.top = origTop + 'px';
    dragEl.style.width = box.width + 'px';
    dragEl.style.height = box.height + 'px';
    dragEl.style.zIndex = '1000';
    dragEl.classList.add('dragging');

    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
  }

  // Last-seen pointer position, used by mouseUp to work out the drop target
  // once, instead of mouseMove reordering siblings live on every pixel of
  // movement — see the note in mouseMove below for why.
  let lastEvent = null;

  function mouseMove(e) {
    if (!dragEl) return;
    // Self-heal from a drag whose real mouseup never reached us — e.g. the
    // button was released after the cursor left the browser window
    // entirely (over the OS taskbar, another app, ...), which several
    // browsers never deliver an in-page mouseup event for at all. Left
    // unhandled, that permanently strands the grabbed box mid-drag: still
    // position: fixed, and every mousedown on any *other* box first re-hits
    // this stale mouseDown/mouseMove pair as if it were still active,
    // effectively locking out every box except whichever last completed a
    // clean drop — which reads as "only one box ever works". `e.buttons`
    // reports which buttons are *currently* held; 0 means the primary
    // button is already up by the time this move event fires, so finish
    // the drag right here instead of waiting for a mouseup that already
    // happened elsewhere.
    if (e.buttons === 0) { mouseUp(); return; }
    lastEvent = e;
    const newX = startX - e.clientX;
    const newY = startY - e.clientY;
    dragEl.style.left = (origLeft - newX) + 'px';
    dragEl.style.top = (origTop - newY) + 'px';
    // The other boxes are intentionally left alone here — only the grabbed
    // one moves while dragging. Reordering siblings live, on every move
    // event, fed each FLIP-animated sibling's still-mid-transition bounding
    // rect straight back into locate()'s distance calculation on the very
    // next event, which made them keep re-swapping against each other
    // ("cycling") instead of settling. The actual reorder is computed once,
    // from wherever the pointer ends up, in mouseUp below.
  }

  function mouseUp() {
    if (!dragEl) return;
    const item = dragEl;
    if (lastEvent) {
      const siblings = [...listEl.children].filter(c => c !== item && c.matches(itemSelector));
      const after = locate(lastEvent, siblings);
      // undefined (still within locate()'s dead zone) is treated as "leave
      // it where it already is" — there's no live preview to fall back to
      // here, unlike the continuous-swap makeSortable above.
      if (after !== undefined && after !== item.nextElementSibling) {
        withFlipAnimation(listEl, () => {
          if (after == null) listEl.appendChild(item); else listEl.insertBefore(item, after);
        }, item);
      }
    }
    item.style.position = '';
    item.style.left = '';
    item.style.top = '';
    item.style.width = '';
    item.style.height = '';
    item.style.zIndex = '';
    item.classList.remove('dragging');
    dragEl = null;
    lastEvent = null;
    document.removeEventListener('mousemove', mouseMove);
    document.removeEventListener('mouseup', mouseUp);
    onReorder([...listEl.children].filter(el => el.matches(itemSelector)).map(el => el.dataset.id));
  }

  listEl.addEventListener('mousedown', mouseDown);
}
