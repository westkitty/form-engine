/* FORM//ENGINE service worker — offline app shell.
   Generated at build time: __VERSION__ and __PRECACHE__ are replaced by vite.config.ts (formServiceWorker plugin).
   Strategy: precache the built shell; navigations are network-first with the cached shell as offline fallback;
   hashed assets are cache-first. Nothing cross-origin is touched (provider calls go straight to the network). */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = 'form-engine-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('form-engine-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./', copy)); }
      return res;
    }).catch(async () => (await caches.match('./', { cacheName: CACHE })) || (await caches.match('./index.html', { cacheName: CACHE })) || Response.error()));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok && url.pathname.includes('/assets/')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
self.addEventListener('message', e => { if (e.data === 'version' && e.ports[0]) e.ports[0].postMessage(VERSION); });
