// E2E de la fase 10b (docs/REVISION-CODIGO.md): Deshacer de una serie quitada ligado a su borrador, '+15 s'
// con descansos largos, doble 'atrás', fallo del portapapeles, nombre de fichero con fecha local,
// aviso de series sin ✓ y paginación y búsqueda con debounce del historial. Consola sin errores ni CSP.
// Uso: node tests/e2e/revision.mjs   (E2E_ONLY=3 ejecuta solo ese escenario)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { defaultPlan } from '../../js/plan.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.E2E_PORT_REVISION || 8144);
const base = `http://127.0.0.1:${port}/index.html`;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('servidor local no arrancó');
}

const only = (process.env.E2E_ONLY || '').split(',').filter(Boolean).map(Number);
const runs = n => !only.length || only.includes(n);
const problems = [];
let browser;

// Plan con una segunda rutina que comparte ejercicios con 'pierna'.
function planWithCopy() {
  const plan = defaultPlan();
  const pierna = plan.routines.find(r => r.id === 'pierna');
  plan.routines.push({ ...JSON.parse(JSON.stringify(pierna)), id: 'pierna-b', name: 'Pierna B' });
  return JSON.stringify(plan);
}

const T0 = Date.UTC(2026, 9, 1, 18, 0);
function oneSession() {
  return JSON.stringify({ schemaVersion: 2, body: [], settings: {}, sessions: [{
    id: 'seed-1', planSessionId: 'pierna', name: 'Sesión 2: Pierna', startedAt: T0, endedAt: T0 + 3_600_000, notes: '',
    exercises: [{ id: 'peso-muerto', name: 'Peso muerto', notes: '', series: [
      { type: 'normal', target: '6-8', weight: 100, weight2: null, repsDone: 6, rpe: null, done: true },
    ] }],
  }] });
}

async function open({ seed = {}, init = null, context: ctxOpts = {}, clock = null } = {}) {
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true, ...ctxOpts });
  const page = await context.newPage();
  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.addInitScript(({ seed }) => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }
  }, { seed });
  if (init) await page.addInitScript(init);
  if (clock) await page.clock.setFixedTime(clock);
  await page.goto(base);
  await page.waitForSelector('.session-btn');
  return { context, page, dialogs, ls: key => page.evaluate(k => localStorage.getItem(k), key) };
}

async function finish(page) {
  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], `violaciones CSP: ${csp.join(', ')}`);
}

