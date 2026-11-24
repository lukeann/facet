'use strict';
// Service worker: caches the app shell so the app opens and works offline (reading, word list, review).
// Translation / dictionary lookups go to the network as usual. The two placeholder constants below are
// filled in by scripts/build-web.js; the cache name changes with every build, which is what triggers an update.

const CACHE = 'facet-0.1.0-e429651644';
const FILES = ["./","boot.js","gloss-core.js","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","index.html","main/app.js","main/articles.js","main/main.css","manifest.webmanifest","shared/lookup.css","shared/lookup.js","shared/tokens.css","shared/ui.js"];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('gloss-') || k.startsWith('facet-')) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // APIs: straight to the network
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)),
  );
});
