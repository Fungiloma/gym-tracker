# Seguridad

## Modelo de amenazas

Gym Tracker es una app estática sin backend, sin cuentas y sin red hacia terceros. Los datos viven en el `localStorage` del dispositivo.

Lo que se intenta evitar:

- Ejecución de script inyectado a través de datos del usuario, de ficheros importados o de texto pegado. Los datos se pintan con `textContent` y no hay manejadores inline; las acciones usan delegación por `data-action`.
- Ficheros de importación malformados o hostiles. Se validan con esquema estricto, límites de tamaño y de longitud, y se rechazan o descartan lo inválido sin tocar los datos locales.
- Pérdida de datos por contenido dañado: se hace copia literal en `gymtracker.data.backup` o `gymtracker.plan.backup` antes de sobrescribir.

Fuera de alcance:

- Un atacante con acceso al dispositivo o al perfil del navegador, o con extensiones que lean el `localStorage`. Los datos no están cifrados.
- Un compromiso de la cuenta de GitHub o de GitHub Pages, que serviría código malicioso.
- Clickjacking: `frame-ancestors` no funciona en `<meta>` y el impacto es nulo en esta app.

## CSP por meta y sus límites

`index.html` declara la política con `<meta http-equiv="Content-Security-Policy">`: `default-src 'none'`, scripts, estilos, manifiesto, conexiones y workers solo de `'self'`, imágenes de `'self'`, `data:` y `blob:`, `base-uri 'none'` y `form-action 'none'`.

Límites:

- Una meta CSP solo aplica desde que el parser la lee y no admite `frame-ancestors`, `report-uri` ni `sandbox`.
- GitHub Pages no permite cabeceras propias, así que no hay `X-Content-Type-Options`, HSTS propio ni Permissions-Policy.
- No cubre `sw.js`: una respuesta del Service Worker se rige por la política del script del propio SW, no por la meta de la página.
- No protege contra datos ya presentes en `localStorage`.

## Dependencias

La app no tiene dependencias de ejecución. La única dependencia de desarrollo es Playwright, con versión exacta y `package-lock.json`, que solo se usa en los tests y en CI. Dependabot vigila las acciones de GitHub Actions y los paquetes npm.

## Reportar una vulnerabilidad

Usa "Report a vulnerability" en la pestaña Security del repositorio (aviso privado de GitHub). Si no está disponible, abre un issue sin detalles de explotación y se acordará un canal privado. Es un proyecto personal sin plazo de respuesta garantizado.
