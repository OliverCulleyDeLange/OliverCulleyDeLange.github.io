/* ═══════════════════════════════════════════════════════════════
   A small classic-Mac window manager.

   The site is a normal static multi-page site underneath: every route
   still server-renders a real page. This turns it into a desktop shell,
   so if the script never runs you still get the plain page.
   ═══════════════════════════════════════════════════════════════ */

const root = document.documentElement;
const MOBILE = () => window.innerWidth < 700;

/* An internal appUrl loads one of our own pages into a window. Without this
   that page would mount a second desktop inside the iframe. */
const FRAMED = (() => {
  try { return window.self !== window.top; } catch (e) { return true; }
})();

if (FRAMED) {
  root.classList.add('is-framed');
  root.classList.remove('desktop-boot');
}

const store = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
};

const data = (() => {
  const el = document.getElementById('desktop-data');
  try { return JSON.parse(el.textContent); } catch (e) { return { projects: [], posts: [] }; }
})();

const desktop = document.getElementById('desktop');
const winLayer = document.getElementById('win-layer');
const iconLayer = document.getElementById('desk-icons');
const dock = document.getElementById('dock');
const dockItems = document.getElementById('dock-items');
const dockTrash = document.getElementById('dock-trash');
const dockBrowser = document.getElementById('dock-browser');
const dockBrowserLabel = document.getElementById('dock-browser-label');
if (!desktop || !winLayer || !dock) throw new Error('desktop markup missing');

const wins = new Map();
let zTop = 20;
let activeWin = null;
let trashed = new Set(store.read('odl-trash', []));

/* ── helpers ───────────────────────────────────────────────── */

const iconSvg = name => {
  const tpl = document.querySelector(`#icon-templates template[data-icon="${name}"]`);
  return tpl ? tpl.content.cloneNode(true) : document.createDocumentFragment();
};

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

function deskRect() {
  return {
    w: desktop.clientWidth,
    h: desktop.clientHeight,
  };
}

/* Where a new window should sit: cascade on desktop, near-full on a phone. */
let cascade = 0;
function nextRect(preferred) {
  const { w, h } = deskRect();
  if (MOBILE()) {
    return { x: 4, y: 4, w: w - 8, h: Math.min(h - 8, h * 0.86) };
  }
  const ww = Math.min(preferred.w, w - 40);
  const wh = Math.min(preferred.h, h - 40);
  const step = 24;
  const x = clamp(40 + (cascade % 6) * step, 8, Math.max(8, w - ww - 8));
  const y = clamp(24 + (cascade % 6) * step, 8, Math.max(8, h - wh - 8));
  cascade++;
  return { x, y, w: ww, h: wh };
}

function focusWin(win) {
  win.z = ++zTop;
  win.el.style.zIndex = win.z;
  activeWin = win;
  wins.forEach(w => w.el.classList.toggle('is-active', w === win));
  updateDockState();
  syncBrowserItem();
}

/* The dock's browser item always reflects the window currently on top. */
function syncBrowserItem() {
  if (!dockBrowserLabel) return;
  const live = activeWin && wins.has(activeWin.id) && !activeWin.minimised ? activeWin : null;
  dockBrowserLabel.textContent = live ? live.title : 'oliverdelange';
  dockBrowser.classList.toggle('is-live', Boolean(live));
  dockBrowser.setAttribute('aria-label', 'Show desktop');
  dockBrowser.title = 'Show desktop';
}

/* ── window construction ───────────────────────────────────── */

