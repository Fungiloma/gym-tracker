# Changelog

Cambios por fase del plan de auditoría ([docs/PLAN-AUDITORIA.md](docs/PLAN-AUDITORIA.md)). El historial de commits es la fuente definitiva.

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
