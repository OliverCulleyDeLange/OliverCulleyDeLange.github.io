/* The site's offline layer.

   Everything here is static, so the build can name every file up front:
   src/integrations/service-worker.mjs walks dist/ after a build and drops
   the lists in below. That means a first visit is enough to have the whole
   site — every page, every game — on the plane with you.

   Two tiers:
     SHELL  every page, script, stylesheet, font and icon. Cached during
            install, so it is all there the moment the worker takes over.
     MEDIA  images. Fetched a few at a time once a page has finished
            loading and asks for them, because they are the heavy half
            and nothing breaks while they are still coming down. The pass
            only fetches what is missing, so a visit that ends early is
            picked up by the next one. Skipped on a metered connection,
            and never includes video — see the build script.

   Anything not on either list (a big map scan, a demo video) still works
   the normal way online, and is kept once seen. Independently deployed apps
   beneath this origin are passed through untouched. */

const VERSION = '__VERSION__';
const CACHE = `odl-site-${VERSION}`;
const SHELL = __SHELL__;
const MEDIA = __MEDIA__;
const INDEPENDENT_APPS = __INDEPENDENT_APPS__;

/* Large enough to matter, small enough not to hold up a page. */
const MEDIA_CONCURRENCY = 4;

const OFFLINE_FALLBACK = '/';

/* What a page posts once it is loaded and idle enough to spare the
   bandwidth. See the registration snippet in BaseLayout.astro. */
const CACHE_MEDIA = 'odl-cache-media';
const CHECK_PAGE = 'odl-check-page';
const PAGE_UPDATE_READY = 'odl-page-update-ready';
const SKIP_WAITING = 'odl-skip-waiting';
/* This marker makes the first deployment of the prompt lifecycle update
   automatically, even when the currently cached page has no prompt code yet.
   Later workers wait for the visitor to press Update. */
const UPDATE_PROMPT_MARKER = 'odl-update-prompt-v1';

function isIndependentApp(pathname) {
  return INDEPENDENT_APPS.some(path => pathname === path || pathname.startsWith(`${path}/`));
}

/* Current caches use odl-site-<fingerprint>. The shorter form recognises only
   this worker's previous 12-hex format, so the migration cannot erase a cache
   belonging to another app just because its name happens to start with odl-. */
function isSiteCache(name) {
  return /^odl-(?:site-)?[a-f0-9]{12}$/.test(name);
}

