// E2E de la fase 10a (integridad de datos): datos dañados o de versión más nueva sin copia posible no se
// sobrescriben; doble toque en el 🗑 y deshacer agrupado; valor tecleado que se vuelca al pasar a segundo
// plano; borrador de una rutina perdida que sigue recuperable. Consola sin errores ni violaciones CSP.
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
const port = Number(process.env.E2E_PORT_INTEGRITY || 8143);
const base = `http://127.0.0.1:${port}/index.html`;

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('servidor local no arrancó');
}

const T0 = Date.UTC(2026, 9, 1, 18, 0);
function session(id, back) {
  return {
    id, planSessionId: 'pierna', name: 'Sesión 2: Pierna', startedAt: T0 - back * 86_400_000, endedAt: T0 - back * 86_400_000 + 3_600_000, notes: '',
    exercises: [{ id: 'peso-muerto', name: 'Peso muerto', notes: '', series: [
      { type: 'normal', target: '6-8', weight: 100 + back, weight2: null, repsDone: 6, rpe: null, done: true },
    ] }],
  };
}

const problems = [];
let browser;
// E2E_ONLY=3 (o 1,4) ejecuta solo esos escenarios: sirve para comprobar uno contra otra versión.
const only = (process.env.E2E_ONLY || '').split(',').filter(Boolean).map(Number);
const runs = n => !only.length || only.includes(n);

// Contexto Pixel 7 con consola y CSP vigiladas. failKeys: claves cuyo setItem da QuotaExceededError.
async function open({ seed = {}, failKeys = [] } = {}) {
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  const dialogs = [];
  page.on('dialog', d => {
    dialogs.push(d.message());
    if (page.__answer === 'dismiss') d.dismiss(); else d.accept();
  });
  await page.addInitScript(({ seed, failKeys }) => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (this === localStorage && failKeys.includes(k)) throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  }, { seed, failKeys });
  await page.goto(base);
  const ls = key => page.evaluate(k => localStorage.getItem(k), key);
  return { context, page, dialogs, ls };
}

async function finish(page) {
  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], `violaciones CSP: ${csp.join(', ')}`);
}

async function downloadText(page, locator) {
  const [dl] = await Promise.all([page.waitForEvent('download'), locator.click()]);
  return readFileSync(await dl.path(), 'utf8');
}

