import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shortcutIndex, hasShortcutParam } from '../js/pwa.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

function precacheList() {
  const m = read('sw.js').match(/const PRECACHE = \[([\s\S]*?)\];/);
  assert.ok(m, 'sw.js no define PRECACHE');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}
const norm = p => posix.normalize(p).replace(/^\.\//, '');

test('precache lista todo lo que index.html referencia', () => {
  const list = new Set(precacheList().map(norm));
  const html = read('index.html');
  const refs = [...html.matchAll(/<(?:link|script|img)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map(m => m[1])
    .filter(r => !/^(?:[a-z]+:|data:|#)/i.test(r)).map(r => norm(r.split(/[?#]/)[0]));
  assert.ok(refs.length >= 6, 'no se encontraron referencias en index.html');
  for (const r of refs) assert.ok(list.has(r), `falta en precache (index.html): ${r}`);
  assert.ok(list.has('index.html'));
});

test('precache incluye todo módulo importado y todos los js/', () => {
  const list = new Set(precacheList().map(norm));
  const files = readdirSync(join(root, 'js')).filter(f => f.endsWith('.js'));
  for (const f of files) {
    assert.ok(list.has(`js/${f}`), `falta en precache: js/${f}`);
    const src = read(`js/${f}`);
    const specs = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)].map(m => m[1]);
    for (const s of specs) {
      const target = norm(posix.join('js', s));
      assert.ok(existsSync(join(root, target)), `${f} importa ${s}, que no existe`);
      assert.ok(list.has(target), `falta en precache: ${target} (importado por js/${f})`);
    }
  }
});

test('precache: cada entrada existe, sin duplicados ni rutas absolutas', () => {
  const raw = precacheList();
  assert.equal(new Set(raw).size, raw.length, 'entradas duplicadas');
  for (const r of raw) {
    assert.ok(!r.startsWith('/') && !/^[a-z]+:/i.test(r), `ruta no relativa: ${r}`);
    if (r !== './') assert.ok(existsSync(join(root, r)), `no existe: ${r}`);
  }
});

test('manifest: id, iconos any y maskable, relativo, atajos y sin screenshots', () => {
  const m = JSON.parse(read('manifest.json'));
  const list = new Set(precacheList().map(norm));
  assert.ok(m.id, 'falta id');
  assert.ok(!('screenshots' in m), 'sin screenshots falsos');
  const purposes = m.icons.map(i => i.purpose);
  assert.ok(purposes.includes('any') && purposes.includes('maskable'));
  for (const i of m.icons) assert.ok(list.has(norm(i.src)), `icono sin precache: ${i.src}`);
  assert.ok(m.shortcuts.length >= 1 && m.shortcuts.length <= 4, 'Android admite 4 atajos');
  m.shortcuts.forEach((s, k) => {
    assert.equal(s.url, `./?session=${k + 1}`);
    for (const i of s.icons) assert.ok(list.has(norm(i.src)), `icono de atajo sin precache: ${i.src}`);
  });
  for (const v of [m.start_url, m.scope]) assert.ok(!v.startsWith('/'), 'start_url/scope relativos');
  assert.ok(!JSON.stringify(m).includes('/gym-tracker'), 'manifest con /gym-tracker fijo');
});

test('sw.js: rutas relativas, versión única y solo respuestas ok de tipo basic', () => {
  const sw = read('sw.js');
  assert.ok(!sw.includes('/gym-tracker'), 'sw.js con /gym-tracker fijo');
  assert.equal([...sw.matchAll(/const CACHE_VERSION\b/g)].length, 1);
  assert.equal([...sw.matchAll(/const CACHE_NAME\b/g)].length, 1);
  assert.equal([...sw.matchAll(/gym-tracker-v\d/g)].length, 0, 'nombre de caché con versión repetida');
  assert.match(sw, /response\.ok && response\.type === 'basic'/);
  assert.match(sw, /NETWORK_TIMEOUT_MS = 3000/);
  assert.match(sw, /ignoreSearch: true/);
  assert.match(sw, /SKIP_WAITING/);
});

test('el registro del SW y el aviso cumplen la CSP (sin inline)', () => {
  const html = read('index.html');
  assert.match(html, /id="update-banner"/);
  assert.match(html, /id="update-reload"/);
  assert.ok(!/\sonclick\s*=/i.test(html));
  assert.match(read('js/app.js'), /sw\.js|registerServiceWorker/);
});

test('shortcutIndex valida N contra las rutinas existentes', () => {
  assert.equal(shortcutIndex('?session=1', 3), 0);
  assert.equal(shortcutIndex('?session=3', 3), 2);
  for (const bad of ['?session=0', '?session=4', '?session=-1', '?session=1.5', '?session=01', '?session=abc', '?session=', '?session=1e1', '?session=%20', '', '?x=1']) {
    assert.equal(shortcutIndex(bad, 3), null, bad);
  }
  assert.equal(shortcutIndex('?session=1', 0), null);
  assert.equal(hasShortcutParam('?session=zzz'), true);
  assert.equal(hasShortcutParam(''), false);
});