function buildWindow(opts) {
  const el = document.createElement('section');
  el.className = 'win';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', opts.title);
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="win-bar">
      <span class="win-lights">
        <button class="light close" type="button" aria-label="Close"></button>
        <button class="light min" type="button" aria-label="Minimise"></button>
        <button class="light zoom" type="button" aria-label="Zoom"></button>
      </span>
      <span class="win-title"></span>
      <span class="win-actions">
        <button class="win-open" type="button" aria-label="Open in new tab" title="Open in new tab" hidden>
          <svg width="11" height="11" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">
            <path d="M1.5 4.5h6v6h-6z" fill="none" stroke="currentColor"/>
            <path d="M6.5 1.5h4v4" fill="none" stroke="currentColor"/>
            <path d="M5.5 6.5 10.5 1.5" stroke="currentColor"/>
          </svg>
        </button>
      </span>
    </div>
    <div class="win-body"></div>
    <button class="win-grip" type="button" aria-label="Resize" tabindex="-1"></button>
  `;
  el.querySelector('.win-title').textContent = opts.title;
  return el;
}

function openWindow(opts) {
  const existing = wins.get(opts.id);
  if (existing) {
    if (existing.minimised) restoreWin(existing);
    focusWin(existing);
    return existing;
  }

  const el = buildWindow(opts);
  const body = el.querySelector('.win-body');

  if (opts.kind === 'app') {
    const frame = document.createElement('iframe');
    frame.className = 'win-frame';
    frame.src = opts.src;
    frame.title = opts.title;
    frame.loading = 'lazy';
    body.appendChild(frame);
    body.classList.add('is-frame');
  } else if (opts.node) {
    body.appendChild(opts.node);
  } else {
    body.innerHTML = opts.html || '';
  }

  const rect = opts.rect || nextRect(opts.size || { w: 640, h: 460 });
  Object.assign(el.style, {
    left: rect.x + 'px', top: rect.y + 'px',
    width: rect.w + 'px', height: rect.h + 'px',
  });

  winLayer.appendChild(el);

  // An app window points at its src, a page window at its route; folders,
  // About and Settings point nowhere, so they get no button.
  const openUrl = opts.src || opts.url || null;

  const win = {
    id: opts.id, el, body, title: opts.title, url: opts.url || null,
    openUrl, kind: opts.kind || 'page', icon: opts.icon || 'doc',
    minimised: false, maximised: false, saved: null, z: 0,
  };
  wins.set(opts.id, win);

  const openBtn = el.querySelector('.win-open');
  if (openUrl) {
    openBtn.hidden = false;
    openBtn.addEventListener('click', e => {
      e.stopPropagation();
      window.open(openUrl, '_blank', 'noopener');
    });
  }

  el.querySelector('.close').addEventListener('click', () => closeWin(win));
  el.querySelector('.min').addEventListener('click', () => minimiseWin(win));
  el.querySelector('.zoom').addEventListener('click', () => toggleZoom(win));
  el.addEventListener('pointerdown', () => focusWin(win), true);

  makeDraggable(el.querySelector('.win-bar'), el, win);
  makeResizable(el.querySelector('.win-grip'), el, win);

  syncDock();
  focusWin(win);
  if (MOBILE()) win.maximised = false;
  return win;
}

function closeWin(win) {
  win.el.remove();
  wins.delete(win.id);
  if (activeWin === win) {
    activeWin = [...wins.values()].filter(w => !w.minimised).sort((a, b) => b.z - a.z)[0] || null;
    if (activeWin) focusWin(activeWin);
  }
  syncDock();
  syncBrowserItem();
  // Closing the window that owns the URL returns us to the desktop.
  if (win.url && location.pathname === win.url) {
    history.pushState({}, '', '/');
    document.title = 'oliverdelange';
  }
}

function minimiseWin(win) {
  win.minimised = true;
  win.el.hidden = true;
  if (activeWin === win) {
    activeWin = [...wins.values()].filter(w => !w.minimised).sort((a, b) => b.z - a.z)[0] || null;
    if (activeWin) focusWin(activeWin);
  }
  syncDock();
  syncBrowserItem();
}

function restoreWin(win) {
  win.minimised = false;
  win.el.hidden = false;
  syncDock();
}

/* Clear the screen back to the desktop. Minimise rather than close, so
   nothing in progress is lost and everything stays one tap away in the dock. */
function showDesktop() {
  let changed = false;
  wins.forEach(win => {
    if (win.minimised) return;
    win.minimised = true;
    win.el.hidden = true;
    changed = true;
  });
  activeWin = null;
  if (changed) syncDock();
  syncBrowserItem();
  history.pushState({}, '', '/');
  document.title = 'oliverdelange';
}

function toggleZoom(win) {
  const { w, h } = deskRect();
  if (win.maximised) {
    Object.assign(win.el.style, {
      left: win.saved.x + 'px', top: win.saved.y + 'px',
      width: win.saved.w + 'px', height: win.saved.h + 'px',
    });
    win.maximised = false;
  } else {
    win.saved = {
      x: win.el.offsetLeft, y: win.el.offsetTop,
      w: win.el.offsetWidth, h: win.el.offsetHeight,
    };
    Object.assign(win.el.style, {
      left: '4px', top: '4px',
      width: (w - 8) + 'px', height: (h - 8) + 'px',
    });
    win.maximised = true;
  }
  win.el.classList.toggle('is-max', win.maximised);
}

/* ── drag & resize (pointer events, so touch works too) ────── */

function makeDraggable(handle, el, win) {
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('.light, .win-open')) return;
    if (win.maximised) return;
    e.preventDefault();
    focusWin(win);
    const startX = e.clientX, startY = e.clientY;
    const origX = el.offsetLeft, origY = el.offsetTop;
    const { w, h } = deskRect();
    handle.setPointerCapture(e.pointerId);

    const move = ev => {
      const nx = clamp(origX + ev.clientX - startX, -el.offsetWidth + 80, w - 80);
      const ny = clamp(origY + ev.clientY - startY, 0, h - 28);
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function makeResizable(grip, el, win) {
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    focusWin(win);
    if (win.maximised) toggleZoom(win);
    const startX = e.clientX, startY = e.clientY;
    const origW = el.offsetWidth, origH = el.offsetHeight;
    const { w, h } = deskRect();
    grip.setPointerCapture(e.pointerId);

    const move = ev => {
      el.style.width = clamp(origW + ev.clientX - startX, 240, w - el.offsetLeft - 4) + 'px';
      el.style.height = clamp(origH + ev.clientY - startY, 120, h - el.offsetTop - 4) + 'px';
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
}

/* ── fetching page content into a window ───────────────────── */

const pageCache = new Map();

async function fetchPage(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  const res = await fetch(url, { headers: { 'X-Requested-With': 'desktop' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const bodyEl = doc.querySelector('.window-body');
  const titleEl = doc.querySelector('.title-bar .title');
  const out = {
    html: bodyEl ? bodyEl.innerHTML : '<p>Nothing here.</p>',
    title: titleEl ? titleEl.textContent.trim() : doc.title,
  };
  pageCache.set(url, out);
  return out;
}

async function openPage(url, opts = {}) {
  const id = 'page:' + url;
  const existing = wins.get(id);
  if (existing) {
    if (existing.minimised) restoreWin(existing);
    focusWin(existing);
    return existing;
  }
  const win = openWindow({
    id, url, title: opts.title || 'Loading…', kind: 'page',
    icon: opts.icon || 'doc', html: '<p class="win-loading">Loading…</p>',
    size: opts.size || { w: 660, h: 480 }, rect: opts.rect,
  });
  try {
    const page = await fetchPage(url);
    win.body.innerHTML = page.html;
    win.title = opts.title || page.title;
    win.el.querySelector('.win-title').textContent = win.title;
    win.el.setAttribute('aria-label', win.title);
    syncDock();
  } catch (err) {
    win.body.innerHTML = `<p class="win-loading">Could not open ${url}</p>`;
  }
  return win;
}

/* ── projects: app window + info window ────────────────────── */

function openProject(project) {
  const infoUrl = `/projects/${project.id}/`;
  const { w, h } = deskRect();

  if (!project.appUrl) {
    openPage(infoUrl, { title: project.name + ' — Info', icon: project.icon });
    return;
  }

  if (MOBILE()) {
    // No room to tile: the app on top, info stacked behind it.
    openPage(infoUrl, { title: project.name + ' — Info', icon: project.icon });
    openWindow({
      id: 'app:' + project.id, title: project.name, kind: 'app',
      src: project.appUrl, icon: project.icon,
    });
    return;
  }

  // Info down the left, app filling the space to its right.
  const infoW = Math.min(400, Math.round(w * 0.34));
  const gap = 12;
  const appW = Math.min(900, w - infoW - gap * 3);
  const appH = Math.min(600, h - gap * 2);

  openPage(infoUrl, {
    title: project.name + ' — Info',
    icon: project.icon,
    rect: { x: gap, y: gap, w: infoW, h: Math.min(560, h - gap * 2) },
  });
  openWindow({
    id: 'app:' + project.id,
    title: project.name,
    kind: 'app',
    src: project.appUrl,
    icon: project.icon,
    rect: { x: gap * 2 + infoW, y: gap, w: appW, h: appH },
  });
}

/* ── the Blog folder ───────────────────────────────────────── */

function openBlogFolder() {
  const id = 'folder:blog';
  if (wins.has(id)) { const w = wins.get(id); restoreWin(w); focusWin(w); return; }

  const list = document.createElement('div');
  list.className = 'folder-list';
  const head = document.createElement('div');
  head.className = 'list-head';
  head.innerHTML = '<span>Name</span><span>Date Modified</span>';
  list.appendChild(head);

  const ul = document.createElement('ul');
  data.posts.forEach(post => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/posts/${post.id}/`;
    a.innerHTML = `<span class="post-title"></span><time class="post-date">${post.date}</time>`;
    a.querySelector('.post-title').append(iconSvg('doc'), document.createTextNode(post.title));
    li.appendChild(a);
    ul.appendChild(li);
  });
  list.appendChild(ul);

  openWindow({
    id, title: 'Blog', kind: 'folder', icon: 'folder',
    node: list, size: { w: 620, h: 440 },
  });
}

