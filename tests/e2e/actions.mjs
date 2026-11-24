// E2E de la fase 1: delegación data-action, timers, historial, claves antiguas,
// datos hostiles renderizados como texto y ausencia de violaciones CSP.
// Uso: npm run e2e   (levanta python3 -m http.server en un puerto libre)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.E2E_PORT_ACTIONS || 8138);
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

const XSS = '<img src=x onerror="window.__pwned=1">';
const T0 = Date.UTC(2026, 10, 1, 18, 0);
const legacySessions = [{
  id: 111,
  timestamp: T0,
  date: XSS,
  session: `Sesión 1: Pecho + Hombro${XSS}`,
  exercises: [{ name: XSS, series: [{ reps: XSS, weight: '33', weight2: XSS }] }],
}, {
  id: '1);window.__pwned=2;//',
  timestamp: T0 + 1000,
  date: '2/2/2026',
  session: 'Sesión 2: Pierna',
  exercises: [],
}];

const problems = [];
let browser;
try {
  await waitServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();

  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) {
      problems.push(`console ${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  const dialogs = [];
  page.on('dialog', d => {
    if (d.type() !== 'confirm') problems.push(`dialog inesperado: ${d.type()} ${d.message()}`);
    dialogs.push(d.message());
    d.accept();
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });

  // Reloj controlable desde el inicio (fluye en tiempo real salvo runFor).
  await page.clock.install();

  // 1. Claves antiguas sembradas con contenido hostil: se leen y se pintan como texto.
  await page.goto(base);
  await page.evaluate(s => {
    localStorage.clear();
    localStorage.setItem('gym-sessions', JSON.stringify(s));
  }, legacySessions);
  await page.reload();
  await page.waitForSelector('.session-btn');

  await page.locator('[data-action="go-screen"][data-screen="history"]').first().click();
  await page.waitForSelector('#screen-history.active .session-card');
  assert.equal(await page.locator('.session-card').count(), 2, 'historial leído de la clave antigua');
  assert.equal(await page.locator('#history-container img').count(), 0, 'se inyectó HTML');
  assert.ok((await page.locator('#history-container').textContent()).includes(XSS), 'el texto hostil se muestra literal');

  // 2. Expandir / contraer (estado persistido) y borrar con confirm.
  const oldest = page.locator('.session-card').nth(1);
  assert.equal(await oldest.locator('.session-details').isVisible(), false);
  await oldest.locator('.session-header').click();
  assert.equal(await page.locator('.session-card').nth(1).locator('.session-details').isVisible(), true);
  assert.match(await page.locator('.session-card').nth(1).textContent(), /Serie 1: 33kg \(obj. <img/);
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.ui')));
  assert.deepEqual(st.expandedSessions, ['111']);
  await page.locator('.session-card').nth(1).locator('.session-header').click();
  assert.equal(await page.locator('.session-card').nth(1).locator('.session-details').isVisible(), false);

  await page.locator('.session-card').first().locator('[data-action="delete-session"]').click();
  assert.equal(await page.locator('.session-card').count(), 1, 'borrado por delegación');
  const stored = await page.evaluate(() => ({
    next: JSON.parse(localStorage.getItem('gymtracker.data')),
    legacy: JSON.parse(localStorage.getItem('gym-sessions')),
  }));
  assert.equal(stored.next.schemaVersion, 2);
  assert.deepEqual(stored.next.sessions.map(s => s.id), ['111']);
  assert.equal(stored.legacy.length, 2, 'la clave antigua no se toca');
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'se ejecutó código inyectado');

  // 3. Volver a home e iniciar sesión: los inputs empiezan vacíos (el anterior va en placeholder).
  await page.locator('#screen-history [data-action="go-back"]').click();
  await page.waitForSelector('#screen-home.active .session-btn');
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.equal(await page.locator('#session-header-title').textContent(), 'Sesión 1: Pecho + Hombro');
  assert.equal(await page.locator('#screen-session .kg-input').first().inputValue(), '');
  assert.equal(await page.locator('#screen-session .prev-btn').count(), 0, 'sin historial no hay columna Anterior con valores');

  // 4. Enter salta al siguiente input (kg → reps de la misma serie → kg de la siguiente).
  const inputs = page.locator('#screen-session .kg-input');
  await inputs.nth(0).focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => [document.activeElement.dataset.series, document.activeElement.dataset.field]), ['0', 'repsDone']);
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => [document.activeElement.dataset.series, document.activeElement.dataset.field]), ['1', 'weight']);

  // 5. Descanso: marcar una serie arranca la barra fija; pausar, reanudar y saltar.
  // El estado se guarda en eventos, no en cada tick.
  await page.locator('#screen-session .exercise-block').first().locator('.kg-input').first().fill('30');
  await page.locator('#screen-session .exercise-block').first().locator('.kg-input').first().dispatchEvent('change');
  await page.evaluate(() => {
    window.__uiWrites = 0;
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'gymtracker.ui') window.__uiWrites += 1;
      return orig.call(this, k, v);
    };
  });
  await page.locator('#screen-session .check-btn').first().click();
  const bar = page.locator('#rest-bar');
  await bar.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#screen-session .timer-btn').count(), 0, 'ya no hay temporizadores por serie');
  assert.equal(await page.evaluate(() => window.__uiWrites), 1, 'un guardado al arrancar el descanso');
  await page.waitForTimeout(1300);
  const t1 = await bar.locator('#rest-time').textContent();
  assert.match(t1, /^1:2\d$/, `descanso corriendo: ${t1}`);
  assert.equal(await page.evaluate(() => window.__uiWrites), 1, 'los ticks no escriben en localStorage');
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.ui')));
  assert.equal(st.timer.duration, 90);

  await bar.locator('#rest-toggle').click();
  assert.equal(await bar.locator('#rest-toggle').textContent(), '▶');
  const paused = await bar.locator('#rest-time').textContent();
  await page.waitForTimeout(1300);
  assert.equal(await bar.locator('#rest-time').textContent(), paused, 'pausado no avanza');
  await bar.locator('#rest-toggle').click();
  assert.equal(await bar.locator('#rest-toggle').textContent(), '⏸');

  await bar.locator('[data-action="rest-skip"]').click();
  assert.equal(await bar.isHidden(), true);
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.ui')));
  assert.equal(st.timer, null);

  // 6. Descanso corto (myo-reps, 15 s) llega a 0 y la barra desaparece. Se adelanta el reloj con runFor.
  const myo = page.locator('#screen-session .exercise-block').nth(2);
  await myo.locator('.kg-input').first().fill('12');
  await myo.locator('.kg-input').first().dispatchEvent('change');
  await myo.locator('.check-btn').first().click();
  await bar.waitFor({ state: 'visible' });
  await page.clock.runFor(16_000);
  assert.equal(await bar.isHidden(), true, 'la barra se oculta al terminar');

  // 7. Superserie (sesión 2) con dos inputs y etiquetas; guardar y copiar resumen.
  // Cambiar de sesión con un borrador abierto pide confirmación (el handler la acepta).
  await page.locator('#screen-session [data-action="go-back"]').click();
  await page.locator('.session-btn').nth(1).click();
  await page.waitForSelector('#screen-session.active .input-superset');
  assert.match(dialogs.at(-1), /sesión en curso \(Sesión 1: Pecho \+ Hombro\)/);
  await page.locator('.input-superset').nth(0).fill('40');
  await page.locator('.input-superset').nth(0).dispatchEvent('change');
  await page.locator('.input-superset').nth(1).fill('35');
  await page.locator('.input-superset').nth(1).dispatchEvent('change');
  assert.ok(await page.locator('.badge-superset').count() > 0, 'badge por clase');
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  assert.match(await page.locator('#summary-text').textContent(), /Serie 1: Extensión 40kg \+ Curl femoral 35kg/);
  await page.locator('[data-action="copy-summary"]').click();
  await page.waitForFunction(() => document.getElementById('copy-btn').textContent.includes('Copiado'));
  assert.ok(await page.locator('#copy-btn.copied').count() === 1);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /^\[GUARDAR SESIÓN\]/);

  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], `violaciones CSP: ${csp.join(', ')}`);
  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e actions: ok (historial, timers, superserie, copiar, CSP sin violaciones, viewport Pixel 7)');
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
