import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

test('npm run check pasa (sintaxis JS y manifest)', () => {
  const r = spawnSync(process.execPath, [join(root, 'tests/check.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('manifest.json tiene los campos mínimos de PWA', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.ok(m.name && m.start_url && m.display);
  assert.ok(Array.isArray(m.icons) && m.icons.length > 0);
});

test('package.json es ESM, sin canvas y con los scripts del plan', () => {
  const p = JSON.parse(read('package.json'));
  assert.equal(p.type, 'module');
  assert.equal(p.optionalDependencies, undefined);
  assert.equal(p.dependencies?.canvas, undefined);
  for (const s of ['test', 'check', 'e2e']) assert.ok(p.scripts[s], `falta script ${s}`);
});

test('código muerto eliminado de index.html', () => {
  const html = read('index.html');
  assert.ok(!html.includes('updateSessionData'));
  assert.ok(!html.includes('currentScreen'));
});
