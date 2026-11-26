// Service worker de Gym Tracker. Todas las rutas son relativas al scope del SW,
// así funciona igual en un subdirectorio (GitHub Pages) que en la raíz (servidor local).
// Al cambiar cualquier fichero del shell, sube CACHE_VERSION: es el único sitio donde vive la versión.
const CACHE_VERSION = 'v7';
const CACHE_NAME = `gym-tracker-${CACHE_VERSION}`;
const NETWORK_TIMEOUT_MS = 3000;

// Shell completo. tests/pwa.test.mjs falla si falta algo que index.html o los módulos referencian.
const PRECACHE = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/app.js',
  'js/charts.js',
  'js/data.js',
  'js/editor.js',
  'js/history.js',
  'js/plan.js',
  'js/progress.js',
  'js/pwa.js',
  'js/routines.js',
  'js/share.js',
  'js/stats.js',
  'js/storage.js',
  'js/timers.js',
  'js/tools.js',
  'js/units.js',
  'js/views.js',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/favicon.ico',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png'
];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

// Solo se guardan respuestas correctas de mismo origen (type basic): nada opaco ni de error.
function isCacheable(response) {
  return response && response.ok && response.type === 'basic';
}

// Clave de caché sin query ni hash: ?session=N comparte la entrada de la página.
function cacheKey(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.href;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE.map(async (path) => {
      const url = scopeUrl(path);
      // cache: 'reload' evita copias viejas de la caché HTTP del navegador.
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!isCacheable(response)) throw new Error(`precache: respuesta no válida para ${path}`);
      await cache.put(url, response);
    }));
    // Sin skipWaiting aquí: la versión nueva espera a que el usuario pulse "Recargar".
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith('gym-tracker-') && n !== CACHE_NAME)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first con tiempo máximo: si la red no responde en 3 s (o falla), sirve la copia cacheada.
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const key = cacheKey(request.url);
  const network = fetch(request).then(async (response) => {
    if (isCacheable(response)) await cache.put(key, response.clone()).catch(() => {});
    return response;
  });
  network.catch(() => {}); // si pierde la carrera y falla luego, que no quede sin capturar
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const response = await Promise.race([network, timeout]);
    if (response) return response;
  } catch (err) {
    // sin red: cae a la caché
  }
  const cached = await cache.match(key, { ignoreSearch: true });
  if (cached) return cached;
  if (request.mode === 'navigate') {
    const shell = await cache.match(scopeUrl('index.html'));
    if (shell) return shell;
  }
  return network; // sin copia: espera a la red, o falla como lo haría sin SW
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.href === self.location.href.split('?')[0]) return; // sw.js lo gestiona el navegador
  event.respondWith(networkFirst(request));
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
