// E2E de recuperación de datos, en Pixel 7 emulado:
//  1. Datos dañados sin espacio para la copia: el historial no se sobrescribe, se puede descargar tal cual
//     y solo se vuelve a guardar cuando el usuario lo decide.
//  2. Datos de una versión más nueva: se copian y no se sobrescriben.
//  3. Doble toque en 🗑 (sesiones y medidas): un solo Deshacer recupera todo lo borrado.
//  4. Plan dañado con una sesión en curso de una rutina propia: el borrador se conserva y se puede terminar.
// Uso: npm run e2e   (levanta python3 -m http.server en un puerto libre)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.E2E_PORT_RECOVERY || 8143);
const base = `http://127.0.0.1:${port}/index.html`;

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: root, stdio: 'ignore',
});

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('servidor local no arrancó');
}

const T0 = Date.UTC(2026, 9, 5, 18);
const sessionDoc = (i, ts) => ({
  id: `s${i}`, planSessionId: 'pierna', name: `Sesión ${i}`, startedAt: ts, endedAt: ts + 3_600_000, notes: '',
  exercises: [{ id: 'peso-muerto', name: 'Peso muerto', notes: '', series: [{ type: 'normal', target: '8-10', weight: 100 + i, weight2: null, repsDone: 8, rpe: null, done: true }] }],
});
const dataDoc = extra => JSON.stringify({ schemaVersion: 2, sessions: [], body: [], settings: {}, ...extra });

const problems = [];
const dialogs = [];
let browser;

async function newPage({ failBackup = false } = {}) {
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', m => {
    // Los avisos de setItem fallido son esperados en el escenario sin espacio.
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', d => {
    if (d.type() !== 'confirm') problems.push(`dialog inesperado: ${d.type()} ${d.message()}`);
    dialogs.push(d.message());
    d.accept();
  });
  if (failBackup) {
    // Simula almacenamiento lleno solo para la copia de seguridad del historial.
    await page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'gymtracker.data.backup') throw new DOMException('full', 'QuotaExceededError');
        return real.call(this, k, v);
      };
    });
  }
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.session-btn');
  return { context, page };
}

const ls = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const toastText = page => page.locator('#toast .toast-text').textContent();

async function fillFirstSeries(page, kg, reps) {
  const row = page.locator('#screen-session .series-block').first();
  for (const [field, value] of [['weight', kg], ['repsDone', reps]]) {
    const input = row.locator(`.kg-input[data-field="${field}"]`);
    await input.fill(String(value));
    await input.dispatchEvent('change');
  }
}

async function doubleTap(page, locator) {
  // Botón en mitad de la pantalla (el toast aparece abajo y recibiría el segundo toque) y pantalla ya
  // asentada: el centro del botón tiene que ser el propio botón.
  await locator.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await locator.evaluate(el => new Promise(resolve => {
    const check = () => {
      const r = el.getBoundingClientRect();
      if (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el) resolve();
      else requestAnimationFrame(check);
    };
    check();
  }));
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
}

async function corruptWithoutRoomForBackup() {
  const { context, page } = await newPage({ failBackup: true });
  // Sesión en curso con una serie apuntada; después los datos guardados se dañan.
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active .kg-input');
  await fillFirstSeries(page, 60, 10);
  await page.evaluate(() => localStorage.setItem('gymtracker.data', '{roto'));
  await page.reload();
  await page.waitForSelector('#screen-session.active');
  assert.match(await toastText(page), /no se pudo hacer una copia/);
  assert.equal(await ls(page, 'gymtracker.data.backup'), null, 'la copia no cabe');

  // Terminar la sesión no sobrescribe los datos dañados y el borrador sigue.
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForFunction(() => /no se guarda mientras/.test(document.querySelector('#toast .toast-text').textContent));
  assert.equal(await ls(page, 'gymtracker.data'), '{roto');
  assert.ok(await page.locator('#screen-session.active').count(), 'sigue en la sesión');
  assert.equal(JSON.parse(await ls(page, 'gymtracker.draft')).exercises[0].series[0].weight, 60);

  // Aviso en Inicio: descargar el texto guardado tal cual.
  await page.locator('#screen-session [data-action="go-back"]').first().click();
  await page.waitForSelector('#screen-home.active #data-lock-notice');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="data-lock-download"]').click()]);
  assert.match(download.suggestedFilename(), /^gym-tracker-recuperacion-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal(readFileSync(await download.path(), 'utf8'), '{roto');

  // Empezar de cero (con confirmación) y la sesión ya se guarda.
  await page.locator('[data-action="data-lock-release"]').click();
  assert.match(dialogs.at(-1), /Empezar de cero/);
  assert.equal(await page.locator('#data-lock-notice').count(), 0);
  await page.locator('.resume-card').click();
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  const saved = JSON.parse(await ls(page, 'gymtracker.data'));
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].exercises[0].series[0].weight, 60);
  await context.close();
}