/* ── trash ─────────────────────────────────────────────────── */

function openTrash() {
  const id = 'folder:trash';
  if (wins.has(id)) { const w = wins.get(id); restoreWin(w); focusWin(w); return; }

  const node = document.createElement('div');
  node.className = 'trash-list';
  const render = () => {
    node.innerHTML = '';
    if (!trashed.size) {
      node.innerHTML = '<p class="win-loading">The Trash is empty.</p>';
      return;
    }
    const ul = document.createElement('ul');
    trashed.forEach(iconId => {
      const item = iconMeta(iconId);
      if (!item) return;
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.className = 'post-title';
      label.append(iconSvg(item.icon), document.createTextNode(item.name));
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.type = 'button';
      btn.textContent = 'Put Back';
      btn.addEventListener('click', () => {
        trashed.delete(iconId);
        persistTrash();
        render();
      });
      li.append(label, btn);
      ul.appendChild(li);
    });
    node.appendChild(ul);
  };
  render();
  node.addEventListener('odl:refresh', render);

  openWindow({ id, title: 'Trash', kind: 'folder', icon: 'folder', node, size: { w: 420, h: 320 } });
}

function iconMeta(id) {
  if (id === 'blog') return { id: 'blog', name: 'Blog', icon: 'folder' };
  if (id === 'github') return { id: 'github', name: 'GitHub', icon: 'github' };
  if (id === 'linkedin') return { id: 'linkedin', name: 'LinkedIn', icon: 'linkedin' };
  const p = data.projects.find(x => x.id === id);
  return p ? { id: p.id, name: p.name, icon: p.icon } : null;
}

