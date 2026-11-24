// E2E de la fase 5: ajustes (unidades, tema, sonido, vibración, descanso por defecto), sugerencia de
// sobrecarga, modo guiado, calculadora de discos, volumen por músculo e imagen para compartir, en Pixel 7 emulado.
// Uso: npm run e2e   (levanta python3 -m http.server en un puerto libre)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.E2E_PORT_PROGRESS || 8141);
const base = `http://127.0.0.1:${port}/index.html`;

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('servidor local no arrancó');
}

// Seis semanas seguidas de la sesión 1 (la última, hoy). Press banca: 4×10 a 22,5 kg (llega al tope) y
// aperturas en polea baja: 12, 13 y 15 reps a 10 kg (no llega en todas las series).
function seed() {
  const now = new Date();
  const at = back => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, back === 0 ? 0 : 18, 30).getTime();
  const s = (weight, repsDone) => ({ type: 'normal', target: '', weight, weight2: null, repsDone, rpe: null, done: true });
  const sessions = [35, 28, 21, 14, 7, 0].map((back, i) => ({
    id: `seed-${i}`, planSessionId: 'pecho-hombro', name: 'Sesión 1: Pecho + Hombro', startedAt: at(back), endedAt: at(back) + 3_600_000, notes: '',
    exercises: [
      { id: 'press-banca-mancuernas', name: 'Press banca mancuernas', notes: '', series: [s(22.5, 10), s(22.5, 10), s(22.5, 10), s(22.5, 10)] },
      { id: 'aperturas-polea-baja', name: 'Aperturas polea baja sentado', notes: '', series: [s(10, 12), s(10, 13), s(10, 15)] },
    ],
  }));
  localStorage.setItem('gymtracker.data', JSON.stringify({ schemaVersion: 2, sessions, body: [], settings: {} }));
}

