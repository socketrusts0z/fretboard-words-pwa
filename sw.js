const CACHE_NAME = 'fretboard-words-v9';
const APP_URL = new URL('./', self.registration.scope).toString();
const OFFLINE_FILES = [
  APP_URL,
  new URL('index.html', APP_URL).toString(),
  new URL('style.css', APP_URL).toString(),
  new URL('script.js', APP_URL).toString(),
  new URL('pwa.js', APP_URL).toString(),
  new URL('manifest.webmanifest', APP_URL).toString(),
  new URL('icon-192.png', APP_URL).toString(),
  new URL('icon-512.png', APP_URL).toString(),
  new URL('apple-touch-icon.png', APP_URL).toString()
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(OFFLINE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(name => name.startsWith('fretboard-words-') && name !== CACHE_NAME).map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestURL = new URL(event.request.url);
  if (requestURL.origin !== self.location.origin || !requestURL.href.startsWith(APP_URL)) return;

  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const app = await caches.match(APP_URL);
        if (app) return app;
      }
      return Response.error();
    })
  );
});
