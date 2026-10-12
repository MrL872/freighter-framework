// Search box for a control panel's header. It narrows the flag buttons by their
// syntax (-u, --url) or by their description (output file, ...), and expands only
// the groups that still have a match. Clearing the box (or Escape) puts the groups
// back the way they were before searching.

export function flagSearchHtml() {
  return '<input type="search" class="flag-search" placeholder="search flags..." aria-label="Search flags" spellcheck="false" autocomplete="off">';
}

// Call once the panel's markup is in place.
export function bindFlagSearch(container) {
  const input = container.querySelector('.flag-search');
  if (!input) return;
  // The panel head is a drag handle for the whole worker card. Keep presses inside
  // the box from starting a drag, so the text can be selected and edited.
  for (const type of ['pointerdown', 'mousedown']) {
    input.addEventListener(type, e => e.stopPropagation());
  }

  const groups = [...container.querySelectorAll('.flag-group')];
  const headOf = group => group.querySelector('.flag-group-head');
  let expandedBeforeSearch = null;

  function clear() {
    container.querySelectorAll('.flag-btn-wrap, .flag-section').forEach(el => { el.style.display = ''; });
    if (expandedBeforeSearch) {
      groups.forEach((group, i) => headOf(group).setAttribute('aria-expanded', expandedBeforeSearch[i]));
      expandedBeforeSearch = null;
    }
  }

  function filter(query) {
    if (!expandedBeforeSearch) {
      expandedBeforeSearch = groups.map(group => headOf(group).getAttribute('aria-expanded'));
    }
    for (const group of groups) {
      let groupHits = 0;
      for (const section of group.querySelectorAll('.flag-section')) {
        let sectionHits = 0;
        for (const wrap of section.querySelectorAll('.flag-btn-wrap')) {
          const btn = wrap.querySelector('.flag-btn');
          // The label holds the syntax ("-u, --url"), the title holds the description.
          const haystack = `${btn.dataset.flag} ${btn.textContent} ${btn.title}`.toLowerCase();
          const match = haystack.includes(query);
          wrap.style.display = match ? '' : 'none';
          if (match) sectionHits++;
        }
        section.style.display = sectionHits ? '' : 'none';
        groupHits += sectionHits;
      }
      headOf(group).setAttribute('aria-expanded', String(groupHits > 0));
    }
  }

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    if (query) filter(query);
    else clear();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      clear();
    }
  });
}
