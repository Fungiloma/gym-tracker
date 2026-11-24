const CACHE_NAME = 'gym-tracker-v5';
const ASSETS_TO_CACHE = [
  '/gym-tracker/manifest.json',
  '/gym-tracker/icons/icon-192.png',
  '/gym-tracker/icons/icon-512.png'
];

// Rutas que siempre deben intentar red primero (HTML, JS y CSS = código de la app)
function isAppShell(url) {
  return url.pathname.endsWith('/gym-tracker/') ||
         url.pathname.endsWith('/index.html') ||
         url.pathname.endsWith('/sw.js') ||
         url.pathname.endsWith('.js') ||
         url.pathname.endsWith('.css');
}

// Install: cachear solo assets estáticos
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.log('[SW] Cache addAll error:', err);
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

// Fetch: network-first para HTML/JS de la app, cache-first para assets estáticos
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (isAppShell(url)) {
    // NETWORK-FIRST: siempre intenta traer la versión más reciente del código.
    // Si no hay red, cae a la última copia cacheada (offline funciona igual).
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // CACHE-FIRST: assets estáticos (iconos, manifest) que casi nunca cambian
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;

      return fetch(event.request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => caches.match(event.request));
    })
  );
});

// Al tocar la notificación de fin de descanso, volver a la app abierta o abrirla.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});
