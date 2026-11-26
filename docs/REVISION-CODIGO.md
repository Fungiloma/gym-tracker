# Revisión de código: integridad de datos

Revisión de `js/app.js`, `js/routines.js` y `js/stats.js` sobre `master` en `67fe0a0`. Salieron 17 hallazgos. La fase 10a arregla los cuatro que pueden perder datos del usuario: 1, 2, 5 y 6. Los bugs 3, 4 y 7 a 17 se tratan en la fase 10b.

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

**Pendiente:** reconstruirlo como rutina huérfana. El borrador es autodescriptivo, pero el título de la sesión, el resumen de home y `finalizeDraft` dependen de que la rutina exista en el plan. Se deja para la fase 10b.

## Extra encontrado durante la fase 10a

**Toast con "null".** `toast()` pasaba `null` a `replaceChildren` cuando no había Deshacer, y el DOM lo convierte en el texto "null" al final de cada aviso sin botón. Ya estaba en `67fe0a0`. Se arregla filtrando los hijos, y lo cubre una aserción en el escenario 2 de `tests/e2e/integrity.mjs`.
