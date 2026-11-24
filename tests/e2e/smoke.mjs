// E2E smoke: abrir, iniciar sesión, apuntar kg, guardar, ver historial.
// Requiere Playwright instalado globalmente (o en node_modules) y Chromium.
// Uso: npm run e2e   (levanta python3 -m http.server en un puerto libre)
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number(process.env.E2E_PORT || 8137);
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
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();

  page.on('console', m => {
    if (m.type() === 'error' || /Content Security Policy|Refused to/i.test(m.text())) {
      problems.push(`console ${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));

  await page.goto(base);
  await page.waitForSelector('.session-btn');
  const nSessions = await page.locator('.session-btn').count();
  assert.ok(nSessions > 0, 'la home no lista sesiones');

  await page.locator('.session-btn').first().click();
  await page.waitForSelector('#screen-session.active .kg-input');
  const firstInput = page.locator('#screen-session .kg-input').first();
  await firstInput.fill('42.5');
  await firstInput.dispatchEvent('change');

  await page.getByRole('button', { name: /Guardar sesión/ }).click();
  await page.waitForSelector('#screen-summary.active');
  const summary = await page.locator('#summary-text').textContent();
  assert.match(summary, /42\.5kg/, 'el resumen no contiene el peso apuntado');

  await page.getByRole('button', { name: /historial/i }).click();
  await page.waitForSelector('#screen-history.active .session-header');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gym-sessions')));
  assert.equal(stored.length, 1, 'debe haber 1 sesión guardada');
  assert.equal(stored[0].exercises[0].series[0].weight, '42.5');

  await page.locator('.session-header').first().click();
  const historyText = await page.locator('#history-container').textContent();
  assert.match(historyText, /42\.5/, 'el historial no muestra el peso');

  assert.deepEqual(problems, [], `errores de consola:\n${problems.join('\n')}`);
  console.log(`e2e smoke: ok (${nSessions} sesiones en home, viewport Pixel 7)`);
} catch (e) {
  console.error(e);
  if (problems.length) console.error(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
