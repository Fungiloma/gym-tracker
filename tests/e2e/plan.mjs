// E2E de la fase 6: plan editable en Pixel 7 emulado.
// Crear un ejercicio y una rutina, editar series, rangos y descansos, completarla y verla en el historial;
// archivar lo que tiene historial; duplicar y reordenar; exportar e importar el plan (inválido y válido);
// plan guardado dañado; nombres con HTML como texto; consola sin errores ni violaciones CSP.
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
const port = Number(process.env.E2E_PORT_PLAN || 8142);
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

const EVIL = '<img src=x onerror=alert(1)>Hip thrust';
const problems = [];
let browser;
try {
  await waitServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'], acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
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

  const ls = key => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
  const toast = page.locator('#toast');
  async function type(locator, value) {
    await locator.fill(value);
    await locator.dispatchEvent('change');
  }
  const routinesScreen = page.locator('#screen-routines');
  const editor = page.locator('#routine-container');
  const library = page.locator('#library-container');

  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.session-btn');
  assert.equal(await page.locator('#sessions-list .session-btn').count(), 4, 'plan por defecto: 4 rutinas');

  // 1. Pantalla de rutinas: el plan actual es la rutina por defecto. Sin gymtracker.plan hasta editar.
  await page.locator('[data-screen="routines"]').click();
  await page.waitForSelector('#screen-routines.active .editor-row');
  assert.equal(await routinesScreen.locator('.editor-list > .editor-row').count(), 4);
  assert.equal(await ls('gymtracker.plan'), null);

  // 2. Biblioteca: ejercicio nuevo con HTML en el nombre (se guarda y se pinta como texto).
  await page.locator('#screen-routines [data-screen="library"]').click();
  await page.waitForSelector('#screen-library.active #new-exercise-name');
  await page.fill('#new-exercise-name', EVIL);
  await library.locator('[data-new="type"]').selectOption('traditional');
  await library.locator('[data-muscles="new"] input[value="femoral"]').check();
  await page.locator('[data-action="exercise-create"]').click();
  await toast.waitFor();
  const lib = (await ls('gymtracker.plan')).exercises;
  const custom = lib.find(e => e.name === EVIL);
  assert.ok(custom, 'ejercicio guardado con el nombre literal');
  assert.match(custom.id, /^x-img-src-x-onerror-alert-1-hip-thrust$/);
  assert.deepEqual(custom.muscles, ['femoral']);
  assert.equal(await page.locator('#library-container img').count(), 0, 'el HTML del nombre no crea elementos');
  assert.equal(await library.locator('.editor-row-title', { hasText: EVIL }).count(), 1);
  // Nombre repetido: se rechaza.
  await page.fill('#new-exercise-name', 'press banca MANCUERNAS');
  await page.locator('[data-action="exercise-create"]').click();
  await page.waitForFunction(() => /Ya hay un ejercicio/.test(document.getElementById('toast').textContent));

  // 3. Crear rutina: abre el editor vacío; no se puede empezar sin ejercicios.
  await page.goBack();
  await page.waitForSelector('#screen-routines.active');
  await page.fill('#new-routine-name', 'Rutina E2E');
  await page.locator('[data-action="routine-create"]').click();
  await page.waitForSelector('#screen-routine.active');
  assert.equal(await page.locator('#routine-title').textContent(), 'Rutina E2E');

  // 4. Añadir dos ejercicios, editar series, rango, descanso, drop, nota y orden.
  await editor.locator('#add-exercise-select').selectOption('press-banca-mancuernas');
  await page.locator('[data-action="routine-ex-add"]').click();
  await editor.locator('#add-exercise-select').selectOption(custom.id);
  await page.locator('[data-action="routine-ex-add"]').click();
  assert.equal(await editor.locator('.editor-ex').count(), 2);
  const exBlock = i => editor.locator('.editor-ex').nth(i);
  const seriesRow = (i, k) => exBlock(i).locator('.editor-series').nth(k);
  assert.equal(await exBlock(0).locator('.editor-series').count(), 3, 'por defecto 3 series');
  await type(seriesRow(0, 0).locator('[data-edit="series-reps"]'), '6-8');
  await type(seriesRow(0, 0).locator('[data-edit="series-rest"]'), '120');
  await exBlock(0).locator('[data-action="routine-series-remove"]').nth(2).click();
  assert.equal(await exBlock(0).locator('.editor-series').count(), 2);
  await exBlock(1).locator('[data-action="routine-series-add"]').click();
  assert.equal(await exBlock(1).locator('.editor-series').count(), 4);
  await seriesRow(1, 3).locator('[data-edit="series-drop"]').check();
  await type(exBlock(1).locator('[data-edit="routine-note"]'), 'Pausa arriba');
  // Descanso inválido: se rechaza y no se guarda.
  await type(seriesRow(1, 0).locator('[data-edit="series-rest"]'), '9999');
  await page.waitForFunction(() => /descanso/.test(document.getElementById('toast').textContent));
  await exBlock(1).locator('[data-action="routine-ex-move"][data-dir="-1"]').click();
  await type(editor.locator('[data-edit="routine-emoji"]'), '🍑');
  await type(editor.locator('[data-edit="routine-duration"]'), '45');

  let plan = await ls('gymtracker.plan');
  let routine = plan.routines.find(r => r.name === 'Rutina E2E');
  assert.equal(plan.planVersion, 1);
  assert.match(routine.id, /^r-rutina-e2e$/);
  assert.deepEqual(routine.exercises.map(e => e.exerciseId), [custom.id, 'press-banca-mancuernas']);
  assert.deepEqual(routine.exercises[1].series, [{ reps: '6-8', rest: 120 }, { reps: '8-12', rest: 90 }]);
  assert.equal(routine.exercises[0].series.length, 4);
  assert.equal(routine.exercises[0].series[3].drop, true);
  assert.equal(routine.exercises[0].series[0].rest, 90, 'el descanso inválido no se guardó');
  assert.equal(routine.exercises[0].note, 'Pausa arriba');
  assert.equal(routine.emoji, '🍑');
  assert.equal(routine.duration, 45);

  // 5. Persistencia: tras recargar, la rutina sigue y aparece al final de la pantalla de inicio.
  await page.reload();
  await page.waitForSelector('#screen-home.active .session-btn');
  assert.equal(await page.locator('#sessions-list .session-btn').count(), 5);
  const btn = page.locator('#sessions-list .session-btn').last();
  assert.match(await btn.textContent(), /Rutina E2E/);
  assert.match(await btn.textContent(), /2 ejercicios · 45 min/);

  // 6. Completarla: las series del editor llegan a la sesión (objetivo, drop, nota) y se guardan.
  await btn.click();
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.equal(await page.locator('#session-header-title').textContent(), 'Rutina E2E');
  const block = i => page.locator('#screen-session .exercise-block').nth(i);
  assert.equal(await block(0).locator('.exercise-name-main').textContent(), EVIL);
  assert.equal(await page.locator('#screen-session img').count(), 0);
  assert.equal(await block(0).locator('.exercise-note').textContent(), 'Pausa arriba');
  assert.equal(await block(0).locator('.series-block').count(), 4);
  assert.equal(await block(0).locator('.series-block.drop').count(), 1);
  assert.match(await block(1).locator('.series-block').first().textContent(), /6-8/);
  const row = (e, s) => block(e).locator('.series-block').nth(s);
  for (const [e, s, kg, reps] of [[0, 0, '60', '10'], [0, 1, '60', '9'], [1, 0, '24', '8'], [1, 1, '24', '7']]) {
    await type(row(e, s).locator('[data-field="weight"]'), kg);
    await type(row(e, s).locator('[data-field="repsDone"]'), reps);
    await row(e, s).locator('.check-btn').click();
  }
  await page.locator('[data-action="complete-session"]').click();
  await page.waitForSelector('#screen-summary.active');
  assert.match(await page.locator('#summary-text').textContent(), /Rutina E2E/);
  const saved = (await ls('gymtracker.data')).sessions;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].planSessionId, 'r-rutina-e2e');
  assert.deepEqual(saved[0].exercises.map(e => e.id), [custom.id, 'press-banca-mancuernas']);

  // 7. Historial: la sesión aparece y el filtro por rutina la incluye.
  await page.locator('#screen-summary [data-screen="history"]').click();
  await page.waitForSelector('#screen-history.active .session-card');
  assert.equal(await page.locator('.session-card .session-title').first().textContent(), 'Rutina E2E');
  await page.locator('#history-plan').selectOption('r-rutina-e2e');
  assert.equal(await page.locator('.session-card').count(), 1);
  await page.locator('#history-plan').selectOption('pierna');
  assert.equal(await page.locator('.session-card').count(), 0);
  await page.locator('#history-plan').selectOption('');

  // 8. Con historial no se borra, se archiva: sale del inicio y el historial se conserva.
  await page.goto(base);
  await page.waitForSelector('#screen-home.active');
  await page.locator('[data-screen="routines"]').click();
  await page.waitForSelector('#screen-routines.active .editor-row');
  const e2eRow = routinesScreen.locator('.editor-list > .editor-row[data-routine="r-rutina-e2e"]');
  assert.equal(await e2eRow.locator('[data-action="routine-remove"]').getAttribute('aria-label'), 'Archivar Rutina E2E');
  await e2eRow.locator('[data-action="routine-remove"]').click();
  await page.waitForFunction(() => /Rutina archivada/.test(document.getElementById('toast').textContent));
  assert.match(dialogs.at(-1), /Archivarla/);
  plan = await ls('gymtracker.plan');
  assert.equal(plan.routines.find(r => r.id === 'r-rutina-e2e').archived, true);
  assert.equal(await routinesScreen.locator('.editor-archived .editor-row').count(), 1);
  // Ejercicio con historial y fuera de rutinas activas: se archiva, no se borra.
  await page.locator('#screen-routines [data-screen="library"]').click();
  await page.waitForSelector('#screen-library.active');
  await library.locator(`.editor-row[data-exercise="${custom.id}"] [data-action="exercise-remove"]`).click();
  await page.waitForFunction(() => /Ejercicio archivado/.test(document.getElementById('toast').textContent));
  assert.equal((await ls('gymtracker.plan')).exercises.find(e => e.id === custom.id).archived, true);
  // Uno en una rutina activa no se puede borrar ni archivar.
  await library.locator('.editor-row[data-exercise="peso-muerto"] [data-action="exercise-remove"]').click();
  await page.waitForFunction(() => /Quítalo de la rutina antes/.test(document.getElementById('toast').textContent));
  assert.ok((await ls('gymtracker.plan')).exercises.some(e => e.id === 'peso-muerto' && !e.archived));
  await page.goBack();
  await page.waitForSelector('#screen-routines.active');
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  assert.equal(await page.locator('#sessions-list .session-btn').count(), 4);
  await page.locator('#screen-home [data-screen="history"]').click();
  await page.waitForSelector('#screen-history.active .session-card');
  assert.equal(await page.locator('.session-card').count(), 1, 'el historial no cambia al archivar');
  await page.locator('.session-card .session-header').first().click();
  assert.match(await page.locator('.session-card .series-line').first().textContent(), /60kg × 10/);

  // 9. Duplicar y reordenar: la copia va detrás del original y se puede subir.
  await page.goto(base);
  await page.locator('[data-screen="routines"]').click();
  await page.waitForSelector('#screen-routines.active .editor-row');
  await routinesScreen.locator('.editor-row[data-routine="pierna"] [data-action="routine-duplicate"]').click();
  await page.waitForFunction(() => /Rutina duplicada/.test(document.getElementById('toast').textContent));
  let ids = (await ls('gymtracker.plan')).routines.filter(r => !r.archived).map(r => r.id);
  assert.deepEqual(ids, ['pecho-hombro', 'pierna', 'r-sesion-2-pierna-copia', 'espalda-biceps', 'pecho-triceps-core']);
  await routinesScreen.locator('.editor-row[data-routine="r-sesion-2-pierna-copia"] [data-action="routine-move"][data-dir="-1"]').click();
  ids = (await ls('gymtracker.plan')).routines.filter(r => !r.archived).map(r => r.id);
  assert.equal(ids[1], 'r-sesion-2-pierna-copia');
  // Borrar la copia (sin historial): se borra de verdad.
  await routinesScreen.locator('.editor-row[data-routine="r-sesion-2-pierna-copia"] [data-action="routine-remove"]').click();
  await page.waitForFunction(() => /Rutina borrada/.test(document.getElementById('toast').textContent));
  assert.ok(!(await ls('gymtracker.plan')).routines.some(r => r.id === 'r-sesion-2-pierna-copia'));

  // 10. Exportar el plan.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="plan-export"]').click()]);
  assert.match(download.suggestedFilename(), /^gym-tracker-plan-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(exported.kind, 'plan');
  assert.equal(exported.planVersion, 1);
  assert.equal(exported.routines.length, 5);

  // 11. Importar: referencia rota → error sin tocar nada; copia del historial → aviso claro.
  const before = await page.evaluate(() => localStorage.getItem('gymtracker.plan'));
  const broken = { ...exported, routines: [{ id: 'r-x', name: 'X', exercises: [{ exerciseId: 'no-existe', series: [{ reps: '5', rest: 60 }] }] }] };
  await page.setInputFiles('#plan-import-file', { name: 'roto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) });
  await page.waitForSelector('#plan-import-preview .import-title.error');
  assert.match(await page.locator('#plan-import-preview').textContent(), /no está en la biblioteca/);
  await page.locator('[data-action="plan-import-cancel"]').click();
  await page.setInputFiles('#plan-import-file', { name: 'datos.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 2, sessions: [] })) });
  await page.waitForSelector('#plan-import-preview .import-title.error');
  assert.match(await page.locator('#plan-import-preview').textContent(), /copia del historial/);
  await page.locator('[data-action="plan-import-cancel"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('gymtracker.plan')), before);

  // Importar uno válido de una sola rutina: sustituye el plan y conserva archivado lo que usa el historial.
  const template = {
    app: 'gym-tracker', kind: 'plan', planVersion: 1,
    exercises: [{ id: 'sentadilla', name: 'Sentadilla', type: 'traditional', muscles: ['cuadriceps'] }],
    routines: [{ id: 'full-body', name: 'Full body <b>A</b>', emoji: '⚡', duration: 50, exercises: [{ exerciseId: 'sentadilla', note: '', series: [{ reps: '5', rest: 180 }] }] }],
  };
  await page.setInputFiles('#plan-import-file', { name: 'plantilla.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(template)) });
  await page.waitForSelector('#plan-import-preview [data-action="plan-import-confirm"]');
  assert.match(await page.locator('#plan-import-preview').textContent(), /1 rutinas y 1 ejercicios/);
  assert.match(await page.locator('#plan-import-preview').textContent(), /Se conservan archivados 1 rutinas y 2 ejercicios/);
  await page.locator('[data-action="plan-import-confirm"]').click();
  await page.waitForFunction(() => /Plan importado/.test(document.getElementById('toast').textContent));
  plan = await ls('gymtracker.plan');
  assert.deepEqual(plan.routines.filter(r => !r.archived).map(r => r.id), ['full-body']);
  assert.ok(plan.routines.some(r => r.id === 'r-rutina-e2e' && r.archived));
  assert.ok(plan.exercises.some(e => e.id === 'press-banca-mancuernas' && e.archived));
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  assert.equal(await page.locator('#sessions-list .session-btn').count(), 1);
  assert.match(await page.locator('#sessions-list .session-btn').textContent(), /Full body <b>A<\/b>/);
  assert.equal(await page.locator('#sessions-list b').count(), 0);

  // 12. Volver al plan original.
  await page.locator('[data-screen="routines"]').click();
  await page.locator('[data-action="plan-reset"]').click();
  await page.waitForFunction(() => /Plan original/.test(document.getElementById('toast').textContent));
  await page.goBack();
  await page.waitForSelector('#screen-home.active');
  assert.equal(await page.locator('#sessions-list .session-btn').count(), 4);

  // 13. Plan guardado dañado: aviso, copia literal en gymtracker.plan.backup y plan original; historial intacto.
  await page.evaluate(() => localStorage.setItem('gymtracker.plan', '{"planVersion":1,"exercises":[],"routines":[{"id":"a"}]}'));
  await page.reload();
  await page.waitForFunction(() => /plan guardado estaba dañado/.test(document.getElementById('toast').textContent));
  assert.equal(await page.evaluate(() => localStorage.getItem('gymtracker.plan.backup')), '{"planVersion":1,"exercises":[],"routines":[{"id":"a"}]}');
  assert.equal(await page.locator('#sessions-list .session-btn').count(), 4);
  assert.equal((await ls('gymtracker.data')).sessions.length, 1);

  const csp = await page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], `violaciones CSP: ${csp.join(', ')}`);
  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log('e2e plan: ok (biblioteca, crear y editar rutina, completarla, historial, archivar, duplicar, reordenar, export/import, plan dañado, HTML como texto, CSP sin violaciones, viewport Pixel 7)');
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
