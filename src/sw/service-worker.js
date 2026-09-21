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
   the normal way online, and is kept once seen. */

const VERSION = '__VERSION__';
const CACHE = `odl-${VERSION}`;
const SHELL = __SHELL__;
const MEDIA = __MEDIA__;

/* Large enough to matter, small enough not to hold up a page. */
const MEDIA_CONCURRENCY = 4;

const OFFLINE_FALLBACK = '/';

/* What a page posts once it is loaded and idle enough to spare the
   bandwidth. See the registration snippet in BaseLayout.astro. */
const CACHE_MEDIA = 'odl-cache-media';

/* One pass at a time, however many tabs ask for one. */
let mediaPass = null;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      /* One missing file shouldn't leave the visitor with no worker at
         all: fall back to caching whatever does resolve. */
      .catch(() => caches.open(CACHE).then((cache) => cacheEach(cache, SHELL)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data !== CACHE_MEDIA || saveData()) return;
  if (!mediaPass) mediaPass = cacheMedia().finally(() => { mediaPass = null; });
  event.waitUntil(mediaPass);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  /* Analytics and the multiplayer relay are someone else's problem. */
  if (url.origin !== self.location.origin) return;
  /* Video arrives in ranges; passing those through the cache goes wrong
     in ways that are worse than the video simply not playing offline. */
  if (request.headers.has('range') || isVideo(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(page(request, url));
    return;
  }
  event.respondWith(asset(request));
});

/* A page: what we have, else the network, else the desktop, which is
   always cached and can explain itself. */
async function page(request, url) {
  const cached = await caches.match(documentKey(url), { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(documentKey(url), response.clone());
    return response;
  } catch (error) {
    return (await caches.match(OFFLINE_FALLBACK))
      ?? new Response('Offline, and this page was never cached.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
  }
}

/* Everything else: cache first, since a built asset's name changes when
   its contents do. Whatever the network gives us is kept for next time. */
async function asset(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    (await caches.open(CACHE)).put(request, response.clone());
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
