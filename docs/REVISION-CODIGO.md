# Revisión de código: integridad de datos

Revisión de `js/app.js`, `js/routines.js` y `js/stats.js` sobre `master` en `67fe0a0`. Salieron 17 hallazgos. La fase 10a arregló los cuatro que pueden perder datos del usuario (1, 2, 5 y 6) y el 8. La fase 10b arregla los demás (3, 4, 7, 9 a 17) y unas sospechas triviales. Estado: **los 17 hallazgos están arreglados**.

| Bug | Estado | Fase | Test |
|---|---|---|---|
| 1 Copia de seguridad que no se comprueba | Arreglado | 10a | `tests/unit.test.mjs`, `tests/e2e/integrity.mjs` |
| 2 Doble toque en 🗑 y un solo Deshacer | Arreglado | 10a | `tests/e2e/integrity.mjs` |
| 3 Series sin ✓ cuentan como hechas | Arreglado | 10b | `tests/revision.test.mjs`, `tests/e2e/data.mjs` |
| 4 Récords de repeticiones falsos | Arreglado | 10b | `tests/revision.test.mjs` |
| 5 Último valor sin guardar en segundo plano | Arreglado | 10a | `tests/e2e/integrity.mjs` |
| 6 Borrador de rutina propia perdido | Arreglado | 10a | `tests/unit.test.mjs`, `tests/e2e/integrity.mjs` |
| 7 Rendimiento con historiales grandes | Arreglado | 10b | `tests/e2e/revision.mjs` (escenarios 6 y 7), `tests/revision.test.mjs`, `npm run bench` |
| 8 | Arreglado en la 10a (no se detalla en este documento) | 10a | |
| 9 Deshacer de "Serie quitada" en otro borrador | Arreglado | 10b | `tests/e2e/revision.mjs` (2) |
| 10 "+15 s" reduce descansos largos | Arreglado | 10b | `tests/e2e/revision.mjs` (1) |
| 11 Doble redondeo de récords en lb | Arreglado | 10b | `tests/revision.test.mjs` |
| 12 Cabecera semanal en el cambio de hora | Arreglado | 10b | `tests/revision-tz.test.mjs` |
| 13 Límite de 50 rutinas cuenta las archivadas | Arreglado | 10b | `tests/revision.test.mjs` |
| 14 Ids v1 posicionales | Arreglado | 10b | `tests/revision.test.mjs` |
| 15 Punto de 1RM a 0 | Arreglado | 10b | `tests/revision.test.mjs` |
| 16 Doble "atrás" | Arreglado | 10b | `tests/e2e/revision.mjs` (3) |
| 17 Duración vacía | Arreglado | 10b | `tests/revision.test.mjs` |

Cada arreglo lleva tests que fallan con el código de `67fe0a0` y pasan con el arreglo: `tests/unit.test.mjs` y `tests/e2e/integrity.mjs`. Para lanzar un solo escenario del E2E: `E2E_ONLY=3 node tests/e2e/integrity.mjs`.

## Bug 1 (alta). Copia de seguridad que no se comprueba

**Problema.** Si `gymtracker.data` no validaba (JSON roto, o un `schemaVersion` distinto de 2 al volver a una versión anterior de la app), `loadData` devolvía datos vacíos y la app seguía como si nada. `backupRaw` ignoraba el resultado de la escritura, así que el aviso decía "se ha guardado una copia en gymtracker.data.backup" aunque no fuera cierto. La siguiente acción que guardaba sobrescribía `gymtracker.data` y se perdía todo el historial. Con datos que ocupan más de la mitad de la cuota (unas 1.000 sesiones), la copia da `QuotaExceededError` y no queda nada.

**Arreglo** (`js/storage.js`, `js/app.js`, `index.html`, `css/app.css`):

- `loadData` devuelve `raw`, el resultado de la copia (`backup`) y `locked`.
- Con `source` igual a `corrupt` o `newer`, o con registros apartados cuya copia falló, `saveData` queda bloqueado para ese storage y devuelve `{ ok: false, locked: true }`. Hay un aviso fijo arriba con "Descargar copia", que descarga el texto literal. Después aparece "Ya la tengo", que pide confirmación y desbloquea.
- El toast solo habla de copia si se hizo.
- Un `schemaVersion` mayor que 2 avisa de "versión más nueva" y no de datos dañados.
- `loadPlan` también informa de si la copia del plan se hizo, y el toast del plan es honesto.

## Bug 2 (alta). Doble toque en 🗑 y un solo Deshacer