function persistTrash() {
  store.write('odl-trash', [...trashed]);
  applyTrash();
  // An icon put back still carries the inline position it was dropped on
  // (over the Trash), so re-apply the saved layout.
  layoutIcons();
  const tw = wins.get('folder:trash');
  if (tw) tw.body.firstElementChild?.dispatchEvent(new CustomEvent('odl:refresh'));
}

function applyTrash() {
  iconLayer.querySelectorAll('.desk-icon').forEach(el => {
    el.hidden = trashed.has(el.dataset.id);
  });
  dockTrash.classList.toggle('is-full', trashed.size > 0);
}

/* ── desktop icons: place, drag, drop on trash ─────────────── */

function layoutIcons() {
  const saved = store.read('odl-icons', {});
  const { w, h } = deskRect();
  const colW = 104, rowH = 92, pad = 12;
  const perCol = Math.max(1, Math.floor((h - pad) / rowH));

  // Flow icons fill columns from the top-left; corner="tr" pins stack
  // down from the top-right so socials stay reachable on a phone.
  const all = [...iconLayer.querySelectorAll('.desk-icon')];
  const flow = all.filter(el => el.dataset.corner !== 'tr');
  const trPins = all.filter(el => el.dataset.corner === 'tr');

  flow.forEach((el, i) => {
    const id = el.dataset.id;
    const pos = saved[id];
    if (pos) {
      el.style.left = clamp(pos.x, 0, Math.max(0, w - colW)) + 'px';
      el.style.top = clamp(pos.y, 0, Math.max(0, h - rowH)) + 'px';
    } else {
      const col = Math.floor(i / perCol), row = i % perCol;
      el.style.left = (pad + col * colW) + 'px';
      el.style.top = (pad + row * rowH) + 'px';
    }
  });

  const iconW = el => el.offsetWidth || colW;
  trPins.forEach((el, i) => {
    const id = el.dataset.id;
    const pos = saved[id];
    if (pos) {
      el.style.left = clamp(pos.x, 0, Math.max(0, w - iconW(el))) + 'px';
      el.style.top = clamp(pos.y, 0, Math.max(0, h - rowH)) + 'px';
    } else {
      el.style.left = Math.max(0, w - iconW(el) - pad) + 'px';
      el.style.top = (pad + i * rowH) + 'px';
    }
  });
}