async function newerVersion() {
  const { context, page } = await newPage();
  const raw = '{"schemaVersion":3,"sessions":[{"id":"futuro"}]}';
  await page.evaluate(r => localStorage.setItem('gymtracker.data', r), raw);
  await page.reload();
  await page.waitForSelector('#screen-home.active #data-lock-notice');
  assert.match(await page.locator('#data-lock-notice').textContent(), /versión más nueva/);
  assert.equal(await ls(page, 'gymtracker.data.backup'), raw);
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active .kg-input');
  await fillFirstSeries(page, 40, 12);
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForFunction(() => /no se guarda mientras/.test(document.querySelector('#toast .toast-text').textContent));
  assert.equal(await ls(page, 'gymtracker.data'), raw, 'los datos de la versión nueva quedan intactos');
  await context.close();
}

async function doubleTapDelete() {
  const { context, page } = await newPage();
  const sessions = [0, 1, 2].map(i => sessionDoc(i, T0 + i * 86_400_000));
  const body = ['2026-10-01', '2026-10-02', '2026-10-03'].map((date, i) => ({ date, weight: 80 + i, waist: null, chest: null, arm: null, thigh: null }));
  await page.evaluate(d => localStorage.setItem('gymtracker.data', d), dataDoc({ sessions, body }));
  await page.reload();
  await page.waitForSelector('.session-btn');
  await page.locator('[data-action="go-screen"][data-screen="history"]').first().click();
  await page.waitForSelector('#screen-history.active .session-card');

  // El segundo toque cae en el 🗑 de la tarjeta siguiente, que sube a su sitio.
  await doubleTap(page, page.locator('.session-card [data-action="delete-session"]').first());
  assert.equal(JSON.parse(await ls(page, 'gymtracker.data')).sessions.length, 1);
  assert.equal(await toastText(page), '2 sesiones borradas');
  await page.locator('#toast [data-action="toast-undo"]').click();
  const restored = JSON.parse(await ls(page, 'gymtracker.data')).sessions.map(s => s.id).sort();
  assert.deepEqual(restored, ['s0', 's1', 's2'], 'un Deshacer recupera las dos');
  assert.equal(await toastText(page), '2 sesiones recuperadas');
  assert.equal(await page.locator('.session-card').count(), 3);

  // Medidas corporales: dos borrados seguidos comparten un Deshacer (aquí la gráfica de arriba cambia de
  // alto al borrar, así que el segundo toque no cae siempre en la fila siguiente: se borran con dos toques).
  await page.locator('[data-action="history-tab"][data-tab="body"]').click();
  await page.waitForSelector('.body-row');
  await page.locator('.body-row [data-action="delete-body"]').first().click();
  await page.locator('.body-row [data-action="delete-body"]').first().click();
  assert.equal(JSON.parse(await ls(page, 'gymtracker.data')).body.length, 1);
  assert.equal(await toastText(page), '2 medidas borradas');
  await page.locator('#toast [data-action="toast-undo"]').click();
  assert.deepEqual(JSON.parse(await ls(page, 'gymtracker.data')).body.map(b => b.date), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(await toastText(page), '2 medidas recuperadas');
  await context.close();
}

async function orphanDraft() {
  const { context, page } = await newPage();
  // Rutina propia creada con el editor (mismas funciones que usa la app).
  const id = await page.evaluate(async () => {
    const r = await import('./js/routines.js');
    const p = await import('./js/plan.js');
    const c = r.createRoutine(p.defaultPlan(), 'Mi rutina E2E');
    const withEx = r.addRoutineExercise(c.plan, c.id, 'peso-muerto');
    localStorage.setItem('gymtracker.plan', JSON.stringify(withEx.plan));
    return c.id;
  });
  await page.reload();
  await page.locator(`.session-btn[data-plan-id="${id}"]`).click();
  await page.waitForSelector('#screen-session.active .kg-input');
  await fillFirstSeries(page, 70, 8);

  // El plan guardado se daña: antes la sesión en curso desaparecía sin aviso.
  await page.evaluate(() => localStorage.setItem('gymtracker.plan', '{"planVersion":1,'));
  await page.reload();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.equal(await page.locator('#session-header-title').textContent(), 'Mi rutina E2E');
  const msg = await toastText(page);
  assert.match(msg, /plan guardado estaba dañado/);
  assert.match(msg, /ya no está en el plan/);
  assert.equal(await page.locator('#screen-session .kg-input[data-field="weight"]').first().inputValue(), '70');

  await page.locator('#screen-session [data-action="go-back"]').first().click();
  await page.waitForSelector('#screen-home.active .resume-card');
  assert.match(await page.locator('.resume-card-title').textContent(), /Mi rutina E2E/);
  await page.locator('.resume-card').click();
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  const saved = JSON.parse(await ls(page, 'gymtracker.data')).sessions;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Mi rutina E2E');
  assert.equal(saved[0].planSessionId, id);
  assert.equal(saved[0].exercises[0].series[0].weight, 70);
  assert.equal(await ls(page, 'gymtracker.draft'), null);
  await context.close();
}

try {
  await waitServer();
  browser = await chromium.launch();
  await corruptWithoutRoomForBackup();
  await newerVersion();
  await doubleTapDelete();
  await orphanDraft();
  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e recovery: ok (datos dañados sin copia bloqueados y descargables, versión nueva intacta, doble toque en 🗑 con un Deshacer, borrador de rutina perdida terminado, viewport Pixel 7)');
} finally {
  if (browser) await browser.close();
  server.kill();
}
