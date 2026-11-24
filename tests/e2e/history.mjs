// E2E de la fase 4: historial con datos sembrados (búsqueda y filtro, ficha de ejercicio con gráfica SVG,
// gráficas semanales, resumen copiable, calendario y rachas, peso corporal, récords al guardar) con CSP estricta.
// Uso: npm run e2e   (levanta python3 -m http.server en un puerto libre)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.E2E_PORT_HISTORY || 8141);
const base = `http://127.0.0.1:${port}/index.html`;

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('servidor local no arrancó');
}

// Se ejecuta en el navegador: sesiones de pierna hoy y hace 1, 2 y 3 semanas (4 semanas seguidas, 4 días distintos).
function seed() {
  const now = new Date();
  const at = back => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, back === 0 ? 0 : 18, 30).getTime();
  const plan = [[21, 100, 6, 6], [14, 102.5, 6, 6], [7, 105, 6, 6], [0, 105, 7, 6]];
  const sessions = plan.map(([back, w, r1, r2], i) => ({
    id: `seed-${i}`, planSessionId: 'pierna', name: 'Sesión 2: Pierna', startedAt: at(back), endedAt: at(back) + 3_600_000, notes: i === 3 ? 'buena sesión' : '',
    exercises: [
      { id: 'peso-muerto', name: 'Peso muerto', notes: '', series: [
        { type: 'warmup', target: '', weight: 60, weight2: null, repsDone: 10, rpe: null, done: true },
        { type: 'normal', target: '6-8', weight: w, weight2: null, repsDone: r1, rpe: null, done: true },
        { type: 'normal', target: '6-8', weight: w, weight2: null, repsDone: r2, rpe: null, done: true },
      ] },
      { id: 'ss-extension-curl-femoral', name: 'Superserie: Extensión cuádriceps + Curl femoral', notes: '', series: [
        { type: 'normal', target: '', weight: 40, weight2: 30, repsDone: null, rpe: null, done: true },
      ] },
    ],
  }));
  localStorage.setItem('gymtracker.data', JSON.stringify({ schemaVersion: 2, sessions, body: [], settings: {} }));
  return { days: [21, 14, 7, 0].map(b => new Date(at(b)).getDate()) };
}

