/* global self, caches, URL, fetch */
// Generated at build time. Only public, immutable code enters CacheStorage.
const BUILD = '__BUILD_ID__';
const CACHE = `redionhome-shell-${BUILD}`;
const ASSETS = [/* __SHELL_ASSETS__ */];
const PRECACHE = [/* __PRECACHE__ */];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
  // Wait for a deliberate update or for all old clients to close.
});
self.addEventListener('activate', event => {
  // Keep old code caches for open tabs and rollback. No private data is here.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'VERSION') event.ports[0]?.postMessage({buildId: BUILD});
  if (event.data?.type === 'ACTIVATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Navigation, API, media and identity are network-only. No offline command queue.
  if (!url.pathname.startsWith('/assets/') || url.search) return;
  event.respondWith((async () => {
    const hit = await caches.match(event.request);
    if (hit) return hit;
    const response = await fetch(event.request);
    if (response.ok && ASSETS.includes(url.pathname)) {
      await (await caches.open(CACHE)).put(event.request, response.clone());
    }
    return response;
  })());
});
