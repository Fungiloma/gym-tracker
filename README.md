# Gym Tracker

PWA de registro de entrenamiento en JavaScript vanilla (módulos ES, sin dependencias de ejecución). Todo se guarda en el `localStorage` del móvil: no hay servidor, cuenta ni sincronización.

App: https://fungiloma.github.io/gym-tracker/

## Instalación en Android

1. Abre la app en Chrome.
2. Menú de Chrome, "Instalar app" (o el aviso de instalación si aparece).
3. Se añade al launcher como app independiente. Mantener pulsado el icono muestra un atajo por rutina.

En iOS (Safari, "Añadir a pantalla de inicio") debería funcionar, pero no se prueba de forma habitual.

## Qué hace

**Registro rápido.** Elige una rutina en la pantalla principal. Cada serie tiene peso y repeticiones (admite coma decimal) y un check: al marcarla arranca el descanso. Si la serie estaba vacía, copia la de encima. La columna "Anterior" muestra la última sesión de esa rutina y se puede tocar para reutilizarla. Puedes añadir o quitar series, mover o sustituir ejercicios, escribir notas por ejercicio y por sesión, y deshacer un borrado durante unos segundos. Hay un modo guiado de un ejercicio por pantalla. La sesión en curso se guarda como borrador y se reanuda si cierras la app. Se pide mantener la pantalla encendida (Wake Lock) mientras la sesión está abierta, si el navegador lo permite. El botón Atrás de Android navega por la app.

**Descanso.** Una única barra fija abajo con ±15 s, pausa y saltar. Cada ejercicio tiene su descanso, ajustable. Al terminar suena un pitido y vibra, según Ajustes. El descanso se calcula con la hora de inicio, así que se recupera al volver a la app tras el segundo plano.

**Historial y análisis** (pantalla Historial, seis pestañas): Sesiones, Ejercicios (1RM estimado con Epley, mejores marcas y récords), Gráficas (volumen semanal en SVG), Músculos (series por grupo y semana), Calendario (con rachas semanales) y Cuerpo (peso corporal opcional). Hay búsqueda y filtro por rutina, y un resumen semanal copiable. Al terminar una sesión se copia un resumen de texto o se genera una imagen para compartir con el menú del sistema.

**Progresión.** Sugerencia de subir carga (2,5 kg o 5 lb) cuando en la última sesión de un ejercicio con rango de repeticiones (por ejemplo 8-10) se hicieron todas las series y todas llegaron al tope. Aviso de descarga tras 6 semanas seguidas entrenando, o si el 1RM estimado cae por debajo del 95 % del mejor reciente en las dos últimas sesiones. Aviso de grupos con menos de 6 series semanales. Son reglas fijas y orientativas, desactivables en Ajustes; no son asesoramiento médico ni un plan personalizado.

**Ajustes.** Unidades kg o lb (los pesos se guardan siempre en kg), tema automático, oscuro o claro, sonido y vibración al acabar el descanso, descanso por defecto para ejercicios sin descanso propio y progresión activada o no. Incluye una calculadora de discos con barra y discos configurables.

**Plan editable** (Rutinas y ejercicios). Crear, renombrar, duplicar, reordenar y archivar rutinas, editar ejercicios y series de cada rutina y mantener una biblioteca de ejercicios. Un ejercicio o rutina con historial no se borra: se archiva, para que el historial siga enlazado. Sin ediciones se usa el plan por defecto.

## Copias de seguridad: historial y plan por separado

Son dos ficheros distintos y **el export del historial no incluye el plan**.

- **Historial** (Historial, "Copia de seguridad"): Descargar o Compartir JSON, Descargar CSV e Importar JSON. El JSON contiene sesiones, peso corporal y ajustes. Importar muestra una vista previa y fusiona por id: nunca sobrescribe lo local, solo añade lo nuevo. También lee el formato antiguo (v1) y rechaza ficheros de una versión más nueva.
- **Plan** (Rutinas y ejercicios): Exportar plan e Importar plan. Importar **sustituye** rutinas y biblioteca, y conserva archivado lo que el historial necesita. Un fichero de historial se rechaza como plan y al revés.

Para cambiar de móvil o proteger los datos, exporta ambos. Desinstalar la app o borrar los datos del sitio elimina el `localStorage`.

## Claves de almacenamiento

| Clave | Contenido |
|---|---|
| `gymtracker.data` | Datos v2: sesiones, peso corporal y ajustes |
| `gymtracker.draft` | Sesión en curso |
| `gymtracker.ui` | Estado de interfaz: descanso activo, descansos por ejercicio, tarjetas expandidas |
| `gymtracker.plan` | Plan editado o importado; si no existe se usa el de por defecto |
| `gymtracker.data.backup`, `gymtracker.plan.backup` | Copia literal si el contenido estaba dañado (o era de una versión más nueva), si cabe en el almacenamiento |
| `gymtracker.draft.backup` | Copia literal de una sesión en curso cuya rutina ya no está en el plan, hasta que la descargas |

Si `gymtracker.data` no se puede leer, la app muestra un aviso fijo con "Descargar copia" y no escribe nada en el historial hasta que descargas el original y confirmas. Así ni una copia que no cupo ni volver a una versión anterior de la app pueden borrar el historial.
| `gymtracker.sessions`, `gymtracker.state`, `gym-sessions`, `gym-state` | Claves antiguas: solo se leen, nunca se escriben ni se borran |

## Sin conexión y actualizaciones

El Service Worker precachea todo el shell (HTML, CSS, módulos, manifiesto e iconos). Las peticiones de mismo origen usan red primero con un máximo de 3 s y, si falla o tarda, sirven la copia cacheada; la navegación sin red cae al `index.html` cacheado. Solo se guardan respuestas correctas de mismo origen. No es cache-first.

Al desplegar una versión nueva, el SW nuevo queda en espera y la app muestra un aviso con **Recargar**; hasta pulsarlo sigue la versión anterior. Quien modifique cualquier fichero del shell debe subir `CACHE_VERSION` en `sw.js`.

## Qué no hace

- No sincroniza entre dispositivos ni tiene backend.
- No envía notificaciones push. El aviso de fin de descanso es una notificación local que solo se muestra si hay permiso y la app sigue viva en segundo plano.
- Los avisos en segundo plano no son fiables: Android puede congelar la pestaña y los temporizadores, y Wake Lock y vibración dependen del dispositivo. El descanso se recalcula al volver, pero el aviso puede llegar tarde o no llegar.
- No es asesoramiento médico ni de entrenamiento.

## Desarrollo local

Requiere Node 22. No hay dependencias que instalar para `check` y `test`.

```bash
npm run check   # sintaxis, referencias del manifiesto y del shell
npm test        # tests unitarios (node --test)
npm run e2e     # E2E con Playwright en Chromium (necesita Playwright instalado)
python -m http.server 8000   # servir en http://localhost:8000
```

El Service Worker exige HTTPS salvo en `localhost`. El despliegue es GitHub Pages desde `master`. CI (`.github/workflows/ci.yml`) ejecuta `check` y `test`; el E2E no corre en CI.

## Más información

- [SECURITY.md](SECURITY.md): modelo de amenazas, CSP y cómo reportar
- [CHANGELOG.md](CHANGELOG.md): cambios por fase
- [docs/PLAN-AUDITORIA.md](docs/PLAN-AUDITORIA.md): plan de la auditoría

Licencia MIT.
