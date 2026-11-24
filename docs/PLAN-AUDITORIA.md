# Plan de ejecución v2: auditorías + mejoras de producto

Fuente: sesiones "Auditoría de código y arquitectura" y "Auditoría de código y usabilidad" (24-11-2026), más las decisiones del usuario. Referencias de producto: Hevy, Strong, Boostcamp, Fitbod, Strava y Nike Training Club.

## Decisiones del usuario (cierran dudas de la v1)

| # | Decisión | Efecto en el plan |
|---|---|---|
| 1 | Plataforma: **Android** (Chrome/PWA) | Se prioriza botón atrás, vibración, Wake Lock y notificación vía Service Worker. Se baja la prioridad de los hacks de iOS (zoom y AudioContext). Los inputs de 16px se mantienen, cuestan poco |
| 2 | **No hay historial que conservar** | Migración v1→v2 reducida a un lector tolerante. Se cambia el esquema sin red de seguridad pesada. Las claves v1 se dejan intactas, solo por prudencia |
| 3 | **Todas las mejoras posibles** inspiradas en las apps de referencia | Nuevas fases 4 a 6 (registro, progresión, plan editable). Con prioridad MoSCoW para controlar el alcance |
| 4 | **Icono en una sesión aparte** | Fase 8, sesión independiente |
| 5 | Otros repos en `fungiloma.github.io` | Ver "Verificación del origen compartido" |
| 6 | **Una PR por fase** | Cada fase: rama propia `claude/fase-N-*`, PR contra `master`, apiladas solo si dependen |

## Verificación del origen compartido (punto 5)

Cuenta `Fungiloma` con 5 repos públicos: `gym-tracker`, `periodico-inversiones`, `restaurant-rate`, `investment-portfolio`, `nba-salary-audit`. Desde este entorno no puedo consultar si tienen GitHub Pages activo (el proxy bloquea `github.io` y mi acceso a GitHub se limita a `gym-tracker`). `periodico-inversiones` parece tener su propio despliegue en Cloudflare Pages, así que no compartiría origen.

Decisión: asumir el peor caso. Todas las claves de `localStorage` llevan prefijo `gymtracker.` y la CSP + escapado de la fase 1 se tratan como obligatorios. Acción del usuario, opcional: revisar en cada repo Settings → Pages. Si solo `gym-tracker` publica en `github.io`, el riesgo baja.

## Principios

- Sin framework ni bundler. ES modules nativos, servidos tal cual por GitHub Pages.
- Offline-first y sin backend. Ningún dato sale del móvil salvo que el usuario exporte o comparta.
- Cada fase termina con: `npm test` en verde, E2E Playwright (viewport Pixel 7) sin errores de consola ni violaciones CSP, un commit por bloque lógico y una PR.
- Nada se despliega hasta que el usuario hace merge a `master`. Después de cada merge, el usuario prueba en su móvil con una lista corta que dejaré en la PR.
- Lo que no pueda verificar aquí (sonido, vibración, instalación real, Wake Lock) se declara como "no verificado" en la PR.

## Hallazgos verificados antes del plan

- `index.html` monolítico (1405 líneas), ~20 `onclick` inline, sin escapado en `innerHTML` (`:885`, `:962`, `:1312`, `:1316-1322`).
- `startSession` (`:896`) borra la sesión en curso; no se reanuda tras recargar.
- Los kg anteriores se precargan como valor real (`:916-927`).
- Superseries: reps de Dominadas y Flexiones se guardan en `weight` y salen como kg (`:755-760`, `:1245`).
- Export/import anunciado en `f2b82b6` no existe. `sw.js` sin precache de `index.html`, sin `response.ok`, sin timeout.
- Iconos 1536×1024 no cuadrados. `package.json` solo trae `canvas`, sin uso.
- `tickTimers` guarda estado cada 250 ms (`:1126`).

## Fase 0. Base y red de seguridad

- `package.json`: quitar `canvas`, `"type": "module"`, scripts `test`, `check`, `e2e`.
- `LICENSE` MIT, `.gitignore` ajustado, CI `.github/workflows/ci.yml` (sintaxis JS, `npm test`, manifest JSON válido).
- E2E `tests/e2e/smoke.mjs`: abrir, iniciar sesión, apuntar kg, guardar, ver historial. Debe pasar contra el código actual.
- Quitar código muerto (`updateSessionData`, `currentScreen`).

