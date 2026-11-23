/* MODULUS Service Worker — Production-Safe Static & WASM Offline Cache */
const CACHE_NAME = 'modulus-static-v1';
const CORE_ASSETS = [
  '/',
  '/manifest.json',
  '/assets/logo.svg',
  '/assets/favicon-32x32.png',
  '/assets/apple-touch-icon.png',
  '/assets/icon-192x192.png',
  '/assets/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Always bypass non-GET requests (mutations, OTP POSTs, builds, laps)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Strictly bypass auth, admin, and authenticated user API routes
  if (
    url.pathname.startsWith('/api/auth') ||
    url.pathname.startsWith('/api/admin') ||
    url.pathname.startsWith('/api/garage') ||
    url.pathname.startsWith('/api/shop') ||
    url.pathname.startsWith('/api/laps')
  ) {
    return;
  }

  // Network-first for HTML navigations & public balance config (falls back to cached shell offline)
  if (request.mode === 'navigate' || url.pathname.startsWith('/api/config')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && request.mode === 'navigate') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match('/');
        })
    );
    return;
  }

  // Cache-first with background revalidation for static assets, JS/CSS bundles, and Rapier3D WASM
  const isCacheableStatic =
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.wasm') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.json');

  if (isCacheableStatic) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkPromise = fetch(request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkPromise;
      })
    );
  }
});
