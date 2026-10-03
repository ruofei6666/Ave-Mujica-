// Vite injects a content hash and the complete production file list.
const VERSION = '__BUILD_VERSION__';
const FILES = /* __PRECACHE_FILES__ */ [];
const ROOT = self.registration.scope;
const PREFIX = `ave-mujica-pwa-${encodeURIComponent(ROOT)}-`;
const CACHE = `${PREFIX}${VERSION}`;
const URLS = new Set(FILES.map(file => new URL(file, ROOT).href));
const HOME = new URL('index.html', ROOT).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    if (!FILES.length) throw new Error('Build the client before installing the PWA');
    const cache = await caches.open(CACHE);
    try {
      // The worker only becomes ready when the entire release is available.
      await cache.addAll([...URLS].map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // Updates wait for the user or for all old tabs to close. Never reload a fight.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Other GitHub Pages projects share this origin; only clean our own scope.
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'PWA_STATUS') {
    event.source?.postMessage({ type: 'PWA_READY', version: VERSION });
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(ROOT)) return;

  // Known assets are versioned by the release, not by their ?v or ?t query.
  // This also lets offline navigation work with invitation/query parameters.
  url.search = '';
  url.hash = '';
  const key = request.mode === 'navigate' && (url.href === ROOT || url.href === HOME)
    ? HOME : url.href;
  if (!URLS.has(key)) return; // Never cache /health, /ws or unknown endpoints.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(key) || fetch(request);
  })());
});
