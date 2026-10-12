import { store } from '../store.js';
import { projectFolder } from '../projectFolder.js';
import { imageFolder } from '../imageFolder.js';

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export default {
  id: 'profile',
  css: 'static/profile.css',
  critical: false,
  mount(container, ctx) {
    container.innerHTML = `
      <div class="profile">
        <button class="icon-btn" id="profile-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="profile-menu" title="Switch company profile">
          <span aria-hidden="true">[</span> <span class="pname" id="profile-name">no profile</span> <img class="profile-icon" src="icons/icons8-database-32.png" alt="" aria-hidden="true"> <span aria-hidden="true">]</span>
        </button>
        <ul id="profile-menu" role="menu"></ul>
      </div>`;

    const profileEl = container.querySelector('.profile');
    const profileBtn = container.querySelector('#profile-btn');
    const profileMenu = container.querySelector('#profile-menu');
    let profileErr = '';

    function render() {
      const cur = store.current();
      container.querySelector('#profile-name').textContent = cur ? cur.name : 'no profile';
      profileMenu.replaceChildren();
      const head = mk('li', 'menu-head', 'Company profiles');
      head.setAttribute('role', 'presentation');
      profileMenu.append(head);
      if (!store.profiles.length) {
        const none = mk('li', 'none', 'No profiles yet. Add a company below.');
        none.setAttribute('role', 'presentation');
        profileMenu.append(none);
      }
      store.profiles.forEach(pr => {
        const li = mk('li', 'row');
        li.setAttribute('role', 'none');
        const pick = mk('button', 'pick');
        pick.type = 'button';
        pick.setAttribute('role', 'menuitemradio');
        pick.setAttribute('aria-checked', String(pr.id === store.profileId));
        pick.append(mk('span', 'check', pr.id === store.profileId ? '*' : ''), mk('span', 'n', pr.name));
        pick.onclick = () => { store.select(pr.id); setMenu(false); profileBtn.focus(); };
        const del = mk('button', 'del', 'del');
        del.type = 'button';
        del.title = 'Delete profile, its chat sessions, and its Project Folder/Image Storage files';
        del.setAttribute('aria-label', 'Delete ' + pr.name);
        del.onclick = () => {
          if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'sure?'; del.style.visibility = 'visible'; return; }
          store.remove(pr.id);
          // Best-effort, fire-and-forget: the profile is already gone from
          // the UI regardless of whether this backend cleanup succeeds --
          // nothing left in the app can address these files by this
          // profile id again either way, so a failure here just means
          // orphaned files on disk rather than a broken profile deletion.
          projectFolder.deleteProfile(pr.id).catch(() => {});
          imageFolder.deleteProfile(pr.id).catch(() => {});
          profileMenu.querySelector('input')?.focus();
        };
        del.onblur = () => { del.dataset.armed = ''; del.textContent = 'del'; del.style.visibility = ''; };
        li.append(pick, del);
        profileMenu.append(li);
      });
      profileMenu.append(document.createElement('hr'));
      const form = mk('form');
      form.autocomplete = 'off';
      const inp = mk('input');
      inp.placeholder = 'add company (e.g. Google)';
      inp.maxLength = 40;
      inp.setAttribute('aria-label', 'New company profile name');
      const add = mk('button', null, 'add');
      add.type = 'submit';
      form.append(inp, add);
      form.onsubmit = e => {
        e.preventDefault();
        const name = inp.value.trim().replace(/\s+/g, ' ');
        if (!name) return;
        if (store.profiles.some(x => x.name.toLowerCase() === name.toLowerCase())) {
          profileErr = '"' + name + '" already exists.';
          render();
          profileMenu.querySelector('input')?.focus();
          return;
        }
        profileErr = '';
        store.add(name);
        setMenu(false);
        profileBtn.focus();
      };
      profileMenu.append(form);
      if (profileErr) { const er = mk('li', 'err', profileErr); er.setAttribute('role', 'presentation'); profileMenu.append(er); }
    }
    function setMenu(open) {
      profileMenu.classList.toggle('open', open);
      profileBtn.setAttribute('aria-expanded', String(open));
      if (open) {
        profileErr = '';
        render();
        (profileMenu.querySelector('button[aria-checked="true"]') || profileMenu.querySelector('input'))?.focus();
      }
    }
    profileBtn.addEventListener('click', () => setMenu(!profileMenu.classList.contains('open')));
    document.addEventListener('click', e => { if (profileMenu.classList.contains('open') && !e.composedPath().includes(profileEl)) setMenu(false); });
    profileMenu.addEventListener('keydown', e => {
      if (e.key === 'Escape') { setMenu(false); profileBtn.focus(); return; }
      if (e.target.tagName === 'INPUT' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      const items = [...profileMenu.querySelectorAll('button.pick, input')];
      const i = items.indexOf(document.activeElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(i + step + items.length) % items.length].focus();
    });

    ctx.on('profile:open', () => setMenu(true));
    store.subscribe(render);
    render();
  },
};