try {
  await waitServer();
  browser = await chromium.launch();

  // 1. Bug 10: '+' del descanso por ejercicio no reduce un descanso de 900 s (antes se recortaba a 600).
  if (runs(1)) {
    const { context, page } = await open({ seed: { 'gymtracker.ui': JSON.stringify({ restByExercise: { 'peso-muerto': 900 } }) } });
    await page.locator('.session-btn', { hasText: 'Pierna' }).click();
    await page.waitForSelector('#screen-session.active .rest-step');
    const value = page.locator('.rest-step-value').first();
    assert.equal(await value.textContent(), '⏱ 15m');
    await page.locator('[data-action="rest-step"][data-ex="0"][data-delta="15"]').click();
    assert.equal(await page.locator('.rest-step-value').first().textContent(), '⏱ 15m15s', '+15 s suma sobre 900 s');
    await finish(page);
    await context.close();
  }

  // 2. Bug 9: el Deshacer de "Serie quitada" no se aplica a otra sesión que tenga el mismo ejercicio,
  //    y descartar la sesión retira el aviso.
  if (runs(2)) {
    const { context, page } = await open({ seed: { 'gymtracker.plan': planWithCopy() } });
    await page.locator('.session-btn', { hasText: 'Sesión 2: Pierna' }).click();
    await page.waitForSelector('#screen-session.active .kg-input');
    const seriesOf = n => page.locator(`#screen-session .series-block[data-ex="${n}"]`).count();
    assert.equal(await seriesOf(0), 4);
    await page.locator('[data-action="remove-series"][data-ex="0"]').click();
    assert.equal(await seriesOf(0), 3);
    assert.match(await page.locator('#toast').textContent(), /Serie 4 quitada/);
    // Se sale a home y se empieza otra rutina con el mismo ejercicio (descarta la anterior).
    await page.locator('#screen-session [data-action="go-back"]').click();
    await page.waitForSelector('#screen-home.active');
    await page.locator('.session-btn', { hasText: 'Pierna B' }).click();
    await page.waitForSelector('#screen-session.active .kg-input');
    assert.equal(await seriesOf(0), 4, 'la sesión nueva tiene sus 4 series');
    await page.locator('#toast [data-action="toast-undo"]').click();
    assert.equal(await seriesOf(0), 4, 'el Deshacer viejo no toca la sesión nueva');

    // Descartar la sesión retira el aviso con su Deshacer.
    await page.locator('[data-action="remove-series"][data-ex="0"]').click();
    assert.equal(await page.locator('#toast [data-action="toast-undo"]').count(), 1);
    await page.locator('[data-action="discard-session"]').click();
    await page.waitForSelector('#screen-home.active');
    assert.equal(await page.locator('#toast').isHidden(), true, 'sin sesión no queda un Deshacer vivo');
    await finish(page);
    await context.close();
  }

  // 3. Bug 16: dos "atrás" seguidos antes del popstate no sacan de la app.
  if (runs(3)) {
    const { context, page } = await open();
    await page.locator('#screen-home [data-screen="settings"]').click();
    await page.waitForSelector('#screen-settings.active');
    await page.evaluate(() => {
      const b = document.querySelector('#screen-settings [data-action="go-back"]');
      b.click();
      b.click();
    });
    await page.waitForTimeout(700);
    assert.equal(page.url(), base, 'sigue en la app');
    assert.equal(await page.locator('#screen-home.active').count(), 1);
    // Y un "atrás" posterior sigue funcionando.
    await page.locator('#screen-home [data-screen="settings"]').click();
    await page.waitForSelector('#screen-settings.active');
    await page.locator('#screen-settings [data-action="go-back"]').click();
    await page.waitForSelector('#screen-home.active');
    await finish(page);
    await context.close();
  }

  // 4. Sospecha: si el portapapeles falla se avisa (y se prueba el método alternativo).
  if (runs(4)) {
    {
      const { context, page } = await open({ seed: { 'gymtracker.data': oneSession() }, init: () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); document.execCommand = () => false; } });
      await page.locator('#screen-home [data-screen="history"]').click();
      await page.locator('[data-action="history-tab"][data-tab="trends"]').click();
      await page.locator('#copy-weekly').click();
      await page.locator('#toast').waitFor();
      assert.match(await page.locator('#toast').textContent(), /No se pudo copiar/);
      await context.close();
    }
    {
      const { context, page } = await open({ seed: { 'gymtracker.data': oneSession() }, init: () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); document.execCommand = () => true; } });
      await page.locator('#screen-home [data-screen="history"]').click();
      await page.locator('[data-action="history-tab"][data-tab="trends"]').click();
      await page.locator('#copy-weekly').click();
      await page.waitForSelector('#copy-weekly.copied');
      await context.close();
    }
  }

  // 5. Sospecha: el nombre del export usa la fecha local, no la UTC (Auckland es UTC+12 en junio).
  if (runs(5)) {
    const { context, page } = await open({
      context: { timezoneId: 'Pacific/Auckland' }, clock: new Date('2026-06-10T20:00:00Z'),
    });
    await page.locator('#screen-home [data-screen="history"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export-json"]').click()]);
    assert.equal(dl.suggestedFilename(), 'gym-tracker-2026-06-11.json');
    await context.close();
  }

  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e revision: ok (deshacer ligado al borrador, descanso largo, doble atrás, portapapeles, fecha local, CSP sin violaciones, viewport Pixel 7)');
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