Salida: CI verde y smoke E2E verde sobre el comportamiento actual.

## Fase 1. Reestructura y seguridad (sin cambio funcional)

- Separar en `css/app.css` y `js/{plan,storage,timers,views,app}.js`. Sustituir `onclick` por delegación `data-action`.
- Render con `textContent` o helper de escapado; ningún id interpolado en JS.
- CSP por `<meta>`: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; manifest-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'`. `blob:` y `data:` se justifican por la imagen de compartir de la fase 5.
- Prefijo `gymtracker.` en claves de almacenamiento.
- Tests unitarios de funciones puras.

Salida: smoke E2E idéntico al de la fase 0 y consola sin violaciones CSP.

## Fase 2. Modelo de datos v2 e integridad

- `PLAN` con ids estables (sesión y ejercicio). Etiquetas por campo en superseries dentro del plan (corrige reps guardadas como kg).
- Esquema `gymtracker.data` `{ schemaVersion, sessions, settings }` con validación estricta y lector tolerante de v1.
- Por serie: `type` (normal, calentamiento, drop, fallo), `weight`, `weight2`, `repsDone`, `rpe` opcional, `done`. Por sesión: `startedAt`, `endedAt`, `notes`. Por ejercicio: `notes`.
- Peso anterior como `placeholder` ("anterior: 22.5 × 8"), nunca como valor guardado.
- Borrador de sesión separado de datos y de estado de UI. Reanudar sesión en curso al abrir; confirmar antes de descartar.
- Aviso al guardar sesión vacía o con series sin completar. Error de cuota visible. `navigator.storage.persist()`.
- Export JSON (descarga y `navigator.share` con fichero) e import validado con vista previa y fusión por id. Export CSV.
- Tests: validación de entradas corruptas, import con HTML malicioso, lector v1.

Salida: recargar a mitad de sesión no pierde nada; import malicioso no ejecuta nada.

## Fase 3. Registro rápido en el gimnasio (Android primero)

Referencias: Hevy y Strong.

- Inputs de 16px, objetivos táctiles ≥44px, `inputmode="decimal"` con coma→punto y validación de rango.
- Columna "Anterior" por serie (Hevy) y botón check de serie hecha que arranca el descanso (Strong).
- Cronómetro de descanso fijo abajo, un solo descanso activo, con ±15 s; duración de descanso configurable por ejercicio.
- Copiar peso/reps de la serie anterior; añadir o quitar series al vuelo; reordenar y sustituir ejercicios en la sesión.
- Cronómetro de duración de entreno visible; notas por sesión y por ejercicio.
- Aviso de fin de descanso: vibración, sonido con un solo `AudioContext` y notificación local vía Service Worker cuando la app esté en segundo plano, siempre que Android lo permita. No se promete fiabilidad: Android puede suspender la pestaña.
- Wake Lock para mantener la pantalla encendida durante la sesión.
- Botón atrás con History API; deshacer (toast) al borrar series o sesiones.
- Guardar estado de timers solo en eventos, no cada 250 ms; arreglar timer congelado tras segundo plano.

Salida: E2E de flujo completo con recarga y botón atrás en Pixel 7 emulado.

## Fase 4. Historial y análisis

Referencias: Hevy, Strong y Strava.

- Historial por sesión y por ejercicio, con filtros y búsqueda.
- Cálculo de 1RM estimado (Epley), volumen por ejercicio/sesión/semana y detección de récords personales (peso, reps, 1RM, volumen) con aviso al batir uno.
- Gráficas SVG propias, sin librerías: progresión por ejercicio, volumen semanal, frecuencia.
- Calendario de entrenos y rachas semanales (Strava/Nike).
- Resumen semanal automático, con texto copiable para el chat entrenador.
- Peso corporal y medidas opcionales, con gráfica.

Salida: tests unitarios de 1RM, volumen y récords con casos límite; E2E con datos sembrados.

## Fase 5. Progresión, compartir y motivación