function persistIcons() {
  // Start from what is stored: a hidden icon reports offsetLeft 0, so
  // measuring it would move it to the corner when it is put back.
  const out = store.read('odl-icons', {});
  iconLayer.querySelectorAll('.desk-icon').forEach(el => {
    if (el.hidden) return;
    out[el.dataset.id] = { x: el.offsetLeft, y: el.offsetTop };
  });
  store.write('odl-icons', out);
}

function activateIcon(el) {
  const href = el.dataset.href;
  if (href) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  const id = el.dataset.id;
  if (id === 'blog') return openBlogFolder();
  const project = data.projects.find(p => p.id === id);
  if (project) openProject(project);
}

function wireIcons() {
  iconLayer.querySelectorAll('.desk-icon').forEach(el => {
    let moved = false;

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      moved = false;
      const startX = e.clientX, startY = e.clientY;
      const origX = el.offsetLeft, origY = el.offsetTop;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');

      const move = ev => {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 4) moved = true;
        if (!moved) return;
        const { w, h } = deskRect();
        el.style.left = clamp(origX + ev.clientX - startX, 0, w - el.offsetWidth) + 'px';
        el.style.top = clamp(origY + ev.clientY - startY, 0, h - el.offsetHeight) + 'px';
        dockTrash.classList.toggle('is-target', overTrash(ev));
      };
      const up = ev => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('is-dragging');
        dockTrash.classList.remove('is-target');
        if (moved) {
          if (overTrash(ev)) {
            trashed.add(el.dataset.id);
            persistTrash();
          }
          persistIcons();
        }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });

    el.addEventListener('click', e => {
      if (moved) { e.preventDefault(); return; }
      activateIcon(el);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateIcon(el); }
    });
  });
}

function overTrash(ev) {
  const r = dockTrash.getBoundingClientRect();
  return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
}

/* ── dock ──────────────────────────────────────────────────── */

const dockButtons = new Map();

/* Gesture state lives here, not in the button closures: syncDock() rebuilds
   every tile, so the two taps of a double tap can land on different elements. */
let pendingTap = null;   // { id, timer }
let pressTimer = null;
let suppressClickId = null;

function cancelPendingTap() {
  if (pendingTap) clearTimeout(pendingTap.timer);
  pendingTap = null;
}

function cancelLongPress() {
  clearTimeout(pressTimer);
  pressTimer = null;
}

function dockTapAction(id) {
  const win = wins.get(id);
  if (!win) return;
  if (win.minimised) {
    restoreWin(win);
    focusWin(win);
  } else if (win === activeWin) {
    minimiseWin(win);
  } else {
    focusWin(win);
  }
}

/* Every open window gets a dock tile, not just the minimised ones: on a
   phone the windows cover each other, so this is the only way to switch. */
