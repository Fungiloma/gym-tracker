// Renderiza los SVG fuente a PNG cuadrados con Chromium (Playwright).
// Uso: node icons/src/build_icons.js  (desde la raíz del repo)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const src = __dirname, out = path.join(__dirname, '..');
const jobs = [
  ['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-512-maskable.png', 512],
  ['icon.svg', 'apple-touch-icon.png', 180], ['icon.svg', 'favicon-32.png', 32],
  ['icon.svg', 'favicon-48.png', 48],
];
(async () => {
  const b = await chromium.launch();
  for (const [s, o, n] of jobs) {
    const p = await b.newPage({ viewport: { width: n, height: n }, deviceScaleFactor: 1 });
    const svg = fs.readFileSync(path.join(src, s), 'utf8');
    await p.setContent(`<style>html,body{margin:0}svg{display:block;width:${n}px;height:${n}px}</style>${svg}`);
    await p.screenshot({ path: path.join(out, o), omitBackground: false });
    await p.close();
  }
  await b.close();
})();