Referencias: Boostcamp, Fitbod y Nike Training Club.

- Sugerencia de sobrecarga progresiva: si se llega al tope del rango de reps en todas las series, sugerir subir carga (regla simple y visible, no caja negra). Regla de descarga tras N semanas o caída de rendimiento, solo como aviso.
- Volumen semanal por grupo muscular, con un mapa ejercicio→músculo en el plan (inspirado en Fitbod). Aviso de grupos infraentrenados.
- Calculadora de discos para barra (configurable), y modo "un ejercicio por pantalla" guiado (Nike).
- Imagen resumen para compartir (Strava): tarjeta generada con `<canvas>`, compartida con `navigator.share`.
- Ajustes: unidades kg/lb, tema claro/oscuro, sonido/vibración, descanso por defecto.

Salida: tests de la regla de progresión y del volumen por grupo; E2E de la tarjeta compartida (se comprueba que se genera, no cómo se ve en WhatsApp).

## Fase 6. Plan editable

Cambia una decisión de las auditorías, que desaconsejaban un editor de plan. El usuario pide todas las mejoras, así que entra, pero acotado.

- Biblioteca de ejercicios propia (nombre, músculo, tipo) con ids.
- Editor de rutinas en la app: crear, duplicar, reordenar, editar series, rangos y descansos.
- Import/export del plan en JSON (plantillas tipo Boostcamp). El plan actual pasa a ser la rutina por defecto.
- Reglas para no romper historial: un ejercicio con historial no se borra, se archiva.

Salida: tests de validación del plan y de archivado; E2E de crear una rutina y completarla.

## Fase 7. PWA y Service Worker

- Precache del shell completo, solo respuestas `ok` de mismo origen, network-first con timeout de 3 s para navegación y `ignoreSearch` en `?session=N`.
- Rutas relativas en manifest y SW. Versión de caché única. Aviso "nueva versión disponible" con botón de recargar.
- Manifest: `id`, iconos `any` y `maskable`, atajos por sesión (máx. 4 en Android), quitar el screenshot falso.
- E2E offline con `context.setOffline(true)` tras la primera visita.

Salida: la app abre y guarda sin red en Chromium emulado.

## Fase 8. Icono (sesión aparte)

Tarea independiente, lanzada como sesión propia. No puedo generar imágenes con un modelo de imagen: la sesión creará el icono de forma programática (SVG/Pillow) con tu paleta (`#6366f1` sobre `#0a0a0f`), exportará 192, 512 y 512 maskable más `apple-touch-icon`, y lo validará en el manifest. Si prefieres un diseño propio, sube una imagen cuadrada y la sesión solo la recorta y exporta.

## Fase 9. Documentación y gobierno

- README al día (funciones reales, backup por export, sin "cache-first" ni "notificación" falsa), `SECURITY.md`, `CHANGELOG.md`, `.github/dependabot.yml` (solo `github-actions`).

## Priorización (MoSCoW) si hay que recortar

- **Must:** fases 0, 1, 2, 3 y 7. Cierran los hallazgos de las dos auditorías.
- **Should:** fase 4 y fase 9.
- **Could:** fases 5 y 6. Son las que más alargan el trabajo y más superficie de error añaden.
- **Aparte:** fase 8.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Alcance excesivo (fases 4 a 6 son prácticamente una app nueva) | Una PR por fase, MoSCoW, parar en cualquier fase sin dejar la app rota |
| CSP rompe algo no cubierto por E2E | Revisión de consola en cada fase; relajar en commit aislado |
| Comportamiento real de Android distinto de la emulación (notificaciones, Wake Lock, vibración) | Lista de comprobaciones manual del usuario tras cada merge |
| SW antiguo sirve versión vieja tras desplegar | Nuevo nombre de caché y aviso de actualización |
| Reglas de progresión mal calibradas dan consejos malos | Reglas simples, visibles y desactivables; sin presentarlas como asesoramiento |

## Fuera de alcance

- Sincronización entre dispositivos y backend.
- Notificaciones push reales (requieren servidor).
- Clickjacking (`frame-ancestors` no funciona en `<meta>`); impacto nulo en esta app.