function syncDock() {
  dockItems.innerHTML = '';
  dockButtons.clear();
  wins.forEach(win => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dock-item dock-win';
    btn.title = win.title;
    btn.append(iconSvg(win.icon));
    const label = document.createElement('span');
    label.className = 'dock-label';
    label.textContent = win.title;
    btn.appendChild(label);
    btn.addEventListener('pointerdown', () => {
      cancelLongPress();
      // The second tap of a double tap must never arm a long press.
      if (pendingTap && pendingTap.id === win.id) return;
      const id = win.id;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        suppressClickId = id;
        showDockHint();
      }, 500);
    });

    btn.addEventListener('pointerup', cancelLongPress);
    btn.addEventListener('pointercancel', cancelLongPress);
    btn.addEventListener('pointerleave', cancelLongPress);
    btn.addEventListener('pointermove', e => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancelLongPress();
    });

    btn.addEventListener('click', () => {
      cancelLongPress();

      // Swallow the click that follows a long press.
      if (suppressClickId === win.id) {
        suppressClickId = null;
        return;
      }

      if (pendingTap && pendingTap.id === win.id) {
        cancelPendingTap();
        if (wins.has(win.id)) closeWin(win);
        return;
      }

      cancelPendingTap();
      const id = win.id;
      pendingTap = {
        id,
        timer: setTimeout(() => {
          pendingTap = null;
          dockTapAction(id);
        }, 320),
      };
    });
    dockItems.appendChild(btn);
    dockButtons.set(win.id, btn);
  });
  dock.classList.toggle('has-items', dockButtons.size > 0);
  updateDockState();
  syncBrowserItem();
}

/* Cheap class-only refresh, so focusing a window does not rebuild the dock. */
function updateDockState() {
  dockButtons.forEach((btn, id) => {
    const win = wins.get(id);
    if (!win) return;
    btn.classList.toggle('is-min', win.minimised);
    btn.classList.toggle('is-live', !win.minimised);
    btn.classList.toggle('is-active', win === activeWin && !win.minimised);
    btn.setAttribute('aria-label', win.minimised ? `Restore ${win.title}` : `Show ${win.title}`);
  });

  const active = dockButtons.get(activeWin?.id);
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* The dock logo clears everything away and shows the desktop. */
dockBrowser?.addEventListener('click', showDesktop);

/* ── link interception: the whole site becomes the shell ───── */

function isInternal(a) {
  return a.origin === location.origin
    && !a.hasAttribute('download')
    && a.target !== '_blank';
}

document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || !isInternal(a)) return;
  if (a.closest('#desk-icons')) return;

  const url = a.pathname;
  e.preventDefault();

  if (url === '/') {
    showDesktop();
    return;
  }
  openPage(url).then(win => {
    history.pushState({ url }, '', url);
    document.title = win.title + ' | oliverdelange';
  });
});

window.addEventListener('popstate', () => {
  const url = location.pathname;
  if (url === '/') return;
  openPage(url);
});

/* ── boot ──────────────────────────────────────────────────── */

function boot() {
  const main = document.querySelector('main');
  const served = main ? main.querySelector('.window') : null;
  const path = location.pathname;

  desktop.hidden = false;
  dock.hidden = false;
  root.classList.add('desktop-on');
  root.classList.remove('desktop-boot');

  applyTrash();
  layoutIcons();
  wireIcons();
  syncDock();
  syncBrowserItem();

  // Adopt the server-rendered page as the first window (except on the desktop itself).
  if (served && path !== '/') {
    const bodyEl = served.querySelector('.window-body');
    const titleEl = served.querySelector('.title-bar .title');
    const node = document.createElement('div');
    while (bodyEl.firstChild) node.appendChild(bodyEl.firstChild);
    openWindow({
      id: 'page:' + path,
      url: path,
      title: titleEl ? titleEl.textContent.trim() : document.title,
      kind: 'page',
      icon: 'doc',
      node,
      size: { w: 700, h: 520 },
    });
  }
  if (main) main.remove();

  window.addEventListener('resize', () => {
    const { w, h } = deskRect();
    wins.forEach(win => {
      if (win.maximised) {
        Object.assign(win.el.style, { width: (w - 8) + 'px', height: (h - 8) + 'px' });
      } else {
        win.el.style.left = clamp(win.el.offsetLeft, 0, Math.max(0, w - 80)) + 'px';
        win.el.style.top = clamp(win.el.offsetTop, 0, Math.max(0, h - 28)) + 'px';
      }
    });
  });
}

/* dock trash: click opens it, and it is the drop target handled above */
dockTrash.addEventListener('click', openTrash);

/* ── "You can double tap to close" hint ────────────────────── */
const dockHint = document.getElementById('dock-hint');

function showDockHint() {
  if (!dockHint) return;
  cancelPendingTap();
  dockHint.hidden = false;
  document.getElementById('dock-hint-ok')?.focus();
}

