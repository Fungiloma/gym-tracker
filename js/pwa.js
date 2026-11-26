// PWA: registro del service worker, aviso de nueva versión y atajo ?session=N.
// Sin dependencias ni acceso al DOM al importar, para poder probar las funciones puras en Node.

// Índice (base 0) de la rutina pedida por ?session=N, o null si falta o no es válido.
// N es la posición 1-based entre las rutinas activas; solo se aceptan enteros decimales simples.
export function shortcutIndex(search, count) {
  const raw = new URLSearchParams(search).get('session');
  if (raw === null || !/^[1-9]\d{0,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= count ? n - 1 : null;
}

export function hasShortcutParam(search) {
  return new URLSearchParams(search).has('session');
}

// Registra sw.js y llama a onUpdate(aplicar) cuando hay una versión nueva esperando.
// aplicar() activa la versión nueva y recarga la página cuando toma el control.
export function registerServiceWorker(onUpdate) {
  if (!('serviceWorker' in navigator)) return;
  let applying = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });
  const offer = (worker) => {
    onUpdate(() => {
      applying = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Solo hay "actualización" si ya había un SW controlando la página; la primera instalación no avisa.
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
  }).catch((err) => {
    console.warn('SW registration failed:', err);
  });
}
