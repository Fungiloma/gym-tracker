// E2E de la fase 7: PWA sin red en Chromium emulado (Pixel 7).
// Primera visita con red, luego context.setOffline(true): abrir, registrar una serie, guardar, recargar.
// Se repite en la raíz del servidor y bajo un subdirectorio /gym-tracker/ (como GitHub Pages),
// y se prueba el atajo ?session=N y el aviso de nueva versión con limpieza de la caché anterior.
// Uso: npm run e2e   (levanta python3 -m http.server en puertos libres)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const portRoot = Number(process.env.E2E_PORT_OFFLINE || 8141);
const portSub = portRoot + 1;
const portUpd = portRoot + 2;

const tmp = mkdtempSync(join(tmpdir(), 'gym-e2e-'));
const subParent = join(tmp, 'sub');
mkdirSync(subParent);
symlinkSync(root, join(subParent, 'gym-tracker'));
const updRoot = join(tmp, 'upd');
mkdirSync(updRoot);
for (const f of ['index.html', 'sw.js', 'manifest.json', 'css', 'js', 'icons']) cpSync(join(root, f), join(updRoot, f), { recursive: true });

const servers = [
  spawn('python3', ['-m', 'http.server', String(portRoot), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' }),
  spawn('python3', ['-m', 'http.server', String(portSub), '--bind', '127.0.0.1'], { cwd: subParent, stdio: 'ignore' }),
  spawn('python3', ['-m', 'http.server', String(portUpd), '--bind', '127.0.0.1'], { cwd: updRoot, stdio: 'ignore' }),
];

async function waitServer(url) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`servidor no arrancó: ${url}`);
}

const problems = [];
function watch(page) {
  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) {
      // La recarga sin red de recursos no cacheados no debe ocurrir; todo error cuenta.
      problems.push(`console ${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('dialog', d => d.accept());
}

async function swControlling(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
}

async function cacheState(page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const out = {};
    for (const n of names) out[n] = (await (await caches.open(n)).keys()).length;
    return out;
  });
}

async function scenario(browser, label, url) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  watch(page);

  await page.goto(url);
  await page.waitForSelector('.session-btn');
  const nSessions = await page.locator('.session-btn').count();
  await swControlling(page);
  const caches1 = await cacheState(page);
  const [name, count] = Object.entries(caches1)[0];
  assert.match(name, /^gym-tracker-/);
  const swSrc = readFileSync(join(root, 'sw.js'), 'utf8');
  const expected = [...swSrc.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].length;
  assert.equal(count, expected, `${label}: la caché debe tener todo el precache`);
  assert.equal(Object.keys(caches1).length, 1, `${label}: una sola caché`);

  // Sin red: recargar, empezar, apuntar, guardar.
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.session-btn');
  assert.equal(await page.locator('.session-btn').count(), nSessions, `${label}: home offline`);
  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active .kg-input');
  const input = page.locator('#screen-session .kg-input').first();
  await input.fill('37.5');
  await input.dispatchEvent('change');
  await page.getByRole('button', { name: /Guardar sesión/ }).click();
  await page.waitForSelector('#screen-summary.active');
  assert.match(await page.locator('#summary-text').textContent(), /37\.5kg/);
  await page.reload();
  await page.waitForSelector('.session-btn');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.data')));
  assert.equal(stored.sessions.length, 1, `${label}: sesión guardada tras recargar offline`);
  assert.equal(stored.sessions[0].exercises[0].series[0].weight, 37.5);

  // Atajo ?session=2 offline: la ruta con query se resuelve con ignoreSearch.
  await page.goto(`${url}?session=2`);
  await page.waitForSelector('#screen-session.active .kg-input');
  assert.ok((await page.locator('#session-header-title').textContent()).trim(), 'título de sesión');
  assert.equal(await page.evaluate(() => location.search), '', `${label}: la query del atajo se limpia`);
  const draftPlan = await page.evaluate(() => JSON.parse(localStorage.getItem('gymtracker.draft')).planSessionId);
  assert.ok(draftPlan, `${label}: el atajo crea borrador`);
  await page.getByRole('button', { name: /Descartar sesión/ }).click();
  await page.waitForSelector('#screen-home.active');

  // Atajo inválido: aviso y sin sesión.
  await page.goto(`${url}?session=99`);
  await page.waitForSelector('#toast:not([hidden])');
  assert.match(await page.locator('#toast').textContent(), /atajo/i);
  assert.equal(await page.evaluate(() => localStorage.getItem('gymtracker.draft')), null);
  await context.close();
  console.log(`e2e offline ${label}: ok (${count} ficheros precacheados, ${nSessions} rutinas)`);
}

async function updateScenario(browser, url) {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  watch(page);
  await page.goto(url);
  await page.waitForSelector('.session-btn');
  await swControlling(page);
  assert.equal(await page.locator('#update-banner').isVisible(), false, 'sin aviso en la primera instalación');
  // Caché antigua de la versión 6 que debe desaparecer al activar.
  await page.evaluate(() => caches.open('gym-tracker-v6'));
  const swPath = join(updRoot, 'sw.js');
  writeFileSync(swPath, readFileSync(swPath, 'utf8').replace("const CACHE_VERSION = 'v7'", "const CACHE_VERSION = 'v8'"));
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await page.waitForSelector('#update-banner:not([hidden])', { timeout: 10000 });
  assert.match(await page.locator('#update-banner').textContent(), /Nueva versión disponible/);
  const before = Object.keys(await cacheState(page));
  assert.ok(before.includes('gym-tracker-v7'), 'la versión actual sigue activa hasta recargar');
  const nav = page.waitForNavigation({ waitUntil: 'load' });
  await page.locator('#update-reload').click();
  await nav;
  await page.waitForSelector('.session-btn');
  await page.waitForFunction(async () => (await caches.keys()).join() === 'gym-tracker-v8', null, { timeout: 10000 });
  await context.close();
  console.log('e2e offline actualización: ok (aviso, recarga y limpieza de gym-tracker-v6 y v7)');
}

let browser;
try {
  await waitServer(`http://127.0.0.1:${portRoot}/index.html`);
  await waitServer(`http://127.0.0.1:${portSub}/gym-tracker/index.html`);
  await waitServer(`http://127.0.0.1:${portUpd}/index.html`);
  browser = await chromium.launch();
  await scenario(browser, 'raíz', `http://127.0.0.1:${portRoot}/`);
  await scenario(browser, 'subdirectorio /gym-tracker/', `http://127.0.0.1:${portSub}/gym-tracker/`);
  await updateScenario(browser, `http://127.0.0.1:${portUpd}/`);
  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  servers.forEach(s => s.kill());
  rmSync(tmp, { recursive: true, force: true });
}
