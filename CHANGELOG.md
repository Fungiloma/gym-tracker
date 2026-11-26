# Changelog

Cambios por fase del plan de auditoría ([docs/PLAN-AUDITORIA.md](docs/PLAN-AUDITORIA.md)). El historial de commits es la fuente definitiva.

## CI con E2E

- Nuevo job `e2e` en `.github/workflows/ci.yml`: `npm ci`, Chromium de Playwright con caché y `npm run e2e` (los 12 E2E, Pixel 7 emulado). El job `check` (sintaxis y tests unitarios) no cambia.
- Playwright pasa a devDependency con versión exacta (1.63.0) y se añade `package-lock.json`. Dependabot vigila también npm.

## Fase 10b. Correcciones y rendimiento

- Una serie solo cuenta como hecha (volumen, récords, sobrecarga) con ✓; al guardar se avisa de las series con valores sin marcar.
- Récord de repeticiones solo frente a una serie previa con el mismo peso; los drops no lo generan.
- Historial paginado (50 y "Ver más"), búsqueda con debounce de 200 ms y expandir sin repintar: con 2.000 sesiones y CPU x4, abrir pasa de 1,8 s a 0,2 s.
- Aviso al pasar del 70 % de la cuota estimada de localStorage.
- Correcciones: Deshacer de serie quitada ligado a su borrador, límite único de descanso (3.600 s), doble atrás, redondeo de récords en lb, cabecera del resumen semanal en el cambio de hora, límite de rutinas solo para activas, ids de ejercicios v1 por nombre, 1RM sin punto a 0, duración vacía como 0.
- Detalle en [docs/REVISION-CODIGO.md](docs/REVISION-CODIGO.md). `CACHE_VERSION` sube a v8.

## Fase 10a. Integridad de datos

- Datos dañados o de una versión más nueva: no se escribe en `gymtracker.data` hasta descargar el original; el aviso solo habla de copia si se hizo.
- Borrar en el historial: un doble toque borra una sola sesión o medida, y los borrados seguidos se deshacen juntos.
- El último valor tecleado en kg o reps se guarda al pasar la app a segundo plano.
- Una sesión en curso cuya rutina ya no está en el plan se copia a `gymtracker.draft.backup` y se puede descargar.
- Detalle en [docs/REVISION-CODIGO.md](docs/REVISION-CODIGO.md).

## Fase 9. Documentación y gobierno

- README reescrito con las funciones reales, copias de seguridad de historial y de plan por separado, y lo que la app no hace.
- Añadidos `SECURITY.md`, este changelog y Dependabot para `github-actions`.

## Fase 7. PWA y Service Worker

- Precaché de todo el shell, solo respuestas correctas de mismo origen, navegación sin red hacia `index.html` y red primero con máximo de 3 s.
- Rutas relativas para funcionar en raíz y en `/gym-tracker/`.
- Aviso de actualización con "Recargar", `id` en el manifiesto y atajos por rutina (`?session=N`).

## Fase 6. Plan editable

- Plan en `gymtracker.plan` con versión propia y validación estricta; el esquema de datos sigue en v2.
- Biblioteca de ejercicios, editor de rutinas, import y export del plan en JSON.
- Archivado en lugar de borrado para lo que use el historial o la sesión en curso.

## Fase 5. Progresión, compartir y ajustes

- Sugerencias de sobrecarga y avisos de descarga, visibles y desactivables.
- Volumen semanal por grupo muscular, calculadora de discos y modo guiado.
- Tarjeta de imagen para compartir, kg y lb (guardado en kg), tema, sonido y vibración.

## Fase 4. Historial y análisis

- 1RM estimado (Epley), récords, gráficas SVG de volumen, calendario con rachas.
- Resumen semanal copiable y peso corporal opcional.

## Fase 3. Registro rápido

- Check por serie que arranca el descanso, barra de descanso única, columna "Anterior", entrada decimal con coma.
- Notas por sesión y ejercicio, deshacer borrado, botón Atrás de Android, vibración y Wake Lock.

## Fase 2. Modelo de datos v2

- Esquema v2 estricto con lector tolerante de v1, ids estables y borrador de sesión.
- Manejo de errores de cuota, copia de respaldo ante datos dañados, export JSON y CSV, e import validado con fusión por id.
- Las claves antiguas solo se leen, nunca se escriben ni se borran.

## Fase 1. Reestructura y seguridad

- `index.html` dividido en CSS y módulos ES; sin manejadores inline (delegación por `data-action`).
- Datos de usuario pintados con `textContent`, CSP por meta y claves `gymtracker.*` con lectura de las antiguas.

## Fase 0. Base y red de seguridad

- Tests estáticos y unitarios, E2E de humo con Playwright, CI, licencia MIT y eliminación de código muerto.

## Fase 8. Icono

- Conjunto de iconos cuadrados (192, 512, maskable, apple-touch y favicon) generados desde SVG.
