# Plan de ejecución: auditorías de arquitectura y usabilidad

Fuente: sesiones "Auditoría de código y arquitectura" y "Auditoría de código y usabilidad" (24-11-2026). Las dos coinciden en lo esencial; este plan las une, elimina duplicados y fija un orden que evita hacer dos veces el mismo trabajo.

Hallazgos verificados en el código antes de redactar el plan:
- `index.html` monolítico (1405 líneas): CSS, JS y ~20 `onclick` inline. Sin escapado en `innerHTML` (`index.html:885`, `962`, `1312`, `1316-1322`).
- `startSession` (`index.html:896`) borra la sesión en curso; al recargar no se reanuda.
- Los kg de la sesión anterior se precargan como valor real (`index.html:916-927`), no como sugerencia.
- Superseries: las reps de Dominadas y Flexiones se guardan en `weight` y el resumen pone "kg" (`index.html:755-760`, `1245`).
- No existe export/import aunque el commit `f2b82b6` lo anuncie.
- `sw.js` no precachea `index.html`, no comprueba `response.ok` ni origen y no tiene timeout.
- Iconos `icons/icon-192.png` y `icon-512.png`: ambos 1536×1024, no cuadrados.
- `package.json` solo declara `canvas`, que no se usa.

## Principios

- Sin framework, sin bundler, sin backend. ES modules nativos servidos tal cual por GitHub Pages.
- Los datos del usuario nunca se pierden: la migración escribe en una clave nueva y conserva las antiguas (`gym-sessions`, `gym-state`) como copia de rollback.
- Cada fase termina con `npm test` en verde, prueba E2E con Playwright contra `python3 -m http.server` y un commit propio.
- Nada se despliega hasta que el usuario hace merge a `master` (GitHub Pages publica desde ahí).

## Fase 0. Base y red de seguridad

| Tarea | Origen |
|---|---|
| Quitar `canvas` de `package.json`; añadir `"type": "module"` y scripts `test` (`node --test`) y `check` | Arq. L6 |
| `LICENSE` MIT (el README ya lo declara) | Arq. L7 |
| CI en `.github/workflows/ci.yml`: `node --check` de cada JS, `npm test`, validación JSON del manifest | Arq. L7 |
| Script E2E `tests/e2e/smoke.mjs` con Playwright: abrir app, iniciar sesión, apuntar kg, guardar, ver historial | Nuevo |
| Eliminar código muerto: `updateSessionData`, `currentScreen` | Usab. P3 |

Criterio de salida: CI verde; el smoke E2E pasa contra el código actual sin cambios de comportamiento.

## Fase 1. Reestructura sin cambio funcional

| Tarea | Origen |
|---|---|
| Separar en `css/app.css`, `js/plan.js`, `js/storage.js`, `js/timers.js`, `js/views.js`, `js/app.js` | Arq. arquitectura objetivo |
| Sustituir `onclick` inline por delegación con `data-action` | Arq. A2 |
| Renderizar datos con `textContent` o helper `escapeHTML`; ids nunca interpolados en JS | Arq. A1, Usab. P3 |
| Estilos inline dinámicos a clases CSS o `style.setProperty` | Arq. A2 |
| CSP por `<meta>`: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'` | Arq. A2 |
| Tests unitarios de funciones puras (formato de tiempo, resumen, escapado) | Arq. L7 |

Criterio de salida: mismo comportamiento que fase 0 (smoke E2E idéntico), cero violaciones CSP en consola de Chromium.

## Fase 2. Modelo de datos v2 e integridad

Fase más delicada: cambia el esquema y migra el historial real.

| Tarea | Origen |
|---|---|
| Ids estables en `PLAN` (`session.id`, `exercise.id`); minutos y emoji dentro del plan | Arq. M3, Usab. 8 y P3 |
| Etiquetas por campo en superseries (`kg` / `reps`) declaradas en el plan, no en un mapa por nombre | Usab. 4 |
| Esquema versionado `gym-data` `{ schemaVersion: 2, sessions: [...] }` con validación al cargar y migración desde v1 | Arq. A3, M4 |
| Por serie: `weight`, `weight2`, `repsDone`, `done`, opcional `rpe`. Por sesión: `startedAt`, `endedAt`, `notes`. Por ejercicio: `notes` | Usab. 5, 6, 7, 9 |
| Peso anterior como `placeholder`/sugerencia, no como valor guardado | Usab. 2 |
| Separar estado de UI (`gym-ui`) del borrador de sesión (`gym-draft`) y de los datos (`gym-data`) | Arq. M5 |
| Reanudar sesión en curso al abrir la app; confirmar antes de descartar o empezar otra | Usab. 1, Arq. A4 |
| Aviso al guardar sesión vacía; guard contra `activeSession` nulo | Usab. P0, Arq. L1 |
| Error de cuota visible al usuario, no solo `console.log` | Arq. A4 |
| Export JSON (descarga y `navigator.share` con fichero) e import validado con vista previa y fusión por id | Arq. A4, Usab. 3 |
| `navigator.storage.persist()` | Arq. fase 1 |
| Tests: migración v1→v2 con fixtures, validación de entradas corruptas, import malicioso (HTML en nombres) | Nuevo |

