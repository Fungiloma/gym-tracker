const CACHE_NAME = 'gym-tracker-v1';
const ASSETS_TO_CACHE = [
  '/gym-tracker/',
  '/gym-tracker/index.html',
  '/gym-tracker/manifest.json',
  '/gym-tracker/icons/icon-192.png',
  '/gym-tracker/icons/icon-512.png'
];

// Install: cachear assets estáticos
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.log('[SW] Cache addAll error (some assets may not exist yet):', err);
        // No fallar si algunos assets no existen aún
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// Activate: limpiar caches antiguos
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first (offline-first)
self.addEventListener('fetch', (event) => {
  // Solo cachear requests GET
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        console.log('[SW] Serving from cache:', event.request.url);
        return response;
      }

      // No en cache: ir a red
      return fetch(event.request)
        .then((response) => {
          // Clonar la response antes de guardarla (solo consumible una vez)
          const responseToCache = response.clone();

          // Guardar en cache
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        })
        .catch((error) => {
          console.log('[SW] Fetch failed; serving from cache or offline:', error);
          // Fallback: servir algo del cache o página offline
          return caches.match('/gym-tracker/index.html').catch(() => {
            return new Response('Offline - página no disponible', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
        });
    })
  );
});