**Problema.** Borrar en el historial era inmediato. El repintado síncrono dejaba el 🗑 de la tarjeta siguiente en la misma posición, así que un doble toque borraba dos sesiones. Cada `toast()` sustituía al Deshacer anterior, así que solo se recuperaba una.

**Arreglo** (`js/app.js`):

- Los borrados hechos mientras sigue visible el toast del anterior se agrupan en un solo toast ("3 sesiones borradas"). Su Deshacer los restaura todos, en su posición original.
- Durante 400 ms después de borrar se ignoran los clics en `[data-action^=delete-]` y en el Deshacer del toast. Lo segundo apareció en el E2E: si el 🗑 está al final de la pantalla, el toast sale justo debajo del dedo y el segundo toque deshacía el borrado.
- Aplica igual a las medidas corporales (`deleteBody`).

## Bug 5 (media). Último valor sin guardar al pasar a segundo plano

**Problema.** Los inputs de kg y reps solo guardan en `change`. Si la app pasaba a segundo plano con el teclado abierto y Android mataba la pestaña, se perdía el último valor. No está verificado en Chrome Android real.

**Arreglo** (`js/app.js`): con `visibilitychange` a `hidden` y en `pagehide`, si el foco está en un `.kg-input` de la sesión, se despacha `change` y el valor se vuelca al borrador.

## Bug 6 (media). Borrador de rutina propia perdido si el plan se daña

**Problema.** Si `gymtracker.plan` se dañaba, la app volvía al plan por defecto. El borrador de una rutina propia no se podía reconstruir (`restoreDraft` devolvía `null`), la app abría en home sin avisar, y empezar otra rutina sobrescribía `gymtracker.draft`.

**Arreglo** (`js/storage.js`, `js/app.js`):

- `loadDraftState` copia el texto a `gymtracker.draft.backup` y lo devuelve como `lost`.
- El aviso fijo ofrece descargarlo y persiste mientras exista la copia, también tras recargar. "Ya la tengo" retira la copia.
- Si la copia no cabe, empezar otra rutina pide confirmación antes de sobrescribir el borrador.

**Pendiente:** reconstruirlo como rutina huérfana. El borrador es autodescriptivo, pero el título de la sesión, el resumen de home y `finalizeDraft` dependen de que la rutina exista en el plan. No se aborda en la fase 10b: sigue la descarga de la copia como vía de recuperación.

## Extra encontrado durante la fase 10a

**Toast con "null".** `toast()` pasaba `null` a `replaceChildren` cuando no había Deshacer, y el DOM lo convierte en el texto "null" al final de cada aviso sin botón. Ya estaba en `67fe0a0`. Se arregla filtrando los hijos, y lo cubre una aserción en el escenario 2 de `tests/e2e/integrity.mjs`.

## Fase 10b

Cada arreglo lleva un test que falla con el código de `fe09422` y pasa con el arreglo: `tests/revision.test.mjs`, `tests/revision-tz.test.mjs` (con `TZ=Europe/Madrid` fijada dentro del test) y `tests/e2e/revision.mjs` (`E2E_ONLY=3 node tests/e2e/revision.mjs` lanza un escenario).

### Bug 3 (media). Una serie con valores pero sin ✓ contaba como hecha

**Problema.** `finalizeDraft` guardaba `done: hasValues(s)`, así que una serie tecleada y no marcada contaba para volumen, récords y sobrecarga (`stats.js` y `progress.js` filtran por `done`).

**Arreglo** (`js/data.js`, `js/app.js`). Se guarda `done: s.done && hasValues(s)`. `draftStats` devuelve además `unchecked` (series con valores sin ✓). `completeSession` avisa de "N series con valores sin marcar (✓): no cuentan para récords, volumen ni sobrecarga" y de las series vacías; aceptar guarda igualmente (los valores se conservan) y cancelar vuelve a la sesión. Las sesiones ya guardadas no se migran: conservan su `done`. README y E2E (`data.mjs`, `history.mjs`) actualizados.

### Bug 4 (media). Récords de repeticiones falsos

**Problema.** Se comparaba cada serie con cualquier serie previa de peso igual o mayor, así que 60×8 tras 100×5, un drop 50×12 o un peso nuevo daban récord de repeticiones.

**Arreglo** (`js/stats.js`). Solo hay récord de repeticiones si existe una serie previa sin drop con el mismo peso (tolerancia de 0,05 kg para el redondeo lb↔kg) y se supera. Se excluyen los drops y las series que ya son récord de peso.

### Bug 7 (media). Rendimiento con historiales grandes

**Problema.** Con 2.000 sesiones y CPU x4 el historial pintaba todas las tarjetas (60.000 nodos) y cada tecla de búsqueda y cada expansión repintaban la lista entera.

