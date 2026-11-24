// E2E de la fase 3: registro rápido en el gimnasio, en Pixel 7 emulado.
// Flujo completo con recarga y botón atrás, descanso único con ±15 s, copiar serie,
// añadir/quitar con deshacer, reordenar, sustituir, notas, reloj, avisos y Wake Lock.
// Uso: npm run e2e   (levanta python3 -m http.server en un puerto libre)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.E2E_PORT_SESSION || 8139);
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

const problems = [];
let browser;
try {
  await waitServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], permissions: ['notifications'] });
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

  // Sustitutos observables de lo que Android hace de verdad: vibración, Wake Lock, AudioContext
  // y notificaciones. Solo comprobamos que la app los invoca, no que el móvil los ejecute.
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    window.__vibrations = [];
    navigator.vibrate = p => { window.__vibrations.push(p); return true; };
    window.__wl = { requests: 0, releases: 0 };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async () => {
          window.__wl.requests += 1;
          const s = new EventTarget();
          s.release = async () => { window.__wl.releases += 1; s.dispatchEvent(new Event('release')); };
          return s;
        },
      },
    });
    window.__audio = 0;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor() { super(); window.__audio += 1; }
    };
    window.__hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
    window.__notifications = [];
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
      window.__notifications.push({ title, tag: opts && opts.tag });
      return Promise.resolve();
    };
  });
  await page.clock.install();

  const ls = key => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
  const block = i => page.locator('#screen-session .exercise-block').nth(i);
  const row = (e, s) => block(e).locator('.series-block').nth(s);
  const kg = (e, s) => row(e, s).locator('.kg-input[data-field="weight"]');
  const reps = (e, s) => row(e, s).locator('.kg-input[data-field="repsDone"]');
  const check = (e, s) => row(e, s).locator('.check-btn');
  const bar = page.locator('#rest-bar');
  const time = () => bar.locator('#rest-time').textContent();
  const toast = page.locator('#toast');
  async function type(locator, value) {
    await locator.fill(value);
    await locator.dispatchEvent('change');
  }
  const seconds = txt => {
    const [m, s] = txt.includes(':') ? txt.split(':').map(Number) : [0, Number(txt.replace('s', ''))];
    return m * 60 + s;
  };

  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.session-btn');

  // 1. Entrar a la sesión: inputs de 16 px, objetivos táctiles de 44 px, teclado decimal.
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.equal(await page.evaluate(() => history.state.screen), 'session');
  const kgInput = kg(0, 0);
  assert.equal(await kgInput.getAttribute('inputmode'), 'decimal');
  assert.equal(await reps(0, 0).getAttribute('inputmode'), 'numeric');
  for (const loc of [kgInput, reps(0, 0), check(0, 0), block(0).locator('.tool-btn').first(), page.locator('#screen-session .btn-back'), page.locator('#screen-session [data-action="complete-session"]')]) {
    const box = await loc.boundingBox();
    assert.ok(box.height >= 43.5, `objetivo táctil de ${box.height}px`);
    assert.ok(box.width >= 43.5, `objetivo táctil de ${box.width}px de ancho`);
  }
  assert.equal(await kgInput.evaluate(el => getComputedStyle(el).fontSize), '16px');
  assert.equal(await page.locator('#session-elapsed').textContent(), '0:00');

  // 2. Marcar una serie vacía sin nada que copiar avisa y no la marca.
  await check(0, 0).click();
  assert.match(await toast.textContent(), /Apunta peso o reps/);
  assert.equal(await page.locator('#rest-bar').isHidden(), true);

  // 3. Coma decimal: se guarda como número. Marcar la serie arranca el descanso (90 s).
  await type(kg(0, 0), '22,5');
  assert.equal(await kg(0, 0).inputValue(), '22.5', 'el valor se normaliza');
  await type(reps(0, 0), '8');
  assert.equal((await ls('gymtracker.draft')).exercises[0].series[0].weight, 22.5);
  assert.equal(await row(0, 0).evaluate(el => el.classList.contains('done')), false, 'escribir no marca como hecha');
  await check(0, 0).click();
  await bar.waitFor({ state: 'visible' });
  assert.equal(await row(0, 0).evaluate(el => el.classList.contains('done')), true);
  assert.equal(await check(0, 0).getAttribute('aria-pressed'), 'true');
  assert.match(await time(), /^1:(30|29)$/);
  assert.match(await bar.locator('#rest-label').textContent(), /Press banca mancuernas · serie 1/);

  // 4. Marcar una serie vacía copia la de encima y reinicia el único descanso.
  await page.clock.runFor(10_000);
  await check(0, 1).click();
  assert.equal(await kg(0, 1).inputValue(), '22.5');
  assert.equal(await reps(0, 1).inputValue(), '8');
  assert.equal(await page.locator('#rest-bar').count(), 1, 'una sola barra de descanso');
  assert.match(await time(), /^1:(30|29)$/, 'el segundo descanso sustituye al primero');
  assert.match(await bar.locator('#rest-label').textContent(), /serie 2/);

  // 5. ±15 s y pausa, con el estado guardado.
  await bar.locator('[data-action="rest-adjust"][data-delta="15"]').click();
  assert.ok(Math.abs(seconds(await time()) - 105) <= 1, await time());
  await bar.locator('[data-action="rest-adjust"][data-delta="-15"]').click();
  await bar.locator('[data-action="rest-adjust"][data-delta="-15"]').click();
  assert.ok(Math.abs(seconds(await time()) - 75) <= 1, await time());
  assert.ok(Math.abs((await ls('gymtracker.ui')).timer.remaining - 75) <= 1);

  // 6. Segundo plano: el reloj salta 60 s sin ticks; al volver la barra se recalcula al instante.
  await page.clock.fastForward(60_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.ok(Math.abs(seconds(await time()) - 15) <= 1, `tras el segundo plano: ${await time()}`);

  // 7. Fin del descanso: vibración y sonido con un único AudioContext. Con la app en segundo plano, notificación local.
  await page.clock.runFor(16_000);
  assert.equal(await bar.isHidden(), true);
  assert.equal(await page.evaluate(() => window.__vibrations.length), 1);
  assert.equal(await page.evaluate(() => window.__audio), 1, 'un AudioContext');
  assert.equal(await page.evaluate(() => window.__notifications.length), 0, 'en primer plano no hay notificación');
  assert.equal((await ls('gymtracker.ui')).timer, null);
  await check(0, 2).click(); // vacía: copia la de encima
  await bar.waitFor({ state: 'visible' });
  await page.evaluate(() => { window.__hidden = true; });
  await page.clock.runFor(91_000);
  assert.equal(await bar.isHidden(), true);
  await page.waitForFunction(() => window.__notifications.length > 0, null, { timeout: 5000 }).catch(async () => {
    throw new Error('sin notificación; permiso=' + await page.evaluate(() => Notification.permission) + ' sw=' + await page.evaluate(() => navigator.serviceWorker.controller !== undefined));
  });
  assert.deepEqual(await page.evaluate(() => window.__notifications), [{ title: 'Descanso terminado', tag: 'rest-end' }]);
  assert.equal(await page.evaluate(() => window.__audio), 1, 'el AudioContext se reutiliza');
  await page.evaluate(() => { window.__hidden = false; });

  // 8. Descanso por ejercicio: el ajuste se guarda y manda sobre el del plan.
  await block(0).locator('[data-action="rest-step"][data-delta="15"]').click();
  assert.match(await block(0).locator('.rest-step-value').textContent(), /1m45s/);
  assert.equal((await ls('gymtracker.ui')).restByExercise['press-banca-mancuernas'], 105);
  await check(0, 3).click();
  assert.ok(Math.abs(seconds(await time()) - 105) <= 1, await time());
  await bar.locator('[data-action="rest-skip"]').click();

  // 9. Añadir serie en blanco y quitarla con deshacer.
  const before = await block(0).locator('.series-block').count();
  await block(0).locator('[data-action="add-series"]').click();
  assert.equal(await block(0).locator('.series-block').count(), before + 1);
  assert.equal(await kg(0, before).inputValue(), '', 'la serie nueva empieza vacía');
  await type(kg(0, before), '30');
  await block(0).locator('[data-action="remove-series"]').click();
  assert.equal(await block(0).locator('.series-block').count(), before);
  assert.match(await toast.textContent(), /Serie \d+ quitada/);
  await toast.locator('[data-action="toast-undo"]').click();
  assert.equal(await block(0).locator('.series-block').count(), before + 1);
  assert.equal(await kg(0, before).inputValue(), '30', 'deshacer devuelve los valores');
  assert.equal(await toast.isHidden(), true);

  // 10. Reordenar y sustituir.
  const names = () => page.locator('#screen-session .exercise-name-main').allTextContents();
  const first = (await names())[0];
  const second = (await names())[1];
  await block(0).locator('[data-action="move-exercise"][data-dir="1"]').click();
  assert.deepEqual((await names()).slice(0, 2), [second, first]);
  assert.equal(await block(0).locator('[data-action="move-exercise"][data-dir="-1"]').isDisabled(), true);
  await block(1).locator('[data-action="open-substitute"]').click();
  assert.equal(await page.locator('#substitute-input').evaluate(el => document.activeElement === el), true);
  await page.locator('#substitute-input').fill('Press banca inclinado');
  await block(1).locator('[data-action="confirm-substitute"]').click();
  assert.equal(dialogs.at(-1), 'Este ejercicio ya tiene series apuntadas. ¿Sustituirlo y vaciarlas?');
  assert.equal((await names())[1], 'Press banca inclinado');
  assert.match(await block(1).locator('.exercise-note').textContent(), /Sustituye a Press banca mancuernas/);
  assert.equal(await kg(1, 0).inputValue(), '');
  await block(0).locator('[data-action="open-substitute"]').click();
  await page.locator('#substitute-input').fill('press banca inclinado');
  await page.keyboard.press('Enter');
  assert.match(await toast.textContent(), /ya está en la sesión/);
  await block(0).locator('[data-action="cancel-substitute"]').click();
  assert.equal(await page.locator('#substitute-input').count(), 0);

  // 11. Notas por sesión y por ejercicio.
  assert.equal(await page.locator('textarea[data-note="session"]').isVisible(), false, 'las notas empiezan plegadas');
  await page.locator('details.note-box > summary').first().click();
  await page.locator('textarea[data-note="session"]').fill('Dormí poco');
  await block(0).locator('details.note-box > summary').click();
  await block(0).locator('textarea[data-note="exercise"]').fill('Banco a 3');
  const d1 = await ls('gymtracker.draft');
  assert.equal(d1.notes, 'Dormí poco');
  assert.equal(d1.exercises[0].notes, 'Banco a 3');

  // 12. Reloj de entreno: avanza con el reloj de la página.
  await page.clock.runFor(65_000);
  assert.match(await page.locator('#session-elapsed').textContent(), /^\d+:\d\d$/);
  assert.ok(seconds(await page.locator('#session-elapsed').textContent()) >= 65);

  // 13. Wake Lock pedido en la sesión y liberado al salir de ella.
  assert.ok(await page.evaluate(() => window.__wl.requests) >= 1, 'Wake Lock solicitado');
  assert.equal(await page.evaluate(() => window.__wl.releases), 0);

  // 14. Botón atrás: vuelve a home, la sesión sigue como borrador y adelante la recupera.
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  assert.equal(await page.evaluate(() => window.__wl.releases), 1, 'Wake Lock liberado fuera de la sesión');
  assert.equal(await page.locator('#screen-home [data-action="resume-session"]').count(), 1);
  await page.goForward();
  await page.waitForSelector('#screen-session.active');
  assert.equal((await names())[1], 'Press banca inclinado');

  // 15. Recarga con descanso activo: orden, sustitución, notas, valores y el descanso persisten.
  await type(kg(0, 0), '20');
  await type(reps(0, 0), '8');
  await check(0, 0).click();
  await bar.waitFor({ state: 'visible' });
  await page.reload();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.deepEqual((await names()).slice(0, 2), [second, 'Press banca inclinado']);
  assert.equal(await page.locator('textarea[data-note="session"]').inputValue(), 'Dormí poco');
  assert.equal(await page.locator('textarea[data-note="exercise"]').nth(0).inputValue(), 'Banco a 3');
  assert.equal(await page.locator('#screen-session details.note-box').first().evaluate(el => el.open), true, 'la nota se muestra abierta');
  assert.equal(await bar.isVisible(), true, 'el descanso sobrevive a la recarga');
  // atrás tras recargar: home, no se sale de la app
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  await page.locator('[data-action="resume-session"]').click();
  await page.waitForSelector('#screen-session.active');

  // 16. Guardar: la sustitución, las series añadidas y las notas llegan al historial.
  await type(kg(1, 0), '40');
  await type(reps(1, 0), '10');
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  const summary = await page.locator('#summary-text').textContent();
  assert.match(summary, /📝 Dormí poco/);
  assert.match(summary, /▸ Press banca inclinado[\s\S]*Serie 1: 40kg × 10/);
  const saved = (await ls('gymtracker.data')).sessions[0];
  assert.equal(saved.exercises[1].name, 'Press banca inclinado');
  assert.equal(saved.exercises[0].notes, 'Banco a 3');
  assert.equal(saved.exercises[1].series.length, 5, 'la serie añadida sobrevive a la sustitución');
  assert.equal(await bar.isHidden(), true);
  assert.equal((await ls('gymtracker.ui')).timer, null);
  // atrás desde el resumen: home (no vuelve a una sesión ya guardada)
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  assert.equal(await page.locator('[data-action="resume-session"]').count(), 0);

  // 17. Historial: borrar sesión y deshacer.
  await page.locator('#screen-home [data-action="go-screen"][data-screen="history"]').click();
  await page.waitForSelector('#screen-history.active .session-card');
  assert.equal(await page.evaluate(() => history.state.depth), 1);
  await page.locator('.session-card [data-action="delete-session"]').click();
  assert.equal(await page.locator('.session-card').count(), 0);
  assert.equal((await ls('gymtracker.data')).sessions.length, 0);
  await toast.locator('[data-action="toast-undo"]').click();
  assert.equal(await page.locator('.session-card').count(), 1);
  assert.equal((await ls('gymtracker.data')).sessions.length, 1);
  await page.goBack();
  await page.waitForSelector('#screen-home.active');

  // 18. Con el historial, la columna Anterior ofrece los valores de la última sesión.
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.equal(await row(1, 0).locator('.prev-btn').count(), 1);
  assert.equal((await row(1, 0).locator('.prev-btn').textContent()).trim(), '20 × 8');
  assert.equal(await row(0, 0).locator('.prev-btn').count(), 0, 'el ejercicio sustituido no tiene anterior');
  await row(1, 0).locator('.prev-btn').click();
  assert.equal(await kg(1, 0).inputValue(), '20');

  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], `violaciones CSP: ${csp.join(', ')}`);
  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e session: ok (registro rápido, descanso único, atrás/recarga, avisos simulados, CSP sin violaciones, viewport Pixel 7)');
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