try {
  await waitServer();
  browser = await chromium.launch();

  // 1. Datos dañados que ocupan demasiado para copiarlos: el aviso no promete copia, no se escribe nada
  //    en gymtracker.data hasta descargar el original y confirmar.
  if (runs(1)) {
    const raw = '{"schemaVersion":2,"sessions":[' + 'x'.repeat(2000);
    const { context, page, dialogs, ls } = await open({ seed: { 'gymtracker.data': raw }, failKeys: ['gymtracker.data.backup'] });
    await page.waitForSelector('.session-btn');
    const toast = page.locator('#toast');
    await toast.waitFor();
    assert.match(await toast.textContent(), /dañados/);
    assert.doesNotMatch(await toast.textContent(), /Se ha guardado una copia/, 'no promete una copia que no existe');
    assert.match(await toast.textContent(), /No se pudo guardar una copia/);
    const banner = page.locator('#recovery-banner');
    assert.equal(await banner.isVisible(), true, 'aviso fijo visible');
    assert.equal(await ls('gymtracker.data.backup'), null);

    // Completar una sesión: no se guarda y el original sigue intacto; el borrador se conserva.
    await page.locator('.session-btn').nth(1).click();
    await page.waitForSelector('#screen-session.active .kg-input');
    const kg = page.locator('#screen-session .kg-input[data-field="weight"]').first();
    await kg.fill('80');
    await kg.dispatchEvent('change');
    await page.locator('[data-action="complete-session"]').click();
    await page.waitForFunction(() => /primero descarga/.test(document.getElementById('toast').textContent));
    assert.equal(await ls('gymtracker.data'), raw, 'gymtracker.data no se sobrescribe');
    assert.equal(await page.locator('#screen-session.active').count(), 1, 'sigue en la sesión');
    // Cambiar un ajuste tampoco escribe.
    assert.equal(await banner.isVisible(), true, 'el aviso sigue en la sesión');

    // "Ya la tengo" solo aparece tras descargar; la descarga es el texto literal.
    assert.equal(await banner.locator('[data-action="recovery-done"]').count(), 0);
    assert.equal(await downloadText(page, banner.locator('[data-action="recovery-download"]')), raw);
    await banner.locator('[data-action="recovery-done"]').click();
    assert.match(dialogs.at(-1), /sobrescribir los datos originales/);
    assert.equal(await banner.isVisible(), false);
    await page.locator('[data-action="complete-session"]').click();
    await page.waitForSelector('#screen-summary.active');
    assert.equal(JSON.parse(await ls('gymtracker.data')).sessions.length, 1, 'tras confirmar ya se guarda');
    await finish(page);
    await context.close();
  }

  // 2. schemaVersion mayor: aviso de versión más nueva (no de daño), copia hecha y escritura bloqueada.
  if (runs(2)) {
    const raw = JSON.stringify({ schemaVersion: 3, sessions: [{ id: 'futuro' }] });
    const { context, page, ls } = await open({ seed: { 'gymtracker.data': raw } });
    await page.waitForSelector('.session-btn');
    await page.locator('#toast').waitFor();
    const text = await page.locator('#toast').textContent();
    assert.match(text, /versión más nueva/);
    assert.doesNotMatch(text, /null/, 'un toast sin Deshacer no muestra "null"');
    assert.doesNotMatch(text, /dañados/);
    assert.match(text, /Se ha guardado una copia en gymtracker\.data\.backup/);
    assert.equal(await ls('gymtracker.data.backup'), raw);
    assert.match(await page.locator('#recovery-banner').textContent(), /versión más nueva/);
    await page.locator('#screen-home [data-action="go-screen"][data-screen="settings"]').click();
    await page.waitForSelector('#screen-settings.active [data-action]');
    const toggle = page.locator('#settings-container [data-action="toggle-setting"]').first();
    await toggle.click();
    assert.equal(await ls('gymtracker.data'), raw, 'un ajuste no sobrescribe datos de una versión más nueva');
    await finish(page);
    await context.close();
  }

  // 3. Doble toque en el 🗑 (Pixel 7, touchscreen): solo borra una; los borrados seguidos se agrupan y
  //    un único Deshacer recupera las 3 sesiones.
  if (runs(3)) {
    const sessions = [session('s-a', 1), session('s-b', 2), session('s-c', 3)];
    const { context, page, ls } = await open({ seed: { 'gymtracker.data': JSON.stringify({ schemaVersion: 2, sessions, body: [], settings: {} }) } });
    await page.locator('#screen-home [data-action="go-screen"][data-screen="history"]').click();
    await page.waitForSelector('#screen-history.active .session-card');
    const cards = page.locator('.session-card');
    assert.equal(await cards.count(), 3);
    const box = await cards.first().locator('[data-action="delete-session"]').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    assert.equal(await cards.count(), 2, 'el segundo toque del doble toque se ignora');
    for (const n of [2, 3]) {
      await page.waitForTimeout(450);
      await page.touchscreen.tap(x, y);
      await page.waitForFunction(k => document.querySelectorAll('.session-card').length === 3 - k, n);
      assert.match(await page.locator('#toast').textContent(), new RegExp(`${n} sesiones borradas`));
    }
    assert.equal(JSON.parse(await ls('gymtracker.data')).sessions.length, 0);
    await page.waitForTimeout(450); // Deshacer también se ignora justo después de borrar
    await page.locator('#toast [data-action="toast-undo"]').click();
    assert.equal(await cards.count(), 3);
    assert.match(await page.locator('#toast').textContent(), /3 sesiones recuperadas/);
    assert.deepEqual(JSON.parse(await ls('gymtracker.data')).sessions.map(s => s.id), ['s-a', 's-b', 's-c'], 'mismo orden que antes');

    // Medidas corporales: igual.
    await page.locator('[data-action="history-tab"][data-tab="body"]').click();
    const body = [{ date: '2026-09-01', weight: 80 }, { date: '2026-09-02', weight: 81 }];
    await page.evaluate(b => {
      const d = JSON.parse(localStorage.getItem('gymtracker.data'));
      d.body = b;
      localStorage.setItem('gymtracker.data', JSON.stringify(d));
    }, body);
    await page.reload();
    await page.waitForSelector('.session-btn');
    await page.locator('#screen-home [data-action="go-screen"][data-screen="history"]').click();
    await page.locator('[data-action="history-tab"][data-tab="body"]').click();
    const del = page.locator('[data-action="delete-body"]');
    await del.first().waitFor();
    assert.equal(await del.count(), 2);
    await del.first().scrollIntoViewIfNeeded();
    const bb = await del.first().boundingBox();
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    assert.equal(await del.count(), 1, 'doble toque en medida: solo una');
    // El 🗑 estaba al final de la pantalla: el segundo toque cae en el Deshacer del toast y no debe deshacer.
    assert.match(await page.locator('#toast').textContent(), /Medida borrada/);
    assert.equal(JSON.parse(await ls('gymtracker.data')).body.length, 1);
    await page.waitForTimeout(450);
    // La medida que queda está bajo el toast: clic directo sobre el botón.
    await del.first().dispatchEvent('click');
    assert.match(await page.locator('#toast').textContent(), /2 medidas borradas/);
    await page.waitForTimeout(450); // Deshacer también se ignora justo después de borrar
    await page.locator('#toast [data-action="toast-undo"]').click();
    assert.equal(await del.count(), 2);
    assert.equal(JSON.parse(await ls('gymtracker.data')).body.length, 2);
    await finish(page);
    await context.close();
  }

  // 4. Valor tecleado sin perder el foco: se vuelca al borrador al pasar a segundo plano y en pagehide.
  if (runs(4)) {
    const { context, page, ls } = await open();
    await page.locator('.session-btn').first().click();
    await page.waitForSelector('#screen-session.active .kg-input');
    const kg = page.locator('#screen-session .kg-input[data-field="weight"]');
    await kg.first().fill('62,5');
    assert.equal(await kg.first().evaluate(el => el === document.activeElement), true, 'el input sigue con el foco');
    assert.equal(JSON.parse(await ls('gymtracker.draft')).exercises[0].series[0].weight, null, 'sin change aún no está guardado');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.visibilityState;
    });
    assert.equal(JSON.parse(await ls('gymtracker.draft')).exercises[0].series[0].weight, 62.5, 'visibilitychange hidden vuelca el valor');

    const reps = page.locator('#screen-session .kg-input[data-field="repsDone"]').first();
    await reps.fill('9');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(JSON.parse(await ls('gymtracker.draft')).exercises[0].series[0].repsDone, 9, 'pagehide vuelca el valor');
    await finish(page);
    await context.close();
  }

  // 5. Plan dañado con borrador de una rutina propia: el borrador se copia, hay aviso con descarga y
  //    empezar otra rutina no lo pierde. Sin sitio para la copia, se pregunta antes de sobrescribirlo.
  if (runs(5)) {
    const raw = JSON.stringify({
      schemaVersion: 2, id: 'draft-propio', planSessionId: 'mi-rutina', startedAt: T0, notes: 'mi sesión',
      exercises: [{ id: 'mi-ejercicio', name: 'Mi ejercicio', notes: '', series: [{ type: 'normal', target: '10', rest: 60, weight: 42, weight2: null, repsDone: 10, rpe: null, done: true }] }],
    });
    const seed = { 'gymtracker.plan': '{roto', 'gymtracker.draft': raw };
    {
      const { context, page, ls } = await open({ seed });
      await page.waitForSelector('#screen-home.active .session-btn');
      const banner = page.locator('#recovery-banner');
      assert.equal(await ls('gymtracker.draft.backup'), raw, 'el borrador que no se puede reconstruir se copia');
      assert.match(await banner.textContent(), /rutina ya no está en el plan/);
      await page.locator('.session-btn').first().click();
      await page.waitForSelector('#screen-session.active .kg-input');
      assert.notEqual(await ls('gymtracker.draft'), raw, 'el borrador nuevo ocupa gymtracker.draft');
      assert.equal(await ls('gymtracker.draft.backup'), raw, 'la copia sigue ahí');
      await page.reload();
      await page.waitForSelector('#screen-session.active .kg-input');
      assert.equal(await ls('gymtracker.draft.backup'), raw, 'y sobrevive a la recarga');
      assert.match(await banner.textContent(), /rutina ya no está en el plan/, 'el aviso persiste mientras exista la copia');
      assert.equal(await downloadText(page, banner.locator('[data-action="recovery-download"]')), raw);
      await banner.locator('[data-action="recovery-done"]').click();
      assert.equal(await banner.isVisible(), false);
      assert.equal(await ls('gymtracker.draft.backup'), null, 'confirmada la descarga, la copia se retira');
      await page.reload();
      await page.waitForSelector('#screen-session.active .kg-input');
      assert.equal(await banner.isVisible(), false, 'y el aviso no vuelve');
      await finish(page);
      await context.close();
    }
    {
      const { context, page, dialogs, ls } = await open({ seed, failKeys: ['gymtracker.draft.backup'] });
      await page.waitForSelector('#screen-home.active .session-btn');
      assert.match(await page.locator('#recovery-banner').textContent(), /no se pudo copiar/);
      page.__answer = 'dismiss';
      await page.locator('.session-btn').first().click();
      assert.match(dialogs.at(-1), /sin recuperar/);
      assert.equal(await page.locator('#screen-home.active').count(), 1, 'no empieza la rutina');
      assert.equal(await ls('gymtracker.draft'), raw, 'el borrador original no se sobrescribe');
      await finish(page);
      await context.close();
    }
  }

  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e integrity: ok (datos dañados sin copia no se sobrescriben, versión más nueva, doble toque y deshacer agrupado en sesiones y medidas, volcado en visibilitychange y pagehide, borrador de rutina perdida recuperable, CSP sin violaciones, viewport Pixel 7)');
} finally {
  if (browser) await browser.close();
  server.kill();
}