/* One pass at a time, however many tabs ask for one. */
let mediaPass = null;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      /* One missing file shouldn't leave the visitor with no worker at
         all: fall back to caching whatever does resolve. */
      .catch(() => caches.open(CACHE).then((cache) => cacheEach(cache, SHELL)))
      .then(async () => {
        const names = await caches.keys();
        if (!names.includes(UPDATE_PROMPT_MARKER)) await self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const oldSiteCaches = names.filter(name => isSiteCache(name) && name !== CACHE);
    await Promise.all(oldSiteCaches.map(name => caches.delete(name)));
    await caches.open(UPDATE_PROMPT_MARKER);
    await self.clients.claim();
    /* The first prompt-capable worker must repair clients whose cached page
       predates the controllerchange listener. Future updates are reloaded by
       the page only after the visitor accepts the update prompt. */
    if (!names.includes(UPDATE_PROMPT_MARKER) && oldSiteCaches.length) {
      const windows = await self.clients.matchAll({ type: 'window' });
      await Promise.all(windows.map(client => client.navigate(client.url)));
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === SKIP_WAITING) {
    event.waitUntil(self.skipWaiting());
    return;
  }

  if (event.data === CACHE_MEDIA) {
    if (saveData()) return;
    if (!mediaPass) mediaPass = cacheMedia().finally(() => { mediaPass = null; });
    event.waitUntil(mediaPass);
    return;
  }

  if (event.data?.type === CHECK_PAGE && typeof event.data.url === 'string') {
    const url = new URL(event.data.url, self.location.origin);
    if (url.origin !== self.location.origin) return;
    event.waitUntil(refreshPage(url, event.source?.id));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  /* Analytics and the multiplayer relay are someone else's problem. */
  if (url.origin !== self.location.origin) return;
  if (isIndependentApp(url.pathname)) return;
  /* Video arrives in ranges; passing those through the cache goes wrong
     in ways that are worse than the video simply not playing offline. */
  if (request.headers.has('range') || isVideo(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(page(request, url));
    event.waitUntil(refreshPage(url, event.resultingClientId || event.clientId));
    return;
  }
  event.respondWith(assetRequest(event.clientId, request));
});

/* An independent app can reference a root-relative asset whose path does not
   sit below the app itself. Check the requesting client as well as the asset
   URL so those requests also bypass the portfolio cache. */
async function assetRequest(clientId, request) {
  const client = clientId ? await self.clients.get(clientId) : null;
  if (client && isIndependentApp(new URL(client.url).pathname)) {
    return fetch(request);
  }
  return asset(request);
}

/* A page: what we have, else the network, else the desktop, which is
   always cached and can explain itself. */
async function page(request, url) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(documentKey(url), { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(documentKey(url), response.clone());
    return response;
  } catch (error) {
    return (await cache.match(OFFLINE_FALLBACK))
      ?? new Response('Offline, and this page was never cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
  }
}

/* Keep serving the reliable cached page, but check the network alongside
   it. If the document changed, cache the new copy and let the open app ask
   the visitor when to reload. This preserves offline support without
   pinning separately deployed pages to an old release forever. */
async function refreshPage(url, clientId) {
  const key = documentKey(url);
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  let response;
  try {
    response = await fetch(new Request(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    }));
  } catch (error) {
    return;
  }
  if (!response.ok || response.type !== 'basic') return;

  const changed = cached ? await responsesDiffer(cached, response) : false;
  await cache.put(key, response.clone());
  if (!changed) return;

  const client = clientId ? await self.clients.get(clientId) : null;
  if (client) {
    client.postMessage({ type: PAGE_UPDATE_READY, url: key });
    return;
  }
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false });
  for (const candidate of clients) {
    if (documentKey(new URL(candidate.url)) === key) {
      candidate.postMessage({ type: PAGE_UPDATE_READY, url: key });
    }
  }
}

async function responsesDiffer(cached, fresh) {
  const cachedTag = cached.headers.get('etag');
  const freshTag = fresh.headers.get('etag');
  if (cachedTag && freshTag) return cachedTag !== freshTag;
  return (await cached.clone().text()) !== (await fresh.clone().text());
}

/* Everything else: cache first, since a built asset's name changes when
   its contents do. Whatever the network gives us is kept for next time. */
async function asset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}

/* Pages are cached under their directory URL, which is what a browser
   asks for, rather than the index.html the build wrote. */
function documentKey(url) {
  let path = url.pathname;
  if (path.endsWith('/index.html')) path = path.slice(0, -'index.html'.length);
  if (!path.endsWith('/') && !path.includes('.')) path += '/';
  return new URL(path, self.location.origin).toString();
}

function isVideo(path) {
  return /\.(mp4|webm|mov|m4v)$/i.test(path);
}

function saveData() {
  return self.navigator.connection?.saveData === true;
}

/* Walk the media list a few files at a time, skipping what is already
   there and shrugging off anything that fails. */
async function cacheMedia() {
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const url of MEDIA) {
    if (!(await cache.match(url))) missing.push(url);
  }
  const queue = missing.slice();
  const workers = Array.from({ length: MEDIA_CONCURRENCY }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        await cache.add(url);
      } catch (error) {}
    }
  });
  await Promise.all(workers);
}

/* Cache files one at a time, ignoring failures: the fallback for an
   install where a single addAll entry has gone missing. */
async function cacheEach(cache, urls) {
  for (const url of urls) {
    try {
      await cache.add(url);
    } catch (error) {}
  }
}
