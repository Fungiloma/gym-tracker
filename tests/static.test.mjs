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

test('index.html sin scripts, estilos ni manejadores inline', () => {
  const html = read('index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'script inline');
  assert.ok(!/<style/i.test(html), 'bloque <style>');
  assert.ok(!/\sstyle\s*=/i.test(html), 'atributo style');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'manejador on*');
  assert.match(html, /<script type="module" src="js\/app\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="css\/app\.css">/);
});

test('CSP por meta con la política del plan, antes de cualquier recurso', () => {
  const html = read('index.html');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'falta meta CSP');
  assert.equal(m[1], "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; manifest-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'");
  assert.ok(m.index < html.indexOf('<link'), 'la CSP debe ir antes de los <link>');
});

test('los módulos JS no usan innerHTML/outerHTML, eval ni estilos por atributo', () => {
  for (const f of ['plan', 'data', 'storage', 'timers', 'views', 'app', 'stats', 'charts', 'history', 'routines', 'editor']) {
    const src = read(`js/${f}.js`);
    assert.ok(!/\b(innerHTML|outerHTML|insertAdjacentHTML)\b/.test(src), `${f}.js usa HTML como texto`);
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(src), `${f}.js usa eval`);
    assert.ok(!/setAttribute\(\s*['"]style['"]|\.style\b/.test(src), `${f}.js usa estilos inline`);
  }
});