**Arreglo** (`js/views.js`, `js/history.js`, `js/app.js`, `js/plan.js`, `js/data.js`, `js/storage.js`):

- Paginación: 50 tarjetas y "Ver más" (`view.limit`, se reinicia al cambiar de pestaña, filtro o búsqueda).
- Búsqueda con debounce de 200 ms y texto normalizado cacheado por sesión (`WeakMap`).
- Expandir alterna la clase de la tarjeta en vez de repintar.
- `sessionVolume` se calcula una vez por tarjeta.
- `findPlanExercise` y `fieldsForExerciseId` se memorizan por revisión del plan (`planRevision`).
- Aviso en Inicio al pasar del 70 % de la cuota estimada de localStorage (5 millones de caracteres; es una estimación porque el navegador no expone la cuota).
- IndexedDB queda fuera de alcance.

`npm run bench` (`tests/bench/history-perf.mjs`) siembra las sesiones y mide. Cifras con 2.000 sesiones, CPU x4, Pixel 7, mediana de 3 ejecuciones:

| | Antes | Después |
|---|---|---|
| Abrir historial | 1.756 ms | 161 ms |
| Nodos DOM | 60.468 | 1.691 |
| Coste de cada tecla (hilo principal) | 598 ms | 0 ms |
| Ver el resultado filtrado desde la última tecla | 473 ms | 208 ms |
| Expandir una tarjeta | 1.407 ms | 36 ms |

### Bug 9 (baja). Deshacer de "Serie quitada" en otro borrador

El cierre captura `draft.id` y no hace nada si el borrador actual es otro. `endDraft()` llama a `hideToast()`.

### Bug 10 (baja). "+15 s" reduce un descanso largo

`REST_STEP_MAX` (600), `MAX_REST` (3600) y `MAX_TIMER` (3600) son ahora uno: `MAX_REST` en `js/data.js`.

### Bug 11 (baja). Doble redondeo de récords en lb

Los récords y `exerciseBests` guardan el valor sin redondear en kg; `displayWeight` redondea una sola vez al mostrar. 225 lb ya no sale como 225,1 ni 1100 lb de volumen como 1100,1.

### Bug 12 (baja). Cabecera del resumen semanal en el cambio de hora

El último día se calcula con `new Date(y, m, d + 6)` desde `weekTs` en vez de `end - DAY`. Con `TZ=Europe/Madrid` la semana del 24 de marzo de 2025 pasa de acabar el 29 a acabar el 30.

### Bug 13 (baja). Límite de rutinas

El límite de 50 cuenta solo rutinas activas; las archivadas tienen su propio límite de 200. Restablecer o importar un plan ya no falla por las archivadas que conserva el historial.

### Bug 14 (baja). Ids posicionales en el lector v1

Los ejercicios que no están en el plan usan `slugId(nombre)` en vez de `v1-ex-N`. Los historiales v1 ya importados con ids posicionales no se corrigen: haría falta reimportar el fichero v1 original.

### Bug 15 (baja). Punto de 1RM a 0

`exerciseProgress` devuelve `best1RM: null` cuando ninguna serie tiene 1RM fiable (más de 30 reps) y la gráfica omite el punto. La ficha muestra "—" si no hay 1RM.

### Bug 16 (baja). Doble "atrás"

Una bandera `goingBack` ignora los "atrás" siguientes hasta que llega `popstate` (con un temporizador de 600 ms por si no llega). Riesgo real bajo.

### Bug 17 (baja). Duración vacía

Un campo de duración (o de descanso de serie) vacío vale 0 en vez de dar un error técnico; el texto no numérico se sigue rechazando.

### Sospechas triviales

- `navigator.clipboard.writeText` sin `catch`: ahora cae al método del textarea y avisa si ambos fallan (`tests/e2e/revision.mjs`, escenario 4).
- `stamp()` usaba la fecha UTC en el nombre del export: ahora es la local (escenario 5, con zona Pacific/Auckland).
- `initServiceWorker` añadía un listener al botón de recarga en cada oferta de versión: ahora hay uno solo. Sin test propio: el escenario de actualización de `tests/e2e/offline.mjs` cubre el clic, pero no ofrecer dos versiones seguidas.

### Limpieza (commits aparte)

`getUnit` sin uso en `app.js`; `todayKey` de `stats.js` reutilizado en `history.js`; `shiftCalendar` usa `shiftMonth`; `clone` único; `parseDecimal` en `units.js` sustituye al regex numérico repetido en `parseValue`, `parseBodyInput`, `inputToKg` y `readPlatesForm`.