const problems = [];
let browser;
try {
  await waitServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true, timezoneId: 'Europe/Madrid' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${port}` });
  const page = await context.newPage();
  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });

  const ls = key => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
  const tab = name => page.locator(`#history-tabs [data-tab="${name}"]`);
  const view = page.locator('#history-container');

  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  const { days } = await page.evaluate(seed);
  await page.reload();
  await page.waitForSelector('.session-btn');
  await page.locator('#screen-home [data-screen="history"]').click();
  await page.waitForSelector('#screen-history.active');

  // 1. Pestañas y lista de sesiones con volumen; búsqueda y filtro.
  assert.deepEqual(await page.locator('#history-tabs .tab-btn').allTextContents(), ['Sesiones', 'Ejercicios', 'Gráficas', 'Músculos', 'Calendario', 'Cuerpo']);
  assert.equal(await tab('sessions').getAttribute('aria-selected'), 'true');
  assert.equal(await view.locator('.session-card').count(), 4);
  assert.match(await view.locator('.session-card').first().textContent(), /1365 kg de volumen/, 'el calentamiento no suma');
  await page.locator('#history-search').fill('PESO muerto');
  assert.equal(await view.locator('.session-card').count(), 4, 'búsqueda sin tildes ni mayúsculas');
  await page.locator('#history-search').fill('buena');
  assert.equal(await view.locator('.session-card').count(), 1, 'busca también en notas');
  await page.locator('#history-search').fill('zzz');
  assert.match(await view.textContent(), /Sin resultados/);
  await page.locator('#history-search').fill('');
  await page.locator('#history-plan').selectOption('pecho-hombro');
  assert.match(await view.textContent(), /Sin resultados/);
  await page.locator('#history-plan').selectOption('pierna');
  assert.equal(await view.locator('.session-card').count(), 4);
  await page.locator('#history-plan').selectOption('');

  // 2. Ejercicios: lista, ficha con marcas y gráfica; superserie sin 1RM.
  await tab('exercises').click();
  assert.equal(await view.locator('.list-row').count(), 2);
  await page.locator('#history-search').fill('muerto');
  assert.equal(await view.locator('.list-row').count(), 1);
  await page.locator('#history-search').fill('');
  await view.locator('.list-row', { hasText: 'Peso muerto' }).click();
  const bests = await view.locator('.best-cell').allTextContents();
  assert.match(bests.join('|'), /105 kg/);
  assert.match(bests.join('|'), /129.5 kg/, '1RM Epley de 105×7 = 129,5');
  assert.match(bests.join('|'), /7Reps máx\./);
  assert.equal(await view.locator('svg.chart').count(), 1);
  assert.equal(await view.locator('svg.chart polyline').count(), 2, 'dos líneas: 1RM y peso máximo');
  assert.equal(await view.locator('svg.chart circle').count(), 8, '4 sesiones × 2 líneas');
  assert.equal(await view.locator('svg.chart').getAttribute('role'), 'img');
  await page.locator('[data-action="clear-exercise"]').click();
  await view.locator('.list-row', { hasText: 'Superserie' }).click();
  assert.equal(await view.locator('svg.chart').count(), 0);
  assert.match(await view.textContent(), /no se calcula 1RM ni volumen/);
  await page.locator('[data-action="clear-exercise"]').click();

  // 3. Gráficas: volumen y frecuencia semanal, resumen copiable.
  await tab('trends').click();
  assert.equal(await view.locator('svg.chart').count(), 2);
  assert.equal(await view.locator('svg.chart').first().locator('rect.chart-bar').count(), 4, '4 de 8 semanas con volumen');
  assert.equal(await view.locator('svg.chart').nth(1).locator('rect.chart-bar').count(), 4);
  const weekly = await page.locator('#weekly-text').textContent();
  assert.match(weekly, /^\[RESUMEN SEMANAL\]/);
  assert.match(weekly, /Sesiones: 1/);
  assert.match(weekly, /Volumen: 1365 kg \(\+8% vs semana anterior\)/);
  assert.match(weekly, /Racha semanal: 4/);
  await page.locator('#copy-weekly').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), weekly);
  await page.locator('[data-action="summary-week"][data-delta="1"]').click();
  assert.match(await page.locator('#week-label').textContent(), /Hace 1 semana/);
  assert.match(await page.locator('#weekly-text').textContent(), /Volumen: 1260 kg/);
  assert.equal(await page.locator('[data-action="summary-week"][data-delta="-1"]').isDisabled(), false);
  assert.match(await view.textContent(), /Racha: 4 semanas seguidas/);

  // 4. Calendario: días con entreno y racha; cambio de mes.
  await tab('calendar').click();
  const marked = await view.locator('.cal-day.has').evaluateAll(els => els.map(e => Number(e.textContent)));
  const sameMonth = await page.evaluate(() => {
    const m = document.querySelector('#cal-title').textContent;
    return m;
  });
  assert.ok(marked.length >= 1 && marked.every(d => days.includes(d)), `días marcados ${marked} dentro de ${days}`);
  assert.match(await page.locator('#cal-streak').textContent(), /Racha 4 semanas \(mejor 4\)/);
  assert.ok(await view.locator('.cal-day.today').count() === 1);
  await page.locator('[data-action="cal-month"][data-delta="1"]').click();
  assert.notEqual(await page.locator('#cal-title').textContent(), sameMonth);
  assert.equal(await view.locator('.cal-day.has').count(), 0);
  await page.locator('[data-action="cal-month"][data-delta="-1"]').click();
  assert.equal(await page.locator('#cal-title').textContent(), sameMonth);

  // 5. Cuerpo: validación, guardado con coma, una entrada por fecha, borrar y deshacer, persistencia.
  await tab('body').click();
  assert.match(await view.textContent(), /Sin medidas todavía/);
  assert.equal(await page.locator('#body-form').isVisible(), true);
  await page.locator('#body-date').fill('2026-11-20');
  await page.locator('#body-weight').fill('abc');
  await page.locator('[data-action="save-body"]').click();
  assert.match(await page.locator('#body-error').textContent(), /Peso: valor no válido/);
  assert.equal((await ls('gymtracker.data')).body.length, 0);
  await page.locator('#body-weight').fill('78,4');
  await page.locator('[data-key="waist"]').fill('82');
  await page.locator('[data-action="save-body"]').click();
  await page.locator('#body-date').fill('2026-11-24');
  await page.locator('#body-weight').fill('77,9');
  await page.locator('[data-action="save-body"]').click();
  await page.locator('#body-date').fill('2026-11-24');
  await page.locator('#body-weight').fill('77,5');
  await page.locator('[data-action="save-body"]').click();
  let stored = await ls('gymtracker.data');
  assert.deepEqual(stored.body.map(b => [b.date, b.weight]), [['2026-11-20', 78.4], ['2026-11-24', 77.5]], 'misma fecha: sustituye');
  assert.equal(stored.body[0].waist, 82);
  assert.equal(await view.locator('svg.chart').count(), 1, 'solo el peso tiene gráfica (cintura tiene 1 punto)');
  assert.equal(await view.locator('.body-row').count(), 2);
  await view.locator('.body-row').first().locator('[data-action="delete-body"]').click();
  assert.equal((await ls('gymtracker.data')).body.length, 1);
  await page.locator('[data-action="toast-undo"]').click();
  assert.equal((await ls('gymtracker.data')).body.length, 2);
  await page.reload();
  await page.waitForSelector('.session-btn');
  assert.equal((await ls('gymtracker.data')).body.length, 2, 'sobrevive a la recarga');

  // 6. Export incluye el peso corporal.
  await page.locator('#screen-home [data-screen="history"]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export-json"]').click()]);
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.body.length, 2);

  // 7. Récord al guardar: 110 kg supera los 105 kg previos; aviso en el resumen y en el toast.
  await page.locator('#screen-history [data-action="go-back"]').click();
  await page.locator('.session-btn', { hasText: 'Pierna' }).click();
  await page.waitForSelector('#screen-session.active');
  const kg = page.locator('#screen-session .kg-input[data-field="weight"]').first();
  const reps = page.locator('#screen-session .kg-input[data-field="repsDone"]').first();
  await kg.fill('110');
  await kg.dispatchEvent('change');
  await reps.fill('6');
  await reps.dispatchEvent('change');
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  const records = page.locator('#summary-records');
  assert.equal(await records.isVisible(), true);
  const recText = await records.textContent();
  assert.match(recText, /Peso muerto: peso 110 kg \(antes 105\)/);
  assert.match(recText, /1RM estimado/);
  assert.match(await page.locator('#toast').textContent(), /récords? nuevos?/);

  // 8. Sin desbordes horizontales en ninguna pestaña.
  await page.locator('#screen-summary [data-screen="history"]').click();
  for (const t of ['sessions', 'exercises', 'trends', 'calendar', 'body']) {
    await tab(t).click();
    const overflow = await page.evaluate(() => document.getElementById('screen-history').scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `desborde horizontal en ${t}: ${overflow}px`);
  }

  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], `violaciones CSP: ${csp.join(', ')}`);
  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e history: ok (búsqueda y filtro, ficha de ejercicio con SVG, gráficas semanales, resumen copiado, calendario y racha, peso corporal con deshacer, récords al guardar, CSP sin violaciones, viewport Pixel 7)');
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