function hideDockHint() {
  if (dockHint) dockHint.hidden = true;
}

document.getElementById('dock-hint-ok')?.addEventListener('click', hideDockHint);

document.addEventListener('pointerdown', e => {
  if (dockHint && !dockHint.hidden && !e.target.closest('#dock-hint')) hideDockHint();
}, true);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideDockHint();
});

/* ── Desktop context menu ───────────────────────────────────
   Only on the desktop itself: right-clicking inside a window keeps the
   browser's own menu so text can still be copied. */
const ctxMenu = document.getElementById('context-menu');

function hideContext() {
  if (ctxMenu) ctxMenu.hidden = true;
}

function showContext(x, y) {
  if (!ctxMenu) return;
  ctxMenu.hidden = false;
  const pad = 4;
  ctxMenu.style.left = Math.min(x, window.innerWidth - ctxMenu.offsetWidth - pad) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - ctxMenu.offsetHeight - pad) + 'px';
  ctxMenu.querySelector('button')?.focus();
}

desktop.addEventListener('contextmenu', e => {
  if (e.target.closest('.win')) return;
  e.preventDefault();
  showContext(e.clientX, e.clientY);
});

dock.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#context-menu')) hideContext();
}, true);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideContext();
});

window.addEventListener('blur', hideContext);

document.getElementById('ctx-cleanup')?.addEventListener('click', () => {
  store.write('odl-icons', {});
  layoutIcons();
  hideContext();
});


/* ── Apple menu: About, Settings, Lock ─────────────────────── */

const THEMES = ['light', 'dark', 'system'];

function currentTheme() {
  const saved = store.read('odl-theme', 'system');
  return THEMES.includes(saved) ? saved : 'system';
}

function applyTheme(mode) {
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  store.write('odl-theme', mode);
}

function openAbout() {
  const node = document.createElement('div');
  node.className = 'about-pane';
  node.innerHTML = `
    <h2>oliverdelange.co.uk</h2>
    <p class="about-tagline">A blog I probably won't keep up to date.</p>
    <dl class="about-spec">
      <dt>Built with</dt><dd>Astro, static output, no UI framework</dd>
      <dt>Interface</dt><dd>Classic Mac OS (System 6/7), hand-rolled CSS</dd>
      <dt>Typeface</dt><dd>ChiKareGo2, a Chicago 12pt recreation by Giles Booth</dd>
      <dt>Windows</dt><dd>Progressive enhancement &mdash; every page still works without JavaScript</dd>
    </dl>
    <p class="about-foot">
      <a href="https://github.com/OliverCulleyDeLange" target="_blank" rel="noopener">GitHub</a>
      &middot;
      <a href="https://www.linkedin.com/in/oliverdelange" target="_blank" rel="noopener">LinkedIn</a>
    </p>
  `;
  openWindow({
    id: 'about', title: 'About This Site', kind: 'folder',
    icon: 'monogram', node, size: { w: 460, h: 380 },
  });
}

function openSettings() {
  const node = document.createElement('div');
  node.className = 'settings-pane';
  node.innerHTML = `
    <h3 class="settings-heading">Appearance</h3>
    <p class="settings-hint">Choose how the desktop looks.</p>
    <div class="settings-options" role="radiogroup" aria-label="Appearance"></div>
  `;
  const group = node.querySelector('.settings-options');
  const labels = { light: 'Light', dark: 'Dark', system: 'Use system setting' };

  THEMES.forEach(mode => {
    const id = 'theme-' + mode;
    const row = document.createElement('label');
    row.className = 'settings-row';
    row.setAttribute('for', id);
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'odl-theme';
    input.id = id;
    input.value = mode;
    input.checked = currentTheme() === mode;
    input.addEventListener('change', () => { if (input.checked) applyTheme(mode); });
    const span = document.createElement('span');
    span.textContent = labels[mode];
    row.append(input, span);
    group.appendChild(row);
  });

  openWindow({
    id: 'settings', title: 'Settings', kind: 'folder',
    icon: 'monogram', node, size: { w: 400, h: 300 },
  });
}

/* ── Lock screen ───────────────────────────────────────────────
   A gag, not a security feature: nothing is stored or transmitted,
   and a reload clears it so nobody can get stuck. */
