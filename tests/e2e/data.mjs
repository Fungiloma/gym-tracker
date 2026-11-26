// E2E de la fase 2: borrador que sobrevive a la recarga, descartar con confirmación,
// avisos al guardar, anterior como placeholder, export JSON/CSV, import con vista previa
// (incluido HTML malicioso), error de cuota visible y datos dañados con copia de seguridad.
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
const port = Number(process.env.E2E_PORT_DATA || 8139);
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
const T0 = Date.UTC(2026, 9, 1, 18, 0);

function v2Session(id, over = {}) {
  return {
    id, planSessionId: 'pierna', name: 'Sesión 2: Pierna', startedAt: T0, endedAt: T0 + 3_600_000, notes: '',
    exercises: [{ id: 'peso-muerto', name: 'Peso muerto', notes: '', series: [
      { type: 'normal', target: '6-8', weight: 100, weight2: null, repsDone: 6, rpe: null, done: true },
    ] }],
    ...over,
  };
}

const problems = [];
let browser;
try {
  await waitServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await context.newPage();

  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) {
      problems.push(`console ${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  const dialogs = [];
  let answer = 'accept';
  page.on('dialog', d => {
    dialogs.push(d.message());
    if (answer === 'accept') d.accept(); else d.dismiss();
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });

  const ls = key => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
  const kg = (i = 0) => page.locator('#screen-session .kg-input[data-field="weight"]').nth(i);
  const reps = (i = 0) => page.locator('#screen-session .kg-input[data-field="repsDone"]').nth(i);
  async function type(locator, value) {
    await locator.fill(value);
    await locator.dispatchEvent('change');
  }

  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.session-btn');

  // 1. Recargar a mitad de sesión no pierde nada: se reanuda directamente.
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active');
  await type(kg(0), '50');
  await type(reps(0), '8');
  await type(kg(1), '52.5');
  const draft = await ls('gymtracker.draft');
  assert.equal(draft.exercises[0].series[0].weight, 50);
  assert.equal(draft.exercises[0].series[0].repsDone, 8);
  assert.equal(draft.exercises[0].series[1].weight, 52.5);
  await page.reload();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.equal(await kg(0).inputValue(), '50');
  assert.equal(await reps(0).inputValue(), '8');
  assert.equal(await kg(1).inputValue(), '52.5');
  assert.equal(await page.locator('#screen-session .series-block.done').count(), 0, 'escribir no marca como hecha');

  // 2. Volver a home: tarjeta de sesión en curso y reanudar.
  await page.locator('#screen-session [data-action="go-back"]').click();
  const resume = page.locator('#screen-home [data-action="resume-session"]');
  await resume.waitFor();
  assert.match(await resume.textContent(), /Sesión 1: Pecho \+ Hombro/);
  assert.match(await resume.textContent(), /2\/\d+ series apuntadas/);
  await resume.click();
  await page.waitForSelector('#screen-session.active');
  assert.equal(await kg(0).inputValue(), '50');

  // 3. Descartar pide confirmación; cancelar no borra nada.
  answer = 'dismiss';
  await page.locator('[data-action="discard-session"]').click();
  assert.match(dialogs.at(-1), /Se perderán 2 series/);
  assert.ok(await page.locator('#screen-session.active').count() === 1);
  assert.notEqual(await ls('gymtracker.draft'), null);
  answer = 'accept';
  await page.locator('[data-action="discard-session"]').click();
  await page.waitForSelector('#screen-home.active');
  assert.equal(await ls('gymtracker.draft'), null);
  assert.equal(await page.locator('[data-action="resume-session"]').count(), 0);

  // 4. Guardar sesión vacía avisa; si se cancela no se guarda.
  await page.locator('.session-btn').first().click();
  answer = 'dismiss';
  await page.locator('[data-action="complete-session"]').click();
  assert.match(dialogs.at(-1), /No has apuntado ninguna serie/);
  assert.ok(await page.locator('#screen-session.active').count() === 1);
  assert.equal(await ls('gymtracker.data'), null);
  answer = 'accept';

  // 5. Valor fuera de rango: se marca y no se guarda.
  await type(kg(0), '5000');
  assert.equal(await kg(0).getAttribute('aria-invalid'), 'true');
  assert.equal((await ls('gymtracker.draft')).exercises[0].series[0].weight, null);
  await page.locator('#toast').waitFor();
  await type(kg(0), '60');
  await type(reps(0), '10');
  assert.equal(await kg(0).getAttribute('aria-invalid'), null);

  // 6. Guardar con series sin completar y con valores sin ✓ avisa con los números; cancelar vuelve; aceptar guarda
  // y la serie sin ✓ se guarda con su valor pero sin contar como hecha.
  answer = 'dismiss';
  await page.locator('[data-action="complete-session"]').click();
  assert.match(dialogs.at(-1), /1 serie con valores sin marcar/);
  assert.match(dialogs.at(-1), /no cuentan para récords, volumen ni sobrecarga/);
  assert.match(dialogs.at(-1), /Hay \d+ de \d+ series sin completar/);
  assert.ok(await page.locator('#screen-session.active').count() === 1, 'cancelar vuelve a la sesión');
  assert.equal(await ls('gymtracker.data'), null);
  answer = 'accept';
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  assert.match(await page.locator('#summary-text').textContent(), /Serie 1: 60kg × 10 \(obj\. 8-10\)/);
  const data = await ls('gymtracker.data');
  assert.equal(data.schemaVersion, 2);
  assert.equal(data.sessions.length, 1);
  assert.ok(data.sessions[0].endedAt >= data.sessions[0].startedAt);
  const saved = data.sessions[0].exercises[0].series[0];
  assert.equal(saved.weight, 60);
  assert.equal(saved.done, false, 'valores sin ✓ no cuentan como hecha');

  // 7. El valor anterior va en su columna, nunca como valor: solo se usa al tocarla.
  await page.locator('#screen-summary [data-action="go-back"]').click();
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active');
  assert.equal(await kg(0).inputValue(), '');
  const prevBtn = page.locator('#screen-session .series-block').first().locator('.prev-btn');
  assert.equal((await prevBtn.textContent()).trim(), '60 × 10');
  assert.equal(await page.locator('#screen-session .series-block').nth(1).locator('.prev-empty').count(), 1);
  assert.equal(await kg(0).getAttribute('placeholder'), 'kg');
  await prevBtn.click();
  assert.equal(await kg(0).inputValue(), '60');
  assert.equal(await reps(0).inputValue(), '10');
  assert.equal((await ls('gymtracker.draft')).exercises[0].series[0].weight, 60);
  await page.locator('[data-action="discard-session"]').click();

  // 8. Export JSON y CSV.
  await page.locator('#screen-home [data-action="go-screen"][data-screen="history"]').click();
  await page.waitForSelector('#screen-history.active .session-card');
  let [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export-json"]').click()]);
  assert.match(download.suggestedFilename(), /^gym-tracker-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.sessions.length, 1);
  [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export-csv"]').click()]);
  const csv = readFileSync(await download.path(), 'utf8');
  assert.ok(csv.startsWith('﻿session_id,started_at,'), 'CSV con BOM y cabecera');
  assert.match(csv, /press-banca-mancuernas,Press banca mancuernas,1,normal,8-10,60,,10,,false/);

  // 9. Import con HTML malicioso: vista previa como texto, fusión por id, nada se ejecuta.
  const evil = {
    schemaVersion: 2,
    sessions: [
      v2Session('evil-1', { name: XSS, notes: XSS, exercises: [{ id: 'x', name: XSS, notes: '', series: [] }] }),
      exported.sessions[0],
      { ...v2Session('"><svg onload=alert(1)>') },
    ],
  };
  await page.setInputFiles('#import-file', { name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(evil)) });
  const preview = page.locator('#import-preview');
  await preview.waitFor();
  const previewText = await preview.textContent();
  assert.match(previewText, /1 nuevas se añadirán/);
  assert.match(previewText, /1 ya existen/);
  assert.match(previewText, /1 rechazadas/);
  assert.ok(previewText.includes(XSS), 'el nombre hostil se muestra literal');
  assert.equal(await page.locator('#import-preview img, #import-preview svg').count(), 0);
  assert.equal((await ls('gymtracker.data')).sessions.length, 1, 'la vista previa no modifica nada');
  await page.locator('[data-action="import-confirm"]').click();
  assert.equal(await preview.isVisible(), false);
  assert.equal(await page.locator('.session-card').count(), 2);
  const evilCard = page.locator('.session-card[data-id="evil-1"]');
  await evilCard.locator('.session-header').click();
  assert.ok((await evilCard.textContent()).includes(XSS));
  assert.equal(await page.locator('#history-container img, #history-container svg').count(), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'se ejecutó código inyectado');
  assert.deepEqual((await ls('gymtracker.data')).sessions.map(s => s.id).sort(), [exported.sessions[0].id, 'evil-1'].sort());

  // 10. Import de un fichero que no es JSON: error en la vista previa, se puede cerrar.
  await page.setInputFiles('#import-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('<html>') });
  await preview.waitFor();
  assert.match(await preview.textContent(), /no es JSON válido/);
  await page.locator('#import-preview [data-action="import-cancel"]').click();
  assert.equal(await preview.isVisible(), false);

  // 11. Cuota llena: aviso visible y el borrador se conserva.
  await page.locator('#screen-history [data-action="go-back"]').click();
  await page.locator('.session-btn').nth(1).click();
  await page.waitForSelector('#screen-session.active');
  await type(kg(0), '120');
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    window.__restoreSetItem = () => { Storage.prototype.setItem = orig; };
    Storage.prototype.setItem = function (k, v) {
      if (k === 'gymtracker.data') throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await page.locator('[data-action="complete-session"]').click();
  const toast = page.locator('#toast');
  await toast.waitFor();
  assert.match(await toast.textContent(), /almacenamiento del navegador está lleno/);
  assert.ok(await page.locator('#screen-session.active').count() === 1, 'sigue en la sesión');
  assert.equal((await ls('gymtracker.draft')).exercises[0].series[0].weight, 120);
  assert.equal((await ls('gymtracker.data')).sessions.length, 2);
  await page.evaluate(() => window.__restoreSetItem());
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  assert.equal((await ls('gymtracker.data')).sessions.length, 3);

  // 12. Datos dañados: aviso y copia literal en gymtracker.data.backup.
  await page.evaluate(() => localStorage.setItem('gymtracker.data', '{roto'));
  await page.reload();
  await page.locator('#toast').waitFor();
  assert.match(await page.locator('#toast').textContent(), /dañados/);
  assert.equal(await page.evaluate(() => localStorage.getItem('gymtracker.data.backup')), '{roto');

  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], `violaciones CSP: ${csp.join(', ')}`);
  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e data: ok (borrador tras recarga, descartar, avisos, placeholder, export JSON/CSV, import malicioso, cuota, backup, CSP sin violaciones, viewport Pixel 7)');
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
