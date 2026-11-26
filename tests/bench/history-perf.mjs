// Medida de rendimiento del historial con muchas sesiones (no forma parte de npm test ni de npm run e2e).
// Siembra N sesiones en localStorage, emula un móvil lento (CPU ×4, Pixel 7) y mide: abrir el historial,
// cada tecla de búsqueda, el tiempo hasta ver el resultado filtrado, expandir una tarjeta y los nodos DOM.
// Uso: node tests/bench/history-perf.mjs [sesiones=2000] [repeticiones=3] [cpu=4]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const N = Number(process.argv[2] || 2000);
const RUNS = Number(process.argv[3] || 3);
const CPU = Number(process.argv[4] || 4);
const port = Number(process.env.BENCH_PORT || 8150);
const base = `http://127.0.0.1:${port}/index.html`;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('servidor local no arrancó');
}

// Se ejecuta en el navegador: N sesiones repartidas en ~4 años, 4 ejercicios de 3 series cada una (≈ 75.000 nodos con 2.000 sesiones).
function seed(n) {
  const ids = ['press-banca-mancuernas', 'press-inclinado-mancuernas', 'peso-muerto', 'prensa', 'remo-barra', 'remo-maquina'];
  const names = ['Press banca mancuernas', 'Press inclinado mancuernas', 'Peso muerto', 'Prensa', 'Remo barra', 'Remo máquina'];
  const routines = [['pecho-hombro', 'Sesión 1: Pecho + Hombro'], ['pierna', 'Sesión 2: Pierna'], ['espalda-biceps', 'Sesión 3: Espalda + Bíceps'], ['pecho-triceps-core', 'Sesión 4: Pecho Extra + Tríceps + Core ⭐']];
  const end = Date.UTC(2026, 9, 1, 18, 0);
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const ts = end - i * 66 * 3_600_000;
    const [planSessionId, name] = routines[i % 4];
    sessions.push({
      id: `bench-${i}`, planSessionId, name, startedAt: ts, endedAt: ts + 3_600_000, notes: i % 7 === 0 ? 'buena sesión' : '',
      exercises: ids.slice(0, 4).map((id, e) => ({
        id, name: names[e], notes: '',
        series: [0, 1, 2].map(k => ({ type: k === 2 ? 'drop' : 'normal', target: '8-10', weight: 40 + e * 5 + (i % 20), weight2: null, repsDone: 8 + (k % 3), rpe: null, done: true })),
      })),
    });
  }
  localStorage.clear();
  localStorage.setItem('gymtracker.data', JSON.stringify({ schemaVersion: 2, sessions, body: [], settings: {} }));
}


async function once(browser) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('pageerror', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.addInitScript(`(${seed.toString()})(${N})`);
  await page.goto(base);
  await page.waitForSelector('.session-btn');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

  const open = await page.evaluate(async () => {
    const t0 = performance.now();
    document.querySelector('#screen-home [data-screen="history"]').click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
    return performance.now() - t0;
  });
  const cards = await page.locator('.session-card').count();
  const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);

  // Teclas: se escribe "sesion 2" letra a letra a ritmo de dedo (80 ms). Solo la última tecla cambia el
  // resultado (de todas las sesiones a las de la rutina 2), así que se mide lo que cuesta cada tecla en el
  // hilo principal y cuánto tarda en verse el resultado desde que se pulsa la última.
  const typing = await page.evaluate(async () => {
    const input = document.getElementById('history-search');
    const costs = [];
    let lastKeyAt = 0;
    for (const ch of 'sesion 2') {
      input.value += ch;
      lastKeyAt = performance.now();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      costs.push(performance.now() - lastKeyAt);
      await new Promise(r => setTimeout(r, 80));
    }
    const title = () => { const el = document.querySelector('.session-card .session-title'); return el ? el.textContent : ''; };
    while (title() !== 'Sesión 2: Pierna') await new Promise(r => setTimeout(r, 10));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
    return { costs, settle: performance.now() - lastKeyAt - 80, results: document.querySelectorAll('.session-card').length };
  });
  const perKey = typing.costs.reduce((a, b) => a + b, 0) / typing.costs.length;

  // Expandir la primera tarjeta.
  await page.evaluate(() => { document.getElementById('history-search').value = ''; document.getElementById('history-search').dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForSelector('.session-card .session-header', { timeout: 120000 });
  await page.waitForTimeout(500);
  const expand = await page.evaluate(async () => {
    const header = document.querySelector('.session-card .session-header');
    const t0 = performance.now();
    header.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
    return performance.now() - t0;
  });
  await context.close();
  return { open, cards, nodes, perKey, settle: typing.settle, results: typing.results, expand };
}

const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
try {
  await waitServer();
  const browser = await chromium.launch();
  const rows = [];
  for (let i = 0; i < RUNS; i++) rows.push(await once(browser));
  await browser.close();
  const f = k => med(rows.map(r => r[k]));
  console.log(`historial con ${N} sesiones, CPU x${CPU}, mediana de ${RUNS} ejecuciones (Pixel 7):`);
  console.log(`  abrir historial        ${Math.round(f('open'))} ms (${rows[0].cards} tarjetas pintadas)`);
  console.log(`  nodos DOM              ${f('nodes')}`);
  console.log(`  coste de cada tecla    ${Math.round(f('perKey'))} ms de media en el hilo principal`);
  console.log(`  ver resultado filtrado ${Math.round(f('settle'))} ms desde la última tecla (${rows[0].results} tarjetas)`);
  console.log(`  expandir una tarjeta   ${Math.round(f('expand'))} ms`);
} finally {
  server.kill();
}