const lockScreen = document.getElementById('lock-screen');
const lockForm = document.getElementById('lock-form');
const lockPass = document.getElementById('lock-pass');
const lockError = document.getElementById('lock-error');
const lockDialog = document.getElementById('lock-dialog');
const lockForgot = document.getElementById('lock-forgot');
let forgetting = false;

function lock() {
  if (!lockScreen) return;
  hideContext();
  lockScreen.hidden = false;
  root.classList.add('is-locked');
  if (lockError) lockError.hidden = true;
  if (lockDialog) lockDialog.hidden = true;
  if (lockPass) { lockPass.value = ''; lockPass.focus(); }
}

function unlock() {
  if (!lockScreen) return;
  lockScreen.hidden = true;
  root.classList.remove('is-locked');
  forgetting = false;
  if (lockDialog) lockDialog.hidden = true;
}

lockForm?.addEventListener('submit', e => {
  e.preventDefault();
  // Any password gets you in; the joke lives behind "Forgot my password?".
  if (lockPass.value.trim()) {
    unlock();
  } else {
    lockError.hidden = false;
    lockScreen.querySelector('.lock-inner')?.classList.remove('shake');
    void lockScreen.offsetWidth;
    lockScreen.querySelector('.lock-inner')?.classList.add('shake');
  }
});

lockForgot?.addEventListener('click', () => {
  if (forgetting) return;
  forgetting = true;
  lockError.hidden = true;
  lockDialog.hidden = false;
  setTimeout(unlock, 2000);
});

document.getElementById('menu-about')?.addEventListener('click', openAbout);
document.getElementById('menu-settings')?.addEventListener('click', openSettings);
document.getElementById('menu-lock')?.addEventListener('click', lock);

/* ── Toast ─────────────────────────────────────────────────
   A one-line pill above the dock, used so Share can confirm the copy. */
const toastEl = document.getElementById('toast');
let toastHideTimer = null;
let toastFadeTimer = null;

function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.hidden = false;
  // Force a reflow so the transition runs on the class change.
  void toastEl.offsetWidth;
  toastEl.classList.add('is-visible');
  clearTimeout(toastHideTimer);
  clearTimeout(toastFadeTimer);
  toastHideTimer = setTimeout(() => {
    toastEl.classList.remove('is-visible');
    toastFadeTimer = setTimeout(() => { toastEl.hidden = true; }, 200);
  }, 1800);
}

/* ── File menu actions: Home, Share, Quit ─────────────────── */

function goHome() {
  // Same behaviour as clicking the Home link: minimise, don't close,
  // so anything in progress (a groove, a calculator) is preserved.
  wins.forEach(win => { if (!win.minimised) minimiseWin(win); });
  if (location.pathname !== '/') {
    history.pushState({}, '', '/');
    document.title = 'oliverdelange';
  }
}

function quitActive() {
  // Mac "Quit" closes the frontmost app's windows. Here there's one
  // window per "app", so close the active one.
  const target = activeWin && wins.has(activeWin.id) ? activeWin : null;
  if (target) closeWin(target);
}

async function share() {
  const url = location.href;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      // Fallback for old browsers / non-secure contexts.
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Link copied to clipboard');
  } catch (e) {
    toast('Could not copy link');
  }
}

document.getElementById('menu-share')?.addEventListener('click', share);
document.getElementById('menu-quit')?.addEventListener('click', quitActive);

/* ── Global keyboard shortcuts ────────────────────────────────
   Bare keys (no ⌘/Ctrl) so we never fight the browser: ⌘Q would quit
   the browser itself on macOS, ⌘H would hide the window, and pages
   can't intercept either. We skip while typing in any form control. */
function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}

document.addEventListener('keydown', e => {
  if (e.defaultPrevented) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (isTyping(e.target)) return;
  if (root.classList.contains('is-locked')) return;

  switch (e.key) {
    case 'h': case 'H': e.preventDefault(); goHome(); break;
    case 'q': case 'Q': e.preventDefault(); quitActive(); break;
    case 's': case 'S': e.preventDefault(); share(); break;
    case ',':           e.preventDefault(); openSettings(); break;
  }
});

if (!FRAMED) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