const problems = [];
let browser;
try {
  await waitServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true, timezoneId: 'Europe/Madrid', colorScheme: 'dark' });
  const page = await context.newPage();
  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', d => d.accept());

  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    window.__vibrations = [];
    navigator.vibrate = p => { window.__vibrations.push(p); return true; };
    window.__osc = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () { window.__osc += 1; return create.call(this); };
    window.__shared = [];
    window.__shareMode = 'ok';
    navigator.canShare = data => window.__shareMode !== 'none' && !!(data && data.files && data.files.length);
    navigator.share = async data => {
      if (window.__shareMode === 'abort') throw new DOMException('cancelado', 'AbortError');
      window.__shared.push({ name: data.files[0].name, type: data.files[0].type, size: data.files[0].size, title: data.title });
    };
  });
  await page.clock.install();

  const ls = key => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
  const block = i => page.locator('#screen-session .exercise-block').nth(i);
  const row = (e, s) => block(e).locator('.series-block').nth(s);
  const kg = (e, s) => row(e, s).locator('.kg-input[data-field="weight"]');
  const reps = (e, s) => row(e, s).locator('.kg-input[data-field="repsDone"]');
  const check = (e, s) => row(e, s).locator('.check-btn');
  const toast = page.locator('#toast');
  async function type(locator, value) {
    await locator.fill(value);
    await locator.dispatchEvent('change');
  }
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const settingBtn = (key, value) => page.locator(`#settings-container [data-action="set-setting"][data-key="${key}"][data-value="${value}"]`);
  const switchBtn = key => page.locator(`#settings-container [data-action="toggle-setting"][data-key="${key}"]`);
  const savedSettings = async () => (await ls('gymtracker.data')).settings;

  async function openSettings() {
    if (await page.locator('#screen-home.active').count() === 0) {
      await page.goBack();
      await page.waitForSelector('#screen-home.active');
    }
    await page.locator('#screen-home [data-screen="settings"]').click();
    await page.waitForSelector('#screen-settings.active .seg-btn');
  }
  async function backToSession() {
    await page.goBack();
    await page.waitForSelector('#screen-home.active');
    await page.locator('.resume-card').click();
    await page.waitForSelector('#screen-session.active .kg-input');
  }

  await page.goto(base);
  await page.evaluate(seed);
  await page.reload();
  await page.waitForSelector('.session-btn');

  // 1. Aviso de descarga en inicio: seis semanas seguidas, informativo.
  const notice = page.locator('#home-notices .notice');
  assert.equal(await notice.count(), 1);
  assert.match(await notice.textContent(), /6 semanas seguidas/);

  // 2. Ajustes: pantalla, objetivos táctiles y valores por defecto.
  await openSettings();
  assert.equal(await settingBtn('units', 'kg').getAttribute('aria-pressed'), 'true');
  assert.equal(await settingBtn('theme', 'auto').getAttribute('aria-pressed'), 'true');
  for (const loc of [settingBtn('units', 'lb'), switchBtn('sound'), page.locator('[data-action="step-setting"]').first(), page.locator('#settings-container [data-action="open-plates"]')]) {
    const box = await loc.boundingBox();
    assert.ok(box.height >= 43.5 && box.width >= 43.5, `objetivo táctil de ${box.width}×${box.height}`);
  }
  assert.match(await page.locator('.explain').textContent(), /No son asesoramiento/);

  // 3. Tema: oscuro por defecto, claro forzado, y 'auto' sigue al sistema.
  assert.equal(await bg(), 'rgb(10, 10, 15)');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.equal(await bg(), 'rgb(243, 244, 246)', 'auto con sistema claro');
  await settingBtn('theme', 'dark').click();
  assert.equal(await bg(), 'rgb(10, 10, 15)', 'oscuro forzado');
  await page.emulateMedia({ colorScheme: 'dark' });
  await settingBtn('theme', 'light').click();
  assert.equal(await bg(), 'rgb(243, 244, 246)', 'claro forzado');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.equal((await savedSettings()).theme, 'light');
  await settingBtn('theme', 'auto').click();
  assert.equal(await bg(), 'rgb(10, 10, 15)', 'auto con sistema oscuro');
  assert.equal((await ls('gymtracker.data')).sessions.length, 6, 'ajustar no toca el historial');

  // 4. Sobrecarga: con 4×10 a 22,5 kg se sugiere 25 kg; las aperturas (12, 13, 15) solo muestran el objetivo.
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.doesNotMatch(await page.locator('#exercises-container').textContent(), /null/, 'sin "null" suelto en la lista');
  const up = block(0).locator('.suggest[data-suggest="increase"]');
  assert.match(await up.textContent(), /prueba 25 kg/);
  assert.match(await up.textContent(), /Llegaste a 10 reps en las 4 series/);
  assert.match(await block(3).locator('.suggest[data-suggest="hold"]').textContent(), /Objetivo: 15 reps en las 3 series con 10 kg/);
  assert.equal(await block(1).locator('.suggest').count(), 0, 'drop set: la regla no aplica');
  await block(0).locator('[data-action="apply-suggestion"]').click();
  assert.equal(await kg(0, 0).inputValue(), '25');
  assert.equal(await kg(0, 3).inputValue(), '25');
  assert.equal((await ls('gymtracker.draft')).exercises[0].series[2].weight, 25);

  // 5. Desactivar la progresión quita sugerencias y aviso.
  await openSettings();
  await switchBtn('progression').click();
  assert.equal((await savedSettings()).progression, false);
  await backToSession();
  assert.equal(await page.locator('.suggest').count(), 0);
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  assert.equal(await page.locator('#home-notices .notice').count(), 0);
  await openSettings();
  await switchBtn('progression').click();
  assert.equal((await savedSettings()).progression, true);
  await backToSession();
  assert.equal(await page.locator('.suggest').count(), 2);

  // 6. Modo guiado: un ejercicio por pantalla, navegación y recarga.
  const toggle = page.locator('[data-action="toggle-guided"]');
  assert.ok((await toggle.boundingBox()).height >= 43.5);
  await toggle.click();
  assert.equal(await page.locator('#screen-session .exercise-block').count(), 1);
  assert.match(await page.locator('.guided-count').first().textContent(), /Ejercicio 1 de 6/);
  assert.match(await block(0).locator('.exercise-name-main').textContent(), /Press banca mancuernas/);
  assert.equal(await kg(0, 0).inputValue(), '25', 'conserva lo apuntado');
  const next = page.locator('.guided-nav [data-action="guided-step"][data-delta="1"]').first();
  assert.ok((await next.boundingBox()).height >= 43.5);
  await next.click();
  assert.match(await page.locator('.guided-count').first().textContent(), /Ejercicio 2 de 6/);
  assert.match(await block(0).locator('.exercise-name-main').textContent(), /Press inclinado/);
  // Los índices del borrador siguen siendo los del ejercicio real: escribir en la serie 1 guarda en el ejercicio 2.
  await type(kg(0, 0), '20');
  assert.equal((await ls('gymtracker.draft')).exercises[1].series[0].weight, 20);
  await next.click();
  await page.reload();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.match(await page.locator('.guided-count').first().textContent(), /Ejercicio 3 de 6/, 'recuerda el ejercicio tras recargar');
  await page.locator('.guided-nav [data-action="guided-step"][data-delta="-1"]').first().click();
  assert.match(await page.locator('.guided-count').first().textContent(), /Ejercicio 2 de 6/);
  await page.locator('[data-action="toggle-guided"]').click();
  assert.equal(await page.locator('#screen-session .exercise-block').count(), 6);

  // 7. Unidades: en lb se muestra convertido, se escribe en lb y se guarda en kg.
  await openSettings();
  await settingBtn('units', 'lb').click();
  assert.equal((await savedSettings()).units, 'lb');
  await backToSession();
  assert.equal(await kg(0, 0).inputValue(), '55.1', '25 kg = 55,1 lb');
  assert.match(await block(0).locator('.series-head').textContent(), /lb × reps/);
  await type(kg(0, 1), '100,5');
  assert.equal(await kg(0, 1).inputValue(), '100.5');
  assert.equal((await ls('gymtracker.draft')).exercises[0].series[1].weight, 45.586, '100,5 lb guardados como kg');
  assert.equal((await ls('gymtracker.data')).sessions[0].exercises[0].series[0].weight, 22.5, 'el historial no se reescribe');
  assert.match(await block(0).locator('.suggest').textContent(), /prueba 54\.6 lb/, 'la sugerencia sube 5 lb sobre 49,6 lb');
  assert.match(await block(0).locator('.suggest').textContent(), /49\.6 lb × 10, 10, 10, 10 reps/);
  await type(kg(0, 2), 'abc');
  assert.equal(await kg(0, 2).getAttribute('aria-invalid'), 'true');

  // 8. Calculadora de discos desde el ejercicio: 225 lb → 2 discos de 45 lb por lado.
  await block(0).locator('[data-action="open-plates"]').click();
  await page.waitForSelector('#screen-plates.active #plates-total');
  assert.equal(await page.locator('#plates-total').inputValue(), '100,5', 'rellena con la carga más alta del ejercicio');
  assert.equal(await page.locator('#plates-bar').inputValue(), '45');
  for (const id of ['#plates-total', '#plates-bar', '#plates-list']) {
    assert.equal(await page.locator(id).evaluate(el => getComputedStyle(el).fontSize), '16px');
  }
  await page.locator('#plates-total').fill('225');
  assert.equal(await page.locator('#plates-result li').count(), 1);
  assert.equal((await page.locator('#plates-result li').textContent()).trim(), '2 × 45 lb');
  assert.match(await page.locator('#plates-sum').textContent(), /Total montado: 225 lb/);
  assert.doesNotMatch(await page.locator('#screen-plates').textContent(), /null/, 'sin "null" suelto en la pantalla');
  await page.goBack();
  await page.waitForSelector('#screen-session.active');

  // 9. Vuelta a kg: la barra y los discos vuelven a los de kg; 100 kg = 1×25 + 1×15 por lado.
  await openSettings();
  await settingBtn('units', 'kg').click();
  assert.equal((await savedSettings()).units, 'kg');
  await page.locator('#settings-container [data-action="open-plates"]').click();
  await page.waitForSelector('#screen-plates.active #plates-total');
  assert.equal(await page.locator('#plates-bar').inputValue(), '20');
  assert.equal(await page.locator('#plates-list').inputValue(), '25 20 15 10 5 2,5 1,25');
  await page.locator('#plates-total').fill('100');
  assert.deepEqual(await page.locator('#plates-result li').allTextContents(), ['1 × 25 kg', '1 × 15 kg']);
  await page.locator('#plates-total').fill('15');
  assert.match(await page.locator('#plates-result').textContent(), /menor que el de la barra/);
  await page.locator('#plates-total').fill('23');
  await page.locator('#plates-list').fill('2,5 1,25');
  assert.match(await page.locator('#plates-warn').textContent(), /No se llega exacto: faltan 0,5 kg/);
  await page.locator('#plates-list').fill('2,5 x');
  assert.equal(await page.locator('#plates-error').isVisible(), true);
  assert.equal(await page.locator('#plates-error').textContent(), 'Discos no válidos');
  // Guardar barra y discos propios; persisten tras recargar.
  await page.locator('#plates-bar').fill('15');
  await page.locator('#plates-list').fill('20 10');
  await page.locator('[data-action="save-plates"]').click();
  const saved = await savedSettings();
  assert.equal(saved.bar, 15);
  assert.deepEqual(saved.plates, [20, 10]);
  await page.reload();
  await page.waitForSelector('#screen-session.active .kg-input');
  await block(0).locator('[data-action="open-plates"]').click();
  await page.waitForSelector('#screen-plates.active #plates-bar');
  assert.equal(await page.locator('#plates-bar').inputValue(), '15');
  assert.equal(await page.locator('#plates-list').inputValue(), '20 10');
  await page.locator('[data-action="reset-plates"]').click();
  assert.equal(await page.locator('#plates-bar').inputValue(), '20');
  assert.equal((await savedSettings()).bar, undefined);
  await page.goBack();
  await page.waitForSelector('#screen-session.active, #screen-home.active');

  // 10. Descanso por defecto para un ejercicio sustituido (sin descanso propio).
  if (await page.locator('#screen-session.active').count() === 0) {
    await page.locator('.resume-card').click();
    await page.waitForSelector('#screen-session.active .kg-input');
  }
  await openSettings();
  for (let i = 0; i < 4; i++) await page.locator('[data-action="step-setting"][data-delta="15"]').click();
  assert.equal(await page.locator('#default-rest-value').textContent(), '⏱ 1m');
  assert.equal((await savedSettings()).defaultRest, 60);
  await backToSession();
  await block(5).locator('[data-action="open-substitute"]').click();
  await page.locator('#substitute-input').fill('Face pull');
  await page.locator('[data-action="confirm-substitute"]').click();
  assert.equal(await block(5).locator('.rest-step-value').textContent(), '⏱ 1m', 'el ejercicio sustituido muestra el descanso por defecto');
  await type(kg(5, 0), '15');
  await type(reps(5, 0), '12');
  await check(5, 0).click();
  await page.locator('#rest-bar').waitFor({ state: 'visible' });
  assert.match(await page.locator('#rest-time').textContent(), /^(1:00|59s)$/);
  await page.locator('[data-action="rest-skip"]').click();

  // 11. Sonido y vibración: con ambos apagados no suena ni vibra al acabar el descanso; encendidos, sí.
  await openSettings();
  await switchBtn('sound').click();
  await switchBtn('vibration').click();
  assert.equal((await savedSettings()).sound, false);
  assert.equal((await savedSettings()).vibration, false);
  await backToSession();
  await type(kg(0, 0), '55');
  await type(reps(0, 0), '10');
  await check(0, 0).click();
  await page.locator('#rest-bar').waitFor({ state: 'visible' });
  await page.clock.runFor(91_000);
  assert.equal(await page.locator('#rest-bar').isHidden(), true, 'el descanso termina igual');
  assert.equal(await page.evaluate(() => window.__vibrations.length), 0);
  assert.equal(await page.evaluate(() => window.__osc), 0);
  await openSettings();
  await switchBtn('sound').click();
  await switchBtn('vibration').click();
  await backToSession();
  await type(kg(0, 1), '55');
  await type(reps(0, 1), '10');
  await check(0, 1).click();
  await page.clock.runFor(91_000);
  assert.equal(await page.evaluate(() => window.__vibrations.length), 1);
  assert.equal(await page.evaluate(() => window.__osc), 3, 'tres pitidos');

  // 12. Terminar la sesión y compartir la imagen resumen.
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  const shareBtn = page.locator('#share-card-btn');
  assert.ok((await shareBtn.boundingBox()).height >= 43.5);
  await shareBtn.click();
  await page.waitForFunction(() => window.__shared.length === 1);
  const shared = await page.evaluate(() => window.__shared[0]);
  assert.match(shared.name, /^gym-tracker-\d{4}-\d{2}-\d{2}\.png$/);
  assert.equal(shared.type, 'image/png');
  assert.ok(shared.size > 5000, `PNG de ${shared.size} bytes`);
  assert.equal(shared.title, 'Sesión 1: Pecho + Hombro');
  const img = page.locator('#share-preview img');
  assert.equal(await img.isVisible(), true);
  assert.match(await img.getAttribute('src'), /^blob:/);
  const decoded = await page.evaluate(async () => {
    const im = document.querySelector('#share-preview img');
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    let lit = 0;
    const data = ctx.getImageData(0, 300, c.width, 700).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 200 && data[i + 1] > 200) lit += 1;
    return { w: im.naturalWidth, h: im.naturalHeight, bg: px(540, 1300), bar: px(10, 8), lit };
  });
  assert.deepEqual([decoded.w, decoded.h], [1080, 1350]);
  assert.deepEqual(decoded.bg.slice(0, 3), [10, 10, 15], 'fondo de la tarjeta');
  assert.notDeepEqual(decoded.bar.slice(0, 3), [10, 10, 15], 'barra de color arriba');
  assert.ok(decoded.lit > 500, 'hay texto dibujado');
  // Cancelar el menú de compartir no es un error; sin navigator.share se descarga el PNG.
  await page.evaluate(() => { window.__shareMode = 'abort'; });
  await shareBtn.click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__shared.length), 1, 'cancelar no comparte ni descarga');
  await page.evaluate(() => { window.__shareMode = 'none'; });
  const [download] = await Promise.all([page.waitForEvent('download'), shareBtn.click()]);
  assert.match(download.suggestedFilename(), /^gym-tracker-.*\.png$/);

  // 13. Músculos: la semana pasada tiene 7 series de pecho y el resto por debajo del mínimo.
  await page.locator('#screen-summary [data-screen="history"]').click();
  await page.waitForSelector('#screen-history.active');
  await page.locator('#history-tabs [data-tab="muscles"]').click();
  assert.match(await page.locator('#muscle-week-label').textContent(), /Esta semana/);
  assert.equal(await page.locator('.muscle-row').count(), 9);
  assert.equal(await page.locator('.muscle-warn').count(), 0, 'la semana en curso no avisa');
  await page.locator('[data-action="summary-week"][data-delta="1"]').click();
  const pecho = page.locator('.muscle-row[data-muscle="pecho"]');
  assert.match(await pecho.locator('.muscle-sets').textContent(), /^7 series/);
  assert.equal(await pecho.evaluate(el => el.classList.contains('low')), false);
  const espalda = page.locator('.muscle-row[data-muscle="espalda"]');
  assert.equal(await espalda.evaluate(el => el.classList.contains('low')), true);
  assert.match(await espalda.locator('.muscle-warn').textContent(), /Por debajo de 6 series/);
  assert.match(await page.locator('#history-container .info-box').textContent(), /no un consejo personalizado/);

  // 14. Peso corporal en lb: la etiqueta cambia y se guarda en kg.
  await page.goto(base);
  await page.waitForSelector('#screen-home.active');
  await openSettings();
  await settingBtn('units', 'lb').click();
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  await page.locator('#screen-home [data-screen="history"]').click();
  await page.locator('#history-tabs [data-tab="body"]').click();
  assert.equal(await page.locator('#body-weight-label').textContent(), 'Peso (lb)');
  await page.locator('#body-weight').fill('154,3');
  await page.locator('[data-action="save-body"]').click();
  const body = (await ls('gymtracker.data')).body;
  assert.equal(body.length, 1);
  assert.equal(body[0].weight, Math.round(154.3 * 0.45359237 * 10000) / 10000);
  assert.match(await page.locator('.body-row').first().textContent(), /Peso 154,3 lb/);

  // 15. Sin violaciones CSP ni errores de consola.
  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], `violaciones CSP: ${csp.join(', ')}`);
  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e progress: ok (ajustes, tema, sobrecarga, guiado, discos, músculos, imagen, CSP sin violaciones, viewport Pixel 7)');
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