Criterio de salida: un historial v1 de ejemplo migra sin pérdida; las claves v1 siguen intactas; import de JSON con `<img onerror>` no ejecuta nada.

## Fase 3. Usabilidad en el gimnasio

| Tarea | Origen |
|---|---|
| Inputs ≥16px (evita zoom iOS) y objetivos táctiles ≥44px | Usab. 10, 11 |
| `type="text" inputmode="decimal"` con coma→punto y validación de rango | Usab. 12, Arq. L4 |
| Botón "hecha" por serie que arranca el descanso automáticamente | Usab. 6 |
| Barra de descanso fija inferior, un solo descanso activo | Usab. 13 |
| Copiar peso de la serie anterior al pasar a la siguiente (myo-reps, drop sets) | Usab. 16 |
| Aviso de fin de descanso fiable: un único `AudioContext` desbloqueado en un toque, `navigator.vibrate`, sin prometer notificación | Usab. 14, Arq. M8 |
| Arreglar timer congelado tras segundo plano y duración "1m" por defecto | Usab. 23, Arq. L2 |
| Guardar timers solo en eventos (inicio, pausa, fin, `visibilitychange`), no cada 250 ms | Arq. M2 |
| Botón atrás de Android con History API (`pushState`/`popstate`) | Usab. 15 |
| Portada: última fecha de cada sesión y sesión sugerida; quitar título duplicado | Usab. 17 |
| Historial: recopiar resumen, evolución por ejercicio (último peso y mejor marca), `navigator.share` | Usab. 18 |
| `copySummary` con manejo de error y sin código duplicado | Arq. L3 |
| Resumen con reps reales y unidades correctas | Usab. 4, 5 |

Criterio de salida: E2E en viewport de Pixel 7 e iPhone 14 (emulados): flujo completo, recarga a mitad de sesión sin pérdida, botón atrás.

## Fase 4. PWA y Service Worker

| Tarea | Origen |
|---|---|
| Precachear shell completo (`./`, `index.html`, CSS, JS, manifest, iconos) en `install` | Arq. A5, Usab. 19 |
| Guardar en caché solo respuestas `ok`, mismo origen y `type === 'basic'` | Arq. A6, Usab. 21 |
| Network-first con timeout de 3 s para navegación, `ignoreSearch` para `?session=N` | Arq. M1, Usab. 20 |
| Versión de caché ligada a una constante única; aviso "nueva versión disponible" | Nuevo |
| Rutas relativas en manifest y SW (hoy `/gym-tracker/` fijado en varios sitios) | Arq. L5 |
| Iconos cuadrados 192 y 512, variante `maskable`, `apple-touch-icon`; quitar screenshot falso; añadir `id` | Usab. 22, Arq. L5 |
| Atajo `?session=N` implementado en la app; un atajo por sesión | Arq. M7, Usab. 22 |

Criterio de salida: E2E con Playwright offline (`context.setOffline(true)`) tras la primera visita: la app abre y guarda.

## Fase 5. Documentación y gobierno del repo

| Tarea | Origen |
|---|---|
| README actualizado: funciones reales, backup por export, sin "notificación" ni "cache-first" | Arq. M7, Usab. P3 |
| `SECURITY.md` y `.github/dependabot.yml` (solo `github-actions`) | Arq. L7 |
| `CHANGELOG.md` con la migración v1→v2 | Nuevo |

## Fuera de alcance

- Sincronización entre dispositivos o backend.
- Editor del plan dentro de la app.
- Notificaciones push reales (requieren servidor).
- Mitigar clickjacking: no se puede con `<meta>` en GitHub Pages; impacto nulo.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La migración corrompe el historial real | Claves v1 intactas, tests con fixtures, export disponible en la misma versión |
| CSP rompe algo no cubierto por E2E | Revisión de consola en Chromium; la CSP se puede relajar en un commit |
| Comportamiento distinto en iOS/Android real frente a emulación | Prueba manual del usuario tras merge, con checklist |
| SW antiguo sirve la versión vieja tras el deploy | Nuevo nombre de caché y `skipWaiting` controlado con aviso de actualización |

## Validación prevista por fase

- `npm test` (node:test).
- `node tests/e2e/smoke.mjs` contra `python3 -m http.server`.
- Revisión de consola sin errores ni violaciones CSP.
- Prueba en teléfono real: manual, del usuario.
